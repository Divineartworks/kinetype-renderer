"""ambient-depth.py IN.png OUT.png [model.onnx]: depth map for a living-still source image.

Depth Anything V2 Small (ONNX, Apache-2.0) relative depth, bright = near. Runs on CPU with onnxruntime
(pip install onnxruntime pillow numpy; it runs on another host, not in the kinetype toolchain).
Output is smoothed and saved at half the input size (8-bit). Use the pair as
  kinetype ambient render living-still --images still.png,still.depth.png
model.onnx defaults to ./model.onnx (the Depth Anything V2 Small ONNX export)."""
import sys
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 else "model.onnx"
im = Image.open(src).convert("RGB")
W, H = im.size
h = 518
w = int(round(W / H * h / 14)) * 14
x = np.asarray(im.resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0
x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
x = x.transpose(2, 0, 1)[None]
so = ort.SessionOptions()
so.intra_op_num_threads = 4
sess = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
d = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
d = (d - d.min()) / max(1e-6, d.max() - d.min())
out = Image.fromarray((d * 255).astype(np.uint8)).resize((W // 2, H // 2), Image.BICUBIC)
out = out.filter(ImageFilter.GaussianBlur(2))
out.save(dst)
print(dst, out.size)
