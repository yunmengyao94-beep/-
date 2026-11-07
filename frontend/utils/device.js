/**
 * 端识别（UA + 尺寸双重判断）
 * ---------------------------------------------------------------------------
 * 规则：
 *   1. UA 命中移动端关键字 且 视口宽度 < 768 → is-mobile
 *   2. 其余情况（桌面 UA，或移动 UA 但屏幕够宽，如平板横屏）→ is-pc
 * 也就是说「尺寸优先」：宽屏一律按 PC 布局，避免平板/大屏手机显得突兀。
 *
 * CSS Media Queries 仍然负责布局切换，这里的类名用于补充端侧差异
 * （hover 效果、点击高亮、埋点标记等）。
 */

export const MOBILE_UA =
  /Android|iPhone|iPod|iPad|Mobile|HarmonyOS|Windows Phone|BlackBerry|Opera Mini/i;

export const MOBILE_BREAKPOINT = 768;

/**
 * 纯函数：根据 UA 与宽度判断端类型
 * @param {string} ua
 * @param {number} width
 * @returns {{isMobile: boolean, isPc: boolean, mobileUa: boolean, narrow: boolean}}
 */
export function detectDevice(ua, width) {
  const mobileUa = MOBILE_UA.test(String(ua || ''));
  const narrow = Number(width) < MOBILE_BREAKPOINT;
  const isMobile = mobileUa && narrow;

  return { isMobile, isPc: !isMobile, mobileUa, narrow };
}

/**
 * 把端类型写到 body 上（is-mobile / is-pc + data 属性）
 * @param {{ua?: string, width?: number, body?: HTMLElement}} [options]
 */
export function applyDeviceClasses(options = {}) {
  if (typeof document === 'undefined') return null;

  const ua = options.ua !== undefined ? options.ua : navigator.userAgent;
  const width = options.width !== undefined ? options.width : window.innerWidth;
  const body = options.body || document.body;
  if (!body) return null;

  const result = detectDevice(ua, width);

  body.classList.toggle('is-mobile', result.isMobile);
  body.classList.toggle('is-pc', !result.isMobile);
  body.dataset.device = result.isMobile ? 'mobile' : 'pc';
  body.dataset.ua = result.mobileUa ? 'mobile' : 'desktop';

  return result;
}

export default detectDevice;
