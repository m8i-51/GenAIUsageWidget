const PROVIDERS = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'kiro', label: 'Kiro' },
];

let appSettings = {
  compactMode: false,
  hiddenProviders: [],
  widgetBounds: null,
  widgetEdgeHide: null,
  widgetDockEdge: null,
};

const VALID_DOCK_EDGES = new Set(['left', 'right', 'top', 'bottom']);

const isWidgetMode = document.body.classList.contains('widget-mode');

/** @type {Record<string, boolean>} */
const configuredProviders = Object.fromEntries(PROVIDERS.map((p) => [p.id, false]));

let selectedProvider = null;
/** Local log totals from main's local-cost.js ({ claude, codex } or null). */
let localCost = null;
let settingsOpen = false;
let suppressTileClick = false;

function formatCountdown(isoString) {
  if (!isoString) return 'unknown';
  const diffMs = new Date(isoString).getTime() - Date.now();
  if (diffMs <= 0) return 'now';

  const minutes = Math.floor(diffMs / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatResetLabel(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return 'Resets now';

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60 * 18) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `Resets in ${hours}h ${mins}m`;
    return `Resets in ${mins} min`;
  }

  const weekday = date.toLocaleDateString([], { weekday: 'short' });
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Resets ${weekday} ${time}`;
}

/**
 * One line for a meter's pace forecast (from main's pace.js), or null.
 * @returns {{ text: string, tone: 'limit' | 'safe' } | null}
 */
function formatPace(forecast) {
  if (!forecast) return null;
  if (!forecast.limitAt || !forecast.beforeReset) {
    return { text: 'On pace to last until reset', tone: 'safe' };
  }
  const date = new Date(forecast.limitAt);
  const diffMs = date.getTime() - Date.now();
  if (diffMs < 18 * 60 * 60 * 1000) {
    return { text: `At this pace, limit in ${formatCountdown(forecast.limitAt)}`, tone: 'limit' };
  }
  const weekday = date.toLocaleDateString([], { weekday: 'short' });
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return { text: `At this pace, limit ${weekday} ${time}`, tone: 'limit' };
}

function severityClass(percent) {
  if (percent >= 70) return 'critical';
  if (percent >= 45) return 'warning';
  return 'ok';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function isProviderHidden(prefix) {
  return appSettings.hiddenProviders.includes(prefix);
}

function applySettings(settings) {
  appSettings = {
    compactMode: !!settings.compactMode,
    hiddenProviders: Array.isArray(settings.hiddenProviders) ? [...settings.hiddenProviders] : [],
    widgetBounds: settings.widgetBounds ?? null,
    widgetEdgeHide: VALID_DOCK_EDGES.has(settings.widgetEdgeHide)
      ? settings.widgetEdgeHide
      : null,
    widgetDockEdge: VALID_DOCK_EDGES.has(settings.widgetDockEdge)
      ? settings.widgetDockEdge
      : null,
  };
  document.body.classList.toggle('compact-mode', appSettings.compactMode);
  const compactToggle = document.getElementById('compact-mode-toggle');
  if (compactToggle) compactToggle.checked = appSettings.compactMode;
  syncDockEdgePicker(appSettings.widgetDockEdge || 'auto');
  renderProviderToggles();
  applyHiddenProviders();
  syncFlyout();
}

const DOCK_EDGE_LABELS = {
  auto: 'Auto (nearest edge)',
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
};

function syncDockEdgePicker(value) {
  const next = DOCK_EDGE_LABELS[value] ? value : 'auto';
  const label = document.getElementById('dock-edge-label');
  if (label) label.textContent = DOCK_EDGE_LABELS[next];
  document.querySelectorAll('.dock-edge-option').forEach((btn) => {
    btn.setAttribute('aria-selected', btn.dataset.value === next ? 'true' : 'false');
  });
}

function setDockEdgeMenuOpen(open) {
  const menu = document.getElementById('dock-edge-menu');
  const trigger = document.getElementById('dock-edge-trigger');
  if (!menu || !trigger) return;
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function applyEdgeHideUi(state) {
  if (!isWidgetMode) return;
  const edge = VALID_DOCK_EDGES.has(state?.edge) ? state.edge : null;
  const expanded = state?.expanded !== false;
  const pinned = !!state?.pinned;
  const transitioning = !!state?.transitioning;
  const collapsed = !!(edge && !expanded);
  const wasTransitioning = document.body.classList.contains('edge-transitioning');
  document.body.classList.toggle('edge-collapsed', collapsed);
  document.body.classList.toggle('edge-transitioning', transitioning);
  document.body.classList.toggle('edge-top', edge === 'top');
  document.body.classList.toggle('edge-bottom', edge === 'bottom');
  document.body.classList.toggle('edge-left', edge === 'left');
  document.body.classList.toggle('edge-right', edge === 'right');
  document.body.classList.toggle('edge-pinned', !!(edge && expanded && pinned));
  document.documentElement.classList.toggle('widget-edge-fill', collapsed);

  // Collapsed pill is fully interactive; expanded uses click-through on chrome.
  if (collapsed) {
    setIgnoreMouse(false);
  }

  const hideBtn = document.getElementById('hide-edge-btn');
  const hideIcon = document.getElementById('hide-edge-icon');
  if (hideBtn && hideIcon) {
    // Expanded: chevron points toward the dock (hide). Collapsed: reverse (open).
    if (edge === 'left') {
      hideIcon.innerHTML = expanded
        ? '<path d="M10.5 3 5.5 8 10.5 13"/>'
        : '<path d="M5.5 3 10.5 8 5.5 13"/>';
    } else if (edge === 'right') {
      hideIcon.innerHTML = expanded
        ? '<path d="M5.5 3 10.5 8 5.5 13"/>'
        : '<path d="M10.5 3 5.5 8 10.5 13"/>';
    } else if (edge === 'bottom') {
      hideIcon.innerHTML = expanded
        ? '<path d="M3 5.5 8 10.5 13 5.5"/>'
        : '<path d="M3 10.5 8 5.5 13 10.5"/>';
    } else {
      hideIcon.innerHTML = (edge === 'top' && !expanded)
        ? '<path d="M3 5.5 8 10.5 13 5.5"/>'
        : '<path d="M3 10.5 8 5.5 13 10.5"/>';
    }
    const dockLabel = appSettings.widgetDockEdge
      ? appSettings.widgetDockEdge
      : 'nearest edge';
    const collapsedHint = `Hidden on ${edge} — click to open`;
    hideBtn.title = (edge && !expanded) ? collapsedHint : `Hide to ${dockLabel}`;
    hideBtn.setAttribute('aria-label', (edge && !expanded) ? collapsedHint : `Hide to ${dockLabel}`);
  }

  positionFlyout();
  if (wasTransitioning && !transitioning) {
    requestAnimationFrame(reportSize);
  }
}

function applyHiddenProviders() {
  for (const { id } of PROVIDERS) {
    const tileEl = document.getElementById(`${id}-provider`);
    if (!tileEl || tileEl.dataset.notConfigured === 'true') continue;
    tileEl.hidden = isProviderHidden(id);
  }
  if (selectedProvider && isProviderHidden(selectedProvider)) {
    selectedProvider = null;
  }
  refreshEmptyState();
}

function refreshEmptyState() {
  const anyVisible = document.querySelectorAll('.tile:not([hidden])').length > 0;
  document.getElementById('empty-state').hidden = anyVisible;
  if (!anyVisible) selectedProvider = null;
  syncFlyout();
}

function authHint(prefix, message) {
  const lower = String(message ?? '').toLowerCase();
  if (prefix === 'claude' && (lower.includes('401') || lower.includes('token'))) {
    return 'Run claude login to re-authenticate';
  }
  if (prefix === 'codex' && (lower.includes('401') || lower.includes('auth'))) {
    return 'Run codex login to re-authenticate';
  }
  if (prefix === 'cursor' && lower.includes('token')) {
    return 'Sign in again in the Cursor app';
  }
  if (prefix === 'copilot' && (lower.includes('401') || lower.includes('403') || lower.includes('signed in'))) {
    return 'Run copilot login to re-authenticate';
  }
  if (prefix === 'antigravity' && (lower.includes('401') || lower.includes('cred'))) {
    return 'Run agy login to re-authenticate';
  }
  if (prefix === 'gemini' && (lower.includes('401') || lower.includes('expired') || lower.includes('refresh'))) {
    return 'Run gemini and sign in with Google again';
  }
  if (prefix === 'kiro' && (lower.includes('401') || lower.includes('403') || lower.includes('expired'))) {
    return 'Open Kiro (or run kiro-cli login) to sign in again';
  }
  return null;
}

function setHint(prefix, text) {
  const hintEl = document.getElementById(`${prefix}-hint`);
  if (!hintEl) return;
  if (text) {
    hintEl.textContent = text;
    hintEl.hidden = false;
  } else {
    hintEl.textContent = '';
    hintEl.hidden = true;
  }
}

function clearTileState(prefix) {
  const tileEl = document.getElementById(`${prefix}-provider`);
  tileEl.classList.remove('stale', 'error-state');
  setHint(prefix, null);
}

function applyStaleState(prefix, result, resetEl, baseText) {
  const tileEl = document.getElementById(`${prefix}-provider`);
  tileEl.classList.toggle('stale', !!result.stale);
  tileEl.classList.remove('error-state');
  setHint(prefix, null);

  if (result.stale) {
    const asOf = new Date(result.staleAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    resetEl.textContent = `${baseText}\nas of ${asOf} · retrying`;
    resetEl.title = result.staleError ?? '';
  } else {
    resetEl.textContent = baseText;
    resetEl.removeAttribute('title');
  }
}

// Last drawn width per meter, so a refresh slides each bar from where it was
// (and the first paint fills in from empty) instead of snapping.
const lastMeterWidths = new Map();

function settleMeters(root) {
  root?.querySelectorAll('.meter-fill[data-width]').forEach((fill) => {
    fill.style.width = `${fill.dataset.width}%`;
  });
}

function setDetail(prefix, rows) {
  const detailEl = document.getElementById(`${prefix}-detail`);

  detailEl.innerHTML = rows.map((row, index) => {
    const clamped = Math.max(0, Math.min(100, row.percent ?? 0));
    let used = row.percent == null ? '–' : `${Math.round(clamped)}% Used`;
    if (row.amount) used += ` · ${row.amount}`;
    const reset = row.sub ? escapeHtml(row.sub) : '';
    const pace = formatPace(row.forecast);
    const paceHtml = pace
      ? `<span class="detail-pace pace-${pace.tone}">${escapeHtml(pace.text)}</span>`
      : '';
    return (
      `<div class="detail-row">` +
        `<div class="detail-head">` +
          `<span class="detail-label">${escapeHtml(row.label)}</span>` +
          `<span class="detail-reset">${reset}</span>` +
        `</div>` +
        `<div class="meter ${severityClass(clamped)}"><span class="meter-fill" data-width="${clamped}" style="width:${lastMeterWidths.get(`${prefix}:${index}`) ?? 0}%"></span></div>` +
        `<div class="detail-used"><span>${escapeHtml(used)}</span>${paceHtml}</div>` +
      `</div>`
    );
  }).join('');
  rows.forEach((row, index) => {
    lastMeterWidths.set(`${prefix}:${index}`, Math.max(0, Math.min(100, row.percent ?? 0)));
  });

  detailEl.insertAdjacentHTML('beforeend', costHtml(prefix));

  if (prefix === selectedProvider) syncFlyout();
  // Force a style flush so the start width is committed, then transition.
  void detailEl.offsetWidth;
  settleMeters(detailEl);
  if (prefix === selectedProvider) settleMeters(document.getElementById('flyout-content'));
}

const COST_SOURCES = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
};

function formatUsd(value) {
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(count) {
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(count >= 1e8 ? 0 : 1)}M`;
  if (count >= 1e3) return `${Math.round(count / 1e3)}K`;
  return String(count);
}

/** Today / last-30-days cost block for providers whose CLI keeps local logs. */
function costHtml(prefix) {
  const summary = localCost?.[prefix];
  if (!COST_SOURCES[prefix] || !summary) return '';
  const unpriced = summary.unpricedModels?.length
    ? ` Not priced: ${summary.unpricedModels.join(', ')}.`
    : '';
  const title = `Estimated from local ${COST_SOURCES[prefix]} logs at API list prices. ` +
    `Subscription plans are not billed per token.${unpriced}`;
  const totals = [
    ['Today', summary.today],
    ['30 days', summary.last30Days],
  ].map(([label, t]) => (
    `<div class="cost-total">` +
      `<span class="cost-value">${formatUsd(t.cost)}</span>` +
      `<span class="cost-caption">${label}</span>` +
      `<span class="cost-caption">${formatTokens(t.tokens)} tokens</span>` +
    `</div>`
  )).join('');
  const projects = summary.projects.map((p) => (
    `<div class="cost-project">` +
      `<span class="cost-project-name">${escapeHtml(p.name)}</span>` +
      `<span class="cost-project-value">${formatUsd(p.cost)}</span>` +
    `</div>`
  )).join('');
  const more = summary.projectCount > summary.projects.length
    ? `<div class="cost-more">+${summary.projectCount - summary.projects.length} more projects</div>`
    : '';
  return (
    `<div class="detail-row cost-block" title="${escapeHtml(title)}">` +
      `<div class="detail-head">` +
        `<span class="detail-label">Cost</span>` +
        `<span class="detail-reset">${unpriced ? 'Partial estimate' : 'API-price estimate'}</span>` +
      `</div>` +
      `<div class="cost-totals">${totals}</div>` +
      (projects ? `<div class="cost-projects">${projects}${more}</div>` : '') +
    `</div>`
  );
}

async function updateLocalCost() {
  try {
    localCost = await window.api.getLocalCost();
  } catch {
    localCost = null;
  }
  for (const prefix of Object.keys(COST_SOURCES)) {
    const detailEl = document.getElementById(`${prefix}-detail`);
    if (!detailEl) continue;
    detailEl.querySelector('.cost-block')?.remove();
    detailEl.insertAdjacentHTML('beforeend', costHtml(prefix));
  }
  syncFlyout();
}

function setMeter(prefix, percent) {
  const barEl = document.getElementById(`${prefix}-bar`);
  const valueEl = document.getElementById(`${prefix}-value`);
  const ring = barEl?.closest('.ring');
  const clamped = Math.max(0, Math.min(100, percent ?? 0));

  if (barEl) {
    barEl.style.strokeDasharray = `${clamped} 100`;
    // A round cap draws a dot even at 0%; hide the arc until there is usage.
    barEl.style.opacity = clamped > 0 ? '1' : '0';
  }
  if (ring) {
    ring.classList.remove('ok', 'warning', 'critical');
    ring.classList.add(severityClass(clamped));
  }
  if (valueEl) countTo(valueEl, Math.round(clamped));
}

const RING_ANIM_MS = 800;

/** Count the ring label up/down in step with the ring's CSS transition. */
function countTo(el, target) {
  const from = el.dataset.value === undefined ? 0 : Number(el.dataset.value);
  el.dataset.value = String(target);
  cancelAnimationFrame(Number(el.dataset.anim) || 0);
  if (!Number.isFinite(from) || from === target
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = `${target}%`;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / RING_ANIM_MS);
    const eased = 1 - (1 - t) ** 4;
    el.textContent = `${Math.round(from + (target - from) * eased)}%`;
    if (t < 1) el.dataset.anim = String(requestAnimationFrame(step));
  };
  el.dataset.anim = String(requestAnimationFrame(step));
}

/**
 * Status-page incident for this provider (attached by main as
 * result.serviceStatus): a dot on the ring and a clickable line in the card.
 */
function applyServiceStatus(prefix, result) {
  const tileEl = document.getElementById(`${prefix}-provider`);
  const incidentEl = document.getElementById(`${prefix}-incident`);
  const ringEl = tileEl.querySelector('.ring-item');
  const status = result.serviceStatus;

  if (!status || status.level === 'none') {
    delete tileEl.dataset.status;
    if (ringEl) ringEl.removeAttribute('title');
    if (incidentEl) {
      incidentEl.hidden = true;
      incidentEl.innerHTML = '';
    }
    return;
  }

  tileEl.dataset.status = status.level;
  const summary = status.title ? `${status.label}: ${status.title}` : status.label;
  if (ringEl) ringEl.title = summary;
  if (incidentEl) {
    incidentEl.className = `tile-incident status-${status.level}`;
    incidentEl.title = `Open ${status.url}`;
    incidentEl.innerHTML =
      `<span class="incident-mark"></span>` +
      `<span><span class="incident-label">${escapeHtml(status.label)}</span>` +
      (status.title ? ` <span class="incident-title">${escapeHtml(status.title)}</span>` : '') +
      `</span>`;
    incidentEl.hidden = false;
  }
}

function beginCard(prefix, result) {
  const tileEl = document.getElementById(`${prefix}-provider`);
  const resetEl = document.getElementById(`${prefix}-reset`);

  if (!result.ok && result.notConfigured) {
    configuredProviders[prefix] = false;
    tileEl.dataset.notConfigured = 'true';
    tileEl.hidden = true;
    tileEl.classList.remove('stale', 'error-state', 'selected');
    setHint(prefix, null);
    if (selectedProvider === prefix) selectedProvider = null;
    return false;
  }

  // Before the error check: an outage is most useful exactly when usage fails.
  applyServiceStatus(prefix, result);
  configuredProviders[prefix] = true;
  tileEl.dataset.notConfigured = 'false';
  tileEl.hidden = isProviderHidden(prefix);
  resetEl.classList.remove('error');
  clearTileState(prefix);

  if (!result.ok) {
    setError(prefix, result.error);
    setDetail(prefix, []);
    return false;
  }
  return true;
}

function setError(prefix, message) {
  const tileEl = document.getElementById(`${prefix}-provider`);
  const resetEl = document.getElementById(`${prefix}-reset`);
  resetEl.textContent = `Error: ${message}`;
  resetEl.title = message;
  resetEl.classList.add('error');
  tileEl.classList.add('error-state');
  tileEl.classList.remove('stale');
  setHint(prefix, authHint(prefix, message));
}

function firstVisibleProvider() {
  const tile = containerEl.querySelector('.tile:not([hidden])');
  return tile ? tile.dataset.provider : null;
}

function isEdgeCollapsed() {
  return document.body.classList.contains('edge-collapsed');
}

function revealFromEdgeIfCollapsed() {
  if (isWidgetMode && isEdgeCollapsed()) {
    window.api.showWidgetFromEdge();
  }
}

function closeFlyout() {
  selectedProvider = null;
  settingsOpen = false;
  const settings = document.getElementById('settings-panel');
  if (settings) settings.hidden = true;
  syncFlyout();
}

function selectProvider(id, { toggle = true } = {}) {
  if (!isWidgetMode) return;
  if (toggle && selectedProvider === id) {
    selectedProvider = null;
  } else {
    selectedProvider = id;
  }
  syncFlyout();
}

function syncPanelOpen() {
  const panel = document.getElementById('panel');
  const flyout = document.getElementById('flyout');
  const settings = document.getElementById('settings-panel');
  const open = isWidgetMode && ((flyout && !flyout.hidden) || (settings && !settings.hidden));
  panel.classList.toggle('open', !!open);
}

function syncFlyout() {
  const flyout = document.getElementById('flyout');
  const content = document.getElementById('flyout-content');
  if (!flyout || !content) return;

  document.querySelectorAll('.tile').forEach((tile) => {
    tile.classList.toggle('selected', tile.dataset.provider === selectedProvider);
  });

  if (!isWidgetMode || settingsOpen || !selectedProvider) {
    flyout.hidden = true;
    content.innerHTML = '';
    syncPanelOpen();
    return;
  }

  const tile = document.getElementById(`${selectedProvider}-provider`);
  if (!tile || tile.hidden) {
    flyout.hidden = true;
    content.innerHTML = '';
    syncPanelOpen();
    return;
  }

  const provider = PROVIDERS.find((p) => p.id === selectedProvider);
  const icon = tile.querySelector('.ring-icon')?.innerHTML ?? '';
  const detail = document.getElementById(`${selectedProvider}-detail`)?.innerHTML ?? '';
  const resetEl = document.getElementById(`${selectedProvider}-reset`);
  const hintEl = document.getElementById(`${selectedProvider}-hint`);
  const updated = document.getElementById('last-updated')?.textContent ?? '';
  const isError = tile.classList.contains('error-state');
  const isStale = tile.classList.contains('stale');
  const incidentEl = document.getElementById(`${selectedProvider}-incident`);
  const incident = incidentEl && !incidentEl.hidden
    ? incidentEl.outerHTML.replace(/\sid="[^"]*"/, '')
    : '';

  let body;
  if (isError) {
    body = `<div class="flyout-error">${escapeHtml(resetEl?.textContent || 'Error')}</div>`;
    if (hintEl && !hintEl.hidden && hintEl.textContent) {
      body += `<div class="tile-hint">${escapeHtml(hintEl.textContent)}</div>`;
    }
  } else if (detail) {
    body = detail;
    if (isStale && resetEl?.textContent) {
      body += `<div class="tile-sub">${escapeHtml(resetEl.textContent)}</div>`;
    }
  } else {
    body = `<div class="flyout-empty">${escapeHtml(resetEl?.textContent || '')}</div>`;
  }

  content.innerHTML =
    `<div class="flyout-head">${icon}<span>${escapeHtml(provider.label)} Usage</span></div>` +
    body +
    incident +
    (updated ? `<div class="flyout-updated">${escapeHtml(updated)}</div>` : '');

  flyout.hidden = false;
  syncPanelOpen();
  requestAnimationFrame(positionFlyout);
}

function positionFlyout() {
  if (!isWidgetMode) return;
  const flyout = document.getElementById('flyout');
  const panel = document.getElementById('panel');
  const notch = document.getElementById('notch');
  if (!flyout || flyout.hidden || !selectedProvider || !notch) return;

  const ring = document.querySelector(`#${selectedProvider}-provider .ring`);
  if (!ring) return;

  const ringBox = ring.getBoundingClientRect();
  const notchBox = notch.getBoundingClientRect();
  const horizontalDock = document.body.classList.contains('edge-top')
    || document.body.classList.contains('edge-bottom');

  flyout.style.marginTop = '0px';
  flyout.style.marginLeft = '0px';

  if (horizontalDock) {
    const desired = (ringBox.left + ringBox.width / 2) - notchBox.left - (flyout.offsetWidth / 2);
    const clamped = Math.max(0, desired);
    flyout.style.marginLeft = `${Math.round(clamped)}px`;
    const pointerX = (ringBox.left + ringBox.width / 2) - (panel.getBoundingClientRect().left + clamped);
    panel.style.setProperty('--pointer-offset', `${Math.round(pointerX)}px`);
  } else {
    const desired = (ringBox.top + ringBox.height / 2) - notchBox.top - (flyout.offsetHeight / 2);
    const clamped = Math.max(0, desired);
    flyout.style.marginTop = `${Math.round(clamped)}px`;
    const pointerY = (ringBox.top + ringBox.height / 2) - (notchBox.top + clamped);
    panel.style.setProperty('--pointer-offset', `${Math.round(pointerY)}px`);
  }
}

async function updateClaudeCard() {
  const result = await window.api.getClaudeUsage();
  if (!beginCard('claude', result)) return;
  const resetEl = document.getElementById('claude-reset');

  const { session, week, weekScoped } = result.usage;
  setMeter('claude', session.percent);
  const baseText =
    `Session ${session.percent}% (resets in ${formatCountdown(session.resetsAt)})\n` +
    `Week ${week.percent}% (resets in ${formatCountdown(week.resetsAt)})`;
  applyStaleState('claude', result, resetEl, baseText);

  const forecasts = result.forecasts ?? {};
  const rows = [
    { label: 'Current session', percent: session.percent, sub: formatResetLabel(session.resetsAt), forecast: forecasts.session },
    { label: 'All models', percent: week.percent, sub: formatResetLabel(week.resetsAt), forecast: forecasts.week },
  ];
  if (weekScoped) {
    rows.push({
      label: weekScoped.name ? `Weekly (${weekScoped.name})` : 'Weekly (model-scoped)',
      percent: weekScoped.percent,
      sub: formatResetLabel(weekScoped.resetsAt),
      forecast: forecasts.weekScoped,
    });
  }
  setDetail('claude', rows);
}

async function updateCodexCard() {
  const result = await window.api.getCodexUsage();
  if (!beginCard('codex', result)) return;
  const resetEl = document.getElementById('codex-reset');

  const { primary, secondary } = result.usage;
  if (!primary) {
    resetEl.textContent = 'No rate limit data';
    setDetail('codex', []);
    return;
  }

  setMeter('codex', primary.percent);
  applyStaleState('codex', result, resetEl, `resets in ${formatCountdown(primary.resetsAt)}`);

  const forecasts = result.forecasts ?? {};
  const rows = [
    { label: 'Current session', percent: primary.percent, sub: formatResetLabel(primary.resetsAt), forecast: forecasts.primary },
  ];
  if (secondary) {
    rows.push({ label: 'Weekly', percent: secondary.percent, sub: formatResetLabel(secondary.resetsAt), forecast: forecasts.secondary });
  }
  setDetail('codex', rows);
}

function formatCopilotPlan(plan) {
  if (!plan) return '';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

async function updateCopilotCard() {
  const result = await window.api.getCopilotUsage();
  if (!beginCard('copilot', result)) return;
  const resetEl = document.getElementById('copilot-reset');

  const { primary, secondary, plan } = result.usage;
  const planLabel = formatCopilotPlan(plan);
  if (!primary && !secondary) {
    resetEl.textContent = planLabel ? `${planLabel} · No quota data` : 'No quota data';
    setDetail('copilot', []);
    return;
  }

  const headline = primary ?? secondary;
  setMeter('copilot', headline.percent);
  const planPrefix = planLabel ? `${planLabel} · ` : '';
  applyStaleState('copilot', result, resetEl, `${planPrefix}resets in ${formatCountdown(headline.resetsAt)}`);

  const forecasts = result.forecasts ?? {};
  const rows = [];
  if (primary) {
    rows.push({ label: 'Premium', percent: primary.percent, sub: formatResetLabel(primary.resetsAt), forecast: forecasts.primary });
  }
  if (secondary) {
    rows.push({ label: 'Chat', percent: secondary.percent, sub: formatResetLabel(secondary.resetsAt), forecast: forecasts.secondary });
  }
  setDetail('copilot', rows);
}

function formatPlanPrefix(plan) {
  if (!plan) return '';
  const words = String(plan).toLowerCase().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return `${words.join(' ')} · `;
}

function formatCredits(window) {
  if (window?.used == null || window?.limit == null) return '';
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${fmt(window.used)} / ${fmt(window.limit)}`;
}

async function updateWindsurfCard() {
  const result = await window.api.getWindsurfUsage();
  if (!beginCard('windsurf', result)) return;
  const resetEl = document.getElementById('windsurf-reset');

  const { primary, secondary, kind, plan } = result.usage;
  const planPrefix = formatPlanPrefix(plan);
  if (!primary && !secondary) {
    resetEl.textContent = `${planPrefix}No quota data`;
    setDetail('windsurf', []);
    return;
  }

  const headline = primary ?? secondary;
  setMeter('windsurf', headline.percent);
  applyStaleState('windsurf', result, resetEl, `${planPrefix}resets in ${formatCountdown(headline.resetsAt)}`);

  const credits = kind === 'credits';
  const forecasts = result.forecasts ?? {};
  const rows = [];
  if (primary) {
    rows.push({
      label: credits ? 'Prompt credits' : 'Daily',
      amount: credits ? formatCredits(primary) : '',
      percent: primary.percent,
      sub: formatResetLabel(primary.resetsAt),
      forecast: forecasts.primary,
    });
  }
  if (secondary) {
    rows.push({
      label: credits ? 'Flow actions' : 'Weekly',
      amount: credits ? formatCredits(secondary) : '',
      percent: secondary.percent,
      sub: formatResetLabel(secondary.resetsAt),
      forecast: forecasts.secondary,
    });
  }
  setDetail('windsurf', rows);
}

async function updateKiroCard() {
  const result = await window.api.getKiroUsage();
  if (!beginCard('kiro', result)) return;
  const resetEl = document.getElementById('kiro-reset');

  const { primary, secondary, secondaryKind, plan } = result.usage;
  const planPrefix = formatPlanPrefix(plan);
  if (!primary) {
    resetEl.textContent = `${planPrefix}No credit data`;
    setDetail('kiro', []);
    return;
  }

  setMeter('kiro', primary.percent);
  applyStaleState('kiro', result, resetEl, `${planPrefix}resets in ${formatCountdown(primary.resetsAt)}`);

  const forecasts = result.forecasts ?? {};
  const rows = [
    {
      label: 'Monthly credits',
      amount: formatCredits(primary),
      percent: primary.percent,
      sub: formatResetLabel(primary.resetsAt),
      forecast: forecasts.primary,
    },
  ];
  if (secondary) {
    const bonus = secondaryKind === 'bonus';
    rows.push({
      label: bonus ? 'Bonus credits' : 'Overage credits',
      amount: formatCredits(secondary),
      percent: secondary.percent,
      // Bonus credits expire rather than reset.
      sub: bonus && secondary.resetsAt
        ? `Expires in ${formatCountdown(secondary.resetsAt)}`
        : formatResetLabel(secondary.resetsAt),
      forecast: forecasts.secondary,
    });
  }
  setDetail('kiro', rows);
}

async function updateCursorCard() {
  const result = await window.api.getCursorUsage();
  if (!beginCard('cursor', result)) return;
  const resetEl = document.getElementById('cursor-reset');

  const { percent, autoPercent, apiPercent, billingCycleEnd, grokBot } = result.usage;
  setMeter('cursor', percent);
  applyStaleState('cursor', result, resetEl, `cycle ends in ${formatCountdown(billingCycleEnd)}`);

  const forecasts = result.forecasts ?? {};
  const rows = [
    { label: 'Total', percent, sub: formatResetLabel(billingCycleEnd), forecast: forecasts.total },
  ];
  if (autoPercent != null) rows.push({ label: 'Auto', percent: autoPercent });
  if (apiPercent != null) rows.push({ label: 'API', percent: apiPercent });
  if (grokBot?.percent != null) {
    rows.push({
      label: 'Grok Bot',
      percent: grokBot.percent,
      sub: formatResetLabel(grokBot.resetsAt),
      forecast: forecasts.grokBot,
    });
  }
  setDetail('cursor', rows);
}

async function updateAntigravityCard() {
  const result = await window.api.getAntigravityUsage();
  if (!beginCard('antigravity', result)) return;
  const resetEl = document.getElementById('antigravity-reset');

  const { groups } = result.usage;
  if (!groups || groups.length === 0) {
    resetEl.textContent = 'No quota data';
    setDetail('antigravity', []);
    return;
  }

  const allBuckets = groups.flatMap((g) => g.buckets ?? []);
  const maxPercent = allBuckets.length > 0 ? Math.max(...allBuckets.map((b) => b.percent ?? 0)) : 0;
  setMeter('antigravity', maxPercent);

  const groupSummaries = groups.map((g) => {
    const groupMax = g.buckets && g.buckets.length > 0 ? Math.max(...g.buckets.map((b) => b.percent ?? 0)) : 0;
    return `${g.name} ${groupMax}%`;
  });
  applyStaleState('antigravity', result, resetEl, groupSummaries.join('\n'));
  resetEl.style.webkitLineClamp = String(groups.length);

  const forecasts = result.forecasts ?? {};
  const detailRows = [];
  groups.forEach((g) => {
    if (g.buckets && g.buckets.length > 0) {
      g.buckets.forEach((b) => {
        detailRows.push({
          label: `${g.name} (${b.name})`,
          percent: b.percent,
          sub: formatResetLabel(b.resetsAt),
          forecast: forecasts[`${g.name}/${b.name}`],
        });
      });
    } else {
      detailRows.push({
        label: g.name,
        percent: g.percent,
        sub: g.resetsAt ? formatResetLabel(g.resetsAt) : null,
        forecast: forecasts[g.name],
      });
    }
  });
  setDetail('antigravity', detailRows);
}

async function updateGeminiCard() {
  const result = await window.api.getGeminiUsage();
  if (!beginCard('gemini', result)) return;
  const resetEl = document.getElementById('gemini-reset');

  const { primary, secondary, plan } = result.usage;
  const planPrefix = formatPlanPrefix(plan);
  if (!primary && !secondary) {
    resetEl.textContent = `${planPrefix}No quota data`;
    setDetail('gemini', []);
    return;
  }

  const headline = primary ?? secondary;
  setMeter('gemini', headline.percent);
  applyStaleState('gemini', result, resetEl, `${planPrefix}resets in ${formatCountdown(headline.resetsAt)}`);

  const forecasts = result.forecasts ?? {};
  const rows = [];
  if (primary) {
    rows.push({ label: 'Pro', percent: primary.percent, sub: formatResetLabel(primary.resetsAt), forecast: forecasts.primary });
  }
  if (secondary) {
    rows.push({ label: 'Flash', percent: secondary.percent, sub: formatResetLabel(secondary.resetsAt), forecast: forecasts.secondary });
  }
  setDetail('gemini', rows);
}

async function updateAll() {
  // Log scanning can take a moment on first run; cards do not wait for it.
  updateLocalCost();
  await Promise.all([
    updateClaudeCard(),
    updateCodexCard(),
    updateCopilotCard(),
    updateCursorCard(),
    updateAntigravityCard(),
    updateGeminiCard(),
    updateWindsurfCard(),
    updateKiroCard(),
  ]);

  refreshEmptyState();
  renderProviderToggles();

  const updatedEl = document.getElementById('last-updated');
  if (updatedEl) {
    const now = new Date();
    updatedEl.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  syncFlyout();
}

function renderProviderToggles() {
  const container = document.getElementById('provider-toggles');
  if (!container) return;

  container.innerHTML = PROVIDERS.map(({ id, label }) => {
    const configured = configuredProviders[id];
    const visible = configured && !isProviderHidden(id);
    const disabledAttr = configured ? '' : 'disabled';
    const note = configured ? '' : '<span class="provider-toggle-note">Not set up</span>';
    return (
      `<label class="settings-row provider-toggle${configured ? '' : ' disabled'}">` +
        `<span>${escapeHtml(label)}${note}</span>` +
        `<input type="checkbox" data-provider="${id}" ${visible ? 'checked' : ''} ${disabledAttr} />` +
      `</label>`
    );
  }).join('');
}

async function onProviderToggleChange(event) {
  const input = event.target.closest('input[data-provider]');
  if (!input || input.disabled) return;

  const providerId = input.dataset.provider;
  const hidden = new Set(appSettings.hiddenProviders);
  if (input.checked) {
    hidden.delete(providerId);
  } else {
    hidden.add(providerId);
  }
  const settings = await window.api.setSettings({ hiddenProviders: [...hidden] });
  applySettings(settings);
  await updateAll();
}

function placeSettingsPanel() {
  const settings = document.getElementById('settings-panel');
  const panel = document.getElementById('panel');
  const notch = document.getElementById('notch');
  if (!settings || !panel || !notch) return;
  if (isWidgetMode) {
    panel.appendChild(settings);
  } else {
    notch.appendChild(settings);
  }
}

function showSettingsPanel(show) {
  settingsOpen = !!show;
  const settings = document.getElementById('settings-panel');
  const cards = document.getElementById('cards-view');
  settings.hidden = !show;

  if (isWidgetMode) {
    cards.hidden = false;
    if (show) {
      document.getElementById('flyout').hidden = true;
      setIgnoreMouse(false);
    }
    syncPanelOpen();
    if (!show) syncFlyout();
    refreshIgnoreMouse();
  } else {
    cards.hidden = show;
    document.getElementById('panel').classList.remove('open');
  }
}

document.getElementById('settings-btn').addEventListener('click', (event) => {
  event.stopPropagation();
  revealFromEdgeIfCollapsed();
  showSettingsPanel(true);
  renderProviderToggles();
});

document.getElementById('settings-back-btn').addEventListener('click', () => {
  showSettingsPanel(false);
});

const hideEdgeBtn = document.getElementById('hide-edge-btn');
if (hideEdgeBtn) {
  hideEdgeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeFlyout();
    if (isEdgeCollapsed()) {
      window.api.showWidgetFromEdge();
      return;
    }
    requestAnimationFrame(() => window.api.hideWidgetToEdge());
  });
}

if (isWidgetMode) {
  const peekTab = document.getElementById('edge-peek-tab');
  if (peekTab) {
    peekTab.addEventListener('click', (event) => {
      event.stopPropagation();
      window.api.showWidgetFromEdge();
    });
  }
  window.api.onWidgetEdgeHideChanged((state) => applyEdgeHideUi(state));
}

document.getElementById('compact-mode-toggle').addEventListener('change', async (event) => {
  const settings = await window.api.setSettings({ compactMode: event.target.checked });
  applySettings(settings);
});

const dockEdgeTrigger = document.getElementById('dock-edge-trigger');
const dockEdgeMenu = document.getElementById('dock-edge-menu');
if (dockEdgeTrigger && dockEdgeMenu) {
  dockEdgeTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setDockEdgeMenuOpen(dockEdgeMenu.hidden);
  });
  dockEdgeMenu.addEventListener('click', async (event) => {
    const option = event.target.closest('.dock-edge-option');
    if (!option) return;
    event.stopPropagation();
    const value = option.dataset.value || 'auto';
    setDockEdgeMenuOpen(false);
    syncDockEdgePicker(value);
    const settings = await window.api.setSettings({
      widgetDockEdge: value === 'auto' ? null : value,
    });
    applySettings(settings);
  });
  document.addEventListener('click', () => setDockEdgeMenuOpen(false));
}

// Card and flyout incident lines open that provider's status page.
document.addEventListener('click', (event) => {
  const target = event.target.closest?.('[data-status-provider]');
  if (!target) return;
  event.stopPropagation();
  window.api.openStatusPage(target.dataset.statusProvider);
}, true);

document.querySelectorAll('.tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    if (suppressTileClick) {
      suppressTileClick = false;
      return;
    }
    if (!isWidgetMode) return;
    if (tile.hidden || tile.dataset.notConfigured === 'true') return;
    const collapsed = isEdgeCollapsed();
    revealFromEdgeIfCollapsed();
    selectProvider(tile.dataset.provider, { toggle: !collapsed });
  });
});

const TILE_ORDER_KEY = 'tileOrder';
const containerEl = document.getElementById('cards-view');
const emptyStateEl = document.getElementById('empty-state');

function applyTileOrder(order) {
  order.forEach((prefix) => {
    const tile = document.getElementById(`${prefix}-provider`);
    if (tile) containerEl.insertBefore(tile, emptyStateEl);
  });
}

function saveTileOrder() {
  const order = [...containerEl.querySelectorAll('.tile')]
    .map((tile) => tile.id.replace('-provider', ''));
  localStorage.setItem(TILE_ORDER_KEY, JSON.stringify(order));
}

function loadTileOrder(raw) {
  try {
    const order = JSON.parse(raw);
    if (Array.isArray(order)) applyTileOrder(order);
  } catch {
    // Ignore malformed saved order.
  }
}

loadTileOrder(localStorage.getItem(TILE_ORDER_KEY));

window.addEventListener('storage', (event) => {
  if (event.key === TILE_ORDER_KEY) loadTileOrder(event.newValue);
});

function tileAfterPoint(clientX, clientY) {
  const tiles = [...containerEl.querySelectorAll('.tile:not(.dragging):not([hidden])')];
  const horizontalDock = document.body.classList.contains('edge-top')
    || document.body.classList.contains('edge-bottom');
  let closest = null;
  let closestOffset = -Infinity;
  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();
    const mid = horizontalDock ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    const offset = (horizontalDock ? clientX : clientY) - mid;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = tile;
    }
  }
  return closest;
}

document.querySelectorAll('.tile').forEach((tile) => {
  tile.draggable = true;
  tile.addEventListener('dragstart', (event) => {
    tile.classList.add('dragging');
    suppressTileClick = true;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tile.id);
  });
  tile.addEventListener('dragend', () => {
    tile.classList.remove('dragging');
    saveTileOrder();
    setTimeout(() => { suppressTileClick = false; }, 0);
  });
});

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

containerEl.addEventListener('dragover', (event) => {
  const dragging = containerEl.querySelector('.tile.dragging');
  if (!dragging) return;
  event.preventDefault();

  const target = tileAfterPoint(event.clientX, event.clientY) ?? emptyStateEl;
  if (target === dragging.nextElementSibling) return;

  const others = [...containerEl.querySelectorAll('.tile:not(.dragging):not([hidden])')];
  const horizontalDock = document.body.classList.contains('edge-top')
    || document.body.classList.contains('edge-bottom');
  const before = new Map(others.map((tile) => {
    const rect = tile.getBoundingClientRect();
    return [tile, horizontalDock ? rect.left : rect.top];
  }));

  containerEl.insertBefore(dragging, target);
  if (reducedMotion.matches) return;

  for (const tile of others) {
    const rect = tile.getBoundingClientRect();
    const now = horizontalDock ? rect.left : rect.top;
    const delta = before.get(tile) - now;
    if (!delta) continue;
    tile.style.transition = 'none';
    tile.style.transform = horizontalDock ? `translateX(${delta}px)` : `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      tile.style.transition = 'transform 180ms ease';
      tile.style.transform = '';
    });
  }
});

const appEl = document.querySelector('.app');

function reportSize() {
  if (isEdgeCollapsed() || document.body.classList.contains('edge-transitioning')) return;
  const rect = appEl.getBoundingClientRect();
  let padX = 20;
  let padY = 20;
  if (document.body.classList.contains('edge-left') || document.body.classList.contains('edge-right')) {
    padX = 10;
    padY = 0;
  }
  if (document.body.classList.contains('edge-top') || document.body.classList.contains('edge-bottom')) {
    padY = 10;
  }
  window.api.resizeTo({
    width: Math.min(640, Math.ceil(rect.width) + padX),
    height: Math.min(900, Math.ceil(rect.height) + padY),
  });
}

new ResizeObserver(reportSize).observe(appEl);

let ignoringMouse = true;
let lastMouse = { x: 0, y: 0 };
let windowDragging = false;
let dragCandidate = null;
const DRAG_THRESHOLD_PX = 4;

function setIgnoreMouse(ignore) {
  if (!isWidgetMode) return;
  if (windowDragging) return;
  if (ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  window.api.setIgnoreMouseEvents(ignore);
}

function isOverInteractive(el) {
  if (!el) return false;
  return !!el.closest('.notch, .flyout, .edge-peek-tab, #settings-panel');
}

function syncIgnoreMouseFromPoint(clientX, clientY) {
  if (!isWidgetMode) return;
  lastMouse = { x: clientX, y: clientY };
  const el = document.elementFromPoint(clientX, clientY);
  setIgnoreMouse(!isOverInteractive(el));
}

function refreshIgnoreMouse() {
  if (!isWidgetMode) return;
  syncIgnoreMouseFromPoint(lastMouse.x, lastMouse.y);
}

function isWidgetDragSource(target) {
  if (!target || !target.closest) return false;
  if (target.closest('button, input, a, label, .dock-edge-picker, .flyout')) return false;
  return !!target.closest('.notch');
}

function endWindowDrag() {
  if (!windowDragging && !dragCandidate) return;
  dragCandidate = null;
  if (windowDragging) {
    windowDragging = false;
    window.api.endWidgetDrag();
    refreshIgnoreMouse();
  }
}

if (isWidgetMode) {
  document.addEventListener('mousemove', (event) => {
    if (windowDragging) {
      window.api.moveWidgetDrag({ screenX: event.screenX, screenY: event.screenY });
      return;
    }
    if (dragCandidate) {
      const dx = event.screenX - dragCandidate.screenX;
      const dy = event.screenY - dragCandidate.screenY;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        windowDragging = true;
        suppressTileClick = true;
        setIgnoreMouse(false);
        window.api.startWidgetDrag({
          screenX: dragCandidate.screenX,
          screenY: dragCandidate.screenY,
        });
        window.api.moveWidgetDrag({ screenX: event.screenX, screenY: event.screenY });
        dragCandidate = null;
      }
      return;
    }
    syncIgnoreMouseFromPoint(event.clientX, event.clientY);
  }, { passive: true });

  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (isOverInteractive(event.target)) setIgnoreMouse(false);
    if (!isWidgetDragSource(event.target)) return;
    dragCandidate = { screenX: event.screenX, screenY: event.screenY };
  }, true);

  document.addEventListener('mouseup', () => endWindowDrag(), true);
  document.addEventListener('mouseleave', () => {
    if (!windowDragging) setIgnoreMouse(true);
  }, { passive: true });
  window.addEventListener('blur', () => endWindowDrag());
}

async function init() {
  placeSettingsPanel();
  document.getElementById('provider-toggles').addEventListener('change', onProviderToggleChange);

  const settings = await window.api.getSettings();
  applySettings(settings);
  if (isWidgetMode && settings.widgetEdgeHide) {
    applyEdgeHideUi({ edge: settings.widgetEdgeHide, expanded: false });
  }
  window.api.onSettingsChanged((next) => applySettings(next));
  window.api.onServiceStatusChanged(() => updateAll());
  await updateAll();
  if (isWidgetMode && !selectedProvider && !isEdgeCollapsed()) {
    const first = firstVisibleProvider();
    if (first) selectProvider(first, { toggle: false });
  }
  setInterval(updateAll, 60 * 1000);
}

init();
