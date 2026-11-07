'use strict';

/**
 * 用户路由（计划书 7.4：API-04 个人信息与信用等级）
 * 挂载点：/api/v1/users
 *
 * 本批新增：
 *   POST /credit/bonus —— 端侧 OCR 认证成功后的信用分奖励（落库 + 写流水）
 */

const express = require('express');
const { ok, fail } = require('../utils/http');
const { maskStudentNo, maskName } = require('../utils/mask');
const { isoWithOffset } = require('../utils/http');
const {
  findUser,
  findAccountByStudentNo,
  availableOf,
  listCreditLogs,
  appendCreditLog,
  persistDb,
} = require('../store');

const router = express.Router();

/** 单次认证奖励分 */
const AI_CERT_BONUS = 10;
/** 同一用户两次认证奖励的最小间隔（24 小时） */
const AI_CERT_COOLDOWN_MS = 24 * 3600 * 1000;

/**
 * GET /api/v1/users/me
 * 返回个人信息（脱敏）+ 信用摘要 + 全部信用流水（时间倒序）
 */
router.get('/me', (req, res) => {
  const user = findUser(req.user && req.user.user_id);
  if (!user) {
    return fail(req, res, 404, 40401, '资源不存在');
  }

  return ok(req, res, {
    user_id: user.id,
    student_no: maskStudentNo(user.student_no),
    real_name: maskName(user.real_name),
    college_code: user.college_code,
    major_code: user.major_code,
    building_loc: user.building_loc,
    room_no: (findAccountByStudentNo(user.student_no) || {}).room || '',
    invite_code: user.invite_code,
    status: user.status,
    created_at: user.created_at,
    credit: {
      score: user.credit_score,
      frozen: user.credit_frozen,
      available: availableOf(user),
      level: user.credit_level,
      level_code: 'L' + user.credit_level,
    },
    credit_logs: listCreditLogs(user.id),
  });
});

/**
 * POST /api/v1/users/credit/bonus
 * 请求：{ source: 'ai_cert' }
 * 说明：
 *   · 仅支持 AI 认证奖励（+10），不接受前端自定义分值，避免刷分
 *   · 同一用户 24 小时内只能领一次
 *   · 写 credit_logs（delta = +10，余额同步增加），并落盘
 */
router.post('/credit/bonus', (req, res) => {
  const source = req.body && req.body.source;
  if (source !== 'ai_cert') {
    return fail(req, res, 400, 40001, '参数校验失败：source 仅支持 ai_cert', { field: 'source' });
  }

  const user = findUser(req.user && req.user.user_id);
  if (!user) {
    return fail(req, res, 404, 40401, '资源不存在');
  }

  const now = Date.now();
  const logs = listCreditLogs(user.id);
  const lastCert = logs.find((log) => log.ref_type === 'ai_cert');
  if (lastCert && now - Date.parse(lastCert.created_at) < AI_CERT_COOLDOWN_MS) {
    return fail(req, res, 409, 40902, '今日认证奖励已领取，明天再来试试');
  }

  user.credit_score += AI_CERT_BONUS;
  user.credit_available = availableOf(user);

  const createdAt = isoWithOffset();

  appendCreditLog({
    user_id: user.id,
    change_type: 'add',
    delta: AI_CERT_BONUS,
    balance_after: user.credit_score,
    frozen_after: user.credit_frozen,
    ref_type: 'ai_cert',
    ref_id: null,
    reason: `芝麻信用认证奖励 +${AI_CERT_BONUS}`,
    created_at: createdAt,
  });

  persistDb();

  return ok(req, res, {
    credit: {
      score: user.credit_score,
      frozen: user.credit_frozen,
      available: availableOf(user),
      level: user.credit_level,
      level_code: 'L' + user.credit_level,
    },
    bonus: AI_CERT_BONUS,
  });
});

/**
 * PATCH /api/v1/users/me
 * 请求：{ college_code?, building_loc?, room_no? }
 * 说明：转专业 / 换宿舍后自助修改，同步更新用户档案与账号表
 */
router.patch('/me', (req, res) => {
  const user = findUser(req.user && req.user.user_id);
  if (!user) {
    return fail(req, res, 404, 40401, '资源不存在');
  }

  const body = req.body || {};
  const hasCollege = typeof body.college_code === 'string';
  const hasBuilding = typeof body.building_loc === 'string';
  const hasRoom = typeof body.room_no === 'string';

  const college = hasCollege ? body.college_code.trim() : '';
  const building = hasBuilding ? body.building_loc.trim() : '';
  const room = hasRoom ? body.room_no.trim() : '';

  if (hasCollege && (!college || college.length > 10)) {
    return fail(req, res, 400, 40001, '参数校验失败：学院代码 1–10 个字符', {
      field: 'college_code',
    });
  }
  if (hasBuilding && (!building || building.length > 20)) {
    return fail(req, res, 400, 40001, '参数校验失败：楼栋 1–20 个字符', { field: 'building_loc' });
  }
  if (hasRoom && room && !/^\d{3}$/.test(room)) {
    return fail(req, res, 400, 40001, '参数校验失败：房间号需为 3 位数字', { field: 'room_no' });
  }

  if (hasCollege) user.college_code = college;
  if (hasBuilding) user.building_loc = building;
  user.updated_at = isoWithOffset();

  const account = findAccountByStudentNo(user.student_no);
  if (account) {
    if (hasCollege) account.college = college;
    if (hasBuilding) account.building = building;
    if (hasRoom) account.room = room;
  }

  persistDb();

  return ok(req, res, {
    user_id: user.id,
    college_code: user.college_code,
    building_loc: user.building_loc,
    room_no: account ? account.room : '',
  });
});

module.exports = router;
