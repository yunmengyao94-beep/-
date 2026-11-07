/**
 * 新手引导（Onboarding）
 * ---------------------------------------------------------------------------
 * 3 步引导：高亮「发布」→ 高亮「我的」→ 居中「开始体验」
 * 高亮方式：聚光元素透明 + 超大 box-shadow 压暗四周（不使用 absolute 定位）
 *
 * 状态持久化：
 *   · 主键 yxx_guide_seen = '1'（带命名空间，避免与业务缓存混淆）
 *   · 兼容旧键 hasSeenGuide（老版本写入过）
 *   · 同时维护内存标记：隐私模式 / 配额满导致写库失败时，本次会话也不会重复弹
 *   · 只有「手动在设置里点重新查看」才会清除
 */

const GUIDE_KEY = 'yxx_guide_seen';
const LEGACY_GUIDE_KEY = 'hasSeenGuide';

/** 内存兜底（写库失败时保证本次会话不再重复弹） */
let memorySeen = null;

/** 是否已看过引导（存储优先，内存兜底） */
export function hasSeenGuide() {
  try {
    if (localStorage.getItem(GUIDE_KEY) === '1') {
      memorySeen = true;
      return true;
    }

    // 旧版本键位迁移：读到 hasSeenGuide = '1' 就顺手写入新键
    if (localStorage.getItem(LEGACY_GUIDE_KEY) === '1') {
      memorySeen = true;
      try {
        localStorage.setItem(GUIDE_KEY, '1');
      } catch {
        // 迁移失败不影响本次判断
      }
      return true;
    }
  } catch {
    // localStorage 不可用（隐私模式）：退化为内存标记
  }

  return memorySeen === true;
}

/** 标记已看过（点击「开始体验」时调用） */
export function markGuideSeen() {
  memorySeen = true;

  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    // 隐私模式下写不进去，靠内存标记保证本次会话不重复
  }
}

/** 重置（仅设置页「重新查看新手引导」调用） */
export function resetGuide() {
  memorySeen = false;

  try {
    localStorage.removeItem(GUIDE_KEY);
    localStorage.removeItem(LEGACY_GUIDE_KEY);
  } catch {
    // 忽略
  }
}

/** 当前是否有引导正在展示（避免重复挂载） */
let activeGuide = null;

/**
 * 启动引导
 * @param {{steps: Array<{target?: HTMLElement|null, title: string, desc: string, action?: string}>, onDone?: Function}} options
 */
export function startGuide(options = {}) {
  const steps = Array.isArray(options.steps) ? options.steps.filter(Boolean) : [];
  if (steps.length === 0 || typeof document === 'undefined') return null;

  // 已有引导在展示：先关掉旧的，避免叠两层遮罩
  if (activeGuide) {
    activeGuide.close();
    activeGuide = null;
  }

  const root = document.createElement('div');
  root.className = 'guide';

  const spot = document.createElement('div');
  spot.className = 'guide__spot';

  const blocker = document.createElement('div');
  blocker.className = 'guide__blocker';

  const tooltip = document.createElement('div');
  tooltip.className = 'guide__tooltip';

  root.append(spot, blocker, tooltip);
  document.body.appendChild(root);
  document.body.classList.add('guide-open');

  let index = 0;
  let closed = false;

  /** 关闭并回调 */
  function finish() {
    if (closed) return;
    closed = true;

    document.body.classList.remove('guide-open');
    window.removeEventListener('resize', onResize);
    if (root.parentNode) root.remove();

    activeGuide = null;
    if (typeof options.onDone === 'function') options.onDone();
  }

  /** 定位聚光区域 */
  function placeSpot(target) {
    if (!target || typeof target.getBoundingClientRect !== 'function') {
      spot.classList.add('hidden');
      return;
    }

    const rect = target.getBoundingClientRect();
    spot.classList.remove('hidden');
    spot.style.top = `${Math.max(0, rect.top - 6)}px`;
    spot.style.left = `${Math.max(0, rect.left - 6)}px`;
    spot.style.width = `${rect.width + 12}px`;
    spot.style.height = `${rect.height + 12}px`;
  }

  /** 定位提示气泡 */
  function placeTooltip(step) {
    tooltip.classList.remove('guide__tooltip--center');

    if (!step.target) {
      // 居中模式（最后一步）
      tooltip.classList.add('guide__tooltip--center');
      tooltip.style.left = '50%';
      tooltip.style.top = '50%';
      tooltip.style.bottom = 'auto';
      tooltip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const rect = step.target.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 800;
    const tipHeight = tooltip.offsetHeight || 150;

    tooltip.style.transform = 'translateX(-50%)';
    tooltip.style.left = '50%';

    const above = rect.top > tipHeight + 24;
    if (above) {
      tooltip.style.top = 'auto';
      tooltip.style.bottom = `${Math.max(12, viewportHeight - rect.top + 14)}px`;
    } else {
      tooltip.style.bottom = 'auto';
      tooltip.style.top = `${Math.min(viewportHeight - tipHeight - 12, rect.bottom + 14)}px`;
    }
  }

  /** 渲染当前步骤 */
  function render() {
    const step = steps[index];
    const isLast = index === steps.length - 1;

    placeSpot(step.target);
    placeTooltip(step);

    tooltip.textContent = '';

    const title = document.createElement('p');
    title.className = 'guide__title';
    title.textContent = step.title || '';

    const desc = document.createElement('p');
    desc.className = 'guide__desc';
    desc.textContent = step.desc || '';

    const footer = document.createElement('div');
    footer.className = 'guide__footer';

    const dots = document.createElement('div');
    dots.className = 'guide__dots';
    steps.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = `guide__dot${i === index ? ' is-active' : ''}`;
      dots.appendChild(dot);
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn btn--primary btn--sm';
    nextBtn.textContent = isLast ? step.action || '开始体验' : '下一步';
    nextBtn.addEventListener('click', () => {
      if (isLast) {
        finish();
        return;
      }
      index += 1;
      render();
    });

    footer.append(dots, nextBtn);
    tooltip.append(title, desc, footer);
  }

  /** 视口变化时重新定位 */
  function onResize() {
    const step = steps[index];
    if (!step) return;
    placeSpot(step.target);
    placeTooltip(step);
  }

  window.addEventListener('resize', onResize);

  render();

  activeGuide = {
    close: finish,
    get currentStep() {
      return index;
    },
  };

  return activeGuide;
}

export default { startGuide, hasSeenGuide, markGuideSeen, resetGuide };
