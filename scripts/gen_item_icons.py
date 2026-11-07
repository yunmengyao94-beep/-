"""生成物品占位图标（分类插画 + 默认占位图）。

用法：python scripts/gen_item_icons.py
输出：frontend/assets/icons/item-*.png、default-placeholder.png

说明：Mock 数据只有 image_hash，没有真实商品图；这里按物品标题关键词给出
本地插画，匹配不到的一律用 default-placeholder.png（禁止拿不相干的图凑数）。
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "frontend", "assets", "icons")
SIZE = 320

# 每个图标一套配色：(渐变起, 渐变止, 图形主色)
PALETTES = {
    "umbrella": ((255, 214, 224), (255, 168, 192), (214, 68, 108)),
    "box": ((214, 236, 255), (168, 212, 255), (32, 108, 196)),
    "gown": ((226, 222, 255), (188, 182, 255), (88, 78, 190)),
    "wig": ((255, 232, 214), (255, 205, 168), (176, 96, 32)),
    "clothes": ((214, 244, 232), (168, 226, 202), (24, 132, 96)),
    "digital": ((222, 232, 245), (186, 202, 224), (52, 74, 104)),
    "tool": ((250, 236, 210), (244, 214, 158), (150, 100, 20)),
    "study": ((224, 240, 255), (186, 216, 255), (36, 96, 176)),
    "luggage": ((236, 226, 250), (206, 188, 244), (108, 68, 176)),
    "outdoor": ((222, 246, 222), (176, 228, 176), (36, 128, 60)),
    "default": ((240, 242, 245), (222, 226, 232), (150, 156, 166)),
}


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size), top)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def rounded(img, radius_ratio=0.18):
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def glyph(name, color):
    """返回一个 320×320 的画布，画出对应物品的白色/主题色图形。"""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = SIZE / 2
    ink = (255, 255, 255, 255)
    accent = (*color, 255)

    if name == "umbrella":
        # 伞面 + 伞柄
        d.pieslice([70, 70, 250, 250], 180, 360, fill=ink)
        d.rounded_rectangle([152, 150, 168, 246], radius=8, fill=ink)
        d.arc([168, 214, 214, 260], 0, 180, fill=ink, width=14)
        d.rounded_rectangle([150, 62, 170, 78], radius=6, fill=accent)
    elif name == "box":
        # 保温箱：箱体 + 提手 + 分色盖
        d.rounded_rectangle([82, 122, 238, 240], radius=18, fill=ink)
        d.rounded_rectangle([82, 122, 238, 158], radius=14, fill=accent)
        d.arc([126, 84, 194, 148], 180, 360, fill=ink, width=14)
        d.rounded_rectangle([150, 176, 170, 200], radius=6, fill=accent)
    elif name == "gown":
        # 学士袍：梯形袍身 + 方帽
        d.polygon([(160, 150), (232, 258), (88, 258)], fill=ink)
        d.polygon([(110, 118), (210, 118), (210, 150), (110, 150)], fill=accent)
        d.polygon([(120, 84), (200, 84), (208, 112), (112, 112)], fill=ink)
        d.line([(208, 112), (232, 150)], fill=accent, width=8)
    elif name == "wig":
        # 假发：头部轮廓 + 波浪发丝
        d.ellipse([96, 86, 224, 214], fill=ink)
        d.pieslice([84, 150, 236, 274], 180, 360, fill=ink)
        d.arc([110, 130, 210, 230], 200, 340, fill=accent, width=10)
    elif name == "clothes":
        # T 恤
        d.polygon(
            [(118, 92), (202, 92), (246, 140), (216, 172), (200, 154), (200, 250), (120, 250), (120, 154), (104, 172), (74, 140)],
            fill=ink,
        )
        d.arc([134, 66, 186, 118], 0, 180, fill=accent, width=10)
    elif name == "digital":
        # 相机
        d.rounded_rectangle([72, 110, 248, 236], radius=20, fill=ink)
        d.rounded_rectangle([126, 88, 194, 118], radius=10, fill=ink)
        d.ellipse([116, 132, 204, 220], fill=accent)
        d.ellipse([136, 152, 184, 200], fill=ink)
    elif name == "tool":
        # 扳手
        d.rounded_rectangle([148, 120, 172, 250], radius=10, fill=ink)
        d.ellipse([118, 66, 202, 150], fill=ink)
        d.ellipse([140, 88, 180, 128], fill=(0, 0, 0, 0))
        d.polygon([(140, 66), (180, 66), (160, 96)], fill=(0, 0, 0, 0))
    elif name == "study":
        # 书本
        d.rounded_rectangle([80, 96, 240, 232], radius=14, fill=ink)
        d.rounded_rectangle([98, 116, 222, 212], radius=8, fill=accent)
        d.line([(160, 116), (160, 212)], fill=ink, width=10)
    elif name == "luggage":
        # 行李箱
        d.rounded_rectangle([88, 110, 232, 244], radius=16, fill=ink)
        d.rounded_rectangle([120, 76, 200, 112], radius=10, fill=accent)
        d.rounded_rectangle([140, 160, 180, 176], radius=6, fill=accent)
        d.ellipse([112, 244, 136, 268], fill=accent)
        d.ellipse([184, 244, 208, 268], fill=accent)
    elif name == "outdoor":
        # 帐篷
        d.polygon([(160, 84), (250, 248), (70, 248)], fill=ink)
        d.polygon([(160, 150), (206, 248), (114, 248)], fill=accent)
        d.line([(160, 84), (160, 248)], fill=(0, 0, 0, 0), width=6)
    else:  # default：图片占位
        d.rounded_rectangle([84, 96, 236, 224], radius=16, fill=ink)
        d.ellipse([108, 120, 140, 152], fill=accent)
        d.polygon([(104, 206), (156, 150), (196, 206)], fill=accent)
        d.polygon([(170, 206), (204, 172), (226, 206)], fill=accent)

    return img


def main():
    os.makedirs(OUT, exist_ok=True)

    for name, (top, bottom, color) in PALETTES.items():
        base = rounded(gradient(SIZE, top, bottom))
        base.alpha_composite(glyph(name, color))

        filename = "default-placeholder.png" if name == "default" else f"item-{name}.png"
        path = os.path.join(OUT, filename)
        base.save(path, "PNG", optimize=True)
        print(f"written: {filename}  {os.path.getsize(path)} B")


if __name__ == "__main__":
    main()
