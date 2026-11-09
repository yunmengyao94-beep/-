'use strict';

/**
 * 庆师易校圈 · 桌面客户端（Electron）
 * ---------------------------------------------------------------------------
 * 本地化策略（核心保留项）：
 *   · 前端 HTML / CSS / JS / config 全部随安装包注入 resources/frontend
 *   · 通过自定义 app:// 协议加载本地资源（file:// 会因 CORS 禁止 ES Module）
 *   · 断网时页面外壳仍可渲染；接口层再降级读 localStorage 缓存
 *   · 启动 URL 自动追加 ?client=exe，并注入 API 地址（?api=）
 */

const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** 允许 app:// 使用标准协议特性（ES Module / fetch / CORS） */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** 接口地址：可用环境变量覆盖，默认本机服务 */
const API_ORIGIN = (process.env.YXX_APP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

/** 前端资源目录：打包后在 resources/frontend，开发时在 ../frontend */
const FRONTEND_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'frontend')
  : path.join(__dirname, '..', 'frontend');

let mainWindow = null;

/** 解析并限制在 FRONTEND_DIR 内，防止路径穿越 */
function resolveAsset(requestUrl) {
  const url = new URL(requestUrl);
  let pathname = decodeURIComponent(url.pathname || '/');
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.normalize(path.join(FRONTEND_DIR, pathname));
  const root = path.normalize(FRONTEND_DIR + path.sep);
  if (filePath !== path.normalize(FRONTEND_DIR) && !filePath.startsWith(root)) return null;
  return filePath;
}

/** 注册本地资源协议 */
function registerLocalProtocol() {
  protocol.handle('app', (request) => {
    const filePath = resolveAsset(request.url);
    if (!filePath) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

/** 启动地址：本地页面 + 客户端标识 + 接口地址 */
function buildStartUrl() {
  const query = new URLSearchParams({ client: 'exe', api: API_ORIGIN });
  return `app://yxx/index.html?${query.toString()}`;
}

/** 无法加载本地资源时的提示页 */
function showFallback(win, reason) {
  const tip = encodeURIComponent(
    `<html><meta charset="utf-8"><body style="font-family:system-ui;padding:60px;text-align:center;color:#333">
      <h2>本地资源加载失败</h2>
      <p>${reason}</p>
      <p style="color:#888">请重新安装客户端，或检查 resources/frontend 是否完整。</p>
    </body></html>`
  );
  win.loadURL(`data:text/html;charset=utf-8,${tip}`);
}

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

  // 锁定 3:2 宽高比：拖拽缩放时只能等比，避免 UI 拉伸
  mainWindow.setAspectRatio(1200 / 800);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // 本地页面加载失败（资源缺失）时给出可读提示，而不是白屏
    if (validatedURL && validatedURL.startsWith('app://')) {
      showFallback(mainWindow, `页面加载失败（${errorCode} ${errorDescription}）`);
    }
  });

  mainWindow.loadURL(buildStartUrl());
}

app.whenReady().then(() => {
  registerLocalProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { buildStartUrl, resolveAsset };
