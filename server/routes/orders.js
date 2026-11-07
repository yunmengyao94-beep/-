'use strict';

/**
 * 订单路由（计划书 7.4：API-08 借用申请）
 * 挂载点：/api/v1/orders
 */

const express = require('express');
const { ok, fail, isoWithOffset } = require('../utils/http');
const {
  findItem,
  findUser,
  availableOf,
  nextOrderId,
  buildOrderNo,
  addOrder,
  appendCreditLog,
} = require('../store');

const router = express.Router();

/** 默认借用时长：72 小时 */
const DEFAULT_LOAN_HOURS = 72;

/**
 * POST /api/v1/orders/create
 * 请求：{ "item_id": 1, "due_at": "2026-11-10T18:00:00+08:00" }
 * 校验顺序（对齐 7.3.4 处理逻辑）：
 *   1. item_id 合法            → 40001
 *   2. 物品存在                → 40401
 *   3. 物品未被借出            → 40901
 *   4. 借用人可用分 ≥ 押金分    → 40301
 * 成功：冻结押金分 + 物品置为已借出 + 落单 + 写 freeze 流水（同一函数内串行完成，
 *       对应 7.3.4 的「事务内扣减可用额度并写入冻结流水」）
 */
router.post('/create', (req, res) => {
  const body = req.body || {};
  const itemId = Number(body.item_id);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return fail(req, res, 400, 40001, '参数校验失败：item_id 必填且为正整数', { field: 'item_id' });
  }

  const item = findItem(itemId);
  if (!item) {
    return fail(req, res, 404, 40401, '资源不存在');
  }

  if (item.status === 1) {
    return fail(req, res, 409, 40901, '物品已被借出');
  }

  const borrower = findUser(req.user && req.user.user_id);
  if (!borrower) {
    return fail(req, res, 401, 40101, '未登录或 Token 失效，请重新登录');
  }

  const available = availableOf(borrower);
  if (available < item.deposit_score) {
    return fail(req, res, 403, 40301, '信用分不足', {
      current_available: available,
      required_score: item.deposit_score,
    });
  }

  // due_at 可选：缺省为 72 小时后；给了就必须是合法时间
  let dueAt;
  if (body.due_at === undefined || body.due_at === null || body.due_at === '') {
    dueAt = isoWithOffset(new Date(Date.now() + DEFAULT_LOAN_HOURS * 3600 * 1000));
  } else if (typeof body.due_at === 'string' && !Number.isNaN(Date.parse(body.due_at))) {
    dueAt = body.due_at;
  } else {
    return fail(req, res, 400, 40001, '参数校验失败：due_at 必须是 ISO 8601 时间字符串', {
      field: 'due_at',
    });
  }

  // ---- 冻结与落单（内存中的「事务」）----
  const now = isoWithOffset();
  borrower.credit_frozen += item.deposit_score;
  borrower.credit_available = availableOf(borrower);
  item.status = 1;

  const orderId = nextOrderId();
  const order = addOrder({
    id: orderId,
    order_no: buildOrderNo(orderId),
    item_id: item.id,
    borrower_id: borrower.id,
    owner_id: item.owner_id,
    frozen_score: item.deposit_score,
    state: 0,
    due_at: dueAt,
    created_at: now,
    // E2 订单快照（5.4.4：仲裁以快照为准，防止出借者事后改规则）
    snapshot: {
      item_id: item.id,
      title: item.title,
      image_hash: item.image_hash,
      deposit_score: item.deposit_score,
      damage_rules: item.damage_rules,
      agreed_at_publish: item.damage_rules.agreed_at_publish,
      snapshot_at: now,
    },
  });

  appendCreditLog({
    user_id: borrower.id,
    change_type: 'freeze',
    delta: 0, // 冻结不改总分，否则 6.3.4 对账恒等式失效
    balance_after: borrower.credit_score,
    frozen_after: borrower.credit_frozen,
    ref_type: 'order',
    ref_id: order.id,
    reason: `借用「${item.title}」冻结信用分 ${item.deposit_score}`,
    created_at: now,
  });

  return ok(req, res, {
    order_id: order.id,
    frozen_score: order.frozen_score,
    state: order.state,
  });
});

module.exports = router;
