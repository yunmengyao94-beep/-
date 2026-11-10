'use strict';

/**
 * 庆师易校圈 Service Worker
 * ---------------------------------------------------------------------------
 * · install：把应用外壳（页面 / 核心 CSS / 核心 JS / 图标 / manifest）写入 yxx-v1
 * · activate：清理非 yxx-v1 的旧缓存，并 clients.claim() 立即接管页面
 * · fetch（本批策略）：
 *     1. 静态资源（HTML/CSS/JS/图片/字体）→ Cache First
 *     2. 接口 /api/                  → Network First（超时 = 3s），失败时返回离线 JSON
 *     3. 页面导航 navigate           → 缓存优先，离线且未缓存时回退 index.html 外壳
 *
 * 说明：
 *   1. 单个资源 404 不会让整个 install 失败（逐个 add 并捕获异常）。
 *   2. 本项目使用系统字体栈，没有 webfont 文件，故字体项为空数组（见 SHELL_FONTS）。
 *   3. 改动策略后应同步升级 CACHE_NAME（例如 yxx-v2），activate 会自动清掉旧缓存。
 */

/** 缓存版本：发版时递增（v2 起改为「版本号 + 构建日期」，便于定位线上版本） */
const CACHE_VERSION = 'v6';
const BUILD_DATE = '2026-11-08.4';
const CACHE_NAME = `yxx-${CACHE_VERSION}`;

// 构建日期仅用于排查线上版本（可在 DevTools 的 Cache Storage 中看到）
self.__YXX_BUILD__ = BUILD_DATE;

/** 接口网络优先的超时时间（毫秒） */
const API_TIMEOUT = 3000;

/** 断网时接口返回的兜底 JSON（前端 request.js 会以 code≠200 抛出，由页面 Toast 提示） */
const OFFLINE_PAYLOAD = {
  code: 50301,
  msg: '当前为离线模式，展示本地数据',
  data: null,
};

/** 页面外壳 */
const SHELL_PAGES = [
  './login.html',
  './register.html',
  './orders.html',
  './settings.html',
  './notifications.html',
  './agreement.html',
  './help.html',
  './index.html',
  './item.html',
  './profile.html',
  './publish.html',
];

/** 核心样式 */
const SHELL_STYLES = [
  './css/variables.css',
  './css/reset.css',
  './css/layout.css',
  './components/base.css',
  './components/motion.css',
  './components/shell.css',
  './components/feedback.css',
];

/** 核心脚本 */
const SHELL_SCRIPTS = [
  './js/auth.js',
  './js/app.js',
  './js/login.js',
  './js/register.js',
  './js/orders.js',
  './js/settings.js',
  './js/notifications.js',
  './components/shell.js',
  './js/index.js',
  './js/item.js',
  './js/chat.js',
  './js/client-entry.js',
  './config/credit_rules.json',
  './utils/credit-rules.js',
  './utils/version.js',
  './js/version-check.js',
  './js/borrow-credential.js',
  './js/publish.js',
  './js/profile.js',
  './utils/request.js',
  './utils/utils.js',
  './utils/constants.js',
  './utils/format.js',
  './utils/auth.js',
  './utils/accounts.js',
  './utils/accounts-db.js',
  './utils/agreement.js',
  './utils/item-images.js',
  './utils/search-history.js',
  './utils/transitions.js',
  './utils/breakpoint.js',
  './utils/fingerprint.js',
  './utils/rate-limit.js',
  './utils/item-image.js',
  './components/onboarding.js',
  './components/custom-select.js',
  './components/feedback.js',
];

/** 图标与 manifest */
const SHELL_ASSETS = [
  './manifest.json',
  './favicon.ico',
  './assets/icons/logo-192.png',
  './assets/icons/logo-512.png',
  './assets/icons/item-umbrella.png',
  './assets/icons/item-box.png',
  './assets/icons/item-gown.png',
  './assets/icons/item-wig.png',
  './assets/icons/item-clothes.png',
  './assets/icons/item-digital.png',
  './assets/icons/item-tool.png',
  './assets/icons/item-study.png',
  './assets/icons/item-luggage.png',
  './assets/icons/item-outdoor.png',
  './assets/icons/default-placeholder.png',
  './assets/icons/logo-maskable-192.png',
  './assets/icons/logo-maskable-512.png',
];

/** 字体：项目使用系统字体栈，无 webfont 文件 */
const SHELL_FONTS = [];

const SHELL_ALL = [
  ...SHELL_PAGES,
  ...SHELL_STYLES,
  ...SHELL_SCRIPTS,
  ...SHELL_ASSETS,
  ...SHELL_FONTS,
];

/* ------------------------------------------------------------------ install */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // 逐个缓存：某个资源缺失不应导致整个安装失败
      await Promise.all(
        SHELL_ALL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            // 资源暂时不可用：忽略，运行时再走网络
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

/* ----------------------------------------------------------------- activate */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));

      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------------ 工具 */

/** 给 Promise 加超时，超时即视为网络不可用 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** 离线时接口的兜底响应 */
function offlineJsonResponse() {
  return new Response(JSON.stringify(OFFLINE_PAYLOAD), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-YXX-Offline': '1',
    },
  });
}

/** 离线且无外壳时的极简兜底页 */
function offlineHtmlResponse() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>离线</title><p>当前处于离线状态，请联网后重试。</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* ------------------------------------------------------------------ 策略 */

/**
 * 静态资源：Cache First
 * 命中缓存直接返回；未命中走网络，成功后写入缓存
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * 接口：Network First
 * 网络优先（带超时）；失败时先用缓存，仍无则返回离线 JSON
 */
async function networkFirstApi(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await withTimeout(fetch(request), API_TIMEOUT);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    return offlineJsonResponse();
  }
}

/**
 * 页面导航：缓存优先；离线且未缓存时回退到 index.html 外壳
 */
async function navigateCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const shell = await cache.match('./index.html');
    return shell || offlineHtmlResponse();
  }
}

/* -------------------------------------------------------------------- fetch */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 0) 开发热刷新长连接：直接放行，不参与缓存
  if (url.pathname.startsWith('/__live')) return;

  // 0.1) AI 资源（约 40MB）与字体（约 27MB）不进 Cache Storage，避免撑爆配额
  if (url.pathname.startsWith('/assets/ai/') || url.pathname.startsWith('/fonts/')) return;

  // 1) 接口：网络优先
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // 2) 页面导航：缓存优先 + 外壳兜底
  if (request.mode === 'navigate') {
    event.respondWith(navigateCacheFirst(request));
    return;
  }

  // 3) 其余静态资源：缓存优先
  event.respondWith(cacheFirst(request));
});
