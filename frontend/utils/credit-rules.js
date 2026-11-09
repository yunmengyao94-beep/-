/**
 * 信用规则配置（本地优先，离线可用）
 * ---------------------------------------------------------------------------
 * 打包进 EXE / APK 的 config/credit_rules.json 是权威副本；
 * 运行时优先读本地 JSON，读取失败（file:// 限制等）则使用内置默认值，
 * 保证断网、无服务端时依然能渲染与校验。
 */

/** 内置默认值：与 config/credit_rules.json 保持一致 */
export const DEFAULT_CREDIT_RULES = Object.freeze({
  version: '1.0.0',
  initial_score: 100,
  deposit: { min: 1, max: 500, default: 20 },
  overdue: { daily_penalty: 5, settle_after_hours: 24 },
  levels: [
    { level: 6, min: 130, label: '信用极好' },
    { level: 5, min: 115, label: '信用优秀' },
    { level: 4, min: 100, label: '信用良好' },
    { level: 3, min: 85, label: '信用一般' },
    { level: 2, min: 70, label: '信用较弱' },
    { level: 1, min: 0, label: '信用较差' },
  ],
  ai_bonus: { score: 10, cooldown_hours: 24 },
  item: { title_max: 60, description_max: 200, offline_ttl_minutes: 30 },
});

const STORAGE_KEY = 'yxx_credit_rules';

let current = DEFAULT_CREDIT_RULES;
let loading = null;

/** 同步读取当前规则（未加载完成时返回默认值） */
export function getCreditRules() {
  return current;
}

/** 读取 localStorage 中缓存过的规则 */
function readCached() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.deposit ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 加载规则：本地 JSON → localStorage 缓存 → 内置默认
 * @returns {Promise<object>}
 */
export function loadCreditRules() {
  if (loading) return loading;

  const cached = readCached();
  if (cached) current = cached;

  loading = (async () => {
    try {
      const url = new URL('../config/credit_rules.json', import.meta.url);
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error('rules not found');
      const rules = await response.json();
      if (rules && rules.deposit) {
        current = rules;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
        } catch {
          // 忽略存储失败
        }
      }
    } catch {
      // 离线 / file:// 限制：保持缓存或默认值
    }
    return current;
  })();

  return loading;
}

export default { getCreditRules, loadCreditRules, DEFAULT_CREDIT_RULES };
