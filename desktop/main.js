'use strict';

/**
 * 庆师易校圈 · 桌面客户端（Electron）
 * ---------------------------------------------------------------------------
 * 启动即加载 Web 应用，并强制带上 ?client=exe，配合前端 client-entry.js
 * 隐藏「下载客户端」入口，避免客户端里出现「下载客户端」的套娃行为。
 */

const { app, BrowserWindow, shell } = require('electron');

/** 应用地址：优先环境变量，其次本地服务 */
const APP_URL = process.env.YXX_APP_URL || 'http://127.0.0.1:3000';

/** 组装带客户端标识的地址 */
function buildClientUrl() {
  try {
    const url = new URL(APP_URL);
    url.searchParams.set('client', 'exe');
    return url.toString();
  } catch {
    return `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}client=exe`;
  }
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#f4f7fb',
    title: '庆师易校圈',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // UA 打标：前端同时用 UA + ?client=exe 双重识别
  const ua = `${mainWindow.webContents.getUserAgent()} YXX-Client/1.0.0`;
  mainWindow.webContents.setUserAgent(ua);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', () => {
    const tip = encodeURIComponent(
      `<html><meta charset="utf-8"><body style="font-family:system-ui;padding:60px;text-align:center;color:#333">
        <h2>无法连接服务端</h2>
        <p>请先启动本地服务（node server/app.js），或设置环境变量 <code>YXX_APP_URL</code> 指向线上地址。</p>
        <p style="color:#888">当前地址：${APP_URL}</p>
      </body></html>`
    );
    mainWindow.loadURL(`data:text/html;charset=utf-8,${tip}`);
  });

  mainWindow.loadURL(buildClientUrl());
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { buildClientUrl };
