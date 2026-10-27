"""Build local screenshot media from the repository's generated city asset."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
from core.video_utils import FFMPEG

output = root / "_work" / "portfolio" / "city-demo.mp4"
output.parent.mkdir(parents=True, exist_ok=True)
subprocess.run([FFMPEG, "-y", "-v", "error", "-loop", "1", "-i",
    str(root / "frontend/src/assets/ratio-city-blue-hour-v1.png"),
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000", "-t", "60",
    "-vf", "scale=1280:720", "-r", "25", "-c:v", "libx264", "-preset", "ultrafast",
    "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-af", "volume=0.12",
    "-shortest", str(output)], check=True)
served = root / "frontend/tests/output/city-demo.mp4"
served.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(output, served)
print(output)
