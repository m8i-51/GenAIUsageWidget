import streamDeck, { SingletonAction } from '@elgato/streamdeck';

import { PROVIDERS, listLimits } from './limits.js';
import { renderKey } from './key-image.js';
import { keyState, DEFAULT_PROVIDER } from './key-state.js';
import { createUsageSource } from './usage-source.js';
import { localFetch, requestLocalRefresh } from './local-fetchers.js';

const POLL_MS = 30 * 1000;
const RESET_VIEW_MS = 10 * 1000;
const LONG_PRESS_MS = 600;

const source = createUsageSource({ localFetch });
/** provider id -> latest payload */
const latest = {};
/** action id -> { settings, view, timer, pressedAt } */
const keys = new Map();
let lastVia = null;
let polling = null;

function language() {
  return streamDeck.info.application.language;
}

function keyFor(action) {
  if (!keys.has(action.id)) keys.set(action.id, { settings: {}, view: 'percent', timer: null, pressedAt: 0 });
  return keys.get(action.id);
}

async function render(action) {
  const key = keyFor(action);
  const state = keyState(key.settings, latest[key.settings.provider || DEFAULT_PROVIDER]);
  const svg = renderKey({ ...state, view: key.view, lang: language() });
  await action.setImage(`data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`);
}

function renderAll() {
  for (const action of usageLimit.actions) {
    render(action).catch((err) => streamDeck.logger.warn(`render failed: ${err.message}`));
  }
}

/** Fetch every provider a visible key needs, then redraw. A call made mid-poll runs right after it. */
function poll(extraProviders = []) {
  if (polling) return polling.then(() => poll(extraProviders));
  const providers = new Set(extraProviders);
  for (const action of usageLimit.actions) providers.add(keyFor(action).settings.provider || DEFAULT_PROVIDER);
  polling = source.get([...providers])
    .then(({ via, results }) => {
      if (via && via !== lastVia) streamDeck.logger.info(`usage source: ${via}`);
      lastVia = via ?? lastVia;
      Object.assign(latest, results);
      renderAll();
      return sendLimitsToInspector();
    })
    .catch((err) => streamDeck.logger.error(`poll failed: ${err.message}`))
    .finally(() => { polling = null; });
  return polling;
}

let inspectorProvider = null;

async function sendLimitsToInspector() {
  const inspector = streamDeck.ui.current;
  if (!inspector || !inspectorProvider) return;
  const payload = latest[inspectorProvider];
  await inspector.sendToPropertyInspector({
    event: 'limits',
    provider: inspectorProvider,
    providers: Object.entries(PROVIDERS).map(([id, label]) => ({ id, label })),
    limits: payload?.ok ? listLimits(inspectorProvider, payload.usage).map(({ id, label }) => ({ id, label })) : [],
    loaded: payload !== undefined,
    via: lastVia,
  });
}

function showView(action, view) {
  const key = keyFor(action);
  clearTimeout(key.timer);
  key.view = view;
  key.timer = view === 'reset' ? setTimeout(() => showView(action, 'percent'), RESET_VIEW_MS) : null;
  render(action).catch(() => {});
}

class UsageLimit extends SingletonAction {
  manifestId = 'com.github.m8i-51.genaiusage.limit';

  onWillAppear(ev) {
    keyFor(ev.action).settings = ev.payload.settings;
    render(ev.action).catch(() => {});
    poll();
  }

  onWillDisappear(ev) {
    clearTimeout(keys.get(ev.action.id)?.timer);
    keys.delete(ev.action.id);
  }

  onDidReceiveSettings(ev) {
    keyFor(ev.action).settings = ev.payload.settings;
    render(ev.action).catch(() => {});
    poll();
  }

  onKeyDown(ev) {
    keyFor(ev.action).pressedAt = Date.now();
  }

  async onKeyUp(ev) {
    const key = keyFor(ev.action);
    if (Date.now() - key.pressedAt >= LONG_PRESS_MS) {
      // Long press: fetch again now, within the same rate-limit floor the widget uses.
      const provider = key.settings.provider || DEFAULT_PROVIDER;
      if (lastVia !== 'widget' && requestLocalRefresh(provider) > 0) {
        await ev.action.showAlert();
        return;
      }
      await poll([provider]);
      await ev.action.showOk();
      return;
    }
    showView(ev.action, key.view === 'reset' ? 'percent' : 'reset');
  }

  async onSendToPlugin(ev) {
    if (ev.payload?.event !== 'getLimits') return;
    inspectorProvider = ev.payload.provider || DEFAULT_PROVIDER;
    await sendLimitsToInspector();
    if (latest[inspectorProvider] === undefined) await poll([inspectorProvider]);
  }
}

const usageLimit = new UsageLimit();
streamDeck.actions.registerAction(usageLimit);
streamDeck.connect();

setInterval(() => { poll(); }, POLL_MS);
