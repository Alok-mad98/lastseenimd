# LastSeenIMD logo. Pixel art drawn on a small grid and scaled up with hard edges, so it matches the game look.
# The mark: a lit window at night with someone standing in it. Writes logo-icon.png (square) and logo.png (icon + wordmark).
import os, urllib.request
from PIL import Image, ImageDraw, ImageFont, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
NIGHT, WALL, FRAME, LAMP, GLOW, FIG, RED, CYAN = (7, 9, 12), (18, 23, 29), (38, 46, 54), (233, 211, 124), (255, 236, 170), (6, 7, 9), (200, 70, 59), (90, 170, 200)

G = 32
ic = Image.new("RGB", (G, G), NIGHT)
d = ImageDraw.Draw(ic)
# the wall of the house, with a pitched roof line cutting the top corners
d.rectangle([3, 7, 28, 31], fill=WALL)
for i in range(13):
    d.line([(3 + i, 7 - i // 2 - (1 if i > 0 else 0)), (3 + i, 7)], fill=WALL)
    d.line([(28 - i, 7 - i // 2 - (1 if i > 0 else 0)), (28 - i, 7)], fill=WALL)
# window: frame, light, glazing bars
d.rectangle([8, 10, 23, 26], fill=FRAME)
d.rectangle([9, 11, 22, 25], fill=LAMP)
d.rectangle([10, 12, 21, 16], fill=GLOW)
d.line([(15, 11), (15, 25)], fill=FRAME)
d.line([(16, 11), (16, 25)], fill=FRAME)
d.line([(9, 18), (22, 18)], fill=FRAME)
# the figure: head and shoulders, standing a little off centre
d.rectangle([17, 15, 20, 18], fill=FIG)       # head
d.rectangle([16, 19, 21, 25], fill=FIG)       # shoulders and body
d.point([(18, 16), (20, 16)], fill=LAMP)      # two eyes catching the light
# window sill
d.rectangle([7, 27, 24, 27], fill=FRAME)

S = 1024
big = ic.resize((S, S), Image.NEAREST)
# tape fringe: the bright parts ghost a few pixels red to the left and cyan to the right
mask = big.convert("L").point(lambda v: 255 if v > 150 else 0)
fr = Image.new("RGB", (S, S), NIGHT)
for col, dx in ((RED, -10), (CYAN, 10)):
    layer = Image.new("RGB", (S, S), col)
    m = ImageChops.offset(mask, dx, 0).point(lambda v: 90 if v else 0)
    fr.paste(layer, (0, 0), m)
icon = ImageChops.lighter(big, fr)
# scanlines
sl = Image.new("L", (S, S), 0)
sd = ImageDraw.Draw(sl)
for y in range(0, S, 8):
    sd.rectangle([0, y, S, y + 2], fill=38)
icon = Image.composite(Image.new("RGB", (S, S), (0, 0, 0)), icon, sl)
icon.save(os.path.join(HERE, "logo-icon.png"))

# wordmark, in the same pixel face the app uses (VT323, SIL Open Font License)
font_path = os.path.join(HERE, "VT323-Regular.ttf")
if not os.path.exists(font_path):
    urllib.request.urlretrieve("https://github.com/google/fonts/raw/main/ofl/vt323/VT323-Regular.ttf", font_path)
W, H = 2400, 1024
full = Image.new("RGB", (W, H), NIGHT)
full.paste(icon, (0, 0))
dd = ImageDraw.Draw(full)
f_big, f_small, f_tag = ImageFont.truetype(font_path, 400), ImageFont.truetype(font_path, 150), ImageFont.truetype(font_path, 76)
x = 1090
for col, dx in ((RED, -8), (CYAN, 8), ((240, 238, 228), 0)):
    dd.text((x + dx, 60), "LAST", font=f_big, fill=col)
    dd.text((x + dx, 380), "SEEN", font=f_big, fill=col)
dd.text((x + dd.textlength("SEEN", font=f_big) + 26, 420), "IMD", font=f_small, fill=LAMP)
dd.text((x + 6, 800), "SEE WHAT HAPPENED TO YOUR WALLET", font=f_tag, fill=(138, 144, 135))
full.save(os.path.join(HERE, "logo.png"))
print("logo written")
