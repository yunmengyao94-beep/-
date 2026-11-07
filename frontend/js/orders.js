/**
 * 我的订单页
 * ---------------------------------------------------------------------------
 * 数据：GET /api/v1/orders/mine?direction=borrow|lend&state=0|1|2
 * 交互：待交接 → 确认交接（0→1）；使用中 → 发起归还（1→2）
 *       两个动作都走 PATCH /api/v1/orders/:id/state，成功后本地即时更新
 */

import { request } from '../utils/request.js';
import { showToast, openModal, closeModal } from '../components/feedback.js';
import { formatTime } from '../utils/format.js';
import { resolveItemImage } from '../utils/item-image.js';
import { ensureToken } from '../utils/auth.js';

const listEl = document.getElementById('order-list');
const emptyEl = document.getElementById('order-empty');
const countEl = document.getElementById('order-count');
const tabLend = document.getElementById('tab-lend');
const tabBorrow = document.getElementById('tab-borrow');
const chips = Array.from(document.querySelectorAll('.chip'));

/** 状态 → 文案 / 徽章色 */
const STATE_META = {
  0: { text: '待交接', badge: 'badge--warning' },
  1: { text: '使用中', badge: 'badge--primary' },
  2: { text: '已完成', badge: 'badge--success' },
  3: { text: '已取消', badge: 'badge--outline' },
  4: { text: '已逾期', badge: 'badge--danger' },
};

/** 当前筛选条件 */
const state = {
  direction: 'borrow',
  status: 0,
  orders: [],
  loading: false,
};

/* ------------------------------------------------------------------ 渲染 */

/** 清空列表 */
function clearList() {
  if (listEl) listEl.textContent = '';
  if (emptyEl) {
    emptyEl.textContent = '';
    emptyEl.classList.add('hidden');
  }
}

/** 空状态 */
function renderEmpty() {
  if (!emptyEl) return;

  emptyEl.textContent = '';
  emptyEl.classList.remove('hidden');

  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const icon = document.createElement('div');
  icon.className = 'empty-state__icon';
  icon.textContent = state.direction === 'borrow' ? '🛍️' : '📦';

  const text = document.createElement('p');
  text.className = 'empty-state__text';
  text.textContent = state.direction === 'borrow' ? '还没有借入的订单' : '还没有借出的物品';

  const desc = document.createElement('p');
  desc.className = 'empty-state__desc';
  desc.textContent =
    state.direction === 'borrow' ? '去首页挑一件物品，发起借用申请' : '发布闲置物品，让同学来借';

  wrap.append(icon, text, desc);
  emptyEl.appendChild(wrap);
}

/** 单张订单卡片 */
function createOrderCard(order) {
  const card = document.createElement('article');
  card.className = 'order-card';
  card.dataset.orderId = String(order.order_id);

  // 左侧图片区（Mock 无真实图片时用标题首字占位）
  const media = document.createElement('div');
  media.className = 'order-card__media';

  const title = (order.item && order.item.title) || '物品';
  const img = document.createElement('img');
  img.src = resolveItemImage({ title, image: order.item && order.item.image });
  img.alt = title;
  img.loading = 'lazy';
  media.appendChild(img);

  // 右侧内容
  const body = document.createElement('div');
  body.className = 'order-card__body';

  const head = document.createElement('div');
  head.className = 'order-card__head';

  const heading = document.createElement('h3');
  heading.className = 'order-card__title ellipsis';
  heading.textContent = title;
  heading.title = title;

  const meta = STATE_META[order.state] || STATE_META[0];
  const badge = document.createElement('span');
  badge.className = `badge ${meta.badge}`;
  badge.textContent = meta.text;

  head.append(heading, badge);

  const counterpart = document.createElement('p');
  counterpart.className = 'order-card__meta';
  counterpart.textContent = `对方：${(order.counterparty && order.counterparty.nickname) || '同学'}`;

  const timeLine = document.createElement('p');
  timeLine.className = 'order-card__meta';
  const created = formatTime(order.created_at);
  const endLabel = order.state === 2 ? '归还' : '应还';
  const endTime = formatTime(order.state === 2 ? order.finished_at : order.due_at);
  timeLine.textContent = `借出：${created} · ${endLabel}：${endTime}`;

  body.append(head, counterpart, timeLine);

  // 操作区：只有借入方才需要操作
  if (order.direction === 'borrow' && order.state === 0) {
    body.appendChild(createActionButton('确认交接', order, 'confirm_handover'));
  } else if (order.direction === 'borrow' && order.state === 1) {
    body.appendChild(createActionButton('发起归还', order, 'request_return'));
  } else if (order.direction === 'lend' && order.state < 2) {
    const hint = document.createElement('p');
    hint.className = 'order-card__hint';
    hint.textContent = order.state === 0 ? '等待对方确认接手' : '等待对方归还';
    body.appendChild(hint);
  }

  card.append(media, body);
  return card;
}

/** 操作按钮 + 二次确认 */
function createActionButton(label, order, action) {
  const wrap = document.createElement('div');
  wrap.className = 'order-card__actions';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--primary btn--sm';
  btn.textContent = label;
  btn.addEventListener('click', () => confirmAction(order, action, label));

  wrap.appendChild(btn);
  return wrap;
}

/** 弹出确认框 → 调接口 → 更新 */
function confirmAction(order, action, label) {
  const isHandover = action === 'confirm_handover';

  const body = [
    `<p class="ai-modal__text">${
      isHandover
        ? '确认已经拿到物品？确认后订单进入「使用中」，押金分继续冻结。'
        : '确认归还物品？确认后订单完成，冻结的信用分将立即解冻。'
    }</p>`,
    '<div class="ai-modal__actions">',
    '<button class="btn btn--secondary" id="order-cancel" type="button">取消</button>',
    `<button class="btn btn--primary" id="order-confirm" type="button">${label}</button>`,
    '</div>',
  ].join('');

  const mask = openModal(label, body);
  if (!mask) return;

  const cancelBtn = mask.querySelector('#order-cancel');
  const confirmBtn = mask.querySelector('#order-confirm');

  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '处理中...';

      try {
        const data = await request(`/orders/${order.order_id}/state`, {
          method: 'PATCH',
          body: { action },
        });

        order.state = data && typeof data.state === 'number' ? data.state : order.state + 1;
        if (action === 'request_return')
          order.finished_at = data.finished_at || new Date().toISOString();

        closeModal();
        showToast(isHandover ? '已确认交接' : '归还成功，信用分已解冻', 'success');

        // 当前筛选与最新状态不一致时，从列表移除；否则重绘
        renderCurrent();
      } catch (error) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = label;
        showToast(`操作失败：${error.message}`, 'error');
      }
    });
  }
}

/** 渲染当前筛选结果 */
function renderCurrent() {
  if (!listEl) return;

  // 只保留仍符合当前状态筛选的订单
  state.orders = state.orders.filter((order) => order.state === state.status);

  clearList();

  if (state.orders.length === 0) {
    if (countEl) countEl.textContent = '共 0 单';
    renderEmpty();
    return;
  }

  const fragment = document.createDocumentFragment();
  state.orders.forEach((order) => fragment.appendChild(createOrderCard(order)));
  listEl.appendChild(fragment);

  if (countEl) countEl.textContent = `共 ${state.orders.length} 单`;
}

/** 骨架/加载提示 */
function renderLoading() {
  if (!listEl) return;
  listEl.textContent = '';
  if (emptyEl) emptyEl.classList.add('hidden');

  for (let i = 0; i < 3; i += 1) {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.style.minHeight = '108px';
    listEl.appendChild(card);
  }
}

/* ------------------------------------------------------------------ 加载 */

async function loadOrders() {
  if (state.loading) return;
  state.loading = true;

  renderLoading();

  try {
    await ensureToken();
    const data = await request(`/orders/mine?direction=${state.direction}&state=${state.status}`);
    state.orders = (data && data.list) || [];
    renderCurrent();
  } catch (error) {
    state.orders = [];
    clearList();
    renderEmpty();
    if (countEl) countEl.textContent = '共 0 单';
    showToast(`加载订单失败：${error.message}`, 'error');
  } finally {
    state.loading = false;
  }
}

/* ------------------------------------------------------------------ 交互 */

function bindTabs() {
  const setDirection = (direction) => {
    if (state.direction === direction) return;
    state.direction = direction;

    if (tabBorrow) {
      tabBorrow.classList.toggle('is-active', direction === 'borrow');
      tabBorrow.setAttribute('aria-selected', String(direction === 'borrow'));
    }
    if (tabLend) {
      tabLend.classList.toggle('is-active', direction === 'lend');
      tabLend.setAttribute('aria-selected', String(direction === 'lend'));
    }

    loadOrders();
  };

  if (tabBorrow) tabBorrow.addEventListener('click', () => setDirection('borrow'));
  if (tabLend) tabLend.addEventListener('click', () => setDirection('lend'));

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const value = Number(chip.dataset.state);
      if (Number.isNaN(value) || value === state.status) return;

      state.status = value;
      chips.forEach((item) => {
        const active = item === chip;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
      });

      loadOrders();
    });
  });
}

function init() {
  bindTabs();
  loadOrders();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
