/**
 * 柔和版本更新提示
 * ---------------------------------------------------------------------------
 * · 客户端（EXE / APK）：仅顶部提示「发现新版本，建议前往下载…」，可关闭、8 秒自动消失
 * · 浏览器：提示「发现新版本，请刷新页面体验」，提供刷新按钮
 * · 接口不兼容（旧客户端遇到 404/400）：提示「当前版本过低…」，不拦截任何操作
 */

import { isClientEnvironment } from './client-entry.js';
import { BASE_URL } from '../utils/request.js';
import { isNewerVersion } from '../utils/version.js';

/** 当前前端版本：与服务端 /system/version 对比 */
export const APP_VERSION = '1.0.0';

const BANNER_ID = 'yxx-version-banner';
const AUTO_HIDE_MS = 8000;

let bannerEl = null;
let hideTimer = null;
let incompatibleShown = false;

/** 移除提示条 */
export function hideVersionBanner() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }
}

/**
 * 展示提示条
 * @param {{text: string, actionText?: string, onAction?: Function, autoHide?: boolean}} options
 */
export function showVersionBanner(options = {}) {
  if (typeof document === 'undefined' || !document.body) return null;
  hideVersionBanner();

  const bar = document.createElement('div');
  bar.id = BANNER_ID;
  bar.className = 'version-banner';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');

  const icon = document.createElement('span');
  icon.className = 'version-banner__icon';
  icon.textContent = '✨';

  const text = document.createElement('span');
  text.className = 'version-banner__text';
  text.textContent = options.text || '发现新版本';

  const actions = document.createElement('span');
  actions.className = 'version-banner__actions';

  if (options.actionText && typeof options.onAction === 'function') {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'version-banner__action';
    action.textContent = options.actionText;
    action.addEventListener('click', () => {
      options.onAction();
      hideVersionBanner();
    });
    actions.appendChild(action);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'version-banner__close';
  close.setAttribute('aria-label', '关闭提示');
  close.textContent = '×';
  close.addEventListener('click', hideVersionBanner);
  actions.appendChild(close);

  bar.append(icon, text, actions);
  document.body.appendChild(bar);
  bannerEl = bar;

  if (options.autoHide) {
    hideTimer = setTimeout(hideVersionBanner, AUTO_HIDE_MS);
  }

  return bar;
}

/** 查询服务端版本并给出柔和提示 */
export async function checkVersion() {
  if (typeof fetch !== 'function') return null;

  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;

    const response = await fetch(`${BASE_URL}/system/version`, {
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined,
    });
    if (timer) clearTimeout(timer);

    const payload = await response.json();
    const info = payload && payload.data;
    if (!info || !info.version) return null;

    if (!isNewerVersion(info.version, APP_VERSION)) return null;

    const client = isClientEnvironment();

    if (client) {
      showVersionBanner({
        text: '发现新版本，建议前往下载体验最新功能',
        autoHide: true,
      });
    } else {
      showVersionBanner({
        text: '发现新版本，请刷新页面体验',
        actionText: '刷新',
        onAction: () => window.location.reload(),
      });
    }

    return info;
  } catch {
    // 版本检查失败完全静默：不影响任何功能
    return null;
  }
}

/** 旧客户端遇到接口不兼容时的提示（每个会话只提示一次） */
export function warnClientOutdated() {
  if (incompatibleShown) return;
  if (!isClientEnvironment()) return;
  incompatibleShown = true;

  showVersionBanner({
    text: '当前版本过低，部分功能可能受限，建议更新',
    autoHide: true,
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('yxx:api-incompatible', warnClientOutdated);
}

export default {
  checkVersion,
  warnClientOutdated,
  showVersionBanner,
  hideVersionBanner,
  APP_VERSION,
};
