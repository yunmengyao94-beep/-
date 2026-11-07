'use strict';

/**
 * 自定义 ESLint 规则：no-absolute-position
 * ---------------------------------------------------------------
 * 目的：禁止使用 `position: absolute` 做布局（易校圈前端规范）。
 * 覆盖的代码形态：
 *   1. 对象字面量：      { position: 'absolute' }
 *   2. 属性赋值：        el.style.position = 'absolute'
 *   3. 字符串/模板串：   'position:absolute'、`left:0;position: absolute;`
 *
 * 说明：本规则只解析 JS。.css / .html 中的同类写法由
 * scripts/check-no-absolute.js 统一扫描（ESLint 无法解析样式文件）。
 */

const POSITION_DECL = /position\s*:\s*["']?\s*absolute/i;

/** 是否为 `position` 键名 */
function isPositionKey(node) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === 'position';
  if (node.type === 'Literal') return String(node.value) === 'position';
  return false;
}

/** 字符串值是否等于 absolute（忽略大小写与空白） */
function isAbsoluteValue(node) {
  return (
    node &&
    node.type === 'Literal' &&
    typeof node.value === 'string' &&
    node.value.trim().toLowerCase() === 'absolute'
  );
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止使用 position: absolute 做布局',
      category: 'Styling',
      recommended: true,
    },
    schema: [],
    messages: {
      forbidden: '禁止使用 position: absolute 做布局，请改用 flex / grid（易校圈前端规范）',
    },
  },

  create(context) {
    function report(node) {
      context.report({ node, messageId: 'forbidden' });
    }

    return {
      // 1 & 3：对象字面量与字符串（模板串由 TemplateElement 覆盖）
      Property(node) {
        if (isPositionKey(node.key) && isAbsoluteValue(node.value)) report(node);
      },

      // 2：el.style.position = 'absolute' / el.style['position'] = 'absolute'
      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== 'MemberExpression') return;
        const prop = left.property;
        const name = left.computed
          ? prop.type === 'Literal'
            ? String(prop.value)
            : ''
          : prop.name;
        if (name === 'position' && isAbsoluteValue(node.right)) report(node);
      },

      // 3：任意字符串中出现 "position: absolute"（含 cssText 拼接）
      Literal(node) {
        if (typeof node.value === 'string' && POSITION_DECL.test(node.value)) report(node);
      },

      TemplateElement(node) {
        if (POSITION_DECL.test(node.value.raw)) report(node);
      },
    };
  },
};
