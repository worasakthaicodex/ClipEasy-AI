"""Compare the real Chromium canvas with the encoder's mask compositor.

Run after mask-ui.cjs; inputs come from the same decoded browser source frame.
Rasterizers differ slightly at feathered polygon boundaries, so use MAE < 2/255.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.mask_fx import render_mask_frame

output = Path(__file__).parent / "output"
source = cv2.imread(str(output / "mask-preview-source.png"))
preview = cv2.imread(str(output / "mask-preview.png"))
state = json.loads((output / "mask-preview-state.json").read_text())
encoded = render_mask_frame(source, state["transform"], state["sourceTime"], state["localTime"])
error = np.abs(encoded.astype(np.float32) - preview.astype(np.float32))
mae = float(error.mean())
result = {"passed": mae < 2, "mean_absolute_channel_error": mae, "tolerance": 2}
(output / "mask-preview-parity.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result))
assert result["passed"], result
