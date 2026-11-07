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
  applyOverduePenalties,
} = require('../store');
const { createRateLimit } = require('../middlewares/rate-limit');

const router = express.Router();

/** 单次认证奖励分 */
const AI_CERT_BONUS = 10;
/** 认证挑战有效期（10 分钟） */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

/** 已签发未使用的挑战：challenge → { userId, expiresAt } */
const creditChallenges = new Map();

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

  // 惰性逾期判定：超时未还的订单在此刻结算扣分
  applyOverduePenalties(user);

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
 * POST /api/v1/users/credit/challenge
 * 端侧 OCR 成功后在提交奖励前换取一次性挑战，防止直接用 curl 刷接口
 */
router.post(
  '/credit/challenge',
  createRateLimit({ windowMs: 60000, max: 10, keyPrefix: 'credit-challenge' }),
  (req, res) => {
    const user = findUser(req.user && req.user.user_id);
    if (!user) {
      return fail(req, res, 404, 40401, '资源不存在');
    }

    const challenge = `${user.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    creditChallenges.set(challenge, { userId: user.id, expiresAt });

    return ok(req, res, { challenge, expires_in: Math.floor(CHALLENGE_TTL_MS / 1000) });
  }
);

/**
 * POST /api/v1/users/credit/bonus
 * 请求：{ source: 'ai_cert' }
 * 说明：
 *   · 仅支持 AI 认证奖励（+10），不接受前端自定义分值，避免刷分
 *   · 同一用户 24 小时内只能领一次
 *   · 写 credit_logs（delta = +10，余额同步增加），并落盘
 */
router.post(
  '/credit/bonus',
  createRateLimit({ windowMs: 60000, max: 10, keyPrefix: 'credit-bonus' }),
  (req, res) => {
    const body = req.body || {};
    const source = body.source;
    if (source !== 'ai_cert') {
      return fail(req, res, 400, 40001, '参数校验失败：source 仅支持 ai_cert', { field: 'source' });
    }

    const imageHash = typeof body.image_hash === 'string' ? body.image_hash.trim() : '';
    if (!/^[0-9a-f]{8,64}$/i.test(imageHash)) {
      return fail(req, res, 400, 40001, '参数校验失败：缺少有效的图片指纹 image_hash', {
        field: 'image_hash',
      });
    }

    const challengeId = typeof body.challenge === 'string' ? body.challenge.trim() : '';
    const challenge = creditChallenges.get(challengeId);
    if (!challenge) {
      return fail(req, res, 400, 40001, '认证会话无效，请重新上传截图', { field: 'challenge' });
    }
    if (Date.now() > challenge.expiresAt) {
      creditChallenges.delete(challengeId);
      return fail(req, res, 400, 40001, '认证会话已过期，请重新上传截图', { field: 'challenge' });
    }

    const user = findUser(req.user && req.user.user_id);
    if (!user) {
      return fail(req, res, 404, 40401, '资源不存在');
    }

    if (Number(challenge.userId) !== Number(user.id)) {
      creditChallenges.delete(challengeId);
      return fail(req, res, 403, 40301, '认证会话与当前账号不匹配', { field: 'challenge' });
    }

    // 一次性消费，防止同一挑战重复领取
    creditChallenges.delete(challengeId);

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
  }
);

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
