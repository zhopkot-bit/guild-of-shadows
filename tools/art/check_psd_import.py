"""Run in GIMP 3 Python console from repo root; checks layer order and re-export.
 gimp-console-3.0 -n -i -d -f -s --batch-interpreter=python-fu-eval \
   -b 'exec(open("tools/art/check_psd_import.py").read())' --quit
"""
import json
from pathlib import Path
from gi.repository import Gimp, Gio
root=Path.cwd();out=root/'qa-out/psd-import';out.mkdir(parents=True,exist_ok=True)
arm=json.loads((root/'public/art/v17/rigs/bran-v05/bran_ske.json').read_text())['armature'][0]
expected={'bran':list(reversed([s['name'] for s in arm['slot']])),'crypt':['front','floor','mid','far']};rows=[]
for name,order in expected.items():
 p=root/f'art-sources/{name}-v05/{name}_layers.psd'
 image=Gimp.file_load(Gimp.RunMode.NONINTERACTIVE,Gio.File.new_for_path(str(p)))
 names=[layer.get_name() for layer in image.get_layers()];assert names==order,(name,names)
 proc=Gimp.get_pdb().lookup_procedure('file-png-export');config=proc.create_config()
 config.set_property('run-mode',Gimp.RunMode.NONINTERACTIVE);config.set_property('image',image);config.set_property('file',Gio.File.new_for_path(str(out/f'{name}.png')))
 assert proc.run(config).index(0)==Gimp.PDBStatusType.SUCCESS
 rows.append(dict(file=str(p.relative_to(root)),width=image.get_width(),height=image.get_height(),layersTopToBottom=names));image.delete()
(out/'report.json').write_text(json.dumps(dict(ok=True,application='GIMP 3',rows=rows),indent=2)+'\n')
print('PASS: PSD layer order and projection export')
