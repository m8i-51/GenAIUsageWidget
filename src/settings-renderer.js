// Settings window. Everything here is saved through the main process, which
// broadcasts the change to the tray popup and desktop widget.

const PROVIDERS = [
  { id: 'claude', label: 'Claude', how: 'Claude Code (claude login)' },
  { id: 'codex', label: 'Codex', how: 'Codex CLI (codex login)' },
  { id: 'copilot', label: 'Copilot', how: 'GitHub Copilot CLI (copilot login)' },
  { id: 'cursor', label: 'Cursor', how: 'Cursor app' },
  { id: 'antigravity', label: 'Antigravity', how: 'Antigravity CLI (agy login)' },
  { id: 'gemini', label: 'Gemini', how: 'Gemini CLI (Sign in with Google)' },
  { id: 'windsurf', label: 'Windsurf', how: 'Windsurf app' },
  { id: 'kiro', label: 'Kiro', how: 'Kiro IDE or kiro-cli login' },
];

const KEY_PROVIDERS = [
  { id: 'zai', label: 'z.ai', how: 'GLM Coding Plan' },
];

const ICONS = {
  claude: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.05 10.80L12.70 2.40A0.7 0.7 0 0 0 11.30 2.40L10.95 10.80ZM13.54 11.59L17.17 5.59A0.7 0.7 0 0 0 16.01 4.81L11.80 10.42ZM13.56 12.31L20.32 8.01A0.7 0.7 0 0 0 19.62 6.79L12.51 10.49ZM13.12 13.13L19.73 13.24A0.7 0.7 0 0 0 19.83 11.85L13.27 11.04ZM12.51 13.51L20.14 17.51A0.7 0.7 0 0 0 20.84 16.29L13.56 11.69ZM11.58 13.54L15.05 19.86A0.7 0.7 0 0 0 16.31 19.24L13.47 12.62ZM10.95 13.20L11.30 21.00A0.7 0.7 0 0 0 12.70 21.00L13.05 13.20ZM10.46 12.41L6.95 18.24A0.7 0.7 0 0 0 8.11 19.02L12.20 13.58ZM10.44 11.69L3.34 16.19A0.7 0.7 0 0 0 4.04 17.41L11.49 13.51ZM10.88 10.87L3.47 10.70A0.7 0.7 0 0 0 3.37 12.10L10.73 12.96ZM11.49 10.49L4.38 6.79A0.7 0.7 0 0 0 3.68 8.01L10.44 12.31ZM12.42 10.46L9.30 4.86A0.7 0.7 0 0 0 8.04 5.48L10.53 11.38ZM12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4Z"/></svg>',
  codex: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7.2 5.4A5.2 5.2 0 0 1 16.6 6a4.7 4.7 0 0 1 3.7 7.9 4.6 4.6 0 0 1-4.1 6.4H7.5A5 5 0 0 1 3.4 12.4a4.8 4.8 0 0 1 3.8-7Zm.9 6.1a.9.9 0 0 0-.2 1.3l1.6 1.6-1.6 1.6a.9.9 0 1 0 1.3 1.3l2.2-2.2a1 1 0 0 0 0-1.4l-2.2-2.2a.9.9 0 0 0-1.1 0Zm4.4 4.6a.9.9 0 0 0 0 1.8h3.3a.9.9 0 0 0 0-1.8Z"/></svg>',
  copilot: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3.1" y="3.6" width="7.6" height="6.4" rx="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13.3" y="3.6" width="7.6" height="6.4" rx="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill-rule="evenodd" d="M3.6 12.2c1 .5 2 .7 3 .7h2.6c1.2 0 2.2-.4 2.8-1 .6.6 1.6 1 2.8 1h2.6c1 0 2-.2 3-.7v4c0 1-.5 1.9-1.4 2.4-2 1.2-4.3 1.9-7 1.9s-5-.7-7-1.9c-.9-.5-1.4-1.4-1.4-2.4Zm5.7 2.1c-.6 0-1 .4-1 1v1.3c0 .6.4 1 1 1s1-.4 1-1v-1.3c0-.6-.4-1-1-1Zm5.4 0c-.6 0-1 .4-1 1v1.3c0 .6.4 1 1 1s1-.4 1-1v-1.3c0-.6-.4-1-1-1Z"/></svg>',
  cursor: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.2 2.4 20.6 12.2l-8.4 2.2 1.8 8.2Z"/></svg>',
  antigravity: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8c-3 0-5 3.9-6.6 8.9-.9 2.9-1.8 5.4-2.9 7-.6.9 0 2.2 1.2 2.2 1.9 0 3-2.8 4-5.6.8-2.1 2-3.6 4.3-3.6s3.5 1.5 4.3 3.6c1 2.8 2.1 5.6 4 5.6 1.2 0 1.8-1.3 1.2-2.2-1.1-1.6-2-4.1-2.9-7C17 6.7 15 2.8 12 2.8Z"/></svg>',
  gemini: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22A11.9 11.9 0 0 0 2 12 11.9 11.9 0 0 0 12 2a11.9 11.9 0 0 0 10 10 11.9 11.9 0 0 0-10 10Z"/></svg>',
  windsurf: '<svg viewBox="115 122 780 780" fill="currentColor" aria-hidden="true"><path d="M897.246 286.869H889.819C850.735 286.808 819.017 318.46 819.017 357.539V515.589C819.017 547.15 792.93 572.716 761.882 572.716C743.436 572.716 725.02 563.433 714.093 547.85L552.673 317.304C539.28 298.16 517.486 286.747 493.895 286.747C457.094 286.747 423.976 318.034 423.976 356.657V515.619C423.976 547.181 398.103 572.746 366.842 572.746C348.335 572.746 329.949 563.463 319.021 547.881L138.395 289.882C134.316 284.038 125.154 286.93 125.154 294.052V431.892C125.154 438.862 127.285 445.619 131.272 451.34L309.037 705.2C319.539 720.204 335.033 731.344 352.9 735.392C397.616 745.557 438.77 711.135 438.77 667.278V508.406C438.77 476.845 464.339 451.279 495.904 451.279H495.995C515.02 451.279 532.857 460.562 543.785 476.145L705.235 706.661C718.659 725.835 739.327 737.218 763.983 737.218C801.606 737.218 833.841 705.9 833.841 667.308V508.376C833.841 476.815 859.41 451.249 890.975 451.249H897.276C901.233 451.249 904.43 448.053 904.43 444.097V294.021C904.43 290.065 901.233 286.869 897.276 286.869H897.246Z"/></svg>',
  kiro: '<svg viewBox="5 7 38 38" fill="currentColor" aria-hidden="true"><path transform="translate(0 48) scale(0.1 -0.1)" d="M175 367c-25-25-35-45-40-83-3-27-10-59-16-72-15-37-11-63 10-69 12-3 21-15 23-32 2-20 9-27 30-29 15-2 36 2 48 8 13 7 20 7 20 0 0-13 36-13 62 1 32 17 58 86 58 157 0 103-38 152-118 152-36 0-50-6-77-33zm93-86c3-16-1-22-10-19-7 3-15 15-16 27-3 16 1 22 10 19 7-3 15-15 16-27zm52 4c0-26-14-33-25-15-9 14 1 40 15 40 5 0 10-11 10-25z"/></svg>',
  zai: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5.2 3.6h13.6c.7 0 1.1.8.7 1.4L9.6 17.6h9.2a1.4 1.4 0 0 1 0 2.8H5.2c-.7 0-1.1-.8-.7-1.4l9.9-12.6H5.2a1.4 1.4 0 0 1 0-2.8Z"/></svg>',
};

let settings = {};
let states = {};
let appInfo = {};
const editing = new Set();
const keyErrors = {};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function iconHtml(provider) {
  return `<span class="provider-icon">${ICONS[provider.id] ?? escapeHtml(provider.label.charAt(0))}</span>`;
}

function statusBadge(state) {
  if (!state) return '<span class="badge">Checking…</span>';
  if (!state.configured) return '<span class="badge">Not set up</span>';
  if (state.error) return `<span class="badge error" title="${escapeHtml(state.error)}">Error</span>`;
  return '<span class="badge on">Connected</span>';
}

function renderLocalProviders() {
  const hidden = new Set(settings.hiddenProviders ?? []);
  $('local-providers').innerHTML = PROVIDERS.map((p) => {
    const state = states[p.id];
    const configured = !!state?.configured;
    return (
      `<label class="row">` +
        iconHtml(p) +
        `<div class="row-text">` +
          `<div class="row-title">${escapeHtml(p.label)} ${statusBadge(state)}</div>` +
          `<div class="row-sub">${escapeHtml(p.how)}</div>` +
        `</div>` +
        `<input type="checkbox" class="switch" data-show="${p.id}" aria-label="Show ${escapeHtml(p.label)}"` +
          `${configured && !hidden.has(p.id) ? ' checked' : ''}${configured ? '' : ' disabled'} />` +
      `</label>`
    );
  }).join('');
}

function keyStorageNote() {
  if (appInfo.keyStorage === 'basic') {
    return '<div class="note warn">No system keyring was found, so the key is only obfuscated on disk. Install GNOME Keyring or KWallet for real encryption.</div>';
  }
  if (appInfo.keyStorage === 'none') {
    return '<div class="note error">Secure storage is not available on this system, so a key cannot be saved.</div>';
  }
  return '<div class="note">The key is encrypted with your OS keystore and never leaves this machine except to call z.ai.</div>';
}

function renderKeyProviders() {
  const hidden = new Set(settings.hiddenProviders ?? []);
  $('key-providers').innerHTML = KEY_PROVIDERS.map((p) => {
    const state = states[p.id];
    const hasKey = !!state?.hasApiKey;
    const configured = !!state?.configured;
    const showForm = !hasKey || editing.has(p.id);
    const region = settings.zaiRegion === 'cn' ? 'cn' : 'global';
    const error = keyErrors[p.id] ? `<div class="note error">${escapeHtml(keyErrors[p.id])}</div>` : '';

    const keyArea = showForm
      ? `<form class="key-form" data-key-form="${p.id}">` +
          `<input type="password" name="key" placeholder="Paste your API key" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(p.label)} API key" />` +
          `<button type="submit" class="btn primary">Save</button>` +
          (hasKey ? `<button type="button" class="btn" data-cancel-key="${p.id}">Cancel</button>` : '') +
        `</form>`
      : `<div class="key-saved">` +
          `<span class="key-dots">••••••••••••</span>` +
          `<button type="button" class="btn" data-edit-key="${p.id}">Replace</button>` +
          `<button type="button" class="btn danger" data-clear-key="${p.id}">Remove</button>` +
        `</div>`;

    return (
      `<label class="row">` +
        iconHtml(p) +
        `<div class="row-text">` +
          `<div class="row-title">${escapeHtml(p.label)} ${statusBadge(state)}</div>` +
          `<div class="row-sub">${escapeHtml(p.how)}</div>` +
        `</div>` +
        `<input type="checkbox" class="switch" data-show="${p.id}" aria-label="Show ${escapeHtml(p.label)}"` +
          `${configured && !hidden.has(p.id) ? ' checked' : ''}${configured ? '' : ' disabled'} />` +
      `</label>` +
      `<div class="row key-panel"><div class="row-text">` +
        keyArea +
        error +
        `<div class="field-row">` +
          `<label>Region</label>` +
          `<div class="segmented" role="group" aria-label="z.ai region">` +
            `<button type="button" data-region="global" aria-pressed="${region === 'global'}" title="api.z.ai">Global</button>` +
            `<button type="button" data-region="cn" aria-pressed="${region === 'cn'}" title="open.bigmodel.cn">China (BigModel)</button>` +
          `</div>` +
        `</div>` +
        keyStorageNote() +
        `<div class="note">Get a key from <button type="button" class="link" data-dashboard="${p.id}">your z.ai account</button>.</div>` +
      `</div></div>`
    );
  }).join('');
}

function renderGeneral() {
  $('compactMode').checked = !!settings.compactMode;
  $('widgetDockEdge').value = settings.widgetDockEdge || 'auto';
  $('alertsEnabled').checked = settings.alertsEnabled !== false;
  $('leftoverAlertsEnabled').checked = settings.leftoverAlertsEnabled !== false;
  $('serviceStatusEnabled').checked = settings.serviceStatusEnabled !== false;
}

function renderProviders() {
  renderLocalProviders();
  renderKeyProviders();
}

async function refreshStates() {
  const list = await window.api.getProviderStates();
  states = Object.fromEntries(list.map((s) => [s.id, s]));
  renderProviders();
}

async function save(partial) {
  settings = await window.api.setSettings(partial);
  renderGeneral();
  renderProviders();
}

function selectTab(name) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  });
  document.querySelectorAll('section[role="tabpanel"]').forEach((section) => {
    section.hidden = section.id !== `tab-${name}`;
  });
}

document.querySelector('nav').addEventListener('click', (event) => {
  const btn = event.target.closest('.nav-item');
  if (btn) selectTab(btn.dataset.tab);
});

$('autostart').addEventListener('change', async (event) => {
  event.target.checked = await window.api.setAutostart(event.target.checked);
});

for (const id of ['compactMode', 'alertsEnabled', 'leftoverAlertsEnabled', 'serviceStatusEnabled']) {
  $(id).addEventListener('change', (event) => save({ [id]: event.target.checked }));
}

$('widgetDockEdge').addEventListener('change', (event) => {
  save({ widgetDockEdge: event.target.value === 'auto' ? null : event.target.value });
});

$('open-repo').addEventListener('click', () => window.api.openHomepage());

const providersEl = $('tab-providers');

providersEl.addEventListener('change', (event) => {
  const input = event.target.closest('input[data-show]');
  if (!input) return;
  const hidden = new Set(settings.hiddenProviders ?? []);
  if (input.checked) hidden.delete(input.dataset.show);
  else hidden.add(input.dataset.show);
  save({ hiddenProviders: [...hidden] });
});

providersEl.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-key-form]');
  if (!form) return;
  event.preventDefault();
  const id = form.dataset.keyForm;
  const key = form.elements.key.value.trim();
  if (!key) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    await window.api.setApiKey(id, key);
    delete keyErrors[id];
    editing.delete(id);
    // Show the new provider even if it had been hidden before.
    if ((settings.hiddenProviders ?? []).includes(id)) {
      await save({ hiddenProviders: settings.hiddenProviders.filter((p) => p !== id) });
    }
  } catch (err) {
    keyErrors[id] = String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  await refreshStates();
});

providersEl.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.region) {
    event.preventDefault();
    await save({ zaiRegion: target.dataset.region });
    await refreshStates();
  } else if (target.dataset.editKey) {
    event.preventDefault();
    editing.add(target.dataset.editKey);
    renderProviders();
    providersEl.querySelector(`form[data-key-form="${target.dataset.editKey}"] input`)?.focus();
  } else if (target.dataset.cancelKey) {
    event.preventDefault();
    editing.delete(target.dataset.cancelKey);
    delete keyErrors[target.dataset.cancelKey];
    renderProviders();
  } else if (target.dataset.clearKey) {
    event.preventDefault();
    await window.api.clearApiKey(target.dataset.clearKey);
    await refreshStates();
  } else if (target.dataset.dashboard) {
    event.preventDefault();
    window.api.openProviderDashboard(target.dataset.dashboard);
  }
});

window.api.onSettingsChanged((next) => {
  settings = next;
  renderGeneral();
  renderProviders();
});

// The tray menu can change login and provider state while this window is open.
window.addEventListener('focus', async () => {
  $('autostart').checked = await window.api.getAutostart();
  refreshStates();
});

async function init() {
  [settings, appInfo] = await Promise.all([window.api.getSettings(), window.api.getAppInfo()]);
  $('autostart').checked = await window.api.getAutostart();
  $('app-version').textContent = `Version ${appInfo.version}`;
  renderGeneral();
  renderProviders();
  await refreshStates();
}

init();
