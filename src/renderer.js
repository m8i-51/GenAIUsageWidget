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

// rows: [{ label, percent, sub }] — rendered as the tile's expanded detail.
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
  // Severity colors both the fill and the faint track behind it.
  barEl.parentElement.className = `meter ${severityClass(clamped)}`.trim();
  if (valueEl) valueEl.textContent = `${Math.round(clamped)}%`;
}

// Returns true when the card should stay visible (configured provider),
// false when the provider isn't set up on this machine and the card is hidden.
function beginCard(prefix, result) {
  const tileEl = document.getElementById(`${prefix}-provider`);
  const hidden = !result.ok && result.notConfigured;
  tileEl.hidden = hidden;
  if (hidden) return false;

  const resetEl = document.getElementById(`${prefix}-reset`);
  resetEl.classList.remove('error');
  if (!result.ok) {
    setError(prefix, result.error);
    setDetail(prefix, []);
    return false;
  }
  return true;
}

function setError(prefix, message) {
  const resetEl = document.getElementById(`${prefix}-reset`);
  resetEl.textContent = `Error: ${message}`;
  // The sub line is clamped to two lines; keep the full message reachable.
  resetEl.title = message;
  resetEl.classList.add('error');
}

async function updateClaudeCard() {
  const result = await window.api.getClaudeUsage();
  if (!beginCard('claude', result)) return;
  const resetEl = document.getElementById('claude-reset');

  const { session, week, weekScoped } = result.usage;
  setMeter('claude', session.percent);
  resetEl.textContent =
    `Session ${session.percent}% (resets in ${formatCountdown(session.resetsAt)})\n` +
    `Week ${week.percent}% (resets in ${formatCountdown(week.resetsAt)})`;

  // On a transient fetch failure the main process serves the last good
  // snapshot; keep showing it, but say when it's from.
  const tileEl = document.getElementById('claude-provider');
  tileEl.classList.toggle('stale', !!result.stale);
  if (result.stale) {
    const asOf = new Date(result.staleAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    resetEl.textContent += `\nlast fetched ${asOf} (retrying)`;
    resetEl.title = result.staleError ?? '';
  } else {
    resetEl.removeAttribute('title');
  }

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
  resetEl.textContent = `resets in ${formatCountdown(primary.resetsAt)}`;

  // Only worth expanding when there's a second window; a lone primary
  // window is already fully shown by the summary.
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
  resetEl.textContent = `cycle ends in ${formatCountdown(billingCycleEnd)}`;

  // Total / Auto / API — only worth expanding when the breakdown exists.
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
  resetEl.textContent = groupSummaries.join('\n');
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

  const anyVisible = document.querySelectorAll('.tile:not([hidden])').length > 0;
  document.getElementById('empty-state').hidden = anyVisible;

  const updatedEl = document.getElementById('last-updated');
  if (updatedEl) {
    const now = new Date();
    updatedEl.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}

// Click a card to expand/collapse its detail rows.
document.querySelectorAll('.tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    if (tile.classList.contains('has-detail')) {
      tile.classList.toggle('expanded');
    }
  });
});

// --- Drag & drop reordering (persisted, shared by popup and widget) ---

const TILE_ORDER_KEY = 'tileOrder';
const containerEl = document.querySelector('.app');
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
    // Ignore a malformed saved order; the default DOM order stands.
  }
}

loadTileOrder(localStorage.getItem(TILE_ORDER_KEY));

// Mirror reorders done in the other window (popup vs widget).
window.addEventListener('storage', (event) => {
  if (event.key === TILE_ORDER_KEY) loadTileOrder(event.newValue);
});

// Among visible tiles not being dragged, find the first one whose middle
// is below the pointer — the dragged tile is inserted before it.
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
  if (target === dragging.nextElementSibling) return; // already in place

  // FLIP: measure the other tiles, reorder, then animate them from their
  // old positions so they glide out of the way instead of jumping.
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

// Keep the window hugging the card, so the transparent leftover area
// doesn't block mouse clicks on what's behind it.
const appEl = document.querySelector('.app');
new ResizeObserver(() => {
  window.api.resizeTo(Math.ceil(appEl.getBoundingClientRect().height) + 12);
}).observe(appEl);

updateAll();
setInterval(updateAll, 60 * 1000);
