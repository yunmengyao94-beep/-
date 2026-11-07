/**
 * 交互与反馈组件（无依赖，原生 DOM）
 * ---------------------------------------------------------------------------
 * 导出：
 *   showToast(message, type)          type: 'success' | 'error'，默认 success，3 秒后销毁
 *   openModal(title, contentHTML)     打开弹窗，返回遮罩元素
 *   closeModal()                      关闭弹窗
 *
 * 约定：
 *   - 样式全部来自 components/feedback.css，JS 只负责建节点与状态切换
 *   - 不使用绝对定位：遮罩与 Toast 都是 position: fixed + flex/transform 居中
 *   - 标题用 textContent 写入（防注入）；contentHTML 走 innerHTML，仅允许可信内容
 */

const TOAST_DURATION = 3000;
const TOAST_LEAVE_DURATION = 200;
const TOAST_CONTAINER_ID = 'yxx-toast-container';

/** 当前打开的弹窗遮罩，保证同时只存在一个 */
let activeMask = null;

/**
 * 懒创建 Toast 容器
 * @returns {HTMLElement}
 */
function ensureToastContainer() {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

/**
 * 轻提示：屏幕中上部居中，3 秒后自动移除 DOM
 * @param {string} message 提示文案
 * @param {'success'|'error'} [type='success'] 类型
 * @returns {{dismiss: Function}} 句柄，可提前手动关闭
 */
export function showToast(message, type = 'success') {
  if (!document.body) return { dismiss: () => {} };

  const variant = type === 'error' ? 'error' : 'success';
  const container = ensureToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast--${variant}`;
  toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'toast__icon';
  icon.textContent = variant === 'error' ? '!' : '✓';

  const text = document.createElement('span');
  text.className = 'toast__text';
  text.textContent = String(message ?? '');

  toast.appendChild(icon);
  toast.appendChild(text);
  container.appendChild(toast);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    toast.remove();
    if (container.childElementCount === 0) container.remove();
  };

  const timer = setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(remove, TOAST_LEAVE_DURATION);
  }, TOAST_DURATION);

  return {
    dismiss: () => {
      clearTimeout(timer);
      remove();
    },
  };
}

/** Esc 关闭 */
function onKeydown(event) {
  if (event.key === 'Escape') closeModal();
}

/**
 * 打开弹窗
 * @param {string} title 标题（按纯文本写入，防注入）
 * @param {string} contentHTML 正文 HTML（仅传可信内容）
 * @returns {HTMLElement|null} 遮罩元素
 */
export function openModal(title, contentHTML) {
  if (!document.body) return null;
  closeModal();

  const mask = document.createElement('div');
  mask.className = 'modal-mask';

  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const header = document.createElement('div');
  header.className = 'modal__header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'modal__title';
  titleEl.textContent = String(title ?? '');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal__close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.textContent = '×';

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal__body';
  body.innerHTML = String(contentHTML ?? '');

  dialog.appendChild(header);
  dialog.appendChild(body);
  mask.appendChild(dialog);

  // 点遮罩空白处关闭（点内容不关）
  mask.addEventListener('click', (event) => {
    if (event.target === mask) closeModal();
  });
  closeBtn.addEventListener('click', closeModal);

  document.body.appendChild(mask);
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onKeydown);

  activeMask = mask;
  closeBtn.focus();
  return mask;
}

/**
 * 关闭弹窗（不存在时静默返回 false）
 * @returns {boolean} 是否真的关闭了弹窗
 */
export function closeModal() {
  if (!activeMask) return false;

  activeMask.remove();
  activeMask = null;
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', onKeydown);
  return true;
}

/**
 * 当前是否有弹窗打开
 * @returns {boolean}
 */
export function isModalOpen() {
  return Boolean(activeMask);
}

export default { showToast, openModal, closeModal, isModalOpen };
