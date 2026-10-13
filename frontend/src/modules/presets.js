/**
 * Preset Management
 * Handles saving, loading, rendering, and deleting crop coordinate presets via localStorage.
 */

const PRESETS_STORAGE_KEY = 'pdf_text_extractor_presets';

/**
 * Loads presets from local storage.
 * @returns {Record<string, { left: number, top: number, right: number, bottom: number }>}
 */
export function loadPresets() {
  try {
    const data = localStorage.getItem(PRESETS_STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (err) {
    console.warn('Failed to load presets from localStorage:', err);
    return {};
  }
}

/**
 * Saves presets map to local storage.
 * @param {Record<string, any>} presets
 */
export function savePresets(presets) {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch (err) {
    console.error('Failed to save presets to localStorage:', err);
  }
}

/**
 * Renders the preset dropdown options.
 * @param {HTMLSelectElement} selectorEl
 */
export function renderPresetOptions(selectorEl) {
  if (!selectorEl) return;
  const presets = loadPresets();
  selectorEl.innerHTML = '<option value="">-- Select Preset --</option>';

  for (const key of Object.keys(presets)) {
    const p = presets[key];
    if (!p) continue;
    const l = Math.round(parseFloat(p.left) || 0);
    const t = Math.round(parseFloat(p.top) || 0);
    const r = Math.round(parseFloat(p.right) || 0);
    const b = Math.round(parseFloat(p.bottom) || 0);

    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${key} (${l}, ${t}, ${r}, ${b})`;
    selectorEl.appendChild(opt);
  }
}

/**
 * Saves a single preset by name.
 * @param {string} name
 * @param {{ left: number, top: number, right: number, bottom: number }} coords
 */
export function savePreset(name, coords) {
  const presets = loadPresets();
  presets[name] = {
    left: parseFloat(coords.left) || 0,
    top: parseFloat(coords.top) || 0,
    right: parseFloat(coords.right) || 0,
    bottom: parseFloat(coords.bottom) || 0
  };
  savePresets(presets);
}

/**
 * Deletes a preset by name.
 * @param {string} name
 */
export function deletePreset(name) {
  const presets = loadPresets();
  if (presets[name]) {
    delete presets[name];
    savePresets(presets);
  }
}
