'use strict';

/**
 * 物品路由（计划书 7.4：API-05 物品列表、物品详情）
 * 挂载点：/api/v1/items
 */

const express = require('express');
const { ok, fail } = require('../utils/http');
const { parseLimit, encodeCursor, decodeCursor } = require('../utils/pagination');
const { db, findItem } = require('../store');

const router = express.Router();

/**
 * GET /api/v1/items
 * 查询：limit（默认 10，上限 50）、cursor（游标，基于 id）
 * 排序：id DESC（新发布在前，便于游标稳定遍历）
 */
router.get('/', (req, res) => {
  const limitParsed = parseLimit(req.query.limit);
  if (limitParsed.error) {
    return fail(req, res, 400, 40001, limitParsed.error, { field: 'limit' });
  }

  const cursor = decodeCursor(req.query.cursor);
  if (cursor.error) {
    return fail(req, res, 400, 40001, cursor.error, { field: 'cursor' });
  }

  const limit = limitParsed.value;
  const ordered = db.items.slice().sort((a, b) => b.id - a.id);
  const rest = cursor.id === null ? ordered : ordered.filter((item) => item.id < cursor.id);
  const page = rest.slice(0, limit);
  const hasMore = rest.length > limit;

  return ok(req, res, {
    list: page,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(page[page.length - 1].id) : null,
      sort: 'id DESC',
    },
  });
});

/**
 * GET /api/v1/items/:id
 * 不存在时返回 40401（计划书 7.2）
 */
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return fail(req, res, 400, 40001, '参数校验失败：id 必须为正整数', { field: 'id' });
  }

  const item = findItem(id);
  if (!item) {
    return fail(req, res, 404, 40401, '资源不存在');
  }

  return ok(req, res, item);
});

module.exports = router;
