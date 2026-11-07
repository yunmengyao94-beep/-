# 端侧 AI 与字体资源说明

本项目的 OCR（芝麻信用截图识别）**完全在浏览器本地运行**，不上传任何图片。
所需资源已由脚本下载到 `frontend/assets/ai/`，字体在 `frontend/fonts/`。

---

## 1. 已下载的 AI 资源

`node scripts/fetch-ai-assets.mjs` 产出（`--force` 可强制重下）：

| 文件                               | 体积     | 作用                                        |
| ---------------------------------- | -------- | ------------------------------------------- |
| `tesseract.min.js`                 | 65 KB    | Tesseract.js 主库（页面用 `<script>` 引入） |
| `worker.min.js`                    | 121 KB   | Worker 脚本（识别在独立线程跑，不卡 UI）    |
| `tesseract-core-simd-lstm.wasm.js` | 3.76 MB  | WASM 内核（SIMD 加速版，现代浏览器优先）    |
| `tesseract-core-lstm.wasm.js`      | 3.76 MB  | WASM 内核（非 SIMD 兜底）                   |
| `chi_sim.traineddata.gz`           | 19.23 MB | 简体中文语言包                              |
| `eng.traineddata.gz`               | 10.42 MB | 英文/数字语言包（芝麻分数字识别需要）       |
| `integrity.json`                   | —        | 每个文件的 `size` + `sha256`，可用于校验    |

合计约 **37 MB**。校验方式：

```bash
node -e "const {createHash}=require('crypto');const fs=require('fs');..."
# 或直接用 integrity.json 比对（fetch-ai-assets.mjs 已内置）
```

### 路径映射（与 worker 内部拼接逻辑一致）

```
corePath  → ./assets/ai/tesseract-core-{simd-}lstm.wasm.js
workerPath→ ./assets/ai/worker.min.js
langPath  → ./assets/ai/{chi_sim,eng}.traineddata.gz   （gzip 默认开启）
```

这四条是直接读 `worker.min.js` 里的拼接代码确认的，不是猜的：

```js
h = corePath + (simd ? '-simd' : '') + (lstm ? '-lstm' : '') + '.wasm.js';
_ = langPath + '/' + lang + '.traineddata' + (gzip ? '.gz' : '');
```

---

## 2. 网络不通时的 CDN 兜底

`frontend/js/profile.js` 里的 `initOCR()` 采用**本地优先 + CDN 回退**：

```js
try {
  ocrWorker = await create({
    workerPath: './assets/ai/worker.min.js',
    langPath: './assets/ai',
    corePath: './assets/ai',
  });
} catch {
  ocrWorker = await create({}); // 不传路径 = 用 tesseract.js 默认 CDN
}
```

再加上 `ensureTesseract()` 会在 `window.Tesseract` 缺失时动态补 `<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js">`。

**结论：只要浏览器能上网，即使 `assets/ai/` 里一个文件都没有，点「上传截图认证」也不会报错**——
只会慢一点（要下语言包），并在识别失败时走正常的错误 Toast。

完全离线（无外网）时，必须保证上表 6 个文件都在本地。

---

## 3. 字体

`node scripts/fetch-fonts.mjs` 下载（SIL OFL 1.1，可商用）：

| 文件                      | 字体             | 体积     |
| ------------------------- | ---------------- | -------- |
| `NotoSansSC-Regular.otf`  | 思源黑体 Regular | 7.95 MB  |
| `NotoSansSC-Bold.otf`     | 思源黑体 Bold    | 8.15 MB  |
| `NotoSerifSC-Regular.otf` | 思源宋体 Regular | 11.09 MB |

脚本同时生成 `frontend/fonts/fonts.css`（`@font-face` + `font-display: swap`）并自动注入 5 个页面的 `<head>`。

**默认不覆盖系统字体栈**（8–11 MB 的 CJK 字体直接上首屏会拖慢移动端）。想启用：

```css
body {
  font-family: 'YXX Noto Sans SC', var(--font-family-base);
}
```

或局部：

```html
<h1 class="u-font-serif">思源宋体标题</h1>
```

> 上线前建议做子集化 + 转 woff2，通常能从 8 MB 压到 300 KB 以内。

---

## 4. 相关命令

```bash
npm run fetch:ai       # 只下 AI 资源
npm run fetch:fonts    # 只下字体
npm run fetch:assets   # 两者都下
```

脚本特性：

- 已存在且大小合理则跳过（`--force` 强制重下）
- 多镜像回退（jsDelivr → unpkg → npmmirror；语言包走 tessdata CDN）
- 下载后写 `integrity.json`，可作为缓存指纹

---

## 5. 常见问题

| 现象                                                         | 原因                              | 处理                               |
| ------------------------------------------------------------ | --------------------------------- | ---------------------------------- |
| 点击认证后长时间「AI 引擎初始化中」                          | 语言包 19 MB 首次下载慢           | 正常现象，可看 Network 面板进度    |
| 报「识别失败：Network error while fetching …traineddata.gz」 | `assets/ai/` 缺语言包且无法连 CDN | 跑 `npm run fetch:ai` 或检查外网   |
| 识别结果乱码                                                 | 语言包未加载成功（只跑了 eng）    | 确认 `chi_sim.traineddata.gz` 存在 |
| 字体没生效                                                   | `fonts.css` 未设置 `font-family`  | 见第 3 节，需显式指定 family       |
| 控制台 404 `tesseract.min.js`                                | 未执行下载脚本                    | `npm run fetch:ai`                 |

> 注：`.wasm.js` 内核文件与字体文件已在 `.gitignore` 中忽略，仓库只保留脚本与 `README`，
> 新环境克隆后执行一次 `npm run fetch:assets` 即可。
