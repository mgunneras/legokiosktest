// Electron kiosk shell. Chromium is the right target here: best WebGL + the
// only mainstream runtime with real multi-touch PointerEvents on Linux.
import { app, BrowserWindow, globalShortcut } from 'electron';
import { serve } from './server.js';

// Multi-touch + smooth compositing on a Linux capacitive-touch box.
app.commandLine.appendSwitch('touch-events', 'enabled');
app.commandLine.appendSwitch('enable-features', 'TouchpadAndWheelScrollLatching');
app.commandLine.appendSwitch('disable-pinch');            // no browser-level page zoom
app.commandLine.appendSwitch('overscroll-history-navigation', '0');
app.commandLine.appendSwitch('ignore-gpu-blocklist');


async function boot() {
  const url = await serve(5173, '127.0.0.1');   // kiosk shell stays local
  const win = new BrowserWindow({
    kiosk: true, fullscreen: true, frame: false, backgroundColor: '#11131a',
    autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, enableBlinkFeatures: 'PointerEvent' },
  });
  win.loadURL(url);
  win.webContents.on('before-input-event', (e, i) => {     // lock the kiosk down
    if (i.control || i.meta || i.alt) e.preventDefault();
  });
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());  // service exit
}

app.whenReady().then(boot);
app.on('window-all-closed', () => app.quit());
