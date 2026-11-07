'use strict';

/** 脱敏工具（计划书 6.5：学号 / 姓名脱敏展示） */

/**
 * 学号脱敏：2599080110120 → 2599****20
 * @param {string} studentNo
 * @returns {string}
 */
function maskStudentNo(studentNo) {
  const value = String(studentNo);
  if (value.length <= 6) return `${value.slice(0, 1)}****`;
  return `${value.slice(0, 4)}****${value.slice(-2)}`;
}

/**
 * 姓名脱敏：张同学 → 张**
 * @param {string} name
 * @returns {string}
 */
function maskName(name) {
  const value = String(name);
  return value.length <= 1 ? value : value[0] + '*'.repeat(value.length - 1);
}

module.exports = { maskStudentNo, maskName };
