# -*- coding: utf-8 -*-
"""生成《系统设计与架构说明书》（SDD）。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import (  # noqa: E402
    cover,
    figure,
    h1,
    h2,
    h3,
    new_document,
    note,
    p,
    bullets,
    save,
    table,
    toc,
)

DOC_TITLE = "庆师易校圈 · 系统设计与架构说明书"

doc = new_document(DOC_TITLE)

cover(
    doc,
    "系统设计与架构说明书",
    "SDD · System Design Description",
    [
        ("项目名称", "庆师易校圈（Project-YXX）"),
        ("文档版本", "V1.0.0"),
        ("编写单位", "庆师易校圈项目组"),
        ("编写人员", "陈宇、班慧灵、刘婧、周艳荣、陈家康"),
        ("对应需求", "SRS V1.0.0（FR-01 ~ FR-20）"),
        ("编制日期", "2026 年 11 月 8 日"),
    ],
)

toc(doc)

# ------------------------------------------------------------------ 1
h1(doc, "1  概述")

h2(doc, "1.1  设计目标")
p(doc, "本文档说明庆师易校圈如何被实现：采用什么架构、模块如何划分、数据如何组织、关键算法如何落地，"
       "以及为什么做出这些技术选择。设计的总体目标是：")
bullets(
    doc,
    [
        "用尽量少的基础设施，做出可演示、可答辩、可维护的完整闭环；",
        "把关键能力（图片压缩、OCR、敏感词）放到端侧或轻量服务端，降低部署门槛；",
        "为后续演进（SQLite、管理后台、真实即时通讯）保留清晰的替换边界。",
    ],
)

h2(doc, "1.2  技术选型")
table(
    doc,
    ["层次", "技术 / 库", "版本", "选择理由"],
    [
        ("前端", "原生 HTML5 + CSS3 + ES Module", "—", "零构建、可直接部署；课程答辩便于讲清原理"),
        ("前端", "CSS 自定义属性 + BEM 命名", "—", "主题与字号可运行时切换，类名可维护"),
        ("前端", "Service Worker + Web App Manifest", "—", "PWA 可安装、可离线，接近原生体验"),
        ("前端", "Tesseract.js（WASM）", "5.x", "端侧 OCR，截图不出设备，隐私友好"),
        ("服务端", "Node.js", "24.x", "与前端同语言，生态成熟"),
        ("服务端", "Express", "5.x", "轻量路由与中间件模型，易于分层"),
        ("服务端", "jsonwebtoken", "9.x", "标准 JWT 签发与校验"),
        ("服务端", "pinyin", "4.x", "敏感词拼音匹配，防谐音绕过"),
        ("存储", "JSON 文件（db.json）", "—", "零依赖、易查看，适合试点规模"),
        ("测试", "Node + 自研 DOM 桩", "—", "无需浏览器即可跑接口与组件逻辑"),
        ("部署", "Cloudflare Tunnel", "—", "无公网 IP 也能提供 HTTPS 访问"),
    ],
    widths=[2.0, 5.2, 1.8, 7.2],
    caption="表 1-1  技术选型",
    font_size=8.5,
)

h2(doc, "1.3  设计原则")
bullets(
    doc,
    [
        "前后端分离：前端只消费 JSON 接口，静态资源与 API 同源部署，避免跨域。",
        "服务端权威：信用分、订单状态、权限判断全部在服务端完成，前端只负责展示与提示。",
        "最小依赖：除 Express/JWT/pinyin 外不引入框架，降低学习与部署成本。",
        "渐进增强：PWA、View Transitions、MediaRecorder 等能力按浏览器支持情况降级。",
    ],
)

# ------------------------------------------------------------------ 2
h1(doc, "2  总体架构")

p(doc, "系统采用前后端分离的四层结构：客户端层、接入层、业务服务层、数据与安全层。客户端负责渲染与端侧计算，"
       "服务端负责业务规则与持久化。")
figure(doc, "architecture.png", "图 2-1  系统总体架构", width_cm=16.2)

h2(doc, "2.1  客户端层")
bullets(
    doc,
    [
        "页面层：10 个 HTML 页面（首页、详情、发布、订单、消息、我的、设置、帮助、登录、注册）。",
        "组件与工具层：shell（PC 侧边栏/顶栏）、feedback（Toast/Modal）、device（端识别）、"
        "chat（本地聊天）、breakpoint（断点过渡）、transitions（页面转场）。",
        "Service Worker：缓存应用外壳（yxx-v4），提供离线访问与版本更新提示。",
        "端侧 AI：Tesseract.js 在浏览器内识别芝麻信用截图，原始图片不上传。",
    ],
)

h2(doc, "2.2  接入层")
bullets(
    doc,
    [
        "Cloudflare Tunnel：把本机 3000 端口映射为公网 HTTPS 地址，免公网 IP 与证书配置。",
        "Express 5：统一 JSON 解析、CORS、请求日志（morgan）。",
        "鉴权网关：白名单放行公开路由，其余校验 Bearer Token，并检查 Token 黑名单。",
        "限流与单实例锁：内存固定窗口限流；启动时写 .yxx.lock 防多开覆盖数据。",
    ],
)

h2(doc, "2.3  业务服务层")
table(
    doc,
    ["模块", "文件", "职责"],
    [
        ("认证", "server/routes/auth.js", "登录、白名单注册、刷新、注销；签发与拉黑 JWT"),
        ("用户", "server/routes/users.js", "个人资料、我的发布、信用概览与流水、OCR 奖励"),
        ("物品", "server/routes/items.js", "列表/详情/缩略图/发布/删除与内容安全校验"),
        ("订单", "server/routes/orders.js", "下单、状态流转、通知触发、逾期前置检查"),
        ("通知", "server/routes/notifications.js", "列表、单条已读、全部已读"),
        ("存储", "server/store.js", "内存数据仓、原子写、备份恢复、信用与订单工具函数"),
        ("中间件", "server/middlewares/*.js", "鉴权、限流"),
        ("服务", "server/services/token-blacklist.js", "Token 黑名单与过期清理"),
    ],
    widths=[2.4, 6.4, 8.2],
    caption="表 2-1  服务端模块划分",
    font_size=9,
)

h2(doc, "2.4  数据与安全层")
bullets(
    doc,
    [
        "JSON 文件数据库：db.json 保存 6 张逻辑表，启动时加载进内存，写操作后整体落盘。",
        "原子写：唯一临时文件 + fsync + rename，避免半截文件。",
        "备份：启动时与每日 03:00 复制为 db.backup.json；主文件损坏时自动恢复并告警。",
        "密码安全：scrypt（16 字节盐、64 字节哈希）+ 恒定时间比较。",
    ],
)

# ------------------------------------------------------------------ 3
h1(doc, "3  功能模块划分")

h2(doc, "3.1  前端目录结构")
table(
    doc,
    ["目录 / 文件", "说明"],
    [
        ("frontend/*.html", "页面：index、item、publish、orders、notifications、profile、settings、help、login、register"),
        ("frontend/css/", "设计令牌（variables）、重置（reset）、布局工具类（layout）"),
        ("frontend/components/", "基础组件（base.css）、反馈组件（feedback）、壳层（shell）、动效（motion）"),
        ("frontend/js/", "页面逻辑：index / item / publish / orders / notifications / profile / settings / login / register / chat / app"),
        ("frontend/utils/", "request（请求封装）、auth、device、breakpoint、transitions、preferences、"
                            "item-images、item-image、rate-limit、publish-guard、fingerprint、chat 等"),
        ("frontend/sw.js", "Service Worker：缓存策略与版本管理"),
        ("frontend/assets/", "图标、AI 模型（tesseract）与字体"),
    ],
    widths=[5.0, 12.0],
    caption="表 3-1  前端目录结构",
    font_size=9,
)

h2(doc, "3.2  服务端 API 清单")
table(
    doc,
    ["方法", "路径", "鉴权", "说明"],
    [
        ("GET", "/api/v1/health", "否", "健康检查"),
        ("POST", "/api/v1/auth/login", "否", "学号 + 密码登录，签发 JWT"),
        ("POST", "/api/v1/auth/register", "否", "白名单核验注册并激活账号"),
        ("POST", "/api/v1/auth/refresh", "是", "用旧 Token 换新 Token（旧 Token 拉黑）"),
        ("POST", "/api/v1/auth/logout", "是", "注销并把当前 Token 加入黑名单"),
        ("GET", "/api/v1/users/me", "是", "个人资料、信用概览、信用流水"),
        ("PATCH", "/api/v1/users/me", "是", "修改学院代码、公寓、房间号"),
        ("GET", "/api/v1/users/me/items", "是", "我的发布列表"),
        ("POST", "/api/v1/users/credit/challenge", "是", "获取一次性认证挑战"),
        ("POST", "/api/v1/users/credit/bonus", "是", "提交 OCR 认证奖励（需挑战 + 图片指纹）"),
        ("GET", "/api/v1/items", "否", "物品列表（游标分页）"),
        ("GET", "/api/v1/items/:id", "否", "物品详情"),
        ("GET", "/api/v1/items/:id/thumb", "否", "物品缩略图（二进制）"),
        ("POST", "/api/v1/items/publish", "是", "发布物品（含简介、图片指纹、缩略图）"),
        ("DELETE", "/api/v1/items/:id", "是", "删除自己的物品（流转中禁止）"),
        ("GET", "/api/v1/orders/mine", "是", "我的订单（借入/借出、按状态筛选）"),
        ("POST", "/api/v1/orders/create", "是", "申请借用并冻结押金分"),
        ("PATCH", "/api/v1/orders/:id/state", "是", "状态流转（交接/发起归还/确认归还）"),
        ("GET", "/api/v1/notifications", "是", "通知列表与未读数"),
        ("PUT", "/api/v1/notifications/:id/read", "是", "单条已读"),
        ("PUT", "/api/v1/notifications/read-all", "是", "全部已读"),
    ],
    widths=[1.6, 6.6, 1.4, 7.4],
    caption="表 3-2  服务端接口清单",
    font_size=8,
)

h2(doc, "3.3  统一响应格式")
p(doc, "所有接口返回统一结构，前端 request.js 依此判断成功与错误：")
table(
    doc,
    ["字段", "类型", "说明"],
    [
        ("code", "number", "业务码：200 成功；40001 参数错误；40101 未登录；40102 账号或密码错误；"
                           "40301 无权限；40302 不在白名单；40303 未激活；40401 资源不存在；"
                           "40901 状态冲突；40902 业务规则冲突；42901 触发限流；50301 离线"),
        ("msg", "string", "提示文案，可直接展示给用户"),
        ("data", "object | null", "业务数据"),
        ("timestamp / trace_id", "number / string", "时间戳与链路追踪 ID，便于排查"),
    ],
    widths=[3.4, 2.8, 10.8],
    caption="表 3-3  统一响应结构",
    font_size=9,
)

# ------------------------------------------------------------------ 4
h1(doc, "4  数据库设计")

p(doc, "本期使用 JSON 文件数据库，逻辑上划分为 6 张表。表之间通过 id / student_no 关联，"
       "关系由应用层维护（无数据库外键约束）。")

figure(doc, "er.png", "图 4-1  核心数据实体关系（E-R）", width_cm=16.2)

h2(doc, "4.1  users（用户档案）")
table(
    doc,
    ["字段", "类型", "说明"],
    [
        ("id", "number", "主键，自增"),
        ("student_no", "string", "学号，唯一，13 位数字"),
        ("real_name", "string", "真实姓名（白名单核验依据）"),
        ("college_code / college_name", "string", "学院代码与学院名称"),
        ("major_code", "string", "专业代码（预留）"),
        ("credit_score", "number", "信用总分，初始 100"),
        ("credit_frozen", "number", "冻结分（押金合计）"),
        ("credit_available", "number", "可用分 = 总分 − 冻结"),
        ("credit_level", "number", "信用等级 1–6"),
        ("building_loc", "string", "所在公寓"),
        ("status", "number", "1 正常 / 0 禁用"),
        ("created_at / updated_at", "string", "ISO 8601 时间（+08:00）"),
    ],
    widths=[4.6, 2.6, 9.8],
    caption="表 4-1  users 表结构",
    font_size=8.5,
)

h2(doc, "4.2  accounts（登录账号）")
table(
    doc,
    ["字段", "类型", "说明"],
    [
        ("student_no", "string", "主键，与 users.student_no 一一对应"),
        ("password", "string", "scrypt 哈希，格式 scrypt$salt$hash；空字符串表示未激活"),
        ("name", "string", "姓名（与 users.real_name 一致）"),
        ("college / building / room", "string", "学院、公寓、房间号"),
        ("created_at", "string", "创建时间"),
    ],
    widths=[4.6, 2.6, 9.8],
    caption="表 4-2  accounts 表结构",
    font_size=8.5,
)

h2(doc, "4.3  items（物品）")
table(
    doc,
    ["字段", "类型", "说明"],
    [
        ("id", "number", "主键，自增且不复用（删除后不回收）"),
        ("owner_id", "number", "外键 → users.id"),
        ("title", "string", "标题，2–60 字"),
        ("description", "string", "简介，≤200 字；旧数据可能缺失"),
        ("category", "string", "类目：apparel / digital / tool / other"),
        ("image_hash", "string", "首图内容指纹（SHA-256 前 16 字节）"),
        ("image_thumb", "string", "首图缩略图 dataURL（≤90 KB），用于跨设备展示"),
        ("deposit_score", "number", "押金分（1–500）"),
        ("damage_rules", "object", "定损规则 { item_category, rules[], max_deduct, agreed_at_publish }"),
        ("building_loc", "string", "所在公寓"),
        ("is_high_value", "number", "是否高值物品 0/1"),
        ("status", "number", "0 可借 / 1 已借出 / 2 已下架 / 3 仲裁中"),
        ("created_at", "string", "发布时间"),
    ],
    widths=[4.6, 2.6, 9.8],
    caption="表 4-3  items 表结构",
    font_size=8.5,
)

h2(doc, "4.4  orders（订单）")
table(
    doc,
    ["字段", "类型", "说明"],
    [
        ("id", "number", "主键（从 30001 起）"),
        ("order_no", "string", "业务单号 YXX + 日期 + 4 位流水"),
        ("item_id", "number", "外键 → items.id"),
        ("borrower_id / owner_id", "number", "借用人 / 出借人（→ users.id）"),
        ("frozen_score", "number", "本单冻结的押金分"),
        ("state", "number", "0 待交接 / 1 使用中 / 2 已完成 / 3 仲裁中 / 4 已逾期 / 5 待出借人确认"),
        ("due_at", "string", "约定归还时间"),
        ("penalty_days", "number", "已结算的逾期天数（幂等扣分依据）"),
        ("snapshot", "object", "下单时的物品快照（标题、图片、押金、定损规则）"),
        ("created_at / finished_at", "string", "创建时间 / 完成时间"),
    ],
    widths=[4.6, 2.6, 9.8],
    caption="表 4-4  orders 表结构",
    font_size=8.5,
)

h2(doc, "4.5  credit_logs（信用流水）")
table(
    doc,
    ["字段", "类型", "说明"],
    [
        ("id", "number", "主键"),
        ("user_id", "number", "外键 → users.id"),
        ("change_type", "string", "freeze / unfreeze / add / deduct"),
        ("delta", "number", "分数变化；冻结与解冻为 0"),
        ("balance_after / frozen_after", "number", "变更后的总分与冻结分"),
        ("ref_type / ref_id", "string / number", "关联业务（order / ai_cert）"),
        ("reason", "string", "可读原因，直接展示给用户"),
        ("created_at", "string", "发生时间"),
    ],
    widths=[4.6, 2.6, 9.8],
    caption="表 4-5  credit_logs 表结构",
    font_size=8.5,
)

h2(doc, "4.6  notifications（通知）")
table(
    doc,
    ["字段", "类型", "说明"],
    [
        ("id", "number", "主键"),
        ("user_id", "number", "接收者（→ users.id）"),
        ("type", "string", "order / system"),
        ("title / body", "string", "通知标题与正文"),
        ("is_read", "boolean", "是否已读"),
        ("ref_id", "number", "关联订单 id"),
        ("created_at", "string", "生成时间"),
    ],
    widths=[4.6, 2.6, 9.8],
    caption="表 4-6  notifications 表结构",
    font_size=8.5,
)

h2(doc, "4.7  数据一致性保障")
bullets(
    doc,
    [
        "对账恒等式：SUM(credit_logs.delta) = users.credit_score − 100。",
        "物品状态与订单状态联动：下单置 1，归还确认后复位 0。",
        "逾期扣分幂等：以 order.penalty_days 记录已结算天数。",
        "订单快照：仲裁与定损以 snapshot 为准，避免物品被修改后无法追溯。",
        "ID 不复用：物品 id 由 seq.item 单调递增，删除后不回收，避免历史订单指向错误物品。",
    ],
)

# ------------------------------------------------------------------ 5
h1(doc, "5  核心流程设计")

h2(doc, "5.1  借用物品时序")
p(doc, "借用是系统最核心、状态最多的流程。下图给出从点击按钮到订单创建的完整时序。")
figure(doc, "sequence.png", "图 5-1  借用物品完整时序图", width_cm=16.2)

p(doc, "关键设计点：")
bullets(
    doc,
    [
        "校验顺序固定为：参数 → 物品存在 → 物品可借 → 非本人发布 → 可用分足够，保证错误码稳定。",
        "冻结与建单在同一个请求内完成，中间没有异步等待，避免并发下重复冻结。",
        "冻结只增加 credit_frozen，不改变 credit_score，保证总分与流水恒等式成立。",
        "订单创建后写 freeze 流水并生成出借人通知，同时落盘。",
    ],
)

h2(doc, "5.2  归还与双向确认")
p(doc, "归还流程被拆成两个角色、两个动作，避免借用人单方面结束订单：")
table(
    doc,
    ["步骤", "操作者", "接口", "状态变化", "副作用"],
    [
        ("1", "借用人", "PATCH /orders/:id/state {request_return}", "1 或 4 → 5", "给出借人发通知"),
        ("2", "出借人", "PATCH /orders/:id/state {confirm_return}", "5 → 2", "解冻押金、物品 status→0、给借用人发通知"),
        ("3", "系统", "读取 /users/me 或 /orders/mine", "1 → 4", "逾期判定与按天扣分（幂等）"),
    ],
    widths=[1.2, 2.2, 7.4, 2.8, 6.4],
    caption="表 5-1  归还状态流转",
    font_size=8.5,
)

h2(doc, "5.3  发布与图片链路")
bullets(
    doc,
    [
        "浏览器端：选择图片 → Canvas 缩放至最长边 512px → WebP 0.7 → 得到 dataURL 与压缩前后体积。",
        "同时计算首图 SHA-256 指纹作为 image_hash，首图 dataURL 作为 image_data 一并提交。",
        "服务端：校验格式与体积（≤90 KB）→ 存入 item.image_thumb → 列表响应只返回 has_thumb，不返回 base64。",
        "详情/列表渲染：本地图 → 服务端 /items/:id/thumb → 关键词插画，三级回退。",
    ],
)

# ------------------------------------------------------------------ 6
h1(doc, "6  关键技术与算法")

h2(doc, "6.1  端侧 Tesseract OCR")
p(doc, "信用认证需要读取芝麻信用截图中的分数。若上传服务器识别，既增加带宽也涉及隐私；"
       "因此采用 Tesseract.js 在浏览器内完成 OCR：")
bullets(
    doc,
    [
        "加载语言包（chi_sim）与 wasm 核心，全部来自本地 assets/ai，首次加载后由 Service Worker 缓存。",
        "用户选择截图后，先在本地预览，识别进度通过进度条实时反馈。",
        "识别文本用正则提取「芝麻分 / 信用分」附近的 3 位数字，命中即认为识别成功。",
        "识别成功后计算截图指纹，向服务端申请一次性 challenge，再提交奖励，防止直接调接口刷分。",
    ],
)
note(doc, "局限：OCR 对手写体、低分辨率与复杂背景识别率有限；本期仅用于演示与辅助加分，不作为风控唯一依据。")

h2(doc, "6.2  图片 Canvas 压缩")
p(doc, "校园网络上传原图体验极差，因此在端侧压缩：")
table(
    doc,
    ["步骤", "实现", "说明"],
    [
        ("1. 解码", "new Image() + URL.createObjectURL", "支持 jpg/png/webp；失败时尝试 createImageBitmap"),
        ("2. 等比缩放", "scale = min(1, 512 / 最长边)", "保证不变形"),
        ("3. 绘制", "canvas.drawImage(img, 0, 0, w, h)", "使用 2D 上下文"),
        ("4. 编码", "canvas.toDataURL('image/webp', 0.7)", "不支持 WebP 的浏览器自动退化为 PNG"),
        ("5. 结果", "dataURL + 压缩前后字节数", "界面显示「3.5 MB → 45 KB」"),
    ],
    widths=[2.6, 8.2, 6.2],
    caption="表 6-1  图片压缩流程",
    font_size=9,
)

h2(doc, "6.3  拼音敏感词匹配")
p(doc, "直接关键词匹配很容易被「dai kǎo」「原.味」「代^考」绕过。系统实现了三层匹配：")
bullets(
    doc,
    [
        "直接匹配：词表命中。",
        "归一化匹配：NFKC + 去声调 + 去空格/标点/符号/数字后，再做包含判断。",
        "拼音匹配：整段文本转无标调拼音，与拼音规则表（daikao、yuanwei、yuepao 等）比对。",
    ],
)
p(doc, "被拒绝的请求不消耗发布配额；前端连续 3 次触发敏感词会锁定发布按钮 5 分钟，服务端另有 60 秒限流。")

h2(doc, "6.4  JWT 鉴权与吊销")
bullets(
    doc,
    [
        "登录签发 7 天有效期的 JWT，载荷含 user_id、student_no、role、role_level、iss。",
        "所有业务接口经统一网关校验 Bearer Token，公开路由按「路径 + 方法」精确放行。",
        "注销与刷新都会把旧 Token 写入内存黑名单（带过期时间），网关先查黑名单再验签。",
        "前端在 Token 剩余有效期不足 24 小时时静默调用 /auth/refresh，避免用户被动掉线。",
    ],
)

h2(doc, "6.5  数据落盘：原子写、备份与恢复")
table(
    doc,
    ["机制", "实现方式", "解决的问题"],
    [
        ("原子写", "唯一临时文件（pid + 时间戳 + 序号）→ fsync → rename", "进程中断产生半截 JSON"),
        ("单实例锁", "启动写 .yxx.lock（pid/端口），检测存活进程则退出", "多开覆盖数据"),
        ("启动备份", "复制 db.json → db.backup.json", "误操作后可回滚"),
        ("每日备份", "定时到凌晨 03:00 再备份一次", "长期运行的数据兜底"),
        ("损坏恢复", "解析失败时自动读取备份并覆盖主文件，打印告警", "文件损坏导致启动失败"),
    ],
    widths=[2.6, 8.6, 5.8],
    caption="表 6-2  数据可靠性机制",
    font_size=9,
)

h2(doc, "6.6  双端布局与无感切换")
bullets(
    doc,
    [
        "断点 768px：移动端底部 TabBar + 悬浮 FAB；PC 端固定侧边栏（可折叠 200/64px）+ 顶部导航。",
        "壳层由 shell.js 注入，页面无需重复维护导航结构；折叠状态存 localStorage。",
        "跨断点时先冻结旧布局并整体虚化（opacity + blur），150ms 后切换再淡入；支持 View Transitions 的浏览器直接交叉淡入。",
        "页面转场使用 View Transitions API，降级为 CSS 位移动画；移动端实现右滑进入、左滑退出。",
    ],
)

h2(doc, "6.7  内网穿透部署")
p(doc, "试点期间无公网服务器，使用 Cloudflare Tunnel 把本机服务映射为 HTTPS 域名：")
bullets(
    doc,
    [
        "下载 cloudflared 可执行文件，执行 cloudflared tunnel --url http://127.0.0.1:3000。",
        "进程输出 https://xxx.trycloudflare.com 形式的公网地址，自带证书与 CDN。",
        "隧道与 Node 进程均以后台任务运行，链接可分享给试点用户。",
        "局限：临时隧道无可用性保证，进程重启后地址会变化；正式部署应使用固定域名与命名隧道。",
    ],
)

# ------------------------------------------------------------------ 7
h1(doc, "7  安全设计")

table(
    doc,
    ["风险", "防护措施", "验证方式"],
    [
        ("密码泄露", "scrypt 哈希存储、恒定时间比较、登录失败统一提示", "数据库无明文；错误密码返回 401"),
        ("越权操作", "鉴权网关 + 资源归属校验（物品/订单仅本人可操作）", "越权返回 403"),
        ("Token 被盗用", "7 天有效期、注销/刷新拉黑、可选缩短 TTL", "旧 Token 立即 401"),
        ("暴力破解", "登录/注册 10 次/分，发布/下单 1 次/分", "连续请求触发 429"),
        ("刷分", "认证奖励需一次性挑战 + 图片指纹 + 24 小时冷却", "重复领取 409"),
        ("恶意内容", "敏感词三层匹配 + 前端连击锁定", "含敏感词标题被拒"),
        ("XSS", "全部用户内容用 textContent 渲染，不拼接 HTML", "标题输入脚本不执行"),
        ("数据损坏", "原子写 + 备份 + 单实例锁", "写坏文件后可恢复"),
    ],
    widths=[2.8, 8.4, 5.8],
    caption="表 7-1  安全设计与验证",
    font_size=9,
)
note(doc, "尚未实施：HTTPS 由隧道提供但应用层未配置 HSTS/CSP；多实例部署需改为数据库事务与共享限流存储。")

# ------------------------------------------------------------------ 8
h1(doc, "8  性能与优化")

h2(doc, "8.1  前端性能")
bullets(
    doc,
    [
        "零构建：无打包器，浏览器直接加载 ES Module，减少构建链路与首屏阻塞。",
        "图片：压缩后体积通常为原图 1%–3%，显著降低传输与渲染开销。",
        "动画：只使用 opacity/transform/translate，避免触发布局；列表渐次浮现最多错峰 8 个。",
        "缓存：Service Worker 缓存外壳与字体，二次打开几乎即时。",
        "分页：列表接口游标分页，默认 10 条、上限 50 条。",
    ],
)

h2(doc, "8.2  服务端性能")
bullets(
    doc,
    [
        "数据全部在内存中操作，读操作 O(n) 线性扫描，试点数据量下可忽略。",
        "写操作整体落盘，单次 3–5 ms；通过 300ms 模拟延迟便于观察加载态。",
        "限流与黑名单使用内存 Map，无外部依赖。",
    ],
)

# ------------------------------------------------------------------ 9
h1(doc, "9  可扩展性与演进路线")
table(
    doc,
    ["方向", "现状", "演进方案"],
    [
        ("存储", "JSON 文件", "迁移 SQLite/PostgreSQL，保留 store.js 接口不变，替换实现即可"),
        ("实时通知", "页面拉取", "引入 SSE/WebSocket，通知表结构已就绪"),
        ("图片", "首图缩略图 + 本机原图", "接入对象存储（OSS/S3）与 CDN，支持原图"),
        ("管理后台", "数据文件 + 接口", "新增 admin 路由与管理页面，复用鉴权与角色字段"),
        ("多实例", "单实例锁", "共享限流存储（Redis）+ 数据库事务"),
        ("聊天", "localStorage", "接入消息服务，chat 模块的 UI 与消息结构可直接复用"),
    ],
    widths=[2.4, 5.0, 9.6],
    caption="表 9-1  演进路线",
    font_size=9,
)

p(doc, "本设计说明书与 SRS 一一对应：功能编号 FR-01~FR-20 均可在第 3 章模块与第 3.2 节接口中找到落点；"
       "测试报告中的用例按本文档的接口与状态机设计。")

path = save(doc, "02_系统设计与架构说明书_SDD.docx")
print("done")
