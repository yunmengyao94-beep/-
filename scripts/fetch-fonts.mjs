/**
 * 下载开源中文字体到 frontend/fonts/，并生成 fonts.css
 * ---------------------------------------------------------------------------
 * 用法：
 *   node scripts/fetch-fonts.mjs            # 缺什么下什么
 *   node scripts/fetch-fonts.mjs --force    # 强制重新下载
 *
 * 字体（均为 SIL Open Font License 1.1）：
 *   Noto Sans SC Regular / Bold   思源黑体（简体子集）
 *   Noto Serif SC Regular         思源宋体（简体子集）
 *
 * 产出：
 *   frontend/fonts/*.otf
 *   frontend/fonts/fonts.css       @font-face + 工具类
 *   5 个页面 <head> 自动注入 fonts.css 的 <link>（幂等）
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(ROOT, 'frontend', 'fonts');
const FORCE = process.argv.includes('--force');

const CDN = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main';
const TIMEOUT_MS = 180000;

/** @type {{file: string, family: string, weight: number, label: string, url: string}[]} */
const FONTS = [
  {
    file: 'NotoSansSC-Regular.otf',
    family: 'YXX Noto Sans SC',
    weight: 400,
    label: '思源黑体 Regular',
    url: `${CDN}/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf`,
  },
  {
    file: 'NotoSansSC-Bold.otf',
    family: 'YXX Noto Sans SC',
    weight: 700,
    label: '思源黑体 Bold',
    url: `${CDN}/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf`,
  },
  {
    file: 'NotoSerifSC-Regular.otf',
    family: 'YXX Noto Serif SC',
    weight: 400,
    label: '思源宋体 Regular',
    url: `${CDN}/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf`,
  },
];

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

async function download(url, dest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const hash = createHash('sha256');
    let received = 0;
    const source = Readable.fromWeb(res.body);
    source.on('data', (chunk) => {
      hash.update(chunk);
      received += chunk.length;
    });

    await pipeline(source, createWriteStream(dest));
    return { size: received, sha256: hash.digest('hex') };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureFont(font) {
  const dest = join(FONT_DIR, font.file);

  if (!FORCE) {
    try {
      const info = await stat(dest);
      if (info.size > 1024 * 1024) {
        console.log(`[跳过] ${font.file}（已存在 ${mb(info.size)}）`);
        return;
      }
    } catch {
      // 不存在则继续下载
    }
  }

  console.log(`[下载] ${font.label} → ${font.file}`);
  const result = await download(font.url, dest);
  console.log(`[完成] ${font.file}  ${mb(result.size)}  sha256=${result.sha256.slice(0, 16)}…`);
}

/** 生成 @font-face 样式 */
function buildCss() {
  const faces = FONTS.map(
    (font) => `@font-face {
  font-family: '${font.family}';
  src: url('./${font.file}') format('opentype');
  font-weight: ${font.weight};
  font-style: normal;
  font-display: swap;
}`
  ).join('\n\n');

  return `/**
 * 开源中文字体（SIL OFL 1.1）—— 由 scripts/fetch-fonts.mjs 自动生成
 * ---------------------------------------------------------------------------
 * 默认不强制全局生效（系统字体栈在移动端渲染更快）。
 * 想让页面用上思源黑体，在任意 CSS 里加一行：
 *   body { font-family: 'YXX Noto Sans SC', var(--font-family-base); }
 */

${faces}

/* 工具类：局部使用 */
.u-font-sans {
  font-family:
    'YXX Noto Sans SC',
    var(--font-family-base, -apple-system, 'PingFang SC', sans-serif);
}

.u-font-serif {
  font-family:
    'YXX Noto Serif SC',
    var(--font-family-serif, 'Songti SC', serif);
}
`;
}

/** 把 fonts.css 注入 5 个页面的 <head>（幂等） */
async function injectLink() {
  const pages = ['index.html', 'item.html', 'publish.html', 'profile.html', 'components.html'];
  const tag = '<link rel="stylesheet" href="./fonts/fonts.css" />';

  for (const page of pages) {
    const file = join(ROOT, 'frontend', page);
    let html;
    try {
      html = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    if (html.includes('fonts/fonts.css')) {
      console.log(`[跳过] ${page} 已引入 fonts.css`);
      continue;
    }

    html = html.replace(
      /(<link rel="stylesheet" href="\.\/components\/feedback\.css" \/>)/,
      `$1\n    ${tag}`
    );
    await writeFile(file, html, 'utf8');
    console.log(`[注入] ${page} ← fonts.css`);
  }
}

async function writeReadme() {
  const rows = FONTS.map(
    (font) => `| \`${font.file}\` | ${font.label} | ${font.weight} | \`${font.family}\` |`
  ).join('\n');

  const readme = `# 开源中文字体

由 \`node scripts/fetch-fonts.mjs\` 自动下载，许可证均为 **SIL Open Font License 1.1**。

| 文件 | 字体 | 字重 | font-family |
|---|---|---|---|
${rows}

## 使用

\`fonts.css\` 已在页面 \`<head>\` 中引入，默认**不覆盖**系统字体栈。两种启用方式：

\`\`\`css
/* 全局启用思源黑体 */
body {
  font-family: 'YXX Noto Sans SC', var(--font-family-base);
}
\`\`\`

\`\`\`html
<!-- 局部启用 -->
<h1 class="u-font-serif">这是一个思源宋体的标题</h1>
\`\`\`

## 注意

- 每个字体约 7–10 MB，**不适合移动端首屏**；建议只做局部标题使用。
- 如需上线，请先做子集化（只保留用到的字）再压缩为 woff2，可缩小到几百 KB。
`;
  await writeFile(join(FONT_DIR, 'README.md'), readme, 'utf8');
}

async function main() {
  await mkdir(FONT_DIR, { recursive: true });
  console.log(`[fonts] 目标目录：${FONT_DIR}`);

  for (const font of FONTS) {
    await ensureFont(font);
  }

  await writeFile(join(FONT_DIR, 'fonts.css'), buildCss(), 'utf8');
  console.log('[完成] 已生成 fonts.css');

  await injectLink();
  await writeReadme();

  const files = await readdir(FONT_DIR);
  console.log(`[完成] fonts 目录现有 ${files.length} 个文件：${files.join('、')}`);
}

main().catch((error) => {
  console.error(`[失败] ${error.message}`);
  console.error(
    '[提示] 字体缺失不影响页面：页面使用系统字体栈，fonts.css 中的 @font-face 会自动跳过。'
  );
  process.exit(1);
});
