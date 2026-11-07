'use strict';

/**
 * 用户路由（计划书 7.4：API-04 个人信息与信用等级）
 * 挂载点：/api/v1/users
 */

const express = require('express');
const { ok, fail } = require('../utils/http');
const { maskStudentNo, maskName } = require('../utils/mask');
const { findUser, availableOf, listCreditLogs } = require('../store');

const router = express.Router();

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

module.exports = router;
