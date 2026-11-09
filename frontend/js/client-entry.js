/**
 * 客户端环境识别 + 下载引导
 * ---------------------------------------------------------------------------
 * 识别规则（满足任一即为客户端，隐藏所有「下载客户端」入口）：
 *   1. UA 含 YXX-Client（Electron 打包版会改写 UA）
 *   2. URL 带 ?client=exe 或 ?client=apk（首次进入时写入本地标记）
 *   3. 本地已存在标记（APK 包内写入，或之前通过链接进入过）
 *
 * 普通浏览器点击「下载客户端」时：PC 引导安装 PWA，移动端引导添加主屏幕。
 */

import { openModal } from '../components/feedback.js';

const CLIENT_UA_PATTERN = /YXX-Client/i;
const CLIENT_STORAGE_KEY = 'yxx_client';
const CLIENT_FLAGS = new Set(['exe', 'apk']);

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 解析当前环境
 * @param {{search?: string, ua?: string, storage?: Storage|null}} [options]
 * @returns {''|'exe'|'apk'}
 */
export function detectClientEnvironment(options = {}) {
  const search = options.search !== undefined ? options.search : window.location.search;
  const ua = options.ua !== undefined ? options.ua : navigator.userAgent;
  const storage = options.storage !== undefined ? options.storage : safeStorage();

  const params = new URLSearchParams(search || '');
  const flag = String(params.get('client') || '').toLowerCase();

  // 浏览器参数优先：?client=browser 可临时退出客户端标记（便于调试）
  if (flag === 'browser') {
    try {
      storage && storage.removeItem(CLIENT_STORAGE_KEY);
    } catch {
      // 忽略
    }
    return '';
  }

  if (CLIENT_FLAGS.has(flag)) {
    try {
      storage && storage.setItem(CLIENT_STORAGE_KEY, flag);
    } catch {
      // 忽略
    }
    return flag;
  }

  if (CLIENT_UA_PATTERN.test(String(ua))) return 'exe';

  try {
    const stored = storage && storage.getItem(CLIENT_STORAGE_KEY);
    return CLIENT_FLAGS.has(stored) ? stored : '';
  } catch {
    return '';
  }
}

/** 是否运行在客户端内 */
export function isClientEnvironment() {
  return Boolean(detectClientEnvironment());
}

/** 隐藏所有下载入口 */
export function hideDownloadEntries(root = document) {
  root.querySelectorAll('[data-download-client]').forEach((el) => {
    el.hidden = true;
  });
}

/** 当前是否手机端（与 device.js 的 body class 保持一致） */
function isMobileViewport() {
  const body = document.body;
  if (body && body.classList.contains('is-mobile')) return true;
  return (
    /Android|iPhone|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) && window.innerWidth < 768
  );
}

/** 弹出下载引导 */
export function showDownloadGuide() {
  if (isClientEnvironment()) return;

  const mobile = isMobileViewport();

  if (mobile) {
    openModal(
      '下载客户端',
      `
        <div class="client-guide">
          <p class="client-guide__lead">安卓客户端正在内测中，当前可直接将网页添加到桌面主屏幕体验。</p>
          <ol class="client-guide__steps">
            <li>安卓 Chrome：右上角「⋮」→「添加到主屏幕」</li>
            <li>iOS Safari：底部「分享」→「添加到主屏幕」</li>
            <li>添加后从桌面图标进入，体验接近原生 App</li>
          </ol>
          <p class="client-guide__tip">内测版本会通过消息中心通知，敬请期待。</p>
        </div>
      `
    );
    return;
  }

  openModal(
    '下载客户端',
    `
      <div class="client-guide">
        <p class="client-guide__lead">庆师易校圈已支持 PWA 桌面端安装，请在浏览器地址栏右侧点击“安装”图标。</p>
        <ol class="client-guide__steps">
          <li>Chrome / Edge 地址栏右侧出现「安装」图标，点击即可</li>
          <li>若未出现：菜单「⋮」→「安装庆师易校圈」</li>
          <li>安装后从桌面图标启动，独立窗口、无地址栏</li>
        </ol>
        <p class="client-guide__tip">Windows / macOS 均可安装，不额外占用安装空间。</p>
      </div>
    `
  );
}

/** 初始化：标记环境 + 隐藏入口 + 绑定点击（事件委托，兼容动态渲染） */
export function initClientEntry() {
  const env = detectClientEnvironment();

  if (env) {
    document.documentElement.dataset.client = env;
    if (document.body) document.body.classList.add('is-client');
    hideDownloadEntries();
  }

  document.addEventListener('click', (event) => {
    const trigger =
      event.target && event.target.closest && event.target.closest('[data-download-client]');
    if (!trigger) return;
    event.preventDefault();
    showDownloadGuide();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initClientEntry, { once: true });
  } else {
    initClientEntry();
  }
}

export default {
  detectClientEnvironment,
  isClientEnvironment,
  hideDownloadEntries,
  showDownloadGuide,
};
