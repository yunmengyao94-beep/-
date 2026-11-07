/**
 * 用户偏好（字号）
 * ---------------------------------------------------------------------------
 * 字号通过 CSS 变量 --font-size-base 全局生效，存 localStorage 跨页面保持。
 */

export const FONT_SIZE_KEY = 'yxx_font_size';

/** 三档字号 */
export const FONT_SIZE_MAP = Object.freeze({
  small: '13px',
  standard: '14px',
  large: '16px',
});

/**
 * 读取当前字号档位
 * @returns {'small'|'standard'|'large'}
 */
export function getFontSizeKey() {
  try {
    const key = localStorage.getItem(FONT_SIZE_KEY);
    return key && FONT_SIZE_MAP[key] ? key : 'standard';
  } catch {
    return 'standard';
  }
}

/**
 * 应用字号（写 CSS 变量 + 持久化）
 * @param {'small'|'standard'|'large'} key
 * @returns {'small'|'standard'|'large'} 实际生效的档位
 */
export function applyFontSize(key) {
  const safeKey = FONT_SIZE_MAP[key] ? key : 'standard';

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--font-size-base', FONT_SIZE_MAP[safeKey]);
  }

  try {
    localStorage.setItem(FONT_SIZE_KEY, safeKey);
  } catch {
    // 忽略
  }

  return safeKey;
}

export default { getFontSizeKey, applyFontSize, FONT_SIZE_MAP, FONT_SIZE_KEY };
