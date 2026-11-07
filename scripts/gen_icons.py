"""生成易校圈 PWA 图标（192 / 512，含 maskable 版本）。
几何图形绘制，不依赖字体。用法：python scripts/gen_icons.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "frontend", "assets", "icons")

BLUE_TOP = (24, 144, 255)
BLUE_BOTTOM = (11, 47, 107)
WHITE = (255, 255, 255, 255)


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (size, size), top)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    return img


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_logo(size, padding_ratio=0.22, radius_ratio=0.22):
    """画：渐变圆角方块 + 白色书本（对开）+ 顶部圆点"""
    img = vertical_gradient(size, BLUE_TOP, BLUE_BOTTOM).convert("RGBA")
    img.putalpha(rounded_mask(size, int(size * radius_ratio)))

    draw = ImageDraw.Draw(img)
    pad = size * padding_ratio
    inner = size - pad * 2

    # 书本：左右两页
    page_w = inner * 0.46
    page_h = inner * 0.56
    top = size * 0.40
    left_x = pad + inner * 0.02
    right_x = pad + inner - page_w - inner * 0.02
    curve = size * 0.045

    draw.rounded_rectangle(
        [left_x, top, left_x + page_w, top + page_h], radius=curve, fill=WHITE
    )
    draw.rounded_rectangle(
        [right_x, top, right_x + page_w, top + page_h], radius=curve, fill=WHITE
    )

    # 中缝
    draw.rectangle([size * 0.485, top - size * 0.01, size * 0.515, top + page_h], fill=(24, 144, 255, 255))

    # 顶部圆点（信用分意象）
    dot_r = size * 0.075
    cx, cy = size / 2, size * 0.27
    draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=WHITE)

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    for size in (192, 512):
        logo = draw_logo(size)
        path = os.path.join(OUT_DIR, f"logo-{size}.png")
        logo.save(path, "PNG")
        print("written:", path, logo.size)

    # maskable：内容缩进到 80% 安全区
    for size in (192, 512):
        logo = draw_logo(int(size * 0.8), padding_ratio=0.16)
        canvas = vertical_gradient(size, BLUE_TOP, BLUE_BOTTOM).convert("RGBA")
        offset = (size - logo.size[0]) // 2
        canvas.paste(logo, (offset, offset), logo)
        path = os.path.join(OUT_DIR, f"logo-maskable-{size}.png")
        canvas.save(path, "PNG")
        print("written:", path, canvas.size)


if __name__ == "__main__":
    main()
