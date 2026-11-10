/**
 * 前端请求封装（原生 Fetch，无第三方依赖）
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 统一 BASE_URL
 *   2. 自动注入 Authorization: Bearer <localStorage 中的 token>
 *   3. 统一处理 code !== 200：
 *        - 40101 → 清除本地 Token + 提示重新登录，并抛出 RequestError
 *        - 其他  → 抛出携带 code/msg/data 的 RequestError，交业务层捕获
 * 约定：请求成功时 resolve 后端 data 字段（已剥离信封），失败时 reject。
 *
 * 用法：
 *   import { request, setToken } from './request.js';
 *   const { list, pagination } = await request('/items?limit=10');
 */

/**
 * 接口基地址解析（按优先级）：
 *   1. window.__YXX_API_ORIGIN__（页面 head 注入）
 *   2. URL ?api=https://host —— 客户端启动时携带，写入 localStorage 持久化
 *   3. localStorage.yxx_api_origin
 *   4. file:// 场景（EXE / APK 本地包）默认 http://127.0.0.1:3000
 *   5. 其余情况同源相对路径（Web 端）
 */
/** EXE 客户端（app://）的兜底 API 地址，避免重定向丢失参数导致请求发往本地 */
const APP_CLIENT_API_ORIGIN = 'https://dqsf-hy-345260-13-1529260880.sh.run.tcloudbase.com';

function resolveApiOrigin() {
  if (typeof window === 'undefined') return '';
  try {
    if (window.__YXX_API_ORIGIN__) return String(window.__YXX_API_ORIGIN__).replace(/\/$/, '');

    const params = new URLSearchParams(window.location.search || '');
    const param = params.get('api');
    if (param) {
      const clean = String(param).replace(/\/$/, '');
      localStorage.setItem('yxx_api_origin', clean);
      return clean;
    }

    const stored = localStorage.getItem('yxx_api_origin');
    if (stored) return stored;

    if (window.location.protocol === 'app:') return APP_CLIENT_API_ORIGIN;

    if (window.location.protocol === 'file:') return 'http://127.0.0.1:3000';
  } catch {
    // 隐私模式或解析失败：回退同源
  }
  return '';
}

export const API_ORIGIN = resolveApiOrigin();
export const BASE_URL = `${API_ORIGIN}/api/v1`;

import { showToast } from '../components/feedback.js';

/** localStorage 中 token 的键名 */
export const TOKEN_KEY = 'yxx_token';

/** Token 失效时派发的全局事件，页面可监听后跳转登录 */
export const AUTH_EXPIRED_EVENT = 'yxx:auth-expired';

/** 自定义「请重新登录」提示（默认使用自研 Toast + 自动跳登录页） */
let unauthorizedHandler = null;

/* ------------------------------------------------------------ 离线缓存 */

/* ------------------------------------------------------------ 离线提示 */

const OFFLINE_BANNER_ID = 'yxx-offline-banner';
let offlineBannerEl = null;

/** 顶部提示：当前处于离线模式 */
export function showOfflineBanner(text = '当前为离线模式，展示本地缓存') {
  if (typeof document === 'undefined' || !document.body) return null;
  if (offlineBannerEl) return offlineBannerEl;

  const bar = document.createElement('div');
  bar.id = OFFLINE_BANNER_ID;
  bar.className = 'offline-banner';
  bar.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = 'offline-banner__icon';
  icon.textContent = '📡';

  const label = document.createElement('span');
  label.className = 'offline-banner__text';
  label.textContent = text;

  bar.append(icon, label);
  document.body.appendChild(bar);
  offlineBannerEl = bar;
  return bar;
}

/** 恢复在线后移除提示 */
export function hideOfflineBanner() {
  if (offlineBannerEl) {
    offlineBannerEl.remove();
    offlineBannerEl = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', hideOfflineBanner);
  window.addEventListener('offline', () => showOfflineBanner());
}

/** 离线缓存键前缀（与 SW 的 Cache Storage 相互独立） */
const OFFLINE_CACHE_PREFIX = 'yxx_cache_v1:';

/** 最多缓存多少条接口数据，避免把 localStorage 写满 */
const OFFLINE_CACHE_MAX = 20;

/** 只有「无 body 的 GET」才适合离线缓存 */
function isCacheable(url, options) {
  const method = String((options && options.method) || 'GET').toUpperCase();
  const body = options ? options.body : undefined;
  return method === 'GET' && (body === undefined || body === null) && typeof url === 'string';
}

/** 缓存键按登录用户隔离，避免切换账号串数据 */
function cacheKeyOf(url) {
  let uid = 'anon';
  try {
    const raw = JSON.parse(localStorage.getItem('yxx_user') || '{}');
    uid = raw && raw.user_id ? String(raw.user_id) : 'anon';
  } catch {
    uid = 'anon';
  }
  return OFFLINE_CACHE_PREFIX + uid + ':' + url;
}

/** 写入离线缓存（附带时间戳，便于按新旧淘汰） */
function writeOfflineCache(url, data) {
  try {
    localStorage.setItem(cacheKeyOf(url), JSON.stringify({ at: Date.now(), data }));
    trimOfflineCache();
  } catch {
    // 存储写满或不可用：忽略，不影响主流程
  }
}

/** 读取离线缓存，命中返回 data，否则返回 null */
function readOfflineCache(url) {
  try {
    const raw = localStorage.getItem(cacheKeyOf(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && 'data' in parsed ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 超出上限时按时间淘汰最旧的一条 */
function trimOfflineCache() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(OFFLINE_CACHE_PREFIX)) keys.push(key);
    }
    if (keys.length <= OFFLINE_CACHE_MAX) return;

    keys
      .map((key) => {
        let at = 0;
        try {
          at = JSON.parse(localStorage.getItem(key) || '{}').at || 0;
        } catch {
          at = 0;
        }
        return { key, at };
      })
      .sort((a, b) => a.at - b.at)
      .slice(0, keys.length - OFFLINE_CACHE_MAX)
      .forEach((item) => localStorage.removeItem(item.key));
  } catch {
    // 忽略
  }
}

/**
 * 请求异常：区分业务码与网络异常，便于业务层分支处理
 */
export class RequestError extends Error {
  /**
   * @param {string} message 中文提示
   * @param {number} code 业务码；0 表示网络异常
   * @param {*} [data] 后端返回的错误上下文
   */
  constructor(message, code, data = null) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
    this.data = data;
  }
}

/** 本机设备标识：用于服务端限流维度（首次调用时生成） */
function getDeviceId() {
  const KEY = 'yxx_device_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/**
 * 拼接接口绝对地址（用于 img src 等非 fetch 场景）
 * @param {string} path 以 / 开头的接口路径，如 /items/1/thumb
 * @returns {string}
 */
export function apiUrl(path) {
  const clean = String(path || '');
  return `${BASE_URL}${clean.startsWith('/') ? clean : '/' + clean}`;
}

/** 读取本地 Token */
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // 隐私模式下 localStorage 可能不可用，降级为未登录
    return null;
  }
}

/** 写入本地 Token */
export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 写入失败不阻塞主流程，下次请求会被网关判定为未登录
  }
}

/** 清除本地 Token */
export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 忽略
  }
}

/**
 * 自定义 Token 失效时的提示方式（例如换成 Toast 或跳转登录页）
 * @param {Function|null} handler
 */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

/** 通知业务层「需要重新登录」 */
/** 登录态失效：带 redirect 参数跳回登录页（已在登录页则不跳，避免死循环） */
function redirectToLogin() {
  try {
    if (typeof window === 'undefined' || !window.location) return;
    const path = String(window.location.pathname || '');
    if (path.endsWith('login.html') || path.endsWith('register.html')) return;

    const redirect = path + (window.location.search || '');
    setTimeout(() => {
      window.location.replace('./login.html?redirect=' + encodeURIComponent(redirect));
    }, 900);
  } catch {
    // 跳转失败不阻塞抛错
  }
}

function notifyAuthExpired() {
  try {
    if (typeof unauthorizedHandler === 'function') {
      unauthorizedHandler();
      return;
    }
    // 原生 alert 已移除：统一走自研 Toast + 自动回登录页
    showToast('登录已过期，请重新登录', 'error');
    redirectToLogin();
  } catch {
    // 提示本身失败不影响抛出错误
  }

  try {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { code: 40101 } }));
    }
  } catch {
    // 忽略事件派发异常
  }
}

/**
 * 发起请求
 * @param {string} url 以 / 开头的接口路径（不含 BASE_URL）
 * @param {RequestInit} [options] fetch 选项；body 为对象时会自动 JSON 序列化
 * @returns {Promise<*>} 后端 data 字段
 */
export async function request(url, options = {}) {
  const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});

  const deviceId = getDeviceId();
  if (deviceId) headers['X-Device-Id'] = deviceId;

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body = options.body;
  if (body !== undefined && body !== null && typeof body === 'object' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(BASE_URL + url, Object.assign({}, options, { headers, body }));
  } catch {
    // 真断网（SW 也拦不住）：优先回退本地缓存，让页面有数据可渲染
    if (isCacheable(url, options)) {
      const cached = readOfflineCache(url);
      if (cached !== null) {
        showOfflineBanner();
        return cached;
      }
    }
    showOfflineBanner('网络不可用，且暂无本地缓存');
    throw new RequestError('网络异常，请检查网络后重试', 0);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!payload || typeof payload !== 'object') {
    throw new RequestError(`服务响应异常（HTTP ${response.status}）`, response.status);
  }

  // Service Worker 的离线兜底响应：静默回退本地缓存，不打断用户
  if (payload.code === 50301) {
    if (isCacheable(url, options)) {
      const cached = readOfflineCache(url);
      if (cached !== null) {
        showOfflineBanner();
        return cached;
      }
    }
    showOfflineBanner();
    throw new RequestError(
      payload.msg || '当前为离线模式，展示本地数据',
      50301,
      payload.data || null
    );
  }

  if (payload.code !== 200) {
    // 未知接口（路由不存在）：旧客户端遇到接口升级时的兜底提示
    if (
      payload.code === 40401 &&
      payload.data &&
      typeof payload.data.path === 'string' &&
      payload.data.path.startsWith('/api/')
    ) {
      try {
        window.dispatchEvent(new CustomEvent('yxx:api-incompatible'));
      } catch {
        // 事件派发失败不影响主流程
      }
    }

    // 登录/注册接口的 401 属于"凭据错误"，不能当成会话过期处理
    const isAuthEndpoint = typeof url === 'string' && url.startsWith('/auth/');
    const isAuthError = !isAuthEndpoint && (payload.code === 40101 || response.status === 401);

    if (isAuthError) {
      clearToken();
      notifyAuthExpired();
      throw new RequestError(payload.msg || '未登录或Token失效', 40101, payload.data || null);
    }

    throw new RequestError(
      payload.msg || `请求失败（${payload.code}）`,
      payload.code,
      payload.data || null
    );
  }

  if (isCacheable(url, options)) {
    writeOfflineCache(url, payload.data);
  }

  return payload.data;
}

export default request;
