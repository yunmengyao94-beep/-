/**
 * 设置页
 * ---------------------------------------------------------------------------
 * · 展示当前账号（来自 localStorage.yxx_user）
 * · 清除离线缓存（Cache Storage）
 * · 清空本地订单
 * · 退出登录（清 Token / 用户 / 缓存 → 回登录页）
 */

import { showToast } from '../components/feedback.js';
import { clearToken } from '../utils/request.js';

const USER_KEY = 'yxx_user';
const ORDER_KEY = 'yxx_orders';

const backBtn = document.getElementById('back-btn');
const accountLabel = document.getElementById('account-label');
const cacheState = document.getElementById('cache-state');
const rowClearCache = document.getElementById('row-clear-cache');
const rowClearOrders = document.getElementById('row-clear-orders');
const rowLogout = document.getElementById('row-logout');

/** 读取本地用户 */
function readUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function renderAccount() {
  if (!accountLabel) return;
  const user = readUser();
  if (!user) {
    accountLabel.textContent = '未登录';
    return;
  }
  const name = user.nickname || user.real_name || '同学';
  const no = user.student_no || '';
  accountLabel.textContent = no ? `${name}（${no}）` : name;
}

/** 统计 Cache Storage 占用 */
async function refreshCacheState() {
  if (!cacheState) return;

  if (typeof caches === 'undefined') {
    cacheState.textContent = '不支持';
    return;
  }

  try {
    const keys = await caches.keys();
    if (keys.length === 0) {
      cacheState.textContent = '无缓存';
      return;
    }
    let count = 0;
    for (const key of keys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      count += requests.length;
    }
    cacheState.textContent = `${count} 项`;
  } catch {
    cacheState.textContent = '读取失败';
  }
}

/** 清空 Cache Storage */
async function clearCaches() {
  if (typeof caches === 'undefined') return 0;

  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  return keys.length;
}

function bindBack() {
  if (!backBtn) return;
  backBtn.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = './profile.html';
  });
}

function bindClearCache() {
  if (!rowClearCache) return;

  const run = async () => {
    try {
      const removed = await clearCaches();
      await refreshCacheState();
      showToast(removed ? '离线缓存已清除' : '当前没有缓存', 'success');
    } catch (error) {
      showToast(`清除失败：${error.message}`, 'error');
    }
  };

  rowClearCache.addEventListener('click', run);
  rowClearCache.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      run();
    }
  });
}

function bindClearOrders() {
  if (!rowClearOrders) return;

  const run = () => {
    try {
      localStorage.removeItem(ORDER_KEY);
      showToast('本地订单记录已清空', 'success');
    } catch (error) {
      showToast(`清空失败：${error.message}`, 'error');
    }
  };

  rowClearOrders.addEventListener('click', run);
  rowClearOrders.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      run();
    }
  });
}

function bindLogout() {
  if (!rowLogout) return;

  const run = async () => {
    clearToken();
    try {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(ORDER_KEY);
    } catch {
      // 忽略
    }
    try {
      await clearCaches();
    } catch {
      // 忽略
    }
    showToast('已退出登录', 'success');
    setTimeout(() => {
      window.location.href = './login.html';
    }, 500);
  };

  rowLogout.addEventListener('click', run);
  rowLogout.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      run();
    }
  });
}

function init() {
  bindBack();
  renderAccount();
  bindClearCache();
  bindClearOrders();
  bindLogout();
  refreshCacheState();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
