# 端侧 AI 资源目录（信用证明 OCR）

本目录用于存放 **Tesseract.js 及其中文语言包**，供「信用证明本地 OCR」使用（计划书 5.3.1）。
OCR **完全在浏览器沙箱内离线执行**，原始图片**不得上传服务器**，仅允许把识别出的分数值与时间戳上送。

## 需要放入的文件

| 文件名                | 说明                                                            | 获取方式                                                                                |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tesseract.min.js`    | Tesseract.js 主库（含 worker 引导）                             | `npm i tesseract.js` 后从 `node_modules/tesseract.js/dist/` 复制；或从 CDN 下载同名文件 |
| `worker.min.js`       | Tesseract worker 脚本（部分版本随主库分发）                     | 同上，`dist/worker.min.js`                                                              |
| `chi_sim.traineddata` | 简体中文识别语言包（约 40MB，**勿提交到 Git**）                 | https://github.com/naptha/tessdata/tree/gh-pages/4.0.0_best                             |
| `eng.traineddata`     | 英文语言包（可选，识别 "信用分 Credit" 等混排文本时提高准确率） | 同上                                                                                    |

> `chi_sim.traineddata.gz` 亦可（Tesseract.js 自动解压），体积更小但首次加载稍慢。

## 放置后的目录结构

```
frontend/assets/ai/
├── tesseract.min.js
├── worker.min.js
├── chi_sim.traineddata
├── eng.traineddata        (可选)
└── README.md              (本文件)
```

## 接入约定

1. **语言包路径固定**：初始化时显式指定本地路径，禁止回落到 CDN（离线可用 + 合规）：

   ```js
   const worker = await Tesseract.createWorker('chi_sim', 1, {
     workerPath: './assets/ai/worker.min.js',
     langPath: './assets/ai',
     corePath: './assets/ai',
     cacheMethod: 'none', // 避免向 IndexedDB 写缓存残留
   });
   ```

2. **只提取分数值**：识别结果须先用正则收敛（如 `/信用分[:：\s]*(\d{2,3})/`），
   `confidence` 低于阈值直接判为失败，交人工审核，不得把原始文本上传。
3. **仅作加分项**：OCR 得到的分数按 5.3.1 约束**权重上限 10%**，不作为信用等级的唯一判据。
4. **须明示授权**：调用前弹出用途说明并取得同意（《个人信息保护法》最小必要原则）。

## 体积与版本管理

- 语言包与库文件总体积约 45MB，已在 `.gitignore` 中忽略 `*.traineddata`；
  请勿提交二进制，改用内网对象存储分发或构建时下载。
- 首次使用时若文件缺失，页面须给出「AI 资源未就绪」的降级提示，而不是静默失败。
