'use strict';

/**
 * 敏感词过滤（极简版）
 * ---------------------------------------------------------------------------
 * 目的：阻挡最明显的违规内容（代考、色情、赌博、办证等），属于"最低限度"内容安全，
 * 不能替代人工审核 / 第三方内容安全服务。
 */

/** 词表（命中即拒） */
const SENSITIVE_WORDS = [
  '代考',
  '代写',
  '代做',
  '论文代写',
  '原味',
  '约炮',
  '援交',
  '楼凤',
  '色情',
  '裸聊',
  '赌博',
  '博彩',
  '毒品',
  '冰毒',
  '枪支',
  '仿真枪',
  '迷药',
  '办证',
  '假证',
  '假发票',
  '刷单',
  '洗钱',
  '违禁品',
  '管制刀具',
];

/**
 * 检查文本是否包含敏感词
 * @param {string} text
 * @returns {{hit: boolean, words: string[]}}
 */
function checkSensitive(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return { hit: false, words: [] };

  const words = SENSITIVE_WORDS.filter((word) => source.includes(word.toLowerCase()));
  return { hit: words.length > 0, words };
}

module.exports = { checkSensitive, SENSITIVE_WORDS };
