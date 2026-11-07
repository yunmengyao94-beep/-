'use strict';

/**
 * 鉴权中间件
 * ---------------------------------------------------------------
 * 校验请求头 `Authorization: Bearer <token>`：
 *   - 缺少 / 格式错误 / 签名无效 / 已过期 → 401 + error(40101, '未登录或Token失效')
 *   - 校验通过 → 把 JWT 载荷挂到 req.user，交后续路由使用
 *
 * 白名单由调用方（app.js）注入，支持「按路径 + 按方法」精确放行：
 *   auth({
 *     secret,
 *     publicPaths: [
 *       '/api/v1/health',                                 // 字符串 = 该路径所有方法公开
 *       '/api/v1/auth/login',
 *       { path: '/api/v1/items', methods: ['GET'] },      // 仅 GET 公开，POST 仍需 Token
 *       { path: '/api/v1/items/:id', methods: ['GET'] },  // :id 为路径参数占位符
 *     ],
 *   })
 * 方法未在 methods 中命中时一律要求 Token —— 避免「浏览公开」被顺带放开成「发布公开」。
 *
 * 依据：计划书 7.1（Authorization: Bearer <JWT>）、7.2（错误码 40101）
 */

const jwt = require('jsonwebtoken');
const { fail } = require('../utils/http');
const { isRevoked } = require('../services/token-blacklist');

/** Bearer 方案匹配（大小写不敏感，允许中间多个空格） */
const BEARER = /^Bearer\s+(\S+)$/i;

/** 统一错误提示（7.2：40101 未登录或 Token 失效） */
const AUTH_FAIL_MSG = '未登录或Token失效';

/** 正则元字符转义 */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * 路径模板 → 正则：`/api/v1/items/:id` ⇒ /^\/api\/v1\/items\/[^/]+\/?$/
 * @param {string} pattern 路径模板
 * @returns {RegExp}
 */
function pathToRegex(pattern) {
  const raw = String(pattern);
  const withLeadingSlash = raw.startsWith('/') ? raw : '/' + raw;
  const normalized = withLeadingSlash.replace(/\/+$/, '') || '/';
  const source = normalized
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(REGEX_SPECIAL, '\\$&')))
    .join('/');
  return new RegExp('^' + source + '/?$');
}

/**
 * 规范化白名单条目
 * @param {string|{path: string, methods?: string[]}} entry
 * @returns {{regex: RegExp, methods: Set<string>|null}}
 */
function compileEntry(entry) {
  if (typeof entry === 'string') {
    return { regex: pathToRegex(entry), methods: null };
  }
  return {
    regex: pathToRegex(entry.path),
    methods: entry.methods ? new Set(entry.methods.map((m) => String(m).toUpperCase())) : null,
  };
}

/**
 * 创建鉴权中间件
 * @param {object} [options]
 * @param {string} [options.secret] JWT 密钥，缺省读 process.env.JWT_SECRET
 * @param {Array<string|{path: string, methods?: string[]}>} [options.publicPaths] 免鉴权白名单
 * @returns {import('express').RequestHandler}
 */
function createAuth(options = {}) {
  const secret = options.secret || process.env.JWT_SECRET;
  const publicPaths = (options.publicPaths || []).map(compileEntry);

  if (!secret) {
    throw new Error('[auth] 缺少 JWT 密钥：请传入 options.secret 或设置 JWT_SECRET');
  }

  return function authMiddleware(req, res, next) {
    // 预检请求由 cors 中间件处理，不参与鉴权
    if (req.method === 'OPTIONS') return next();

    // 去掉尾部斜杠后与白名单比对
    const pathname = (req.path || '/').replace(/\/+$/, '') || '/';

    const isPublic = publicPaths.some(
      (entry) => entry.regex.test(pathname) && (!entry.methods || entry.methods.has(req.method))
    );
    if (isPublic) return next();

    const header = req.headers.authorization || '';
    const matched = header.match(BEARER);
    if (!matched) {
      return fail(req, res, 401, 40101, AUTH_FAIL_MSG);
    }

    try {
      const token = matched[1];

      // 已登出的 token（黑名单）立即失效
      if (isRevoked(token)) {
        return fail(req, res, 401, 40101, AUTH_FAIL_MSG);
      }

      req.user = jwt.verify(token, secret);
      req.token = token;
      return next();
    } catch {
      // 过期 / 签名不符 / 结构非法，统一按「未登录或Token失效」处理，避免暴露玄机
      return fail(req, res, 401, 40101, AUTH_FAIL_MSG);
    }
  };
}

module.exports = createAuth;
module.exports.AUTH_FAIL_MSG = AUTH_FAIL_MSG;
module.exports.pathToRegex = pathToRegex;
