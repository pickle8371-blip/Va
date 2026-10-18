// Static environment colliders (rocks and tree trunks) stored in a spatial hash.
//
// Rocks are dome-shaped: their surface height at horizontal distance d from the
// centre is base + top * sqrt(1 - (d/r)^2). Low rocks can be stepped onto, tall
// boulders block the player and can be jumped onto. Tree trunks are vertical
// cylinders that always block.

export const STEP_HEIGHT = 0.4;

export class ColliderWorld {
  constructor(cellSize = 16) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.groups = new Map();
  }

  _key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  /** Register colliders under a group id so a whole chunk can be removed later. */
  addGroup(groupId, colliders) {
    this.removeGroup(groupId);
    const keys = [];
    for (const c of colliders) {
      const minX = Math.floor((c.x - c.r) / this.cellSize);
      const maxX = Math.floor((c.x + c.r) / this.cellSize);
      const minZ = Math.floor((c.z - c.r) / this.cellSize);
      const maxZ = Math.floor((c.z + c.r) / this.cellSize);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cz = minZ; cz <= maxZ; cz++) {
          const k = this._key(cx, cz);
          let list = this.cells.get(k);
          if (!list) {
            list = [];
            this.cells.set(k, list);
          }
          list.push(c);
          keys.push(k);
        }
      }
    }
    this.groups.set(groupId, { colliders, keys });
  }

  removeGroup(groupId) {
    const g = this.groups.get(groupId);
    if (!g) return;
    const set = new Set(g.colliders);
    for (const k of g.keys) {
      const list = this.cells.get(k);
      if (!list) continue;
      const filtered = list.filter((c) => !set.has(c));
      if (filtered.length) this.cells.set(k, filtered);
      else this.cells.delete(k);
    }
    this.groups.delete(groupId);
  }

  /** Colliders whose bounding circle may overlap the circle (x, z, radius). */
  query(x, z, radius, out = []) {
    out.length = 0;
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const list = this.cells.get(this._key(cx, cz));
        if (!list) continue;
        for (const c of list) {
          if (out.includes(c)) continue;
          const dx = c.x - x;
          const dz = c.z - z;
          const rr = c.r + radius;
          if (dx * dx + dz * dz < rr * rr) out.push(c);
        }
      }
    }
    return out;
  }

  get size() {
    let n = 0;
    for (const g of this.groups.values()) n += g.colliders.length;
    return n;
  }
}

/** Height of a collider's surface at (x, z), or -Infinity if outside it. */
export function colliderSurfaceHeight(c, x, z) {
  if (c.type !== 'rock') return -Infinity;
  const dx = x - c.x;
  const dz = z - c.z;
  const d2 = (dx * dx + dz * dz) / (c.r * c.r);
  if (d2 >= 1) return -Infinity;
  return c.base + c.top * Math.sqrt(1 - d2);
}

const scratch = [];

/**
 * Resolve a vertical-cylinder body (radius, feet at y) against static colliders.
 * Mutates pos (x, z) to push the body out of anything it cannot step onto.
 * Returns the highest walkable surface under the body (or -Infinity).
 */
export function resolveColliders(world, pos, radius, feetY, stepHeight = STEP_HEIGHT) {
  let support = -Infinity;
  // A few iterations handle being wedged between two rocks.
  for (let iter = 0; iter < 3; iter++) {
    const hits = world.query(pos.x, pos.z, radius + 0.05, scratch);
    let moved = false;
    for (const c of hits) {
      if (c.type === 'rock') {
        // Surface height under the body's footprint (sampled at the closest point to the centre).
        const surfaceAtCentre = colliderSurfaceHeight(c, pos.x, pos.z);
        const reach = c.base + c.top;
        if (feetY + stepHeight >= surfaceAtCentre && surfaceAtCentre > -Infinity) {
          // Standing on (or stepping up onto) the rock.
          support = Math.max(support, surfaceAtCentre);
          continue;
        }
        if (feetY >= reach - 0.02) continue; // Fully above the rock.
        // Effective blocking radius at the body's feet height.
        const rel = (feetY + stepHeight - c.base) / c.top;
        if (rel >= 1) continue;
        const blockR = rel <= 0 ? c.r : c.r * Math.sqrt(Math.max(0, 1 - rel * rel));
        moved = pushOut(pos, c.x, c.z, blockR + radius) || moved;
      } else {
        moved = pushOut(pos, c.x, c.z, c.r + radius) || moved;
      }
    }
    if (!moved) break;
  }
  return support;
}

function pushOut(pos, cx, cz, minDist) {
  let dx = pos.x - cx;
  let dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minDist * minDist) return false;
  let d = Math.sqrt(d2);
  if (d < 1e-5) {
    dx = 1;
    dz = 0;
    d = 1;
  } else {
    dx /= d;
    dz /= d;
  }
  pos.x = cx + dx * minDist;
  pos.z = cz + dz * minDist;
  return true;
}
