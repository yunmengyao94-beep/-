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

  /* ------------------------------------------------------------- 启动 */

  registerServiceWorker();
  setupNetworkBanner();
  setupImageFallback();
})();
