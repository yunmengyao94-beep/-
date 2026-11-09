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
const { createRateLimit } = require('../middlewares/rate-limit');
const { addMessage } = require('../services/message-store');
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
  commitDb,
  clearItemImage,
  applyOverduePenalties,
  addNotification,
} = require('../store');

const router = express.Router();

/** 默认借用时长：72 小时 */
const DEFAULT_LOAN_HOURS = 72;

/** 允许的状态流转：action → { from: 允许的起始状态[], to, role } */
const TRANSITIONS = {
  confirm_handover: { from: [0], to: 1, role: 'borrower' },
  // 借用人发起归还：使用中(1) 或 已逾期(4) → 待出借人确认(5)
  request_return: { from: [1, 4], to: 5, role: 'borrower' },
  // 出借人确认归还：待确认(5) → 已完成(2)
  confirm_return: { from: [5], to: 2, role: 'owner' },
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
      image: null,
      // 有服务端缩略图时前端拼 /items/:id/thumb，跨设备也能显示
      has_thumb: Boolean(item && item.image_thumb),
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
    // 0 待交接 / 1 使用中 / 2 已完成 / 3 取消 / 4 逾期 / 5 待出借人确认
    if (!Number.isInteger(state) || state < 0 || state > 5) {
      return fail(req, res, 400, 40001, '参数校验失败：state 必须是 0–5 的整数', {
        field: 'state',
      });
    }
  }

  // 惰性逾期判定：读取订单前先把超时未还的订单标为已逾期并扣分
  applyOverduePenalties(me);

  const orders = listOrders(me.id, { direction, state });

  return ok(req, res, {
    list: orders.map((order) => toDto(order, me.id)),
    total: orders.length,
  });
});

/**
 * PATCH /api/v1/orders/:id/state
 * 请求：{ "action": "confirm_handover" | "request_return" | "confirm_return" }
 * 说明（双向确认）：
 *   · confirm_handover：待交接(0) → 使用中(1)，仅借用人
 *   · request_return ：使用中(1)/已逾期(4) → 待出借人确认(5)，仅借用人
 *   · confirm_return ：待确认(5) → 已完成(2)，仅出借人；此时才解冻押金分并释放物品
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
      '参数校验失败：action 只能是 confirm_handover / request_return / confirm_return',
      { field: 'action' }
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

  // 角色校验：借用人 / 出借人各自只能执行自己的动作
  if (transition.role === 'borrower' && order.borrower_id !== me.id) {
    return fail(req, res, 403, 40301, '只有借用人可以执行该操作');
  }
  if (transition.role === 'owner' && order.owner_id !== me.id) {
    return fail(req, res, 403, 40301, '只有出借人可以执行该操作');
  }

  if (!transition.from.includes(order.state)) {
    return fail(req, res, 409, 40901, `当前状态不允许该操作（订单状态 ${order.state}）`, {
      current_state: order.state,
      expected_state: transition.from,
    });
  }

  order.state = transition.to;
  const now = isoWithOffset();

  // 状态流转通知（双向）
  if (action === 'confirm_handover') {
    const handoverTitle =
      (order.snapshot && order.snapshot.title) || (findItem(order.item_id) || {}).title || '物品';

    addMessage({
      from: order.borrower_id,
      to: order.owner_id,
      item_id: order.item_id,
      type: 'system',
      content: `${handoverTitle} 已完成交接`,
      meta: { order_id: order.id },
    });
    addNotification({
      user_id: order.owner_id,
      type: 'order',
      title: `${maskName(me.real_name)} 已确认接收物品`,
      body: '订单进入「使用中」，请留意归还时间。',
      ref_id: order.id,
    });
  } else if (action === 'request_return') {
    addNotification({
      user_id: order.owner_id,
      type: 'order',
      title: `${maskName(me.real_name)} 申请归还物品`,
      body: '请确认物品状态后点击「确认归还」。',
      ref_id: order.id,
    });
  } else if (action === 'confirm_return') {
    addNotification({
      user_id: order.borrower_id,
      type: 'order',
      title: '物品已归还，信用分已解冻',
      body: '感谢按时归还，欢迎再次借用。',
      ref_id: order.id,
    });
  }

  // 归还完成：出借人确认后，解冻押金分并释放物品
  if (transition.to === 2) {
    order.finished_at = now;

    // 释放物品：归还后重新变为可借（否则会永久锁死为「已被借出」）
    const item = findItem(order.item_id);
    if (item && item.status === 1) item.status = 0;

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

  commitDb();

  return ok(req, res, {
    order_id: order.id,
    state: order.state,
    finished_at: order.finished_at || null,
  });
});

/**
 * 创建订单并冻结押金分（借用 / 出借人同意 两条路径共用）
 * @param {{item: object, borrower: object, dueAt: string}} input
 * @returns {object} order
 */
function createOrderRecord({ item, borrower, dueAt }) {
  const now = isoWithOffset();

  borrower.credit_frozen += item.deposit_score;
  borrower.credit_available = availableOf(borrower);
  item.status = 1;

  // 物品进入流转：立即清空图片数据，降低 db.json 体积
  clearItemImage(item);

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
    delta: 0,
    balance_after: borrower.credit_score,
    frozen_after: borrower.credit_frozen,
    ref_type: 'order',
    ref_id: order.id,
    reason: `借用「${item.title}」冻结信用分 ${item.deposit_score}`,
    created_at: now,
  });

  return order;
}

/**
 * POST /api/v1/orders/approve
 * 出借人在聊天中同意借用：校验通过后直接建单、冻结借用人押金分
 * 请求：{ item_id, borrower_id, due_at? }
 */
router.post(
  '/approve',
  createRateLimit({
    windowMs: 60 * 1000,
    max: 3,
    keyPrefix: 'order-approve',
    keyGenerator: (req) => String((req.user && req.user.user_id) || ''),
  }),
  (req, res) => {
    const body = req.body || {};
    const itemId = Number(body.item_id);
    const borrowerId = Number(body.borrower_id);

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return fail(req, res, 400, 40001, '参数校验失败：item_id 必填', { field: 'item_id' });
    }
    if (!Number.isInteger(borrowerId) || borrowerId <= 0) {
      return fail(req, res, 400, 40001, '参数校验失败：borrower_id 必填', { field: 'borrower_id' });
    }

    const owner = findUser(req.user && req.user.user_id);
    if (!owner) return fail(req, res, 401, 40101, '未登录或 Token 失效，请重新登录');

    const item = findItem(itemId);
    if (!item) return fail(req, res, 404, 40401, '资源不存在');
    if (item.owner_id !== owner.id) {
      return fail(req, res, 403, 40301, '只有出借人可以同意借用');
    }
    if (item.status !== 0) {
      return fail(req, res, 409, 40901, '物品当前不可借', { current_status: item.status });
    }

    const borrower = findUser(borrowerId);
    if (!borrower) return fail(req, res, 404, 40401, '借用人不存在');
    if (borrower.id === owner.id) {
      return fail(req, res, 409, 40902, '不能借用自己发布的物品');
    }

    const available = availableOf(borrower);
    if (available < item.deposit_score) {
      return fail(req, res, 403, 40301, '对方信用分不足', {
        current_available: available,
        required_score: item.deposit_score,
      });
    }

    let dueAt;
    if (typeof body.due_at === 'string' && body.due_at && !Number.isNaN(Date.parse(body.due_at))) {
      dueAt = body.due_at;
    } else {
      dueAt = isoWithOffset(new Date(Date.now() + DEFAULT_LOAN_HOURS * 3600 * 1000));
    }

    const order = createOrderRecord({ item, borrower, dueAt });

    addNotification({
      user_id: borrower.id,
      type: 'order',
      title: `出借人已同意您借用「${item.title}」`,
      body: '请在聊天窗口查看凭证并完成交接。',
      ref_id: order.id,
    });

    // 通过内存消息通道推给借用人，触发凭证流程
    addMessage({
      from: owner.id,
      to: borrower.id,
      item_id: item.id,
      type: 'borrow_accept',
      content: '出借人已同意借用',
      meta: {
        order_id: order.id,
        item_id: item.id,
        title: item.title,
        deposit_score: order.frozen_score,
        due_at: dueAt,
      },
    });

    commitDb();

    return ok(req, res, {
      order_id: order.id,
      frozen_score: order.frozen_score,
      state: order.state,
      due_at: dueAt,
    });
  }
);

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
router.post(
  '/create',
  createRateLimit({
    windowMs: 60 * 1000,
    max: 1,
    keyPrefix: 'order-create',
    keyGenerator: (req) => String((req.user && req.user.user_id) || ''),
  }),
  (req, res) => {
    const body = req.body || {};
    const itemId = Number(body.item_id);

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return fail(req, res, 400, 40001, '参数校验失败：item_id 必填且为正整数', {
        field: 'item_id',
      });
    }

    const item = findItem(itemId);
    if (!item) {
      return fail(req, res, 404, 40401, '资源不存在');
    }

    if (item.status === 1) {
      return fail(req, res, 409, 40901, '物品已被借出');
    }

    // 不能借用自己发布的物品（否则等于自己给自己刷信用）
    if (item.owner_id === (req.user && req.user.user_id)) {
      return fail(req, res, 409, 40902, '不能借用自己发布的物品');
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

    const order = createOrderRecord({ item, borrower, dueAt });

    // 通知出借人：有人申请借用
    addNotification({
      user_id: order.owner_id,
      type: 'order',
      title: `${maskName(borrower.real_name)} 申请借用您的「${item.title}」`,
      body: '请及时处理，确认后即可交接。',
      ref_id: order.id,
    });

    commitDb();

    return ok(req, res, {
      order_id: order.id,
      frozen_score: order.frozen_score,
      state: order.state,
    });
  }
);

module.exports = router;
