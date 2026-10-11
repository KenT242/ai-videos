#!/usr/bin/env python3
"""Contact sheet of every Nth frame of a video, for reviewing a render_preview.py MP4 with Read.

Usage: uv run -q --no-project --python 3.12 --with imageio-ffmpeg --with pillow \
           python -I video_sheet.py <video.mp4> <sheet.png> [every_n=12] [tile_width=480]
Copy the video out of /mnt/... into a scratch folder first.
"""
import glob, os, subprocess, sys, tempfile

import imageio_ffmpeg
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 12
tw = int(sys.argv[4]) if len(sys.argv) > 4 else 480
ff = imageio_ffmpeg.get_ffmpeg_exe()
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", src, "-vf", f"select='not(mod(n\\,{n}))'",
                    "-vsync", "vfr", os.path.join(tmp, "f%03d.png")], check=True)
    ims = [Image.open(f).convert("RGB") for f in sorted(glob.glob(os.path.join(tmp, "f*.png")))]
th = round(ims[0].height * tw / ims[0].width)
cols = 3
sheet = Image.new("RGB", (tw * cols, th * ((len(ims) + cols - 1) // cols)), "black")
for i, im in enumerate(ims):
    sheet.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
sheet.save(out)
print(f"{len(ims)} frames (every {n}) -> {out}")
