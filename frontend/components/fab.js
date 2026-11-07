/**
 * FAB（全局发布按钮）拖拽 + 边缘吸附
 * ---------------------------------------------------------------------------
 * · Pointer Events 实现，拖拽时自动禁用页面滚动（touch-action: none）
 * · 拖拽范围限制在视口内
 * · 松手后吸附到较近的一侧（左 / 右），垂直位置保留
 * · 位置写入 localStorage（yxx_fab_pos），刷新后恢复
 * · 拖动超过阈值时不触发跳转
 */

const POS_KEY = 'yxx_fab_pos';
const EDGE_MARGIN = 12;
const DRAG_THRESHOLD = 6;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    const pos = raw ? JSON.parse(raw) : null;
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
    return pos;
  } catch {
    return null;
  }
}

function savePos(x, y) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
  } catch {
    // 忽略
  }
}

/** 应用坐标（left/top，清掉默认的 right/bottom） */
function applyPos(fab, x, y) {
  const rect = fab.getBoundingClientRect();
  const width = rect.width || 56;
  const height = rect.height || 56;

  const left = clamp(x, EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const top = clamp(y, EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);

  fab.style.left = `${left}px`;
  fab.style.top = `${top}px`;
  fab.style.right = 'auto';
  fab.style.bottom = 'auto';
}

/** 吸附到最近的一侧 */
function snapToEdge(fab) {
  const rect = fab.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const toLeft = window.innerWidth / 2;

  const x = centerX < toLeft ? EDGE_MARGIN : window.innerWidth - rect.width - EDGE_MARGIN;

  applyPos(fab, x, rect.top);
  savePos(x, rect.top);
}

/**
 * 初始化 FAB 拖拽（找不到元素时静默跳过）
 */
export function initFabDrag() {
  if (typeof document === 'undefined') return;

  const fab = document.querySelector('.fab');
  if (!fab) return;
  if (fab.dataset.dragReady === '1') return;
  fab.dataset.dragReady = '1';

  // 恢复上次位置
  const saved = readPos();
  if (saved) applyPos(fab, saved.x, saved.y);

  let dragging = false;
  let moved = false;
  let offsetX = 0;
  let offsetY = 0;
  let startX = 0;
  let startY = 0;

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const rect = fab.getBoundingClientRect();
    dragging = true;
    moved = false;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    startX = event.clientX;
    startY = event.clientY;

    fab.classList.add('is-dragging');
    if (fab.setPointerCapture) fab.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragging) return;

    if (
      Math.abs(event.clientX - startX) > DRAG_THRESHOLD ||
      Math.abs(event.clientY - startY) > DRAG_THRESHOLD
    ) {
      moved = true;
    }

    applyPos(fab, event.clientX - offsetX, event.clientY - offsetY);
    event.preventDefault();
  };

  const onPointerUp = (event) => {
    if (!dragging) return;
    dragging = false;
    fab.classList.remove('is-dragging');

    if (fab.releasePointerCapture && event.pointerId !== undefined) {
      try {
        fab.releasePointerCapture(event.pointerId);
      } catch {
        // 忽略
      }
    }

    if (moved) snapToEdge(fab);
  };

  // 拖动后拦住 click，避免误跳转
  fab.addEventListener(
    'click',
    (event) => {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
      }
    },
    true
  );

  fab.addEventListener('pointerdown', onPointerDown);
  fab.addEventListener('pointermove', onPointerMove);
  fab.addEventListener('pointerup', onPointerUp);
  fab.addEventListener('pointercancel', onPointerUp);

  // 视口变化时把 FAB 拉回可见区域
  window.addEventListener('resize', () => {
    const rect = fab.getBoundingClientRect();
    applyPos(fab, rect.left, rect.top);
  });
}

export default initFabDrag;
