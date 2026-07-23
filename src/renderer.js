const PROVIDERS = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'antigravity', label: 'Antigravity' },
];

let appSettings = {
  compactMode: false,
  hiddenProviders: [],
  widgetBounds: null,
  widgetEdgeHide: null,
};

const isWidgetMode = document.body.classList.contains('widget-mode');

/** @type {Record<string, boolean>} */
const configuredProviders = Object.fromEntries(PROVIDERS.map((p) => [p.id, false]));

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

function severityClass(percent) {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return '';
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
    widgetEdgeHide: settings.widgetEdgeHide === 'top' ? 'top' : null,
  };
  document.body.classList.toggle('compact-mode', appSettings.compactMode);
  const compactToggle = document.getElementById('compact-mode-toggle');
  if (compactToggle) compactToggle.checked = appSettings.compactMode;
  renderProviderToggles();
  applyHiddenProviders();
}

function applyEdgeHideUi(state) {
  if (!isWidgetMode) return;
  const edge = state?.edge === 'top' ? 'top' : null;
  const expanded = state?.expanded !== false;
  const pinned = !!state?.pinned;
  document.body.classList.toggle('edge-collapsed', !!(edge && !expanded));
  document.body.classList.toggle('edge-top', edge === 'top');
  document.body.classList.toggle('edge-pinned', !!(edge && expanded && pinned));
  document.body.classList.remove('edge-left', 'edge-right');

  const hideBtn = document.getElementById('hide-edge-btn');
  if (!hideBtn) return;
  hideBtn.innerHTML = '&#9650;';
  if (edge && expanded && pinned) {
    hideBtn.title = 'Hide to top edge';
  } else if (edge && !expanded) {
    hideBtn.title = 'Hidden on top — hover to preview, click to open';
  } else if (edge) {
    hideBtn.title = 'Hide to top edge';
  } else {
    hideBtn.title = 'Hide to top edge';
  }
}

function applyHiddenProviders() {
  for (const { id } of PROVIDERS) {
    const tileEl = document.getElementById(`${id}-provider`);
    if (!tileEl || tileEl.dataset.notConfigured === 'true') continue;
    tileEl.hidden = isProviderHidden(id);
  }
  refreshEmptyState();
}

function refreshEmptyState() {
  const anyVisible = document.querySelectorAll('.tile:not([hidden])').length > 0;
  document.getElementById('empty-state').hidden = anyVisible;
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
  if (prefix === 'antigravity' && (lower.includes('401') || lower.includes('cred'))) {
    return 'Run agy login to re-authenticate';
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

function setDetail(prefix, rows) {
  const tileEl = document.getElementById(`${prefix}-provider`);
  const detailEl = document.getElementById(`${prefix}-detail`);

  detailEl.innerHTML = rows.map((row) => {
    const clamped = Math.max(0, Math.min(100, row.percent ?? 0));
    const value = row.percent == null ? '–' : `${Math.round(clamped)}%`;
    return (
      `<div class="detail-row">` +
        `<div class="detail-head">` +
          `<span class="detail-label">${escapeHtml(row.label)}</span>` +
          `<span class="detail-value">${value}</span>` +
        `</div>` +
        `<div class="meter meter-sm ${severityClass(clamped)}"><span class="meter-fill" style="width:${clamped}%"></span></div>` +
        (row.sub ? `<div class="detail-sub">${escapeHtml(row.sub)}</div>` : '') +
      `</div>`
    );
  }).join('');

  tileEl.classList.toggle('has-detail', rows.length > 0);
  if (rows.length === 0) tileEl.classList.remove('expanded');
}

function setMeter(prefix, percent) {
  const barEl = document.getElementById(`${prefix}-bar`);
  const valueEl = document.getElementById(`${prefix}-value`);
  const clamped = Math.max(0, Math.min(100, percent ?? 0));

  barEl.style.width = `${clamped}%`;
  barEl.parentElement.className = `meter ${severityClass(clamped)}`.trim();
  if (valueEl) valueEl.textContent = `${Math.round(clamped)}%`;
}

function beginCard(prefix, result) {
  const tileEl = document.getElementById(`${prefix}-provider`);
  const resetEl = document.getElementById(`${prefix}-reset`);

  if (!result.ok && result.notConfigured) {
    configuredProviders[prefix] = false;
    tileEl.dataset.notConfigured = 'true';
    tileEl.hidden = true;
    tileEl.classList.remove('stale', 'error-state');
    setHint(prefix, null);
    return false;
  }

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

  const rows = [
    { label: 'Session', percent: session.percent, sub: `resets in ${formatCountdown(session.resetsAt)}` },
    { label: 'Weekly', percent: week.percent, sub: `resets in ${formatCountdown(week.resetsAt)}` },
  ];
  if (weekScoped) {
    rows.push({
      label: weekScoped.name ? `Weekly (${weekScoped.name})` : 'Weekly (model-scoped)',
      percent: weekScoped.percent,
      sub: `resets in ${formatCountdown(weekScoped.resetsAt)}`,
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

  setDetail('codex', secondary ? [
    { label: 'Session', percent: primary.percent, sub: `resets in ${formatCountdown(primary.resetsAt)}` },
    { label: 'Weekly', percent: secondary.percent, sub: `resets in ${formatCountdown(secondary.resetsAt)}` },
  ] : []);
}

async function updateCursorCard() {
  const result = await window.api.getCursorUsage();
  if (!beginCard('cursor', result)) return;
  const resetEl = document.getElementById('cursor-reset');

  const { percent, autoPercent, apiPercent, billingCycleEnd } = result.usage;
  setMeter('cursor', percent);
  applyStaleState('cursor', result, resetEl, `cycle ends in ${formatCountdown(billingCycleEnd)}`);

  const rows = [];
  if (autoPercent != null || apiPercent != null) {
    rows.push({ label: 'Total', percent, sub: `cycle ends in ${formatCountdown(billingCycleEnd)}` });
    if (autoPercent != null) rows.push({ label: 'Auto', percent: autoPercent });
    if (apiPercent != null) rows.push({ label: 'API', percent: apiPercent });
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

  const detailRows = [];
  groups.forEach((g) => {
    if (g.buckets && g.buckets.length > 0) {
      g.buckets.forEach((b) => {
        detailRows.push({
          label: `${g.name} (${b.name})`,
          percent: b.percent,
          sub: `resets in ${formatCountdown(b.resetsAt)}`,
        });
      });
    } else {
      detailRows.push({
        label: g.name,
        percent: g.percent,
        sub: g.resetsAt ? `resets in ${formatCountdown(g.resetsAt)}` : null,
      });
    }
  });
  setDetail('antigravity', detailRows);
}

async function updateAll() {
  await Promise.all([
    updateClaudeCard(),
    updateCodexCard(),
    updateCursorCard(),
    updateAntigravityCard(),
  ]);

  refreshEmptyState();
  renderProviderToggles();

  const updatedEl = document.getElementById('last-updated');
  if (updatedEl) {
    const now = new Date();
    updatedEl.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
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

function showSettingsPanel(show) {
  document.getElementById('settings-panel').hidden = !show;
  document.getElementById('cards-view').hidden = show;
}

document.getElementById('settings-btn').addEventListener('click', () => {
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
    window.api.hideWidgetToEdge();
  });
}

if (isWidgetMode) {
  document.addEventListener('mouseenter', () => {
    window.api.setWidgetEdgeHover(true);
  });
  document.addEventListener('mouseleave', () => {
    window.api.setWidgetEdgeHover(false);
  });
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

document.querySelectorAll('.tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    if (tile.classList.contains('has-detail')) {
      tile.classList.toggle('expanded');
    }
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

function tileAfterPoint(y) {
  const tiles = [...containerEl.querySelectorAll('.tile:not(.dragging):not([hidden])')];
  let closest = null;
  let closestOffset = -Infinity;
  for (const tile of tiles) {
    const rect = tile.getBoundingClientRect();
    const offset = y - (rect.top + rect.height / 2);
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
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tile.id);
  });
  tile.addEventListener('dragend', () => {
    tile.classList.remove('dragging');
    saveTileOrder();
  });
});

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

containerEl.addEventListener('dragover', (event) => {
  const dragging = containerEl.querySelector('.tile.dragging');
  if (!dragging) return;
  event.preventDefault();

  const target = tileAfterPoint(event.clientY) ?? emptyStateEl;
  if (target === dragging.nextElementSibling) return;

  const others = [...containerEl.querySelectorAll('.tile:not(.dragging):not([hidden])')];
  const beforeTops = new Map(others.map((tile) => [tile, tile.getBoundingClientRect().top]));

  containerEl.insertBefore(dragging, target);
  if (reducedMotion.matches) return;

  for (const tile of others) {
    const delta = beforeTops.get(tile) - tile.getBoundingClientRect().top;
    if (!delta) continue;
    tile.style.transition = 'none';
    tile.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      tile.style.transition = 'transform 180ms ease';
      tile.style.transform = '';
    });
  }
});

const appEl = document.querySelector('.app');
new ResizeObserver(() => {
  window.api.resizeTo(Math.ceil(appEl.getBoundingClientRect().height) + 12);
}).observe(appEl);

async function init() {
  document.getElementById('provider-toggles').addEventListener('change', onProviderToggleChange);

  const settings = await window.api.getSettings();
  applySettings(settings);
  if (isWidgetMode && settings.widgetEdgeHide) {
    applyEdgeHideUi({ edge: settings.widgetEdgeHide, expanded: false });
  }
  window.api.onSettingsChanged((next) => applySettings(next));
  await updateAll();
  setInterval(updateAll, 60 * 1000);
}

init();
