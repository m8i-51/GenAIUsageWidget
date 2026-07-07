const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getClaudeUsage: () => ipcRenderer.invoke('get-claude-usage'),
  getCodexUsage: () => ipcRenderer.invoke('get-codex-usage'),
  getCursorUsage: () => ipcRenderer.invoke('get-cursor-usage'),
  getAntigravityUsage: () => ipcRenderer.invoke('get-antigravity-usage'),
});
