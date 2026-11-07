/**
 * 前端限流（同一设备 60 秒内只允许一次）
 * ---------------------------------------------------------------------------
 * 用途：注册、OCR 信用奖励等易被连点的写操作。
 * 说明：只是体验层的第一道闸（防误触/连点），真正的防刷在服务端限流 + 挑战校验。
 */

const PREFIX = 'yxx_throttle:';

/** 默认窗口：60 秒 */
export const DEFAULT_WINDOW_MS = 60 * 1000;

/**
 * 读取剩余冷却时间
 * @param {string} name 动作名，如 'register' / 'credit-bonus'
 * @param {number} [windowMs]
 * @returns {{allowed: boolean, waitMs: number, waitSeconds: number}}
 */
export function checkThrottle(name, windowMs = DEFAULT_WINDOW_MS) {
  try {
    const last = Number(localStorage.getItem(PREFIX + name) || 0);
    const remain = last + windowMs - Date.now();

    if (remain > 0) {
      return { allowed: false, waitMs: remain, waitSeconds: Math.ceil(remain / 1000) };
    }
  } catch {
    // 存储不可用：放行，交给服务端限流
  }

  return { allowed: true, waitMs: 0, waitSeconds: 0 };
}

/**
 * 记录一次操作时间
 * @param {string} name
 */
export function markThrottle(name) {
  try {
    localStorage.setItem(PREFIX + name, String(Date.now()));
  } catch {
    // 忽略
  }
}

/** 清除某动作的冷却（例如认证失败后允许立即重试） */
export function clearThrottle(name) {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    // 忽略
  }
}

export default { checkThrottle, markThrottle, clearThrottle };
