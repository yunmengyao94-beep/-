'use strict';

/**
 * 系统信息路由（公开，无需登录）
 * 挂载点：/api/v1/system
 *
 * GET /version —— 版本探测，供 Web / EXE / APK 做「柔和更新提示」
 *   · 客户端：只提示、可关闭、不拦截
 *   · 浏览器：提示刷新
 */

const express = require('express');
const { ok } = require('../utils/http');

const router = express.Router();

/** 服务端版本号：与 package.json 同步维护 */
const SERVER_VERSION = '1.0.0';
const RELEASED_AT = '2026-11-10';
const NOTES = ['聊天支持借用申请与凭证', '物品图片交接后自动降级 128px', '离线缓存与版本提示'];

/** 旧客户端仍可用的最低版本（低于此版本仅提示，不拦截） */
const MIN_SUPPORTED_VERSION = '0.9.0';

router.get('/version', (req, res) => {
  return ok(req, res, {
    version: SERVER_VERSION,
    released_at: RELEASED_AT,
    notes: NOTES,
    min_supported_version: MIN_SUPPORTED_VERSION,
    api_version: 1,
  });
});

module.exports = router;
module.exports.SERVER_VERSION = SERVER_VERSION;
module.exports.MIN_SUPPORTED_VERSION = MIN_SUPPORTED_VERSION;
