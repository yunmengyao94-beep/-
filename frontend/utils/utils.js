/**
 * 通用工具函数
 * ---------------------------------------------------------------------------
 * 说明：Sprint 4 Batch 2 需要搜索防抖，此前项目里没有对应工具，故在此新建
 *      utils/utils.js 统一收纳，避免把防抖逻辑散落在业务文件里。
 *
 * 导出：
 *   debounce(fn, wait)  连续触发只在停止后执行一次（搜索输入用这个）
 *   throttle(fn, wait)  固定间隔最多执行一次（滚动、拖拽用这个）
 */

/**
 * 防抖：等待 wait 毫秒内无新调用才真正执行
 * @param {Function} fn 目标函数
 * @param {number} [wait=300] 等待毫秒数
 * @param {{leading?: boolean}} [options] leading=true 时首次调用立即执行（提交按钮防连点用）
 * @returns {Function & {cancel: Function}} 包装后的函数，带 cancel() 可取消待执行调用
 */
export function debounce(fn, wait = 300, options = {}) {
  const { leading = false } = options;
  let timer = null;
  let leadingFired = false;

  function debounced(...args) {
    if (timer) clearTimeout(timer);

    if (leading && !leadingFired) {
      leadingFired = true;
      fn.apply(this, args);
    }

    timer = setTimeout(() => {
      timer = null;
      leadingFired = false;
      if (!leading) fn.apply(this, args);
    }, wait);
  }

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      leadingFired = false;
    }
  };

  return debounced;
}

/**
 * 节流：每 wait 毫秒最多执行一次（首次立即执行）
 * @param {Function} fn 目标函数
 * @param {number} [wait=300] 间隔毫秒数
 * @returns {Function} 包装后的函数
 */
export function throttle(fn, wait = 300) {
  let last = 0;

  return function throttled(...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    }
  };
}

export default { debounce, throttle };
