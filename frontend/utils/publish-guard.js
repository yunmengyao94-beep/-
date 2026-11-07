/**
 * 发布防爆破（敏感词连击锁）
 * ---------------------------------------------------------------------------
 * 规则：同一设备 10 分钟内连续 3 次因敏感词被拒 → 锁定发布按钮 5 分钟。
 * 目的：防止有人用脚本反复试探哪些词能过审。
 */

const HITS_KEY = 'yxx_sensitive_hits';
const LOCK_KEY = 'yxx_publish_lock_until';

/** 触发锁定的次数 */
export const MAX_HITS = 3;
/** 连续命中的统计窗口：10 分钟 */
const HIT_WINDOW_MS = 10 * 60 * 1000;
/** 锁定时长：5 分钟 */
export const LOCK_MS = 5 * 60 * 1000;

/** 读取有效命中时间戳（清理过期） */
function readHits() {
  try {
    const raw = localStorage.getItem(HITS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];

    const now = Date.now();
    return list.filter((ts) => Number(ts) && now - Number(ts) < HIT_WINDOW_MS);
  } catch {
    return [];
  }
}

function writeHits(list) {
  try {
    localStorage.setItem(HITS_KEY, JSON.stringify(list));
  } catch {
    // 忽略
  }
}

/**
 * 当前是否处于锁定状态
 * @returns {{locked: boolean, remainMs: number, remainSeconds: number}}
 */
export function getPublishLock() {
  try {
    const until = Number(localStorage.getItem(LOCK_KEY) || 0);
    const remain = until - Date.now();

    if (remain > 0) {
      return { locked: true, remainMs: remain, remainSeconds: Math.ceil(remain / 1000) };
    }

    if (until) localStorage.removeItem(LOCK_KEY);
  } catch {
    // 忽略
  }

  return { locked: false, remainMs: 0, remainSeconds: 0 };
}

/**
 * 记录一次敏感词命中
 * @returns {{locked: boolean, remainMs: number, remainSeconds: number, hits: number}}
 */
export function recordSensitiveHit() {
  const hits = readHits();
  hits.push(Date.now());
  writeHits(hits);

  if (hits.length >= MAX_HITS) {
    const until = Date.now() + LOCK_MS;
    try {
      localStorage.setItem(LOCK_KEY, String(until));
      localStorage.removeItem(HITS_KEY);
    } catch {
      // 忽略
    }

    return { locked: true, remainMs: LOCK_MS, remainSeconds: Math.ceil(LOCK_MS / 1000), hits: 0 };
  }

  return { locked: false, remainMs: 0, remainSeconds: 0, hits: hits.length };
}

/** 发布成功后清空计数 */
export function clearSensitiveHits() {
  try {
    localStorage.removeItem(HITS_KEY);
  } catch {
    // 忽略
  }
}

export default { getPublishLock, recordSensitiveHit, clearSensitiveHits, MAX_HITS, LOCK_MS };
