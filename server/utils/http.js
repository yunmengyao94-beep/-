'use strict';

/**
 * HTTP 层响应助手
 * ---------------------------------------------------------------
 * utils/response.js 负责「纯数据形态」（code/msg/data/timestamp），
 * 本模块负责「HTTP 语义」：状态码 + 计划书 7.2 的 trace_id / server_time。
 * 路由里统一用 ok() / fail()，不要直接 res.json()。
 */

const { success, error } = require('./response');

/** 生成 ISO 8601 且带 +08:00 偏移的时间串（7.1 时间约定） */
function isoWithOffset(date = new Date()) {
  const offsetMinutes = 8 * 60; // Asia/Shanghai 全年 +08:00，无夏令时
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    '+08:00'
  );
}

/** 7.2 附加字段（链路号 + 服务端时间） */
function traceExtra(req) {
  return { trace_id: req.traceId, server_time: isoWithOffset() };
}

/**
 * 成功响应
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {*} data 业务数据
 * @param {number} [httpStatus=200]
 */
function ok(req, res, data, httpStatus = 200) {
  return res.status(httpStatus).json(success(data, traceExtra(req)));
}

/**
 * 失败响应
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number} httpStatus HTTP 状态码
 * @param {number} code 业务错误码（7.2 错误码表）
 * @param {string} msg 中文提示
 * @param {*} [data=null] 错误上下文
 */
function fail(req, res, httpStatus, code, msg, data = null) {
  return res.status(httpStatus).json(error(code, msg, data, traceExtra(req)));
}

module.exports = { ok, fail, isoWithOffset, traceExtra };
