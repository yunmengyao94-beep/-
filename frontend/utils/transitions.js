/**
 * 页面转场（Page Transitions）
 * ---------------------------------------------------------------------------
 * 1. 支持 View Transitions 的浏览器（Chrome 126+）：交给 CSS 的
 *    `@view-transition { navigation: auto }` 处理跨文档转场，JS 只做标记。
 * 2. 不支持的浏览器：用 CSS keyframes 做进入动画；
 *    移动端点击内部链接时先播放「左滑退出」，再跳转（220ms）。
 *
 * 只拦截同源、非新窗口、非锚点、非下载的普通链接。
 */

const EXIT_MS = 220;

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 767.98px)').matches;
}

/** 标记：支持跨文档 View Transition 时关闭 CSS 兜底动画 */
function markViewTransitionSupport() {
  if (typeof document.startViewTransition === 'function') {
    document.documentElement.classList.add('has-vt');
  }
}

/** 播放离场动画后跳转 */
function leaveTo(href) {
  document.documentElement.classList.add('is-leaving');
  window.setTimeout(() => {
    window.location.href = href;
  }, EXIT_MS);
}

/** 判断链接是否值得拦截 */
function shouldIntercept(link, event) {
  if (!link || !link.href) return false;
  if (event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (event.button !== undefined && event.button !== 0) return false;
  if (link.target && link.target !== '_self') return false;
  if (link.hasAttribute('download')) return false;

  const raw = link.getAttribute('href') || '';
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) return false;

  let url;
  try {
    url = new URL(link.href, window.location.href);
  } catch {
    return false;
  }

  if (url.origin !== window.location.origin) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  // 同一页面（只有 hash）不拦截
  if (url.pathname === window.location.pathname && url.search === window.location.search)
    return false;

  return true;
}

/** 绑定移动端的滑动转场 */
function bindLinkTransitions() {
  document.addEventListener(
    'click',
    (event) => {
      // 只在小屏 + 不支持 View Transition 时才手动做滑动
      if (!isMobileViewport()) return;
      if (document.documentElement.classList.contains('has-vt')) return;

      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!shouldIntercept(link, event)) return;

      event.preventDefault();
      leaveTo(link.href);
    },
    { capture: true }
  );
}

/** bfcache 返回时清掉离场状态 */
function resetOnPageShow() {
  window.addEventListener('pageshow', () => {
    document.documentElement.classList.remove('is-leaving');
  });
}

/**
 * 初始化转场
 */
export function initPageTransitions() {
  if (typeof document === 'undefined') return;

  markViewTransitionSupport();

  if (prefersReducedMotion()) return;

  bindLinkTransitions();
  resetOnPageShow();
}

export default initPageTransitions;
