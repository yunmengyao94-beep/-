/**
 * 搜索历史（本机）
 * ---------------------------------------------------------------------------
 * 存最近 8 条关键词，支持去重、清空；用于首页搜索框的联想条。
 */

const KEY = 'yxx_search_history';
const MAX = 8;

/** 读取历史（最新在前） */
export function getHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((item) => typeof item === 'string' && item.trim())
      : [];
  } catch {
    return [];
  }
}

/**
 * 记录一次搜索
 * @param {string} keyword
 * @returns {string[]} 最新历史
 */
export function pushHistory(keyword) {
  const value = String(keyword || '').trim();
  if (!value) return getHistory();

  const list = [value, ...getHistory().filter((item) => item !== value)].slice(0, MAX);

  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 忽略
  }

  return list;
}

/** 清空历史 */
export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 忽略
  }
  return [];
}

export default { getHistory, pushHistory, clearHistory };
