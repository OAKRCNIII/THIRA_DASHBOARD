"""
Generate LIFF channel icon — LINE green + truck + edit pencil overlay.

Output:
  - liff-icon.png       (1024×1024 main — for LINE Login channel)
  - liff-icon-512.png   (preview)
  - liff-icon-192.png   (PWA)

Concept:
  - Square with rounded corners (LINE style)
  - LINE green gradient background (#06c755 → #00b248)
  - White truck silhouette (matches THIRA brand)
  - Small white pencil/edit badge top-right → signifies "edit form"
"""
import os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = r'C:\Users\Admin\Dropbox\THITA-RT\supabase'

# Design colors
LINE_GREEN_TOP = (6, 199, 85)      # #06c755
LINE_GREEN_BOT = (0, 178, 72)      # #00b248
WHITE = (255, 255, 255)
PENCIL_YELLOW = (251, 191, 36)     # accent — pencil tip
SHADOW = (0, 0, 0, 60)


def make_liff_icon(size: int) -> Image.Image:
    s = size
    sc = lambda v: int(v * s / 1024)   # designed at 1024
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # ── 1. Rounded square with vertical gradient (LINE green) ──
    bg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg)
    bg_draw.rounded_rectangle((0, 0, s, s), radius=sc(220), fill=LINE_GREEN_TOP)
    # vertical gradient overlay → darker green at bottom
    grad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    grad_draw = ImageDraw.Draw(grad)
    for i in range(s):
        t = i / s
        r = int(LINE_GREEN_TOP[0] * (1 - t) + LINE_GREEN_BOT[0] * t)
        g = int(LINE_GREEN_TOP[1] * (1 - t) + LINE_GREEN_BOT[1] * t)
        b = int(LINE_GREEN_TOP[2] * (1 - t) + LINE_GREEN_BOT[2] * t)
        grad_draw.line([(0, i), (s, i)], fill=(r, g, b, 255))
    # apply rounded mask
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s, s), radius=sc(220), fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)

    # ── 2. Subtle radial highlight top-left (gives depth) ──
    highlight = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    h_draw = ImageDraw.Draw(highlight)
    for r in range(sc(360), 0, -sc(20)):
        alpha = int(8 * (sc(360) - r) / sc(360))
        h_draw.ellipse(
            (sc(180) - r, sc(160) - r, sc(180) + r, sc(160) + r),
            fill=(255, 255, 255, alpha),
        )
    img.alpha_composite(highlight, (0, 0))

    # ── 3. White truck silhouette (center, slightly left) ──
    # Cab + container — simplified silhouette
    truck = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    td = ImageDraw.Draw(truck)

    # Container (trailer) — large rectangle, slight rounded
    cont_left = sc(170)
    cont_right = sc(720)
    cont_top = sc(360)
    cont_bot = sc(660)
    td.rounded_rectangle((cont_left, cont_top, cont_right, cont_bot),
                         radius=sc(24), fill=WHITE)

    # Cab — smaller rounded rectangle to the right
    cab_left = sc(720)
    cab_right = sc(880)
    cab_top = sc(440)
    cab_bot = sc(660)
    td.rounded_rectangle((cab_left, cab_top, cab_right, cab_bot),
                         radius=sc(20), fill=WHITE)
    # Cab window — green cutout
    win_pad = sc(20)
    td.rounded_rectangle(
        (cab_left + win_pad, cab_top + win_pad,
         cab_right - sc(15), cab_top + sc(95)),
        radius=sc(10), fill=LINE_GREEN_TOP
    )

    # Wheels — 3 dark circles
    wheel_r = sc(48)
    wheel_y = sc(680)
    for cx in [sc(280), sc(520), sc(800)]:
        td.ellipse((cx - wheel_r, wheel_y - wheel_r,
                    cx + wheel_r, wheel_y + wheel_r),
                   fill=(20, 50, 30, 255))
        # wheel hub
        hub_r = sc(18)
        td.ellipse((cx - hub_r, wheel_y - hub_r,
                    cx + hub_r, wheel_y + hub_r),
                   fill=WHITE)

    # "TR" text on the container
    try:
        font_path = r"C:\Windows\Fonts\arialbd.ttf"
        font = ImageFont.truetype(font_path, sc(140))
    except Exception:
        font = ImageFont.load_default()
    text = "TR"
    bbox = td.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = cont_left + (cont_right - cont_left - tw) // 2 - sc(20)
    ty = cont_top + (cont_bot - cont_top - th) // 2 - sc(10)
    td.text((tx, ty), text, fill=LINE_GREEN_TOP, font=font)

    img.alpha_composite(truck, (0, 0))

    # ── 4. Pencil/edit badge — top-right corner ──
    # ทำเป็นวงกลมขาวเล็กๆ มีดินสอข้างใน → indicate "edit"
    badge_center = (sc(820), sc(220))
    badge_r = sc(135)

    # Badge shadow
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse((badge_center[0] - badge_r + sc(4),
                badge_center[1] - badge_r + sc(8),
                badge_center[0] + badge_r + sc(4),
                badge_center[1] + badge_r + sc(8)),
               fill=(0, 0, 0, 50))
    shadow = shadow.filter(__import__('PIL.ImageFilter', fromlist=['GaussianBlur']).GaussianBlur(sc(6)))
    img.alpha_composite(shadow, (0, 0))

    # Badge — white circle
    d.ellipse((badge_center[0] - badge_r,
               badge_center[1] - badge_r,
               badge_center[0] + badge_r,
               badge_center[1] + badge_r),
              fill=WHITE)

    # Pencil inside badge — diagonal pencil shape
    cx, cy = badge_center
    # Pencil body — rectangle rotated 45deg, draw via polygon
    # Calculated offsets to get a 45deg pencil
    pen_len = sc(120)
    pen_w = sc(30)
    # Coordinates: 4 corners of pencil body (yellow), running from top-right to bottom-left
    # Center the pencil in badge
    import math
    angle = math.radians(-45)
    cos_a, sin_a = math.cos(angle), math.sin(angle)

    def rotate(px, py):
        return (cx + px * cos_a - py * sin_a,
                cy + px * sin_a + py * cos_a)

    # Body (yellow part)
    body_pts = [
        rotate(-pen_len / 2 + sc(20), -pen_w / 2),
        rotate(pen_len / 2 - sc(25), -pen_w / 2),
        rotate(pen_len / 2 - sc(25), pen_w / 2),
        rotate(-pen_len / 2 + sc(20), pen_w / 2),
    ]
    d.polygon(body_pts, fill=PENCIL_YELLOW)

    # Tip (dark grey, pointed)
    tip_pts = [
        rotate(pen_len / 2 - sc(25), -pen_w / 2),
        rotate(pen_len / 2, 0),
        rotate(pen_len / 2 - sc(25), pen_w / 2),
    ]
    d.polygon(tip_pts, fill=(60, 60, 60))

    # Eraser (pink-ish at the back)
    eraser_pts = [
        rotate(-pen_len / 2 + sc(20), -pen_w / 2),
        rotate(-pen_len / 2, -pen_w / 2),
        rotate(-pen_len / 2, pen_w / 2),
        rotate(-pen_len / 2 + sc(20), pen_w / 2),
    ]
    d.polygon(eraser_pts, fill=(240, 90, 100))

    # Pencil tip black point
    tip_point = rotate(pen_len / 2 - sc(5), 0)
    d.ellipse((tip_point[0] - sc(4), tip_point[1] - sc(4),
               tip_point[0] + sc(4), tip_point[1] + sc(4)),
              fill=(20, 20, 20))

    return img


def main():
    sizes = [(1024, "liff-icon.png"),
             (512, "liff-icon-512.png"),
             (192, "liff-icon-192.png")]
    for s, name in sizes:
        img = make_liff_icon(s)
        path = os.path.join(OUT_DIR, name)
        img.save(path, "PNG", optimize=True)
        kb = os.path.getsize(path) / 1024
        print(f"✓ {name}  ({s}×{s})  {kb:.1f} KB")
    print(f"\nไฟล์ทั้งหมดอยู่ใน:\n  {OUT_DIR}")


if __name__ == "__main__":
    main()
