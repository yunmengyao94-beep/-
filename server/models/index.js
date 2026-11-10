'use strict';

/**
 * Mongoose 数据模型
 * ---------------------------------------------------------------------------
 * 设计要点：
 *   · 业务主键沿用自增数字 id（与前端接口、历史数据、订单号规则完全兼容）
 *   · 关闭 Mongoose 默认的字符串虚拟 id，避免与业务 id 冲突
 *   · 集合名固定（users / accounts / items / orders / credit_logs / notifications / counters）
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

/** 通用选项：关闭虚拟 id，保留业务字段 */
const baseOptions = { versionKey: false, id: false, strict: false };

/** 用户档案 */
const userSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    student_no: { type: String, required: true, unique: true, index: true },
    real_name: String,
    college_code: String,
    college_name: String,
    major_code: String,
    credit_score: { type: Number, default: 100 },
    credit_frozen: { type: Number, default: 0 },
    credit_available: { type: Number, default: 100 },
    credit_level: { type: Number, default: 4 },
    device_fp: String,
    invite_code: String,
    invited_by: Number,
    webauthn_pubkey: String,
    building_loc: String,
    status: { type: Number, default: 1 },
    created_at: String,
    updated_at: String,
  },
  { ...baseOptions, collection: 'users' }
);

/** 登录账号（密码只存 scrypt 哈希） */
const accountSchema = new Schema(
  {
    student_no: { type: String, required: true, unique: true, index: true },
    password: { type: String, default: '' },
    name: String,
    college: String,
    building: String,
    room: String,
    created_at: String,
  },
  { ...baseOptions, collection: 'accounts' }
);

/** 物品 */
const itemSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    owner_id: { type: Number, index: true },
    title: String,
    description: String,
    category: String,
    image_hash: String,
    image_thumb: String,
    image_list: [String],
    deposit_score: Number,
    damage_rules: Schema.Types.Mixed,
    building_loc: String,
    is_high_value: Number,
    status: { type: Number, default: 0, index: true },
    created_at: String,
    image_thumb_128: Boolean,
    image_updated_at: String,
    image_cleared_at: String,
  },
  { ...baseOptions, collection: 'items' }
);

/** 订单 */
const orderSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    order_no: String,
    item_id: { type: Number, index: true },
    borrower_id: { type: Number, index: true },
    owner_id: { type: Number, index: true },
    frozen_score: Number,
    state: { type: Number, default: 0, index: true },
    due_at: String,
    created_at: String,
    finished_at: String,
    penalty_days: { type: Number, default: 0 },
    snapshot: Schema.Types.Mixed,
  },
  { ...baseOptions, collection: 'orders' }
);

/** 信用流水 */
const creditLogSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    user_id: { type: Number, index: true },
    change_type: String,
    delta: Number,
    balance_after: Number,
    frozen_after: Number,
    ref_type: String,
    ref_id: Number,
    reason: String,
    created_at: String,
  },
  { ...baseOptions, collection: 'credit_logs' }
);

/** 通知 */
const notificationSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    user_id: { type: Number, index: true },
    type: String,
    title: String,
    body: String,
    is_read: { type: Boolean, default: false },
    ref_id: Number,
    created_at: String,
  },
  { ...baseOptions, collection: 'notifications' }
);

/** 自增计数器（物品 / 订单） */
const counterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Number, default: 0 },
  },
  { ...baseOptions, collection: 'counters' }
);

module.exports = {
  User: mongoose.models.User || mongoose.model('User', userSchema),
  Account: mongoose.models.Account || mongoose.model('Account', accountSchema),
  Item: mongoose.models.Item || mongoose.model('Item', itemSchema),
  Order: mongoose.models.Order || mongoose.model('Order', orderSchema),
  CreditLog: mongoose.models.CreditLog || mongoose.model('CreditLog', creditLogSchema),
  Notification: mongoose.models.Notification || mongoose.model('Notification', notificationSchema),
  Counter: mongoose.models.Counter || mongoose.model('Counter', counterSchema),
};
