// "About N more prompts": turn a usage percentage into a count of prompts, from
// how much of the current window each prompt has cost so far. Prompts are
// counted from the logs Claude Code and Codex CLI keep on disk; nothing is sent
// anywhere. Usage from other apps (claude.ai, ChatGPT, IDE plugins) also fills
// the meter but has no local log, so the per-prompt cost comes out high and the
// estimate errs on the side of fewer prompts.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Longest window we estimate for (weekly); files older than this are skipped.
const MAX_WINDOW_MS = 7 * DAY_MS;
const RESCAN_MS = 60 * 1000;
const CHUNK_BYTES = 1024 * 1024;
// Too few prompts or too little usage makes the per-prompt cost mostly noise
// (Claude reports whole percents).
const MIN_PROMPTS = 3;
const MIN_PERCENT = 2;
const MAX_SHOWN = 999;

// Window lengths when the provider doesn't report one.
const DEFAULT_WINDOW_MS = {
  claude: { session: 5 * HOUR_MS, week: 7 * DAY_MS, weekScoped: 7 * DAY_MS },
  codex: { primary: 5 * HOUR_MS, secondary: 7 * DAY_MS },
};

function claudeRoots() {
  const roots = [];
  for (const dir of (process.env.CLAUDE_CONFIG_DIR || '').split(',')) {
    if (dir.trim()) roots.push(path.join(dir.trim(), 'projects'));
  }
  roots.push(path.join(os.homedir(), '.claude', 'projects'));
  roots.push(path.join(os.homedir(), '.config', 'claude', 'projects'));
  return [...new Set(roots)];
}

function codexRoots() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return [path.join(home, 'sessions'), path.join(home, 'archived_sessions')];
}

/**
 * A prompt the person typed: not a tool result, a subagent turn, a slash
 * command's bookkeeping, or a compaction summary.
 */
function parseClaudeLine(line) {
  if (!line.includes('"type":"user"')) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (entry?.type !== 'user' || entry.isSidechain || entry.isMeta || entry.isCompactSummary) return null;
  const content = entry.message?.content;
  let text;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((c) => c?.type === 'tool_result')) return null;
    text = content.find((c) => c?.type === 'text')?.text ?? '';
    if (!text && !content.some((c) => c?.type === 'image')) return null;
  } else {
    return null;
  }
  if (/^\s*<(command-name|command-message|local-command-stdout|local-command-stderr)>/.test(text)) return null;
  const t = Date.parse(entry.timestamp);
  if (!Number.isFinite(t)) return null;
  return { key: entry.uuid ?? `${t}:${text.slice(0, 80)}`, t };
}

function parseCodexLine(line) {
  if (!line.includes('user_message')) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (entry?.type !== 'event_msg' || entry.payload?.type !== 'user_message') return null;
  const t = Date.parse(entry.timestamp);
  if (!Number.isFinite(t)) return null;
  // Resumed sessions can replay earlier prompts into a new file.
  return { key: `${t}:${String(entry.payload.message ?? '').slice(0, 80)}`, t };
}

async function listJsonl(root, since) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = await fs.promises.stat(full);
          if (stat.mtimeMs >= since) found.push({ file: full, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // Deleted between readdir and stat.
        }
      }
    }
  }
  await walk(root);
  return found;
}

/**
 * Prompts found per file. Logs are append-only, so a file that grew is read
 * from where the last pass stopped.
 * @type {Map<string, { size: number, mtimeMs: number, offset: number, prompts: { key: string, t: number }[] }>}
 */
const fileCache = new Map();

async function readNewLines(file, fromOffset, onLine) {
  const handle = await fs.promises.open(file, 'r');
  try {
    let offset = fromOffset;
    let carry = Buffer.alloc(0);
    const chunk = Buffer.alloc(CHUNK_BYTES);
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, offset + carry.length);
      if (bytesRead === 0) break;
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
      const lastNewline = data.lastIndexOf(0x0a);
      if (lastNewline === -1) {
        carry = Buffer.from(data);
        continue;
      }
      for (const line of data.subarray(0, lastNewline).toString('utf8').split('\n')) {
        if (line) onLine(line);
      }
      offset += lastNewline + 1;
      carry = Buffer.from(data.subarray(lastNewline + 1));
    }
    // Stop at the last complete line; a half-written one is read next time.
    return offset;
  } finally {
    await handle.close();
  }
}

async function scanFile({ file, size, mtimeMs }, parseLine) {
  let cached = fileCache.get(file);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.prompts;
  if (!cached || size < cached.offset) {
    cached = { size: 0, mtimeMs: 0, offset: 0, prompts: [] };
  }
  try {
    cached.offset = await readNewLines(file, cached.offset, (line) => {
      const prompt = parseLine(line);
      if (prompt) cached.prompts.push(prompt);
    });
  } catch {
    return cached.prompts;
  }
  cached.size = size;
  cached.mtimeMs = mtimeMs;
  fileCache.set(file, cached);
  return cached.prompts;
}

const SOURCES = {
  claude: { roots: claudeRoots, parseLine: parseClaudeLine },
  codex: { roots: codexRoots, parseLine: parseCodexLine },
};

/** @type {Map<string, { at: number, times: number[] | null, pending: Promise<number[]> | null }>} */
const scans = new Map();

async function scanPromptTimes(providerId, now) {
  const source = SOURCES[providerId];
  const since = now - MAX_WINDOW_MS - HOUR_MS;
  const seen = new Set();
  const times = [];
  for (const root of source.roots()) {
    for (const file of await listJsonl(root, since)) {
      for (const { key, t } of await scanFile(file, source.parseLine)) {
        if (t < since || seen.has(key)) continue;
        seen.add(key);
        times.push(t);
      }
    }
  }
  return times.sort((a, b) => a - b);
}

/** Sorted prompt timestamps from the last week, rescanned at most once a minute. */
async function promptTimes(providerId, now) {
  let scan = scans.get(providerId);
  if (scan?.times && now - scan.at < RESCAN_MS) return scan.times;
  if (scan?.pending) return scan.pending;
  scan = scan ?? { at: 0, times: null, pending: null };
  scans.set(providerId, scan);
  scan.pending = scanPromptTimes(providerId, now)
    .then((times) => {
      scan.times = times;
      scan.at = now;
      return times;
    })
    .catch(() => scan.times ?? [])
    .finally(() => {
      scan.pending = null;
    });
  return scan.pending;
}

/**
 * @returns {{ left: number, capped: boolean, prompts: number } | null}
 *   left is how many more prompts fit before the meter is full, at this
 *   window's average cost per prompt.
 */
function estimate(percent, prompts) {
  if (!(percent >= MIN_PERCENT) || percent >= 100 || prompts < MIN_PROMPTS) return null;
  const perPrompt = percent / prompts;
  const left = Math.floor((100 - percent) / perPrompt);
  return { left: Math.min(left, MAX_SHOWN), capped: left > MAX_SHOWN, prompts };
}

function meterWindows(providerId, usage) {
  const defaults = DEFAULT_WINDOW_MS[providerId] ?? {};
  return Object.keys(defaults)
    .map((key) => {
      const window = usage?.[key];
      if (!window || typeof window.percent !== 'number' || !window.resetsAt) return null;
      const resetsAt = Date.parse(window.resetsAt);
      if (!Number.isFinite(resetsAt)) return null;
      const length = window.windowSeconds > 0 ? window.windowSeconds * 1000 : defaults[key];
      return { key, percent: window.percent, start: resetsAt - length };
    })
    .filter(Boolean);
}

function countSince(times, start) {
  // times is sorted: binary search for the first prompt inside the window.
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < start) lo = mid + 1;
    else hi = mid;
  }
  return times.length - lo;
}

/**
 * Return a copy of the result with `promptsLeft` ({ [meterKey]: estimate })
 * attached, for providers whose prompts are logged locally.
 * @param {(providerId: string, key: string) => number} [countPrompts] demo override
 */
async function withPromptsLeft(providerId, result, { now = Date.now(), countPrompts } = {}) {
  if (!SOURCES[providerId] || !result || !result.ok || !result.usage) return result;
  const windows = meterWindows(providerId, result.usage);
  if (windows.length === 0) return result;
  const times = countPrompts ? null : await promptTimes(providerId, now);
  const promptsLeft = {};
  for (const { key, percent, start } of windows) {
    const count = countPrompts ? countPrompts(providerId, key) : countSince(times, start);
    const e = estimate(percent, count);
    if (e) promptsLeft[key] = e;
  }
  return { ...result, promptsLeft };
}

module.exports = { withPromptsLeft, estimate, parseClaudeLine, parseCodexLine };
