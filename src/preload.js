const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getClaudeUsage: () => ipcRenderer.invoke('get-claude-usage'),
  getCodexUsage: () => ipcRenderer.invoke('get-codex-usage'),
  getCursorUsage: () => ipcRenderer.invoke('get-cursor-usage'),
  getAntigravityUsage: () => ipcRenderer.invoke('get-antigravity-usage'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.invoke('set-settings', partial),
  onSettingsChanged: (cb) => {
    const listener = (_event, settings) => cb(settings);
    ipcRenderer.on('settings-changed', listener);
    return () => ipcRenderer.removeListener('settings-changed', listener);
  },
  saveWidgetBounds: (bounds) => ipcRenderer.send('save-widget-bounds', bounds),
  resizeTo: (height) => ipcRenderer.send('resize-to', height),
  hideWidgetToEdge: () => ipcRenderer.send('widget-hide-to-edge'),
  showWidgetFromEdge: () => ipcRenderer.send('widget-show-from-edge'),
  setWidgetEdgeHover: (hovering) => ipcRenderer.send('widget-edge-hide-hover', !!hovering),
  onWidgetEdgeHideChanged: (cb) => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('widget-edge-hide-changed', listener);
    return () => ipcRenderer.removeListener('widget-edge-hide-changed', listener);
  },
});
