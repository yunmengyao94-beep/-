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

const { ok, fail, isoWithOffset } = require('../utils/http');
const { createRateLimit } = require('../middlewares/rate-limit');
const { revoke } = require('../services/token-blacklist');
const {
  findUser,
  findUserByStudentNo,
  findAccountByStudentNo,
  verifyPassword,
  hashPassword,
  createAccount,
  ensureUserForStudent,
  persistDb,
} = require('../store');

/** 试点统一学院（白名单固定，注册时不再让用户选择） */
const COLLEGE_NAME = '计算机科学与信息技术学院';

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
    const whitelistUser = findUserByStudentNo(studentNo);

    // 白名单内但还没设置密码 → 引导去注册页激活
    if ((account && !account.password) || (!account && whitelistUser)) {
      return fail(req, res, 403, 40303, '账号尚未激活，请先前往注册页完成身份核验与密码设置');
    }

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
   * 请求：{ student_no, name, password, building, room }
   * 规则：只允许试点白名单内的「学号 + 姓名」注册；已激活的账号拒绝重复注册
   */
  router.post(
    '/register',
    createRateLimit({ windowMs: 60 * 1000, max: 1, keyPrefix: 'register' }),
    (req, res) => {
      const body = req.body || {};

      const studentNo = typeof body.student_no === 'string' ? body.student_no.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const building = typeof body.building === 'string' ? body.building.trim() : '';
      const room = typeof body.room === 'string' ? body.room.trim() : '';

      if (!STUDENT_NO_PATTERN.test(studentNo)) {
        return fail(req, res, 400, 40001, '参数校验失败：学号需为 13 位数字且以 25/24 开头', {
          field: 'student_no',
        });
      }

      if (!name) {
        return fail(req, res, 400, 40001, '参数校验失败：姓名必填', { field: 'name' });
      }

      if (password.length < 6) {
        return fail(req, res, 400, 40001, '参数校验失败：密码至少 6 位', { field: 'password' });
      }

      if (!building) {
        return fail(req, res, 400, 40001, '参数校验失败：公寓必填', { field: 'building' });
      }

      if (!ROOM_PATTERN.test(room)) {
        return fail(req, res, 400, 40001, '参数校验失败：房间号需为 3 位数字', { field: 'room' });
      }

      // 1) 白名单核验：学号必须是试点用户
      const whitelistUser = findUserByStudentNo(studentNo);
      if (!whitelistUser) {
        return fail(req, res, 403, 40302, '身份核验失败，您不在本次试点名单内');
      }

      // 2) 姓名必须与白名单完全一致
      if (String(whitelistUser.real_name || '').trim() !== name) {
        return fail(req, res, 403, 40302, '身份核验失败，您不在本次试点名单内');
      }

      // 3) 已激活则拒绝重复注册
      const existing = findAccountByStudentNo(studentNo);
      if (existing && existing.password) {
        return fail(req, res, 409, 40902, '该账号已激活，请直接登录', { field: 'student_no' });
      }

      // 4) 激活：写入密码 / 公寓 / 房间号
      let account = existing;

      if (!account) {
        const created = createAccount({
          student_no: studentNo,
          password,
          name,
          college: COLLEGE_NAME,
          building,
          room,
        });

        if (!created.ok) {
          return fail(req, res, 409, 40902, '该账号已激活，请直接登录', { field: 'student_no' });
        }

        account = created.account;
      } else {
        account.password = hashPassword(password);
        account.building = building;
        account.room = room;
        if (!account.college) account.college = COLLEGE_NAME;
      }

      // 5) 同步用户档案
      whitelistUser.real_name = name;
      if (!whitelistUser.college_name) whitelistUser.college_name = COLLEGE_NAME;
      whitelistUser.building_loc = building;
      whitelistUser.updated_at = isoWithOffset();

      persistDb();

      return ok(req, res, {
        user_id: whitelistUser.id,
        student_no: studentNo,
        name,
      });
    }
  );

  /**
   * POST /api/v1/auth/refresh
   * 用旧 Token 换新 Token（旧 Token 立即拉黑），实现「活跃用户不掉线」
   */
  router.post('/refresh', (req, res) => {
    const payload = req.user || {};
    const oldToken = req.token;

    const user = findUser(payload.user_id);
    if (!user || !oldToken) {
      return fail(req, res, 401, 40101, '未登录或Token失效');
    }

    revoke(oldToken, payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0);

    const token = signToken(user, payload.student_no || user.student_no);
    return ok(req, res, { token, token_type: 'Bearer', expires_in: ttlSeconds });
  });

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
