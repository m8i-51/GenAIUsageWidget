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

function setMeter(prefix, percent) {
  const barEl = document.getElementById(`${prefix}-bar`);
  const valueEl = document.getElementById(`${prefix}-value`);
  const clamped = Math.max(0, Math.min(100, percent ?? 0));

  barEl.style.width = `${clamped}%`;
  barEl.className = `meter-fill ${severityClass(clamped)}`.trim();
  if (valueEl) valueEl.textContent = `${Math.round(clamped)}%`;
}

function setError(prefix, message) {
  const resetEl = document.getElementById(`${prefix}-reset`);
  resetEl.textContent = `Error: ${message}`;
  resetEl.classList.add('error');
}

async function updateClaudeCard() {
  const resetEl = document.getElementById('claude-reset');
  resetEl.classList.remove('error');

  const result = await window.api.getClaudeUsage();
  if (!result.ok) {
    setError('claude', result.error);
    return;
  }

  const { session, week } = result.usage;
  setMeter('claude', session.percent);
  resetEl.textContent =
    `Session ${session.percent}% (resets in ${formatCountdown(session.resetsAt)}) · ` +
    `Week ${week.percent}% (resets in ${formatCountdown(week.resetsAt)})`;
}

async function updateCodexCard() {
  const resetEl = document.getElementById('codex-reset');
  resetEl.classList.remove('error');

  const result = await window.api.getCodexUsage();
  if (!result.ok) {
    setError('codex', result.error);
    return;
  }

  const { primary } = result.usage;
  if (!primary) {
    resetEl.textContent = 'No rate limit data';
    return;
  }

  setMeter('codex', primary.percent);
  resetEl.textContent = `resets in ${formatCountdown(primary.resetsAt)}`;
}

async function updateCursorCard() {
  const resetEl = document.getElementById('cursor-reset');
  resetEl.classList.remove('error');

  const result = await window.api.getCursorUsage();
  if (!result.ok) {
    setError('cursor', result.error);
    return;
  }

  const { percent, billingCycleEnd } = result.usage;
  setMeter('cursor', percent);
  resetEl.textContent = `cycle ends in ${formatCountdown(billingCycleEnd)}`;
}

async function updateAntigravityCard() {
  const resetEl = document.getElementById('antigravity-reset');
  resetEl.classList.remove('error');

  const result = await window.api.getAntigravityUsage();
  if (!result.ok) {
    setError('antigravity', result.error);
    return;
  }

  const { groups } = result.usage;
  if (!groups || groups.length === 0) {
    resetEl.textContent = 'No quota data';
    return;
  }

  const maxPercent = Math.max(...groups.map((g) => g.percent ?? 0));
  setMeter('antigravity', maxPercent);
  resetEl.textContent = groups
    .map((g) => `${g.name} ${g.percent}% (resets in ${formatCountdown(g.resetsAt)})`)
    .join(' · ');
}

async function updateAll() {
  await Promise.all([
    updateClaudeCard(),
    updateCodexCard(),
    updateCursorCard(),
    updateAntigravityCard(),
  ]);

  const updatedEl = document.getElementById('last-updated');
  if (updatedEl) {
    const now = new Date();
    updatedEl.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}

updateAll();
setInterval(updateAll, 60 * 1000);
