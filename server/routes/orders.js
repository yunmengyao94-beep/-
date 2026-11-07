'use strict';

/**
 * 订单路由（计划书 7.4：API-08 借用申请）
 * 挂载点：/api/v1/orders
 *
 * 本批新增：
 *   GET  /mine               我的订单（借出/借入，可按状态过滤）
 *   PATCH /:id/state         订单状态流转（确认交接 / 发起归还）
 */

const express = require('express');
const { ok, fail, isoWithOffset } = require('../utils/http');
const { maskStudentNo, maskName } = require('../utils/mask');
const {
  findItem,
  findUser,
  findOrder,
  listOrders,
  availableOf,
  nextOrderId,
  buildOrderNo,
  addOrder,
  appendCreditLog,
} = require('../store');

const router = express.Router();

/** 默认借用时长：72 小时 */
const DEFAULT_LOAN_HOURS = 72;

/** 允许的状态流转：action → { from, to } */
const TRANSITIONS = {
  confirm_handover: { from: 0, to: 1 },
  request_return: { from: 1, to: 2 },
};

/**
 * 把内部订单整理成前端需要的结构
 * @param {object} order
 * @param {number} viewerId 当前登录用户
 */
function toDto(order, viewerId) {
  const me = Number(viewerId);
  const isOwner = order.owner_id === me;
  const counterpartyId = isOwner ? order.borrower_id : order.owner_id;
  const counterparty = findUser(counterpartyId);
  const item = findItem(order.item_id);
  const snapshot = order.snapshot || {};

  return {
    order_id: order.id,
    order_no: order.order_no,
    direction: isOwner ? 'lend' : 'borrow',
    state: order.state,
    frozen_score: order.frozen_score,
    created_at: order.created_at,
    due_at: order.due_at,
    finished_at: order.finished_at || null,
    item: {
      id: order.item_id,
      title: snapshot.title || (item ? item.title : `物品 #${order.item_id}`),
      image: null, // Mock 数据只有 image_hash，没有真实图片地址
      deposit_score: snapshot.deposit_score ?? (item ? item.deposit_score : 0),
    },
    counterparty: {
      nickname: counterparty ? maskName(counterparty.real_name) : '同学',
      student_no: counterparty ? maskStudentNo(counterparty.student_no) : '',
    },
  };
}

/**
 * GET /api/v1/orders/mine?direction=borrow|lend&state=0|1|2
 * 我的订单：direction 不传返回全部
 */
router.get('/mine', (req, res) => {
  const userId = req.user && req.user.user_id;
  const me = findUser(userId);
  if (!me) {
    return fail(req, res, 401, 40101, '未登录或 Token 失效，请重新登录');
  }

  const direction = req.query.direction;
  if (direction !== undefined && direction !== 'borrow' && direction !== 'lend') {
    return fail(req, res, 400, 40001, '参数校验失败：direction 只能是 borrow 或 lend', {
      field: 'direction',
    });
  }

  let state;
  if (req.query.state !== undefined && req.query.state !== '') {
    state = Number(req.query.state);
    if (!Number.isInteger(state) || state < 0 || state > 4) {
      return fail(req, res, 400, 40001, '参数校验失败：state 必须是 0–4 的整数', {
        field: 'state',
      });
    }
  }

  const orders = listOrders(me.id, { direction, state });

  return ok(req, res, {
    list: orders.map((order) => toDto(order, me.id)),
    total: orders.length,
  });
});

/**
 * PATCH /api/v1/orders/:id/state
 * 请求：{ "action": "confirm_handover" | "request_return" }
 * 说明：
 *   · confirm_handover：待交接(0) → 使用中(1)，仅借用人可操作
 *   · request_return ：使用中(1) → 已完成(2)，仅借用人可操作；同时解冻信用分
 */
router.patch('/:id/state', (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return fail(req, res, 400, 40001, '参数校验失败：id 必须为正整数', { field: 'id' });
  }

  const action = req.body && req.body.action;
  const transition = TRANSITIONS[action];
  if (!transition) {
    return fail(
      req,
      res,
      400,
      40001,
      '参数校验失败：action 只能是 confirm_handover 或 request_return',
      {
        field: 'action',
      }
    );
  }

  const order = findOrder(orderId);
  if (!order) {
    return fail(req, res, 404, 40401, '资源不存在');
  }

  const me = findUser(req.user && req.user.user_id);
  if (!me) {
    return fail(req, res, 401, 40101, '未登录或 Token 失效，请重新登录');
  }

  if (order.borrower_id !== me.id) {
    return fail(req, res, 403, 40301, '只有借用人可以执行该操作');
  }

  if (order.state !== transition.from) {
    return fail(req, res, 409, 40901, `当前状态不允许该操作（订单状态 ${order.state}）`, {
      current_state: order.state,
      expected_state: transition.from,
    });
  }

  order.state = transition.to;
  const now = isoWithOffset();

  // 归还完成：解冻押金分（delta 恒为 0，保持 6.3.4 对账恒等式）
  if (transition.to === 2) {
    order.finished_at = now;

    const frozen = Number(order.frozen_score) || 0;
    const borrower = findUser(order.borrower_id);
    if (borrower && frozen > 0) {
      borrower.credit_frozen = Math.max(0, borrower.credit_frozen - frozen);
      borrower.credit_available = availableOf(borrower);

      appendCreditLog({
        user_id: borrower.id,
        change_type: 'unfreeze',
        delta: 0,
        balance_after: borrower.credit_score,
        frozen_after: borrower.credit_frozen,
        ref_type: 'order',
        ref_id: order.id,
        reason: `归还完成，解冻信用分 ${frozen}`,
        created_at: now,
      });
    }
  }

  return ok(req, res, {
    order_id: order.id,
    state: order.state,
    finished_at: order.finished_at || null,
  });
});

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
