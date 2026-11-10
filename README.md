# 庆师易校圈（Project-YXX）

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

## 试点白名单账号（首批 5 人）

服务端 `server/seed_db.json` 只内置本次试点的 5 位真实用户，**密码为空 = 未激活**。
他们需要先到注册页用「学号 + 姓名」完成身份核验并设置密码，之后才能登录。

| 学号          | 姓名   | 学院                     | 初始信用分 |
| ------------- | ------ | ------------------------ | ---------- |
| 2504010110209 | 陈宇   | 计算机科学与信息技术学院 | 100        |
| 2504010110205 | 班慧灵 | 计算机科学与信息技术学院 | 100        |
| 2504010110227 | 刘婧   | 计算机科学与信息技术学院 | 100        |
| 2599011710127 | 周艳荣 | 计算机科学与信息技术学院 | 100        |
| 2599080110120 | 陈家康 | 计算机科学与信息技术学院 | 100        |

### 超级测试账号（内部演示用）

| 学号            | 密码     | 姓名     | 公寓 / 房间   | 信用分 |
| --------------- | -------- | -------- | ------------- | ------ |
| `1234567890123` | `123456` | 测试账号 | 第1公寓 / 101 | 100    |

该账号**已预激活**，可在登录页直接秒进，拥有发布、借用、归还、通知等全部权限。
上线前请删除该账号（`server/seed_db.json` 的 users / accounts 两条记录）。

注册规则：

- 学号必须在这份名单里，且**姓名完全一致**，否则返回 `403 身份核验失败，您不在本次试点名单内`
- 已激活的账号重复注册会返回 `409 该账号已激活，请直接登录`
- 未激活的账号直接登录会返回 `403 账号尚未激活，请先前往注册页完成身份核验与密码设置`

## 数据库（MongoDB）

后端已从本地 JSON 文件迁移到 MongoDB Atlas（Mongoose）。

### 1. 配置连接串

复制 `.env.example` 为 `.env`，填写真实连接串（`.env` 已被 `.gitignore` 忽略，不会进仓库）：

```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/
MONGODB_DB=yxx
PORT=3000
JWT_SECRET=change-me
```

> 连接串只通过 `process.env.MONGODB_URI` 读取，源码中没有任何硬编码的账号密码。

### 2. 启动

```bash
node server/app.js
```

启动时会自动连接数据库、首次运行写入种子数据（6 个账号），并监听 `http://localhost:3000`。

### 3. 集合结构

| 集合 | 说明 |
|---|---|
| `users` | 用户档案与信用分 |
| `accounts` | 登录账号（密码仅存 scrypt 哈希） |
| `items` | 物品 |
| `orders` | 订单 |
| `credit_logs` | 信用流水 |
| `notifications` | 通知 |
| `counters` | 物品 / 订单自增计数器 |

不再使用 `server/db.json`，也不再有单实例锁与本地备份文件。
