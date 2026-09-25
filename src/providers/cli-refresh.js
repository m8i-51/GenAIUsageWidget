const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Expired sign-ins are refreshed by the provider's own CLI, never by this app:
// Claude and Codex rotate refresh tokens, so refreshing them here would sign
// the CLI out. We only run the CLI and re-read the file it rewrites.

const RETRY_COOLDOWN_MS = 5 * 60 * 1000;

/** @type {Map<string, number>} */
const lastAttemptAt = new Map();
/** @type {Map<string, Promise<unknown>>} */
const inFlight = new Map();

// Marks an error as "the saved sign-in no longer works", so the UI can point
// at the CLI even while it keeps showing the last good snapshot.
function authExpired(message) {
  const err = new Error(message);
  err.authExpired = true;
  return err;
}

function isAuthStatus(status) {
  return status === 401 || status === 403;
}

// Seconds-since-epoch `exp` of a JWT, or null when the token isn't a JWT.
function jwtExpiryMs(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isExecutable(file) {
  try {
    fs.accessSync(file, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// GUI launches often get a shorter PATH than a terminal, so also look in the
// places each CLI's installer uses.
function findExecutable(name, extraDirs = []) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), '.local', 'bin'),
    ...extraDirs,
  ];
  if (process.platform === 'win32' && process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, 'npm'));
  } else {
    dirs.push('/usr/local/bin', '/opt/homebrew/bin', path.join(os.homedir(), '.npm-global', 'bin'));
  }
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

// npm installs CLIs as .cmd shims on Windows, which only run through a shell.
// The arguments passed here are fixed strings, never user input.
function spawnCli(file, args) {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
  return spawn(needsShell ? `"${file}"` : file, args, {
    shell: needsShell,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// Runs `attempt` at most once per cooldown per key, sharing a running attempt
// between callers. Returns null when skipped because of the cooldown.
async function throttled(key, attempt) {
  if (inFlight.has(key)) return inFlight.get(key);
  const last = lastAttemptAt.get(key);
  if (last && Date.now() - last < RETRY_COOLDOWN_MS) return null;

  lastAttemptAt.set(key, Date.now());
  const promise = (async () => {
    try {
      return await attempt();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

// Forget the cooldown once the sign-in works again, so the next expiry is
// handled right away.
function markHealthy(key) {
  lastAttemptAt.delete(key);
}

module.exports = {
  authExpired,
  isAuthStatus,
  jwtExpiryMs,
  findExecutable,
  spawnCli,
  throttled,
  markHealthy,
};
