/**
 * 格式化工具（纯函数，无副作用，便于单测）
 * ---------------------------------------------------------------------------
 * formatTime(timestamp)  → 'YYYY-MM-DD HH:mm'
 * formatCredit(score)    → 分数 < 60 时返回带红色样式的 HTML 片段，否则返回纯数字字符串
 */

/**
 * 时间格式化（按浏览器本地时区展示；后端按 6.1 存 UTC，接口返回 ISO 8601）
 * @param {number|string|Date} timestamp 毫秒时间戳 / 数字字符串 / ISO 8601 字符串 / Date
 * @returns {string} 形如 2026-11-07 10:30；非法输入返回空串
 */
export function formatTime(timestamp) {
  if (timestamp === null || timestamp === undefined || timestamp === '') return '';

  let value = timestamp;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    value = Number(value.trim());
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${ymd} ${hm}`;
}

/**
 * 信用分展示：低于 60 分（L1/L0 受限与冻结区）标红，提醒用户风险
 * @param {number|string} score 信用分
 * @returns {string} <60 时为红色 HTML 片段；≥60 时为纯数字字符串；非法输入为 '--'
 */
export function formatCredit(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return '--';

  if (value < 60) {
    return `<span class="credit-score credit-score--danger" style="color: var(--danger, #ff4d4f); font-weight: 600;">${value}</span>`;
  }

  return String(value);
}

export default { formatTime, formatCredit };
