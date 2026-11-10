'use strict';

/**
 * 庆师易校圈 · 桌面客户端（Electron）
 * ---------------------------------------------------------------------------
 * 本地化策略：
 *   · 前端资源随安装包注入 resources/frontend
 *   · 主进程起一个仅监听 127.0.0.1 的静态服务器（随机端口）
 *   · 以 http://127.0.0.1:<port> 加载页面，避免 app:// / file:// 的模块与 CORS 限制
 *   · 所有 HTML 响应注入 window.__YXX_API_ORIGIN__，登录页重定向也不会丢 API 地址
 *   · 窗口锁定 3:2，关闭即退出
 */

const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/** 云端 API 地址（可用 YXX_APP_URL 覆盖） */
const DEFAULT_API_ORIGIN = 'https://dqsf-hy-345260-13-1529260880.sh.run.tcloudbase.com';
const API_ORIGIN = (process.env.YXX_APP_URL || DEFAULT_API_ORIGIN).replace(/\/$/, '');

/** 前端资源目录：打包后在 resources/frontend，开发时 ../frontend */
const FRONTEND_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'frontend')
  : path.join(__dirname, '..', 'frontend');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

let mainWindow = null;
let localServer = null;

/** 解析请求路径，限制在 FRONTEND_DIR 内 */
function resolveFile(urlPath) {
  let pathname = decodeURIComponent((urlPath || '/').split('?')[0]);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.normalize(path.join(FRONTEND_DIR, pathname));
  const root = path.normalize(FRONTEND_DIR + path.sep);
  if (filePath !== path.normalize(FRONTEND_DIR) && !filePath.startsWith(root)) return null;
  return filePath;
}

/** HTML 注入运行时配置：任何页面、任何重定向都能拿到 API 地址 */
function injectRuntimeConfig(html) {
  const script = `<script>window.__YXX_API_ORIGIN__=${JSON.stringify(API_ORIGIN)};</script>`;
  if (html.includes('</head>')) return html.replace('</head>', `${script}</head>`);
  return script + html;
}

/** 启动本地静态服务器 */
function startLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const filePath = resolveFile(req.url);
      if (!filePath) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (error, buffer) => {
        if (error) {
          // 找不到文件时回退 index.html（页面路由）
          fs.readFile(path.join(FRONTEND_DIR, 'index.html'), (fallbackError, fallback) => {
            if (fallbackError) {
              res.writeHead(404);
              res.end('Not Found');
              return;
            }
            res.writeHead(200, { 'Content-Type': MIME['.html'] });
            res.end(injectRuntimeConfig(fallback.toString('utf8')));
          });
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const type = MIME[ext] || 'application/octet-stream';

        if (ext === '.html') {
          res.writeHead(200, { 'Content-Type': type });
          res.end(injectRuntimeConfig(buffer.toString('utf8')));
          return;
        }

        res.writeHead(200, { 'Content-Type': type });
        res.end(buffer);
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      localServer = server;
      resolve(server.address().port);
    });
  });
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

async function createWindow() {
  const port = await startLocalServer();

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

  // 锁定 3:2 宽高比：拖拽缩放只能等比
  mainWindow.setAspectRatio(1200 / 800);

  const ua = `${mainWindow.webContents.getUserAgent()} YXX-Client/1.0.0`;
  mainWindow.webContents.setUserAgent(ua);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL && validatedURL.startsWith('http://127.0.0.1')) {
      showFallback(mainWindow, `页面加载失败（${errorCode} ${errorDescription}）`);
    }
  });

  const query = new URLSearchParams({ client: 'exe' });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/index.html?${query.toString()}`);
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error('[yxx] 启动失败:', error);
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (localServer) {
    try {
      localServer.close();
    } catch {
      // 忽略
    }
  }
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { API_ORIGIN, FRONTEND_DIR };
