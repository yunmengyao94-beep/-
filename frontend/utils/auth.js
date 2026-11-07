/**
 * 会话工具（去 Mock 化）
 * ---------------------------------------------------------------------------
 * 现在登录必须走 login.html 的账号校验；本模块只负责「取当前 Token」：
 *   · 有 Token → 直接返回
 *   · 无 Token → 抛 40101，由页面 catch 或路由守卫跳登录页
 *
 * 不再做任何「用固定学号自动换 Token」的兜底，避免绕过登录校验。
 */

import { getToken, RequestError } from './request.js';

/**
 * 确保存在可用 Token
 * @returns {Promise<string>} JWT
 */
export function ensureToken() {
  const existing = getToken();
  if (existing) return Promise.resolve(existing);

  return Promise.reject(new RequestError('登录已过期，请重新登录', 40101));
}

export default { ensureToken };
