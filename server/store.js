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
const BACKUP_FILE = path.join(DATA_DIR, 'db.backup.json');

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
  if (!Array.isArray(data.notifications)) data.notifications = [];
  if (!data.seq || typeof data.seq !== 'object') data.seq = {};
  if (!Number.isInteger(data.seq.item)) data.seq.item = 0;
  return data;
}

const seedData = normalize(readJson(SEED_FILE));

/** 本次启动是否发生了「主文件损坏 → 备份恢复」 */
let dbRecoveredFromBackup = false;

/**
 * 加载主数据文件
 * 顺序：db.json → db.backup.json（损坏时自动恢复）→ seed_db.json
 */
function loadDatabase() {
  const primary = readJson(DB_FILE);

  if (primary) return normalize(primary);

  // 主文件缺失或 JSON 损坏：尝试备份
  if (fs.existsSync(DB_FILE)) {
    const backup = readJson(BACKUP_FILE);
    if (backup) {
      dbRecoveredFromBackup = true;
      try {
        fs.copyFileSync(BACKUP_FILE, DB_FILE);
      } catch {
        // 复制失败也继续用内存里的备份
      }
      console.error('[yxx][告警] db.json 损坏或无法解析，已从 db.backup.json 恢复');
      return normalize(backup);
    }
    console.error('[yxx][告警] db.json 损坏且无可用备份，回退到种子数据');
  } else if (fs.existsSync(BACKUP_FILE)) {
    // 主文件被误删：同样用备份兜底
    const backup = readJson(BACKUP_FILE);
    if (backup) {
      dbRecoveredFromBackup = true;
      console.error('[yxx][告警] db.json 不存在，已从 db.backup.json 恢复');
      return normalize(backup);
    }
  }

  return normalize(JSON.parse(JSON.stringify(seedData)));
}

const db = loadDatabase();

// 旧 db.json 没有 accounts 字段时，从种子数据补齐（账号体系迁移）
if (db.accounts.length === 0 && seedData.accounts.length > 0) {
  db.accounts = seedData.accounts.slice();
}

/** 订单号自增起点：首次借用返回 30001（与接口约定一致） */
const ORDER_ID_SEED = 30001;
/** 落盘临时文件自增序号（同一毫秒内多次写也不会撞名） */
let writeSeq = 0;

let orderSeq = Math.max(
  ORDER_ID_SEED,
  db.orders.reduce((max, order) => Math.max(max, Number(order.id) || 0), 0) + 1
);

/**
 * 备份当前数据文件到 db.backup.json
 * @returns {boolean} 是否成功
 */
function backupDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return false;
    fs.copyFileSync(DB_FILE, BACKUP_FILE);
    return true;
  } catch (error) {
    console.error('[yxx] 备份失败:', error.message);
    return false;
  }
}

/** 落盘：先写临时文件再 rename，避免半截 JSON */
function persistDb() {
  // 唯一临时文件名：避免并发写互相覆盖同一个 .tmp
  const tmp = `${DB_FILE}.${process.pid}.${Date.now()}.${++writeSeq}.tmp`;

  try {
    const json = JSON.stringify(db, null, 2);
    const fd = fs.openSync(tmp, 'w');

    try {
      fs.writeFileSync(fd, json, 'utf8');
      // 落盘到磁盘，避免断电丢失
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // rename 在同一分区上是原子操作：要么旧文件，要么新文件
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
 * 强制落盘：写入失败时抛错，调用方据此返回 500
 * 保证「接口返回 200」一定意味着数据已经写到磁盘
 */
function commitDb() {
  if (!persistDb()) {
    const error = new Error('数据写入磁盘失败');
    error.code = 50001;
    error.status = 500;
    throw error;
  }
  return true;
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
 * 分配物品 id（自增，永不复用）
 * 不能用 max(id)+1 —— 物品删除后 ID 会被复用，
 * 历史订单 / 通知里的 item_id 就会指向另一件物品。
 */
function nextItemId() {
  const maxExisting = db.items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  const base = Math.max(Number(db.seq && db.seq.item) || 0, maxExisting);
  db.seq.item = base + 1;
  return db.seq.item;
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
  commitDb();

  return { user, created: true };
}

/* ---------------------------------------------------------------- 逾期 */

/** 逾期每天扣多少信用分 */
const OVERDUE_DAILY_PENALTY = 5;
const DAY_MS = 24 * 3600 * 1000;

/**
 * 惰性逾期判定：读取用户数据时调用，不依赖定时任务
 * 规则：
 *   · state = 1（使用中）且 now > due_at → 置为 state = 4（已逾期）
 *   · 每逾期 1 天扣 OVERDUE_DAILY_PENALTY 分，只补扣"尚未结算"的天数
 *   · 同一天内多次调用不会重复扣分（order.penalty_days 记录已结算天数）
 * @param {object} user
 * @returns {number} 被处理的订单数
 */
function applyOverduePenalties(user) {
  if (!user) return 0;

  const now = Date.now();
  let changed = 0;

  db.orders
    .filter((order) => order.borrower_id === user.id && (order.state === 1 || order.state === 4))
    .forEach((order) => {
      const due = Date.parse(order.due_at || '');
      if (!due || now <= due) return;

      // 只按"已满 24 小时"计费：不足 1 天仅标记状态，不扣分（给用户一个宽限日）
      const overdueDays = Math.floor((now - due) / DAY_MS);
      const settledDays = Number(order.penalty_days) || 0;

      if (order.state !== 4) {
        order.state = 4;
        changed += 1;

        // 逾期通知：借用人 + 出借人各一条
        addNotification({
          user_id: order.borrower_id,
          type: 'order',
          title: `订单 #${order.id} 已逾期`,
          body: '请尽快归还物品，逾期每天将扣除信用分。',
          ref_id: order.id,
        });
        addNotification({
          user_id: order.owner_id,
          type: 'order',
          title: `订单 #${order.id} 已逾期`,
          body: '借用人尚未归还，建议主动联系对方。',
          ref_id: order.id,
        });
      }

      if (overdueDays <= 0 || overdueDays <= settledDays) return;

      const deltaDays = overdueDays - settledDays;
      const penalty = deltaDays * OVERDUE_DAILY_PENALTY;

      order.penalty_days = overdueDays;
      user.credit_score = Math.max(0, user.credit_score - penalty);
      user.credit_available = availableOf(user);

      appendCreditLog({
        user_id: user.id,
        change_type: 'deduct',
        delta: -penalty,
        balance_after: user.credit_score,
        frozen_after: user.credit_frozen,
        ref_type: 'order',
        ref_id: order.id,
        reason: `订单 #${order.id} 逾期 ${deltaDays} 天，扣 ${penalty} 分`,
        created_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('Z', '+08:00'),
      });

      changed += 1;
    });

  if (changed > 0) commitDb();
  return changed;
}

/* ------------------------------------------------------- 物品生命周期 */

/**
 * 清空物品的图片数据（保留文字信息）
 * @param {object} item
 * @returns {boolean} 是否发生了清理
 */
function clearItemImage(item) {
  if (!item) return false;

  const hadImage =
    Boolean(item.image_thumb) || (Array.isArray(item.image_list) && item.image_list.length > 0);
  item.image_thumb = '';
  item.image_list = [];
  if (hadImage) {
    item.image_cleared_at = new Date(Date.now() + 8 * 3600 * 1000)
      .toISOString()
      .replace('Z', '+08:00');
  }
  return hadImage;
}

/**
 * 清扫超时未借出的物品：状态 0 且创建超过 TTL → 状态 2 并清空图片
 * @param {{ttlMs?: number, now?: number}} [options]
 * @returns {number} 被下架的数量
 */
function sweepStaleItems(options = {}) {
  const ttlMs = options.ttlMs === undefined ? 30 * 60 * 1000 : options.ttlMs;
  const now = options.now === undefined ? Date.now() : options.now;
  let changed = 0;

  db.items.forEach((item) => {
    if (item.status !== 0) return;

    const createdAt = Date.parse(item.created_at || '');
    if (!createdAt || now - createdAt <= ttlMs) return;

    item.status = 2;
    clearItemImage(item);
    changed += 1;
  });

  return changed;
}

/**
 * 启动定时清扫（每 5 分钟一次，unref 不阻塞进程退出）
 * @param {{intervalMs?: number, ttlMs?: number, onSweep?: Function}} [options]
 * @returns {{timer: any, stop: Function}}
 */
function startItemSweeper(options = {}) {
  const intervalMs = options.intervalMs === undefined ? 5 * 60 * 1000 : options.intervalMs;
  const ttlMs = options.ttlMs === undefined ? 30 * 60 * 1000 : options.ttlMs;
  const onSweep = options.onSweep || (() => {});

  const timer = setInterval(() => {
    const changed = sweepStaleItems({ ttlMs });
    if (changed > 0) {
      try {
        commitDb();
      } catch (error) {
        console.error('[yxx] 清扫落盘失败:', error.message);
      }
    }
    onSweep(changed);
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();

  return {
    timer,
    stop: () => clearInterval(timer),
  };
}

/* -------------------------------------------------------------- 通知 */

/**
 * 新增一条通知
 * @param {{user_id: number, type?: 'system'|'order', title: string, body?: string, ref_id?: number|null}} input
 * @returns {object}
 */
const MAX_NOTIFICATIONS_PER_USER = 200;

function addNotification(input) {
  const nextId = db.notifications.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  const row = {
    id: nextId,
    user_id: Number(input.user_id),
    type: input.type === 'system' ? 'system' : 'order',
    title: String(input.title || '').slice(0, 120),
    body: String(input.body || '').slice(0, 300),
    is_read: false,
    ref_id: input.ref_id === undefined ? null : input.ref_id,
    created_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('Z', '+08:00'),
  };

  db.notifications.push(row);

  // 单用户通知上限：超出后删除最旧的，避免 db.json 无限增长
  const mine = db.notifications.filter((item) => item.user_id === row.user_id);
  if (mine.length > MAX_NOTIFICATIONS_PER_USER) {
    const removeCount = mine.length - MAX_NOTIFICATIONS_PER_USER;
    const removeIds = new Set(
      mine
        .slice()
        .sort((a, b) =>
          a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id
        )
        .slice(0, removeCount)
        .map((item) => item.id)
    );
    db.notifications = db.notifications.filter((item) => !removeIds.has(item.id));
  }

  return row;
}

/** 某用户的通知列表（时间倒序） */
function listNotifications(userId) {
  return db.notifications
    .filter((item) => item.user_id === Number(userId))
    .slice()
    .sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id
    );
}

/** 未读数 */
function unreadNotificationCount(userId) {
  return db.notifications.filter((item) => item.user_id === Number(userId) && !item.is_read).length;
}

/**
 * 标记单条已读
 * @returns {boolean} 是否命中
 */
function markNotificationRead(userId, id) {
  const row = db.notifications.find(
    (item) => item.id === Number(id) && item.user_id === Number(userId)
  );
  if (!row) return false;
  row.is_read = true;
  return true;
}

/** 全部已读，返回影响条数 */
function markAllNotificationsRead(userId) {
  let count = 0;
  db.notifications.forEach((item) => {
    if (item.user_id === Number(userId) && !item.is_read) {
      item.is_read = true;
      count += 1;
    }
  });
  return count;
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
  commitDb,
  clearItemImage,
  sweepStaleItems,
  startItemSweeper,
  backupDb,
  BACKUP_FILE,
  hasRecoveredFromBackup: () => dbRecoveredFromBackup,
  nextItemId,
  addNotification,
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  OVERDUE_DAILY_PENALTY,
  applyOverduePenalties,
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
