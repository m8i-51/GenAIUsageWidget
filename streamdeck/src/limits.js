/**
 * Turns a provider's usage payload (the same shape the widget cards read)
 * into the individual limits a key can show.
 */

export const PROVIDERS = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  copilot: 'Copilot',
  gemini: 'Gemini',
  windsurf: 'Windsurf',
  kiro: 'Kiro',
  zai: 'z.ai',
};

function clampPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function windowLimit(id, label, window) {
  return window ? { id, label, percent: clampPercent(window.percent), resetsAt: window.resetsAt ?? null } : null;
}

const ZAI_LABELS = { '5-hour': '5h', Weekly: 'Week' };

const EXTRACTORS = {
  claude: (u) => [
    windowLimit('session', '5h', u.session),
    windowLimit('week', 'Week', u.week),
    u.weekScoped && windowLimit('weekScoped', u.weekScoped.name ? `${u.weekScoped.name} wk` : 'Model wk', u.weekScoped),
  ],
  codex: (u) => [windowLimit('primary', '5h', u.primary), windowLimit('secondary', 'Week', u.secondary)],
  zai: (u) => [
    windowLimit('primary', ZAI_LABELS[u.primary?.label] ?? u.primary?.label ?? '5h', u.primary),
    windowLimit('secondary', ZAI_LABELS[u.secondary?.label] ?? u.secondary?.label ?? 'Week', u.secondary),
    windowLimit('mcp', 'MCP', u.mcp),
  ],
  cursor: (u) => {
    const cycle = { resetsAt: u.billingCycleEnd ?? null };
    const spend = u.apiSpend?.limitCents > 0
      ? { percent: (u.apiSpend.usedCents / u.apiSpend.limitCents) * 100, resetsAt: u.apiSpend.resetsAt }
      : null;
    // The X Subscription is one weekly pool; older plans split Total / Auto / API.
    const plan = u.unified
      ? [windowLimit('total', 'Week', { ...cycle, percent: u.percent })]
      : [
        windowLimit('total', 'Total', { ...cycle, percent: u.percent }),
        windowLimit('auto', 'Auto', { ...cycle, percent: u.autoPercent }),
        windowLimit('api', 'API', { ...cycle, percent: u.apiPercent }),
        windowLimit('grokBot', 'Grok Bot', u.grokBot),
      ];
    return [...plan, windowLimit('apiSpend', 'API $', spend)];
  },
  antigravity: (u) => (u.groups || []).flatMap((g) => (
    g.buckets && g.buckets.length > 0
      ? g.buckets.map((b) => windowLimit(`${g.name}/${b.name}`, b.name, b))
      : [windowLimit(g.name, g.name, g)]
  )),
  copilot: (u) => [windowLimit('primary', 'Premium', u.primary), windowLimit('secondary', 'Chat', u.secondary)],
  gemini: (u) => [windowLimit('primary', 'Pro', u.primary), windowLimit('secondary', 'Flash', u.secondary)],
  windsurf: (u) => (u.kind === 'credits'
    ? [windowLimit('primary', 'Prompts', u.primary), windowLimit('secondary', 'Flow', u.secondary)]
    : [windowLimit('primary', 'Day', u.primary), windowLimit('secondary', 'Week', u.secondary)]),
  kiro: (u) => [
    windowLimit('primary', 'Credits', u.primary),
    windowLimit('secondary', u.secondaryKind ? u.secondaryKind[0].toUpperCase() + u.secondaryKind.slice(1) : 'Bonus', u.secondary),
  ],
};

/**
 * @returns {{ id: string, label: string, percent: number, resetsAt: string | null }[]}
 */
export function listLimits(providerId, usage) {
  const extract = EXTRACTORS[providerId];
  if (!extract || !usage) return [];
  return extract(usage).filter((limit) => limit && limit.percent != null);
}

export function findLimit(providerId, limitId, usage) {
  return listLimits(providerId, usage).find((limit) => limit.id === limitId) ?? null;
}
