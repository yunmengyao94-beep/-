'use strict';

/**
 * 轻量限流中间件（内存固定窗口）
 * ---------------------------------------------------------------------------
 * 用途：登录 / 注册 / 信用奖励等敏感接口的基础防刷。
 * 维度：IP + 设备标识（前端在 X-Device-Id 头里带一个本机随机 ID）+ 接口前缀。
 *
 * 说明：
 *   · 单机内存计数，重启即清零；多实例部署需换成 Redis。
 *   · 只做"止血"，真正的防刷还要配合验证码、设备风控与服务端签发凭证。
 */

const { fail } = require('../utils/http');

/** key → { count, resetAt } */
const buckets = new Map();

/** 定期清理过期桶，避免内存无限增长 */
const CLEAN_INTERVAL_MS = 5 * 60 * 1000;
let lastClean = Date.now();

function cleanup(now) {
  if (now - lastClean < CLEAN_INTERVAL_MS) return;
  lastClean = now;
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}

/**
 * 创建限流中间件
 * @param {{windowMs?: number, max?: number, keyPrefix?: string, message?: string}} options
 */
function createRateLimit(options = {}) {
  const windowMs = Number(options.windowMs) || 60 * 1000;
  const max = Number(options.max) || 10;
  const keyPrefix = options.keyPrefix || 'default';
  const message = options.message || '操作过于频繁，请稍后再试';

  return function rateLimit(req, res, next) {
    const now = Date.now();
    cleanup(now);

    const device = String(req.get('X-Device-Id') || '').slice(0, 64);
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const key = `${keyPrefix}:${ip}:${device}`;

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return fail(req, res, 429, 42901, message, {
        retry_after: Math.ceil((bucket.resetAt - now) / 1000),
      });
    }

    return next();
  };
}

module.exports = { createRateLimit, buckets };
