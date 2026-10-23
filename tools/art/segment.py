import sys
from PIL import Image
from rembg import remove, new_session
import numpy as np
src, box, out, model = sys.argv[1], tuple(map(int, sys.argv[2].split(','))), sys.argv[3], (sys.argv[4] if len(sys.argv)>4 else 'isnet-general-use')
im = Image.open(src).convert('RGB').crop(box)
sess = new_session(model)
res = remove(im, session=sess, alpha_matting=True, alpha_matting_foreground_threshold=235, alpha_matting_background_threshold=20, alpha_matting_erode_size=6)
a = np.array(res)
ys, xs = np.where(a[:,:,3] > 12)
res = res.crop((max(0,xs.min()-4), max(0,ys.min()-4), min(a.shape[1],xs.max()+5), min(a.shape[0],ys.max()+5)))
res.save(out)
print(out, res.size)
