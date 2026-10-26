'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const FW=require('../Web/firmware'),KB=require('../Web/core');
function project(target='qmk'){
  return {options:{},firmware:{version:1,target,id:'test_board',displayName:'Test Board',controller:target==='qmk'?'promicro_avr':'nice_nano_v2',rows:2,cols:3,rowPins:[21,20],colPins:[0,1,2],diode:'col2row',layers:[{name:'Base'},{name:'Lower'}]},keys:[KB.key({id:'b',label:'B',x:2,y:2,fw:{row:1,col:2,bindings:[{t:'kc',k:'B',m:[]},{t:'trans'}]}}),KB.key({id:'a',label:'A',x:1,y:1,fw:{row:0,col:0,bindings:[{t:'kc',k:'A',m:[]},{t:'mo',l:0}]}}),KB.key({id:'decal',label:'TPS65',decal:true})]};
}
const file=(p,name)=>{const result=FW.generate(p);assert.deepEqual(result.errors,[]);return result.files.find(f=>f.path.endsWith(name)).content;};
test('legacy projects retain target USB defaults without adding saved fields',()=>{
  for(const target of ['qmk','zmk']){
    const p=project(target),before=JSON.stringify(p);
    assert.ok(!('usb' in FW.normalizeProject(p).firmware));
    if(target==='qmk')assert.deepEqual(JSON.parse(file(p,'keyboard.json')).usb,{vid:'0xFEED',pid:'0x0000',device_version:'1.0.0'});
    else assert.match(file(p,'test_board.conf'),/CONFIG_USB_DEVICE_VID=0x1D50\nCONFIG_USB_DEVICE_PID=0x615E\n/);
    assert.equal(JSON.stringify(p),before);
  }
});
test('matrix wiring SVG reflects actual pins, key addresses and COL2ROW direction with escaped legends',()=>{
  const p=project();p.name='Board & <test>';p.keys[0].label='A & B';
  const svg=FW.wiringDiagram(p);
  for(const term of ['<svg xmlns="http://www.w3.org/2000/svg"','Board &amp; &lt;test&gt;','COL2ROW','A3 / 21','RX / D0','R1 / C2','A &amp; B','二极管阴极标记朝 R','接线参考图'])assert.ok(svg.includes(term),term);
  assert.ok(!svg.includes('A & B'));
  p.firmware.diode='row2col';const reversed=FW.wiringDiagram(p);
  assert.ok(reversed.includes('ROW2COL')&&reversed.includes('二极管阴极标记朝 C'));
  assert.notEqual(reversed,svg);
});
test('matrix wiring SVG preserves incomplete assignments as explicit draft callouts',()=>{
  const p=project();p.firmware.rowPins=[null];p.firmware.colPins=[null,null,null];p.keys[0].fw.row=null;p.keys[0].label='未定位键';
  const svg=FW.wiringDiagram(p);
  for(const term of ['草稿图','GPIO 未分配','未定位 / 超出矩阵的按键','未定位键','未分配'])assert.ok(svg.includes(term),term);
  assert.ok(!svg.includes('firmware.errors'));
});
test('custom USB IDs normalize, survive project round trip and export for both targets',()=>{
  for(const target of ['qmk','zmk']){
    const p=project(target);p.firmware.usb={vid:' fEd ',pid:'0Xa'};
    const saved=FW.normalizeProject(JSON.parse(JSON.stringify(p)));
    assert.deepEqual(saved.firmware.usb,{vid:'0x0FED',pid:'0x000A'});
    assert.deepEqual(FW.normalizeProject(JSON.parse(JSON.stringify(saved))),saved);
    saved.firmware.usb.pid='0xFFFF';assert.equal(p.firmware.usb.pid,'0Xa');
    if(target==='qmk')assert.deepEqual(JSON.parse(file(p,'keyboard.json')).usb,{vid:'0x0FED',pid:'0x000A',device_version:'1.0.0'});
    else assert.match(file(p,'test_board.conf'),/CONFIG_USB_DEVICE_VID=0x0FED\nCONFIG_USB_DEVICE_PID=0x000A\n/);
    assert.match(file(p,'README.md'),/USB VID：0x0FED，PID：0x000A/);
    for(const value of ['0','0x0','ffff','0XFFFF'])assert.notEqual(FW.normalizeUsbId(value),null);
  }
});
test('invalid USB IDs remain invalid across reopen and block file generation',()=>{
  for(const target of ['qmk','zmk'])for(const prop of ['vid','pid'])for(const value of ['', '0x', '10000','0x10000','GGGG','-1','1.2','12 34','0x1234\nCONFIG_USB=n',1234,null,[],{}]){
    const p=project(target);p.firmware.usb={vid:'0xFEED',pid:'0x0001',[prop]:value};
    for(const check of [p,FW.normalizeProject(JSON.parse(JSON.stringify(p)))]){
      assert.ok(FW.validate(check).errors.some(e=>e.msg.includes('USB '+prop.toUpperCase())),String(value));
      assert.equal(FW.generate(check).files.length,0);
    }
  }
  for(const usb of [null,[],false,'0x1234']){
    const p=project();p.firmware.usb=usb;
    assert.equal(FW.generate(p).files.length,0);assert.equal(FW.generate(FW.normalizeProject(p)).files.length,0);
  }
});
test('RP2040 displayed GPIO matches official QMK converter and ZMK connector for every exported pin',()=>{
  const reference=name=>fs.readFileSync(path.join(__dirname,'fixtures/reference',name),'utf8');
  const qmkMap=Object.fromEntries([...reference('qmk-0.34.7-sparkfun-pm2040-pins.h').matchAll(/^#define (\w+) (\d+)U/gm)].map(([,pin,gp])=>[pin,Number(gp)]));
  const zmkMap=Object.fromEntries([...reference('zmk-zephyr-sparkfun-pro-micro-connector.dtsi').matchAll(/<(\d+) 0 &gpio0 (\d+) 0>/g)].map(([,pin,gp])=>[pin,Number(gp)]));
  const options=FW.pinOptions('promicro_rp2040'),display=new Map(options.map(o=>[o.value,Number(o.label.slice(2))]));
  assert.equal(display.size,18);assert.equal(new Set(display.values()).size,18);
  assert.deepEqual([...display.values()],[...display.values()].sort((a,b)=>a-b));
  const p=project();p.firmware.controller='promicro_rp2040';p.firmware.rows=1;p.firmware.cols=17;p.firmware.rowPins=FW.GPIO.slice(0,1);p.firmware.colPins=FW.GPIO.slice(1);p.keys[0].fw.row=0;
  const keyboard=JSON.parse(file(p,'keyboard.json')),qmkPins=[...keyboard.matrix_pins.rows,...keyboard.matrix_pins.cols];
  p.firmware.target='zmk';const overlay=file(p,'.overlay'),zmkPins=[...overlay.matchAll(/<&pro_micro (\d+) /g)].map(m=>Number(m[1]));
  assert.deepEqual(zmkPins,FW.GPIO);
  FW.GPIO.forEach((pin,i)=>{assert.equal(display.get(pin),qmkMap[qmkPins[i]],'QMK interface '+pin);assert.equal(display.get(pin),zmkMap[zmkPins[i]],'ZMK interface '+pin);});
});
test('RP2040 legacy connector values survive save/reopen, board switch and GPIO option sorting',()=>{
  const p=project();p.firmware.controller='promicro_rp2040';p.firmware.rowPins=[18,20];
  const out=FW.normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(out.firmware.rowPins,[18,20]);assert.equal(FW.pinOptions(out.firmware.controller).find(o=>o.value===18).label,'GP26');
  assert.equal(FW.pinOptions('promicro_avr').find(o=>o.value===18).label,'A0 / 18');
  assert.deepEqual(FW.pinOptions('nice_nano_v2').map(o=>o.value),FW.GPIO);
  out.firmware.controller='promicro_avr';out.firmware.controller='promicro_rp2040';assert.deepEqual(out.firmware.rowPins,[18,20]);
});
test('QMK JSON and all outputs use sorted matrix order; decal is excluded',()=>{const p=project(),keyboard=JSON.parse(file(p,'keyboard.json')),keymap=JSON.parse(file(p,'keymap.json'));assert.deepEqual(keyboard.layouts.LAYOUT.layout.map(k=>k.matrix),[[0,0],[1,2]]);assert.deepEqual(keymap.layers,[['KC_A','KC_B'],['MO(0)','KC_TRNS']]);const z=project('zmk'),overlay=file(z,'.overlay'),bindings=file(z,'.keymap');assert.match(overlay,/map = <RC\(0, 0\) RC\(1, 2\)>/);assert.equal((overlay.match(/<&key_physical_attrs/g)||[]).length,2);assert.match(bindings,/bindings = <&kp A &kp B>/);});
test('QMK export includes valid VIA and Vial layout definitions and firmware support',()=>{
  const p=project(),generated=FW.generate(p),files=new Map(generated.files.map(f=>[f.path,f.content]));
  const read=suffix=>JSON.parse(generated.files.find(f=>f.path.endsWith(suffix)).content);
  const keyboard=read('/keyboard.json'),via=read('/via.json'),vial=read('/keymaps/vial/vial.json');
  assert.equal(keyboard.features.via,true);assert.match(files.get('keyboards/handwired/test_board/rules.mk'),/^VIA_ENABLE = yes/m);
  assert.deepEqual(via.matrix,{rows:2,cols:3});assert.equal(via.vendorId,'0xFEED');assert.equal(via.productId,'0x0000');
  assert.deepEqual(vial,via);assert.deepEqual(via.layouts.keymap.map(row=>row.at(-1)),['0,0','1,2']);
  const parsed=KB.parseKLE(JSON.stringify(via.layouts.keymap)).keys;
  for(const item of keyboard.layouts.LAYOUT.layout){
    const key=parsed.find(k=>k.label===item.matrix.join(','));assert.ok(key,'VIA key '+item.matrix);
    assert.ok(Math.abs(key.x-(item.r===undefined?item.x+item.w/2:item.rx))<.001);
    assert.ok(Math.abs(key.y-(item.r===undefined?item.y+item.h/2:item.ry))<.001);
    assert.equal(key.angle,item.r||0);
  }
  const vialKeymap=files.get('keyboards/handwired/test_board/keymaps/vial/keymap.c');
  assert.match(vialKeymap,/\[0\] = LAYOUT\([\s\S]*KC_A,[\s\S]*KC_B/);assert.match(vialKeymap,/\[1\] = LAYOUT\([\s\S]*MO\(0\),[\s\S]*KC_TRNS/);
  const config=files.get('keyboards/handwired/test_board/keymaps/vial/config.h');
  assert.match(config,/VIAL_KEYBOARD_UID \{(?:0x[0-9A-F]{2}, ){7}0x[0-9A-F]{2}\}/);
  assert.match(config,/VIAL_UNLOCK_COMBO_ROWS \{ \d+, \d+ \}/);assert.match(config,/VIAL_UNLOCK_COMBO_COLS \{ \d+, \d+ \}/);
  assert.match(files.get('keyboards/handwired/test_board/keymaps/vial/rules.mk'),/VIAL_ENABLE = yes/);
  assert.match(files.get('.github/workflows/build.yml'),/Compile Vial firmware/);
});
test('split VIA/Vial definitions use the combined matrix row addresses',()=>{
  const p=project();p.firmware.controller='rp2040';p.firmware.rows=1;p.firmware.cols=2;p.firmware.rowPins=[4];p.firmware.colPins=[5,6];
  FW.enableSplit(p.firmware,true);p.firmware.split.serialPin=10;p.firmware.split.right={rowPins:[7],colPins:[8,9]};
  p.keys[0].fw={side:'left',row:0,col:0,bindings:[{t:'kc',k:'A',m:[]},{t:'trans'}]};
  p.keys[1].fw={side:'right',row:0,col:0,bindings:[{t:'kc',k:'B',m:[]},{t:'trans'}]};
  const generated=FW.generate(p);assert.deepEqual(generated.errors,[]);
  const get=suffix=>JSON.parse(generated.files.find(f=>f.path.endsWith(suffix)).content);
  for(const suffix of ['/via.json','/keymaps/vial/vial.json']){
    const def=get(suffix);assert.deepEqual(def.matrix,{rows:2,cols:2});
    assert.deepEqual(def.layouts.keymap.map(row=>row.at(-1)),['0,0','1,0']);
  }
  const config=generated.files.find(f=>f.path.endsWith('/keymaps/vial/config.h')).content;
  assert.match(config,/VIAL_UNLOCK_COMBO_ROWS \{ 0, 1 \}/);
});
for(const angle of [0,15,-30,90])test(`physical coordinates and nonnegative placement at ${angle} degrees`,()=>{const p=project();p.keys[0].angle=angle;p.keys[0].x=-4;p.keys[0].y=-2;p.keys[0].w=2;const attrs=JSON.parse(file(p,'keyboard.json')).layouts.LAYOUT.layout;for(const a of attrs)for(const prop of ['x','y','rx','ry'])if(prop in a)assert.ok(a[prop]>=0);const b=attrs[1];if(angle){assert.equal(b.r,angle);assert.ok(Math.abs(b.rx-b.x-1)<=.001);assert.ok(Math.abs(b.ry-b.y-.5)<=.001);}else assert.ok(!('r'in b));for(const a of attrs)assert.equal(Math.round(a.x*1000),a.x*1000);});
test('ZMK negative angle is parenthesized and physical units are 1/100',()=>{const p=project('zmk');p.keys[0].angle=-30;const text=file(p,'.overlay');assert.match(text,/<&key_physical_attrs 100 100 \d+ \d+ \(-3000\) \d+ \d+>/);});
const actions=[['none','KC_NO','&none'],['trans','KC_TRNS','&trans'],['mo','MO(1)','&mo 1'],['tg','TG(1)','&tog 1'],['to','TO(1)','&to 1']];
for(const [t,q,z]of actions)test(`action ${t}`,()=>{const a={t,l:1};assert.equal(FW.qmkAction(a),q);assert.equal(FW.zmkAction(a),z);});
test('modifier functions and every neutral keycode map to official ZMK names',()=>{assert.equal(FW.qmkAction({t:'kc',k:'C',m:['LCTL','LSFT']}),'LCTL(LSFT(KC_C))');assert.equal(FW.zmkAction({t:'kc',k:'C',m:['LCTL','LSFT']}),'&kp LC(LS(C))');const h=fs.readFileSync(path.join(__dirname,'fixtures/reference/zmk-v0.3-keys.h'),'utf8');for(const code of FW.keycodes)assert.match(h,new RegExp('^#define '+code.zmk+'\\s','m'),code.id);});
test('inference aliases, shifted labels, unknown numbering, center by range and explicit axis',()=>{const keys=[{x:0},{x:1},{x:2},{x:10},{x:200,decal:true}];for(const [label,id]of [['a','A'],['!1','N1'],['@\n2','N2'],['F24','F24'],['⌃','LCTL'],['回车','ENT'],['←','LEFT'],['Opt','LALT'],['`','GRV'],['CapsLock','CAPS']])assert.equal(FW.inferBinding({label,x:4},keys).k,id,label);assert.equal(FW.inferBinding({label:'Shift',x:6},keys).k,'RSFT');assert.equal(FW.inferBinding({label:'Shift',x:6},keys,8).k,'LSFT');for(const label of ['14','Fn','Lower','Raise','相机'])assert.equal(FW.inferBinding({label,x:0},keys).t,'none');});
test('suggested matrix deterministic, no collisions, decal excluded; staggered sample fits 18 GPIO',()=>{const keys=KB.parseKLE(fs.readFileSync(path.join(__dirname,'../示例/42键-TPS65.kle.json'),'utf8')).keys;const map=FW.suggestMatrix(keys),again=FW.suggestMatrix(keys.slice().reverse());assert.deepEqual(map,again);assert.equal(map.length,42);assert.equal(new Set(map.map(m=>m.row+','+m.col)).size,42);assert.ok(Math.max(...map.map(m=>m.row))+Math.max(...map.map(m=>m.col))+2<=18);});
const invalids=[
 ['target',p=>p.firmware.target=null,'目标'],['AVR/ZMK',p=>{p.firmware.target='zmk';},'不匹配'],['nano/QMK',p=>p.firmware.controller='nice_nano_v2','不匹配'],['id',p=>p.firmware.id='../Board','标识'],['row pin count',p=>p.firmware.rowPins.pop(),'行引脚'],['col pin count',p=>p.firmware.colPins.pop(),'列引脚'],['pin duplicate',p=>p.firmware.colPins[0]=21,'重复'],['bad pin',p=>p.firmware.colPins[0]=99,'不支持'],['18 GPIO',p=>{p.firmware.rows=10;p.firmware.cols=10;},'18'],['unassigned',p=>p.keys[0].fw.row=null,'尚未'],['out of bounds',p=>p.keys[0].fw.col=3,'超出'],['duplicate position',p=>Object.assign(p.keys[0].fw,{row:0,col:0}),'重复'],['layer reference',p=>p.keys[0].fw.bindings[0]={t:'mo',l:8},'不存在'],['zero layers',p=>p.firmware.layers=[],'层数'],['no keys',p=>p.keys=p.keys.filter(k=>k.decal),'实体按键'],['rows range',p=>p.firmware.rows=0,'1–32'],['invalid action',p=>p.keys[0].fw.bindings[0]={t:'macro'},'动作'],['mixed sides QMK',p=>p.keys[0].fw.bindings[0]={t:'kc',k:'A',m:['LCTL','RSFT']},'左右修饰']
];
for(const [name,mutate,msg]of invalids)test('strict validation: '+name,()=>{const p=project();mutate(p);assert.ok(FW.validate(p).errors.some(e=>e.msg.includes(msg)),name);assert.equal(FW.generate(p).files.length,0);});
test('warnings for none, unknown text, matrix gaps and ASCII name',()=>{const p=project();p.firmware.displayName='键盘';p.keys[0].label='Fn';p.keys[0].fw.bindings[0]={t:'none'};const warnings=FW.validate(p).warnings.map(e=>e.msg).join('\n');for(const term of ['没有功能','未能识别','空位','ASCII'])assert.ok(warnings.includes(term));});
test('tolerant import, independent nested data and default upper layers',()=>{const p=project();p.firmware.id='../bad';p.firmware.layers=[{name:'Base'},{name:'Lower'}];p.firmware.rowPins=[null,21];p.keys[0].fw.bindings=[{t:'kc',k:'A',m:['LCTL','x','LCTL']},{t:'mo',l:999}];const out=FW.normalizeProject(p);assert.equal(out.firmware.id,'my_board');assert.deepEqual(out.firmware.rowPins,[null,21]);assert.deepEqual(out.keys[0].fw.bindings,[{t:'kc',k:'A',m:['LCTL']},{t:'trans'}]);out.keys[0].fw.bindings[0].m.push('LSFT');assert.equal(p.keys[0].fw.bindings[0].m.length,3);assert.equal(FW.normalizeProject({keys:[KB.key()]}).firmware,null);assert.equal(FW.normalizeProject({firmware:{target:'zmk',layers:[]},keys:[]}).firmware.layers.length,1);});
test('QMK workflow pins both toolchains and builds VIA and Vial firmware artifacts',()=>{const p=project();p.firmware.controller='promicro_rp2040';const workflow=file(p,'build.yml');for(const text of [FW.QMK_VERSION,FW.VIAL_QMK_VERSION,'submodules: recursive','CONVERT_TO=sparkfun_pm2040','Compile VIA firmware','Compile Vial firmware','repository: vial-kb/vial-qmk','dist/via','dist/vial','push, pull_request','contents: read','pip install -r qmk_firmware/requirements.txt','qmk config user.qmk_home="$GITHUB_WORKSPACE/qmk_firmware"'])assert.ok(workflow.includes(text),text);});
test('ZMK pull direction, escaped names, modules and west imports',()=>{const p=project('zmk');p.firmware.displayName='My "Board"';p.firmware.layers[0].name='A " B \\ C';let overlay=file(p,'.overlay');assert.match(overlay,/row-gpios = <&pro_micro 21 \(GPIO_ACTIVE_HIGH \| GPIO_PULL_DOWN\)>, <&pro_micro 20/);assert.match(overlay,/col-gpios = <&pro_micro 0 GPIO_ACTIVE_HIGH>, <&pro_micro 1/);assert.ok(file(p,'.keymap').includes('A \\" B \\\\ C'));assert.ok(file(p,'west.yml').includes('import: app/west.yml'));assert.equal(file(p,'module.yml'),'build:\n  settings:\n    board_root: .\n');p.firmware.diode='row2col';overlay=file(p,'.overlay');assert.match(overlay,/col-gpios = <&pro_micro 0 \(GPIO_ACTIVE_HIGH \| GPIO_PULL_DOWN\)>/);});
test('42 key sample generates both repositories with consistent counts and excluded TPS65',()=>{const raw=KB.parseKLE(fs.readFileSync(path.join(__dirname,'../示例/42键-TPS65.kle.json'),'utf8')).keys;for(const target of ['qmk','zmk']){const p=project(target);p.keys=raw;const matrix=FW.suggestMatrix(raw);p.firmware.rows=Math.max(...matrix.map(m=>m.row))+1;p.firmware.cols=Math.max(...matrix.map(m=>m.col))+1;p.firmware.rowPins=FW.GPIO.slice(0,p.firmware.rows);p.firmware.colPins=FW.GPIO.slice(p.firmware.rows,p.firmware.rows+p.firmware.cols);for(const m of matrix)p.keys.find(k=>k.id===m.id).fw={row:m.row,col:m.col,bindings:[FW.inferBinding(p.keys.find(k=>k.id===m.id),raw),{t:'trans'}]};const result=FW.generate(p);assert.deepEqual(result.errors,[]);assert.ok(!result.files.some(f=>f.path.endsWith('.overlay')&&f.content.includes('TPS65')));if(target==='qmk')assert.equal(JSON.parse(file(p,'keymap.json')).layers[0].length,42);else assert.equal((file(p,'.overlay').match(/<&key_physical_attrs/g)||[]).length,42);}});
test('ZMK golden output catches ordering, units, syntax and escaping changes',()=>{const p=project('zmk');p.keys[0].angle=-30;const generated=FW.generate(p).files.filter(f=>/overlay$|keymap$/.test(f.path));const snapshot=path.join(__dirname,'fixtures/firmware-zmk.json');if(process.env.UPDATE_FIRMWARE_SNAPSHOT==='1')fs.writeFileSync(snapshot,JSON.stringify(generated,null,2)+'\n');assert.deepEqual(generated,JSON.parse(fs.readFileSync(snapshot,'utf8')));});

test('Chinese layer names survive JSON round trip while control characters are removed',()=>{const p=project('zmk');p.firmware.layers=[{name:'基础层'},{name:'导航\n层'}];const out=FW.normalizeProject(JSON.parse(JSON.stringify(p)));assert.deepEqual(out.firmware.layers,[{name:'基础层'},{name:'导航 层'}]);assert.deepEqual(FW.normalizeProject(JSON.parse(JSON.stringify(out))).firmware.layers,out.firmware.layers);assert.deepEqual(FW.generate(out).errors,[]);});

test('recognized 42-key legends initialize the visible base layer and both exports',()=>{
  const labels=['Tab','Q','W','E','R','T','Ctrl','A','S','D','F','G','Shift','Z','X','C','V','B','GUI','Lower','Space','Y','U','I','O','P','Bksp','H','J','K','L',';',"'",'N','M',',','.','/','Esc','Enter','Raise','Alt'];
  const expected=['TAB','Q','W','E','R','T','LCTL','A','S','D','F','G','LSFT','Z','X','C','V','B','LGUI','MO(1)','SPC','Y','U','I','O','P','BSPC','H','J','K','L','SCLN','QUOT','N','M','COMM','DOT','SLSH','ESC','ENT','MO(2)','RALT'];
  for(const target of ['qmk','zmk']){
    const p=project(target);p.firmware.layers=[{name:'Base'}];p.keys=labels.map((label,i)=>KB.key({id:String(i).padStart(2,'0'),label,labelSource:'recognized',x:i<21?i%6:10+i%6,y:Math.floor(i/6),fw:{row:Math.floor(i/6),col:i%6,bindings:[]}}));
    p.firmware.rows=7;p.firmware.cols=6;p.firmware.rowPins=FW.GPIO.slice(0,7);p.firmware.colPins=FW.GPIO.slice(7,13);p.options.mirrorAxis=8;
    const geometry=JSON.stringify(p.keys.map(k=>[k.x,k.y,k.fw.row,k.fw.col])),wiring=JSON.stringify([p.firmware.rowPins,p.firmware.colPins]);
    assert.deepEqual(FW.populateBaseLayer(p),{assigned:42,unresolved:0,addedLayers:2});
    assert.deepEqual(p.keys.map(k=>FW.qmkAction(k.fw.bindings[0])),expected.map(k=>k.startsWith('MO')?k:'KC_'+k));
    assert.ok(p.keys.every(k=>k.fw.bindings.slice(1).every(a=>a.t==='trans')));
    assert.equal(JSON.stringify(p.keys.map(k=>[k.x,k.y,k.fw.row,k.fw.col])),geometry);assert.equal(JSON.stringify([p.firmware.rowPins,p.firmware.colPins]),wiring);
    if(target==='qmk')assert.deepEqual(JSON.parse(file(p,'keymap.json')).layers[0],p.keys.map(k=>FW.qmkAction(k.fw.bindings[0])));
    else {const keymap=file(p,'.keymap');for(const code of ['&kp TAB','&kp SEMI','&kp APOSTROPHE','&kp RALT','&mo 1','&mo 2'])assert.ok(keymap.includes(code),code);}
    const saved=JSON.stringify(p);assert.equal(FW.populateBaseLayer(p).assigned,0);assert.equal(JSON.stringify(p),saved);
  }
});
test('automatic legends preserve manual none, custom actions, upper layers and persistence',()=>{
  const p=project();p.keys[0].fw.bindings=[{t:'none'},{t:'kc',k:'F1',m:[]}];p.keys[0].fw.baseBindingManual=true;p.keys[1].fw.bindings[0]={t:'kc',k:'C',m:['LCTL']};
  const saved=FW.normalizeProject(JSON.parse(JSON.stringify(p))),before=JSON.stringify(saved);
  assert.equal(FW.populateBaseLayer(saved).assigned,0);assert.equal(JSON.stringify(saved),before);assert.equal(saved.keys[0].fw.baseBindingManual,true);
});
test('unread numbering stays empty but confirmed digits and imported KLE digits become keycodes',()=>{
  const p=project();p.image={};p.keys=[KB.key({label:'1',labelSource:'placeholder'}),KB.key({label:'2'}),KB.key({label:'3',labelSource:'recognized'}),KB.key({label:'4',labelSource:'manual'}),KB.key({label:'Fn'}),KB.key({label:'A',decal:true})];
  assert.deepEqual(FW.populateBaseLayer(p),{assigned:2,unresolved:3,addedLayers:0});assert.deepEqual(p.keys.map(k=>k.fw?.bindings[0]?.k),[undefined,undefined,'N3','N4',undefined,undefined]);
  p.keys[0].labelSource='recognized';assert.equal(FW.populateBaseLayer(p).assigned,1);assert.equal(p.keys[0].fw.bindings[0].k,'N1');
  const kle={...project(),keys:KB.parseKLE('[["1","2"]]').keys};assert.equal(FW.populateBaseLayer(kle).assigned,2);
});
test('Lower and Raise reuse existing semantic layers without renaming or merging them',()=>{
  const p=project();p.firmware.layers=[{name:'Base'},{name:'RAISE'},{name:'导航'},{name:'lower'}];p.keys=[KB.key({label:'Lower'}),KB.key({label:'Raise'})];
  const names=JSON.stringify(p.firmware.layers);assert.equal(FW.populateBaseLayer(p).addedLayers,0);assert.equal(JSON.stringify(p.firmware.layers),names);assert.deepEqual(p.keys.map(k=>k.fw.bindings[0]),[{t:'mo',l:3},{t:'mo',l:1}]);
  p.firmware.layers=[{name:'Base'},{name:'Raise'}];p.keys=[KB.key({label:'Lower'}),KB.key({label:'Raise'})];FW.populateBaseLayer(p);assert.deepEqual(p.keys.map(k=>k.fw.bindings[0].l),[2,1]);assert.equal(p.firmware.layers[2].name,'Lower');
});
test('legacy all-none projects acquire legends while firmware-disabled projects stay untouched',()=>{
  const p=project();p.keys[0].fw.bindings[0]={t:'none'};p.keys[1].fw.bindings[0]={t:'none'};
  const restored=FW.normalizeProject(JSON.parse(JSON.stringify(p)));assert.equal(FW.populateBaseLayer(restored).assigned,2);assert.equal(restored.keys[0].fw.bindings[0].k,'B');assert.deepEqual(restored.keys[1].fw.bindings[1],{t:'mo',l:0});
  const off={firmware:null,keys:[KB.key({label:'A'})]},before=JSON.stringify(off);assert.equal(FW.populateBaseLayer(off).assigned,0);assert.equal(JSON.stringify(off),before);
});
