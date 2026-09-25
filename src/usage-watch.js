const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude Code and Codex append every exchange to JSONL transcripts on disk.
// Watching those files tells us the moment a reply lands, so meters can
// refresh right away instead of waiting for the next minute poll. We only
// read directory change events; nothing in the tools' own config is touched.
function transcriptDirs() {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return {
    claude: path.join(claudeHome, 'projects'),
    codex: path.join(codexHome, 'sessions'),
  };
}

// Replies stream in as many small appends; wait for the file to go quiet
// so we fetch once per exchange rather than once per chunk.
const QUIET_MS = 4 * 1000;
// Transcript folders appear on first use; look again this often until then.
const MISSING_DIR_RETRY_MS = 60 * 1000;

/**
 * @param {(providerId: string) => void} onActivity
 * @returns {{ stop: () => void }}
 */
function watchUsageActivity(onActivity, { dirs = transcriptDirs(), quietMs = QUIET_MS } = {}) {
  const watchers = new Map();
  const quietTimers = new Map();
  const retryTimers = new Map();
  let stopped = false;

  function schedule(providerId) {
    clearTimeout(quietTimers.get(providerId));
    quietTimers.set(providerId, setTimeout(() => {
      quietTimers.delete(providerId);
      if (!stopped) onActivity(providerId);
    }, quietMs));
  }

  function retryLater(providerId, dir) {
    if (stopped) return;
    clearTimeout(retryTimers.get(providerId));
    retryTimers.set(providerId, setTimeout(() => start(providerId, dir), MISSING_DIR_RETRY_MS));
  }

  function start(providerId, dir) {
    if (stopped || watchers.has(providerId)) return;
    let watcher;
    try {
      watcher = fs.watch(dir, { recursive: true, persistent: false }, (_event, filename) => {
        if (!filename || String(filename).endsWith('.jsonl')) schedule(providerId);
      });
    } catch {
      retryLater(providerId, dir);
      return;
    }
    watcher.on('error', () => {
      watcher.close();
      watchers.delete(providerId);
      retryLater(providerId, dir);
    });
    watchers.set(providerId, watcher);
  }

  for (const [providerId, dir] of Object.entries(dirs)) start(providerId, dir);

  return {
    stop() {
      stopped = true;
      for (const watcher of watchers.values()) watcher.close();
      for (const timer of [...quietTimers.values(), ...retryTimers.values()]) clearTimeout(timer);
      watchers.clear();
      quietTimers.clear();
      retryTimers.clear();
    },
  };
}

module.exports = { watchUsageActivity, transcriptDirs };
