import streamDeck, { SingletonAction } from '@elgato/streamdeck';

import { PROVIDERS, listLimits } from './limits.js';
import { renderKey } from './key-image.js';
import { keyState, closestState, DEFAULT_PROVIDER } from './key-state.js';
import { createUsageSource } from './usage-source.js';
import { localFetch, requestLocalRefresh } from './local-fetchers.js';

const POLL_MS = 30 * 1000;
const RESET_VIEW_MS = 10 * 1000;
const LONG_PRESS_MS = 600;
const PROVIDER_IDS = Object.keys(PROVIDERS);

const source = createUsageSource({ localFetch });
/** provider id -> latest payload */
const latest = {};
/** action id -> { settings, view, timer, pressedAt } */
const keys = new Map();
let lastVia = null;
let polling = null;

function keyFor(action) {
  if (!keys.has(action.id)) keys.set(action.id, { settings: {}, view: 'percent', timer: null, pressedAt: 0 });
  return keys.get(action.id);
}

/**
 * Shared key behavior: draw the state, press for the reset countdown, hold to refresh.
 * Subclasses say which providers a key needs and what it shows.
 */
class UsageKeyAction extends SingletonAction {
  providersFor() {
    return [];
  }

  stateFor() {
    return null;
  }

  async render(action) {
    const key = keyFor(action);
    const state = this.stateFor(key.settings);
    const svg = renderKey({ ...state, view: key.view, lang: streamDeck.info.application.language });
    await action.setImage(`data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`);
  }

  showView(action, view) {
    const key = keyFor(action);
    clearTimeout(key.timer);
    key.view = view;
    key.timer = view === 'reset' ? setTimeout(() => this.showView(action, 'percent'), RESET_VIEW_MS) : null;
    this.render(action).catch(() => {});
  }

  onWillAppear(ev) {
    keyFor(ev.action).settings = ev.payload.settings;
    this.render(ev.action).catch(() => {});
    poll();
  }

  onWillDisappear(ev) {
    clearTimeout(keys.get(ev.action.id)?.timer);
    keys.delete(ev.action.id);
  }

  onDidReceiveSettings(ev) {
    keyFor(ev.action).settings = ev.payload.settings;
    this.render(ev.action).catch(() => {});
    poll();
  }

  onKeyDown(ev) {
    keyFor(ev.action).pressedAt = Date.now();
  }

  async onKeyUp(ev) {
    const key = keyFor(ev.action);
    if (Date.now() - key.pressedAt < LONG_PRESS_MS) {
      this.showView(ev.action, key.view === 'reset' ? 'percent' : 'reset');
      return;
    }
    // Long press: fetch again now, within the same rate-limit floor the widget uses.
    const providers = this.providersFor(key.settings);
    if (lastVia !== 'widget' && providers.map(requestLocalRefresh).every((waitMs) => waitMs > 0)) {
      await ev.action.showAlert();
      return;
    }
    await poll(providers);
    await ev.action.showOk();
  }
}

class UsageLimit extends UsageKeyAction {
  manifestId = 'com.github.m8i-51.genaiusage.limit';

  providersFor(settings) {
    return [settings.provider || DEFAULT_PROVIDER];
  }

  stateFor(settings) {
    return keyState(settings, latest[settings.provider || DEFAULT_PROVIDER]);
  }

  async onSendToPlugin(ev) {
    if (ev.payload?.event !== 'getLimits') return;
    inspectorProvider = ev.payload.provider || DEFAULT_PROVIDER;
    await sendLimitsToInspector();
    if (latest[inspectorProvider] === undefined) await poll([inspectorProvider]);
  }
}

class ClosestLimit extends UsageKeyAction {
  manifestId = 'com.github.m8i-51.genaiusage.closest';

  providersFor(settings) {
    const excluded = new Set(settings.exclude ?? []);
    return PROVIDER_IDS.filter((id) => !excluded.has(id));
  }

  stateFor(settings) {
    return closestState(settings, latest, PROVIDER_IDS);
  }
}

const actions = [new UsageLimit(), new ClosestLimit()];

function renderAll() {
  for (const handler of actions) {
    for (const action of handler.actions) {
      handler.render(action).catch((err) => streamDeck.logger.warn(`render failed: ${err.message}`));
    }
  }
}

/** Fetch every provider a visible key needs, then redraw. A call made mid-poll runs right after it. */
function poll(extraProviders = []) {
  if (polling) return polling.then(() => poll(extraProviders));
  const providers = new Set(extraProviders);
  for (const handler of actions) {
    for (const action of handler.actions) {
      for (const id of handler.providersFor(keyFor(action).settings)) providers.add(id);
    }
  }
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
  // v2 removed streamDeck.ui.current; the open inspector's action is streamDeck.ui.action.
  const action = streamDeck.ui.action;
  if (!action || !inspectorProvider || action.manifestId !== actions[0].manifestId) return;
  const payload = latest[inspectorProvider];
  await streamDeck.ui.sendToPropertyInspector({
    event: 'limits',
    provider: inspectorProvider,
    providers: Object.entries(PROVIDERS).map(([id, label]) => ({ id, label })),
    limits: payload?.ok ? listLimits(inspectorProvider, payload.usage).map(({ id, label }) => ({ id, label })) : [],
    loaded: payload !== undefined,
    via: lastVia,
  });
}

for (const handler of actions) streamDeck.actions.registerAction(handler);
streamDeck.connect();

setInterval(() => { poll(); }, POLL_MS);
