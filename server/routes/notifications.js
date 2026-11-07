'use strict';

/**
 * 通知路由
 * 挂载点：/api/v1/notifications（需要 Token）
 *
 * 接口：
 *   GET  /              我的通知（时间倒序）+ 未读数
 *   PUT  /:id/read      标记单条已读
 *   PUT  /read-all      一键全部已读
 */

const express = require('express');
const { ok, fail } = require('../utils/http');
const {
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  persistDb,
} = require('../store');

const router = express.Router();

/** 当前登录用户 */
function currentUserId(req) {
  return (req.user && req.user.user_id) || null;
}

router.get('/', (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return fail(req, res, 401, 40101, '未登录或Token失效');

  const list = listNotifications(userId);

  return ok(req, res, {
    list,
    unread_count: list.filter((item) => !item.is_read).length,
  });
});

router.put('/read-all', (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return fail(req, res, 401, 40101, '未登录或Token失效');

  const updated = markAllNotificationsRead(userId);
  persistDb();

  return ok(req, res, { updated, unread_count: unreadNotificationCount(userId) });
});

router.put('/:id/read', (req, res) => {
  const userId = currentUserId(req);
  if (!userId) return fail(req, res, 401, 40101, '未登录或Token失效');

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return fail(req, res, 400, 40001, '参数校验失败：id 必须为正整数', { field: 'id' });
  }

  if (!markNotificationRead(userId, id)) {
    return fail(req, res, 404, 40401, '资源不存在');
  }

  persistDb();

  return ok(req, res, { id, is_read: true, unread_count: unreadNotificationCount(userId) });
});

module.exports = router;
