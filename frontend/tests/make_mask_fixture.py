from pathlib import Path
import sys
import subprocess
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.video_utils import FFMPEG
out = Path(__file__).parent / 'output'
out.mkdir(exist_ok=True)
video = subprocess.Popen([FFMPEG, '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '320x180', '-r', '20', '-i', '-', '-an', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', str(out / 'mask-fixture.mp4')], stdin=subprocess.PIPE)
for i in range(60):
    frame = np.full((180, 320, 3), (35, 40, 48), np.uint8)
    x = 110 + i
    frame[50:120, x:x+55] = (40, 55, 230)
    for y in range(55, 115, 10):
        for dx in range(5, 50, 10):
            cv2.circle(frame, (x+dx, y), 2, (225, 225, 225), -1)
    video.stdin.write(frame.tobytes())
video.stdin.close()
if video.wait(): raise RuntimeError('fixture encode failed')
print(out / 'mask-fixture.mp4')
