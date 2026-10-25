'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const KB=require('../Web/core.js');
globalThis.KB=KB;
const Recognition=require('../Web/recognition.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<2e-6,`${a} ≠ ${b}`);

function splitFixture(){
  const left=[],right=[];
  for(let col=0;col<4;col++)for(let row=0;row<3;row++){
    const x=1+col*1.35,y=1+row*1.3-col*.18,noise=((col+row)%3-1)*.025;
    left.push(KB.key({label:`L${col}-${row}`,x:x+noise,y:y-noise,angle:9+noise*10,confidence:.82}));
    right.push(KB.key({label:`R${col}-${row}`,x:14-x+noise+.1,y:y+noise+.14,angle:-9+noise*10,color:'#234534',confidence:.91}));
  }
  return {left,right,keys:[...left,...right]};
}
function assertPaired(result,left,right){
  assert.ok(result.symmetry);
  for(let i=0;i<left.length;i++){
    const a=result.keys.find(k=>k.id===left[i].id),b=result.keys.find(k=>k.id===right[i].id);
    near(a.x+b.x,2*result.symmetry.axis);assert.equal(a.y,b.y);near(a.angle,-b.angle);
    near(a.y,(left[i].y+right[i].y)/2);
    for(const prop of ['id','label','color','w','h','confidence']){
      assert.equal(a[prop],left[i][prop]);assert.equal(b[prop],right[i][prop]);
    }
  }
}

test('识别分体：对应键自动处于同一水平线，列错位与各自文字颜色保留',()=>{
  const {left,right,keys}=splitFixture(),before=JSON.stringify(keys);
  const result=Recognition.alignSplit(keys);
  assert.equal(result.symmetry.pairCount,12);assert.equal(result.symmetry.unmatched,0);
  assertPaired(result,left,right);
  near(result.keys[3].y-result.keys[0].y,-.18);
  assert.equal(JSON.stringify(keys),before);
  assert.deepEqual(Recognition.alignSplit(result.keys).keys,result.keys);
});

test('识别流程默认校正，关闭自动校正保留原位置，不改动识别候选',()=>{
  const {keys}=splitFixture(),pitch=50;
  const boxes=keys.map(k=>({x:k.x*pitch,y:k.y*pitch,w:44,h:44,angle:k.angle,confidence:k.confidence}));
  const words=keys.map((k,i)=>({x:boxes[i].x,y:boxes[i].y,label:k.label,confidence:1})),before=JSON.stringify(boxes);
  const automatic=Recognition.toLayout(boxes,words,pitch),raw=Recognition.toLayout(boxes,words,pitch,{splitSymmetry:false});
  assert.equal(automatic.symmetry.pairCount,12);assert.equal(raw.symmetry,null);
  const l=automatic.keys.find(k=>k.label==='L2-1'),r=automatic.keys.find(k=>k.label==='R2-1');
  assert.equal(l.y,r.y);near(l.x+r.x,2*automatic.symmetry.axis);
  assert.notEqual(raw.keys.find(k=>k.label==='L2-1').y,raw.keys.find(k=>k.label==='R2-1').y);
  assert.equal(automatic.pitch,pitch);assert.equal(automatic.originX,raw.originX);assert.equal(automatic.originY,raw.originY);
  assert.equal(JSON.stringify(boxes),before);
});

test('真实 Vision 回归：相邻轮廓角度误差经邻键共识修正，42键仍能配成21对',()=>{
  const fixture=require('./fixtures/split-vision-candidates.json'),pitch=50;
  const boxes=fixture.centers.map(([x,y,angle])=>({x:x*pitch,y:y*pitch,w:44,h:44,angle,confidence:.9}));
  const result=Recognition.toLayout(boxes,[],pitch),raw=Recognition.toLayout(boxes,[],pitch,{splitSymmetry:false});
  assert.equal(result.keys.length,42);assert.equal(result.symmetry.pairCount,21);assert.equal(result.symmetry.unmatched,0);
  const axis=result.symmetry.axis,left=result.keys.filter(k=>k.x<axis),right=result.keys.filter(k=>k.x>axis);
  for(const a of left)assert.ok(right.some(b=>Math.abs(a.x+b.x-2*axis)<.000003&&a.y===b.y&&a.angle===-b.angle));
  assert.ok(raw.keys.every(k=>k.angle!==-25&&k.angle!==-24.5));
  assert.ok(result.keys.some(k=>k.angle===42));assert.ok(result.keys.some(k=>k.angle===27));
});

test('单侧漏键仍可识别明确配对，不补造键位，未匹配键与标记保持原样',()=>{
  const {left,right}=splitFixture(),decal=KB.key({x:100,y:100,decal:true,label:'模块示意'});
  const keys=[...left,...right.slice(0,-1),decal],result=Recognition.alignSplit(keys);
  assert.equal(result.symmetry.pairCount,11);assert.equal(result.symmetry.unmatched,1);assert.equal(result.keys.length,keys.length);
  assertPaired(result,left.slice(0,-1),right.slice(0,-1));
  assert.deepEqual(result.keys.find(k=>k.id===left.at(-1).id),left.at(-1));
  assert.deepEqual(result.keys.at(-1),decal);
});

test('普通整键盘、单手键区和主键区加数字区不强制对称',()=>{
  const full=[];for(let row=0;row<4;row++)for(let col=0;col<12;col++)full.push(KB.key({x:col,y:row}));
  const hand=splitFixture().left;
  const withPad=full.concat(Array.from({length:9},(_,i)=>KB.key({x:15+i%3,y:Math.floor(i/3)})));
  for(const keys of [full,hand,withPad]){
    const before=JSON.stringify(keys),result=Recognition.alignSplit(keys);
    assert.equal(result.symmetry,null);assert.equal(JSON.stringify(result.keys),before);
  }
});

test('左右数量或列布局明显不对称时保留原识别结果',()=>{
  const {left,right}=splitFixture();
  for(const keys of [left.concat(right.slice(0,6)),left.concat(right.map((k,i)=>i<3?{...k,y:k.y+.65}:k)),left.concat(right.map((k,i)=>i<3?{...k,w:1.5}:k))]){
    const before=JSON.stringify(keys),result=Recognition.alignSplit(keys);
    assert.equal(result.symmetry,null);assert.equal(JSON.stringify(result.keys),before);
  }
});

test('配对歧义不足以支持整侧对称时不自动修改',()=>{
  const {left,right}=splitFixture(),target=right[0];
  const keys=left.concat(right.slice(1),[{...target,y:target.y-.1},KB.key({...target,id:'ambiguous',y:target.y+.1})]);
  const before=JSON.stringify(keys),result=Recognition.alignSplit(keys);
  assert.equal(result.symmetry,null);assert.equal(JSON.stringify(result.keys),before);
});

test('镜像的长拇指键与正负45°方键可识别，角度互为相反数',()=>{
  const {left,right}=splitFixture();
  left.push(KB.key({x:5.6,y:6,w:1.5,angle:30,label:'L-thumb'}),KB.key({x:4.1,y:7.8,angle:45,label:'L-square'}));
  right.push(KB.key({x:8.5,y:6.14,w:1.5,angle:-28,label:'R-thumb'}),KB.key({x:10,y:7.94,angle:45,label:'R-square'}));
  const result=Recognition.alignSplit(left.concat(right));
  assert.equal(result.symmetry.pairCount,14);assertPaired(result,left,right);
  assert.equal(result.keys.find(k=>k.label==='L-thumb').angle,29);
  assert.equal(result.keys.find(k=>k.label==='L-square').angle,45);
});

test('自动校正若挤到未匹配按键则整次保留原结果',()=>{
  const {left,right}=splitFixture();
  const keys=left.concat(right.map(k=>({...k,y:k.y+.36})),KB.key({x:left[2].x,y:left[2].y+1.18})),before=JSON.stringify(keys);
  assert.equal(Recognition.alignSplit(keys).symmetry,null);
  assert.equal(JSON.stringify(keys),before);
});

test('识别结果附带每键截图区域，供逐键读取键帽文字',()=>{
  const pitch=50,boxes=[[1,1,0],[2.1,1,0],[3.2,1.1,8],[1,2.2,-12]].map(([x,y,angle])=>({x:x*pitch,y:y*pitch,w:44,h:40,angle,confidence:.9}));
  const result=Recognition.toLayout(boxes,[],pitch,{splitSymmetry:false});
  assert.equal(result.regions.length,4);
  assert.deepEqual(new Set(result.regions.map(r=>r.id)),new Set(result.keys.map(k=>k.id)));
  for(const [i,box] of boxes.entries()){
    const region=result.regions[i],key=result.keys.find(k=>k.id===region.id);
    assert.deepEqual([region.x,region.y,region.w,region.h],[box.x,box.y,box.w,box.h]);
    assert.equal(region.angle,box.angle);near(key.x*pitch+result.originX,box.x);near(key.y*pitch+result.originY,box.y);
  }
});

test('识别出的数字键帽保留原文字，只有未识别的键按排序编号',()=>{
  const pitch=50,boxes=[0,1,2,3].map(i=>({x:(1+i*1.1)*pitch,y:pitch,w:44,h:44,angle:0,confidence:.9}));
  const words=[{x:boxes[0].x,y:boxes[0].y,label:'7',confidence:1},{x:boxes[2].x,y:boxes[2].y,label:'Ctrl',confidence:1}];
  const result=Recognition.toLayout(boxes,words,pitch,{splitSymmetry:false});
  assert.deepEqual(result.keys.map(k=>k.label),['7','2','Ctrl','4']);
  assert.deepEqual(result.keys.map(k=>k.labelSource),['recognized','placeholder','recognized','placeholder']);
});

test('识别后的 KLE 和定位板轴孔保持对应键水平与镜像几何',()=>{
  const {keys}=splitFixture(),result=Recognition.alignSplit(keys);
  const restored=KB.parseKLE(KB.exportKLE(result.keys,'自动分体识别')).keys;
  const plate=KB.plate(restored,{outline:'split'});
  assert.equal(plate.count,24);assert.equal(plate.outlines.length,2);assert.deepEqual(plate.errors,[]);
  const points=plate.polygons.flatMap(p=>p.points),axis=result.symmetry.axis*19.05;
  for(const p of points)assert.ok(points.some(q=>Math.hypot(q.x-(2*axis-p.x),q.y-p.y)<.0001));
  assert.ok(KB.dxf(plate).includes('LWPOLYLINE'));
});
