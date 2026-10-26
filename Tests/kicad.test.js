'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const K=require('../Web/kicad'),KB=require('../Web/core'),FW=require('../Web/firmware');
function project(split=false){
  const f=FW.sanitizeFirmware({target:'qmk',controller:'rp2040',id:'kicad_test',displayName:'KiCad Test',rows:2,cols:2,rowPins:[26,27],colPins:[0,1],diode:'col2row'});
  if(split){FW.enableSplit(f,true);Object.assign(f.split,{serialMode:'full_duplex',serialPin:8,serialRxPin:9,right:{rowPins:[26,27],colPins:[0,1]}});}
  const keys=(split?['left','right']:['single']).flatMap(side=>Array.from({length:4},(_,i)=>KB.key({id:side+i,label:'K'+i,x:i%2+(side==='right'?7:0),y:Math.floor(i/2),fw:{side:side==='single'?undefined:side,row:Math.floor(i/2),col:i%2,bindings:[{t:'kc',k:'A',m:[]}]}})));
  return {version:1,name:'测试键盘',keys,features:[],options:{...KB.defaults,outline:split?'split':'rectangle'},firmware:f};
}
const child=K.child,children=K.children,value=K.value;
const prop=(node,key)=>value(children(node,'property').find(p=>value(p[1])===key)[2]);
const output=(g,ext)=>g.files.filter(f=>f.path.endsWith(ext));
const board=g=>K.parse(output(g,'.kicad_pcb')[0].content);
const footprints=g=>children(board(g),'footprint').filter(f=>child(f,'path'));
const pads=fp=>Object.fromEntries(children(fp,'pad').filter(p=>value(p[1])).map(p=>[value(p[1]),child(p,'net')&&!value(child(p,'net')[2]).startsWith('unconnected-(')?value(child(p,'net')[2]).replace(/^\//,''):null]));
function get(g,ref){return footprints(g).find(f=>prop(f,'Reference')===ref);}
function allUUIDs(node){return node.flatMap(x=>Array.isArray(x)?x[0]==='uuid'?[value(x[1])]:allUUIDs(x):[]);}
test('KiCad exports complete project-local libraries, source snapshot and matching symbol paths without mutating source',()=>{
 const p=project();p.image={data:'private-screenshot',name:'shot'};const before=JSON.stringify(p),g=K.generate(p);
 assert.deepEqual(g.errors,[]);assert.equal(JSON.stringify(p),before);
 for(const suffix of ['.kicad_pro','.kicad_sch','.kicad_pcb','fp-lib-table','sym-lib-table','Workshop.kicad_sym','key-map.csv','pin-map.csv','bom.csv','LIBRARY-LICENSE.md','README.md'])assert.equal(output(g,suffix).length,1,suffix);
 assert.equal(JSON.parse(output(g,'source.keyboard.json')[0].content).image,null);
 assert.equal(footprints(g).length,9);
 const sch=K.parse(output(g,'.kicad_sch')[0].content),symbols=children(sch,'symbol'),root=value(child(sch,'uuid')[1]);
 for(const fp of footprints(g)){const ref=prop(fp,'Reference'),sym=symbols.find(s=>prop(s,'Reference')===ref);assert.ok(sym,ref);assert.equal(value(child(fp,'path')[1]),'/'+root+'/'+value(child(sym,'uuid')[1]));assert.equal(prop(sym,'Footprint'),value(fp[1]));}
 for(const file of g.files.filter(f=>/kicad_(sch|pcb|mod|sym)$|lib-table$/.test(f.path))){const tree=K.parse(file.content),ids=allUUIDs(tree);assert.equal(ids.length,new Set(ids).size,file.path+' unique instance IDs');}
 assert.equal(children(board(g),'segment').length,0);assert.equal(children(board(g),'via').length,0);
});
test('KiCad maps Pico GPIO26/27 to physical pads31/32 and maintains diode cathode for both scan directions',()=>{
 for(const direction of ['col2row','row2col']){
  const p=project();p.firmware.diode=direction;const g=K.generate(p),module=pads(get(g,'U1')),sw=pads(get(g,'SW1')),d=pads(get(g,'D1'));
  assert.equal(module[31],'ROW0');assert.equal(module[32],'ROW1');assert.equal(module[1],'COL0');assert.equal(module[2],'COL1');assert.equal(module[26],null);
  assert.equal(sw[1],'ROW0');assert.equal(sw[2],'KEY1');assert.equal(d[1],direction==='col2row'?'KEY1':'COL0');assert.equal(d[2],direction==='col2row'?'COL0':'KEY1');
 }
});
test('KiCad rotations place the actual MX shaft at the configured centre with asymmetric XY pitch',()=>{
 for(const angle of [0,15,-30,90,180]){
  const p=project();p.keys=p.keys.slice(0,1);p.keys[0].angle=angle;p.keys[0].cutoutRotation=90;p.keys[0].x=-3;p.keys[0].y=2;p.options.pitch=18;p.options.pitchY=17;
  const g=K.generate(p);assert.deepEqual(g.errors,[]);const fp=get(g,'SW1'),at=child(fp,'at'),a=Number(at[3]),offset=KB.rotate(-2.54,5.08,-a),expected=g.models[0].mapping[0];
  assert.ok(Math.abs(Number(at[1])+offset.x-expected.x)<.0001);assert.ok(Math.abs(Number(at[2])+offset.y-expected.y)<.0001);assert.equal(a,-(angle+90));
 }
});
test('split projects remain independent, preserve repeated local GPIOs and cross TX/RX at the same connector contacts',()=>{
 const p=project(true),g=K.generate(p);assert.deepEqual(g.errors,[]);assert.equal(output(g,'.kicad_pcb').length,2);
 const halves=g.models;assert.deepEqual(halves.map(m=>m.side),['left','right']);
 const left=halves[0].components.find(c=>c.ref==='U1'),right=halves[1].components.find(c=>c.ref==='U1');
 assert.equal(left.nets[K.gpioPads[8]],right.nets[K.gpioPads[9]]);assert.equal(left.nets[K.gpioPads[9]],right.nets[K.gpioPads[8]]);
 assert.equal(left.nets[31],'left_ROW0');assert.equal(right.nets[31],'right_ROW0');
 assert.deepEqual(halves[0].components.find(c=>c.ref==='J1').nets,halves[1].components.find(c=>c.ref==='J1').nets);
 p.firmware.split.serialMode='half_duplex';const half=K.generate(p);assert.equal(half.models[0].components.find(c=>c.ref==='J1').nets[4],null);
});
test('KiCad blocks unsupported modules, unavailable Pico GPIOs, missing assignments and pin collisions',()=>{
 for(const change of [p=>p.firmware.controller='promicro_rp2040',p=>p.firmware.rowPins[0]=29,p=>p.firmware.rowPins[0]=25,p=>p.firmware.rowPins[0]=null,p=>p.firmware.colPins[0]=26,p=>p.keys[0].fw.row=null,p=>p.keys[0].fw.col=9,p=>p.keys[1].fw.col=0,p=>p.firmware.diode='unknown']){
  const p=project();change(p);const g=K.generate(p);assert.ok(g.errors.length);assert.equal(g.files.length,0);
 }
 const p=project(true);p.firmware.split.serialRxPin=26;assert.ok(K.generate(p).errors.some(e=>e.includes('同时')));
 p.firmware.split.serialRxPin=9;p.firmware.split.pointing.enabled=true;assert.ok(K.generate(p).errors.some(e=>e.includes('触控板')));
 assert.ok(K.generate(project(),{diode:'custom'}).errors.length);assert.ok(K.generate(project(),{extra:'not allowed'}).errors.length);
});
test('KiCad draft permits unbound keycodes and USB ID errors because matrix connectivity is independent',()=>{
 const p=project();p.firmware.usb={vid:'bad value',pid:'bad value'};p.keys[0].fw.bindings=[{t:'none'}];assert.deepEqual(K.generate(p).errors,[]);
});
test('KiCad board outlines ignore laser kerf, exclude decals, and never copy plate switch cutouts to Edge.Cuts',()=>{
 const p=project();p.keys.push(KB.key({id:'decal',decal:true,label:'TPS65',x:50,y:50}));p.options.kerf=.8;
 const g=K.generate(p);assert.deepEqual(g.errors,[]);assert.equal(g.models[0].mapping.length,4);assert.equal(children(board(g),'gr_line').length,g.models[0].geometry.outline.length);
 p.options.kerf=0;assert.deepEqual(K.generate(p).models[0].geometry.outline,g.models[0].geometry.outline);
});
test('KiCad custom circular mounts are NPTH, rectangular openings are reference-only, and unsafe outline splitting blocks',()=>{
 const p=project();p.options.margin=12;p.features=[{id:'hole',type:'circle',x:-12,y:0,w:2.2,h:2.2,angle:0},{id:'rect',type:'rect',x:8,y:8,w:2,h:3,angle:30}];
 const g=K.generate(p);assert.deepEqual(g.errors,[]);const mounts=children(board(g),'footprint').filter(f=>value(f[1])==='Workshop:MountingHole');assert.equal(mounts.length,1);assert.equal(child(mounts[0],'pad')[2],'np_thru_hole');
 assert.equal(children(board(g),'gr_line').filter(l=>value(child(l,'layer')[1])==='Dwgs.User').length,4);
 assert.equal(children(board(K.generate(p,{mounts:false})),'footprint').filter(f=>value(f[1])==='Workshop:MountingHole').length,0);
 const split=project(true);split.options.outline='capture';assert.ok(K.generate(split).errors.length);
});
test('KiCad refuses key-following outlines with internal void cut paths',()=>{
 const p=project();p.options.outline='contour';p.options.margin=2.9;p.keys=[];p.firmware.rows=3;p.firmware.cols=3;p.firmware.rowPins=[26,27,28];p.firmware.colPins=[0,1,4];
 for(let y=0;y<3;y++)for(let x=0;x<3;x++)if(x!==1||y!==1)p.keys.push(KB.key({id:`k${x}${y}`,x,y,label:'K',fw:{row:y,col:x,bindings:[{t:'kc',k:'A',m:[]}]}}));
 const g=K.generate(p);assert.ok(g.errors.some(e=>e.includes('板框内部空区切割')));
});
test('KiCad text quoting cannot inject expressions and DO35 placement preserves anode/cathode numbering',()=>{
 const p=project();p.keys[0].label='" ) (net 99 "恶意") \\';const g=K.generate(p,{diode:'do35'});assert.deepEqual(g.errors,[]);
 assert.equal(prop(get(g,'SW1'),'Value'),p.keys[0].label);assert.equal(pads(get(g,'D1'))[1],'KEY1');assert.equal(pads(get(g,'D1'))[2],'COL0');assert.equal(children(board(g),'net').length,g.models[0].nets.size+1);
 assert.deepEqual(K.generate(p,{diode:'do35'}).files,g.files,'deterministic regeneration');
});
module.exports={project};
