'use strict';

/**
 * 数据仓（MongoDB + Mongoose）
 * ---------------------------------------------------------------------------
 * · 启动时连接 MongoDB，并把集合载入内存缓存，供路由同步读取
 * · 所有写操作先改缓存，再调用 commitDb() 批量同步到 MongoDB
 * · 不再读写 db.json，不再依赖单实例锁 / 备份文件
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const { User, Account, Item, Order, CreditLog, Notification, Counter } = require('./models');
const seedData = require('./seed_db.json');

/** 订单号自增起点：首次借用返回 30001（与接口约定一致） */
const ORDER_ID_SEED = 30001;

/** 逾期每天扣多少信用分 */
const OVERDUE_DAILY_PENALTY = 5;
const DAY_MS = 24 * 3600 * 1000;

/** 内存缓存（路由同步读取） */
const db = {
  users: [],
  accounts: [],
  items: [],
  orders: [],
  credit_logs: [],
  notifications: [],
  seq: { item: 0, order: ORDER_ID_SEED },
};

let ready = false;
let connection = null;

/* ------------------------------------------------------------ 工具函数 */

function isoNow() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('Z', '+08:00');
}

/** 可用信用分 = 总分 − 冻结分 */
function availableOf(user) {
  if (!user) return 0;
  return Math.max(0, Number(user.credit_score || 0) - Number(user.credit_frozen || 0));
}

/** 去掉 Mongo 内部字段，业务对象保持纯净 */
function strip(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { _id, __v, ...rest } = doc;
  const clean = {};
  Object.keys(rest).forEach((key) => {
    if (rest[key] !== undefined) clean[key] = rest[key];
  });
  return clean;
}

/* ------------------------------------------------------------ 连接与同步 */

/**
 * 连接 MongoDB
 * @param {string} [uri]
 */
async function connect(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('缺少 MONGODB_URI 环境变量');

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB || 'yxx',
    serverSelectionTimeoutMS: 15000,
  });

  connection = mongoose.connection;
  connection.on('error', (error) => console.error('[yxx] MongoDB 连接错误:', error.message));
  return connection;
}

/** 首次启动时写入种子数据 */
async function seedIfEmpty() {
  const count = await User.estimatedDocumentCount();
  if (count > 0) return false;

  const pick = (key) => (Array.isArray(seedData[key]) ? seedData[key].map(strip) : []);

  await Promise.all([
    User.insertMany(pick('users')),
    Account.insertMany(pick('accounts')),
    Item.insertMany(pick('items')),
    Order.insertMany(pick('orders')),
    CreditLog.insertMany(pick('credit_logs')),
    Notification.insertMany(pick('notifications')),
  ]);

  const seq = seedData.seq || {};
  const itemSeed = Number(seq.item) || 0;
  const orderSeed = Number(seq.order) || ORDER_ID_SEED;
  await Counter.updateOne({ key: 'item' }, { $set: { value: itemSeed } }, { upsert: true });
  await Counter.updateOne({ key: 'order' }, { $set: { value: orderSeed } }, { upsert: true });

  console.info(`[yxx] 已写入种子数据：users=${pick('users').length}`);
  return true;
}

/** 把集合载入内存 */
async function loadCache() {
  const [users, accounts, items, orders, creditLogs, notifications, counters] = await Promise.all([
    User.find({}).lean(),
    Account.find({}).lean(),
    Item.find({}).lean(),
    Order.find({}).lean(),
    CreditLog.find({}).lean(),
    Notification.find({}).lean(),
    Counter.find({}).lean(),
  ]);

  db.users = users.map(strip);
  db.accounts = accounts.map(strip);
  db.items = items.map(strip);
  db.orders = orders.map(strip);
  db.credit_logs = creditLogs.map(strip);
  db.notifications = notifications.map(strip);

  const counterMap = new Map(counters.map((row) => [row.key, Number(row.value) || 0]));
  const maxItem = db.items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  const maxOrder = db.orders.reduce((max, order) => Math.max(max, Number(order.id) || 0), 0);

  db.seq.item = Math.max(Number(counterMap.get('item')) || 0, maxItem);
  db.seq.order = Math.max(
    Number(counterMap.get('order')) || ORDER_ID_SEED,
    maxOrder + 1,
    ORDER_ID_SEED
  );
}

/** 全量同步一个集合（演示数据量很小，全量替换最稳） */
async function syncCollection(Model, docs, key) {
  const rows = docs.map(strip);
  if (rows.length === 0) {
    await Model.deleteMany({});
    return;
  }

  const operations = rows.map((row) => ({
    replaceOne: {
      filter: { [key]: row[key] },
      replacement: row,
      upsert: true,
    },
  }));

  await Model.bulkWrite(operations, { ordered: false });
  await Model.deleteMany({ [key]: { $nin: rows.map((row) => row[key]) } });
}

/** 把内存缓存写回 MongoDB */
async function commitDb() {
  if (!ready) throw new Error('数据仓尚未初始化，无法落库');

  await Promise.all([
    syncCollection(User, db.users, 'id'),
    syncCollection(Account, db.accounts, 'student_no'),
    syncCollection(Item, db.items, 'id'),
    syncCollection(Order, db.orders, 'id'),
    syncCollection(CreditLog, db.credit_logs, 'id'),
    syncCollection(Notification, db.notifications, 'id'),
  ]);

  await Promise.all([
    Counter.updateOne({ key: 'item' }, { $set: { value: db.seq.item } }, { upsert: true }),
    Counter.updateOne({ key: 'order' }, { $set: { value: db.seq.order } }, { upsert: true }),
  ]);

  return true;
}

/** 初始化：连接 → 种子 → 载入缓存 */
async function initStore() {
  if (ready) return db;

  await connect();
  await seedIfEmpty();
  await loadCache();
  ready = true;

  console.info(
    `[yxx] MongoDB 已连接（db=${process.env.MONGODB_DB || 'yxx'}）：users=${db.users.length} items=${db.items.length} orders=${db.orders.length}`
  );
  return db;
}

/* ------------------------------------------------------------ 用户 / 物品 */

function findUser(id) {
  return db.users.find((user) => user.id === Number(id)) || null;
}

function findUserByStudentNo(studentNo) {
  const no = String(studentNo || '').trim();
  if (!no) return null;
  return db.users.find((user) => user.student_no === no) || null;
}

function findItem(id) {
  return db.items.find((item) => item.id === Number(id)) || null;
}

/** 分配订单 id */
function nextOrderId() {
  const id = db.seq.order;
  db.seq.order += 1;
  return id;
}

/** 分配物品 id（自增，永不复用） */
function nextItemId() {
  const maxExisting = db.items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  const base = Math.max(Number(db.seq.item) || 0, maxExisting);
  db.seq.item = base + 1;
  return db.seq.item;
}

/** 生成业务单号：YXX + yyyymmdd + 4 位流水 */
function buildOrderNo(orderId) {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return `YXX${ymd}${String(orderId - ORDER_ID_SEED + 1).padStart(4, '0')}`;
}

function addOrder(order) {
  db.orders.push(order);
  return order;
}

function appendCreditLog(entry) {
  const nextId = db.credit_logs.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
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

function listCreditLogs(userId) {
  return db.credit_logs
    .filter((row) => row.user_id === Number(userId))
    .slice()
    .sort((a, b) =>
      a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1
    );
}

function findOrder(id) {
  return db.orders.find((order) => order.id === Number(id)) || null;
}

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
 * 按学号取用户，不存在则创建
 * @returns {{user: object, created: boolean}}
 */
function ensureUserForStudent(studentNo, profile = {}) {
  const no = String(studentNo || '').trim();
  const existing = findUserByStudentNo(no);
  if (existing) return { user: existing, created: false };

  const nextId = db.users.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0) + 1;
  const now = isoNow();

  const user = {
    id: nextId,
    student_no: no,
    real_name: profile.name || '同学',
    college_code: profile.college || '',
    college_name: profile.college || '',
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
  return { user, created: true };
}

/* ---------------------------------------------------------------- 逾期 */

function applyOverduePenalties(user) {
  if (!user) return 0;

  const now = Date.now();
  let changed = 0;

  db.orders
    .filter((order) => order.borrower_id === user.id && (order.state === 1 || order.state === 4))
    .forEach((order) => {
      const due = Date.parse(order.due_at || '');
      if (!due || now <= due) return;

      const overdueDays = Math.floor((now - due) / DAY_MS);
      const settledDays = Number(order.penalty_days) || 0;

      if (order.state !== 4) {
        order.state = 4;
        changed += 1;

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
        created_at: isoNow(),
      });

      changed += 1;
    });

  return changed;
}

/* ------------------------------------------------------- 物品生命周期 */

function clearItemImage(item) {
  if (!item) return false;

  const hadImage =
    Boolean(item.image_thumb) || (Array.isArray(item.image_list) && item.image_list.length > 0);
  item.image_thumb = '';
  item.image_list = [];
  if (hadImage) item.image_cleared_at = isoNow();
  return hadImage;
}

const MAX_THUMB128_CHARS = 12 * 1024;

function setItemThumb128(item, dataUrl) {
  if (!item) return { ok: false, reason: 'not_found' };

  const value = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (!value) return { ok: false, reason: 'empty' };
  if (!/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    return { ok: false, reason: 'bad_format' };
  }
  if (value.length < 200) return { ok: false, reason: 'too_small', bytes: value.length };
  if (value.length > MAX_THUMB128_CHARS)
    return { ok: false, reason: 'too_large', bytes: value.length };

  item.image_thumb = value;
  item.image_list = [];
  item.image_thumb_128 = true;
  item.image_updated_at = isoNow();

  return { ok: true, bytes: value.length };
}

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

function startItemSweeper(options = {}) {
  const intervalMs = options.intervalMs === undefined ? 5 * 60 * 1000 : options.intervalMs;
  const ttlMs = options.ttlMs === undefined ? 30 * 60 * 1000 : options.ttlMs;
  const onSweep = options.onSweep || (() => {});

  const timer = setInterval(async () => {
    const changed = sweepStaleItems({ ttlMs });
    if (changed > 0) {
      try {
        await commitDb();
      } catch (error) {
        console.error('[yxx] 清扫落库失败:', error.message);
      }
    }
    onSweep(changed);
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();

  return { timer, stop: () => clearInterval(timer) };
}

/* -------------------------------------------------------------- 通知 */

const MAX_NOTIFICATIONS_PER_USER = 200;

function addNotification(input) {
  const nextId = db.notifications.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
  const row = {
    id: nextId,
    user_id: Number(input.user_id),
    type: input.type === 'system' ? 'system' : 'order',
    title: String(input.title || '').slice(0, 120),
    body: String(input.body || '').slice(0, 300),
    is_read: false,
    ref_id: input.ref_id === undefined ? null : input.ref_id,
    created_at: isoNow(),
  };

  db.notifications.push(row);

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

function listNotifications(userId) {
  return db.notifications
    .filter((item) => item.user_id === Number(userId))
    .slice()
    .sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id
    );
}

function unreadNotificationCount(userId) {
  return db.notifications.filter((item) => item.user_id === Number(userId) && !item.is_read).length;
}

function markNotificationRead(userId, id) {
  const row = db.notifications.find(
    (item) => item.id === Number(id) && item.user_id === Number(userId)
  );
  if (!row) return false;
  row.is_read = true;
  return true;
}

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

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return ['scrypt', salt.toString('hex'), hash.toString('hex')].join('$');
}

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

function findAccountByStudentNo(studentNo) {
  const no = String(studentNo || '').trim();
  if (!no) return null;
  return db.accounts.find((account) => account.student_no === no) || null;
}

function createAccount(input) {
  const no = String(input.student_no || '').trim();
  if (findAccountByStudentNo(no)) return { ok: false, reason: 'exists' };

  const now = isoNow();

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

  return { ok: true, user };
}

module.exports = {
  db,
  initStore,
  commitDb,
  persistDb: commitDb,
  setItemThumb128,
  MAX_THUMB128_CHARS,
  clearItemImage,
  sweepStaleItems,
  startItemSweeper,
  backupDb: async () => false,
  hasRecoveredFromBackup: () => false,
  nextItemId,
  addNotification,
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  OVERDUE_DAILY_PENALTY,
  applyOverduePenalties,
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
  mongoose,
};
