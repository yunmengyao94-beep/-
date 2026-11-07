# 更新日志（Changelog）

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中（Sprint 2）

- 前端页面骨架与设计令牌落地（首页、物品列表、订单详情）
- Mock 服务补齐 API-01 / 05 / 08 / 09 / 12，并接入 `mock_api.json`
- 健康检查与鉴权中间件的自动化测试（Vitest + supertest）

## [v0.0.1-infra] - 2026-11-07

**完成基础工程目录搭建、规范配置、数据库脚本与 Mock 服务。**

### 新增

- 工程目录：`frontend/`、`server/`、`assets/`、`docs/`、`sql/`、`scripts/`、`config/`
- 前端静态资源骨架：`frontend/css/`（设计令牌与 Reset）、`frontend/assets/{fonts,icons,ai}/`
- 端侧 AI 资源说明与接入约定：[frontend/assets/ai/README.md](../frontend/assets/ai/README.md)
- 数据库脚本：[sql/init_db.sql](../sql/init_db.sql)（MySQL 8.0，4 表 / 6 外键 / 4 唯一键 / 23 CHECK）
- Mock 服务：[server/app.js](../server/app.js)（Express 5 + JWT，健康检查、模拟登录、鉴权中间件）
- 接口样例数据：[mock_api.json](../mock_api.json)（API-04 / 05 / 12，遵循计划书 7.2 统一响应结构）
- 业务规则配置：[config/credit_rules.json](../config/credit_rules.json)、[config/damage_rules_wig.json](../config/damage_rules_wig.json)
- 团队文档：[docs/team_roles.md](team_roles.md)

### 工程规范

- ESLint 8 + Prettier 3，统一单引号 / 分号 / 2 空格缩进
- 自定义规则 `no-absolute-position`：禁止用绝对定位做布局（JS 由 ESLint 拦截，CSS/HTML 由 `scripts/check-no-absolute.js` 拦截）
- Husky 9 + lint-staged 17：提交前仅校验暂存文件
- 构建脚本占位符：`scripts/build_h5.sh`、`scripts/build_apk.sh`、`scripts/build_exe.sh`

### 已知限制

- `npm` 未预装于当前开发环境，依赖安装与脚本执行以 pnpm 11 完成；仓库已同时兼容 npm（声明 `workspaces`）
- 因 Windows 下 pnpm 默认 isolated 布局会导致 express 内部依赖解析失败，`pnpm-workspace.yaml` 显式指定 `nodeLinker: hoisted`
- `config/credit_rules.json` 中 `DAMAGE_MODERATE(-30)` 由 5.4.4 定损表派生，待产品确认后固化
- 中值/低值物品的划分口径、L5 曝光加权系数在文档中留白，暂以 `null` + 待确认标注

### 版本说明

- `v0.0.1`：功能未交付，仅基础设施；`-infra` 后缀表示非生产可用
