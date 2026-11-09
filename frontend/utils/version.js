/**
 * 版本号比较工具（纯函数，无 DOM 依赖，便于单测）
 */

/**
 * 解析 "1.2.3" / "1.2.3-beta.1" 为数字数组
 * @param {string} version
 * @returns {number[]}
 */
export function parseVersion(version) {
  const core = String(version || '')
    .trim()
    .split('-')[0];
  return core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * 比较两个版本
 * @param {string} a
 * @param {string} b
 * @returns {number} a>b 返回 1，相等 0，小于 -1
 */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const len = Math.max(va.length, vb.length);

  for (let i = 0; i < len; i += 1) {
    const x = va[i] || 0;
    const y = vb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** a 是否比 b 新 */
export function isNewerVersion(a, b) {
  return compareVersions(a, b) === 1;
}

export default { parseVersion, compareVersions, isNewerVersion };
