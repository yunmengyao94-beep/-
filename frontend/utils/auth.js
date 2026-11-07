/**
 * 会话工具：按需用 mock 学号换取 JWT
 * ---------------------------------------------------------------------------
 * 详情页、发布页都需要「进入写操作时才登录」的行为：
 *   - 浏览类接口是公开的，页面不能强制登录
 *   - 写接口（下单 / 发布）需要 Token，此时才用 mock 学号换一次 JWT
 * 换取结果由 utils/request.js 自动注入到后续请求头。
 */

import { getToken, setToken, request } from './request.js';

/** Mock 登录学号（与 server/mock_db.json 中张同学一致） */
export const MOCK_STUDENT_NO = '2599080110120';

/** 并发去重：多个请求同时要 Token 时只换一次 */
let tokenPromise = null;

/**
 * 确保存在可用 Token
 * @returns {Promise<string>} JWT
 */
export function ensureToken() {
  const existing = getToken();
  if (existing) return Promise.resolve(existing);

  if (!tokenPromise) {
    tokenPromise = request('/auth/login', {
      method: 'POST',
      body: { student_no: MOCK_STUDENT_NO },
    })
      .then((data) => {
        const token = data && data.token;
        if (token) setToken(token);
        tokenPromise = null;
        return token;
      })
      .catch((error) => {
        tokenPromise = null;
        throw error;
      });
  }

  return tokenPromise;
}

export default { ensureToken, MOCK_STUDENT_NO };
