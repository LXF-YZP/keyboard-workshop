'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const FW=require('../Web/firmware'),KB=require('../Web/core');
const sample=fs.readFileSync(__dirname+'/../示例/42键-TPS65.kle.json','utf8');
function project(target='qmk'){
  const firmware=FW.sanitizeFirmware({target,controller:target==='qmk'?'rp2040':'nice_nano_v2',id:'split_board',displayName:'Split Board',rows:2,cols:2,rowPins:[4,5],colPins:[8,9],layers:[{name:'Base'},{name:'Nav'}]});
  FW.enableSplit(firmware,true);Object.assign(firmware.split,{serialPin:1,right:{rowPins:[4,5],colPins:[8,9]}});
  return {firmware,keys:['right','left'].flatMap((side,i)=>['A','B'].map((k,row)=>KB.key({id:side+row,label:k,x:i*10+row,y:row,fw:{side,row,col:row,bindings:[{t:'kc',k,m:[]},{t:'trans'}]}})))};
}
function file(p,suffix){const out=FW.generate(p);assert.deepEqual(out.errors,[]);const f=out.files.find(f=>f.path.endsWith(suffix));assert.ok(f,suffix);return f.content;}
test('split USB IDs use the same settings with either hand as central/master',()=>{
  for(const target of ['qmk','zmk'])for(const master of ['left','right']){
    const p=project(target);p.firmware.usb={vid:'abcd',pid:'12'};p.firmware.split.master=master;
    if(target==='qmk')assert.deepEqual(JSON.parse(file(p,'keyboard.json')).usb,{vid:'0xABCD',pid:'0x0012',device_version:'1.0.0'});
    else {
      assert.match(file(p,'split_board.conf'),/CONFIG_USB_DEVICE_VID=0xABCD\nCONFIG_USB_DEVICE_PID=0x0012\n/);
      assert.match(file(p,'build.yaml'),/shield: split_board_left\n.*shield: split_board_right/s);
      assert.ok(!FW.generate(p).files.some(f=>/_left\.conf$|_right\.conf$/.test(f.path)),'shared base config applies to both halves');
    }
  }
});
test('split uses local coordinates and permits the same GPIO and slot on opposite hands',()=>{
  const p=project();assert.deepEqual(FW.validate(p).errors,[]);
  const keyboard=JSON.parse(file(p,'keyboard.json'));assert.deepEqual(keyboard.layouts.LAYOUT.layout.map(k=>k.matrix),[[0,0],[1,1],[2,0],[3,1]]);
  assert.equal(keyboard.processor,'RP2040');assert.equal(keyboard.board,'GENERIC_RP_RP2040');assert.equal(keyboard.development_board,undefined);
  assert.deepEqual(keyboard.matrix_pins,{rows:['GP4','GP5'],cols:['GP8','GP9']});
  assert.deepEqual(keyboard.split.matrix_pins.right,keyboard.matrix_pins);assert.deepEqual(keyboard.split.serial,{driver:'vendor',pin:'GP1'});
  assert.match(file(p,'config.h'),/#define MASTER_LEFT/);assert.ok(!file(p,'build.yml').includes('CONVERT_TO'));
  assert.deepEqual(JSON.parse(file(p,'keymap.json')).layers[0],['KC_A','KC_B','KC_A','KC_B']);
  p.firmware.split.master='right';assert.match(file(p,'config.h'),/#define MASTER_RIGHT/);assert.match(file(p,'README.md'),/USB 固定连接右手/);
});
test('right GPIO can differ and is exported independently',()=>{const p=project();p.firmware.split.right.rowPins=[26,27];assert.deepEqual(JSON.parse(file(p,'keyboard.json')).split.matrix_pins.right.rows,['GP26','GP27']);});
for(const [name,edit,term] of [
  ['missing side',p=>delete p.keys[0].fw.side,'左手或右手'],
  ['empty hand',p=>p.keys=p.keys.filter(k=>k.fw.side==='left'),'右手还没有'],
  ['same hand duplicate matrix',p=>Object.assign(p.keys[0].fw,{row:1,col:1}),'重复使用'],
  ['right missing GPIO',p=>p.firmware.split.right.rowPins=[4],'右手：行引脚'],
  ['right reused GPIO',p=>p.firmware.split.right.colPins=[4,9],'右手：行列引脚不能重复'],
  ['left serial conflict',p=>p.firmware.colPins=[1,9],'左手：分体通信'],
  ['right serial conflict',p=>p.firmware.split.right.colPins=[1,9],'右手：分体通信'],
  ['missing serial pin',p=>p.firmware.split.serialPin=null,'分体通信'],
  ['bad generic GPIO',p=>p.firmware.colPins=[30,9],'不支持'],
  ['bad master',p=>p.firmware.split.master='either','主手']
])test('split validation: '+name,()=>{const p=project();edit(p);assert.ok(FW.validate(p).errors.some(e=>e.msg.includes(term)),JSON.stringify(FW.validate(p).errors));assert.equal(FW.generate(p).files.length,0);});
test('split AVR limits serial GPIO and converter keeps original connector mapping',()=>{
  const p=project();p.firmware.controller='promicro_avr';assert.equal(JSON.parse(file(p,'keyboard.json')).split.serial.driver,'bitbang');
  p.firmware.split.serialPin=7;assert.ok(FW.validate(p).errors.some(e=>e.msg.includes('AVR 串行')));
  p.firmware.split.serialPin=1;p.firmware.controller='promicro_rp2040';assert.equal(JSON.parse(file(p,'keyboard.json')).split.serial.pin,'D3');assert.match(file(p,'build.yml'),/CONVERT_TO=sparkfun_pm2040/);
});
test('native RP2040 and connector presets remap physical GPIO and clear unavailable pads',()=>{
  const p=project();p.firmware.rowPins=[26,27];p.firmware.colPins=[11,12];p.firmware.split.right.rowPins=[28,29];Object.assign(p.firmware.split.pointing,{sda:2,scl:3});
  FW.switchController(p.firmware,'promicro_rp2040');assert.deepEqual(p.firmware.rowPins,[18,19]);assert.deepEqual(p.firmware.colPins,[null,null]);assert.deepEqual(p.firmware.split.right.rowPins,[20,21]);assert.equal(p.firmware.split.serialPin,0);
  FW.switchController(p.firmware,'rp2040');assert.deepEqual(p.firmware.rowPins,[26,27]);assert.deepEqual(p.firmware.split.right.rowPins,[28,29]);assert.equal(p.firmware.split.serialPin,1);assert.equal(p.firmware.split.pointing.scl,3);
});
test('optional Azoteq configuration exports side, model, rotation and I2C drivers; conflicts checked per hand',()=>{
  const p=project(),pt=p.firmware.split.pointing;Object.assign(pt,{enabled:true,side:'left',model:'TPS65',sda:2,scl:3,rotation:90});
  assert.match(file(p,'config.h'),/#define POINTING_DEVICE_LEFT/);assert.match(file(p,'config.h'),/#define AZOTEQ_IQS5XX_TPS65/);assert.match(file(p,'config.h'),/I2C1_SDA_PIN GP2/);assert.match(file(p,'config.h'),/ROTATION_90/);assert.match(file(p,'rules.mk'),/POINTING_DEVICE_DRIVER = azoteq_iqs5xx/);assert.match(file(p,'mcuconf.h'),/RP_I2C_USE_I2C1 TRUE/);assert.match(file(p,'halconf.h'),/HAL_USE_I2C TRUE/);
  p.firmware.split.right.rowPins=[2,3];assert.deepEqual(FW.validate(p).errors,[]);
  pt.side='right';assert.ok(FW.validate(p).errors.some(e=>e.msg.includes('右手：触控板 SDA')));
  pt.side='left';pt.sda=4;assert.ok(FW.validate(p).errors.some(e=>e.msg.includes('I2C1：')));
});
test('ZMK split emits two shields, shared full keymap, local pins and right row offset',()=>{
  const p=project('zmk'),conf=file(p,'Kconfig.defconfig'),dtsi=file(p,'.dtsi');
  assert.match(conf,/config ZMK_SPLIT\n    default y/);assert.match(conf,/if SHIELD_SPLIT_BOARD_LEFT\nconfig ZMK_SPLIT_ROLE_CENTRAL/);
  assert.match(file(p,'Kconfig.shield'),/SHIELD_SPLIT_BOARD_RIGHT/);assert.match(dtsi,/rows = <4>/);assert.match(dtsi,/RC\(2, 0\)/);assert.ok(!dtsi.includes('row-gpios'));
  assert.match(file(p,'_left.overlay'),/row-offset = <0>/);assert.match(file(p,'_right.overlay'),/row-offset = <2>/);assert.match(file(p,'_right.overlay'),/<&pro_micro 4 /);
  assert.equal((file(p,'.keymap').match(/&kp/g)||[]).length,4);assert.match(file(p,'build.yaml'),/shield: split_board_left\n.*board: nice_nano_v2\n.*shield: split_board_right/s);
  assert.match(file(p,'.zmk.yml'),/siblings: \[split_board_left, split_board_right\]/);
  p.firmware.split.master='right';assert.match(file(p,'Kconfig.defconfig'),/if SHIELD_SPLIT_BOARD_RIGHT\nconfig ZMK_SPLIT_ROLE_CENTRAL/);
});
test('unsupported ZMK wireless RP2040 and Azoteq configurations cannot export',()=>{const p=project('zmk');p.firmware.controller='promicro_rp2040';assert.equal(FW.generate(p).files.length,0);p.firmware.controller='nice_nano_v2';p.firmware.split.pointing.enabled=true;assert.equal(FW.generate(p).files.length,0);});
test('42-key rotated split suggests 4x6 per hand, mirrors columns, excludes decals and remains deterministic',()=>{
  const keys=KB.parseKLE(sample).keys;for(const side of FW.suggestSides(keys))keys.find(k=>k.id===side.id).fw={side:side.side};
  const map=FW.suggestSplitMatrix(keys);assert.equal(map.length,42);assert.deepEqual(map,FW.suggestSplitMatrix(keys.slice().reverse()));
  for(const side of ['left','right']){const half=map.filter(k=>k.side===side);assert.equal(half.length,21);assert.equal(Math.max(...half.map(k=>k.row)),3);assert.equal(Math.max(...half.map(k=>k.col)),5);assert.equal(new Set(half.map(k=>k.row+','+k.col)).size,21);}
  const at=label=>map.find(k=>k.id===keys.find(k=>k.label===label).id);assert.deepEqual([at('Tab').row,at('Tab').col],[0,0]);assert.deepEqual([at('Bksp').row,at('Bksp').col],[0,0]);assert.equal(at('Space').row,3);assert.equal(at('Enter').row,3);
});
test('split round trip preserves all settings and nested objects remain independent',()=>{const p=project();p.firmware.split.pointing.enabled=true;const saved=FW.normalizeProject(p),again=FW.normalizeProject(JSON.parse(JSON.stringify(saved)));assert.deepEqual(again,saved);again.firmware.split.right.rowPins[0]=29;again.keys[0].fw.side='left';assert.equal(saved.firmware.split.right.rowPins[0],4);assert.equal(saved.keys[0].fw.side,'right');assert.equal(FW.matrixLabel(saved.keys[0],saved.firmware),'右 R0 C0');});

function fullDuplex(){const p=project();Object.assign(p.firmware.split,{serialMode:'full_duplex',serialRxPin:12});return p;}
test('legacy single-wire projects preserve exact wiring and export without full-duplex macros',()=>{
  const p=project();assert.deepEqual(FW.sanitizeFirmware(p.firmware),p.firmware);
  assert.equal(FW.serialMode(p.firmware),'half_duplex');assert.ok(!('serialMode' in FW.normalizeProject(p).firmware.split));
  assert.deepEqual(JSON.parse(file(p,'keyboard.json')).split.serial,{driver:'vendor',pin:'GP1'});
  assert.ok(!file(p,'config.h').includes('SERIAL_USART_FULL_DUPLEX'));
  assert.match(file(p,'README.md'),/单线半双工：两侧数据 GPIO 均为 GP1/);
});
test('full-duplex RP2040 exports distinct TX/RX macros, vendor driver and crossed wiring instructions',()=>{
  const p=fullDuplex();assert.deepEqual(JSON.parse(file(p,'keyboard.json')).split.serial,{driver:'vendor'});
  const config=file(p,'config.h');assert.match(config,/#define SERIAL_USART_FULL_DUPLEX\n#define SERIAL_USART_TX_PIN GP1\n#define SERIAL_USART_RX_PIN GP12\n/);
  assert.ok(!config.includes('SOFT_SERIAL_PIN'));assert.ok(!config.includes('SERIAL_USART_PIN_SWAP'));
  const readme=file(p,'README.md');assert.match(readme,/TX GP1、RX GP12/);assert.match(readme,/左 TX → 右 RX，左 RX ← 右 TX/);assert.match(readme,/共地/);
  p.firmware.split.master='right';assert.match(file(p,'config.h'),/MASTER_RIGHT/);assert.match(file(p,'README.md'),/USB 固定连接右手/);
});
for(const [name,edit,term] of [
  ['missing RX',p=>delete p.firmware.split.serialRxPin,'分体通信 RX尚未'],
  ['missing TX',p=>p.firmware.split.serialPin=null,'分体通信 TX尚未'],
  ['same TX and RX',p=>p.firmware.split.serialRxPin=1,'分体通信 RX与其他功能引脚重复'],
  ['left matrix RX conflict',p=>p.firmware.colPins=[12,9],'左手：分体通信 RX'],
  ['right matrix RX conflict',p=>p.firmware.split.right.colPins=[12,9],'右手：分体通信 RX'],
  ['RX outside GPIO range',p=>p.firmware.split.serialRxPin=30,'分体通信 RX尚未'],
  ['touchpad RX conflict',p=>{p.firmware.split.serialRxPin=2;Object.assign(p.firmware.split.pointing,{enabled:true,sda:2,scl:3});},'触控板 SDA与其他功能引脚重复'],
  ['AVR full duplex',p=>{p.firmware.controller='promicro_avr';p.firmware.split.serialRxPin=0;},'双线全双工目前需要 RP2040'],
  ['invalid serial mode',p=>p.firmware.split.serialMode='i2c','分体通信方式无效']
])test('full-duplex rejects '+name,()=>{const p=fullDuplex();edit(p);assert.ok(FW.validate(p).errors.some(e=>e.msg.includes(term)),JSON.stringify(FW.validate(p).errors));assert.equal(FW.generate(p).files.length,0);});
test('inactive RX is retained but not reserved or exported in half duplex',()=>{
  const p=fullDuplex();p.firmware.split.serialMode='half_duplex';p.firmware.split.serialRxPin=4;
  assert.deepEqual(FW.validate(p).errors,[]);assert.deepEqual(FW.serialPins(p.firmware),[{pin:1,label:'分体通信数据'}]);
  assert.ok(!file(p,'config.h').includes('SERIAL_USART_RX_PIN'));assert.equal(FW.normalizeProject(p).firmware.split.serialRxPin,4);
});
test('full-duplex connector export and controller changes map both communication pins',()=>{
  const p=fullDuplex();p.firmware.split.serialRxPin=0;FW.switchController(p.firmware,'promicro_rp2040');
  assert.equal(p.firmware.split.serialPin,0);assert.equal(p.firmware.split.serialRxPin,1);
  assert.match(file(p,'config.h'),/SERIAL_USART_TX_PIN D2\n#define SERIAL_USART_RX_PIN D3/);
  assert.match(file(p,'build.yml'),/CONVERT_TO=sparkfun_pm2040/);assert.match(file(p,'README.md'),/TX GP1、RX GP0/);
  FW.switchController(p.firmware,'rp2040');assert.equal(p.firmware.split.serialPin,1);assert.equal(p.firmware.split.serialRxPin,0);
  p.firmware.split.serialRxPin=12;FW.switchController(p.firmware,'promicro_rp2040');assert.equal(p.firmware.split.serialRxPin,null);
});
test('full-duplex project round trip preserves mode and RX independently; missing RX stays unassigned',()=>{
  const p=fullDuplex(),saved=FW.normalizeProject(p),again=FW.normalizeProject(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(again,saved);again.firmware.split.serialRxPin=13;assert.equal(saved.firmware.split.serialRxPin,12);
  delete p.firmware.split.serialRxPin;assert.equal(FW.normalizeProject(p).firmware.split.serialRxPin,null);
});
test('ZMK wireless ignores dormant wired mode and never reserves RX',()=>{
  const p=project('zmk');Object.assign(p.firmware.split,{serialMode:'full_duplex',serialRxPin:4});assert.deepEqual(FW.serialPins(p.firmware),[]);
  assert.deepEqual(FW.validate(p).errors,[]);assert.match(file(p,'README.md'),/左右之间使用蓝牙/);
});
