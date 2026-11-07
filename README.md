# 易校圈（Project-YXX）

> 校园信用互助与资源共享平台 —— 以「虚拟信用分 + 履约留痕 + 强制仲裁」替代现金押金的校内借用网络。

当前阶段：**Sprint 1 基建**（工程骨架、代码规范、提交门禁）。

## 技术栈

| 层   | 选型                                             | 说明                                             |
| ---- | ------------------------------------------------ | ------------------------------------------------ |
| 前端 | **纯原生 HTML / CSS / JavaScript（ES Modules）** | 不引入框架，零构建，浏览器直接运行               |
| 后端 | **Node.js 演示 Server**                          | 仅用于联调，返回 `api_samples.json` 中的固定数据 |
| 数据 | MySQL 8.0 脚本 + JSON 规则配置                   | `sql/init_db.sql`、`config/*.json`               |
| 规范 | ESLint + Prettier + Husky + lint-staged          | 提交前自动校验                                   |

## 目录结构

```
.
├── frontend/               # 前端页面与静态资源（原生 HTML/CSS/JS）
├── server/                 # Node.js 本地后端（Express + JWT）
├── assets/                 # 图片、图标、字体等静态资源
├── docs/                   # 项目文档（团队分工、接口约定等）
├── sql/                    # 数据库脚本（init_db.sql）
├── scripts/                # 构建与校验脚本
├── config/                 # 业务规则配置（信用分、定损表）
├── eslint-rules/           # 自定义 ESLint 规则（no-absolute-position）
├── api_samples.json           # 接口 演示数据（API-04 / 05 / 12）
├── .eslintrc.json          # ESLint 配置
├── .prettierrc             # Prettier 配置
└── .husky/pre-commit       # 提交前钩子 → lint-staged
```

## 本地启动步骤

```bash
# 1. 安装依赖（二选一，Node.js >= 18）
npm install
# 或
pnpm install

# 2. 启动 本地后端（默认 http://localhost:3000）
npm run server        # 等价于 node server/app.js

# 3. 冒烟自检
curl http://localhost:3000/api/v1/health
curl -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d "{\"student_no\":\"2599080110120\"}"

# 4. 浏览器打开前端页面
#    直接双击 frontend/index.html，或用任意静态服务器（如 npx serve frontend）

# 5. 代码规范
npm run lint          # ESLint 全量检查（含自定义规则 no-absolute-position）
npm run check:no-absolute   # 扫描 .css/.html 中的 position: absolute
npm run format        # Prettier 格式化
```

> 提交时 Husky 会自动执行 `lint-staged`：只校验**暂存区**的 JS/CSS/HTML/JSON/MD，
> 样式类文件额外跑一遍 `position: absolute` 扫描。CI 可直接复用 `npm run lint`。

## 代码约定

1. **禁止用 `position: absolute` 做布局。** 自定义规则 `no-absolute-position` 对 JS 报错；
   `.css` / `.html` 由 `scripts/check-no-absolute.js` 拦截（ESLint 无法解析样式文件）。
   布局请使用 flex / grid / 正常文档流；必须脱离文档流时优先 `position: sticky`，
   仅悬浮层（弹窗、Toast）可用 `fixed`。
2. 统一单引号、语句末尾分号、2 空格缩进（见 `.prettierrc`）。
3. 接口返回严格遵循计划书 7.2 的统一响应结构：`code / msg / data / trace_id / server_time`。

## 文档

- [团队分工模板](docs/team_roles.md)
- [接口集合 Postman v2.1](docs/api_postman.json)
- [数据字典 · 前端枚举](docs/data_dictionary.md)
- [更新日志](docs/changelog.md)
- [数据库初始化脚本](sql/init_db.sql)
- [接口 演示数据](api_samples.json)
- [信用规则配置](config/credit_rules.json)

## 备注

- `.eslintrc.json` 属 ESLint 8 的配置格式，故 `eslint` 固定为 `8.57.1`；
  迁移到 ESLint 9 的 flat config 时需同步改写配置与 `--rulesdir` 用法。
- 本仓库同时兼容 npm 与 pnpm：`package.json` 为标准格式，锁文件按所用包管理器生成。

## 演示账号

服务端 `server/seed_db.json` 内置 3 个账号（密码均为 `123456`，仅用于本地演示）：

| 学号          | 姓名   | 学院 | 楼栋    |
| ------------- | ------ | ---- | ------- |
| 2508080110101 | 张同学 | 0801 | 第7公寓 |
| 2508080110102 | 李同学 | 0801 | 第5公寓 |
| 2408080110103 | 王同学 | 0802 | 第3公寓 |

密码在服务端以 **scrypt** 哈希保存，前端不留任何明文；注册的新账号同样写入 `accounts` 表。
