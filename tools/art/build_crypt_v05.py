"""Encode independently generated crypt layers. Preserve original PNG sources."""
from pathlib import Path
from PIL import Image
import json
src=Path('art-sources/crypt-v05');out=Path('public/art/v17/arenas/crypt-v05');out.mkdir(parents=True,exist_ok=True)
for name in ['far','mid','floor','front']:
 im=Image.open(src/f'{name}.png').resize((1920,1080),Image.Resampling.LANCZOS)
 im.save(out/f'crypt_{name}.webp',quality=90,method=6)
 assert (out/f'crypt_{name}.webp').stat().st_size<=450*1024
front=Image.open(out/'crypt_front.webp').getchannel('A');floor=Image.open(out/'crypt_floor.webp').getchannel('A')
assert front.crop((60,0,1860,1080)).getextrema()[1]<=8,'Foreground exceeds edge safe zone'
assert floor.crop((0,0,1920,620)).getextrema()[1]<=8,'Floor leaks into upper region'
# Measured regenerated-source candle centres, normalized to export coordinates.
lights=[dict(x=x/1672*1920,y=y/941*1080) for x,y in [(34,641),(760,646),(1582,561)]]
(src/'lights.json').write_text(json.dumps(lights,indent=2)+'\n')
print('PASS: four layers, texture budgets and alpha safe zones')
