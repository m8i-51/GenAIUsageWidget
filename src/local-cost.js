// Token and cost totals from the logs Claude Code and Codex CLI keep on disk.
// Nothing is sent anywhere: files are read locally, and costs are estimates at
// public API list prices (subscription plans are not billed this way).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { priceClaude, priceOpenAI } = require('./pricing');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
// Files untouched for longer than this cannot hold entries inside the window.
const FILE_MAX_AGE_MS = (WINDOW_DAYS + 1) * DAY_MS;
const REFRESH_MS = 60 * 1000;
const CHUNK_BYTES = 1024 * 1024;
const TOP_PROJECTS = 5;

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

function projectName(cwd) {
  if (!cwd || typeof cwd !== 'string') return null;
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Claude Code writes one line per content block, repeating the same usage, so
 * lines are keyed by message id + request id and counted once.
 */
function parseClaudeLine(line, state) {
  if (!line.includes('"usage"')) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const message = entry?.message;
  const usage = message?.usage;
  if (entry?.type !== 'assistant' || !usage || !message.model || message.model === '<synthetic>') return null;
  const t = Date.parse(entry.timestamp);
  if (!Number.isFinite(t)) return null;

  const cacheWrite = num(usage.cache_creation_input_tokens);
  const split = usage.cache_creation;
  const cacheWrite1h = split ? num(split.ephemeral_1h_input_tokens) : 0;
  const tokens = {
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite5m: Math.max(0, cacheWrite - cacheWrite1h),
    cacheWrite1h,
  };
  return {
    key: message.id ? `${message.id}:${entry.requestId ?? ''}` : null,
    t,
    project: projectName(entry.cwd) ?? state.fallbackProject,
    model: message.model,
    tokens: tokens.input + tokens.output + tokens.cacheRead + cacheWrite,
    cost: priceClaude(message.model, tokens, { fast: usage.speed === 'fast' }),
  };
}

/**
 * Codex logs a running total after each turn; the difference from the
 * previous total is what that turn used.
 */
function parseCodexLine(line, state) {
  if (!line.includes('token_count') && !line.includes('turn_context') && !line.includes('session_meta')) {
    return null;
  }
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const payload = entry?.payload;
  if (!payload) return null;
  if (entry.type === 'session_meta') {
    if (payload.id) state.sessionId = payload.id;
    if (payload.cwd) state.cwd = payload.cwd;
    return null;
  }
  if (entry.type === 'turn_context') {
    if (payload.model) state.model = payload.model;
    if (payload.cwd) state.cwd = payload.cwd;
    return null;
  }
  if (entry.type !== 'event_msg' || payload.type !== 'token_count' || !payload.info) return null;

  const total = payload.info.total_token_usage;
  const last = payload.info.last_token_usage;
  let used = null;
  if (total) {
    const prev = state.total;
    const totalTokens = num(total.total_tokens) || num(total.input_tokens) + num(total.output_tokens);
    if (prev && totalTokens === prev.totalTokens) return null; // repeated event
    if (prev && totalTokens > prev.totalTokens) {
      used = {
        input: num(total.input_tokens) - prev.input,
        cached: num(total.cached_input_tokens) - prev.cached,
        output: num(total.output_tokens) - prev.output,
      };
    }
    state.total = {
      totalTokens,
      input: num(total.input_tokens),
      cached: num(total.cached_input_tokens),
      output: num(total.output_tokens),
    };
  }
  if (!used && last) {
    used = {
      input: num(last.input_tokens),
      cached: num(last.cached_input_tokens),
      output: num(last.output_tokens),
    };
  }
  if (!used) return null;
  const t = Date.parse(entry.timestamp);
  if (!Number.isFinite(t)) return null;
  const tokens = {
    input: Math.max(0, used.input),
    cached: Math.max(0, Math.min(used.cached, used.input)),
    output: Math.max(0, used.output),
  };
  const model = state.model || 'unknown';
  return {
    key: state.sessionId && state.total ? `${state.sessionId}:${state.total.totalTokens}` : null,
    t,
    project: projectName(state.cwd) ?? 'Unknown',
    model,
    tokens: tokens.input + tokens.output,
    cost: priceOpenAI(model, tokens),
  };
}

/**
 * Parsed records per file. Logs are append-only, so a file that grew is read
 * from where the last pass stopped instead of from the start.
 * @type {Map<string, { size: number, mtimeMs: number, offset: number, state: object, records: object[] }>}
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

async function scanFile({ file, size, mtimeMs }, parseLine, initialState) {
  let cached = fileCache.get(file);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.records;
  if (!cached || size < cached.offset) {
    cached = { size: 0, mtimeMs: 0, offset: 0, state: initialState(file), records: [] };
  }
  try {
    cached.offset = await readNewLines(file, cached.offset, (line) => {
      const record = parseLine(line, cached.state);
      if (record) cached.records.push(record);
    });
  } catch {
    return cached.records;
  }
  cached.size = size;
  cached.mtimeMs = mtimeMs;
  fileCache.set(file, cached);
  return cached.records;
}

function startOfLocalDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function summarize(records, now) {
  const todayStart = startOfLocalDay(now);
  const windowStart = startOfLocalDay(now - (WINDOW_DAYS - 1) * DAY_MS);
  const today = { cost: 0, tokens: 0 };
  const window = { cost: 0, tokens: 0 };
  const projects = new Map();
  const unpriced = new Set();
  const seen = new Set();

  for (const r of records) {
    if (r.t < windowStart || r.t > now + DAY_MS) continue;
    if (r.key) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
    }
    const cost = r.cost ?? 0;
    if (r.cost == null) unpriced.add(r.model);
    window.cost += cost;
    window.tokens += r.tokens;
    if (r.t >= todayStart) {
      today.cost += cost;
      today.tokens += r.tokens;
    }
    const p = projects.get(r.project) ?? { name: r.project, cost: 0, tokens: 0 };
    p.cost += cost;
    p.tokens += r.tokens;
    projects.set(r.project, p);
  }

  if (window.tokens === 0) return null;
  return {
    today,
    last30Days: window,
    projects: [...projects.values()]
      .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
      .slice(0, TOP_PROJECTS),
    projectCount: projects.size,
    unpricedModels: [...unpriced].sort(),
  };
}

async function collect(roots, parseLine, initialState, now) {
  const since = now - FILE_MAX_AGE_MS;
  const files = (await Promise.all(roots.map((root) => listJsonl(root, since)))).flat();
  const live = new Set(files.map((f) => f.file));
  for (const file of fileCache.keys()) {
    if (roots.some((root) => file.startsWith(root)) && !live.has(file)) fileCache.delete(file);
  }
  const records = [];
  for (const f of files) {
    for (const r of await scanFile(f, parseLine, initialState)) records.push(r);
  }
  return summarize(records, now);
}

function claudeInitialState(file) {
  // Folder names encode the cwd with "-" for separators; the tail is a fair label.
  const dir = path.basename(path.dirname(file));
  const segments = dir.split('-').filter(Boolean);
  return { fallbackProject: segments[segments.length - 1] || 'Unknown' };
}

function codexInitialState() {
  return { sessionId: null, cwd: null, model: null, total: null };
}

let lastResult = null;
let lastAt = 0;
let inFlight = null;

/**
 * @returns {Promise<{ claude: object | null, codex: object | null, updatedAt: string }>}
 *   Each provider summary is null when no log entries fall in the last 30 days.
 */
function getLocalCost() {
  const now = Date.now();
  if (lastResult && now - lastAt < REFRESH_MS) return Promise.resolve(lastResult);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const [claude, codex] = await Promise.all([
        collect(claudeRoots(), parseClaudeLine, claudeInitialState, now),
        collect(codexRoots(), parseCodexLine, codexInitialState, now),
      ]);
      lastResult = { claude, codex, updatedAt: new Date(now).toISOString() };
      lastAt = now;
      return lastResult;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

module.exports = { getLocalCost, parseClaudeLine, parseCodexLine, summarize };
