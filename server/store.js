'use strict';

/**
 * 数据仓（内存 + 落盘）
 * ---------------------------------------------------------------
 * 启动顺序：
 *   1. 优先读 server/db.json（上次运行写下的真实数据）
 *   2. 不存在或损坏 → 回退 server/seed_db.json（初始种子）
 * 写入：
 *   任何写操作（发布物品 / 创建订单 / 订单状态流转）后调用 persistDb()，
 *   先写临时文件再 rename，避免进程中断产生半截 JSON。
 * 真实实现中这些函数对应 repository / service 层与数据库事务。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname);
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed_db.json');

/** 读取 JSON 文件，失败返回 null */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 规范化数据结构 */
function normalize(source) {
  const data = source || {};
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.items)) data.items = [];
  if (!Array.isArray(data.orders)) data.orders = [];
  if (!Array.isArray(data.credit_logs)) data.credit_logs = [];
  if (!Array.isArray(data.accounts)) data.accounts = [];
  return data;
}

const seedData = normalize(readJson(SEED_FILE));
const db = normalize(readJson(DB_FILE) || seedData);

// 旧 db.json 没有 accounts 字段时，从种子数据补齐（账号体系迁移）
if (db.accounts.length === 0 && seedData.accounts.length > 0) {
  db.accounts = seedData.accounts.slice();
}

/** 订单号自增起点：首次借用返回 30001（与接口约定一致） */
const ORDER_ID_SEED = 30001;
let orderSeq = Math.max(
  ORDER_ID_SEED,
  db.orders.reduce((max, order) => Math.max(max, Number(order.id) || 0), 0) + 1
);

/** 落盘：先写临时文件再 rename，避免半截 JSON */
function persistDb() {
  const tmp = `${DB_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
    return true;
  } catch (error) {
    console.error('[yxx] 数据落盘失败:', error.message);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // 忽略清理失败
    }
    return false;
  }
}

/**
 * 按 id 查用户
 * @param {number|string} id
 * @returns {object|null}
 */
function findUser(id) {
  return db.users.find((u) => u.id === Number(id)) || null;
}

/**
 * 按学号查用户（登录时用于账号 → user_id 映射）
 * @param {string} studentNo
 * @returns {object|null}
 */
function findUserByStudentNo(studentNo) {
  const no = String(studentNo || '').trim();
  if (!no) return null;
  return db.users.find((u) => u.student_no === no) || null;
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

/**
 * 按学号取用户，不存在则创建（账号即身份：每个学号一份信用记录）
 * @param {string} studentNo
 * @param {{name?: string, college?: string, building?: string}} [profile]
 * @returns {{user: object, created: boolean}}
 */
function ensureUserForStudent(studentNo, profile = {}) {
  const no = String(studentNo || '').trim();
  const existing = findUserByStudentNo(no);
  if (existing) return { user: existing, created: false };

  const nextId = db.users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1;
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('Z', '+08:00');

  const user = {
    id: nextId,
    student_no: no,
    real_name: profile.name || '同学',
    college_code: profile.college || '',
    major_code: '',
    credit_score: 100,
    credit_frozen: 0,
    credit_available: 100,
    credit_level: 4,
    device_fp: `device-${nextId}`,
    invite_code: `YXX${String(nextId).padStart(4, '0')}`,
    invited_by: null,
    webauthn_pubkey: `demo-pubkey-user-${nextId}`,
    building_loc: profile.building || '',
    status: 1,
    created_at: now,
    updated_at: now,
  };

  db.users.push(user);
  persistDb();

  return { user, created: true };
}

/* ---------------------------------------------------------------- 账号 */

/** scrypt 哈希，形如 scrypt$&lt;salt-hex&gt;$&lt;hash-hex&gt; */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return ['scrypt', salt.toString('hex'), hash.toString('hex')].join('$');
}

/**
 * 校验密码（恒定时间比较，避免时序侧信道）
 * @param {string} password 明文
 * @param {string} stored hashPassword() 的结果
 */
function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);

    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 按学号查账号 */
function findAccountByStudentNo(studentNo) {
  const no = String(studentNo || '').trim();
  if (!no) return null;
  return db.accounts.find((account) => account.student_no === no) || null;
}

/**
 * 新建账号并同步创建用户（账号即身份）
 * @param {{student_no: string, password: string, name: string, college?: string, building?: string, room?: string}} input
 * @returns {{ok: boolean, reason?: string, user?: object}}
 */
function createAccount(input) {
  const no = String(input.student_no || '').trim();
  if (findAccountByStudentNo(no)) return { ok: false, reason: 'exists' };

  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('Z', '+08:00');

  db.accounts.push({
    student_no: no,
    password: hashPassword(input.password),
    name: input.name,
    college: input.college || '',
    building: input.building || '',
    room: input.room || '',
    created_at: now,
  });

  const { user } = ensureUserForStudent(no, {
    name: input.name,
    college: input.college,
    building: input.building,
  });

  persistDb();
  return { ok: true, user };
}

module.exports = {
  db,
  DB_FILE,
  SEED_FILE,
  persistDb,
  ORDER_ID_SEED,
  hashPassword,
  verifyPassword,
  findAccountByStudentNo,
  createAccount,
  findUser,
  findUserByStudentNo,
  ensureUserForStudent,
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
