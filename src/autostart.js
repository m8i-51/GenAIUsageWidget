const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AUTOSTART_DESKTOP_PATH = path.join(os.homedir(), '.config', 'autostart', 'genai-usage-widget.desktop');

// AppImages re-exec from a temp mount point on every launch, so process.execPath
// isn't stable across runs. $APPIMAGE (set by the AppImage runtime) points at the
// original file and is what a desktop autostart entry should point to instead.
function linuxExecPath() {
  return process.env.APPIMAGE || process.execPath;
}

function isEnabled() {
  if (process.platform === 'win32') {
    return app.getLoginItemSettings().openAtLogin;
  }
  if (process.platform === 'linux') {
    return fs.existsSync(AUTOSTART_DESKTOP_PATH);
  }
  return false;
}

function setEnabled(enabled) {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return;
  }
  if (process.platform === 'linux') {
    if (enabled) {
      fs.mkdirSync(path.dirname(AUTOSTART_DESKTOP_PATH), { recursive: true });
      const desktopEntry = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=GenAIUsageWidget',
        `Exec=${linuxExecPath()}`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n');
      fs.writeFileSync(AUTOSTART_DESKTOP_PATH, desktopEntry);
    } else {
      fs.rmSync(AUTOSTART_DESKTOP_PATH, { force: true });
    }
  }
}

module.exports = { isEnabled, setEnabled };
