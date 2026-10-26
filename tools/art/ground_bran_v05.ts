/** Bake authored transforms above the floor using the game's actual evaluator. */
import { readFileSync, writeFileSync } from 'node:fs';
import { Rig, apply, sampleTimeline, type DbSkeleton, type DbAtlas } from '../../src/ui/arena/rig';
const dir = 'public/art/v17/rigs/bran-v05/';
const ske = JSON.parse(readFileSync(dir + 'bran_ske.json', 'utf8')) as DbSkeleton;
const atlas = JSON.parse(readFileSync(dir + 'bran_tex.json', 'utf8')) as DbAtlas;
const arm = ske.armature[0]!;
const original = new Rig(structuredClone(ske), atlas);
function bounds(rig: Rig, clip: string, t: number) {
 const pts = rig.pose(clip, t).flatMap(p => [p.x0,p.x0+p.w].flatMap(x => [p.y0,p.y0+p.h].map(y => apply(p.m,x,y))));
 return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
}
for (const a of arm.animation ?? []) {
 const tracks = a.bone ?? (a.bone=[]);
 let root = tracks.find(b=>b.name==='root');
 if (!root) { root={name:'root'};tracks.push(root); }
 const authored = root.translateFrame;
 root.translateFrame=Array.from({length:a.duration!+1},(_,f)=>{
  const [x,y]=sampleTimeline(authored,f,k=>[k.x??0,k.y??0],(a,b,t)=>[a[0]!+(b[0]!-a[0]!)*t,a[1]!+(b[1]!-a[1]!)*t],[0,0]);
  const bottom=bounds(original,a.name,f/24)[3]!;
  return {duration:f===a.duration?0:1,tweenEasing:0,x,y:y!-(bottom>0.05?bottom+2:0)};
 });
}
const rig=new Rig(ske,atlas);let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
for(const name of rig.animations()) for(let f=0;f<=Math.round(rig.info(name)!.duration*48);f++) {
 const b=bounds(rig,name,f/48);x0=Math.min(x0,b[0]!);y0=Math.min(y0,b[1]!);x1=Math.max(x1,b[2]!);y1=Math.max(y1,b[3]!);
}
if(y1>2)throw new Error(`Pose below floor: ${y1}`);
arm.aabb={x:Math.floor(x0)-4,y:Math.floor(y0)-4,width:Math.ceil(x1)-Math.floor(x0)+8,height:-Math.floor(y0)+4};
const rest=bounds(rig,'idle',0);
arm.layoutAabb={x:Math.floor(rest[0]!),y:Math.floor(rest[1]!),width:Math.ceil(rest[2]!)-Math.floor(rest[0]!),height:-Math.floor(rest[1]!)};
writeFileSync(dir+'bran_ske.json',JSON.stringify(ske,null,2)+'\n');
console.log({aabb:arm.aabb,layoutAabb:arm.layoutAabb,maxFloorCrossing:y1});
