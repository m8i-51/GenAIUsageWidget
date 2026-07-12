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
});
