// Launch an isolated copy of the current interface for screenshot capture.
// Usage: electron portfolio/launch.cjs <absolute demo-video path>
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
app.setPath('userData', path.resolve(__dirname, '../../_work/portfolio-user-data'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({ width: 1600, height: 1000, backgroundColor: '#14161a', title: 'ClipEasy AI — Portfolio Demo', webPreferences: { backgroundThrottling: false } });
  window.loadURL(`http://127.0.0.1:5173/portfolio/?video=${encodeURIComponent(process.argv[2] || path.resolve(__dirname, '../../_work/portfolio/city-demo.mp4'))}`);
});
app.on('window-all-closed', () => app.quit());
