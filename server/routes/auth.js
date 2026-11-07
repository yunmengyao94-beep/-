'use strict';

/**
 * 账号路由（计划书 7.3.1 登录 / 注册）
 * 挂载点：/api/v1/auth
 *
 * 安全要点：
 *   · 密码以 scrypt 哈希存于服务端账号表，登录时恒定时间比对
 *   · 登录失败统一返回 401 + 40102「学号或密码错误」，不区分"账号不存在/密码错"
 *   · JWT 内含真实 user_id（账号即身份），不再是固定演示用户
 */

const express = require('express');
const jwt = require('jsonwebtoken');

const { ok, fail } = require('../utils/http');
const { createRateLimit } = require('../middlewares/rate-limit');
const { revoke } = require('../services/token-blacklist');
const {
  findAccountByStudentNo,
  verifyPassword,
  createAccount,
  ensureUserForStudent,
} = require('../store');

/** 学号规则：13 位数字，25 / 24 开头 */
const STUDENT_NO_PATTERN = /^(25|24)\d{11}$/;

/** 房间号：3 位数字 */
const ROOM_PATTERN = /^\d{3}$/;

/**
 * @param {{secret: string, ttlSeconds: number}} options
 */
function createAuthRouter(options) {
  const { secret, ttlSeconds } = options;
  const router = express.Router();

  // 登录/注册基础限流：同一 IP + 设备 1 分钟内最多 10 次
  router.use(createRateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: 'auth' }));

  /** 统一签发 JWT */
  function signToken(user, studentNo) {
    return jwt.sign(
      {
        user_id: user.id,
        sub: String(user.id),
        student_no: studentNo,
        role: 'student',
        role_level: 'L' + user.credit_level,
        iss: 'yxx',
      },
      secret,
      { expiresIn: ttlSeconds }
    );
  }

  /** 组装登录返回的用户信息（本人可见完整资料） */
  function toProfile(user, account) {
    return {
      user_id: user.id,
      student_no: account ? account.student_no : user.student_no,
      nickname: (account && account.name) || user.real_name,
      real_name: (account && account.name) || user.real_name,
      college_code: (account && account.college) || user.college_code,
      building_loc: (account && account.building) || user.building_loc,
      room_no: (account && account.room) || '',
      credit_score: user.credit_score,
      credit_available: user.credit_available,
      credit_level: user.credit_level,
    };
  }

  /**
   * POST /api/v1/auth/login
   * 请求：{ student_no, password }
   */
  router.post('/login', (req, res) => {
    const body = req.body || {};
    const studentNo = typeof body.student_no === 'string' ? body.student_no.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!studentNo || !password) {
      return fail(req, res, 400, 40001, '参数校验失败：学号与密码均不能为空', {
        field: !studentNo ? 'student_no' : 'password',
      });
    }

    if (!STUDENT_NO_PATTERN.test(studentNo)) {
      return fail(req, res, 400, 40001, '参数校验失败：学号需为 13 位数字且以 25/24 开头', {
        field: 'student_no',
      });
    }

    const account = findAccountByStudentNo(studentNo);
    if (!account || !verifyPassword(password, account.password)) {
      return fail(req, res, 401, 40102, '学号或密码错误');
    }

    // 账号存在但用户档案缺失时自愈
    const { user } = ensureUserForStudent(studentNo, {
      name: account.name,
      college: account.college,
      building: account.building,
    });

    return ok(req, res, {
      token: signToken(user, studentNo),
      token_type: 'Bearer',
      expires_in: ttlSeconds,
      user: toProfile(user, account),
    });
  });

  /**
   * POST /api/v1/auth/register
   * 请求：{ student_no, password, name, college, building, room }
   */
  router.post(
    '/register',
    createRateLimit({ windowMs: 60 * 1000, max: 1, keyPrefix: 'register' }),
    (req, res) => {
      const body = req.body || {};

      const studentNo = typeof body.student_no === 'string' ? body.student_no.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const college = typeof body.college === 'string' ? body.college.trim() : '';
      const building = typeof body.building === 'string' ? body.building.trim() : '';
      const room = typeof body.room === 'string' ? body.room.trim() : '';

      if (!STUDENT_NO_PATTERN.test(studentNo)) {
        return fail(req, res, 400, 40001, '参数校验失败：学号需为 13 位数字且以 25/24 开头', {
          field: 'student_no',
        });
      }
      if (password.length < 6) {
        return fail(req, res, 400, 40001, '参数校验失败：密码至少 6 位', { field: 'password' });
      }
      if (name.length < 2) {
        return fail(req, res, 400, 40001, '参数校验失败：姓名至少 2 个字符', { field: 'name' });
      }
      if (!college) {
        return fail(req, res, 400, 40001, '参数校验失败：学院必填', { field: 'college' });
      }
      if (!building) {
        return fail(req, res, 400, 40001, '参数校验失败：楼栋必填', { field: 'building' });
      }
      if (!ROOM_PATTERN.test(room)) {
        return fail(req, res, 400, 40001, '参数校验失败：房间号需为 3 位数字', { field: 'room' });
      }

      const result = createAccount({
        student_no: studentNo,
        password,
        name,
        college,
        building,
        room,
      });

      if (!result.ok) {
        return fail(req, res, 409, 40902, '该学号已注册，请直接登录', { field: 'student_no' });
      }

      return ok(req, res, {
        user_id: result.user.id,
        student_no: studentNo,
        name,
      });
    }
  );

  /**
   * POST /api/v1/auth/logout
   * 把当前 Token 加入黑名单（需带 Authorization: Bearer <token>）
   */
  router.post('/logout', (req, res) => {
    const token = req.token;
    const payload = req.user || {};

    if (!token) {
      return fail(req, res, 401, 40101, '未登录或Token失效');
    }

    const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0;
    revoke(token, ttl);

    return ok(req, res, { logged_out: true });
  });

  return router;
}

module.exports = { createAuthRouter, STUDENT_NO_PATTERN, ROOM_PATTERN };
