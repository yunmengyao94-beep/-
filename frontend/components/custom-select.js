/**
 * 自定义下拉框交互（极简实现，无依赖）
 * ---------------------------------------------------------------------------
 * 结构约定（对应 components/base.css 的 .custom-select）：
 *   <div class="custom-select" data-custom-select>
 *     <button class="custom-select__control" aria-haspopup="listbox" aria-expanded="false">
 *       <span class="custom-select__value">请选择</span>
 *       <span class="custom-select__arrow"></span>
 *     </button>
 *     <ul class="custom-select__panel" role="listbox">
 *       <li class="custom-select__option" data-value="">请选择</li>
 *     </ul>
 *     <input type="hidden" name="category" value="" />
 *   </div>
 *
 * 定位方式：浮层用 position: fixed，坐标由触发器 getBoundingClientRect() 实时计算，
 * 因此页面滚动/窗口缩放时不会漂移。全程不使用绝对定位。
 *
 * 用法：
 *   import { initCustomSelect } from './components/custom-select.js';
 *   initCustomSelect();                       // 全页初始化
 *   initCustomSelect(document.querySelector('#form')); // 局部初始化
 */

const OPEN_CLASS = 'is-open';
const PANEL_MAX_HEIGHT = 240;
const VIEWPORT_GAP = 8;

let activeRoot = null;
let globalBound = false;

/**
 * 依据触发器位置摆放浮层（空间不足时向上翻转）
 * @param {HTMLElement} root .custom-select 根节点
 */
function positionPanel(root) {
  const control = root.querySelector('.custom-select__control');
  const panel = root.querySelector('.custom-select__panel');
  if (!control || !panel) return;

  const rect = control.getBoundingClientRect();
  const panelHeight = Math.min(panel.scrollHeight, PANEL_MAX_HEIGHT);
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < panelHeight + VIEWPORT_GAP && rect.top > spaceBelow;

  const width = rect.width;
  const maxLeft = Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP);
  const left = Math.min(Math.max(VIEWPORT_GAP, rect.left), maxLeft);
  const top = openUp ? rect.top - panelHeight - 4 : rect.bottom + 4;

  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(VIEWPORT_GAP, top)}px`;
}

/**
 * 展开下拉
 * @param {HTMLElement} root
 */
function openPanel(root) {
  if (activeRoot && activeRoot !== root) closePanel(activeRoot);

  root.classList.add(OPEN_CLASS);
  const control = root.querySelector('.custom-select__control');
  if (control) control.setAttribute('aria-expanded', 'true');

  positionPanel(root);
  activeRoot = root;
}

/**
 * 收起下拉
 * @param {HTMLElement} root
 */
function closePanel(root) {
  root.classList.remove(OPEN_CLASS);
  const control = root.querySelector('.custom-select__control');
  if (control) control.setAttribute('aria-expanded', 'false');
  if (activeRoot === root) activeRoot = null;
}

/**
 * 选中某一项：更新文案、隐藏域、选中态，并派发 change 事件
 * @param {HTMLElement} root
 * @param {HTMLElement} option
 */
function selectOption(root, option) {
  const value = option.dataset.value || '';
  const label = option.textContent ? option.textContent.trim() : '';

  const valueEl = root.querySelector('.custom-select__value');
  if (valueEl) {
    valueEl.textContent = label;
    valueEl.classList.toggle('is-placeholder', value === '');
  }

  const hidden = root.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = value;

  root.querySelectorAll('.custom-select__option').forEach((item) => {
    item.classList.toggle('is-selected', item === option);
    item.setAttribute('aria-selected', item === option ? 'true' : 'false');
  });

  root.dataset.value = value;
  root.dispatchEvent(new CustomEvent('change', { detail: { value, label }, bubbles: true }));
  closePanel(root);
}

/** 点击空白处收起 */
function onDocumentClick(event) {
  if (!activeRoot) return;
  if (activeRoot.contains(event.target)) return;
  closePanel(activeRoot);
}

/** 滚动 / 缩放时重算位置，避免浮层与触发器错位 */
function repositionActive() {
  if (activeRoot) positionPanel(activeRoot);
}

/** 绑定一次全局监听，避免重复初始化时叠加 */
function bindGlobalListeners() {
  if (globalBound) return;
  document.addEventListener('click', onDocumentClick);
  window.addEventListener('scroll', repositionActive, true);
  window.addEventListener('resize', repositionActive);
  globalBound = true;
}

/**
 * 初始化页面内所有自定义下拉框
 * @param {ParentNode} [scope=document] 查询范围
 * @returns {number} 本次初始化的实例数
 */
export function initCustomSelect(scope = document) {
  const roots = Array.from(scope.querySelectorAll('[data-custom-select]'));

  roots.forEach((root) => {
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    const control = root.querySelector('.custom-select__control');
    const panel = root.querySelector('.custom-select__panel');
    if (!control || !panel) return;

    // 回填初始选中项
    const hidden = root.querySelector('input[type="hidden"]');
    if (hidden && hidden.value) {
      const preset = panel.querySelector(`.custom-select__option[data-value="${hidden.value}"]`);
      if (preset) {
        preset.classList.add('is-selected');
        preset.setAttribute('aria-selected', 'true');
      }
    }

    control.addEventListener('click', () => {
      if (root.classList.contains(OPEN_CLASS)) {
        closePanel(root);
      } else {
        openPanel(root);
      }
    });

    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (root.classList.contains(OPEN_CLASS)) {
          closePanel(root);
        } else {
          openPanel(root);
        }
      } else if (event.key === 'Escape') {
        closePanel(root);
      }
    });

    panel.addEventListener('click', (event) => {
      const target = event.target;
      const option = target && target.closest ? target.closest('.custom-select__option') : null;
      if (option) selectOption(root, option);
    });
  });

  bindGlobalListeners();
  return roots.length;
}

export default initCustomSelect;
