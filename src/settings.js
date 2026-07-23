const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  compactMode: false,
  hiddenProviders: [],
  widgetBounds: null,
  widgetEdgeHide: null,
};

let settingsPath = null;
let cached = null;

function getSettingsPath() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
  }
  return settingsPath;
}

function mergeWithDefaults(raw) {
  const merged = { ...DEFAULTS, ...raw };
  if (!Array.isArray(merged.hiddenProviders)) {
    merged.hiddenProviders = [];
  }
  if (merged.compactMode !== true) {
    merged.compactMode = false;
  }
  if (merged.widgetBounds != null && typeof merged.widgetBounds !== 'object') {
    merged.widgetBounds = null;
  }
  if (merged.widgetEdgeHide === 'left' || merged.widgetEdgeHide === 'right') {
    merged.widgetEdgeHide = 'top';
  } else if (merged.widgetEdgeHide !== 'top') {
    merged.widgetEdgeHide = null;
  }
  return merged;
}

function loadSettings() {
  if (cached) return { ...cached };
  try {
    const raw = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
    cached = mergeWithDefaults(raw);
  } catch {
    cached = { ...DEFAULTS };
  }
  return { ...cached };
}

function saveSettings(partial) {
  const current = loadSettings();
  cached = mergeWithDefaults({ ...current, ...partial });
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(cached, null, 2));
  } catch (err) {
    console.warn('Failed to save settings:', err.message);
  }
  return { ...cached };
}

module.exports = { loadSettings, saveSettings, DEFAULTS };
