'use strict';

/**
 * Vercel 动态 API 路由
 * ---------------------------------------------------------------------------
 * 文件名 [...path].js 是 Vercel 的 catch-all 约定：
 *   /api/items、/api/orders/1/state、/api/users/me …
 * 全部交给同一个 Express 应用处理，且保留原始路径。
 */

const app = require('../server/app');

module.exports = app;
