'use strict';

/**
 * 敏感词过滤（文本 + 拼音双通道）
 * ---------------------------------------------------------------------------
 * 1. 直接匹配：词表命中
 * 2. 归一化匹配：去掉空格、标点、符号、数字后再匹配（防「代 考」「原.味」「代^考」）
 * 3. 拼音匹配：整段转无标调拼音后匹配拼音规则（防谐音、错别字）
 *
 * 局限：仍无法覆盖图片、外语、口语化暗语；生产环境需接三方内容安全。
 */

const pinyinModule = require('pinyin');

/** pinyin v4 是 ESM 默认导出，这里兼容两种形态 */
const toPinyin = pinyinModule.default || pinyinModule;

/** 中文词表 */
const SENSITIVE_WORDS = [
  '代考',
  '代写',
  '代做',
  '论文代写',
  '原味',
  '约炮',
  '约p',
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
 * 拼音规则（不带声调）
 * 与词表一一对应，用于拦截谐音/拼音输入：
 *   daikao → 代考 / dai kǎo / daikao
 *   yuanwei → 原味 / 原.味
 */
const PINYIN_RULES = [
  'daikao',
  'daixie',
  'daizuo',
  'lunwendaixie',
  'yuanwei',
  'yuepao',
  'yuep',
  'yuanjiao',
  'loufeng',
  'seqing',
  'luoliao',
  'dubo',
  'bocai',
  'dupin',
  'bingdu',
  'qiangzhi',
  'fangzhenqiang',
  'miyao',
  'banzheng',
  'jiazheng',
  'jiafapiao',
  'shuadan',
  'xiqian',
  'weijinpin',
  'guanzhidaoju',
];

/** 去声调 + 去空白/标点/数字，得到用于比对的紧凑串 */
function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\p{P}\p{S}\d]/gu, '');
}

/**
 * 整段转无标调拼音（失败返回空串，不影响主流程）
 * @param {string} text
 * @returns {string}
 */
function toPlainPinyin(text) {
  try {
    const result = toPinyin(String(text || ''), { type: 'array' });
    const flat = Array.isArray(result) ? result.flat(Infinity) : [result];
    return normalize(flat.join(''));
  } catch {
    return '';
  }
}

/**
 * 检查文本是否包含敏感词
 * @param {string} text
 * @returns {{hit: boolean, words: string[], via: 'text'|'pinyin'|null}}
 */
function checkSensitive(text) {
  const source = String(text || '');
  if (!source.trim()) return { hit: false, words: [], via: null };

  const compact = normalize(source);
  const directHits = SENSITIVE_WORDS.filter((word) => compact.includes(normalize(word)));
  if (directHits.length > 0) {
    return { hit: true, words: directHits, via: 'text' };
  }

  const pinyinText = toPlainPinyin(source);
  if (pinyinText) {
    const pinyinHits = PINYIN_RULES.filter((rule) => pinyinText.includes(rule));
    if (pinyinHits.length > 0) {
      return { hit: true, words: pinyinHits, via: 'pinyin' };
    }
  }

  return { hit: false, words: [], via: null };
}

module.exports = { checkSensitive, normalize, toPlainPinyin, SENSITIVE_WORDS, PINYIN_RULES };
