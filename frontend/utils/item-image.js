/**
 * 物品图片解析
 * ---------------------------------------------------------------------------
 * 背景：接口只下发 `image_hash`，没有真实商品图 URL。
 * 规则（严格顺序）：
 *   1. 物品自带 `image`（真实图片地址）→ 直接用
 *   2. 标题命中关键词 → 对应的本地插画（assets/icons/item-*.png）
 *   3. 都没命中 → assets/icons/default-placeholder.png
 *
 * 说明：绝不按「分类」猜图。之前用 category 映射，导致所有 other 类物品
 *      （雨伞、保温箱、行李箱…）都显示同一张伞图，这就是"图片错乱"的根因。
 */

const ICON_BASE = './assets/icons/';

/** 兜底占位图 */
export const DEFAULT_ITEM_IMAGE = `${ICON_BASE}default-placeholder.png`;

/**
 * 关键词 → 图标。顺序敏感：先匹配更具体的词。
 * 注意「学士服 / 毕业礼服」要排在「礼服」之前。
 */
const RULES = [
  { test: /雨伞|太阳伞|遮阳伞|伞$/, icon: 'item-umbrella.png' },
  { test: /保温箱|冷藏箱|收纳箱|工具箱/, icon: 'item-box.png' },
  { test: /学士服|硕士服|毕业礼服|学士帽|学位服/, icon: 'item-gown.png' },
  { test: /假发/, icon: 'item-wig.png' },
  {
    test: /西装|正装裙|旗袍|礼服|大衣|外套|衬衫|领带|羽绒服|长裙|马甲|裙/,
    icon: 'item-clothes.png',
  },
  {
    test: /相机|镜头|平板|笔记本|手表|音箱|移动电源|电源|手柄|投影|数位板|词典|三脚架|补光|麦克风|显示器|电脑|耳机|键盘|鼠标/,
    icon: 'item-digital.png',
  },
  {
    test: /电钻|螺丝刀|卷尺|折叠梯|扳手|胶枪|万用表|打气筒|补胎|钻头|显微镜|实验箱|钳|锤|锯/,
    icon: 'item-tool.png',
  },
  { test: /绘图板|地球仪|白板|画板|书|笔/, icon: 'item-study.png' },
  { test: /行李箱|旅行箱|箱包/, icon: 'item-luggage.png' },
  { test: /折叠椅|椅子|帐篷|露营|野营|户外|登山/, icon: 'item-outdoor.png' },
];

/**
 * 解析物品图片地址
 * @param {{title?: string, image?: string, category?: string}|null} item
 * @returns {string} 可直接用于 <img src> 的地址
 */
export function resolveItemImage(item) {
  if (!item) return DEFAULT_ITEM_IMAGE;

  // 1) 接口若已提供真实图片，优先使用
  if (typeof item.image === 'string' && item.image.trim()) return item.image.trim();

  const title = String(item.title || '').trim();
  if (!title) return DEFAULT_ITEM_IMAGE;

  // 2) 标题关键词
  for (const rule of RULES) {
    if (rule.test.test(title)) return `${ICON_BASE}${rule.icon}`;
  }

  // 3) 兜底：统一占位图
  return DEFAULT_ITEM_IMAGE;
}

export default resolveItemImage;
