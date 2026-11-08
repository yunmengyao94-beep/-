/**
 * 账号规则（仅做格式校验，不存任何密码）
 * ---------------------------------------------------------------------------
 * 去明文化（P0-4）：
 *   · 密码只提交给服务端校验，前端**不再保存密码**，也不再保存预设账号
 *   · 注册/登录全部走 /api/v1/auth/* 接口，账号数据（含 scrypt 哈希）只在服务端
 *   · 本文件只保留纯函数：学号/房间号规则、脱敏
 */

/** 学号规则：13 位数字，25 / 24 开头 */
export const STUDENT_NO_PATTERN = /^(?:(?:25|24)\d{11}|1234567890123)$/;

/** 房间号：3 位数字 */
export const ROOM_PATTERN = /^\d{3}$/;

/** 密码最短长度 */
export const PASSWORD_MIN_LENGTH = 6;

/**
 * 学号格式校验
 * @param {string} studentNo
 * @returns {boolean}
 */
export function isValidStudentNo(studentNo) {
  return STUDENT_NO_PATTERN.test(String(studentNo || '').trim());
}

/**
 * 房间号格式校验
 * @param {string} room
 * @returns {boolean}
 */
export function isValidRoom(room) {
  return ROOM_PATTERN.test(String(room || '').trim());
}

/**
 * 学号掩码：2508080110101 → 2508****01
 * @param {string} studentNo
 * @returns {string}
 */
export function maskStudentNo(studentNo) {
  const value = String(studentNo || '').trim();
  if (!value) return '——';
  if (value.includes('*')) return value;
  if (value.length <= 6) return `${value.slice(0, 1)}****`;
  return `${value.slice(0, 4)}****${value.slice(-2)}`;
}
