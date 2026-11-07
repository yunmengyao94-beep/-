/**
 * 断点切换控制器（768px）
 * ---------------------------------------------------------------------------
 * 目标：拖拽窗口跨过断点时，TabBar / Sidebar 不再"闪一下"。
 *
 * 流程：
 *   1. resize 节流（默认 100ms，尾部触发，保证最后一次一定生效）
 *   2. 真正跨过断点时，先把布局冻结成「旧形态」
 *      （body.layout-pending + data-prev，由 CSS 覆盖保持旧外观）
 *   3. 支持 View Transitions 的浏览器：120ms 后用 startViewTransition 交叉淡入
 *      不支持的浏览器：body 加 fade-transition（opacity→0 + blur(4px)），
 *      150ms 后切换布局，再移除虚化淡入
 *   4. 切换完成后移除冻结，进入 shell-entering 轻微入场
 *
 * 依赖全部可注入，便于单测。
 */

export const BREAKPOINT = 768;

/** 根据宽度返回布局模式 */
export function modeOf(width) {
  return Number(width) >= BREAKPOINT ? 'pc' : 'mobile';
}

/**
 * 创建断点切换器
 * @param {object} [options]
 * @param {() => number} [options.getWidth]
 * @param {() => void} [options.applyDevice] 更新 is-mobile / is-pc
 * @param {HTMLElement} [options.body]
 * @param {number} [options.throttleMs] 节流窗口
 * @param {number} [options.freezeMs] 虚化后等待多久再切换布局
 * @param {() => boolean} [options.supportsViewTransition]
 * @param {(cb: Function) => void} [options.startViewTransition]
 * @param {(fn: Function, ms: number) => any} [options.schedule]
 * @param {(id: any) => void} [options.cancel]
 */
export function createBreakpointSwitcher(options = {}) {
  const getWidth = options.getWidth || (() => window.innerWidth);
  const applyDevice = options.applyDevice || (() => {});
  const body = options.body || (typeof document !== 'undefined' ? document.body : null);
  const throttleMs = options.throttleMs === undefined ? 100 : options.throttleMs;
  const freezeMs = options.freezeMs === undefined ? 150 : options.freezeMs;
  const supportsVT = options.supportsViewTransition || (() => false);
  const startViewTransition = options.startViewTransition || null;
  const schedule = options.schedule || ((fn, ms) => window.setTimeout(fn, ms));
  const cancel = options.cancel || ((id) => window.clearTimeout(id));

  let mode = modeOf(getWidth());
  let throttleTimer = null;
  let switching = false;

  /** 解除冻结 → 应用新布局 */
  function unfreeze() {
    if (!body) return;

    body.classList.remove('layout-pending');
    delete body.dataset.prev;
    applyDevice();
    switching = false;

    if (mode === 'pc') {
      body.classList.add('shell-entering');
      schedule(() => body.classList.remove('shell-entering'), 320);
    }
  }

  /** 冻结为旧布局，再择机切换 */
  function cross(previous) {
    if (!body) {
      switching = false;
      return;
    }

    body.dataset.prev = previous;
    body.classList.add('layout-pending');

    const useVT = Boolean(supportsVT() && startViewTransition);

    if (useVT) {
      schedule(() => startViewTransition(unfreeze), 120);
      return;
    }

    body.classList.add('fade-transition');
    schedule(() => {
      unfreeze();
      schedule(() => body.classList.remove('fade-transition'), 30);
    }, freezeMs);
  }

  function run() {
    const next = modeOf(getWidth());

    if (next === mode) {
      applyDevice();
      return;
    }

    const previous = mode;
    mode = next;
    switching = true;
    cross(previous);
  }

  /** 节流入口：切换中忽略抖动；尾部触发保证最后一次生效 */
  function handleResize() {
    if (switching) return;

    if (throttleTimer !== null) cancel(throttleTimer);

    throttleTimer = schedule(
      () => {
        throttleTimer = null;
        run();
      },
      Math.max(0, throttleMs)
    );
  }

  return {
    handleResize,
    getMode: () => mode,
    isSwitching: () => switching,
  };
}

export default createBreakpointSwitcher;
