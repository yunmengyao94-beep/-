/**
 * 消息中心
 * ---------------------------------------------------------------------------
 * 数据：GET /notifications（时间倒序 + 未读数）
 * 操作：点击单条标记已读（PUT /notifications/:id/read）、顶部「全部已读」
 */

import { request } from '../utils/request.js';
import { showToast } from '../components/feedback.js';
import { formatTime } from '../utils/format.js';

const listEl = document.getElementById('notice-list');
const emptyEl = document.getElementById('notice-empty');
const countEl = document.getElementById('notice-count');
const readAllBtn = document.getElementById('read-all-btn');

let notices = [];

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
  icon.textContent = '🔔';

  const text = document.createElement('p');
  text.className = 'empty-state__text';
  text.textContent = '暂无消息';

  const desc = document.createElement('p');
  desc.className = 'empty-state__desc';
  desc.textContent = '借用、归还等动态会在这里提醒你';

  wrap.append(icon, text, desc);
  emptyEl.appendChild(wrap);
}

/** 单条通知 */
function createItem(notice) {
  const li = document.createElement('li');
  li.className = `notice-item${notice.is_read ? '' : ' is-unread'}`;
  li.dataset.id = String(notice.id);

  const dot = document.createElement('span');
  dot.className = 'notice-item__dot';
  dot.setAttribute('aria-hidden', 'true');

  const main = document.createElement('div');
  main.className = 'notice-item__main';

  const title = document.createElement('p');
  title.className = 'notice-item__title';
  title.textContent = notice.title || '通知';

  const body = document.createElement('p');
  body.className = 'notice-item__body';
  body.textContent = notice.body || '';

  const time = document.createElement('span');
  time.className = 'notice-item__time';
  time.textContent = formatTime(notice.created_at) || '';

  main.append(title, body, time);
  li.append(dot, main);

  li.addEventListener('click', () => markRead(notice, li));

  return li;
}

/** 渲染列表 */
function render() {
  clearList();

  if (countEl) {
    const unread = notices.filter((item) => !item.is_read).length;
    countEl.textContent = unread > 0 ? `${unread} 条未读` : `共 ${notices.length} 条`;
  }

  if (notices.length === 0) {
    renderEmpty();
    return;
  }

  const fragment = document.createDocumentFragment();
  notices.forEach((notice) => fragment.appendChild(createItem(notice)));
  listEl.appendChild(fragment);
}

/** 单条已读 */
async function markRead(notice, node) {
  if (notice.is_read) return;

  try {
    await request(`/notifications/${notice.id}/read`, { method: 'PUT' });
    notice.is_read = true;
    if (node) node.classList.remove('is-unread');
    if (countEl) {
      const unread = notices.filter((item) => !item.is_read).length;
      countEl.textContent = unread > 0 ? `${unread} 条未读` : `共 ${notices.length} 条`;
    }
    document.dispatchEvent(new CustomEvent('yxx:notifications-changed'));
  } catch (error) {
    showToast(`标记失败：${error.message}`, 'error');
  }
}

/** 全部已读 */
async function markAllRead() {
  const unread = notices.filter((item) => !item.is_read).length;
  if (unread === 0) {
    showToast('没有未读消息', 'success');
    return;
  }

  try {
    await request('/notifications/read-all', { method: 'PUT' });
    notices = notices.map((item) => ({ ...item, is_read: true }));
    render();
    showToast('全部消息已标为已读', 'success');
    document.dispatchEvent(new CustomEvent('yxx:notifications-changed'));
  } catch (error) {
    showToast(`操作失败：${error.message}`, 'error');
  }
}

/** 加载 */
async function load() {
  try {
    const data = await request('/notifications');
    notices = (data && data.list) || [];
    render();
  } catch (error) {
    notices = [];
    clearList();
    renderEmpty();
    showToast(`加载消息失败：${error.message}`, 'error');
  }
}

function init() {
  if (readAllBtn) readAllBtn.addEventListener('click', markAllRead);
  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
