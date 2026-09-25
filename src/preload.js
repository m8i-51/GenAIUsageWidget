const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getClaudeUsage: () => ipcRenderer.invoke('get-claude-usage'),
  getCodexUsage: () => ipcRenderer.invoke('get-codex-usage'),
  getCursorUsage: () => ipcRenderer.invoke('get-cursor-usage'),
  getAntigravityUsage: () => ipcRenderer.invoke('get-antigravity-usage'),
  getCopilotUsage: () => ipcRenderer.invoke('get-copilot-usage'),
  getGeminiUsage: () => ipcRenderer.invoke('get-gemini-usage'),
  getWindsurfUsage: () => ipcRenderer.invoke('get-windsurf-usage'),
  getKiroUsage: () => ipcRenderer.invoke('get-kiro-usage'),
  getZaiUsage: () => ipcRenderer.invoke('get-zai-usage'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.invoke('set-settings', partial),
  onSettingsChanged: (cb) => {
    const listener = (_event, settings) => cb(settings);
    ipcRenderer.on('settings-changed', listener);
    return () => ipcRenderer.removeListener('settings-changed', listener);
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getProviderStates: () => ipcRenderer.invoke('get-provider-states'),
  setApiKey: (providerId, key) => ipcRenderer.invoke('set-api-key', providerId, key),
  clearApiKey: (providerId) => ipcRenderer.invoke('clear-api-key', providerId),
  openHomepage: () => ipcRenderer.send('open-homepage'),
  openProviderDashboard: (providerId) => ipcRenderer.send('open-provider-dashboard', providerId),
  openStatusPage: (providerId) => ipcRenderer.send('open-status-page', providerId),
  onServiceStatusChanged: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('service-status-changed', listener);
    return () => ipcRenderer.removeListener('service-status-changed', listener);
  },
  saveWidgetBounds: (bounds) => ipcRenderer.send('save-widget-bounds', bounds),
  resizeTo: (size) => ipcRenderer.send('resize-to', size),
  hideWidgetToEdge: () => ipcRenderer.send('widget-hide-to-edge'),
  showWidgetFromEdge: () => ipcRenderer.send('widget-show-from-edge'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('widget-set-ignore-mouse', !!ignore),
  startWidgetDrag: (point) => ipcRenderer.send('widget-drag-start', point),
  moveWidgetDrag: (point) => ipcRenderer.send('widget-drag-move', point),
  endWidgetDrag: () => ipcRenderer.send('widget-drag-end'),
  onWidgetEdgeHideChanged: (cb) => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('widget-edge-hide-changed', listener);
    return () => ipcRenderer.removeListener('widget-edge-hide-changed', listener);
  },
});
