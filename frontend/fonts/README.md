# 开源中文字体

由 `node scripts/fetch-fonts.mjs` 自动下载，许可证均为 **SIL Open Font License 1.1**。

| 文件                      | 字体             | 字重 | font-family         |
| ------------------------- | ---------------- | ---- | ------------------- |
| `NotoSansSC-Regular.otf`  | 思源黑体 Regular | 400  | `YXX Noto Sans SC`  |
| `NotoSansSC-Bold.otf`     | 思源黑体 Bold    | 700  | `YXX Noto Sans SC`  |
| `NotoSerifSC-Regular.otf` | 思源宋体 Regular | 400  | `YXX Noto Serif SC` |

## 使用

`fonts.css` 已在页面 `<head>` 中引入，默认**不覆盖**系统字体栈。两种启用方式：

```css
/* 全局启用思源黑体 */
body {
  font-family: 'YXX Noto Sans SC', var(--font-family-base);
}
```

```html
<!-- 局部启用 -->
<h1 class="u-font-serif">这是一个思源宋体的标题</h1>
```

## 注意

- 每个字体约 7–10 MB，**不适合移动端首屏**；建议只做局部标题使用。
- 如需上线，请先做子集化（只保留用到的字）再压缩为 woff2，可缩小到几百 KB。
