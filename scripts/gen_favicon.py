import os
from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, "frontend", "assets", "icons", "logo-192.png")
out = os.path.join(root, "frontend", "favicon.ico")

img = Image.open(src).convert("RGBA")
img.save(out, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("written:", out, os.path.getsize(out), "B")
