# PWA 测试手册（庆师易校圈）

> 适用版本：Sprint 8 完成后的 `frontend/`（Service Worker `yxx-v1`）
> 测试环境：Chrome / Edge（Chromium 内核），页面通过 `http://localhost:3000` 访问

---

## 0. 前置条件

| 条件     | 说明                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| 访问地址 | 必须是 `http://localhost:3000` 或 `https://`；`http://192.168.x.x` 这类非安全源 **不会注册 SW** |
| 浏览器   | Chrome / Edge（推荐最新版）；Safari 对 SW 与安装的支持较保守                                    |
| 服务     | 根目录执行 `node server/app.js`，或用 `pnpm start`                                              |

验证 SW 是否注册成功：

1. 打开 DevTools → **Application** → **Service Workers**
2. 状态应为 `activated and is running`
3. 若显示 `waiting to activate`，点 **Skip waiting** 或刷新页面

---

## 1. Application 面板：查看与清理缓存

### 1.1 看 Manifest

**Application → Manifest**

- Name：`庆师易校圈`；Short name：`庆师易校圈`
- Start URL：`./index.html`；Display：`standalone`
- Theme color：`#1890ff`；Background：`#f5f7fa`
- Icons：应列出 4 个（192/512 普通 + 192/512 maskable）
- 如果图标显示不出来，点 **Application → Manifest → 图标链接**确认返回 200（`/assets/icons/logo-192.png`）

> 提示：Manifest 修改后需要**刷新页面**才会重新解析。

### 1.2 看 Cache Storage 内容

**Application → Cache Storage → `yxx-v1`**

展开后应能看到约 27 条记录，分三类：

| 类别       | 示例                                                                              |
| ---------- | --------------------------------------------------------------------------------- |
| 页面       | `/index.html`、`/item.html`、`/publish.html`、`/profile.html`、`/components.html` |
| 样式与脚本 | `/components/base.css`、`/js/index.js`、`/utils/request.js`、`/js/app.js`         |
| 图标与清单 | `/manifest.json`、`/assets/icons/logo-192.png`…                                   |

点任意一条，右侧 **Preview** 可看响应内容，**Headers** 可看状态码与类型。

验证缓存真的生效：

1. 断网（见第 2 节）
2. 访问 `http://localhost:3000/index.html`
3. 页面能打开 = 外壳命中缓存

### 1.3 清空缓存（三种粒度）

| 目的              | 操作                                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| 只清缓存，保留 SW | Application → **Storage** → 勾选 _Cache Storage_ → **Clear site data**            |
| 连 SW 一起重置    | Application → **Storage** → 勾选全部（含 _Service workers_）→ **Clear site data** |
| 只卸载 SW         | Application → **Service Workers** → 右上角 **Unregister**                         |

**开发期间最常用**：Application → Service Workers → 勾选 **Update on reload** + **Bypass for network**。
这样每次刷新都会重新拉最新代码，不会被 Cache First 的旧资源卡住。

---

## 2. 离线测试

1. DevTools → **Network** → 把 **Throttling** 改为 `Offline`
2. 刷新页面（或点 **Application → Service Workers → Offline** 勾选框）
3. 预期表现：
   - 顶部出现橙色横幅「当前为离线模式，部分功能不可用」
   - 已缓存的页面仍能打开（Cache First）
   - 列表接口失败时，页面用 `localStorage` 里的最近一次数据渲染（不发请求、不弹错误框）
   - 图片加载失败的位置显示灰色占位图（「图片暂不可用」）
4. 取消离线 → 顶部变绿色「网络已连接」，2 秒后自动消失

> 接口的离线兜底：SW 返回 `{ code: 50301, msg: "当前为离线模式，展示本地数据" }`，
> `utils/request.js` 捕获后**静默**回退本地缓存，不打断用户。

---

## 3. 安装为桌面 App

### Chrome / Edge（桌面）

1. 用 `http://localhost:3000/index.html` 打开应用
2. 地址栏右侧出现 **安装图标**（显示器 + 下箭头），点击 → **安装**
   - 也可用菜单：⋮ → **保存并分享 / 应用** → **将此站点作为应用安装**
3. 安装完成后会以**独立窗口**打开（无地址栏），开始菜单/桌面会有「庆师易校圈」图标
4. 右键任务栏图标可 **固定**；也可在 `chrome://apps` 中管理

**验收点**：

- [ ] 独立窗口打开，不显示浏览器地址栏
- [ ] 任务栏/程序坞图标为蓝色渐变书本图标（非默认网页图标）
- [ ] 断网后从桌面启动，仍能打开缓存页面
- [ ] 窗口标题为「庆师易校圈 · 附近物品」（`start_url` 指向的页面）

### 卸载

- Chrome：`chrome://apps` → 右键「庆师易校圈」→ **从 Chrome 中移除**
- Edge：`edge://apps` → 右键 → **卸载**

### 移动端

- Android Chrome：菜单 → **添加到主屏幕** → 会使用 maskable 图标
- iOS Safari：分享 → **添加到主屏幕**（受系统限制，无独立安装包体验）

---

## 4. Lighthouse 与 PWA 评分

### 4.1 怎么跑

1. DevTools → **Lighthouse** 面板
2. 勾选 **Progressive Web App**（若你的版本没有该项，见下方说明）
3. Device 选 **Mobile**，点 **Analyze page load**

> **注意**：Lighthouse **12 起已移除独立的 PWA 分类**（原 "Progressive Web App" 审计项被拆分/下线）。
> 如果你的 Lighthouse 版本较新，看不到 PWA 分类属于正常现象，请改用
> **Application 面板手工核对**（第 1 节）或使用 [PWA Builder](https://www.pwabuilder.com/) 的在线检测。

### 4.2 本项目自评（对照可安装性检查项）

| 检查项                                        | 状态 | 说明                                              |
| --------------------------------------------- | ---- | ------------------------------------------------- |
| 由安全源提供（localhost/HTTPS）               | ✅   | localhost 视为安全上下文                          |
| 有 manifest 且可访问                          | ✅   | `/manifest.json` 返回 200，`application/json`     |
| `name` / `short_name`                         | ✅   | 均为「庆师易校圈」                                |
| `start_url` / `scope`                         | ✅   | `./index.html` / `./`                             |
| `display` 为 standalone                       | ✅   | `standalone` + `display_override`                 |
| 192×192 与 512×512 图标                       | ✅   | `logo-192.png` / `logo-512.png`，实测尺寸校验通过 |
| maskable 图标                                 | ✅   | `logo-maskable-192/512.png`，内容缩进 80% 安全区  |
| `theme_color` / `background_color`            | ✅   | `#1890ff` / `#f5f7fa`                             |
| `theme-color` meta 与 manifest 一致           | ✅   | 5 个页面统一 `#1890ff`                            |
| 注册 Service Worker                           | ✅   | `js/app.js` 在 `window.load` 后注册               |
| SW 有 fetch 处理器                            | ✅   | Cache First / Network First / 导航兜底            |
| 离线时能打开                                  | ✅   | 外壳 27 项预缓存                                  |
| `apple-touch-icon` / `apple-mobile-web-app-*` | ✅   | 5 个页面已补                                      |

> 结论：以上检查项全部满足，理论上可安装、可离线。但**本仓库的构建/测试环境没有 Chrome 与 Lighthouse，
> 也没有外网**，因此没有实测 Lighthouse 分数——上面是逐项核对的结果，不是跑分。

### 4.3 想要满分还要做什么

1. **HTTPS**：生产环境必须部署 HTTPS（Lighthouse 的 best-practices 会扣分）
2. **HTTP/2 + 压缩**：静态资源开 gzip/br，减少首屏传输
3. **预缓存体积控制**：`components.html`（UI Kit 文档页）其实可以不进 shell，减少安装流量
4. **图片优化**：使用 `srcset` + WebP/AVIF，列表图加 `loading="lazy"`（已加）+ 显式宽高防 CLS
5. **首屏性能**：把关键 CSS 内联，其余异步加载；字体用系统栈（本项目已是）
6. **可访问性**：所有图标按钮补 `aria-label`，颜色对比度 ≥ 4.5:1
7. **SW 更新策略**：发版时同步升级 `CACHE_NAME`（`yxx-v1` → `yxx-v2`），并提示用户刷新
8. **Manifest 富化**：加 `shortcuts`（如「发布物品」「我的信用」）与 `screenshots`，安装体验更好

---

## 5. 常见问题

| 现象                 | 原因                                        | 处理                                                             |
| -------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| 改了 CSS 但页面没变  | Cache First 命中旧缓存                      | SW 面板勾 **Update on reload**，或升级 `CACHE_NAME`              |
| SW 一直是 waiting    | 旧页面还占着                                | 关闭其它标签页，或点 **Skip waiting**                            |
| 安装按钮不出现       | 非 localhost/HTTPS、manifest 报错、图标缺失 | 看 Application → Manifest 是否有红色报错                         |
| 断网仍白屏           | 外壳未缓存成功（安装时某个资源 404）        | 联网刷新一次让 install 完成，再看 Cache Storage                  |
| 图标是默认浏览器图标 | 图标 404 或尺寸不符                         | 检查 `/assets/icons/logo-192.png` 是否 200，PNG 尺寸是否 192×192 |
| 离线点头像/借用报错  | 写操作不缓存（正确行为）                    | 离线只读，恢复网络后再操作                                       |
