'use strict';

/**
 * 消息中转路由（点对点聊天）
 * 挂载点：/api/v1/messages（需登录）
 *
 * 设计：
 *   · 只存内存，1 小时过期，绝不写 db.json
 *   · POST /  发送消息（文本 / 图片 / 语音 / 借用申请 / 借用通过 / 系统消息）
 *   · GET  /  按 since 拉取增量消息（客户端 10 秒轮询）
 */

const express = require('express');
const { ok, fail } = require('../utils/http');
const { addMessage, listMessages } = require('../services/message-store');
const { findUser, findItem } = require('../store');

const router = express.Router();

/** 允许的消息类型 */
const TYPES = new Set(['text', 'image', 'audio', 'borrow_request', 'borrow_accept', 'system']);

/** 单条内容上限（字符）：图片/语音为 base64，放宽到 1.2MB */
const MAX_CONTENT = 1_200_000;

function currentUser(req) {
  return findUser(req.user && req.user.user_id);
}

/** POST /api/v1/messages */
router.post('/', (req, res) => {
  const me = currentUser(req);
  if (!me) return fail(req, res, 404, 40401, '资源不存在');

  const body = req.body || {};
  const to = Number(body.to_user_id);
  const type = typeof body.type === 'string' ? body.type.trim() : 'text';
  const content = typeof body.content === 'string' ? body.content : '';
  const itemId = body.item_id ? Number(body.item_id) : null;

  if (!Number.isInteger(to) || to <= 0) {
    return fail(req, res, 400, 40001, '参数校验失败：to_user_id 必须为正整数', {
      field: 'to_user_id',
    });
  }
  if (to === me.id) {
    return fail(req, res, 400, 40001, '不能给自己发消息');
  }
  if (!findUser(to)) {
    return fail(req, res, 404, 40401, '接收方不存在');
  }
  if (!TYPES.has(type)) {
    return fail(req, res, 400, 40001, '参数校验失败：不支持的消息类型', { field: 'type' });
  }
  if (type !== 'borrow_request' && type !== 'borrow_accept' && !content.trim()) {
    return fail(req, res, 400, 40001, '消息内容不能为空');
  }
  if (content.length > MAX_CONTENT) {
    return fail(req, res, 400, 40001, '消息内容过大');
  }
  if (itemId && !findItem(itemId)) {
    return fail(req, res, 404, 40401, '关联物品不存在');
  }

  const message = addMessage({
    from: me.id,
    to,
    item_id: itemId,
    type,
    content,
    meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
  });

  return ok(req, res, message);
});

/** GET /api/v1/messages?since=0&item_id=1&partner_id=2 */
router.get('/', (req, res) => {
  const me = currentUser(req);
  if (!me) return fail(req, res, 404, 40401, '资源不存在');

  const since = Number(req.query.since) || 0;
  const itemId = req.query.item_id ? Number(req.query.item_id) : null;
  const partnerId = req.query.partner_id ? Number(req.query.partner_id) : null;

  const { list } = listMessages(me.id, { since, itemId, partnerId });

  return ok(req, res, { list, since: list.length ? list[list.length - 1].id : since });
});

module.exports = router;
