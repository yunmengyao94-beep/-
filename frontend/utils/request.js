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

export const BASE_URL = 'http://localhost:3000/api/v1';

import { showToast } from '../components/feedback.js';

/** localStorage 中 token 的键名 */
export const TOKEN_KEY = 'yxx_token';

/** Token 失效时派发的全局事件，页面可监听后跳转登录 */
export const AUTH_EXPIRED_EVENT = 'yxx:auth-expired';

/** 自定义「请重新登录」提示（默认使用自研 Toast + 自动跳登录页） */
let unauthorizedHandler = null;

/* ------------------------------------------------------------ 离线缓存 */

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

/** 写入离线缓存（附带时间戳，便于按新旧淘汰） */
function writeOfflineCache(url, data) {
  try {
    localStorage.setItem(OFFLINE_CACHE_PREFIX + url, JSON.stringify({ at: Date.now(), data }));
    trimOfflineCache();
  } catch {
    // 存储写满或不可用：忽略，不影响主流程
  }
}

/** 读取离线缓存，命中返回 data，否则返回 null */
function readOfflineCache(url) {
  try {
    const raw = localStorage.getItem(OFFLINE_CACHE_PREFIX + url);
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
      if (cached !== null) return cached;
    }
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
      if (cached !== null) return cached;
    }
    throw new RequestError(
      payload.msg || '当前为离线模式，展示本地数据',
      50301,
      payload.data || null
    );
  }

  if (payload.code !== 200) {
    const isAuthError = payload.code === 40101 || response.status === 401;

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
