# -*- coding: utf-8 -*-
"""生成四份交付文档所需的示意图（用例图 / 架构图 / E-R 图 / 时序图 / 部署图）。"""

import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(BASE, "交付文档", "images")
os.makedirs(OUT, exist_ok=True)

FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

PRIMARY = (31, 111, 235)
DARK = (18, 35, 63)
LIGHT = (232, 240, 254)
GRAY = (120, 128, 140)
LINE = (150, 160, 175)
WHITE = (255, 255, 255)


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_PATH, size)


def canvas(w, h):
    img = Image.new("RGB", (w, h), WHITE)
    return img, ImageDraw.Draw(img)


def text(draw, xy, s, size=22, bold=False, fill=DARK, anchor="la"):
    draw.text(xy, s, font=font(size, bold), fill=fill, anchor=anchor)


def box(draw, xy, w, h, title, lines=(), fill=LIGHT, outline=PRIMARY, radius=14,
        title_size=24, body_size=18, title_color=DARK, body_color=DARK):
    x, y = xy
    draw.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill, outline=outline, width=2)
    text(draw, (x + w / 2, y + 22), title, title_size, True, title_color, anchor="ma")
    cy = y + 52
    for line in lines:
        text(draw, (x + w / 2, cy), line, body_size, False, body_color, anchor="ma")
        cy += body_size + 8


def arrow(draw, p1, p2, color=GRAY, width=2, head=12):
    import math
    draw.line([p1, p2], fill=color, width=width)
    angle = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    for delta in (math.radians(155), math.radians(-155)):
        x = p2[0] + head * math.cos(angle + delta)
        y = p2[1] + head * math.sin(angle + delta)
        draw.line([p2, (x, y)], fill=color, width=width)


def dashed(draw, p1, p2, color=LINE, width=2, dash=12, gap=8):
    import math
    total = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    if total == 0:
        return
    dx = (p2[0] - p1[0]) / total
    dy = (p2[1] - p1[1]) / total
    pos = 0
    while pos < total:
        end = min(pos + dash, total)
        draw.line([(p1[0] + dx * pos, p1[1] + dy * pos), (p1[0] + dx * end, p1[1] + dy * end)],
                  fill=color, width=width)
        pos = end + gap


def actor(draw, x, y, name, size=22):
    """画一个火柴人，y 为头部中心。"""
    draw.ellipse([x - 40, y - 40, x + 40, y + 40], outline=DARK, width=3, fill=WHITE)
    draw.line([x, y + 40, x, y + 112], fill=DARK, width=3)
    draw.line([x - 60, y + 72, x + 60, y + 72], fill=DARK, width=3)
    draw.line([x, y + 112, x - 40, y + 172], fill=DARK, width=3)
    draw.line([x, y + 112, x + 40, y + 172], fill=DARK, width=3)
    text(draw, (x, y + 196), name, size, True, DARK, anchor="ma")


# ---------------------------------------------------------------- 用例图
def usecase():
    w, h = 1800, 1120
    img, d = canvas(w, h)
        # 系统边界
    d.rounded_rectangle([360, 88, 1660, 1020], radius=18, outline=PRIMARY, width=3, fill=(249, 252, 255))
    text(d, (1010, 108), "庆师易校圈系统边界", 24, True, PRIMARY, anchor="ma")

    # 参与者
    actor(d, 170, 300, "出借人")
    actor(d, 170, 760, "借用人")
    actor(d, 1740, 420, "管理员")

    # 用例（三列，按角色分区，避免连线交叉）
    col1 = [("登录 / 白名单注册", 150), ("发布物品（含简介/图片）", 280),
            ("物品下架 / 删除", 410), ("确认归还", 540)]
    col2 = [("浏览与搜索物品", 560), ("申请借用 / 交接确认", 680),
            ("发起归还", 800), ("信用认证（端侧 OCR）", 920)]
    col3 = [("逾期处罚与信用流水", 300), ("消息通知中心", 430), ("物品与用户管理", 560)]

    centers = {}

    def draw_case(label, x, y, cw):
        d.rounded_rectangle([x, y, x + cw, y + 76], radius=38, outline=PRIMARY, width=2, fill=WHITE)
        text(d, (x + cw / 2, y + 38), label, 20, False, DARK, anchor="mm")
        centers[label] = (x + cw / 2, y + 38, x, y + 38, x + cw)

    for label, y in col1:
        draw_case(label, 420, y, 400)
    for label, y in col2:
        draw_case(label, 880, y, 420)
    for label, y in col3:
        draw_case(label, 1350, y, 280)

    # 出借人 → 左列
    for label, y in col1:
        left = centers[label][2]
        dashed(d, (240, 300), (left, y + 38), color=LINE, width=2)

    # 借用人 → 中列（从下方走，避让左列）
    for label, y in col2:
        left = centers[label][2]
        dashed(d, (240, 760), (left, y + 38), color=LINE, width=2)

    # 管理员 → 右列
    for label, y in col3:
        right = centers[label][4]
        dashed(d, (1700, 420), (right, y + 38), color=LINE, width=2)

    text(d, (60, 1055),
         "说明：椭圆为用例；左侧「出借人 / 借用人」、右侧「管理员」为参与者；"
         "登录为所有角色共用能力（图中只画一条连线，避免交叉）。",
         18, False, GRAY)
    img.save(os.path.join(OUT, "usecase.png"), quality=95)
    print("usecase.png")


# ---------------------------------------------------------------- 架构图
def architecture():
    w, h = 1700, 1180
    img, d = canvas(w, h)
    # 客户端层
    d.rounded_rectangle([60, 88, 1640, 360], radius=18, outline=LINE, width=2, fill=(250, 251, 253))
    text(d, (90, 102), "客户端层（浏览器 / PWA / 移动端 H5）", 22, True, PRIMARY)
    box(d, (90, 146), 330, 176, "页面（HTML5）",
        ["index / item / publish", "orders / notifications", "profile / settings / help"], fill=WHITE)
    box(d, (450, 146), 360, 176, "前端组件与工具（ESM）",
        ["components：shell / feedback", "utils：request / device / chat", "图片压缩、转场、拖拽 FAB"], fill=WHITE)
    box(d, (840, 146), 330, 176, "Service Worker",
        ["yxx-v4 缓存外壳", "离线缓存 / 更新提示", "PWA 可安装"], fill=WHITE)
    box(d, (1200, 146), 400, 176, "端侧 AI（Tesseract.js）",
        ["芝麻信用截图 OCR", "WASM 离线识别", "不上传原图"], fill=WHITE)

    # 接入层
    d.rounded_rectangle([60, 410, 1640, 590], radius=18, outline=LINE, width=2, fill=(250, 251, 253))
    text(d, (90, 424), "接入层", 22, True, PRIMARY)
    accesses = [
        ("HTTPS / Cloudflare Tunnel", "内网穿透，公网可访问"),
        ("Express 5", "CORS / JSON / Morgan"),
        ("统一鉴权网关", "JWT + Token 黑名单"),
        ("限流 / 单实例锁", "内存限流 + .yxx.lock"),
    ]
    for i, (title, sub) in enumerate(accesses):
        x = 90 + i * 380
        d.rounded_rectangle([x, 470, x + 350, 562], radius=12, fill=WHITE, outline=PRIMARY, width=2)
        text(d, (x + 175, 496), title, 19, True, DARK, anchor="ma")
        text(d, (x + 175, 530), sub, 16, False, DARK, anchor="ma")

    # 服务层
    d.rounded_rectangle([60, 640, 1640, 860], radius=18, outline=LINE, width=2, fill=(250, 251, 253))
    text(d, (90, 654), "业务服务层（server/routes）", 22, True, PRIMARY)
    services = ["auth 认证", "users 用户", "items 物品", "orders 订单", "notifications 通知"]
    for i, name in enumerate(services):
        box(d, (90 + i * 310, 694), 280, 130, name, ["参数校验", "业务规则", "落盘"], fill=WHITE,
            title_size=22, body_size=16)

    # 数据层
    d.rounded_rectangle([60, 910, 1640, 1090], radius=18, outline=LINE, width=2, fill=(250, 251, 253))
    text(d, (90, 924), "数据与安全层（server/store.js）", 22, True, PRIMARY)
    box(d, (90, 966), 470, 96, "db.json（JSON 文件数据库）",
        ["users / accounts / items / orders / credit_logs / notifications"], fill=WHITE,
        title_size=20, body_size=15)
    box(d, (600, 966), 420, 96, "原子写 + 备份",
        ["唯一 tmp + fsync + rename；db.backup.json"], fill=WHITE, title_size=20, body_size=15)
    box(d, (1060, 966), 520, 96, "安全机制",
        ["scrypt 密码哈希 / 恒定时间比较 / JWT / 拼音敏感词"], fill=WHITE, title_size=20, body_size=15)

    # 层间箭头
    arrow(d, (850, 362), (850, 404), color=PRIMARY, width=3)
    arrow(d, (850, 592), (850, 634), color=PRIMARY, width=3)
    arrow(d, (850, 862), (850, 904), color=PRIMARY, width=3)
    text(d, (880, 370), "HTTP/JSON", 16, False, GRAY)
    text(d, (880, 600), "路由分发", 16, False, GRAY)
    text(d, (880, 870), "读写", 16, False, GRAY)

    img.save(os.path.join(OUT, "architecture.png"), quality=95)
    print("architecture.png")


# ---------------------------------------------------------------- E-R 图
def er():
    w, h = 1700, 820
    img, d = canvas(w, h)
    def entity(x, y, name, fields, color=PRIMARY, width=330):
        bh = 60 + 27 * len(fields)
        d.rounded_rectangle([x, y, x + width, y + bh], radius=12, outline=color, width=2, fill=WHITE)
        d.rectangle([x, y, x + width, y + 42], fill=color)
        text(d, (x + width / 2, y + 21), name, 21, True, WHITE, anchor="mm")
        for i, f in enumerate(fields):
            text(d, (x + 16, y + 52 + i * 27), f, 16, False, DARK)
        return (x, y, width, bh)

    u = entity(90, 120, "users 用户档案",
               ["id (PK)", "student_no (UK)", "real_name / college_name", "credit_score / credit_frozen",
                "credit_level / building_loc", "status / created_at"])
    a = entity(90, 500, "accounts 账号",
               ["student_no (PK)", "password (scrypt)", "name / college", "building / room", "created_at"])
    i = entity(650, 120, "items 物品",
               ["id (PK)", "owner_id (FK→users)", "title / description", "category / deposit_score",
                "image_thumb / image_hash", "damage_rules / status", "building_loc / created_at"])
    o = entity(650, 520, "orders 订单",
               ["id (PK)", "item_id (FK→items)", "borrower_id / owner_id", "frozen_score / state",
                "due_at / penalty_days", "snapshot / finished_at"])
    lg = entity(1210, 120, "credit_logs 信用流水",
                ["id (PK)", "user_id (FK→users)", "change_type / delta", "balance_after / frozen_after",
                 "ref_type / ref_id", "reason / created_at"])
    nt = entity(1210, 500, "notifications 通知",
                ["id (PK)", "user_id (FK→users)", "type / title / body", "is_read / ref_id", "created_at"])

    # accounts → users（1:1 激活）
    arrow(d, (255, 498), (255, 380), color=PRIMARY, width=3)
    text(d, (272, 436), "1 : 1 激活", 17, False, DARK)

    # users → items（1:N 发布）
    arrow(d, (422, 250), (646, 250), color=PRIMARY, width=3)
    text(d, (534, 222), "1 : N 发布", 17, False, DARK, anchor="mm")

    # items → orders（1:N 被借）
    arrow(d, (815, 384), (815, 516), color=PRIMARY, width=3)
    text(d, (832, 448), "1 : N 被借", 17, False, DARK)

    # users → credit_logs（1:N 流水，走顶部）
    dashed(d, (422, 112), (1206, 112), color=PRIMARY, width=2)
    dashed(d, (1206, 112), (1206, 116), color=PRIMARY, width=2)
    text(d, (700, 92), "1 : N 信用流水", 17, False, DARK, anchor="mm")

    # orders → notifications 说明（无直接外键）
    dashed(d, (980, 640), (1206, 600), color=LINE, width=2)
    text(d, (1090, 588), "状态变更生成通知", 16, False, GRAY, anchor="mm")

    text(d, (90, 740), "说明：PK 主键，UK 唯一键，FK 外键；notifications.user_id 指向 users（1:N）。",
         17, False, GRAY)
    img.save(os.path.join(OUT, "er.png"), quality=95)
    print("er.png")


# ---------------------------------------------------------------- 时序图
def sequence():
    w, h = 1700, 1060
    img, d = canvas(w, h)
    lanes = [("借用人浏览器", 180), ("PWA 前端", 520), ("Express 网关", 860), ("订单服务", 1160), ("存储 store", 1480)]
    for name, x in lanes:
        box(d, (x - 130, 86), 260, 64, name, [], fill=LIGHT, title_size=22)
        dashed(d, (x, 152), (x, 960), color=LINE, width=2)

    steps = [
        ("1. 点击「申请借用」", 180, 520, 220),
        ("2. 校验可用分 / 打开确认弹窗", 520, 520, 278),
        ("3. POST /orders/create + JWT", 520, 860, 336),
        ("4. 校验 Token / 限流", 860, 860, 394),
        ("5. 校验物品状态、自借、额度", 860, 1160, 452),
        ("6. 冻结押金分 + 建单", 1160, 1480, 510),
        ("7. 原子落盘", 1480, 1480, 568),
        ("8. 返回 order_id / state=0", 1160, 860, 626),
        ("9. 200 JSON（含冻结分）", 860, 520, 684),
        ("10. Toast + 按钮变「已申请」", 520, 180, 742),
    ]

    for label, x1, x2, y in steps:
        if x1 == x2:
            d.line([(x1, y - 18), (x1, y + 18)], fill=PRIMARY, width=2)
            text(d, (x1 + 14, y - 34), label, 17, False, DARK)
            continue
        arrow(d, (x1, y), (x2, y), color=PRIMARY, width=2)
        text(d, ((x1 + x2) / 2, y - 26), label, 17, False, DARK, anchor="mm")

    text(d, (60, 900), "异步：出借人下次打开消息中心时，通过 GET /notifications 拉取到「申请借用」通知。",
         18, False, GRAY)
    text(d, (60, 940), "要点：冻结与建单在同一请求内完成；押金只冻结不扣分，归还确认后解冻。",
         18, False, GRAY)
    img.save(os.path.join(OUT, "sequence.png"), quality=95)
    print("sequence.png")


# ---------------------------------------------------------------- 部署图
def deploy():
    w, h = 1600, 760
    img, d = canvas(w, h)
    box(d, (80, 150), 300, 170, "用户设备", ["手机浏览器 / PWA", "PC Chrome / Edge"], fill=WHITE)
    box(d, (500, 150), 320, 170, "Cloudflare Tunnel", ["trycloudflare.com", "自动 HTTPS 证书"], fill=WHITE)
    box(d, (940, 150), 300, 170, "本机 Node.js", ["Express :3000", "静态资源 + API"], fill=WHITE)
    box(d, (1320, 100), 220, 120, "db.json", ["原子写"], fill=WHITE)
    box(d, (1320, 260), 220, 120, "db.backup.json", ["启动 / 每日备份"], fill=WHITE)

    arrow(d, (384, 235), (496, 235), color=PRIMARY, width=3)
    text(d, (440, 202), "HTTPS", 16, False, GRAY, anchor="mm")
    arrow(d, (824, 235), (936, 235), color=PRIMARY, width=3)
    text(d, (880, 202), "HTTP", 16, False, GRAY, anchor="mm")
    arrow(d, (1244, 210), (1316, 170), color=PRIMARY, width=3)
    arrow(d, (1244, 260), (1316, 310), color=PRIMARY, width=3)

    text(d, (80, 420), "运行时约束：", 22, True, DARK)
    notes = [
        "① 单实例锁 server/.yxx.lock，防止多开覆盖数据；",
        "② 数据落盘采用「唯一 tmp + fsync + rename」原子写；",
        "③ 主文件损坏时自动从 db.backup.json 恢复并告警；",
        "④ 生产环境建议改为 SQLite / PostgreSQL 并使用固定域名隧道。",
    ]
    cy = 460
    for n in notes:
        text(d, (100, cy), n, 19, False, DARK)
        cy += 42

    img.save(os.path.join(OUT, "deploy.png"), quality=95)
    print("deploy.png")


# ---------------------------------------------------------------- 缺陷分布图
def defect_chart():
    w, h = 1500, 820
    img, d = canvas(w, h)

    left, bottom, top = 150, 660, 140
    plot_w = w - left - 90

    # 坐标轴
    d.line([(left, top), (left, bottom)], fill=GRAY, width=2)
    d.line([(left, bottom), (left + plot_w, bottom)], fill=GRAY, width=2)

    # 纵轴刻度 0-10
    for i in range(0, 11, 2):
        y = bottom - (bottom - top) * i / 10
        d.line([(left, y), (left + plot_w, y)], fill=(230, 233, 238), width=1)
        text(d, (left - 18, y), str(i), 16, False, GRAY, anchor="rm")

    groups = [("P0 阻断", 5, 5, (255, 77, 79)), ("P1 严重", 7, 7, (250, 173, 20)), ("P2 一般", 9, 7, (24, 144, 255))]
    slot = plot_w / len(groups)

    for idx, (label, found, fixed, color) in enumerate(groups):
        cx = left + slot * (idx + 0.5)
        bar_w = 90

        fx = cx - bar_w + 8
        fy = bottom - (bottom - top) * found / 10
        d.rounded_rectangle([fx, fy, fx + bar_w, bottom], radius=8, fill=color)
        text(d, (fx + bar_w / 2, fy - 24), str(found), 18, True, DARK, anchor="mm")

        gx = cx + 8
        gy = bottom - (bottom - top) * fixed / 10
        d.rounded_rectangle([gx, gy, gx + bar_w, bottom], radius=8, fill=(230, 236, 245))
        text(d, (gx + bar_w / 2, gy - 24), str(fixed), 18, True, DARK, anchor="mm")

        text(d, (cx, bottom + 22), label, 18, True, DARK, anchor="ma")

    # 图例
    d.rectangle([left, 54, left + 20, 74], fill=PRIMARY)
    text(d, (left + 30, 56), "发现", 17, False, DARK)
    d.rectangle([left + 110, 54, left + 130, 74], fill=(230, 236, 245))
    text(d, (left + 140, 56), "已修复", 17, False, DARK)

    text(d, (w / 2, 760), "统计口径：截至 2026-11-08 的缺陷记录", 16, False, GRAY, anchor="ma")
    img.save(os.path.join(OUT, "defects.png"), quality=95)
    print("defects.png")


if __name__ == "__main__":
    usecase()
    architecture()
    er()
    sequence()
    deploy()
    defect_chart()
    print("输出目录:", OUT)
