"""Generate PNG icons from scratch using PIL — no cairo needed."""
import os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else r'C:\Users\Admin\Dropbox\THITA-RT\supabase'


def make_icon(size: int) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Helper: scale a value (designed at 512px)
    sc = lambda v: int(v * s / 512)

    # Rounded square background — navy gradient (approximate with solid then overlay)
    # PIL doesn't have native rounded corners, so simulate with rectangle + mask
    bg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg)
    bg_draw.rounded_rectangle((0, 0, s, s), radius=sc(110), fill=(30, 58, 95))
    # Add gradient overlay
    grad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad_draw = ImageDraw.Draw(grad)
    for i in range(s):
        alpha = int(60 * i / s)
        grad_draw.line([(0, i), (s, i)], fill=(59, 110, 165, alpha))
    bg = Image.alpha_composite(bg, grad)
    # Apply rounded corners mask
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s, s), radius=sc(110), fill=255)
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # Subtle highlight circle (top-left)
    highlight = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(highlight).ellipse(
        (sc(120 - 160), sc(120 - 160), sc(120 + 160), sc(120 + 160)),
        fill=(255, 255, 255, 15)
    )
    img.alpha_composite(highlight, (0, 0))

    # Road dashes
    y_road = sc(392)
    dash_len = sc(16)
    gap = sc(12)
    x = sc(40)
    while x < sc(472):
        d.line([(x, y_road), (min(x + dash_len, sc(472)), y_road)], fill=(255, 255, 255, 100), width=sc(3))
        x += dash_len + gap

    # Truck offsets
    ox, oy = sc(46), sc(184)

    # Trailer (white box with TR letters)
    tx1, ty1, tx2, ty2 = ox + sc(180), oy + sc(10), ox + sc(180 + 240), oy + sc(10 + 170)
    d.rounded_rectangle((tx1, ty1, tx2, ty2), radius=sc(10), fill=(245, 248, 252), outline=(30, 58, 95), width=sc(4))

    # TR letters
    try:
        font_size = sc(140)
        font_path = None
        for f in ["arialbd.ttf", "arial.ttf", "C:/Windows/Fonts/arialbd.ttf"]:
            if os.path.exists(f):
                font_path = f
                break
        font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()
    text = "TR"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx_center = (tx1 + tx2) // 2 - tw // 2 - bbox[0]
    ty_center = (ty1 + ty2) // 2 - th // 2 - bbox[1]
    d.text((tx_center, ty_center), text, fill=(30, 58, 95), font=font)

    # Cab (orange) — simplified rectangle with slanted top
    cab_left = ox
    cab_right = ox + sc(178)
    cab_top = oy + sc(16)
    cab_bottom = oy + sc(180)
    # Main body (lower part)
    d.polygon([
        (cab_left, oy + sc(110)),  # top-left of lower
        (cab_left + sc(56), oy + sc(110)),  # right of lower-left
        (cab_left + sc(56), oy + sc(95)),
        (cab_left + sc(78), cab_top + sc(20)),  # slope
        (cab_left + sc(106), cab_top),  # top-left of cab
        (cab_right - sc(4), cab_top),  # top-right of cab
        (cab_right, cab_top + sc(20)),  # slope
        (cab_right, cab_bottom),  # bottom-right
        (cab_left, cab_bottom),  # bottom-left
    ], fill=(245, 158, 11), outline=(30, 58, 95))

    # Windshield
    d.polygon([
        (cab_left + sc(80), cab_top + sc(76)),
        (cab_left + sc(100), cab_top + sc(28)),
        (cab_left + sc(112), cab_top + sc(20)),
        (cab_left + sc(154), cab_top + sc(20)),
        (cab_left + sc(164), cab_top + sc(28)),
        (cab_left + sc(164), cab_top + sc(76)),
    ], fill=(56, 189, 248), outline=(30, 58, 95))

    # Headlight
    d.ellipse(
        (cab_left + sc(5), oy + sc(124),
         cab_left + sc(23), oy + sc(136)),
        fill=(254, 243, 199), outline=(30, 58, 95), width=sc(2)
    )

    # Wheels — 4 wheels with rim
    wheel_y = oy + sc(190)
    wheel_r = sc(30)
    for cx in [ox + sc(44), ox + sc(220), ox + sc(300), ox + sc(380)]:
        d.ellipse((cx - wheel_r, wheel_y - wheel_r, cx + wheel_r, wheel_y + wheel_r), fill=(30, 41, 59))
        d.ellipse((cx - sc(15), wheel_y - sc(15), cx + sc(15), wheel_y + sc(15)), fill=(148, 163, 184))
        d.ellipse((cx - sc(6), wheel_y - sc(6), cx + sc(6), wheel_y + sc(6)), fill=(30, 41, 59))

    # THIRA text below
    try:
        font_brand = ImageFont.truetype(font_path, sc(44)) if font_path else ImageFont.load_default()
    except Exception:
        font_brand = ImageFont.load_default()
    brand_text = "THIRA"
    bbox = d.textbbox((0, 0), brand_text, font=font_brand)
    bw = bbox[2] - bbox[0]
    d.text(((s - bw) // 2 - bbox[0], sc(440)), brand_text, fill=(255, 255, 255), font=font_brand)

    return img


for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "icon-180.png"), (96, "icon-96.png")]:
    img = make_icon(size)
    img.save(os.path.join(OUT_DIR, name), "PNG")
    print(f"  {name} ({size}x{size}) ✓")
print("Done")
