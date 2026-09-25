// API keys for providers that have no local login (e.g. z.ai). Keys are
// encrypted with the OS keystore via Electron safeStorage (DPAPI on Windows,
// libsecret/kwallet on Linux) and never sent to the renderer.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

let secretsPath = null;
let cached = null;

function getSecretsPath() {
  if (!secretsPath) {
    secretsPath = path.join(app.getPath('userData'), 'secrets.json');
  }
  return secretsPath;
}

function readAll() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(getSecretsPath(), 'utf8'));
    cached = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    cached = {};
  }
  return cached;
}

function writeAll(next) {
  cached = next;
  fs.writeFileSync(getSecretsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
}

function isBasicBackend() {
  return process.platform === 'linux'
    && typeof safeStorage.getSelectedStorageBackend === 'function'
    && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend());
}

let plainTextAllowed = false;

// Linux without GNOME Keyring or KWallet only has Chromium's fixed-password
// backend, which Electron refuses unless asked. Accept it (and say so in the
// settings window) rather than leave those desktops without API-key providers.
function ensureBackend() {
  if (plainTextAllowed || !isBasicBackend()) return;
  if (typeof safeStorage.setUsePlainTextEncryption === 'function') {
    safeStorage.setUsePlainTextEncryption(true);
  }
  plainTextAllowed = true;
}

/**
 * 'os' when keys are encrypted by the OS keystore, 'basic' when Linux has no
 * keyring and keys are only obfuscated, 'none' when nothing is available.
 */
function storageLevel() {
  ensureBackend();
  if (!safeStorage.isEncryptionAvailable()) return 'none';
  return isBasicBackend() ? 'basic' : 'os';
}

function getApiKey(id) {
  const entry = readAll()[id];
  if (typeof entry !== 'string' || !entry) return null;
  ensureBackend();
  try {
    return safeStorage.decryptString(Buffer.from(entry, 'base64'));
  } catch (err) {
    console.warn(`Failed to decrypt ${id} API key:`, err.message);
    return null;
  }
}

function hasApiKey(id) {
  return typeof readAll()[id] === 'string';
}

function setApiKey(id, key) {
  const value = String(key ?? '').trim();
  if (!value) throw new Error('API key is empty');
  ensureBackend();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system');
  }
  const encrypted = safeStorage.encryptString(value).toString('base64');
  writeAll({ ...readAll(), [id]: encrypted });
}

function clearApiKey(id) {
  const next = { ...readAll() };
  delete next[id];
  writeAll(next);
}

module.exports = { getApiKey, hasApiKey, setApiKey, clearApiKey, storageLevel };
