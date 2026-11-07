'use strict';

/**
 * Token 黑名单（内存）
 * ---------------------------------------------------------------------------
 * 用途：退出登录后让已签发的 JWT 立即失效（JWT 本身无状态，无法主动作废）。
 * 实现：Map<token, expMs>，鉴权时命中即拒绝；到期后自动清理，避免无限增长。
 *
 * 局限（写进审计）：
 *   · 只存在单进程内存里，重启即清空；
 *   · 多实例部署需要换成 Redis 共享。
 */

/** token → 过期时间戳（毫秒） */
const blacklist = new Map();

/** 清理过期条目（每小时一次，惰性触发） */
const CLEAN_INTERVAL_MS = 60 * 60 * 1000;
let lastClean = 0;

function cleanup(now) {
  if (now - lastClean < CLEAN_INTERVAL_MS) return;
  lastClean = now;
  for (const [token, exp] of blacklist) {
    if (exp && exp <= now) blacklist.delete(token);
  }
}

/**
 * 拉黑一个 token
 * @param {string} token
 * @param {number} [expiresInSeconds] 该 token 剩余有效期
 */
function revoke(token, expiresInSeconds) {
  if (!token) return;
  const now = Date.now();
  const ttlMs =
    Number(expiresInSeconds) > 0 ? Number(expiresInSeconds) * 1000 : 7 * 24 * 3600 * 1000;
  blacklist.set(token, now + ttlMs);
  cleanup(now);
}

/**
 * 是否已拉黑
 * @param {string} token
 * @returns {boolean}
 */
function isRevoked(token) {
  if (!token) return false;

  const now = Date.now();
  cleanup(now);

  const exp = blacklist.get(token);
  if (exp === undefined) return false;

  if (exp <= now) {
    blacklist.delete(token);
    return false;
  }

  return true;
}

/** 当前黑名单大小（供健康检查/测试使用） */
function size() {
  return blacklist.size;
}

module.exports = { revoke, isRevoked, size, blacklist };
