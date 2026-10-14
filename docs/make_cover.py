# Builds docs/cover.png for the README: a frame from the Blender shot, the wordmark, and one line.
#   python docs/make_cover.py <blender frame png> <VT323-Regular.ttf>
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
frame, font_path = sys.argv[1], sys.argv[2]
W, H = 1760, 880
bg = Image.open(frame).convert("RGB").resize((W, int(W * 270 / 480)), Image.NEAREST).crop((0, 60, W, 60 + H))
# darken the left so the words read, keep the lit window on the right
shade = Image.new("L", (W, H))
d = ImageDraw.Draw(shade)
for x in range(W):
    d.line([(x, 0), (x, H)], fill=int(215 * max(0.0, 1 - x / (W * 0.72))))
bg = Image.composite(Image.new("RGB", (W, H), (5, 7, 10)), bg, shade)
# scanlines
sl = Image.new("L", (W, H))
sd = ImageDraw.Draw(sl)
for y in range(0, H, 4):
    sd.line([(0, y), (W, y)], fill=60)
bg = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), bg, sl)
dr = ImageDraw.Draw(bg)
big, mid, small = ImageFont.truetype(font_path, 230), ImageFont.truetype(font_path, 92), ImageFont.truetype(font_path, 52)
for col, dx in (((200, 70, 59), -7), ((90, 170, 200), 7), ((240, 238, 228), 0)):
    dr.text((90 + dx, 150), "LAST", font=big, fill=col)
    dr.text((90 + dx, 355), "SEEN", font=big, fill=col)
dr.text((90 + dr.textlength("SEEN", font=big) + 24, 400), "IMD", font=mid, fill=(233, 211, 124))
dr.text((96, 620), "See what happened to your wallet.", font=small, fill=(233, 211, 124))
dr.text((96, 690), "28 EVM CHAINS + SOLANA  ·  VERDICTS SIGNED BY THE IMD SWARM", font=ImageFont.truetype(font_path, 36), fill=(150, 156, 147))
dr.text((W - 330, 40), "● REC", font=ImageFont.truetype(font_path, 44), fill=(255, 91, 77))
bg.save(os.path.join(HERE, "cover.png"), optimize=True)
print("cover written", bg.size)
