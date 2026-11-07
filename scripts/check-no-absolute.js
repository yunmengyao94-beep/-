#!/usr/bin/env node
'use strict';

/**
 * 样式层「禁止 position: absolute」扫描器（补充 ESLint 的盲区）
 * ---------------------------------------------------------------------------
 * ESLint 只能解析 JS，无法检查 .css / .html。本脚本对样式文件做同一条约束：
 * 命中 `position: absolute`（忽略大小写与空白）即以非 0 退出码失败。
 *
 * 用法：
 *   node scripts/check-no-absolute.js            # 全量扫描 frontend/、assets/
 *   node scripts/check-no-absolute.js a.css b.html  # 只检查指定文件（lint-staged 调用）
 *
 * 设计取舍：
 *   - 注释内的示例代码不误报（先剥离 CSS/HTML/JS 注释，保留行号）
 *   - 不引入 stylelint 等额外依赖，保持 Sprint 1 零冗余
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = ['frontend', 'assets'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.pnpm-store',
  'dist',
  'build',
  'out',
  'coverage',
]);
const EXT = new Set(['.css', '.html', '.htm', '.js', '.mjs']);

const RULE = /position\s*:\s*["']?\s*absolute/i;

/** 把注释内容替换为空格，保留换行以维持行号 */
function stripComments(code, kind) {
  let out = code;
  if (kind === 'html') {
    out = out.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  }
  // CSS 与 HTML 内联 <style> 共用块注释
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (kind === 'js') {
    out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  }
  return out;
}

function kindOf(file) {
  const e = path.extname(file).toLowerCase();
  if (e === '.css') return 'css';
  if (e === '.html' || e === '.htm') return 'html';
  return 'js';
}

function scanFile(file) {
  const kind = kindOf(file);
  const raw = fs.readFileSync(file, 'utf8');
  const lines = stripComments(raw, kind).split(/\r?\n/);
  const hits = [];
  lines.forEach((line, i) => {
    const m = line.match(RULE);
    if (m) hits.push({ file, line: i + 1, col: m.index + 1, text: line.trim() });
  });
  return hits;
}

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name), acc);
    } else if (EXT.has(path.extname(ent.name).toLowerCase())) {
      acc.push(path.join(dir, ent.name));
    }
  }
  return acc;
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  let files;
  if (args.length > 0) {
    files = args.filter((f) => EXT.has(path.extname(f).toLowerCase())).map((f) => path.resolve(f));
  } else {
    files = TARGET_DIRS.map((d) => path.join(ROOT, d)).reduce((acc, d) => walk(d, acc), []);
  }

  const hits = files.reduce((acc, f) => acc.concat(scanFile(f)), []);
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

  if (hits.length === 0) {
    console.log(`[no-absolute] OK — 已检查 ${files.length} 个文件，未发现 position: absolute`);
    return 0;
  }

  console.error(
    `[no-absolute] 发现 ${hits.length} 处 position: absolute（前端规范禁止用作布局）：`
  );
  for (const h of hits) {
    console.error(`  ${rel(h.file)}:${h.line}:${h.col}  ${h.text}`);
  }
  console.error(
    '  建议：改用 flex / grid / 正常文档流；定位悬浮元素请用 position: sticky 或 fixed 并说明理由。'
  );
  return 1;
}

process.exit(main());
