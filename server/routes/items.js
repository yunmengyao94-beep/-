'use strict';

/**
 * 物品路由（计划书 7.4：API-05 物品列表、物品详情）
 * 挂载点：/api/v1/items
 */

const express = require('express');
const { ok, fail } = require('../utils/http');
const { parseLimit, encodeCursor, decodeCursor } = require('../utils/pagination');
const { db, findItem, findUser, persistDb } = require('../store');
const { maskName } = require('../utils/mask');

const router = express.Router();

/** 补充出借人信息（昵称脱敏 + 信用等级），避免前端写死兜底 */
function withOwner(item) {
  if (!item) return item;
  const owner = findUser(item.owner_id);

  return {
    ...item,
    owner: {
      id: item.owner_id,
      nickname: owner ? maskName(owner.real_name) : '同学',
      credit_level: owner ? owner.credit_level : 0,
      building_loc: owner ? owner.building_loc : '',
    },
  };
}

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
    list: page.map(withOwner),
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(page[page.length - 1].id) : null,
      sort: 'id DESC',
    },
  });
});

/**
 * POST /api/v1/items/publish（计划书 7.3.3）
 * 请求：{ title, category, image_hash, deposit_score, damage_rules, building_loc, is_high_value }
 * 处理：鉴权（网关已拦）→ 基础校验 → 写入内存 biz_item → 返回物品 ID 与曝光序号
 * 说明：演示阶段不做敏感词复检与图片落盘，仅校验字段结构与必填项。
 */
router.post('/publish', (req, res) => {
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const deposit = Number(body.deposit_score);

  if (title.length < 2) {
    return fail(req, res, 400, 40001, '参数校验失败：title 至少 2 个字符', { field: 'title' });
  }
  if (!category) {
    return fail(req, res, 400, 40001, '参数校验失败：category 必填', { field: 'category' });
  }
  if (!Number.isInteger(deposit) || deposit <= 0) {
    return fail(req, res, 400, 40001, '参数校验失败：deposit_score 必须为大于 0 的整数', {
      field: 'deposit_score',
    });
  }

  const isHighValue = body.is_high_value === true || body.is_high_value === 1 ? 1 : 0;
  const damageRules =
    body.damage_rules &&
    Array.isArray(body.damage_rules.rules) &&
    body.damage_rules.rules.length > 0
      ? body.damage_rules
      : { item_category: category, rules: [], max_deduct: 0, agreed_at_publish: true };

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const createdAt =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}+08:00`;

  const buildingLoc = typeof body.building_loc === 'string' ? body.building_loc.trim() : '';
  if (!buildingLoc) {
    return fail(req, res, 400, 40001, '参数校验失败：building_loc 必填', { field: 'building_loc' });
  }

  const owner = findUser(req.user && req.user.user_id);
  if (!owner) {
    return fail(req, res, 401, 40101, '未登录或 Token 失效，请重新登录');
  }

  const itemId = db.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  const item = {
    id: itemId,
    owner_id: owner.id,
    title,
    category,
    image_hash: typeof body.image_hash === 'string' ? body.image_hash : '',
    image_list: Array.isArray(body.image_list) ? body.image_list : [],
    deposit_score: deposit,
    damage_rules: damageRules,
    building_loc: buildingLoc,
    is_high_value: isHighValue,
    status: 0,
    expire_at: null,
    created_at: createdAt,
  };

  db.items.push(item);
  persistDb();

  return ok(req, res, {
    item_id: item.id,
    exposure_no: db.items.length,
    created_at: createdAt,
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

  return ok(req, res, withOwner(item));
});

module.exports = router;
