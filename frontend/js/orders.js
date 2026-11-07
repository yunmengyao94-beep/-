/**
 * 我的订单
 * ---------------------------------------------------------------------------
 * 数据来源：localStorage.yxx_orders（详情页借用成功后写入）
 * 说明：Mock 后端暂无「我的订单」查询接口，本页先读本地缓存，
 *       后续接入 GET /api/v1/orders 时替换 loadOrders() 即可。
 */

import { showToast } from '../components/feedback.js';
import { formatTime } from '../utils/format.js';

const ORDER_KEY = 'yxx_orders';

const listEl = document.getElementById('order-list');
const emptyEl = document.getElementById('order-empty');
const countEl = document.getElementById('order-count');
const backBtn = document.getElementById('back-btn');

/** 状态文案 */
const STATE_TEXT = {
  0: '待交接',
  1: '借用中',
  2: '已归还',
  3: '已取消',
  4: '逾期',
};

const STATE_CLASS = {
  0: 'badge--warning',
  1: 'badge--primary',
  2: 'badge--success',
  3: 'badge--outline',
  4: 'badge--danger',
};

/** 读取本地订单 */
function readOrders() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 渲染单条订单 */
function createOrderItem(order) {
  const item = document.createElement('li');
  item.className = 'order-item';

  const head = document.createElement('div');
  head.className = 'order-item__head';

  const title = document.createElement('span');
  title.className = 'order-item__title';
  title.textContent = order.item_title || `物品 #${order.item_id ?? '—'}`;

  const state = Number(order.state) || 0;
  const badge = document.createElement('span');
  badge.className = `badge ${STATE_CLASS[state] || 'badge--outline'}`;
  badge.textContent = STATE_TEXT[state] || '未知';

  head.append(title, badge);

  const meta = document.createElement('span');
  meta.className = 'order-item__meta';
  const parts = [`冻结 ${order.frozen_score ?? 0} 分`];
  if (order.due_at) parts.push(`应还 ${formatTime(order.due_at)}`);
  if (order.order_id) parts.push(`单号 ${order.order_id}`);
  meta.textContent = parts.join(' · ');

  item.append(head, meta);
  return item;
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
  icon.textContent = '📦';

  const text = document.createElement('p');
  text.className = 'empty-state__text';
  text.textContent = '还没有借用记录';

  const desc = document.createElement('p');
  desc.className = 'empty-state__desc';
  desc.textContent = '去首页挑一件物品，发起你的第一次借用';

  wrap.append(icon, text, desc);
  emptyEl.appendChild(wrap);
}

function loadOrders() {
  const orders = readOrders();

  if (countEl) countEl.textContent = `共 ${orders.length} 单`;

  if (orders.length === 0) {
    if (listEl) listEl.classList.add('hidden');
    renderEmpty();
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (listEl) {
    listEl.classList.remove('hidden');
    listEl.textContent = '';
    const frag = document.createDocumentFragment();
    orders.forEach((order) => frag.appendChild(createOrderItem(order)));
    listEl.appendChild(frag);
  }
}

function init() {
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (window.history.length > 1) window.history.back();
      else window.location.href = './profile.html';
    });
  }

  try {
    loadOrders();
  } catch (error) {
    showToast(`加载订单失败：${error.message}`, 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
