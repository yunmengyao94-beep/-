/**
 * 全局枚举字典（与 docs/data_dictionary.md 严格对应）
 * ---------------------------------------------------------------------------
 * 约定：
 *   1. 页面里禁止写死中文映射，一律引用本文件
 *   2. 主字典只放「已确认」的枚举；数据中已出现但未定稿的取值放 *_EXTRA，
 *      由 xxxLabel() 统一兜底，避免页面出现 undefined
 *   3. 修改枚举须同步 docs/data_dictionary.md 与后端数据字典
 *
 * 依据：计划书 6.3.2（biz_item.category）、6.3.3（biz_order.state）
 */

/** 物品类目 · 主字典（6.3.2） */
export const CATEGORY = Object.freeze({
  apparel: '服饰',
  digital: '数码',
  tool: '工具',
  other: '其他',
});

/** 物品类目 · 补充字典：数据中已出现、待产品确认后并入主字典 */
export const CATEGORY_EXTRA = Object.freeze({
  teaching_aid: '教具',
});

/** 订单状态 · 主字典（6.3.3） */
export const ORDER_STATE = Object.freeze({
  0: '待交接',
  1: '使用中',
  2: '已完成',
  3: '仲裁中',
  5: '待出借人确认',
});

/** 订单状态 · 补充字典：6.3.3 定义的 4 = 已取消，当前产品流程未产生 */
export const ORDER_STATE_EXTRA = Object.freeze({
  4: '已取消',
});

/** 类目列表（用于渲染下拉框 / 筛选栏） */
export const CATEGORY_LIST = Object.freeze(
  Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))
);

/** 订单状态列表（用于状态筛选） */
export const ORDER_STATE_LIST = Object.freeze(
  Object.entries(ORDER_STATE).map(([value, label]) => ({ value: Number(value), label }))
);

/** 订单状态对应的可执行操作（0 交接 / 1 归还 等），仅作为 UI 提示，最终以后端校验为准 */
export const ORDER_STATE_ACTION = Object.freeze({
  0: ['handover', 'cancel'],
  1: ['return'],
  2: ['review', 'reborrow'],
  3: ['view'],
  4: ['view'],
});

/**
 * 类目 → 中文
 * @param {string} code 类目枚举值
 * @param {string} [fallback='其他'] 未命中时的兜底文案
 * @returns {string}
 */
export function categoryLabel(code, fallback = '其他') {
  return CATEGORY[code] || CATEGORY_EXTRA[code] || fallback;
}

/**
 * 订单状态 → 中文
 * @param {number|string} state 状态值
 * @param {string} [fallback='未知'] 未命中时的兜底文案
 * @returns {string}
 */
export function orderStateLabel(state, fallback = '未知') {
  const key = Number(state);
  if (Number.isNaN(key)) return fallback;
  return ORDER_STATE[key] ?? ORDER_STATE_EXTRA[key] ?? fallback;
}

/**
 * 是否高值类目（5.4.1 / 5.4.5：数码、假发、正装受限）
 * @param {string} code 类目枚举值
 * @returns {boolean}
 */
export function isHighValueCategory(code) {
  return ['digital', 'wig', 'formal_wear'].includes(code);
}

export default {
  CATEGORY,
  CATEGORY_EXTRA,
  CATEGORY_LIST,
  ORDER_STATE,
  ORDER_STATE_EXTRA,
  ORDER_STATE_LIST,
  ORDER_STATE_ACTION,
  categoryLabel,
  orderStateLabel,
  isHighValueCategory,
};
