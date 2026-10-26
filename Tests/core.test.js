'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const KB=require('../Web/core.js');
const near=(actual,expected,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} ≠ ${expected}`);
const sample=KB.parseKLE(fs.readFileSync(path.join(__dirname,'../示例/42键-TPS65.kle.json'),'utf8'));

test('邻键吸附：拖近 15 号键上方，6 号键同列对齐，保持 1U 中心距',()=>{
  const moving=KB.key({label:'6',x:2.42,y:1.9}),target=KB.key({label:'15',x:2.3,y:3});
  const snap=KB.snapNeighbors([moving],[moving,target]);
  assert.equal(snap.targetID,target.id);assert.equal(snap.side,'above');assert.equal(snap.axis,'y');
  near(moving.x+snap.dx,target.x);near(moving.y+snap.dy,target.y-1);near(snap.spacing,1);
  near(moving.x,2.42);near(moving.y,1.9);
});

test('旋转键区沿局部方向吸附，不受全局网格或旋转圈数影响',()=>{
  for(const angle of [-720,-10,10,135,370]){
    const target=KB.key({x:3.17,y:4.09,angle}),offset=KB.rotate(0,-1,angle);
    const moving=KB.key({x:target.x+offset.x+.08,y:target.y+offset.y-.06,angle:angle+180});
    const snap=KB.snapNeighbors([moving],[target]);
    assert.ok(snap);near(moving.x+snap.dx,target.x+offset.x);near(moving.y+snap.dy,target.y+offset.y);
    near(moving.angle+snap.angleDelta,target.angle);
  }
});

test('拖近邻键时自动校正角度，超出捕获距离时保持自由移动',()=>{
  const target=KB.key({x:0,y:0,angle:10});
  const moving=KB.key({x:0,y:-1,angle:0}),snap=KB.snapNeighbors([moving],[target]);
  assert.ok(snap);near(moving.angle+snap.angleDelta,target.angle);
  assert.equal(KB.snapNeighbors([KB.key({x:0,y:-2,angle:10})],[target]),null);
  assert.equal(KB.snapNeighbors([KB.key({x:0,y:-1,angle:10})],[target],{threshold:0}),null);
  assert.equal(KB.snapNeighbors([KB.key({x:0,y:-1,angle:0})],[target],{snapAngle:false}),null);
});

test('多选吸附统一角度偏移，保持组内角度差',()=>{
  const target=KB.key({x:0,y:0,angle:25}),offset=KB.rotate(0,-1,target.angle),moving=KB.key({x:offset.x+.05,y:offset.y-.04,angle:-10}),second=KB.key({x:2.2,y:-1.05,angle:5});
  const snap=KB.snapNeighbors([moving,second],[target]);
  assert.ok(snap);near(snap.angleDelta,35);near(moving.angle+snap.angleDelta,25);near(second.angle+snap.angleDelta,40);
});

test('角度跨越 ±180° 时选择最短方向校正到邻键角度',()=>{
  const target=KB.key({x:0,y:0,angle:-170}),offset=KB.rotate(0,-1,target.angle),moving=KB.key({x:offset.x+.03,y:offset.y-.02,angle:170});
  const snap=KB.snapNeighbors([moving],[target]);
  assert.ok(snap);near(snap.angleDelta,20);near(moving.angle+snap.angleDelta,190);
});

test('上下左右吸附按两键宽高计算间距，长键不叠放',()=>{
  const target=KB.key({x:0,y:0,w:2,h:1.5});
  for(const [x,y,side,spacing]of [[1.6,.1,'right',1.5],[-1.6,.1,'left',1.5],[.1,-1.35,'above',1.25],[.1,1.35,'below',1.25]]){
    const moving=KB.key({x,y}),snap=KB.snapNeighbors([moving],[target]);
    assert.ok(snap);assert.equal(snap.side,side);near(snap.spacing,spacing);
    near(Math.hypot(moving.x+snap.dx,moving.y+snap.dy),spacing);
    assert.equal(KB.intersects(KB.rectangle(moving.x+snap.dx,moving.y+snap.dy,1,1),KB.rectangle(0,0,2,1.5)),false);
  }
});

test('已被占用的相邻位置和会挤到其他键的多选整体不会吸附',()=>{
  const target=KB.key({x:0,y:1}),occupied=KB.key({x:0,y:0});
  const moving=KB.key({x:.1,y:-.1});
  assert.equal(KB.snapNeighbors([moving],[target,occupied]),null);
  const second=KB.key({x:1.1,y:-.1}),blocker=KB.key({x:1,y:0});
  assert.equal(KB.snapNeighbors([moving,second],[target,blocker]),null);
});

test('多选用共同偏移吸附，保持组内距离；标记不参与候选和阻挡',()=>{
  const moving=KB.key({x:3.13,y:2.12}),second=KB.key({x:4.31,y:2.19});
  const target=KB.key({x:3,y:3}),decal=KB.key({x:3,y:2,w:3,h:3,decal:true});
  const snap=KB.snapNeighbors([moving,second],[target,decal]);
  assert.ok(snap);near(moving.x+snap.dx,3);near(moving.y+snap.dy,2);
  near((second.x+snap.dx)-(moving.x+snap.dx),1.18);
  near((second.y+snap.dy)-(moving.y+snap.dy),.07);
  assert.equal(KB.snapNeighbors([moving],[decal]),null);
  assert.equal(KB.snapNeighbors([decal],[target]),null);
});

test('吸附有小范围保持区，拖远后释放，不累计上一次偏移',()=>{
  const target=KB.key({x:0,y:1}),moving=KB.key({x:.1,y:0});
  const previous=KB.snapNeighbors([moving],[target]);
  const slightlyAway={...moving,x:.25};
  assert.equal(KB.snapNeighbors([slightlyAway],[target]),null);
  const held=KB.snapNeighbors([slightlyAway],[target],{previous});
  assert.ok(held);near(slightlyAway.x+held.dx,0);
  assert.equal(KB.snapNeighbors([{...moving,x:.31}],[target],{previous}),null);
});

test('真实示例：42 个实体按键、TPS65 为标记，导出不增加轴孔',()=>{
  assert.equal(sample.keys.filter(k=>!k.decal).length,42);
  assert.equal(sample.keys.filter(k=>k.decal).length,1);
  const plate=KB.plate(sample.keys);
  assert.deepEqual(plate.errors,[]);
  assert.equal(plate.polygons.filter(p=>p.layer==='SWITCH').length,42);
  assert.equal(plate.outlines.length,1);
});

test('KLE 的旋转中心与键位偏移按 KLE 坐标计算',()=>{
  const {keys}=KB.parseKLE(JSON.stringify([[{r:90,rx:2,ry:3,x:1,y:0,w:2},'长键']]));
  near(keys[0].x,1.5);near(keys[0].y,5);near(keys[0].w,2);near(keys[0].angle,90);
});

test('完整 KLE 和 Raw Data 往返保留各键的中心、尺寸、角度和标记',()=>{
  const keys=sample.keys.concat([KB.key({x:-2,y:3,w:2.25,h:1,angle:37,label:'Enter'})]);
  for(const raw of [false,true]){
    const restored=KB.parseKLE(KB.exportKLE(keys,'验证',raw)).keys;
    assert.equal(restored.length,keys.length);
    keys.forEach((k,i)=>{for(const prop of ['x','y','w','h','angle'])near(restored[i][prop],k[prop]);assert.equal(restored[i].label,k.label);assert.equal(restored[i].decal,k.decal);});
  }
});

test('轴孔为 14mm 方孔，随键位旋转且保持轴心',()=>{
  const p=KB.plate([KB.key({x:2,y:3,angle:30})]);
  const pts=p.polygons[0].points;
  near(pts.reduce((s,v)=>s+v.x,0)/4,38.1);near(pts.reduce((s,v)=>s+v.y,0)/4,57.15);
  near(Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),14);
  near(Math.atan2(pts[1].y-pts[0].y,pts[1].x-pts[0].x)*180/Math.PI,30);
});

test('左右分体生成两条独立闭合板框',()=>{
  const p=KB.plate([KB.key({x:0}),KB.key({x:1}),KB.key({x:6}),KB.key({x:7})],{outline:'split'});
  assert.equal(p.outlines.length,2);assert.deepEqual(p.errors,[]);
});

function splitFixture(){
  const left=[],right=[];
  for(let col=0;col<3;col++)for(let row=0;row<3;row++){
    const k=KB.key({label:`左${col}-${row}`,x:1+col*1.4,y:1+row*1.3-col*.2,angle:col*4});
    left.push(k);right.push(KB.key({label:`右${col}-${row}`,x:14-k.x+.12,y:k.y-.08,angle:-k.angle+3,color:'#234534',w:1.1}));
  }
  return {left,right,keys:[...left,...right]};
}

test('分体镜像按几何匹配每列，保留列错位、对侧文字颜色和 ID，不改变源数据',()=>{
  const {left,right,keys}=splitFixture(),before=JSON.stringify(keys);
  const result=KB.mirrorSelection([...keys].reverse(),left.map(k=>k.id),{axis:7});
  assert.equal(result.sourceSide,'left');assert.equal(result.pairs.length,9);
  left.forEach((k,i)=>{
    const target=result.keys.find(k=>k.id===right[i].id);
    near(target.x,14-k.x);near(target.y,k.y);near(target.angle,-k.angle);
    near(target.w,k.w);near(target.h,k.h);
    assert.equal(target.label,right[i].label);assert.equal(target.color,right[i].color);
    assert.deepEqual(result.keys.find(s=>s.id===k.id),k);
  });
  assert.equal(JSON.stringify(keys),before);
});

test('只选一列仅校正该列；支持右侧为基准和旋转长键的完整几何反射',()=>{
  const {left,right,keys}=splitFixture();
  const result=KB.mirrorSelection(keys,left.slice(3,6).map(k=>k.id),{axis:7});
  assert.equal(result.pairs.length,3);
  for(const k of keys)if(!right.slice(3,6).some(r=>r.id===k.id))assert.deepEqual(result.keys.find(r=>r.id===k.id),k);
  const source=KB.key({x:9,y:6,w:2.25,h:1.5,angle:-28,label:'右拇指'}),target=KB.key({x:1.15,y:6.1,label:'左拇指'});
  const mirrored=KB.mirrorSelection([source,target],[source.id],{axis:5});
  assert.equal(mirrored.sourceSide,'right');
  const output=mirrored.keys[1],shape=KB.rectangle(output.x,output.y,output.w,output.h,output.angle);
  for(const p of KB.rectangle(source.x,source.y,source.w,source.h,source.angle))assert.ok(shape.some(q=>Math.hypot(q.x-(10-p.x),q.y-p.y)<1e-5));
  assert.equal(output.label,'左拇指');
});

test('分体镜像完整反射 ISO 复合键轮廓，轴孔主中心仍保持镜像',()=>{
  for(const angle of [0,23,-40,110])for(const y2 of [0,1]){
    const source=KB.key({x:2,y:3,w:1.25,h:2,w2:1.5,h2:1,x2:-.25,y2,angle,label:'ISO Enter'});
    const target=KB.key({x:8,y:3,w:1.25,h:2,label:'对侧 Enter'});
    const result=KB.mirrorSelection([source,target],[source.id],{axis:5}),mirrored=result.keys[1];
    assert.equal(mirrored.w2,1.5);assert.equal(mirrored.h2,1);near(mirrored.x2,0);near(mirrored.y2,y2);
    const a=KB.keyShape(source),b=KB.keyShape(mirrored),mapped=a.map(p=>({x:10-p.x,y:p.y}));
    for(const p of mapped)assert.ok(b.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<1e-6));
    near(mirrored.x,8);near(mirrored.y,3);near(mirrored.angle,-angle);
    near(KB.plate(result.keys).polygons[1].points.reduce((sum,p)=>sum+p.x,0)/4,8*19.05);
    const back=KB.mirrorSelection(result.keys,[mirrored.id],{axis:5}).keys[0];
    for(const prop of ['x','y','w','h','w2','h2','x2','y2','angle'])near(back[prop],source[prop]);
  }
});

test('自动中线排除示意标记，显式中线支持非原点和负坐标',()=>{
  const a=KB.key({x:-4,y:2}),b=KB.key({x:2.1,y:2}),decal=KB.key({x:100,decal:true});
  near(KB.symmetryAxis([a,b,decal]),-.95);
  const result=KB.mirrorSelection([a,b,decal],[a.id],{axis:-1});
  near(result.keys[1].x,2);assert.deepEqual(result.keys[2],decal);
  assert.throws(()=>KB.symmetryAxis([a],NaN),/有效/);
  assert.throws(()=>KB.symmetryAxis([a],1001),/有效/);
});

test('无对应键、匹配模糊或重复匹配时整次拒绝，不移动或新增任何键',()=>{
  const source=KB.key({x:1,y:0,label:'源键'}),nearby=KB.key({x:9,y:.1}),far=KB.key({x:9,y:3});
  assert.throws(()=>KB.mirrorSelection([source,far],[source.id],{axis:5}),/未找到对应键/);
  const ambiguous=[source,KB.key({x:9,y:-.5}),KB.key({x:9,y:.5})],before=JSON.stringify(ambiguous);
  assert.throws(()=>KB.mirrorSelection(ambiguous,[source.id],{axis:5}),/不明确/);
  assert.equal(JSON.stringify(ambiguous),before);
  const other=KB.key({x:1.1,y:0});
  assert.throws(()=>KB.mirrorSelection([source,other,nearby],[source.id,other.id],{axis:5}),/同一个/);
  const second=KB.key({x:2,y:3}),partial=[source,second,nearby],original=JSON.stringify(partial);
  assert.throws(()=>KB.mirrorSelection(partial,[source.id,second.id],{axis:5}),/未找到/);
  assert.equal(JSON.stringify(partial),original);
});

test('54 键实测回归：整侧镜像找回唯一远移的 54 号键，所有对应键精确对齐',()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/split-mirror-outlier.json'),'utf8'));
  const keys=fixture.keys.map(k=>KB.key(k)),axis=fixture.axis,left=keys.filter(k=>k.x<axis),before=JSON.stringify(keys);
  assert.equal(left.length,27);
  const source=left.find(k=>k.label==='46'),target=keys.find(k=>k.label==='54');
  assert.ok(Math.hypot(target.x-(2*axis-source.x),target.y-source.y)>.75);
  const result=KB.mirrorSelection([...keys].reverse(),left.map(k=>k.id),{axis});
  assert.equal(result.recoveredCount,1);assert.equal(result.pairs.length,27);
  assert.equal(result.pairs.find(p=>p.sourceID===source.id).targetID,target.id);
  for(const pair of result.pairs){
    const s=keys.find(k=>k.id===pair.sourceID),original=keys.find(k=>k.id===pair.targetID),t=result.keys.find(k=>k.id===pair.targetID);
    near(t.x+s.x,2*axis,1e-6);near(t.y,s.y,1e-6);near(t.angle,-s.angle,1e-6);
    assert.equal(t.label,original.label);assert.equal(t.color,original.color);
    assert.deepEqual(result.keys.find(k=>k.id===s.id),s);
  }
  assert.equal(JSON.stringify(keys),before);
  const reverse=KB.mirrorSelection(keys,keys.filter(k=>k.x>axis).map(k=>k.id),{axis});
  assert.equal(reverse.recoveredCount,1);assert.equal(reverse.pairs.find(p=>p.sourceID===target.id).targetID,source.id);
  const repeat=KB.mirrorSelection(result.keys,left.map(k=>k.id),{axis});
  assert.equal(repeat.recoveredCount,0);
  assert.deepEqual(repeat.keys,result.keys);
});

test('整侧唯一剩余配对不依赖标签、键位顺序或固定的远移距离',()=>{
  const {left,right,keys}=splitFixture();right[0].y-=6;right[0].label='没有对应文字的键';
  const result=KB.mirrorSelection([...keys].reverse(),left.map(k=>k.id).reverse(),{axis:7});
  assert.equal(result.recoveredCount,1);assert.equal(result.pairs.length,9);
  assert.equal(result.pairs.find(p=>p.sourceID===left[0].id).targetID,right[0].id);
  near(result.keys.find(k=>k.id===right[0].id).y,left[0].y);
});

test('远移回退不用于部分选择、两键配列、缺键、多余键、多处远移或尺寸不符',()=>{
  const cases=[
    ({left})=>left.slice(0,-1).map(k=>k.id),
    ({keys,right})=>{keys.splice(keys.indexOf(right[1]),1);},
    ({keys})=>{keys.push(KB.key({x:10,y:20}));},
    ({right})=>{right[1].y-=6;},
    ({right})=>{right[0].w=2;}
  ];
  for(const prepare of cases){
    const fixture=splitFixture();fixture.right[0].y-=6;
    const ids=prepare(fixture)||fixture.left.map(k=>k.id),before=JSON.stringify(fixture.keys);
    assert.throws(()=>KB.mirrorSelection(fixture.keys,ids,{axis:7}),/未找到对应键/);
    assert.equal(JSON.stringify(fixture.keys),before);
  }
  const left=[KB.key({x:1,y:0}),KB.key({x:1,y:2})],right=[KB.key({x:9,y:0}),KB.key({x:9,y:6})];
  assert.throws(()=>KB.mirrorSelection([...left,...right],left.map(k=>k.id),{axis:5}),/未找到对应键/);
});

test('远移回退仍拒绝附近歧义、重复配对和恢复后的键位重叠',()=>{
  const ambiguous=splitFixture();ambiguous.right[0].y-=6;
  Object.assign(ambiguous.right[1],{x:ambiguous.right[2].x,y:ambiguous.right[2].y+.05});
  assert.throws(()=>KB.mirrorSelection(ambiguous.keys,ambiguous.left.map(k=>k.id),{axis:7}),/不明确|同一个/);
  const overlap=splitFixture();overlap.right[0].y-=6;
  Object.assign(overlap.left[0],{w:3});overlap.right[0].w=3;
  const before=JSON.stringify(overlap.keys);
  assert.throws(()=>KB.mirrorSelection(overlap.keys,overlap.left.map(k=>k.id),{axis:7}),/重叠/);
  assert.equal(JSON.stringify(overlap.keys),before);
});

test('跨越中线、中线上的键、空选择和 Decal 不能作为镜像来源',()=>{
  const left=KB.key({x:1}),right=KB.key({x:9}),center=KB.key({x:5}),decal=KB.key({x:2,decal:true}),keys=[left,right,center,decal];
  for(const selection of [[left.id,right.id],[center.id]])assert.throws(()=>KB.mirrorSelection(keys,selection,{axis:5}),/同一侧/);
  assert.throws(()=>KB.mirrorSelection(keys,[],{axis:5}),/先选择/);
  assert.throws(()=>KB.mirrorSelection(keys,[left.id,decal.id],{axis:5}),/示意标记/);
  assert.throws(()=>KB.mirrorSelection([left,{...right,decal:true}],[left.id],{axis:5}),/未找到/);
});

test('镜像导致尺寸重叠或越界时拒绝；示意标记不阻挡镜像',()=>{
  const left=KB.key({x:1,y:0,w:2.5}),right=KB.key({x:9,y:.1}),blocker=KB.key({x:10.6,y:0});
  assert.throws(()=>KB.mirrorSelection([left,right,blocker],[left.id],{axis:5}),/重叠/);
  assert.equal(KB.mirrorSelection([left,right,{...blocker,decal:true}],[left.id],{axis:5}).keys.length,3);
  const edge=KB.key({x:1000,y:0}),outside=KB.key({x:999.8,y:0});
  assert.throws(()=>KB.mirrorSelection([outside,edge],[outside.id],{axis:999.95}),/超出/);
});

test('镜像后的 KLE 往返与分体 DXF 轴孔保持左右几何对称',()=>{
  const {left,keys}=splitFixture();
  const result=KB.mirrorSelection(keys,left.map(k=>k.id),{axis:7});
  const restored=KB.parseKLE(KB.exportKLE(result.keys,'镜像验证')).keys;
  result.keys.forEach((k,i)=>{for(const p of ['x','y','w','h','angle'])near(restored[i][p],k[p]);});
  const plate=KB.plate(restored,{outline:'split'});
  assert.deepEqual(plate.errors,[]);assert.equal(plate.outlines.length,2);assert.equal(plate.count,18);
  const points=plate.polygons.flatMap(p=>p.points),axis=7*19.05;
  for(const p of points)assert.ok(points.some(q=>Math.hypot(q.x-(2*axis-p.x),q.y-p.y)<1e-5));
  assert.match(KB.dxf(plate),/LWPOLYLINE/);
});

test('相交轴孔和越界模块阻止 DXF 导出',()=>{
  const p=KB.plate([KB.key(),KB.key({x:.6})]);
  assert.ok(p.errors.some(s=>s.includes('相交')));assert.throws(()=>KB.dxf(p),/相交/);
  const outside=KB.plate([KB.key()],{},[{type:'rect',x:100,y:100,w:20,h:10,angle:0}]);
  assert.ok(outside.errors.some(s=>s.includes('超出')));assert.throws(()=>KB.dxf(outside),/超出/);
});

test('PCB 卫星轴间距为 23.8mm，旋转长键的避让孔仍在同一轴线',()=>{
  const p=KB.plate([KB.key({w:2,angle:90})],{stabilizers:'pcb'});
  assert.deepEqual(p.errors,[]);
  const stabs=p.polygons.filter(p=>p.layer==='STABILIZER').map(p=>({x:p.points.reduce((s,v)=>s+v.x,0)/4,y:p.points.reduce((s,v)=>s+v.y,0)/4}));
  near(stabs[0].x,stabs[1].x);near(Math.abs(stabs[0].y-stabs[1].y),23.8);
});

test('非法尺寸与无效 KLE 数值拒绝',()=>{
  assert.throws(()=>KB.plate([KB.key()],{pitch:0}),/键距/);
  assert.throws(()=>KB.parseKLE('[[{"x":"错误"},"A"]]'),/有效数值/);
  assert.equal(KB.parseKLE('["A","B"]').keys.length,2);
  for(const extra of [{w2:-1},{h2:21},{x2:'错误'},{y2:21},{x2:2},{x2:1,y2:1}]){
    assert.throws(()=>KB.parseKLE(JSON.stringify([[extra,'非法复合键']])));
  }
  assert.throws(()=>KB.checkKeys([KB.key({w2:NaN})]),/有效数值/);
});

test('标准 ISO Enter 复合键支持导入导出、凹口命中与板框，轴孔保持主轴心',()=>{
  const source='[[{"w":1.25,"h":2,"w2":1.5,"h2":1,"x2":-0.25},"ISO Enter"]]';
  const {keys}=KB.parseKLE(source),k=keys[0],shape=KB.keyShape(k),b=KB.bounds(shape);
  assert.equal(k.label,'ISO Enter');near(k.w,1.25);near(k.h,2);near(k.x,.625);near(k.y,1);
  near(b.x,-.25);near(b.y,0);near(b.w,1.5);near(b.h,2);
  assert.equal(KB.inside({x:-.2,y:.5},shape),true);assert.equal(KB.inside({x:-.2,y:1.5},shape),false);
  for(const raw of [false,true]){
    const restored=KB.parseKLE(KB.exportKLE(keys,'ISO',raw)).keys[0];
    for(const p of ['w','h','w2','h2','x2','y2','x','y'])near(restored[p],k[p]);
    assert.equal(restored.label,k.label);
  }
  const plate=KB.plate(keys),outline=KB.bounds(plate.outlines.flat());
  assert.deepEqual(plate.errors,[]);
  near(outline.w,1.5*19.05+8);near(outline.h,2*19.05+8);
  assert.equal(plate.polygons.length,1);near(KB.bounds(plate.polygons[0].points).w,14);
  const cutout=KB.bounds(plate.polygons[0].points);near(cutout.x+cutout.w/2,k.x*19.05);near(cutout.y+cutout.h/2,k.y*19.05);
  const stabilized=KB.plate(keys,{stabilizers:'pcb'}),stabs=stabilized.polygons.filter(p=>p.layer==='STABILIZER').map(p=>KB.bounds(p.points));
  assert.deepEqual(stabilized.errors,[]);assert.equal(stabs.length,2);
  near(stabs[0].x+stabs[0].w/2,stabs[1].x+stabs[1].w/2);near(Math.abs(stabs[1].y-stabs[0].y),23.8);
  const rotated=KB.parseKLE('[[{"r":90,"rx":2,"ry":3,"w":1.25,"h":2,"w2":1.5,"h2":1,"x2":-0.25},"ISO"]]').keys[0],rb=KB.bounds(KB.keyShape(rotated));
  near(rb.x,0);near(rb.y,2.75);near(rb.w,2);near(rb.h,1.5);
  const cap=KB.parseKLE('[[{"w":1.25,"h":2,"w2":1.5,"h2":1,"x2":-0.25,"y2":1},"下凸回车"]]').keys[0];
  assert.equal(KB.inside({x:-.2,y:1.5},KB.keyShape(cap)),true);
  const plateXY=KB.plate([{...k,angle:35}],{pitch:18,pitchY:17});
  assert.deepEqual(plateXY.errors,[]);
  const expected=KB.bounds(KB.keyFootprint({...k,angle:35},4,18,17)),actual=KB.bounds(plateXY.outlines.flat());
  for(const prop of ['x','y','w','h'])near(actual[prop],expected[prop]);
});

test('阶梯 Caps Lock 与 KLE 次形状默认值正确，后续普通键不继承异形数据',()=>{
  const keys=KB.parseKLE('[[{"w":1.25,"w2":1.75,"h2":0},"Caps Lock","A",{"w":2},"B"]]').keys;
  near(keys[0].w,1.25);near(keys[0].h2,1);near(KB.bounds(KB.keyShape(keys[0])).w,1.75);
  near(keys[1].x,1.75);near(keys[2].x,3.25);
  for(const k of keys.slice(1)){assert.equal(k.w2,undefined);assert.equal(KB.hasCompoundShape(k),false);}
  const connected=KB.parseKLE('[[{"w2":1,"x2":1},"沿边相接"]]').keys[0];
  near(KB.bounds(KB.keyShape(connected)).w,2);
});

test('异形键窄台阶的绘制内缩不翻转或自交，轮廓始终留在原键帽内',()=>{
  const k=KB.key({w:1,h:1,w2:.1,h2:.1,x2:.999,y2:.45});
  KB.checkKeys([k]);const original=KB.keyShape(k);
  for(const margin of [-.025,-.09]){
    const inset=KB.keyShape(k,margin);assert.doesNotThrow(()=>KB.outlinePoints(inset));
    for(const p of inset)assert.equal(KB.inside(p,original),true);
  }
});

test('异形键吸附按外伸轮廓留间距，凹口里的键不误判为碰撞',()=>{
  const plus=KB.key({x:0,y:0,w:1,h:3,w2:3,h2:1,x2:-1,y2:1});
  const moving=KB.key({x:2.1,y:.05}),snap=KB.snapNeighbors([moving],[plus]);
  assert.ok(snap);assert.equal(snap.side,'right');near(moving.x+snap.dx,2);
  const target=KB.key({x:-1,y:-2,w:.5,h:1.5}),inNotch=KB.key({x:-.95,y:-.96,w:.5,h:.5});
  const notchSnap=KB.snapNeighbors([inNotch],[target,plus]);
  assert.ok(notchSnap);assert.equal(notchSnap.targetID,target.id);near(inNotch.x+notchSnap.dx,-1);near(inNotch.y+notchSnap.dy,-1);
  const blockedTarget=KB.key({x:-1,y:-1,w:.5,h:.5}),blockedMoving=KB.key({x:-.95,y:-.46,w:.5,h:.5});
  assert.equal(KB.snapNeighbors([blockedMoving],[blockedTarget,plus]),null);
});

test('DXF 使用毫米、闭合多段线、真实圆，按用途分层',()=>{
  const p=KB.plate(sample.keys,{},[{name:'验证圆孔',type:'circle',x:171.45,y:70,w:3,h:3,angle:0}]);
  assert.deepEqual(p.errors,[]);
  const d=KB.dxf(p);assert.match(d,/\$INSUNITS\r\n70\r\n4/);assert.match(d,/\r\nCIRCLE\r\n/);assert.match(d,/\r\nMOUNT\r\n/);
  assert.equal((d.match(/\r\nLWPOLYLINE\r\n/g)||[]).length,43);
  fs.writeFileSync(path.join(__dirname,'../output/test-plate.dxf'),d);
});

test('截图键盘轮廓支持凹多边形、保存为毫米 DXF 并检查开孔越界',()=>{
  const outline=[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:1,y:3},{x:1,y:0},{x:-3,y:0}];
  const plate=KB.plate([KB.key({x:-1,y:-1}),KB.key({x:2,y:2})],{outline:'capture',outlinePoints:outline});
  assert.deepEqual(plate.errors,[]);assert.equal(plate.outlines.length,1);assert.equal(plate.outlines[0].length,outline.length);
  assert.match(KB.dxf(plate),/OUTLINE/);
  const outside=KB.plate([KB.key({x:0,y:1})],{outline:'capture',outlinePoints:outline});
  assert.ok(outside.errors.some(s=>s.includes('超出')));assert.throws(()=>KB.dxf(outside),/超出/);
});

test('截图键盘轮廓拒绝自交点列并允许旧工程缺省字段',()=>{
  assert.throws(()=>KB.outlinePoints([{x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0}]),/面积|相交/);
  const legacy=KB.plate([KB.key()],{outline:'capture',outlinePoints:[]});
  assert.equal(legacy.errors.length,1);assert.ok(legacy.errors[0].includes('至少需要 3 个点'));
  assert.ok(!legacy.errors.some(s=>s.includes('超出定位板外框')),'missing outline must not cascade into per-key overhang errors');
});

const area=points=>Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0))/2;
// Exact area of a closed bulge path: polygon of the vertices plus each arc's circular segment.
const pathArea=path=>{
  let sum=path.reduce((s,p,i)=>{const q=path[(i+1)%path.length];return s+p.x*q.y-q.x*p.y;},0)/2;
  path.forEach((p,i)=>{if(!p.bulge)return;const q=path[(i+1)%path.length],theta=4*Math.atan(p.bulge),c=Math.hypot(q.x-p.x,q.y-p.y),r=c/(2*Math.sin(Math.abs(theta)/2));sum+=Math.sign(theta)*r*r*(Math.abs(theta)-Math.sin(Math.abs(theta)))/2;});
  return Math.abs(sum);
};
const polygonSelfIntersects=points=>{
  const orient=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const on=(p,a,b)=>Math.abs(orient(a,b,p))<1e-7&&p.x>=Math.min(a.x,b.x)-1e-7&&p.x<=Math.max(a.x,b.x)+1e-7&&p.y>=Math.min(a.y,b.y)-1e-7&&p.y<=Math.max(a.y,b.y)+1e-7;
  const cross=(a,b,c,d)=>on(a,c,d)||on(b,c,d)||on(c,a,b)||on(d,a,b)||(orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0);
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    if(j===i+1||(i===0&&j===points.length-1))continue;
    if(cross(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]))return true;
  }
  return false;
};

test('加工参数默认为 0 时与旧版输出一致：方孔 4 点、无圆弧、旧工程缺省字段可用',()=>{
  const p=KB.plate(sample.keys);
  assert.ok(p.polygons.every(h=>h.points.length===4&&h.path.every(v=>!v.bulge)));
  assert.equal(p.toolpaths.outlines[0].length,p.outlines[0].length);
  assert.doesNotMatch(KB.dxf(p),/\r\n42\r\n/);
  const legacy=KB.plate(sample.keys,{pitch:19.05,hole:14,margin:4,outline:'hull',stabilizers:'none'});
  assert.deepEqual(legacy.errors,[]);assert.equal(legacy.options.kerf,0);
});

test('开孔内角输出真实圆弧：90° 角 bulge 为 tan(22.5°)，面积扣除四角',()=>{
  const r=.5,p=KB.plate([KB.key({x:2,y:3,angle:30})],{holeRadius:r});
  const hole=p.polygons[0];
  assert.equal(hole.path.length,8);
  assert.equal(hole.path.filter(v=>v.bulge).length,4);
  for(const v of hole.path.filter(v=>v.bulge))near(Math.abs(v.bulge),Math.tan(Math.PI/8));
  near(pathArea(hole.path),196-(4-Math.PI)*r*r,1e-6);
  near(area(hole.points),196-(4-Math.PI)*r*r,.01);
  const d=KB.dxf(p);
  assert.equal((d.match(/\r\n42\r\n/g)||[]).length,4);
  assert.deepEqual(p.errors,[]);
});

test('板框圆角：矩形外框四角倒圆，凹形截图轮廓的内凹角向外补圆，DXF 方向随 Y 翻转',()=>{
  const R=5,plain=KB.plate([KB.key(),KB.key({x:3})],{outline:'rectangle'}),round=KB.plate([KB.key(),KB.key({x:3})],{outline:'rectangle',outlineRadius:R});
  const box=plain.outlines[0];
  near(pathArea(round.toolpaths.outlines[0]),area(box)-(4-Math.PI)*R*R,1e-6);
  assert.deepEqual(round.errors,[]);
  const outline=[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:1,y:3},{x:1,y:0},{x:-3,y:0}],r=.5;
  const concave=KB.plate([KB.key({x:-1,y:-1}),KB.key({x:2,y:2})],{outline:'capture',outlinePoints:outline,outlineRadius:r});
  const path=concave.toolpaths.outlines[0],signs=path.filter(v=>v.bulge).map(v=>Math.sign(v.bulge));
  // Five convex corners lose r²(1 − π/4) each; the one concave corner gains the same amount.
  assert.equal(signs.length,6);assert.equal(signs.filter(s=>s<0).length,1);
  near(pathArea(path),area(outline.map(p=>({x:p.x*19.05,y:p.y*19.05})))-4*(1-Math.PI/4)*r*r,1e-6);
  const dxfBulges=[...KB.dxf(concave).matchAll(/\r\n42\r\n(-?[\d.]+)/g)].map(m=>Math.sign(Number(m[1])));
  assert.deepEqual(dxfBulges.slice(0,6),signs.map(s=>-s));
});

test('沿键位外形生成凹口板框：2.9 mm 外扩、圆角与 DXF/SVG 一致',()=>{
  const keys=[KB.key({x:0,y:0}),KB.key({x:1,y:0}),KB.key({x:0,y:1})];
  const p=KB.plate(keys,{outline:'contour',margin:2.9,outlineRadius:2});
  assert.deepEqual(p.errors,[]);assert.equal(p.outlines.length,1);
  near(p.bounds.x,-9.525-2.9);near(p.bounds.y,-9.525-2.9);
  near(p.bounds.x+p.bounds.w,1.5*19.05+2.9);near(p.bounds.y+p.bounds.h,1.5*19.05+2.9);
  const outline=p.toolpaths.outlines[0];assert.ok(outline.filter(v=>v.bulge).length>=5);
  assert.ok(outline.some(v=>v.bulge<0),'re-entrant step gets a tangent radius');
  for(const hole of p.polygons)assert.ok(hole.points.every(v=>KB.inside(v,p.outlines[0])));
  const dxf=KB.dxf(p,['plate']),svg=KB.svg(p,['plate']);
  assert.match(dxf,/\r\n2\r\nOUTLINE\r\n/);assert.ok((dxf.match(/\r\n42\r\n/g)||[]).length>=5);
  assert.match(svg,/<g id="OUTLINE">[\s\S]*<path d="[^"]* A/);
});

test('沿键位外形保留轮廓内部空区的独立切割线',()=>{
  const keys=[];for(let y=0;y<3;y++)for(let x=0;x<3;x++)if(x!==1||y!==1)keys.push(KB.key({x,y}));
  const p=KB.plate(keys,{outline:'contour',margin:2.9});
  assert.deepEqual(p.errors,[]);assert.equal(p.outlines.length,1);
  assert.equal(p.parts[0].holes.filter(h=>h.layer==='OUTLINE').length,1);
  assert.ok(p.toolpaths.polygons.some(h=>h.layer==='OUTLINE'));
  const sandwich=KB.plate(keys,{outline:'contour',margin:2.9,caseType:'sandwich'});
  assert.ok(sandwich.errors.some(e=>e.includes('不能自动生成三明治中框')));
});

test('板框圆角超过可用边长时自动减小并提示，不产生零长度边',()=>{
  const p=KB.plate([KB.key()],{outline:'rectangle',outlineRadius:50});
  assert.ok(p.warnings.some(t=>t.includes('圆角已按可用长度减小')));
  const path=p.toolpaths.outlines[0];
  assert.equal(path.length,4);
  path.forEach((v,i)=>{const q=path[(i+1)%path.length];assert.ok(Math.hypot(q.x-v.x,q.y-v.y)>1e-6);});
  assert.deepEqual(p.errors,[]);
  const nearlyStraight=KB.fillet([{x:0,y:0},{x:50,y:.0005},{x:100,y:0},{x:100,y:40},{x:0,y:40}],3);
  assert.equal(nearlyStraight.path.length,9);assert.equal(nearlyStraight.radii[1],0);
  assert.ok(nearlyStraight.path.some(v=>v.x===50&&!v.bulge));
});

test('切缝补偿只偏移 DXF 刀路：方孔与圆孔缩小、板框外扩，检查仍按成品尺寸',()=>{
  const kerf=.2,features=[{name:'固定孔',type:'circle',x:20,y:10,w:3,h:3,angle:0}];
  const base=KB.plate([KB.key(),KB.key({x:2})],{outline:'rectangle',holeRadius:.5,outlineRadius:3},features);
  const cut=KB.plate([KB.key(),KB.key({x:2})],{outline:'rectangle',holeRadius:.5,outlineRadius:3,kerf},features);
  assert.deepEqual(cut.errors,[]);
  assert.deepEqual(cut.polygons.map(h=>h.points),base.polygons.map(h=>h.points));
  assert.deepEqual(cut.outlines,base.outlines);
  const hole=cut.toolpaths.polygons[0].path,side=(Math.max(...hole.map(v=>v.x))-Math.min(...hole.map(v=>v.x)));
  near(side,14-kerf);
  near(pathArea(hole),(14-kerf)**2-(4-Math.PI)*(.5-kerf/2)**2,1e-6);
  near(cut.toolpaths.circles[0].r,1.5-kerf/2);
  const b=KB.bounds(KB.flatten(cut.toolpaths.outlines[0])),nominal=KB.bounds(base.outlines[0]);
  near(b.w,nominal.w+kerf,1e-6);near(b.h,nominal.h+kerf,1e-6);
  near(pathArea(cut.toolpaths.outlines[0]),(nominal.w+kerf)*(nominal.h+kerf)-(4-Math.PI)*(3+kerf/2)**2,1e-6);
  assert.ok(cut.warnings.some(t=>t.includes('切缝补偿')));
  assert.match(KB.dxf(cut),/\r\n40\r\n1\.4\r\n/);
});

test('凹形轮廓切缝补偿：内凹角圆角减小，外凸角圆角增大，刀路不自交',()=>{
  const outline=[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:1,y:3},{x:1,y:0},{x:-3,y:0}];
  const p=KB.plate([KB.key({x:-1,y:-1}),KB.key({x:2,y:2})],{outline:'capture',outlinePoints:outline,outlineRadius:2,kerf:.4});
  assert.deepEqual(p.errors,[]);
  const path=p.toolpaths.outlines[0],arcs=path.filter(v=>v.bulge);
  const radii=path.map((v,i)=>{if(!v.bulge)return null;const q=path[(i+1)%path.length],theta=4*Math.atan(v.bulge);return Math.hypot(q.x-v.x,q.y-v.y)/(2*Math.sin(Math.abs(theta)/2));}).filter(Boolean);
  assert.equal(arcs.length,6);
  assert.equal(radii.filter(r=>Math.abs(r-2.2)<1e-6).length,5);
  assert.equal(radii.filter(r=>Math.abs(r-1.8)<1e-6).length,1);
});

test('加工参数越界或补偿后孔径不足时明确拒绝导出',()=>{
  for(const options of [{holeRadius:-1},{holeRadius:3},{outlineRadius:51},{kerf:-.1},{kerf:1.5},{kerf:NaN}])assert.throws(()=>KB.plate([KB.key()],options),/开孔内角|切缝补偿/);
  const tiny=KB.plate([KB.key({x:0}),KB.key({x:3})],{kerf:1},[{name:'小孔',type:'circle',x:28,y:0,w:.8,h:.8,angle:0}]);
  assert.ok(tiny.errors.some(t=>t.includes('小孔')));assert.throws(()=>KB.dxf(tiny),/小孔/);
});

test('大配列开孔检查使用包围盒预筛，500 键圆角配列保持可交互速度',()=>{
  const keys=Array.from({length:500},(_,i)=>KB.key({x:(i%25)*1.05,y:Math.floor(i/25)*1.05}));
  const started=Date.now(),p=KB.plate(keys,{holeRadius:.5,outlineRadius:4});
  assert.deepEqual(p.errors,[]);assert.equal(p.count,500);
  assert.ok(Date.now()-started<4000,`耗时 ${Date.now()-started} ms`);
});

const box=points=>KB.bounds(points);
const pathRadii=path=>path.map((v,i)=>{if(!v.bulge)return null;const q=path[(i+1)%path.length],theta=4*Math.atan(v.bulge);return Math.hypot(q.x-v.x,q.y-v.y)/(2*Math.sin(Math.abs(theta)/2));}).filter(r=>r!==null);

test('轴孔类型：MX 开盖缺口 0.8 × 3.1 mm、中心 ±4.45 mm，Alps 15.5 × 12.8 mm，MX / Alps 兼容为两者并集',()=>{
  const open=KB.switchShape('mx-openable');
  assert.equal(open.length,20);near(area(open),196+4*.8*3.1);
  const b=box(open);near(b.w,15.6);near(b.h,14);
  const notch=open.filter(p=>p.x===7.8).map(p=>p.y).sort((a,b)=>a-b);
  assert.deepEqual(notch,[-6,-2.9,2.9,6]);near((notch[2]+notch[3])/2,4.45);
  const alps=KB.switchShape('alps');near(box(alps).w,15.5);near(box(alps).h,12.8);
  near(area(KB.switchShape('mx-alps')),196+2*.75*12.8);
  assert.equal(KB.switchShape('square',13.8).length,4);near(area(KB.switchShape('square',13.8)),13.8*13.8);
});

test('开盖缺口只给凸角倒圆，缺口处半径受 0.8 mm 宽度限制；切缝补偿保持缺口深度',()=>{
  const p=KB.plate([KB.key()],{cutout:'mx-openable',holeRadius:.5});
  const hole=p.polygons[0];
  assert.equal(hole.path.filter(v=>v.bulge).length,12);
  assert.ok(new Set(hole.path.filter(v=>v.bulge).map(v=>Math.sign(v.bulge))).size===1);
  const radii=pathRadii(hole.path).map(r=>KB.round(r)).sort();
  assert.equal(radii.filter(r=>Math.abs(r-.4)<1e-6).length,8);assert.equal(radii.filter(r=>Math.abs(r-.5)<1e-6).length,4);
  const cut=KB.plate([KB.key({x:0,y:0})],{cutout:'mx-openable',kerf:.2}).toolpaths.polygons[0].path;
  near(Math.max(...cut.map(v=>v.x)),7.7);near(Math.max(...cut.filter(v=>v.x<7.5).map(v=>v.x)),6.9);near(Math.min(...cut.filter(v=>v.x>7.5).map(v=>Math.abs(v.y))),3);
  near(Math.min(...cut.map(v=>v.y)),-6.9);
});

test('卫星轴类型与间距：MX Basic 7 × 15 向南偏 1.5 mm，Costar 3.3 × 14.2，3U / 8U 间距，4U 提示可设为不装',()=>{
  const centre=h=>({x:h.points.reduce((s,v)=>s+v.x,0)/h.points.length,y:h.points.reduce((s,v)=>s+v.y,0)/h.points.length});
  const basic=KB.plate([KB.key({w:2})],{stabilizers:'mx-basic'}).polygons.filter(h=>h.layer==='STABILIZER');
  assert.equal(basic.length,2);
  basic.forEach(h=>{const b=box(h.points);near(b.w,7);near(b.h,15);near(centre(h).y-19.05/2,1.5);});
  near(Math.abs(centre(basic[0]).x-centre(basic[1]).x),23.8);
  const costar=KB.plate([KB.key({w:2.25})],{stabilizers:'costar'}).polygons.filter(h=>h.layer==='STABILIZER');
  near(box(costar[0].points).w,3.3);near(box(costar[0].points).h,14.2);
  for(const [w,spacing] of [[3,19.05],[8,66.675]]){
    const pads=KB.plate([KB.key({w})],{stabilizers:'pcb',margin:10}).polygons.filter(h=>h.layer==='STABILIZER').map(centre);
    near(Math.abs(pads[0].x-pads[1].x),spacing*2);
  }
  const four=KB.plate([KB.key({w:4})],{stabilizers:'pcb'});
  assert.ok(four.errors.some(t=>t.includes('不装卫星轴')));
});

test('Cherry Spec 卫星轴：精确闭合轮廓与轴孔合并，轮廓范围和面积符合 2U 规格',()=>{
  const key=KB.key({x:2,y:3,w:2}),p=KB.plate([key],{stabilizers:'cherry-spec'}),hole=p.polygons[0],b=box(hole.points),cx=key.x*19.05,cy=key.y*19.05;
  assert.deepEqual(p.errors,[]);assert.equal(p.polygons.length,1);assert.equal(hole.layer,'SWITCH');
  near(b.x,cx-16.091);near(b.x+b.w,cx+16.091);near(b.y,cy-7.7724);near(b.y+b.h,cy+7);
  near(pathArea(hole.path),405.20414344,1e-6);assert.ok(p.warnings.some(t=>t.includes('Cherry Spec')));
  assert.equal(polygonSelfIntersects(hole.points),false);
  const d=KB.dxf(p);assert.equal((d.match(/\r\n0\r\nLWPOLYLINE\r\n/g)||[]).length,2);
  assert.match(d,/\r\n0\r\nLWPOLYLINE\r\n100\r\nAcDbEntity\r\n8\r\nSWITCH\r\n100\r\nAcDbPolyline\r\n90\r\n\d+\r\n70\r\n1\r\n/);
});

test('Cherry Spec：支持 3U 窄槽、竖向长键、翻转、轴孔旋转与任意键区角度',()=>{
  const center=KB.key({x:2,y:3}),cx=center.x*19.05,cy=center.y*19.05;
  const three=KB.plate([KB.key({x:2,y:3,w:3})],{stabilizers:'cherry-spec'});
  near(box(three.polygons[0].points).w,46.482);assert.deepEqual(three.errors,[]);assert.equal(three.polygons.length,1);
  const vertical=KB.plate([KB.key({x:2,y:3,h:2})],{stabilizers:'cherry-spec'}),vb=box(vertical.polygons[0].points);
  near(vb.w,14.7724);near(vb.h,32.182);near(pathArea(vertical.polygons[0].path),pathArea(KB.plate([KB.key({x:2,y:3,w:2})],{stabilizers:'cherry-spec'}).polygons[0].path));
  const flipped=KB.plate([KB.key({x:2,y:3,w:2,stab:'flip'})],{stabilizers:'cherry-spec'}),fb=box(flipped.polygons[0].points);
  near(fb.x,cx-16.091);near(fb.x+fb.w,cx+16.091);near(fb.y,cy-7);near(fb.y+fb.h,cy+7.7724);
  for(const key of [
    KB.key({x:2,y:3,w:2,cutoutRotation:90}),
    KB.key({x:2,y:3,w:2,angle:31,cutoutRotation:270,stab:'flip'})
  ]){
    const p=KB.plate([key],{stabilizers:'cherry-spec',holeRadius:.4,kerf:.2});
    assert.deepEqual(p.errors,[]);assert.equal(p.polygons.length,1);assert.equal(polygonSelfIntersects(p.polygons[0].points),false);
    assert.equal(polygonSelfIntersects(p.toolpaths.polygons[0].path),false);
    const radii=pathRadii(p.toolpaths.polygons[0].path);assert.ok(radii.length>0);assert.ok(radii.every(r=>r<=.300001));
  }
});

test('Cherry Spec：不支持的卫星轴间距显示几何错误，禁止导出不完整板件',()=>{
  const p=KB.plate([KB.key({w:4})],{stabilizers:'cherry-spec'});
  assert.equal(p.polygons.length,1);assert.equal(p.polygons[0].points.length,4);
  assert.ok(p.errors.some(t=>t.includes('4U')&&t.includes('不装卫星轴')));
  assert.throws(()=>KB.dxf(p),/4U/);
});

test('Cherry Spec：内角圆角和切缝补偿作用于合并轮廓，不产生自交或多个重叠刀路',()=>{
  const p=KB.plate([KB.key({w:2})],{stabilizers:'cherry-spec',holeRadius:1,kerf:.2}),hole=p.polygons[0];
  assert.deepEqual(p.errors,[]);assert.equal(p.polygons.length,1);assert.equal(p.toolpaths.polygons.length,1);
  assert.ok(hole.path.length>20);assert.ok(hole.path.some(v=>v.bulge));
  assert.ok(pathRadii(hole.path).every(r=>r<=.400001));assert.ok(pathRadii(p.toolpaths.polygons[0].path).every(r=>r<=.300001));
  assert.equal(polygonSelfIntersects(hole.points),false);assert.equal(polygonSelfIntersects(p.toolpaths.polygons[0].path),false);
  const d=KB.dxf(p);assert.equal((d.match(/\r\n0\r\nLWPOLYLINE\r\n/g)||[]).length,2);
});

test('逐键覆盖：不装卫星轴、翻转 180°、轴孔旋转 90°；旧键位缺少字段时按自动处理',()=>{
  const centreY=h=>h.points.reduce((s,v)=>s+v.y,0)/h.points.length;
  const stabs=k=>KB.plate([k],{stabilizers:'mx-basic'}).polygons.filter(h=>h.layer==='STABILIZER');
  assert.equal(stabs(KB.key({w:2,stab:'none'})).length,0);
  near(centreY(stabs(KB.key({w:2,stab:'flip'}))[0])-19.05/2,-1.5);
  const legacy={...KB.key({w:2})};delete legacy.stab;delete legacy.cutoutRotation;
  near(centreY(stabs(legacy)[0])-19.05/2,1.5);
  const turned=KB.plate([KB.key({cutoutRotation:90})],{cutout:'mx-openable'}).polygons[0];
  near(box(turned.points).w,14);near(box(turned.points).h,15.6);
  const vertical=stabs(KB.key({h:2}));near(Math.abs(vertical[0].points[0].x-vertical[1].points[0].x)>0?1:0,1);
  assert.equal(KB.key().stab,'auto');assert.equal(KB.key().cutoutRotation,0);assert.equal(KB.key().plateOutline,false);
});

test('X / Y 键距分开：Choc 18 × 17 mm 轴心与板框尺寸按各自方向缩放；留空 Y 与 X 相同',()=>{
  const keys=[KB.key({x:1,y:2}),KB.key({x:3,y:2}),KB.key({x:1,y:4})];
  const p=KB.plate(keys,{pitch:18,pitchY:17,hole:13.8,outline:'rectangle'});
  const c=p.polygons[0].points.reduce((s,v)=>({x:s.x+v.x/4,y:s.y+v.y/4}),{x:0,y:0});near(c.x,18);near(c.y,34);
  near(p.bounds.w,2*18+18+8);near(p.bounds.h,2*17+17+8);
  near(KB.plate(keys,{pitch:18,pitchY:null,outline:'rectangle'}).bounds.h,2*18+18+8);
  assert.throws(()=>KB.plate(keys,{pitchY:5}),/纵向键距/);
});

test('示意标记勾选“参与板框”后扩展外框但不开孔，例如 TPS65 区域',()=>{
  const keys=[KB.key({x:0}),KB.key({x:1}),KB.key({x:6,y:0,w:3,h:2.5,decal:true,label:'TPS65'})];
  const plain=KB.plate(keys),wide=KB.plate(keys.map(k=>k.decal?{...k,plateOutline:true}:k));
  assert.ok(wide.bounds.w>plain.bounds.w+50);
  assert.equal(wide.polygons.length,2);assert.deepEqual(wide.errors,[]);
});

test('自动固定孔：矩形板框四角孔心距两边各为设定值，圆角大于孔心距时沿圆弧保持距离，多出的孔放在最长边中点',()=>{
  const keys=Array.from({length:12},(_,i)=>KB.key({x:i%6,y:Math.floor(i/6)}));
  const p=KB.plate(keys,{outline:'rectangle',margin:8,mountHoles:4,mountInset:4,mountDiameter:2.2});
  const b=p.bounds,holes=p.circles.filter(c=>c.auto);
  assert.equal(holes.length,4);assert.deepEqual(p.errors,[]);
  for(const h of holes){near(Math.min(h.x-b.x,b.x+b.w-h.x),4);near(Math.min(h.y-b.y,b.y+b.h-h.y),4);near(h.r,1.1);}
  const R=10,rounded=KB.plate(keys,{outline:'rectangle',margin:8,mountHoles:4,mountInset:4,outlineRadius:R});
  for(const h of rounded.circles){const cx=h.x<b.x+b.w/2?b.x+R:b.x+b.w-R,cy=h.y<b.y+b.h/2?b.y+R:b.y+b.h-R;near(R-Math.hypot(h.x-cx,h.y-cy),4);}
  const six=KB.plate(keys,{outline:'rectangle',margin:8,mountHoles:6}).circles;
  assert.equal(six.length,6);
  assert.equal(six.filter(h=>Math.abs(h.x-(b.x+b.w/2))<1e-6).length,2);
});

test('自动固定孔遇到开孔会沿板边滑开并保持 0.5 mm 料厚；放不下时提示，不静默丢孔',()=>{
  const keys=Array.from({length:12},(_,i)=>KB.key({x:i%6,y:Math.floor(i/6)}));
  const base=KB.plate(keys,{outline:'rectangle',margin:8,mountHoles:4});
  const corner=base.circles[0],block={name:'模块',type:'rect',x:corner.x,y:corner.y,w:6,h:6,angle:0};
  const moved=KB.plate(keys,{outline:'rectangle',margin:8,mountHoles:4},[block]);
  assert.deepEqual(moved.errors,[]);assert.equal(moved.circles.filter(c=>c.auto).length,4);
  for(const c of moved.circles.filter(c=>c.auto))assert.ok(Math.max(Math.abs(c.x-block.x)-3,Math.abs(c.y-block.y)-3)>=c.r+.5-1e-9);
  const crowded=KB.plate(keys,{outline:'rectangle',margin:3,mountHoles:20,mountDiameter:3.2,mountInset:1.6});
  assert.ok(crowded.errors.some(t=>t.includes('找不到空位')));
  assert.throws(()=>KB.plate(keys,{mountHoles:2.5}),/固定孔数量/);
});

test('三明治外壳：中框开口按宽度内缩，USB 开口拼成一条闭合轮廓，固定孔同步到中框和底板',()=>{
  const keys=Array.from({length:12},(_,i)=>KB.key({x:i%6,y:Math.floor(i/6)}));
  const F=6,o={outline:'rectangle',margin:9,mountHoles:4,caseType:'sandwich',frameWidth:F};
  const p=KB.plate(keys,o);
  assert.deepEqual(p.errors,[]);assert.deepEqual(p.parts.map(x=>x.id),['plate','frame','bottom']);
  const frame=p.parts[1],W=p.bounds.w,H=p.bounds.h;
  near(area(frame.holes[0].points),(W-2*F)*(H-2*F));
  assert.equal(frame.circles.length,4);assert.equal(p.parts[2].circles.length,4);
  const usb=KB.plate(keys,{...o,usbWidth:12});
  assert.deepEqual(usb.errors,[]);
  const ring=usb.parts[1];assert.equal(ring.outlines.length,1);assert.equal(ring.holes.length,0);
  near(area(ring.outlines[0]),W*H-(W-2*F)*(H-2*F)-12*F);
  const slot=usb.parts[1].outlines[0].filter(v=>Math.abs(v.y-usb.bounds.y)<1e-6).map(v=>v.x).sort((a,b)=>a-b);
  near(slot[2]-slot[1],12);
  for(const c of usb.circles)assert.ok(Math.abs(c.x-(usb.bounds.x+W/2))>6+c.r);
  assert.ok(KB.plate(keys,{...o,frameWidth:12}).errors.some(t=>t.includes('压到中框')));
  assert.ok(KB.plate(keys,{...o,usbWidth:12,usbX:-500}).errors.some(t=>t.includes('USB')));
});

test('多层 DXF 上下排列不重叠并按图层命名；切缝补偿让中框外扩、开口内缩',()=>{
  const keys=Array.from({length:12},(_,i)=>KB.key({x:i%6,y:Math.floor(i/6)}));
  const p=KB.plate(keys,{outline:'rectangle',margin:9,mountHoles:4,caseType:'sandwich',frameWidth:6,kerf:.2});
  assert.deepEqual(p.errors,[]);
  const d=KB.dxf(p,['plate','frame','bottom']);
  for(const layer of ['OUTLINE','SWITCH','FRAME','FRAME_OPENING','FRAME_MOUNT','BOTTOM','BOTTOM_MOUNT'])assert.match(d,new RegExp(`\\r\\n8\\r\\n${layer}\\r\\n`));
  assert.equal((d.match(/\r\nCIRCLE\r\n/g)||[]).length,12);
  const ys=[...d.matchAll(/\r\n8\r\n(OUTLINE|FRAME|BOTTOM)\r\n[\s\S]*?\r\n20\r\n(-?[\d.]+)/g)].map(m=>[m[1],-Number(m[2])]);
  assert.ok(ys.find(v=>v[0]==='FRAME')[1]>ys.find(v=>v[0]==='OUTLINE')[1]+p.bounds.h);
  const frame=p.parts[1];
  near(box(KB.flatten(frame.toolpaths.outlines[0])).w,p.bounds.w+.2);
  near(box(KB.flatten(frame.toolpaths.polygons[0].path)).w,p.bounds.w-12-.2);
  assert.throws(()=>KB.dxf(KB.plate(keys),['frame']),/外壳/);
  assert.equal(KB.dxf(KB.plate(keys)),KB.dxf(KB.plate(keys),['plate']));
});

test('SVG 导出：毫米单位、按图层分组，圆弧 sweep 与 bulge 方向一致，圆孔为真实圆',()=>{
  const p=KB.plate([KB.key(),KB.key({x:2})],{holeRadius:.5,outlineRadius:3},[{name:'孔',type:'circle',x:19,y:0,w:3,h:3,angle:0}]);
  const s=KB.svg(p);
  assert.match(s,/^<\?xml/);assert.match(s,/width="[\d.]+mm"/);assert.match(s,/<g id="OUTLINE">/);assert.match(s,/<g id="SWITCH">/);
  assert.match(s,/<circle cx="19" cy="0" r="1.5"\/>/);
  const arcs=[...s.matchAll(/A([\d.]+) [\d.]+ 0 (\d) (\d)/g)];
  assert.ok(arcs.length>=8);assert.ok(arcs.every(a=>a[2]==='0'&&a[3]==='1'));
  const hole=p.polygons[0].path;assert.ok(hole.filter(v=>v.bulge).every(v=>v.bulge>0));
  assert.equal((s.match(/<path /g)||[]).length,3);
});

test('500 键配列含开盖缺口、圆角、自动固定孔和三明治外壳仍可快速检查',()=>{
  const keys=Array.from({length:500},(_,i)=>KB.key({x:(i%25)*1.05,y:Math.floor(i/25)*1.05}));
  const started=Date.now(),p=KB.plate(keys,{cutout:'mx-openable',holeRadius:.5,outlineRadius:4,margin:9,mountHoles:8,caseType:'sandwich',usbWidth:12});
  assert.deepEqual(p.errors,[]);assert.equal(p.circles.length,8);
  assert.ok(Date.now()-started<6000,`耗时 ${Date.now()-started} ms`);
});
