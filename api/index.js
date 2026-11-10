'use strict';

/**
 * Vercel Serverless 入口
 * ---------------------------------------------------------------------------
 * 直接复用 Express 应用（server/app.js），不在这里 listen。
 * · /api            → 本文件
 * · /api/items 等    → api/[...path].js（同一份 app）
 */

const app = require('../server/app');

module.exports = app;
