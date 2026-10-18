// Character movement physics. Pure functions over a plain state object so the
// behaviour can be unit tested without a renderer.

import { resolveColliders, STEP_HEIGHT } from './collision.js';

export const MOVE_PARAMS = Object.freeze({
  walkSpeed: 3.4,
  runSpeed: 8.4,
  groundAccel: 18,
  groundDecel: 22,
  airAccel: 4.5,
  gravity: 26,
  jumpSpeed: 8.4,
  maxFallSpeed: 55,
  coyoteTime: 0.12,
  jumpBuffer: 0.14,
  snapDistance: 0.5,
  // Cosine of the steepest walkable slope (~42 degrees).
  maxSlopeY: 0.74,
  radius: 0.34,
  turnSpeed: 11,
  maxSubstep: 1 / 90,
  maxFrameDt: 0.1,
});

/**
 * Camera-relative wish direction. ix = right (+1) / left (-1), iy = forward (+1) / back (-1).
 * Camera yaw 0 looks down -Z. The result never exceeds length 1, so diagonals are not faster.
 */
export function inputToWishDir(ix, iy, yaw, out = { x: 0, z: 0 }) {
  let len = Math.hypot(ix, iy);
  if (len < 1e-6) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  const scale = len > 1 ? 1 / len : 1;
  ix *= scale;
  iy *= scale;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  out.x = -sin * iy + cos * ix;
  out.z = -cos * iy - sin * ix;
  return out;
}

export function createBodyState(x = 0, y = 0, z = 0, facing = Math.PI) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    grounded: true,
    coyote: 0,
    jumpBuffer: 0,
    airTime: 0,
    facing,
    groundNormalY: 1,
    sprinting: false,
  };
}

export function resetBody(state, x, y, z, facing = Math.PI) {
  state.pos.x = x;
  state.pos.y = y;
  state.pos.z = z;
  state.vel.x = 0;
  state.vel.y = 0;
  state.vel.z = 0;
  state.grounded = true;
  state.coyote = 0;
  state.jumpBuffer = 0;
  state.airTime = 0;
  state.facing = facing;
}

function moveToward2(vel, tx, tz, maxDelta) {
  const dx = tx - vel.x;
  const dz = tz - vel.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-6) {
    vel.x = tx;
    vel.z = tz;
  } else {
    vel.x += (dx / d) * maxDelta;
    vel.z += (dz / d) * maxDelta;
  }
}

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

const wish = { x: 0, z: 0 };
const normal = { x: 0, y: 1, z: 0 };

/**
 * Advance the body. env must provide:
 *   groundHeight(x, z) -> number
 *   groundNormal(x, z, out) -> out
 *   colliders (ColliderWorld) or null
 * input: { x, y, sprint, jump } where jump is true on the frame the key was pressed.
 * Returns an events object: { jumped, landed, landingSpeed }.
 */
export function stepBody(state, input, cameraYaw, frameDt, env, p = MOVE_PARAMS, events = {}) {
  events.jumped = false;
  events.landed = false;
  events.landingSpeed = 0;

  const dtTotal = Math.min(Math.max(frameDt, 0), p.maxFrameDt);
  if (input.jump) state.jumpBuffer = p.jumpBuffer;

  const steps = Math.max(1, Math.ceil(dtTotal / p.maxSubstep));
  const dt = dtTotal / steps;

  inputToWishDir(input.x, input.y, cameraYaw, wish);
  const wishLen = Math.hypot(wish.x, wish.z);
  state.sprinting = !!input.sprint && wishLen > 0.1;

  for (let s = 0; s < steps; s++) {
    const speed = state.sprinting ? p.runSpeed : p.walkSpeed;
    let tx = wish.x * speed;
    let tz = wish.z * speed;

    if (state.grounded) {
      env.groundNormal(state.pos.x, state.pos.z, normal);
      state.groundNormalY = normal.y;
      const hx = normal.x;
      const hz = normal.z;
      const hl = Math.hypot(hx, hz);
      if (hl > 1e-4) {
        // Downhill direction in the horizontal plane.
        const dx = hx / hl;
        const dz = hz / hl;
        const along = tx * dx + tz * dz;
        if (normal.y < p.maxSlopeY) {
          // Too steep: cannot push uphill.
          if (along < 0) {
            tx -= along * dx;
            tz -= along * dz;
          }
        } else if (along < 0) {
          // Walking uphill is a little slower on moderate slopes.
          const grade = hl / Math.max(normal.y, 0.1);
          const slow = 1 - Math.min(0.35, grade * 0.45);
          tx *= slow;
          tz *= slow;
        }
      }
      const accelerating = wishLen > 0.01;
      moveToward2(state.vel, tx, tz, (accelerating ? p.groundAccel : p.groundDecel) * dt);
      if (normal.y < p.maxSlopeY && hl > 1e-4) {
        // Slide down steep slopes.
        const slide = p.gravity * (1 - normal.y) * dt;
        state.vel.x += (hx / hl) * slide;
        state.vel.z += (hz / hl) * slide;
      }
    } else {
      moveToward2(state.vel, tx, tz, p.airAccel * dt * (wishLen > 0.01 ? 1 : 0.25));
    }

    // Jumping (with coyote time and input buffering).
    if (state.jumpBuffer > 0 && (state.grounded || state.coyote > 0)) {
      state.vel.y = p.jumpSpeed;
      state.grounded = false;
      state.coyote = 0;
      state.jumpBuffer = 0;
      events.jumped = true;
    }

    if (!state.grounded) {
      state.vel.y = Math.max(state.vel.y - p.gravity * dt, -p.maxFallSpeed);
      state.airTime += dt;
    }

    const wasGrounded = state.grounded;
    const prevY = state.pos.y;
    state.pos.x += state.vel.x * dt;
    state.pos.z += state.vel.z * dt;
    state.pos.y += state.vel.y * dt;

    let support = -Infinity;
    if (env.colliders) support = resolveColliders(env.colliders, state.pos, p.radius, state.pos.y, STEP_HEIGHT);
    const terrain = env.groundHeight(state.pos.x, state.pos.z);
    const ground = Math.max(terrain, support);

    if (state.pos.y <= ground) {
      // On or below the ground: stand on it.
      if (!wasGrounded) {
        events.landed = true;
        events.landingSpeed = Math.max(events.landingSpeed, -state.vel.y);
      }
      state.pos.y = ground;
      if (state.vel.y < 0) state.vel.y = 0;
      state.grounded = true;
    } else if (wasGrounded && state.vel.y <= 0) {
      // Stick to the ground when walking downhill or stepping off small rocks.
      const horizontal = Math.hypot(state.vel.x, state.vel.z);
      const snap = p.snapDistance + horizontal * dt * 2;
      if (prevY - ground <= snap + STEP_HEIGHT && state.pos.y - ground <= snap) {
        state.pos.y = ground;
        state.vel.y = 0;
        state.grounded = true;
      } else {
        state.grounded = false;
        state.coyote = p.coyoteTime;
      }
    } else {
      state.grounded = false;
    }

    if (state.grounded) {
      state.airTime = 0;
    } else if (state.coyote > 0) {
      state.coyote = Math.max(0, state.coyote - dt);
    }
    if (state.jumpBuffer > 0) state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);
  }

  // Face the direction of travel.
  const hs = Math.hypot(state.vel.x, state.vel.z);
  if (hs > 0.25 && wishLen > 0.01) {
    const target = Math.atan2(state.vel.x, state.vel.z);
    const diff = wrapAngle(target - state.facing);
    const maxTurn = p.turnSpeed * dtTotal;
    state.facing = wrapAngle(state.facing + Math.max(-maxTurn, Math.min(maxTurn, diff * Math.min(1, dtTotal * 12))));
  }

  // Safety net: never end a frame below the terrain.
  const floor = env.groundHeight(state.pos.x, state.pos.z);
  if (state.pos.y < floor - 0.01) {
    state.pos.y = floor;
    if (state.vel.y < 0) state.vel.y = 0;
    state.grounded = true;
  }

  return events;
}
