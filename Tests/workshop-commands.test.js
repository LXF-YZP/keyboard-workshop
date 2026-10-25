'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const KB=require('../Web/core'),FW=require('../Web/firmware'),C=require('../Web/assistant-core'),W=require('../Web/workshop-commands'),fixture=require('./fixtures/assistant-project');
const clone=p=>JSON.parse(JSON.stringify(p));
const refs=(p,ids=['right-2-0','right-2-1','right-2-2'])=>new Map([['s',C.select(p,{source:'selected',basis:'geometry'},ids)]]);
const op=(type,rest={})=>({type,selection_id:'s',...rest});
const proposal=(p,operations,ids)=>C.geometryProposal(p,{title:'配列测试',operations},refs(p,ids));
test('geometry selection works without firmware and distinguishes hardware side',()=>{
 const p=fixture();p.firmware=null;p.keys.forEach(k=>delete k.fw);
 const r=C.select(p,{side:'right',row:2,basis:'geometry'});assert.deepEqual(r.keys.map(k=>k.id),['right-1-0','right-1-1','right-1-2']);assert.match(r.warning,/不能代表固件/);
 assert.throws(()=>C.select(p,{basis:'firmware',side:'right'}),/尚未配置/);
 p.firmware=fixture().firmware;assert.equal(C.select(p,{basis:'geometry',side:'right'}).keys.length,9);assert.throws(()=>C.select(p,{basis:'firmware',side:'right'}),/明确分体/);
});
test('move is exact, pure, scoped and reports field differences',()=>{
 const p=fixture(),before=clone(p),r=proposal(p,[op('move',{dx:0,dy:-.25})]);
 assert.deepEqual(p,before);for(const k of r.next.keys)assert.equal(k.y,before.keys.find(v=>v.id===k.id).y+(k.id.startsWith('right-2')?-.25:0));
 assert.equal(r.changes.length,3);assert.equal(r.checks.blockingErrors.length,3); // It collides with the row above; preview remains available.
});
test('align uses the requested baseline; individual angle and group rotation differ',()=>{
 const p=fixture(),ids=['left-0-0','left-1-0'];p.keys[3].x=.2;
 const r=proposal(p,[op('align',{axis:'x',reference:'first'})],ids);assert.equal(r.next.keys[3].x,0);
 const a=proposal(p,[op('set_properties',{properties:{angle:90}})],ids),b=proposal(p,[op('rotate',{degrees:90,center:{x:0,y:0}})],ids);
 assert.equal(a.next.keys[3].x,.2);assert.equal(a.next.keys[3].y,1);assert.equal(b.next.keys[3].x,-1);assert.equal(b.next.keys[3].y,.2);assert.equal(b.next.keys[3].angle,90);
});
test('copy preserves ISO compound shape and bindings but assigns new identity and no matrix slot',()=>{
 const p=fixture(),k=p.keys[0];Object.assign(k,{w:1.25,h:2,w2:1.5,h2:1,x2:-.25,y2:1});
 const r=proposal(p,[op('duplicate',{dx:-3,dy:0})],[k.id]),copy=r.next.keys.at(-1);
 assert.notEqual(copy.id,k.id);for(const f of ['w','h','w2','h2','x2','y2'])assert.equal(copy[f],k[f]);
 assert.deepEqual(copy.fw.bindings,k.fw.bindings);assert.equal(copy.fw.row,null);assert.equal(copy.fw.col,null);assert.equal(r.checks.blockingErrors.length,0);assert.ok(r.checks.issues.some(i=>i.module==='firmware'&&i.keyId===copy.id));assert.ok(FW.generate(r.next).errors.length);
 const resize=proposal(p,[op('set_properties',{properties:{h:3,label:'ISO'}})],[k.id]);assert.equal(resize.next.keys[0].h2,1);assert.equal(resize.next.keys[0].labelSource,'manual');
});
test('mirror preserves target metadata and refuses ambiguous matching atomically',()=>{
 const p={keys:[KB.key({id:'l',x:0,y:0,label:'L'}),KB.key({id:'r',x:10,y:.1,label:'R'})],options:{},features:[]};
 let r=W.editLayout(p,[op('mirror',{axis:5})],new Map([['s',{keys:[p.keys[0]]}]]));assert.equal(r.next.keys[1].y,0);assert.equal(r.next.keys[1].label,'R');
 p.keys.push(KB.key({x:10,y:.1}));const before=clone(p);assert.throws(()=>W.editLayout(p,[op('mirror',{axis:5})],new Map([['s',{keys:[p.keys[0]]}]])),/不明确/);assert.deepEqual(p,before);
});
test('duplicate properties edit only the new key and keep the original selection bound to its source',()=>{
 const p=fixture(),r=proposal(p,[op('duplicate',{dx:-2,dy:0,properties:{w:1.5,label:'副本'}})],['left-0-0']);
 assert.deepEqual(r.next.keys.slice(0,p.keys.length),p.keys);assert.equal(r.next.keys.at(-1).w,1.5);
 assert.equal(r.next.keys.at(-1).labelSource,'manual');assert.equal(r.checks.blockingErrors.length,0);
 assert.throws(()=>proposal(p,[op('duplicate',{dx:-2,dy:0,properties:{shell:'evil'}})],['left-0-0']));
});
test('delete reports binding removal and does not renumber other matrix slots',()=>{
 const p=fixture(),r=proposal(p,[op('delete')],['left-0-0']);assert.equal(r.next.keys.length,17);assert.match(r.notes.join(),/1 项层绑定/);assert.equal(r.next.keys[0].fw.col,1);assert.equal(r.changes[0].kind,'delete_key');
 assert.throws(()=>proposal(p,[op('delete')],p.keys.map(k=>k.id)),/1–500/);
});
test('Choc split plate returns actual mounts and supports DXF/SVG from the same draft',()=>{
 const p=fixture(),r=C.plateProposal(p,{title:'Choc',parameters:{cutout:'square',hole:13.8,pitch:18,pitchY:17,margin:5,outline:'split',mountHoles:4,mountDiameter:2.2,mountInset:4}});
 assert.equal(r.checks.blockingErrors.length,0);const info=W.plateInfo(r.next);assert.equal(info.outlineCount,2);assert.equal(info.mounts.length,8);assert.ok(info.mounts.every(m=>m.diameter===2.2&&Number.isFinite(m.x)&&Number.isFinite(m.y)));
 const plate=KB.plate(r.next.keys,r.next.options,r.next.features);assert.match(KB.dxf(plate),/INSUNITS/);assert.match(KB.svg(plate),/<svg/);assert.equal(p.options.pitch,undefined);
});
test('feature commands use mm, assign IDs and validate dimensions and conflicts',()=>{
 const p=fixture(),r=C.plateProposal(p,{title:'开孔',add_features:[{type:'circle',x:70,y:19,w:2.2,name:'圆孔'}]});
 const f=r.next.features[0];assert.equal(f.h,2.2);assert.ok(f.id);assert.equal(r.checks.blockingErrors.length,0);
 const a=W.editPlate(r.next,{update_features:[{id:f.id,w:3.2}]});assert.equal(a.next.features[0].h,3.2);
 assert.equal(W.editPlate(a.next,{delete_features:[f.id]}).next.features.length,0);
 assert.throws(()=>W.editPlate(p,{add_features:[{type:'rect',x:0,y:0,w:20}]}));assert.throws(()=>W.editPlate(p,{parameters:{pitch:0}}));assert.throws(()=>W.editPlate(p,{parameters:{shell:'evil'}}));
});
test('new collisions block application while existing geometry errors remain visible',()=>{
 const p=fixture(),collision=proposal(p,[op('move',{dx:1,dy:0})],['left-0-0']);assert.ok(collision.checks.blockingErrors.length);assert.ok(collision.checks.issues.some(i=>i.module==='layout'));
 const broken=clone(p);broken.keys[0].x=1;const r=proposal(broken,[op('set_properties',{properties:{label:'重命名 与 任意文字'}})],['left-0-0']);assert.ok(r.checks.existingErrors);assert.equal(r.checks.newErrors,0);
 // Deleting a preceding key changes displayed indices, but not the existing pair's identity.
 const d=proposal(broken,[op('delete')],['right-0-0']);assert.equal(d.checks.newErrors,0);
});
test('same-label plate errors retain independent identities when one key is renamed or removed',()=>{
 const p=fixture();p.options.stabilizers='pcb';
 for(const [id,x] of [['left-0-0',-5],['right-0-0',15]])Object.assign(p.keys.find(k=>k.id===id),{x,w:4,label:'Space'});
 const before=W.issues(p).filter(i=>i.module==='plate'&&i.msg.includes('4U 卫星轴'));
 assert.equal(before.length,2);assert.notEqual(before[0].code,before[1].code);
 const renamed=proposal(p,[op('set_properties',{properties:{label:'新名称'}})],['left-0-0']);assert.equal(renamed.checks.newErrors,0);
 const deleted=proposal(p,[op('delete')],['left-0-0']);assert.equal(deleted.checks.newErrors,0);
 assert.ok(deleted.checks.issues.some(i=>i.msg.includes('Space 的 4U')));
});
test('cross-module draft is atomic on failure and yields one combined diff on success',()=>{
 const p=fixture(),before=clone(p),s=refs(p),input={title:'组合',layout:[op('move',{dx:0,dy:1})],plate:{parameters:{hole:13.8}},bindings:{bindings:[{selection_id:'s',layer:0,actions:[{t:'kc',k:'ENT',m:[]}]}]}};
 const r=C.workshopProposal(p,input,s);assert.equal(r.next.options.hole,13.8);assert.equal(r.changes.filter(c=>c.kind==='binding').length,3);assert.equal(r.checks.blockingErrors.length,0);assert.deepEqual(p,before);
 input.plate.parameters.hole=100;assert.throws(()=>C.workshopProposal(p,input,s));assert.deepEqual(p,before);
});
test('reverse retains later names, other keys and unrelated configuration',()=>{
 const p=fixture(),a=proposal(p,[op('move',{dx:0,dy:1})]).next,current=clone(a);current.name='之后改名';current.keys[0].label='之后文字';current.options.margin=6;
 const r=W.reverse(p,a,current);assert.equal(r.name,current.name);assert.equal(r.keys[0].label,'之后文字');assert.equal(r.options.margin,6);assert.equal(r.keys.at(-1).y,p.keys.at(-1).y);
});
test('reverse rejects same-field edits, retains state and can restore deleted key order',()=>{
 const p=fixture(),a=proposal(p,[op('move',{dx:0,dy:1})]).next,current=clone(a);current.keys.at(-1).y+=1;const before=clone(current);assert.throws(()=>W.reverse(p,a,current),/冲突/);assert.deepEqual(current,before);
 const deleted=proposal(p,[op('delete')],['left-0-1']).next;deleted.name='后续';const r=W.reverse(p,proposal(p,[op('delete')],['left-0-1']).next,deleted);assert.deepEqual(r.keys.map(k=>k.id),p.keys.map(k=>k.id));assert.equal(r.name,'后续');
});
test('reverse removes a copied key only if it has not been subsequently edited',()=>{
 const p=fixture(),a=proposal(p,[op('duplicate',{dx:-3,dy:0})],['left-0-0']).next,current=clone(a);current.name='保留';assert.equal(W.reverse(p,a,current).keys.length,18);
 current.keys.at(-1).label='已改过';assert.throws(()=>W.reverse(p,a,current),/冲突/);
});
test('strict command contracts reject unknown fields, nonfinite values and expired selections',()=>{
 const p=fixture();for(const input of [op('move',{dx:NaN}),op('move',{dx:Infinity}),op('move',{dx:1,shell:'evil'}),op('set_properties',{properties:{state:{}}}),op('set_properties',{properties:{color:'url(evil)'}}),op('rotate',{degrees:12,center:{x:0}})])assert.throws(()=>proposal(p,[input]));
 assert.throws(()=>W.editLayout(p,[op('move',{dx:1})],new Map()),/失效/);assert.throws(()=>W.editPlate(p,{update_features:[{id:'missing',w:2}]}),/不存在/);
});
test('inspection paginates keys and exposes only implemented capabilities and plate geometry',()=>{
 const p=fixture();assert.equal(C.inspect(p,{section:'keys',offset:0}).keys.length,18);assert.equal(C.inspect(p,{section:'keys',offset:18}).keys.length,0);assert.throws(()=>C.inspect(p,{section:'keys',offset:-1}));
 assert.match(C.inspect(p,{section:'capabilities'}).requiresUser.join(),/GitHub/);assert.equal(C.inspect(p,{section:'plate'}).errors.length,0);assert.deepEqual(C.inspect(p,{section:'features'}).features,[]);
 p.keys[0].label='Space';p.keys[0].fw.bindings[0]={t:'none'};
 assert.deepEqual(W.issues(p).filter(i=>i.module==='firmware').map(({module,level,code,...i})=>i),[...FW.validate(p).errors,...FW.validate(p).warnings]);
});
