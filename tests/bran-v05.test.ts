import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rig, apply, type DbSkeleton, type DbAtlas } from '../src/ui/arena/rig';
const dir='public/art/v17/rigs/bran-v05/';
const rig=new Rig(JSON.parse(readFileSync(dir+'bran_ske.json','utf8')) as DbSkeleton,JSON.parse(readFileSync(dir+'bran_tex.json','utf8')) as DbAtlas);
function bounds(clip:string,t:number){
 const pts=rig.pose(clip,t).flatMap(p=>[p.x0,p.x0+p.w].flatMap(x=>[p.y0,p.y0+p.h].map(y=>apply(p.m,x,y))));
 return {left:Math.min(...pts.map(p=>p[0])),right:Math.max(...pts.map(p=>p[0])),top:Math.min(...pts.map(p=>p[1])),bottom:Math.max(...pts.map(p=>p[1]))};
}
describe('Bran v0.5 delivery',()=>{
 it('has visible articulated chains for both arms and legs',()=>{
  const parents=new Map(rig.armature.bone.map(b=>[b.name,b.parent]));
  for(const side of ['back','front']){expect(parents.get('shin_'+side)).toBe('thigh_'+side);expect(parents.get('foot_'+side)).toBe('shin_'+side);}
  for(const side of ['sword','shield']){expect(parents.get('forearm_'+side)).toBe('upper_'+side);expect(parents.get('hand_'+side)).toBe('forearm_'+side);}
  expect(rig.armature.bone.filter(b=>!b.parent).map(b=>b.name)).toEqual(['root']);
 });
 it('contains all half-frame poses above the floor and separates resting bounds',()=>{
  for(const clip of rig.animations()) for(let f=0;f<=Math.round(rig.info(clip)!.duration*48);f++){
   const b=bounds(clip,f/48);expect(b.bottom,`${clip}:${f}`).toBeLessThanOrEqual(2);expect(b.left).toBeGreaterThanOrEqual(rig.aabb.x);expect(b.right).toBeLessThanOrEqual(rig.aabb.x+rig.aabb.width);expect(b.top).toBeGreaterThanOrEqual(rig.aabb.y);
  }
  expect(rig.aabb.y+rig.aabb.height).toBe(0);expect(bounds('idle',0).bottom).toBeCloseTo(0);
  expect(rig.layoutAabb.width).toBeLessThan(rig.aabb.width/2);expect(rig.layoutAabb.height).toBe(-Math.floor(bounds('idle',0).top));
 });
 it('ends death horizontal and grounded with both knees bent',()=>{
  const b=bounds('death',1),rest=bounds('idle',0);expect(b.right-b.left).toBeGreaterThan((b.bottom-b.top)*2);expect(b.bottom-b.top).toBeLessThan((rest.bottom-rest.top)/2);expect(Math.abs(b.bottom)).toBeLessThanOrEqual(3);
  const death=rig.armature.animation!.find(a=>a.name==='death')!;
  for(const side of ['back','front'])expect(Math.abs(death.bone!.find(b=>b.name==='shin_'+side)!.rotateFrame!.at(-1)!.rotate!)).toBeGreaterThanOrEqual(20);
 });
 it('shows a visible hit and preserves impact timing and six clips',()=>{
  const i=rig.armature.slot.findIndex(s=>s.name==='head'),idle=rig.pose('idle',0)[i]!,hit=rig.pose('hit',2/24)[i]!;
  expect(Math.hypot(hit.m[4]-idle.m[4],hit.m[5]-idle.m[5])).toBeGreaterThan(70);
  for(const [clip,f] of [['attack',10],['cast',7]] as const)expect(rig.info(clip)!.events).toEqual([{name:'impact',time:f/24}]);
  expect(rig.info('idle')!.loop).toBe(true);expect(rig.animations()).toHaveLength(6);
 });
});
