// Public API list prices in USD per million tokens, used to estimate what local
// Claude Code / Codex usage would cost at pay-as-you-go rates. Checked 2026-09-25
// against Anthropic's model docs and OpenAI's pricing page; update as prices move.

// Claude: cache writes cost 1.25x input (5-minute TTL) or 2x (1-hour TTL);
// cache reads cost 0.1x input unless listed.
const CLAUDE = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
};

// OpenAI: cached input is listed per model (usually 0.1x input).
const OPENAI = {
  'gpt-6-astra': { input: 5, cachedInput: 0.5, output: 25 },
  'gpt-6-sol': { input: 1, cachedInput: 0.1, output: 5 },
  'gpt-6-luna': { input: 0.05, cachedInput: 0.005, output: 0.25 },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, output: 20 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14 },
  'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'codex-mini-latest': { input: 1.5, cachedInput: 0.375, output: 6 },
};

function normalize(model) {
  return String(model)
    .toLowerCase()
    .replace(/^(anthropic|openai)[./]/, '')
    .replace(/\[.*\]$/, '')
    .replace(/-v\d+(:\d+)?$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

function lookup(table, model, suffixes) {
  let id = normalize(model);
  if (table[id]) return table[id];
  // "gpt-5.1-codex-max" is priced as "gpt-5.1", "claude-sonnet-4-5-thinking" as its base.
  for (const suffix of suffixes) {
    if (id.endsWith(suffix)) {
      id = id.slice(0, -suffix.length);
      if (table[id]) return table[id];
    }
  }
  return null;
}

const PER_TOKEN = 1e-6;

/**
 * @param {{ input: number, output: number, cacheRead: number, cacheWrite5m: number, cacheWrite1h: number }} t
 * @returns {number | null} USD, or null when the model is not in the table
 */
function priceClaude(model, t, { fast = false } = {}) {
  const p = lookup(CLAUDE, model, ['-thinking']);
  if (!p) return null;
  const cacheRead = p.cacheRead ?? p.input * 0.1;
  const usd = (
    t.input * p.input
    + t.output * p.output
    + t.cacheRead * cacheRead
    + t.cacheWrite5m * p.input * 1.25
    + t.cacheWrite1h * p.input * 2
  ) * PER_TOKEN;
  // Fast mode bills at twice the standard rate.
  return fast ? usd * 2 : usd;
}

/**
 * @param {{ input: number, cached: number, output: number }} t
 *   input includes cached; output includes reasoning tokens.
 * @returns {number | null}
 */
function priceOpenAI(model, t) {
  const p = lookup(OPENAI, model, ['-codex-max', '-codex-mini', '-codex', '-chat-latest']);
  if (!p) return null;
  return (
    (t.input - t.cached) * p.input
    + t.cached * p.cachedInput
    + t.output * p.output
  ) * PER_TOKEN;
}

module.exports = { priceClaude, priceOpenAI };
