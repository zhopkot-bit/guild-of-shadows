"""Package the regenerated approved-concept cutouts as DragonBones 5.5.
Only region extraction, encoding and authored transforms; no painting.
Run this, then ground_bran_v05.ts before exporting or validating.
"""
import json
from pathlib import Path
from PIL import Image
src=Path('art-sources/bran-v05'); out=Path('public/art/v17/rigs/bran-v05');out.mkdir(parents=True,exist_ok=True)
im=Image.open(src/'cutout-atlas.png').convert('RGBA');im.save(out/'bran_tex.webp',quality=90,method=6)
names=['head','collar','chest','belt','tasset_back','tasset_front','upper_sword','forearm_sword','hand_sword','upper_shield','forearm_shield','hand_shield','thigh_back','shin_back','foot_back','thigh_front','shin_front','foot_front','sword','shield','cape_upper','cape_lower','hair','scarf_tail']
# Measured gutters in the generated atlas; do not clip parts to an ideal grid.
regions=[(25,5,240,260),(255,65,475,252),(477,0,759,265),(768,60,1027,255),(1070,0,1275,272),(1310,0,1518,275),
 (25,261,240,488),(270,265,480,485),(540,274,710,488),(782,265,1017,492),(1064,275,1258,483),(1334,280,1507,490),
 (40,494,206,735),(310,502,445,688),(540,635,705,740),(818,500,1009,738),(1080,500,1220,690),(1338,635,1482,737),
 (76,740,175,1020),(267,740,455,1018),(480,750,770,1020),(800,742,1026,1020),(1080,800,1274,962),(1300,750,1518,1020)]
subs=[]
for name,region in zip(names,regions):
 cell=im.crop(region);b=cell.getchannel('A').point(lambda a:255 if a>20 else 0).getbbox();assert b,name
 x0=max(region[0],region[0]+b[0]-2);y0=max(region[1],region[1]+b[1]-2)
 x1=min(region[2],region[0]+b[2]+2);y1=min(region[3],region[1]+b[3]+2)
 subs.append(dict(name=name,x=x0,y=y0,width=x1-x0,height=y1-y0))
atlas=dict(imagePath='bran_tex.webp',width=im.width,height=im.height,SubTexture=subs); lookup={s['name']:s for s in subs}
bones=[dict(name='root')];slots=[];skin=[]
def bone(name,parent,x=0,y=0):bones.append(dict(name=name,parent=parent,transform=dict(x=x,y=y)))
def part(name,parent,x,y,w,h):
 s=lookup[name];slots.append(dict(name=name,parent=parent));skin.append(dict(name=name,display=[dict(name=name,type='image',transform=dict(x=x,y=y,scX=w/s['width'],scY=h/s['height']))]))
bone('pelvis','root',0,-780);bone('torso','pelvis',0,-240);bone('neck','torso',0,-220);bone('head','neck',0,-110)
for side,x in [('back',-100),('front',105)]:
 bone('thigh_'+side,'pelvis',x,40);bone('shin_'+side,'thigh_'+side,0,280);bone('foot_'+side,'shin_'+side,0,270)
for side,x in [('sword',-205),('shield',205)]:
 bone('upper_'+side,'torso',x,-155);bone('forearm_'+side,'upper_'+side,-20 if side=='sword' else 20,190);bone('hand_'+side,'forearm_'+side,0,170)
bone('sword','hand_sword',-5,45);bone('shield','hand_shield',25,-20)
bone('tasset_back','pelvis',-90,20);bone('tasset_front','pelvis',80,20)
bone('cape_upper','torso',-25,-140);bone('cape_lower','cape_upper',0,260);bone('scarf_tail','neck',-80,40)
part('cape_upper','cape_upper',0,120,400,310);part('cape_lower','cape_lower',0,120,340,350)
for side in ['back','front']:
 part('thigh_'+side,'thigh_'+side,0,140,190,320);part('shin_'+side,'shin_'+side,0,150,170,320);part('foot_'+side,'foot_'+side,-15,110,190,160)
for side in ['shield','sword']:
 part('upper_'+side,'upper_'+side,0,80,230,270);part('forearm_'+side,'forearm_'+side,0,80,135,210);part('hand_'+side,'hand_'+side,0,30,105,120)
part('chest','torso',0,-20,450,420);part('belt','pelvis',0,0,370,150)
part('tasset_back','tasset_back',0,180,180,440);part('tasset_front','tasset_front',0,180,180,440)
part('head','head',0,-30,200,270);part('collar','neck',0,30,290,170);part('scarf_tail','scarf_tail',-70,80,190,150)
part('sword','sword',0,335,150,790);part('shield','shield',30,-20,360,650)
def track(name,points,field='rotateFrame'):
 frames=[]
 for i,(frame,value) in enumerate(points):
  f=dict(duration=points[i+1][0]-frame if i+1<len(points) else 0,tweenEasing=0)
  if field=='rotateFrame':f['rotate']=value
  else:f.update(x=value[0],y=value[1])
  frames.append(f)
 return dict(name=name,**{field:frames})
def animation(name,duration,tracks,impact=None):
 a=dict(name=name,duration=duration,playTimes=0 if name=='idle' else 1,bone=tracks)
 if impact is not None:a['frame']=[dict(duration=impact),dict(duration=duration-impact,events=[dict(name='impact')])]
 return a
anims=[
 animation('idle',48,[track('torso',[(0,(0,0)),(24,(0,-5)),(48,(0,0))],'translateFrame'),track('head',[(0,0),(24,1),(48,0)]),track('cape_lower',[(0,0),(24,3),(48,0)]),track('scarf_tail',[(0,0),(24,-4),(48,0)])]),
 animation('attack',20,[track('upper_sword',[(0,0),(6,8),(10,-85),(13,-70),(20,0)]),track('forearm_sword',[(0,0),(6,-12),(10,-15),(20,0)]),track('hand_sword',[(0,0),(6,0),(10,-15),(20,0)]),track('torso',[(0,0),(6,-5),(10,7),(20,0)]),track('shin_front',[(0,0),(6,-9),(10,-4),(20,0)]),track('thigh_front',[(0,0),(6,5),(10,2),(20,0)])],10),
 animation('cast',18,[track('upper_shield',[(0,0),(7,-35),(11,-35),(18,0)]),track('forearm_shield',[(0,0),(7,55),(11,55),(18,0)]),track('hand_shield',[(0,0),(7,-18),(18,0)]),track('torso',[(0,0),(7,-5),(18,0)]),track('head',[(0,0),(7,6),(18,0)])],7),
 animation('hit',9,[track('torso',[(0,0),(2,-15),(5,-9),(9,0)]),track('head',[(0,0),(2,-12),(5,-5),(9,0)]),track('upper_shield',[(0,0),(2,15),(9,0)]),track('thigh_front',[(0,0),(2,8),(9,0)]),track('shin_front',[(0,0),(2,-16),(9,0)]),track('root',[(0,(0,0)),(2,(-45,-8)),(5,(-20,-4)),(9,(0,0))],'translateFrame')]),
 animation('death',24,[track('root',[(0,0),(6,12),(14,50),(20,84),(24,90)]),track('root',[(0,(0,0)),(6,(-20,-20)),(14,(-90,-100)),(20,(-140,-190)),(24,(-150,-220))],'translateFrame'),track('thigh_front',[(0,0),(6,24),(14,40),(24,25)]),track('shin_front',[(0,0),(6,-48),(14,-65),(24,-45)]),track('foot_front',[(0,0),(6,24),(14,25),(24,20)]),track('thigh_back',[(0,0),(6,-8),(14,10),(24,10)]),track('shin_back',[(0,0),(6,-18),(14,-30),(24,-20)]),track('foot_back',[(0,0),(14,18),(24,10)]),track('upper_sword',[(0,0),(6,-10),(14,-45),(24,-70)]),track('forearm_sword',[(0,0),(14,45),(24,70)]),track('upper_shield',[(0,0),(14,45),(24,70)]),track('forearm_shield',[(0,0),(14,-45),(24,-70)]),track('head',[(0,0),(14,10),(24,18)]),track('cape_lower',[(0,0),(14,-20),(24,-40)])]),
 animation('victory',30,[track('upper_sword',[(0,0),(10,-65),(20,-65),(30,0)]),track('forearm_sword',[(0,0),(10,-30),(20,-30),(30,0)]),track('head',[(0,0),(10,-5),(20,-5),(30,0)])])]
for a in anims:
 merged={}
 for tr in a['bone']:merged.setdefault(tr['name'],dict(name=tr['name'])).update(tr)
 a['bone']=list(merged.values())
arm=dict(type='Armature',name='bran',frameRate=24,aabb=dict(x=-550,y=-1550,width=2350,height=1550),bone=bones,slot=slots,skin=[dict(name='default',slot=skin)],animation=anims)
ske=dict(name='bran-v05',version='5.5',compatibleVersion='5.5',frameRate=24,armature=[arm])
for path,data in [(out/'bran_ske.json',ske),(out/'bran_tex.json',atlas),(src/'texture-regions.json',atlas)]:path.write_text(json.dumps(data,indent=2)+'\n')
print('Generated',len(bones),'bones',len(slots),'slots',len(anims),'clips')
