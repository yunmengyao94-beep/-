/**
 * 下载 Tesseract.js 本地资源到 frontend/assets/ai/
 * ---------------------------------------------------------------------------
 * 用法：
 *   node scripts/fetch-ai-assets.mjs           # 已存在且大小一致则跳过
 *   node scripts/fetch-ai-assets.mjs --force   # 强制重新下载
 *
 * 产出：
 *   tesseract.min.js                 主库（<script> 引入）
 *   worker.min.js                    Worker 脚本
 *   tesseract-core-lstm.wasm.js      非 SIMD 内核（wasm 已内联）
 *   tesseract-core-simd-lstm.wasm.js SIMD 内核（现代浏览器优先用这个）
 *   chi_sim.traineddata.gz           简体中文语言包
 *   eng.traineddata.gz               英文/数字语言包
 *   integrity.json                   每个文件的 size + sha256
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'frontend', 'assets', 'ai');
const FORCE = process.argv.includes('--force');

const TESSERACT_VER = '5.1.1';
const CORE_VER = '5.1.0';

const CDN_JS = `https://cdn.jsdelivr.net/npm`;
const CDN_UNPKG = `https://unpkg.com`;
const CDN_NPMMIRROR = `https://registry.npmmirror.com`;
const TESSDATA = 'https://tessdata.projectnaptha.com/4.0.0';

/** 语言包体积大，单独给更长的超时 */
const TIMEOUT_MS = 120000;
const TIMEOUT_LANG_MS = 600000;

/** @type {{name: string, size: number, big?: boolean, urls: string[]}[]} */
const FILES = [
  {
    name: 'tesseract.min.js',
    size: 600 * 1024,
    urls: [
      `${CDN_JS}/tesseract.js@${TESSERACT_VER}/dist/tesseract.min.js`,
      `${CDN_UNPKG}/tesseract.js@${TESSERACT_VER}/dist/tesseract.min.js`,
      `${CDN_NPMMIRROR}/tesseract.js@${TESSERACT_VER}/dist/tesseract.min.js`,
    ],
  },
  {
    name: 'worker.min.js',
    size: 100 * 1024,
    urls: [
      `${CDN_JS}/tesseract.js@${TESSERACT_VER}/dist/worker.min.js`,
      `${CDN_UNPKG}/tesseract.js@${TESSERACT_VER}/dist/worker.min.js`,
      `${CDN_NPMMIRROR}/tesseract.js@${TESSERACT_VER}/dist/worker.min.js`,
    ],
  },
  {
    name: 'tesseract-core-simd-lstm.wasm.js',
    size: 900 * 1024,
    urls: [
      `${CDN_JS}/tesseract.js-core@${CORE_VER}/tesseract-core-simd-lstm.wasm.js`,
      `${CDN_UNPKG}/tesseract.js-core@${CORE_VER}/tesseract-core-simd-lstm.wasm.js`,
    ],
  },
  {
    name: 'tesseract-core-lstm.wasm.js',
    size: 2 * 1024 * 1024,
    urls: [
      `${CDN_JS}/tesseract.js-core@${CORE_VER}/tesseract-core-lstm.wasm.js`,
      `${CDN_UNPKG}/tesseract.js-core@${CORE_VER}/tesseract-core-lstm.wasm.js`,
    ],
  },
  {
    name: 'chi_sim.traineddata.gz',
    size: 18 * 1024 * 1024,
    big: true,
    urls: [`${TESSDATA}/chi_sim.traineddata.gz`],
  },
  {
    name: 'eng.traineddata.gz',
    size: 9 * 1024 * 1024,
    big: true,
    urls: [`${TESSDATA}/eng.traineddata.gz`],
  },
];

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

/**
 * 下载单个文件并写入磁盘，返回 { size, sha256 }
 * @param {{name: string, urls: string[], big?: boolean}} file
 * @param {string} dest
 */
async function download(file, dest) {
  let lastError = null;

  for (const url of file.urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), file.big ? TIMEOUT_LANG_MS : TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const hash = createHash('sha256');
      let received = 0;
      let nextLog = 5 * 1024 * 1024;

      const source = Readable.fromWeb(res.body);
      source.on('data', (chunk) => {
        hash.update(chunk);
        received += chunk.length;
        if (file.big && received >= nextLog) {
          nextLog += 5 * 1024 * 1024;
          process.stdout.write(`      已下载 ${mb(received)}\n`);
        }
      });

      await pipeline(source, createWriteStream(dest));
      clearTimeout(timer);

      return { size: received, sha256: hash.digest('hex'), from: url };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      console.warn(`      失败（${url}）：${error.message}`);
    }
  }

  throw lastError || new Error('全部镜像均不可用');
}

async function existsWithSameSize(dest, minBytes) {
  try {
    const info = await stat(dest);
    return info.size >= minBytes;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`[ai] 目标目录：${OUT_DIR}`);
  console.log(`[ai] 模式：${FORCE ? '强制重新下载' : '缺什么下什么'}\n`);

  const integrity = {};

  for (const file of FILES) {
    const dest = join(OUT_DIR, file.name);
    const skip = !FORCE && (await existsWithSameSize(dest, file.size));

    if (skip) {
      const info = await stat(dest);
      const buf = await readFile(dest);
      integrity[file.name] = {
        size: info.size,
        sha256: createHash('sha256').update(buf).digest('hex'),
      };
      console.log(`[跳过] ${file.name}（已存在 ${mb(info.size)}）`);
      continue;
    }

    console.log(`[下载] ${file.name}`);
    const result = await download(file, dest);
    integrity[file.name] = { size: result.size, sha256: result.sha256 };
    console.log(`[完成] ${file.name}  ${mb(result.size)}  sha256=${result.sha256.slice(0, 16)}…\n`);
  }

  await writeFile(
    join(OUT_DIR, 'integrity.json'),
    JSON.stringify(integrity, null, 2) + '\n',
    'utf8'
  );
  console.log('[完成] 已写入 integrity.json');
  console.log(
    '[提示] 现在 <script src="./assets/ai/tesseract.min.js"> 会命中本地文件，OCR 完全离线可用。'
  );
}

main().catch((error) => {
  console.error(`[失败] ${error.message}`);
  console.error('[提示] 网络不可用时，前端会自动回退到 CDN（见 js/profile.js 的 OCR 配置）。');
  process.exit(1);
});
