'use strict';

/**
 * 游标分页工具（计划书 6.4：created_at + id 游标分页，禁止深分页）
 * ---------------------------------------------------------------
 * cursor 形态：base64url(JSON) → {"id": 123}，客户端不可解析、只回传。
 * 同时兼容纯数字 cursor，便于 curl 手工调试。
 */

const MAX_LIMIT = 50; // 7.1：limit 上限 50
const DEFAULT_LIMIT = 10;

/**
 * 解析 limit 查询参数
 * @param {*} raw 原始查询值
 * @returns {{value?: number, error?: string}}
 */
function parseLimit(raw) {
  if (raw === undefined || raw === '') return { value: DEFAULT_LIMIT };

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return { error: 'limit 必须是 ≥1 的整数' };
  if (n > MAX_LIMIT) return { error: `limit 不得超过 ${MAX_LIMIT}` };
  return { value: n };
}

/**
 * 生成游标
 * @param {number} id 末条记录 id
 * @returns {string}
 */
function encodeCursor(id) {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

/**
 * 解析游标
 * @param {*} raw 原始 cursor 值
 * @returns {{id: number|null, error?: string}}
 */
function decodeCursor(raw) {
  if (raw === undefined || raw === '') return { id: null };

  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return { id: Number(text) };

  try {
    const obj = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (obj && Number.isInteger(obj.id) && obj.id >= 0) return { id: obj.id };
  } catch {
    // 解析失败统一走下方错误分支
  }
  return { id: null, error: 'cursor 非法，请原样回传 next_cursor' };
}

module.exports = { MAX_LIMIT, DEFAULT_LIMIT, parseLimit, encodeCursor, decodeCursor };
