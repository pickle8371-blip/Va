// Graphics presets and persisted user settings.

export const QUALITY_PRESETS = {
  low: {
    label: 'Low',
    pixelRatio: 0.75,
    shadows: false,
    shadowMapSize: 1024,
    grassRadius: 48,
    grassDensity: 0.32,
    terrainDetail: 0.7,
    postprocessing: false,
    antialias: false,
    rockRadius: 220,
    treeRadius: 420,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1,
    shadows: true,
    shadowMapSize: 1024,
    grassRadius: 70,
    grassDensity: 0.55,
    terrainDetail: 1,
    postprocessing: false,
    antialias: true,
    rockRadius: 300,
    treeRadius: 600,
  },
  high: {
    label: 'High',
    pixelRatio: 1,
    shadows: true,
    shadowMapSize: 2048,
    grassRadius: 96,
    grassDensity: 0.8,
    terrainDetail: 1.25,
    postprocessing: true,
    antialias: true,
    rockRadius: 380,
    treeRadius: 800,
  },
  ultra: {
    label: 'Ultra',
    pixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 4096,
    grassRadius: 120,
    grassDensity: 1,
    terrainDetail: 1.5,
    postprocessing: true,
    antialias: true,
    rockRadius: 460,
    treeRadius: 1000,
  },
};

const STORAGE_KEY = 'samurai-endless-plains.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  quality: 'medium',
  volume: 0.7,
  sensitivity: 1,
  cameraDistance: 5,
  invertY: false,
  showFps: false,
  dynamicResolution: true,
});

export function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (key in parsed && typeof parsed[key] === typeof DEFAULT_SETTINGS[key]) settings[key] = parsed[key];
      }
    }
  } catch (err) {
    console.warn('[settings] Could not read saved settings, using defaults.', err);
  }
  if (!QUALITY_PRESETS[settings.quality]) settings.quality = DEFAULT_SETTINGS.quality;
  return settings;
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[settings] Could not save settings (storage unavailable).', err);
  }
}

/** Pick a starting preset from a rough guess of the machine's capability. */
export function suggestQuality(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(name)) return 'low';
    if (/intel|mali|adreno|powervr/i.test(name)) return 'medium';
    if (/nvidia|geforce|rtx|radeon|amd|apple m\d/i.test(name)) return 'high';
  } catch (err) {
    console.warn('[settings] Could not query GPU name.', err);
  }
  return 'medium';
}
