'use strict';

/**
 * 消息中转仓（内存）
 * ---------------------------------------------------------------------------
 * 定位：只做「点对点聊天中转」，绝不写入 db.json，零磁盘压力。
 * 生命周期：每条消息 1 小时后自动过期；每 5 分钟惰性清理一次。
 */

/** 消息保留时长：1 小时 */
const TTL_MS = 60 * 60 * 1000;

/** 内存中的消息列表 */
let messages = [];
let seq = 0;

/** 最近一次清理时间 */
let lastCleanAt = 0;

/** 清理过期消息（幂等，惰性调用） */
function prune(now = Date.now()) {
  if (now - lastCleanAt < 5 * 60 * 1000 && messages.length < 500) return 0;
  lastCleanAt = now;

  const before = messages.length;
  messages = messages.filter((message) => message.expires_at > now);
  return before - messages.length;
}

/**
 * 追加一条消息
 * @param {{from:number,to:number,item_id?:number,type:string,content:string,meta?:object}} input
 * @returns {object}
 */
function addMessage(input) {
  const now = Date.now();
  prune(now);

  seq += 1;
  const message = {
    id: seq,
    from: Number(input.from),
    to: Number(input.to),
    item_id: input.item_id ? Number(input.item_id) : null,
    type: input.type,
    content: String(input.content || ''),
    meta: input.meta || {},
    created_at: new Date(now + 8 * 3600 * 1000).toISOString().replace('Z', '+08:00'),
    expires_at: now + TTL_MS,
  };

  messages.push(message);
  return message;
}

/**
 * 拉取与当前用户相关的新消息
 * @param {number} userId 当前用户
 * @param {{since?: number, itemId?: number, partnerId?: number}} options
 * @returns {{list: object[], now: number}}
 */
function listMessages(userId, options = {}) {
  prune();

  const since = Number(options.since) || 0;
  const itemId = options.itemId ? Number(options.itemId) : null;
  const partnerId = options.partnerId ? Number(options.partnerId) : null;

  const list = messages.filter((message) => {
    if (message.id <= since) return false;
    if (message.from !== userId && message.to !== userId) return false;
    if (itemId && message.item_id !== itemId) return false;
    if (partnerId) {
      const other = message.from === userId ? message.to : message.from;
      if (other !== partnerId) return false;
    }
    return true;
  });

  return { list, now: messages.length };
}

/** 当前消息总数（测试/监控用） */
function size() {
  return messages.length;
}

/** 清空（测试用） */
function clear() {
  messages = [];
  seq = 0;
}

module.exports = { addMessage, listMessages, prune, size, clear, TTL_MS };
