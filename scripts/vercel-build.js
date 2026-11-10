'use strict';

/**
 * Vercel 静态构建脚本
 * ---------------------------------------------------------------------------
 * Vercel 的 Serverless Function 只承载 /api；前端作为静态站点发布。
 * 这里把 frontend/ 原样复制到 public/，由 Vercel 作为 Output Directory 托管。
 *
 * 不复制：
 *   · node_modules（不存在）
 *   · 本地环境文件（前端没有 .env）
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'frontend');
const target = path.join(root, 'public');

if (!fs.existsSync(source)) {
  console.error('[vercel-build] frontend 目录不存在');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

const count = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const full = path.join(dir, entry.name);
    return sum + (entry.isDirectory() ? count(full) : 1);
  }, 0);

console.info(`[vercel-build] 已复制前端 ${count(target)} 个文件到 public/`);
