'use strict';

/**
 * 内存数据仓
 * ---------------------------------------------------------------
 * 以 server/mock_db.json 为初始数据（require 后即进程内单例），
 * 借用等写操作只改内存，不回写文件——重启即复位，便于反复演示。
 * 真实实现中这些函数对应 repository / service 层与数据库事务。
 */

const db = require('./mock_db.json');

/** 订单号自增起点：首次借用返回 30001（与接口约定一致） */
const ORDER_ID_SEED = 30001;
let orderSeq = ORDER_ID_SEED;

if (!Array.isArray(db.orders)) db.orders = [];

/**
 * 按 id 查用户
 * @param {number|string} id
 * @returns {object|null}
 */
function findUser(id) {
  return db.users.find((u) => u.id === Number(id)) || null;
}

/**
 * 按 id 查物品
 * @param {number|string} id
 * @returns {object|null}
 */
function findItem(id) {
  return db.items.find((i) => i.id === Number(id)) || null;
}

/**
 * 可用信用分 = 信用分 − 冻结分（5.4.3）；余额不足时夹紧到 0
 * @param {object} user
 * @returns {number}
 */
function availableOf(user) {
  return Math.max(0, user.credit_score - user.credit_frozen);
}

/** 分配订单 id */
function nextOrderId() {
  const id = orderSeq;
  orderSeq += 1;
  return id;
}

/**
 * 生成业务单号：YXX + yyyymmdd + 4 位当日流水（对齐 7.3.4 示例 YXX2026110700017）
 * @param {number} orderId
 * @returns {string}
 */
function buildOrderNo(orderId) {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return `YXX${ymd}${String(orderId - ORDER_ID_SEED + 1).padStart(4, '0')}`;
}

/**
 * 落库订单（内存）
 * @param {object} order
 * @returns {object}
 */
function addOrder(order) {
  db.orders.push(order);
  return order;
}

/**
 * 追加信用流水（6.3.4 字段）；冻结/解冻的 delta 必须为 0，否则日终对账恒等式失效
 * @param {object} entry
 * @returns {object}
 */
function appendCreditLog(entry) {
  const nextId = db.credit_logs.reduce((max, l) => Math.max(max, l.id), 0) + 1;
  const row = {
    id: nextId,
    user_id: entry.user_id,
    change_type: entry.change_type,
    delta: entry.delta,
    balance_after: entry.balance_after,
    frozen_after: entry.frozen_after,
    ref_type: entry.ref_type || null,
    ref_id: entry.ref_id || null,
    reason: entry.reason || null,
    created_at: entry.created_at,
  };
  db.credit_logs.push(row);
  return row;
}

/**
 * 按用户取流水（时间倒序，6.4 的 idx_user_time）
 * @param {number} userId
 * @returns {object[]}
 */
function listCreditLogs(userId) {
  return db.credit_logs
    .filter((l) => l.user_id === Number(userId))
    .slice()
    .sort((a, b) =>
      a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1
    );
}

/* ---------------------------------------------------------------- 订单 */

/** 本地时间转 ISO 8601（+08:00） */
function isoLocal(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`
  );
}

/**
 * 播种演示订单（仅首次启动内存为空时执行）
 * 目的：让「我借出的 / 我借入的」两个 Tab 都有数据可看。
 * 订单号从 29001 起，避免占用真实新建订单的 30001 段位。
 */
function seedDemoOrders() {
  if (db.orders.length > 0) return;

  const now = Date.now();
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;

  const make = (id, itemId, ownerId, borrowerId, state, offsets) => {
    const item = db.items.find((i) => i.id === itemId);
    const createdAt = isoLocal(now - offsets.created * DAY);
    const dueAt = isoLocal(now + offsets.due * DAY);

    return {
      id,
      order_no: `YXX${String(id).padStart(9, '0')}`,
      item_id: itemId,
      owner_id: ownerId,
      borrower_id: borrowerId,
      frozen_score: item ? item.deposit_score : 0,
      state,
      due_at: dueAt,
      created_at: createdAt,
      finished_at: state === 2 ? isoLocal(now - offsets.created * DAY + 2 * DAY) : null,
      snapshot: {
        item_id: itemId,
        title: item ? item.title : `物品 #${itemId}`,
        image_hash: item ? item.image_hash : null,
        deposit_score: item ? item.deposit_score : 0,
        damage_rules: item ? item.damage_rules : null,
        agreed_at_publish: true,
        snapshot_at: createdAt,
      },
    };
  };

  const demo = [
    // 我借入（borrower_id = 1）
    make(29001, 1, 2, 1, 0, { created: 1, due: 2 }),
    make(29002, 2, 2, 1, 1, { created: 2, due: 1 }),
    make(29003, 3, 2, 1, 2, { created: 5, due: -3 }),
    // 我借出（owner_id = 1）
    make(29004, 4, 1, 2, 0, { created: 1, due: 2 }),
    make(29005, 5, 1, 2, 1, { created: 3, due: 1 }),
    make(29006, 6, 1, 2, 2, { created: 6, due: -2 }),
  ];

  db.orders.push(...demo);

  // 为「待交接 / 使用中」的订单补上冻结分与冻结流水，保证演示数据自洽
  demo
    .filter((order) => order.state < 2 && order.frozen_score > 0)
    .forEach((order) => {
      const borrower = db.users.find((u) => u.id === order.borrower_id);
      if (!borrower) return;

      borrower.credit_frozen = (borrower.credit_frozen || 0) + order.frozen_score;
      borrower.credit_available = Math.max(0, borrower.credit_score - borrower.credit_frozen);

      db.credit_logs.push({
        id: db.credit_logs.reduce((max, l) => Math.max(max, l.id), 0) + 1,
        user_id: borrower.id,
        change_type: 'freeze',
        delta: 0,
        balance_after: borrower.credit_score,
        frozen_after: borrower.credit_frozen,
        ref_type: 'order',
        ref_id: order.id,
        reason: `借用「${order.snapshot.title}」冻结信用分 ${order.frozen_score}`,
        created_at: order.created_at,
      });
    });
}

/** 按 id 查订单 */
function findOrder(id) {
  return db.orders.find((o) => o.id === Number(id)) || null;
}

/**
 * 列出某用户的订单
 * @param {number} userId
 * @param {{direction?: 'borrow'|'lend', state?: number}} [filter]
 * @returns {object[]} 按创建时间倒序
 */
function listOrders(userId, filter = {}) {
  const uid = Number(userId);

  return db.orders
    .filter((order) => {
      const isOwner = order.owner_id === uid;
      const isBorrower = order.borrower_id === uid;
      if (!isOwner && !isBorrower) return false;

      if (filter.direction === 'lend' && !isOwner) return false;
      if (filter.direction === 'borrow' && !isBorrower) return false;
      if (filter.state !== undefined && filter.state !== null && order.state !== filter.state) {
        return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

seedDemoOrders();

module.exports = {
  db,
  ORDER_ID_SEED,
  findUser,
  findItem,
  findOrder,
  availableOf,
  nextOrderId,
  buildOrderNo,
  addOrder,
  listOrders,
  appendCreditLog,
  listCreditLogs,
};
