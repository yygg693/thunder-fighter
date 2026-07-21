// 打飞机 · Fighter Shooter — Electron 主进程
// 只加载本地 index.html（file://），无任何网络请求 / 下载 / 外部代码执行。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function resolveGameDir() {
  const packed = path.join(process.resourcesPath, 'game', 'index.html');
  if (fs.existsSync(packed)) return path.join(process.resourcesPath, 'game');
  return path.join(__dirname, '..');
}

function createWindow() {
  const gameDir = resolveGameDir();
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    backgroundColor: '#05060f',
    title: '打飞机 · Fighter Shooter',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.removeMenu();
  win.loadFile(path.join(gameDir, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
