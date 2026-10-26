"""Export editable bind-pose PSD/ORA and crypt layers; no painting.
Requires Pillow + ImageMagick. PSD input order is bottom-to-top, ORA top-to-bottom.
"""
from pathlib import Path
import io,json,zipfile,subprocess,tempfile,xml.etree.ElementTree as ET
from PIL import Image

def export(src,name,size,layers):
 merged=Image.new('RGBA',size)
 for _,layer in layers:merged.alpha_composite(layer)
 root=ET.Element('image',{'w':str(size[0]),'h':str(size[1]),'name':name,'version':'0.0.3'});stack=ET.SubElement(root,'stack')
 with zipfile.ZipFile(src/f'{name}_layers.ora','w') as z:
  z.writestr('mimetype','image/openraster',compress_type=zipfile.ZIP_STORED)
  for i,(label,layer) in enumerate(reversed(layers)):
   b=io.BytesIO();layer.save(b,format='PNG');path=f'data/{i:02d}-{label}.png';z.writestr(path,b.getvalue())
   ET.SubElement(stack,'layer',{'name':label,'src':path,'x':'0','y':'0','opacity':'1.0','visibility':'visible','composite-op':'svg:src-over'})
  b=io.BytesIO();merged.save(b,format='PNG');z.writestr('mergedimage.png',b.getvalue());z.writestr('stack.xml',ET.tostring(root))
 with tempfile.TemporaryDirectory(prefix='bran-source-') as d:
  work=Path(d);merged.save(work/'merged.png');cmd=['convert',str(work/'merged.png')]
  for i,(label,layer) in enumerate(layers):
   p=work/f'{i:02d}-{label}.png';layer.save(p);cmd+=['(',str(p),'-set','label',label,')']
  subprocess.run(cmd+['-colorspace','sRGB',str(src/f'{name}_layers.psd')],check=True)
 print(name,len(layers),'layers',size)

src=Path('art-sources/bran-v05');out=Path('public/art/v17/rigs/bran-v05')
arm=json.loads((out/'bran_ske.json').read_text())['armature'][0];atlas=json.loads((out/'bran_tex.json').read_text());subs={s['name']:s for s in atlas['SubTexture']}
im=Image.open(src/'cutout-atlas.png').convert('RGBA');world={};layers=[]
for b in arm['bone']:
 parent=world.get(b.get('parent'),(0,0));t=b.get('transform',{});world[b['name']]=(parent[0]+t.get('x',0),parent[1]+t.get('y',0))
for slot,skin in zip(arm['slot'],arm['skin'][0]['slot']):
 d=skin['display'][0];s=subs[d['name']];t=d['transform'];bone=world[slot['parent']]
 size=round(s['width']*t['scX']),round(s['height']*t['scY'])
 layer=im.crop((s['x'],s['y'],s['x']+s['width'],s['y']+s['height'])).resize(size,Image.Resampling.LANCZOS)
 x=round(550+bone[0]+t['x']-size[0]/2);y=round(1550+bone[1]+t['y']-size[1]/2)
 canvas=Image.new('RGBA',(1200,1600));canvas.alpha_composite(layer,(x,y));layers.append((slot['name'],canvas))
export(src,'bran',(1200,1600),layers)
src=Path('art-sources/crypt-v05');size=Image.open(src/'far.png').size
export(src,'crypt',size,[(n,Image.open(src/f'{n}.png').convert('RGBA').resize(size,Image.Resampling.LANCZOS)) for n in ['far','mid','floor','front']])
