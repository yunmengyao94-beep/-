/**
 * 设置页逻辑
 * ---------------------------------------------------------------------------
 * 账号管理：当前账号 / 多账号切换（弹窗）/ 退出当前账号
 * 通用隐私：深色模式 / 清除缓存（Cache Storage + 离线数据）/ 清空本地订单
 * 关于：版本号 / 用户协议
 */

import { showToast, openModal, closeModal } from '../components/feedback.js';
import { clearToken, request } from '../utils/request.js';
import { listAccounts, removeAccount } from '../utils/accounts.js';
import { resetGuide } from '../components/onboarding.js';
import { clearItemImages } from '../utils/item-images.js';
import {
  FONT_SIZE_MAP,
  getFontSizeKey,
  applyFontSize as applyFontSizePreference,
} from '../utils/preferences.js';

const TOKEN_KEY = 'yxx_token';
const USER_KEY = 'yxx_user';
const ORDER_KEY = 'yxx_orders';
const THEME_KEY = 'yxx_theme';
const OFFLINE_CACHE_PREFIX = 'yxx_cache_v1:';

const backBtn = document.getElementById('back-btn');
const currentAccountEl = document.getElementById('current-account');
const accountCountEl = document.getElementById('account-count');
const rowSwitchAccount = document.getElementById('row-switch-account');
const rowLogout = document.getElementById('row-logout');
const themeSwitch = document.getElementById('theme-switch');
const rowClearCache = document.getElementById('row-clear-cache');
const cacheStateEl = document.getElementById('cache-state');
const rowClearOrders = document.getElementById('row-clear-orders');

/* ------------------------------------------------------------------ 工具 */

function readUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function currentStudentNo() {
  const user = readUser();
  return user && user.student_no ? user.student_no : '';
}

/** 渲染账号区 */
function renderAccount() {
  const user = readUser();
  const accounts = listAccounts();

  if (currentAccountEl) {
    if (!user) {
      currentAccountEl.textContent = '未登录';
    } else {
      const name = user.nickname || user.real_name || '同学';
      const no = user.student_no || '';
      currentAccountEl.textContent = no ? `${name}（${no}）` : name;
    }
  }

  if (accountCountEl) {
    accountCountEl.textContent = `${accounts.length} 个账号 →`;
  }
}

/* ------------------------------------------------------------ 账号切换 */

/** 打开账号列表弹窗 */
function openAccountPicker() {
  const accounts = listAccounts();
  const current = currentStudentNo();

  if (accounts.length === 0) {
    showToast('本地还没有保存的账号，请先登录一次', 'error');
    return;
  }

  const rows = accounts
    .map((account) => {
      const isCurrent = account.student_no === current;
      return [
        `<div class="account-row${isCurrent ? ' is-current' : ''}" data-student-no="${account.student_no}" role="button" tabindex="0">`,
        '<span class="account-row__main">',
        `<span class="account-row__name">${escapeHtml(account.nickname || '同学')}</span>`,
        `<span class="account-row__meta">${escapeHtml(account.student_no)}</span>`,
        '</span>',
        `<span class="account-row__check">${isCurrent ? '当前' : '切换'}</span>`,
        '</div>',
      ].join('');
    })
    .join('');

  const body = [
    `<div class="account-list" id="account-list">${rows}</div>`,
    '<div class="ai-modal__actions">',
    '<a class="btn btn--secondary" href="./login.html">添加账号</a>',
    '<button class="btn btn--primary" id="account-close" type="button">完成</button>',
    '</div>',
  ].join('');

  const mask = openModal('切换账号', body);
  if (!mask) return;

  const closeBtn = mask.querySelector('#account-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  mask.querySelectorAll('.account-row').forEach((row) => {
    row.addEventListener('click', () => {
      const studentNo = row.dataset.studentNo;
      if (!studentNo || studentNo === current) {
        closeModal();
        return;
      }
      switchToAccount(studentNo);
    });
  });
}

/** 切换到指定账号 */
function switchToAccount(studentNo) {
  const account = listAccounts().find((item) => item.student_no === studentNo);
  if (!account || !account.token) {
    showToast('该账号凭证已失效，请重新登录', 'error');
    return;
  }

  try {
    localStorage.setItem(TOKEN_KEY, account.token);
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        user_id: account.user_id,
        student_no: account.student_no,
        nickname: account.nickname,
        real_name: account.real_name,
        credit_available: account.credit_available,
      })
    );
  } catch {
    showToast('切换失败：本地存储不可用', 'error');
    return;
  }

  closeModal();
  showToast(`已切换到 ${account.nickname || studentNo}`, 'success');

  setTimeout(() => {
    window.location.href = './index.html';
  }, 600);
}

/* ------------------------------------------------------------ 退出登录 */

async function logout() {
  // 先让服务端把当前 Token 拉黑（失败不影响本地退出）
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch {
    // 忽略：可能已过期
  }

  clearToken();
  try {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ORDER_KEY);
  } catch {
    // 忽略
  }

  await clearAllCaches();

  showToast('已退出登录', 'success');
  setTimeout(() => {
    window.location.href = './login.html';
  }, 500);
}

/** 退出并移除该账号的本地记录（长按语义：仅退出不删） */
function forgetAccount(studentNo) {
  removeAccount(studentNo);
  renderAccount();
}

/* -------------------------------------------------------------- 深色模式 */

function applyTheme(dark) {
  const root = document.documentElement;
  if (dark) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
}

function bindTheme() {
  if (!themeSwitch) return;

  const saved = (() => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  })();

  const isDark = saved === 'dark';
  themeSwitch.checked = isDark;
  applyTheme(isDark);

  themeSwitch.addEventListener('change', () => {
    const dark = themeSwitch.checked;
    applyTheme(dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // 忽略
    }
    showToast(dark ? '已开启深色模式' : '已关闭深色模式', 'success');
  });
}

/* ---------------------------------------------------------------- 缓存 */

/** 清空 Cache Storage + 离线数据缓存 */
async function clearAllCaches() {
  let removedCaches = 0;
  let removedEntries = 0;

  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      removedCaches = keys.length;
    } catch {
      removedCaches = 0;
    }
  }

  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(OFFLINE_CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
    removedEntries = keys.length;

    // 本地物品图片（发布时缓存的 Base64）也一并清掉
    clearItemImages();
  } catch {
    removedEntries = 0;
  }

  return { removedCaches, removedEntries };
}

async function refreshCacheState() {
  if (!cacheStateEl) return;

  if (typeof caches === 'undefined') {
    cacheStateEl.textContent = '不支持';
    return;
  }

  try {
    const keys = await caches.keys();
    let count = 0;
    for (const key of keys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      count += requests.length;
    }
    cacheStateEl.textContent = count ? `${count} 项` : '无缓存';
  } catch {
    cacheStateEl.textContent = '读取失败';
  }
}

function bindClearCache() {
  if (!rowClearCache) return;

  const run = async () => {
    try {
      const { removedCaches, removedEntries } = await clearAllCaches();
      await refreshCacheState();

      // 本地图片不入持久化存储（发布页仅在内存中预览），这里一并清掉可能残留的图片缓存
      const detail = [
        removedCaches ? `${removedCaches} 个缓存空间` : '',
        removedEntries ? `${removedEntries} 条离线数据` : '',
        '本地图片缓存',
      ]
        .filter(Boolean)
        .join('、');

      showToast(`缓存已清除（${detail}）`, 'success');
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

/* ------------------------------------------------------- 显示与偏好 */

/** 应用字号（实时改 CSS 变量并持久化） */
function applyFontSize(key) {
  const applied = applyFontSizePreference(key);
  const size = FONT_SIZE_MAP[applied] || FONT_SIZE_MAP.standard;
  const _size = size;

  const group = document.getElementById('font-size-options');
  if (group) {
    group.querySelectorAll('[data-size]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.size === applied);
    });
  }
}

/** 字号滑块：0=小 1=标准 2=大 */
const FONT_SIZE_KEYS = ['small', 'standard', 'large'];

/** 绑定字号滑块（拖动实时改 CSS 变量，松手提示） */
function bindFontSize() {
  const range = document.getElementById('font-size-range');
  if (!range) return;

  const current = getFontSizeKey();
  const startIndex = Math.max(0, FONT_SIZE_KEYS.indexOf(current));

  const paint = (index) => {
    const ratio = index / 2;
    range.style.setProperty('--slider-fill', `${ratio * 100}%`);
  };

  range.value = String(startIndex);
  paint(startIndex);
  applyFontSize(current);

  range.addEventListener('input', () => {
    const index = Math.min(2, Math.max(0, Number(range.value)));
    applyFontSize(FONT_SIZE_KEYS[index]);
    paint(index);
  });

  range.addEventListener('change', () => {
    const index = Math.min(2, Math.max(0, Number(range.value)));
    showToast(`字体大小：${['小', '标准', '大'][index]}`, 'success');
  });
}

/* ------------------------------------------------------- 帮助与反馈 */

/** 打开问题反馈弹窗 */
function openFeedbackModal() {
  const html = [
    '<div class="feedback-form">',
    '<textarea class="feedback-form__textarea" id="feedback-text" maxlength="500" ',
    'placeholder="请描述你遇到的问题或建议（最多 500 字）"></textarea>',
    '<label class="feedback-form__file">',
    '上传截图（可选）：<input type="file" id="feedback-file" accept="image/*" />',
    '</label>',
    '<p class="field-error hidden" id="feedback-error"></p>',
    '<div class="ai-modal__actions">',
    '<button class="btn btn--secondary" id="feedback-cancel" type="button">取消</button>',
    '<button class="btn btn--primary" id="feedback-submit" type="button">提交</button>',
    '</div>',
    '</div>',
  ].join('');

  const mask = openModal('问题反馈', html);
  if (!mask) return;

  const textarea = mask.querySelector('#feedback-text');
  const fileInput = mask.querySelector('#feedback-file');
  const errorNode = mask.querySelector('#feedback-error');
  const cancelBtn = mask.querySelector('#feedback-cancel');
  const submitBtn = mask.querySelector('#feedback-submit');

  const setError = (message) => {
    if (!errorNode) return;
    errorNode.textContent = message || '';
    errorNode.classList.toggle('hidden', !message);
  };

  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const content = textarea ? textarea.value.trim() : '';
      if (content.length < 5) {
        setError('请至少填写 5 个字，方便我们定位问题');
        return;
      }

      // 演示版：反馈存本机（生产应 POST 到反馈服务 + 对象存储截图）
      try {
        const raw = localStorage.getItem('yxx_feedback');
        const list = raw ? JSON.parse(raw) : [];
        list.push({
          content,
          screenshot:
            fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0].name : '',
          created_at: new Date().toISOString(),
        });
        localStorage.setItem('yxx_feedback', JSON.stringify(list.slice(-20)));
      } catch {
        // 忽略
      }

      closeModal();
      showToast('反馈已收到，感谢你的建议', 'success');
    });
  }
}

/** 多语言：暂只支持简体中文 */
function openLanguagePicker() {
  const html = [
    '<p class="ai-modal__text">当前仅支持简体中文，English 正在开发中，敬请期待。</p>',
    '<div class="ai-modal__actions">',
    '<button class="btn btn--primary" id="lang-ok" type="button">我知道了</button>',
    '</div>',
  ].join('');

  const mask = openModal('多语言', html);
  if (!mask) return;

  const okBtn = mask.querySelector('#lang-ok');
  if (okBtn) okBtn.addEventListener('click', closeModal);
}

/** 绑定帮助与反馈 / 多语言 */
function bindHelpAndLanguage() {
  const feedbackRow = document.getElementById('row-feedback');
  if (feedbackRow) {
    feedbackRow.addEventListener('click', openFeedbackModal);
    feedbackRow.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFeedbackModal();
      }
    });
  }

  const languageRow = document.getElementById('row-language');
  if (languageRow) {
    languageRow.addEventListener('click', openLanguagePicker);
    languageRow.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLanguagePicker();
      }
    });
  }
}

/* ------------------------------------------------------------------ 绑定 */

/** 重新查看新手引导：清除标记后回首页触发 */
function replayGuide() {
  resetGuide();
  window.location.href = './index.html?guide=1';
}

function bindBack() {
  if (!backBtn) return;
  backBtn.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = './profile.html';
  });
}

function bindAccountActions() {
  if (rowSwitchAccount) {
    rowSwitchAccount.addEventListener('click', openAccountPicker);
    rowSwitchAccount.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openAccountPicker();
      }
    });
  }

  if (rowLogout) {
    rowLogout.addEventListener('click', logout);
    rowLogout.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        logout();
      }
    });
  }
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function init() {
  bindBack();
  bindAccountActions();
  bindTheme();
  bindClearCache();
  bindClearOrders();
  bindFontSize();
  bindHelpAndLanguage();

  const replayRow = document.getElementById('row-replay-guide');
  if (replayRow) {
    replayRow.addEventListener('click', replayGuide);
    replayRow.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        replayGuide();
      }
    });
  }
  renderAccount();
  refreshCacheState();

  // 暴露给控制台/后续扩展：删除某个账号记录
  window.__yxxForgetAccount = forgetAccount;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
