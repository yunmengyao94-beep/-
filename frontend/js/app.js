import { showToast } from '../components/feedback.js';
import { request, getToken, setToken } from '../utils/request.js';
import { mountShell } from '../components/shell.js';
import { initFabDrag } from '../components/fab.js';
import { applyDeviceClasses } from '../utils/device.js';
import './client-entry.js';
import { checkVersion } from './version-check.js';
import { loadCreditRules } from '../utils/credit-rules.js';
import { applyFontSize, getFontSizeKey } from '../utils/preferences.js';
import { initPageTransitions } from '../utils/transitions.js';
import { createBreakpointSwitcher } from '../utils/breakpoint.js';

/**
 * 应用公共入口
 * ---------------------------------------------------------------------------
 * 1. 注册 Service Worker（window.load 之后，避免抢首屏带宽）
 * 2. 全局网络状态横幅（online / offline）
 * 3. 图片加载失败降级为灰色占位图
 *
 * 页面通过 <script type="module" src="./js/app.js"></script> 引入（5 个页面均已接入）。
 */

(function bootstrap() {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;

  /* -------------------------------------------------------- 0. 主题引导 */

  /** 读取本地主题偏好并应用（深色模式对全站生效） */
  function applyStoredTheme() {
    try {
      if (localStorage.getItem('yxx_theme') === 'dark') {
        document.documentElement.dataset.theme = 'dark';
      }
    } catch {
      // 存储不可用时保持默认亮色
    }
  }

  /* ------------------------------------------------------------ 1. SW 注册 */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      if (root) root.dataset.sw = 'unsupported';
      return;
    }

    const start = () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((registration) => {
          if (root) root.dataset.sw = 'ready';
          watchServiceWorkerUpdate(registration);
          return registration;
        })
        .catch(() => {
          if (root) root.dataset.sw = 'failed';
        });
    };

    if (document.readyState === 'complete') {
      start();
    } else {
      window.addEventListener('load', start, { once: true });
    }
  }

  /* -------------------------------------------------------- 2. 网络状态横幅 */

  /** 「网络已连接」提示自动隐藏的延时 */
  const BANNER_HIDE_DELAY = 2000;

  const BANNER_TEXT = {
    offline: '当前为离线模式，部分功能不可用',
    online: '网络已连接',
  };

  function setupNetworkBanner() {
    const banner = document.getElementById('network-banner');
    if (!banner) return;

    let hideTimer = null;

    const showOffline = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      banner.textContent = BANNER_TEXT.offline;
      banner.className = 'network-banner is-visible is-offline';
    };

    const showOnline = () => {
      if (hideTimer) clearTimeout(hideTimer);

      banner.textContent = BANNER_TEXT.online;
      banner.className = 'network-banner is-visible is-online';

      hideTimer = setTimeout(() => {
        hideTimer = null;
        banner.className = 'network-banner';
      }, BANNER_HIDE_DELAY);
    };

    window.addEventListener('offline', showOffline);
    window.addEventListener('online', showOnline);

    // 页面加载时如果已经断网，直接亮出离线提示
    if (navigator.onLine === false) showOffline();
  }

  /* ---------------------------------------------------------- 3. 图片降级 */

  /** 离线占位图：内联 SVG，不产生额外请求，断网也能显示 */
  const FALLBACK_IMAGE =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">' +
        '<rect width="320" height="240" fill="#f2f3f5"/>' +
        '<path d="M92 150l38-46 30 34 22-26 46 56H92z" fill="#d9d9d9"/>' +
        '<circle cx="126" cy="96" r="16" fill="#d9d9d9"/>' +
        '<text x="160" y="196" font-size="14" fill="#bfbfbf" text-anchor="middle" font-family="sans-serif">图片暂不可用</text>' +
        '</svg>'
    );

  function handleImageError(event) {
    const target = event && event.target;
    if (!target || target.tagName !== 'IMG') return;
    if (target.dataset && target.dataset.fallback === '1') return;

    if (target.dataset) target.dataset.fallback = '1';
    if (typeof target.removeAttribute === 'function') target.removeAttribute('srcset');

    target.src = FALLBACK_IMAGE;
    if (target.classList) target.classList.add('img-fallback');
  }

  function setupImageFallback() {
    // 捕获阶段监听：图片的 error 事件不冒泡
    document.addEventListener('error', handleImageError, true);
  }

  /* -------------------------------------------------------- 4. 开发热刷新 */

  /** 只在本次会话刷新一次，避免 controllerchange 造成刷新循环 */
  let updateReloading = false;

  /** 监听 SW 更新：新版本就绪后提示并刷新 */
  function watchServiceWorkerUpdate(registration) {
    if (!registration) return;

    const hadController = Boolean(navigator.serviceWorker.controller);

    const reloadOnce = () => {
      if (updateReloading || !hadController) return;
      updateReloading = true;
      window.location.reload();
    };

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener('statechange', () => {
        if (installing.state !== 'installed') return;
        if (!hadController) return; // 首次安装：无需刷新

        showToast('发现新版本，正在更新…', 'success');
        setTimeout(reloadOnce, 900);
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);

    // 主动检查一次（浏览器通常 24h 才自动检查）
    if (typeof registration.update === 'function') {
      registration.update().catch(() => {});
    }
  }

  /**
   * 本地开发：监听服务端 /__live（SSE），文件变化后清理 Cache Storage 再刷新。
   * 只在 localhost / 127.0.0.1 生效，线上（含 PWA 安装环境）完全不会连接。
   */
  function setupLiveReload() {
    if (typeof EventSource !== 'function') return;

    const host = location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return;

    let source = null;
    try {
      source = new EventSource('/__live');
    } catch {
      return;
    }

    source.addEventListener('reload', async () => {
      source.close();
      // 关键：Cache First 会命中旧文件，先清空再刷新才能看到最新代码
      try {
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {
        // 清缓存失败也继续刷新
      }
      location.reload();
    });
  }

  /* ------------------------------------------------ 5. 多标签页状态同步 */

  /**
   * 同一个 localStorage 在多个 Tab 间共享：
   * 任一 Tab 退出登录（删除 yxx_token）时，其余 Tab 立即跳回登录页，
   * 避免"Tab A 已退出、Tab B 还在用旧 Token 发东西"的错乱。
   */
  function setupCrossTabSync() {
    window.addEventListener('storage', (event) => {
      if (event.key !== 'yxx_token') return;

      const path = window.location.pathname || '';
      if (path.endsWith('login.html') || path.endsWith('register.html')) return;

      if (!event.newValue) {
        window.location.replace('./login.html');
      }
    });
  }

  /* ------------------------------------------------ 6. 未读消息红点 */

  /** 拉取未读数并刷新 tabbar 红点 */
  async function refreshUnreadBadge() {
    const badges = document.querySelectorAll('[data-unread]');
    if (badges.length === 0) return;
    if (!getToken()) {
      badges.forEach((node) => node.classList.add('hidden'));
      return;
    }

    try {
      const data = await request('/notifications');
      const unread = (data && data.unread_count) || 0;

      badges.forEach((node) => {
        node.textContent = unread > 99 ? '99+' : String(unread);
        node.classList.toggle('hidden', unread === 0);
      });
    } catch {
      badges.forEach((node) => node.classList.add('hidden'));
    }
  }

  /* ------------------------------------------------ 7. Token 静默续期 */

  /** 解析 JWT payload（只读，不校验签名） */
  function decodeJwtPayload(token) {
    try {
      const part = String(token).split('.')[1];
      if (!part) return null;
      const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  /** 剩余有效期不足 24 小时就静默换新 Token */
  async function refreshTokenIfNeeded() {
    const token = getToken();
    if (!token) return;

    const payload = decodeJwtPayload(token);
    if (!payload || !payload.exp) return;

    const remainMs = payload.exp * 1000 - Date.now();
    if (remainMs > 24 * 3600 * 1000) return;

    try {
      const data = await request('/auth/refresh', { method: 'POST' });
      if (data && data.token) setToken(data.token);
    } catch {
      // 续期失败不打断使用：等真正过期时 401 再走登录
    }
  }

  /* ------------------------------------------- 4.5 PC 端壳层（≥768px） */

  /** 需要侧边栏/顶部栏的页面 → 当前激活项 */
  const SHELL_PAGES = {
    'index.html': 'home',
    'orders.html': 'orders',
    'notifications.html': 'messages',
    'profile.html': 'profile',
    'settings.html': 'settings',
    'publish.html': 'home',
  };

  /** 挂载 PC 壳层（移动端由 CSS 隐藏） */
  function setupDesktopShell() {
    const page = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const active = SHELL_PAGES[page];
    if (!active) return;

    try {
      mountShell({ active });
    } catch {
      // 壳层失败不影响主功能
    }
  }

  /* --------------------------------------------- 8. 端识别 / 字号 / FAB */

  /** 启动时恢复用户字号偏好 */
  function applyStoredFontSize() {
    applyFontSize(getFontSizeKey());
  }

  /* ------------------------------------------------------------- 启动 */

  applyStoredTheme();
  registerServiceWorker();
  setupNetworkBanner();
  setupImageFallback();
  applyDeviceClasses();

  // 本地规则与版本探测都不阻塞首屏
  void loadCreditRules();
  setTimeout(() => {
    void checkVersion();
  }, 1500);
  applyStoredFontSize();
  initPageTransitions();

  // 断点切换：节流 + 冻结旧布局 + 虚化过渡，避免 TabBar / Sidebar 闪一下
  const breakpointSwitcher = createBreakpointSwitcher({
    applyDevice: applyDeviceClasses,
    supportsViewTransition: () => typeof document.startViewTransition === 'function',
    startViewTransition:
      typeof document.startViewTransition === 'function'
        ? (callback) => document.startViewTransition(callback)
        : null,
  });

  window.addEventListener('resize', () => breakpointSwitcher.handleResize());

  setupDesktopShell();
  initFabDrag();
  setupLiveReload();
  setupCrossTabSync();
  refreshUnreadBadge();
  refreshTokenIfNeeded();
})();
