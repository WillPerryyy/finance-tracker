"""Generate brand-matched icon for Finance Tracker.
Brand: navy #1E2A3A background, #2563EB blue accent bar, white FT text.
Run: python scripts/gen_icon.py
"""
from PIL import Image, ImageDraw, ImageFont

NAV    = (30,  42,  58)     # #1E2A3A
ACCENT = (37,  99,  235)    # #2563EB
WHITE  = (255, 255, 255)


def make_icon(size: int) -> Image.Image:
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    r = max(4, int(size * 0.18))

    # Navy rounded-rect background
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=NAV)

    # Blue accent stripe at the bottom (~10 % of height)
    bar_h = max(3, int(size * 0.10))
    # Draw with rounded rect first (inherits bottom corners), then square off top
    draw.rounded_rectangle([0, size - bar_h, size - 1, size - 1], radius=r, fill=ACCENT)
    draw.rectangle([0, size - bar_h, size - 1, size - bar_h + 2], fill=ACCENT)

    # "FT" text — bold, centred, shifted up slightly to account for the bar
    fs = max(8, int(size * 0.52))
    font = None
    for face in [
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]:
        try:
            font = ImageFont.truetype(face, fs)
            break
        except OSError:
            pass
    if font is None:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "FT", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = (size - th) / 2 - bbox[1] - bar_h * 0.5   # nudge up to centre in non-bar area
    draw.text((tx, ty), "FT", font=font, fill=WHITE)

    return img


sizes = [256, 128, 64, 48, 32, 24, 16]   # 256 must be first — electron-builder checks primary frame
frames = [make_icon(s) for s in sizes]

from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
out_ico = str(ASSETS / "icon.ico")
out_png = str(ASSETS / "icon.png")

frames[0].save(out_png)   # 256px PNG
frames[0].save(
    out_ico,
    format="ICO",
    append_images=frames[1:],
    sizes=[(s, s) for s in sizes],
)
print(f"Wrote {out_ico}  (primary 256px + {len(sizes)-1} smaller sizes)")
print(f"Wrote {out_png}")
