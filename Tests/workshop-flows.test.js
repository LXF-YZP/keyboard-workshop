'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../Web/workshop-flows'),C=require('../Web/assistant-core'),W=require('../Web/workshop-commands'),FW=require('../Web/firmware'),KB=require('../Web/core'),fixture=require('./fixtures/assistant-project');
const proposal=(p,input,refs=new Map())=>C.firmwareProposal(p,{title:'配置草稿',...input},refs);
const refs=p=>new Map([['s',C.select(p,{side:'right',row:3})]]);
test('flows: GPIO names distinguish native GP26 from compatible board index',()=>{
 assert.equal(F.pin({controller:'rp2040'},'GP26'),26);
 assert.equal(F.pin({controller:'promicro_rp2040'},'GP26'),18);
 assert.throws(()=>F.pin({controller:'promicro_rp2040'},26),/显示名称/);
 assert.equal(F.pin({controller:'promicro_rp2040'},'GP29'),21);
 assert.throws(()=>F.pin({controller:'promicro_rp2040'},'GP11'),/没有引脚/);
});
test('flows: complete left/right pins and full duplex export actual requested GPIO',()=>{
 const p=fixture(),before=JSON.stringify(p),r=proposal(p,{split:{master:'right',serial_mode:'full_duplex',tx:'GP8',rx:'GP9'},pins:[{side:'right',rows:['GP10','GP11','GP12'],cols:['GP13','GP14','GP15']}]});
 assert.equal(JSON.stringify(p),before);assert.equal(r.checks.blockingErrors.length,0);
 const generated=FW.generate(r.next);assert.deepEqual(generated.errors,[]);
 assert.match(generated.files.map(f=>f.content).join('\n'),/GP9/);assert.match(generated.files.map(f=>f.content).join('\n'),/GP15/);
 assert.equal(r.next.firmware.split.master,'right');assert.deepEqual(r.next.firmware.rowPins,[0,1,2]);
});
test('flows: new firmware may be applied in stages, incomplete wiring still prevents export',()=>{
 const p=fixture();p.firmware=null;p.keys.forEach(k=>delete k.fw);
 const r=proposal(p,{target:'qmk',controller:'rp2040',rows:3,cols:3,split:{enabled:true}});
 assert.equal(r.checks.blockingErrors.length,0);assert.ok(r.checks.incompleteErrors>0);assert.ok(FW.generate(r.next).errors.length>0);
 assert.ok(r.checks.issues.filter(i=>i.level==='error').every(i=>i.incomplete));
});
test('flows: full duplex can await RX without allowing collisions or wrong target',()=>{
 const p=fixture(),r=proposal(p,{split:{serial_mode:'full_duplex',rx:null}});
 assert.equal(r.checks.blockingErrors.length,0);assert.ok(r.checks.incompleteErrors>0);
 assert.ok(proposal(p,{split:{serial_mode:'full_duplex',rx:'GP6'}}).checks.blockingErrors.some(i=>/重复/.test(i.msg)));
 assert.ok(proposal(p,{target:'zmk'}).checks.blockingErrors.some(i=>/RP2040/.test(i.msg)));
});
test('flows: invalid counts, wrong type, unsupported GPIO and hidden fields fail atomically',()=>{
 const p=fixture(),before=JSON.stringify(p);
 for(const input of [{pins:[{rows:['GP0']}]},{pins:[{rows:[0,1,2]}]},{pins:[{side:'right'},{side:'right'}]},{rows:1.5},{split:{enabled:'true'}},{usb:{vid:'0x12345'}},{controller:'custom'},{command:'shell'}])assert.throws(()=>proposal(p,input));
 assert.equal(JSON.stringify(p),before);
});
test('flows: controller migration retains physical RP2040 GPIO and clears unavailable pins',()=>{
 const p=fixture();p.firmware.rowPins=[26,29,11];
 const r=proposal(p,{controller:'promicro_rp2040'});
 assert.deepEqual(r.next.firmware.rowPins,[18,21,null]);assert.equal(r.checks.blockingErrors.length,0);
 assert.match(r.notes.join(''),/清空/);assert.ok(r.changes.some(c=>/rowPins/.test(c.field)));
});
test('flows: USB IDs are normalized and written to generated firmware',()=>{
 const r=proposal(fixture(),{usb:{vid:'1234',pid:'abcd'}});assert.deepEqual(r.next.firmware.usb,{vid:'0x1234',pid:'0xABCD'});
 const data=FW.generate(r.next).files.map(f=>f.content).join('\n');assert.match(data,/0x1234/);assert.match(data,/0xABCD/);
});
test('flows: matrix mapping checks same-side collision, range and selection cardinality',()=>{
 const p=fixture(),map=refs(p);
 const r=proposal(p,{assignments:[{selection_id:'s',side:'right',positions:[{row:2,col:2},{row:2,col:1},{row:2,col:0}]}]},map);
 assert.equal(r.checks.blockingErrors.length,0);assert.deepEqual(r.next.keys.slice(-3).map(k=>k.fw.col),[2,1,0]);
 assert.ok(proposal(p,{assignments:[{selection_id:'s',positions:Array(3).fill({row:0,col:0})}]},map).checks.blockingErrors.length);
 assert.throws(()=>proposal(p,{assignments:[{selection_id:'s',positions:[{row:4,col:0}]}]},map));
 assert.throws(()=>proposal(p,{assignments:[{selection_id:'expired'}]},map));
});
test('flows: automatic matrix explicitly remains a logical suggestion',()=>{
 const p=fixture();p.keys.forEach(k=>{k.fw.side=null;k.fw.row=null;k.fw.col=null;});
 assert.throws(()=>proposal(p,{suggest_matrix:true}),/左右手/);
 const r=proposal(p,{suggest_sides:true,suggest_matrix:true});assert.equal(r.checks.blockingErrors.length,0);assert.match(r.notes.join(''),/不代表 PCB/);
});
test('flows: base population preserves manual bindings',()=>{
 const p=fixture();p.keys[0].label='Enter';p.keys[0].fw.baseBindingManual=true;
 p.keys[1].label='Space';p.keys[1].fw.bindings[0]={t:'none'};
 const r=proposal(p,{populate_base:true});assert.equal(r.next.keys[0].fw.bindings[0].k,'A');assert.equal(r.next.keys[1].fw.bindings[0].k,'SPC');
});
test('flows: groups use selected identity, can be renamed by set/delete and clean deleted members',()=>{
 const p=fixture(),map=refs(p),next=F.editGroups(p,[{type:'set',name:'右拇指',selection_id:'s'}],map);
 assert.deepEqual(C.select(next,{group:'右拇指'}).keys.map(k=>k.id),p.keys.slice(-3).map(k=>k.id));
 next.keys.pop();F.cleanGroups(next);assert.equal(next.groups[0].keyIds.length,2);
 const removed=F.editGroups(next,[{type:'delete',name:'右拇指'}],map);assert.deepEqual(removed.groups,[]);
 assert.throws(()=>F.editGroups(p,[{type:'set',name:'x',selection_id:'stale'}],map));
});
test('flows: combined layout, groups and firmware failure never partially mutates project',()=>{
 const p=fixture(),before=JSON.stringify(p);assert.throws(()=>C.workshopProposal(p,{title:'失败',layout:[{type:'move',selection_id:'s',dy:.2}],firmware:{usb:{vid:'bad-id'}}},refs(p)));assert.equal(JSON.stringify(p),before);
});
test('flows: derived proposal preserves original intent and shows its actual changes',()=>{
 const p=fixture(),r=C.workshopProposal(p,{title:'派生 Choc',save_as:'Choc 版',plate:{parameters:{hole:13.8}}},new Map());
 assert.equal(r.preserveOriginal,true);assert.equal(r.next.name,'Choc 版');assert.notEqual(p.name,r.next.name);assert.equal(r.next.options.hole,13.8);
 assert.throws(()=>C.workshopProposal(p,{title:'冲突',save_as:'a',project_name:'b'},new Map()));
});
function recognitionFixture(){const p=fixture();p.image={pitch:20,originX:100,originY:80};p.groups=[{name:'人工组',keyIds:[p.keys[0].id]}];p.keys[0].label='手动';p.keys[0].labelSource='manual';return p;}
function result(keys){return {pitch:20,originX:100,originY:80,keys:keys.map((k,i)=>({...k,id:'recognized-'+i,label:'识别',labelSource:'recognized',fw:undefined}))};}
test('flows: recognition uniquely matches image coordinates preserving manual data and groups',()=>{
 const p=recognitionFixture(),input=result(p.keys),r=F.migrateRecognition(p,input);
 assert.deepEqual(r.keys.map(k=>k.id),p.keys.map(k=>k.id));assert.equal(r.keys[0].label,'手动');assert.deepEqual(r.keys[0].fw,p.keys[0].fw);assert.deepEqual(r.groups,p.groups);assert.equal(r.idMap['recognized-0'],p.keys[0].id);
 const shifted=result(p.keys);shifted.originX+=20;shifted.keys.forEach(k=>k.x--);assert.equal(F.migrateRecognition(p,shifted).keys[0].id,p.keys[0].id);
});
test('flows: ambiguous or competing recognized keys never inherit wiring',()=>{
 const p=recognitionFixture();p.keys=[p.keys[0],{...p.keys[0],id:'near',x:.12}];
 let r=F.migrateRecognition(p,result([{...p.keys[0],x:.06}]));assert.equal(r.keys[0].fw,undefined);assert.equal(r.groups.length,0);
 p.keys=[p.keys[0]];r=F.migrateRecognition(p,result([p.keys[0],{...p.keys[0],x:.05}]));assert.ok(r.keys.every(k=>!k.fw));
});
test('flows: new image never copies previous firmware identities or groups',()=>{
 const p=recognitionFixture(),r=F.migrateRecognition(p,result(p.keys),true);assert.ok(r.keys.every(k=>!k.fw&&!p.keys.some(old=>old.id===k.id)));assert.deepEqual(r.groups,[]);assert.match(r.notes[0],/新图片/);
});
test('flows: recognition difference reports manual-source and captured-outline changes',()=>{
 const p=fixture(),next=C.clone(p);next.keys[0].labelSource='manual';next.options.outlinePoints=[{x:0,y:0},{x:10,y:0},{x:10,y:10}];
 const changes=W.diff(p,next);assert.ok(changes.some(c=>c.field==='labelSource'));assert.ok(changes.some(c=>c.field==='outlinePoints'));
});
