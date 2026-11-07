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

/** localStorage 中 token 的键名 */
export const TOKEN_KEY = 'yxx_token';

/** Token 失效时派发的全局事件，页面可监听后跳转登录 */
export const AUTH_EXPIRED_EVENT = 'yxx:auth-expired';

/** 自定义「请重新登录」提示（默认 window.alert） */
let unauthorizedHandler = null;

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
function notifyAuthExpired() {
  try {
    if (typeof unauthorizedHandler === 'function') {
      unauthorizedHandler();
      return;
    }
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('登录已过期，请重新登录');
    }
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

  return payload.data;
}

export default request;
