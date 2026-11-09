"""绿幕素材表 → 透明图集。用法：python -I slice_sheet.py 输入图 输出前缀
抠绿（软边+去绿边）→ 连通域找元素 → 按行列排序编号 → 打包成一张 webp 图集 + json 坐标。"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
# 绿度：g 比 r、b 中较大者高多少
spill = g - np.maximum(r, b)
alpha = np.clip(1 - (spill - 40) / 80, 0, 1)  # spill<40 完全不透明，>120 完全透明
# 去绿边：半透明/边缘像素把 g 压到 max(r,b)
g2 = np.where(spill > 0, np.maximum(r, b) + np.clip(spill, 0, None) * 0.15, g)
rgba = np.dstack([r, g2, b, alpha * 255]).clip(0, 255).astype(np.uint8)

mask = alpha > 0.5
mask = ndimage.binary_closing(mask, iterations=2)
lab, n = ndimage.label(mask)
objs = ndimage.find_objects(lab)
boxes = []
for i, sl in enumerate(objs):
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    if h * w < 900:  # 噪点
        continue
    boxes.append([xs.start, ys.start, w, h])
# 按行聚类：中心 y 相近的算一行
boxes.sort(key=lambda bx: bx[1] + bx[3] / 2)
rows, cur = [], []
for bx in boxes:
    cy = bx[1] + bx[3] / 2
    if cur and abs(cy - (cur[-1][1] + cur[-1][3] / 2)) > max(bx[3], cur[-1][3]) * 0.45:
        rows.append(cur)
        cur = []
    cur.append(bx)
if cur:
    rows.append(cur)
items = []
for ri, row in enumerate(rows):
    row.sort(key=lambda bx: bx[0])
    for ci, bx in enumerate(row):
        items.append({"row": ri, "col": ci, "box": bx})
print(f"{len(items)} items in {len(rows)} rows:", [len(r_) for r_ in rows])

# 打包：每个元素外扩 2px，按原位置裁出后横排装箱（简单货架算法）
pad = 2
H, W = rgba.shape[:2]
crops = []
for it in items:
    x, y, w, h = it["box"]
    x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(W, x + w + pad), min(H, y + h + pad)
    crop = rgba[y0:y1, x0:x1].copy()
    # 只保留属于本元素的像素（别把邻居的碎边带进来）
    sub = lab[y0:y1, x0:x1]
    ids, cnt = np.unique(sub[sub > 0], return_counts=True)
    own = ids[np.argmax(cnt)]  # 框里占比最多的连通域就是本元素（中心可能是镂空，比如铜钱方孔）
    lm = (sub == 0) | (sub == own)
    crop[..., 3] = np.where(lm, crop[..., 3], 0)
    crops.append(crop)
AW = 1024
xx = yy = shelf = 0
pos = []
for c in crops:
    h, w = c.shape[:2]
    if xx + w > AW:
        xx, yy, shelf = 0, yy + shelf + 2, 0
    pos.append((xx, yy))
    xx += w + 2
    shelf = max(shelf, h)
AH = yy + shelf
atlas = np.zeros((AH, AW, 4), np.uint8)
meta = []
for it, c, (px, py) in zip(items, crops, pos):
    h, w = c.shape[:2]
    atlas[py:py + h, px:px + w] = c
    meta.append({"row": it["row"], "col": it["col"], "x": px, "y": py, "w": w, "h": h})
Image.fromarray(atlas).save(out + ".webp", lossless=False, quality=90, method=6)
Image.fromarray(atlas).save(out + "_preview.png")
json.dump(meta, open(out + ".json", "w"), indent=1)
print("atlas", AW, AH)
