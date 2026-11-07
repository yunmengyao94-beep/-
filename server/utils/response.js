'use strict';

/**
 * 通用响应封装（Sprint 2 Batch 1）
 * ---------------------------------------------------------------
 * 约定形态：
 *   success(data)     → { code: 200, msg: 'success', data, timestamp }
 *   error(code, msg)  → { code, msg, data: null, timestamp }
 *
 * 与计划书 7.2 的关系：
 *   7.2 还要求 trace_id / server_time。为保证 HTTP 层仍满足 7.2，两个函数都接受
 *   可选的 extra 对象并在最后合并；不传时返回的就是上面文档化的最小形态，
 *   纯函数单测可直接断言四/五个字段。
 */

const SUCCESS_CODE = 200;
const SUCCESS_MSG = 'success';

/**
 * 成功响应
 * @param {*} [data=null] 业务数据
 * @param {Object|null} [extra=null] 额外字段（如 trace_id、server_time）
 * @returns {{code: number, msg: string, data: *, timestamp: number}}
 */
function success(data = null, extra = null) {
  const body = {
    code: SUCCESS_CODE,
    msg: SUCCESS_MSG,
    data,
    timestamp: Date.now(),
  };
  return extra ? Object.assign(body, extra) : body;
}

/**
 * 失败响应
 * @param {number} code 业务错误码（见计划书 7.2 错误码表）
 * @param {string} msg 可直接展示的中文提示
 * @param {*} [data=null] 错误上下文（如 { field: 'student_no' }）
 * @param {Object|null} [extra=null] 额外字段（如 trace_id、server_time）
 * @returns {{code: number, msg: string, data: *, timestamp: number}}
 */
function error(code, msg, data = null, extra = null) {
  const body = {
    code,
    msg,
    data,
    timestamp: Date.now(),
  };
  return extra ? Object.assign(body, extra) : body;
}

module.exports = { success, error, SUCCESS_CODE, SUCCESS_MSG };
