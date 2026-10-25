(function (root) {
  'use strict';
  const GPIO = [0,1,2,3,4,5,6,7,8,9,10,14,15,16,18,19,20,21];
  const AVR = {0:'D2',1:'D3',2:'D1',3:'D0',4:'D4',5:'C6',6:'D7',7:'E6',8:'B4',9:'B5',10:'B6',14:'B3',15:'B1',16:'B2',18:'F7',19:'F6',20:'F5',21:'F4'};
  // Pro Micro 预设保存兼容接口编号；通用 RP2040 保存原生 GP 编号。
  // QMK 0.34.7 sparkfun_pm2040 / ZMK v0.3 的 SparkFun Pro Micro RP2040 板级定义。
  const RP2040 = {0:1,1:0,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:21,14:20,15:22,16:23,18:26,19:27,20:28,21:29};
  const PRO_MICRO_LABELS = {0:'RX / D0',1:'TX / D1',2:'SDA / 2',3:'SCL / 3',14:'14 / MISO',15:'15 / SCK',16:'16 / MOSI',18:'A0 / 18',19:'A1 / 19',20:'A2 / 20',21:'A3 / 21'};
  function pinOptions(controller){
    if(controller==='rp2040')return Array.from({length:30},(_,value)=>({value,label:'GP'+value,title:'RP2040 GPIO '+value}));
    const rp2040=controller==='promicro_rp2040',pins=GPIO.slice();
    if(rp2040)pins.sort((a,b)=>RP2040[a]-RP2040[b]);
    return pins.map(value=>{const connector=PRO_MICRO_LABELS[value]||String(value),label=rp2040?'GP'+RP2040[value]:connector;return {value,label,title:rp2040?`${label}（兼容 Pro Micro ${connector}）`:`Pro Micro 接口 ${connector}`};});
  }
  const QMK_VERSION='0.34.7', ZMK_VERSION='v0.3';
  function normalizeUsbId(value){
    const match=typeof value==='string'&&/^(?:0x)?([0-9a-f]{1,4})$/i.exec(value.trim());
    return match?'0x'+match[1].toUpperCase().padStart(4,'0'):null;
  }
  function usbIds(f){
    const defaults=f?.target==='zmk'?{vid:'0x1D50',pid:'0x615E'}:{vid:'0xFEED',pid:'0x0000'};
    return Object.fromEntries(['vid','pid'].map(prop=>[prop,f?.usb?.[prop]===undefined?defaults[prop]:f.usb[prop]]));
  }
  const MODS = ['LCTL','LSFT','LALT','LGUI','RCTL','RSFT','RALT','RGUI'];
  const keycodes = [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(id=>({id,label:id,qmk:'KC_'+id,zmk:id,group:'字母',aliases:[]})),
    ...Array.from({length:10},(_,i)=>({id:'N'+i,label:String(i),qmk:'KC_'+i,zmk:'N'+i,group:'数字',aliases:[String(i)]})),
    ...Array.from({length:24},(_,i)=>({id:'F'+(i+1),label:'F'+(i+1),qmk:'KC_F'+(i+1),zmk:'F'+(i+1),group:'F键',aliases:[]})),
    {id:'ESC',label:'Esc',qmk:'KC_ESC',zmk:'ESC',group:'编辑',aliases:['ESCAPE']},{id:'TAB',label:'Tab',qmk:'KC_TAB',zmk:'TAB',group:'编辑',aliases:[]},{id:'CAPS',label:'Caps',qmk:'KC_CAPS',zmk:'CAPS',group:'编辑',aliases:['CAPSLOCK']},{id:'ENT',label:'Enter',qmk:'KC_ENT',zmk:'RET',group:'编辑',aliases:['RETURN']},{id:'BSPC',label:'Backspace',qmk:'KC_BSPC',zmk:'BSPC',group:'编辑',aliases:['BKSP']},{id:'DEL',label:'Delete',qmk:'KC_DEL',zmk:'DEL',group:'编辑',aliases:['DELETE']},{id:'SPC',label:'Space',qmk:'KC_SPC',zmk:'SPACE',group:'编辑',aliases:['空格']},
    {id:'LEFT',label:'Left',qmk:'KC_LEFT',zmk:'LEFT',group:'导航',aliases:['←']},{id:'UP',label:'Up',qmk:'KC_UP',zmk:'UP',group:'导航',aliases:['↑']},{id:'RIGHT',label:'Right',qmk:'KC_RGHT',zmk:'RIGHT',group:'导航',aliases:['→']},{id:'DOWN',label:'Down',qmk:'KC_DOWN',zmk:'DOWN',group:'导航',aliases:['↓']},{id:'HOME',label:'Home',qmk:'KC_HOME',zmk:'HOME',group:'导航',aliases:[]},{id:'END',label:'End',qmk:'KC_END',zmk:'END',group:'导航',aliases:[]},{id:'PGUP',label:'PgUp',qmk:'KC_PGUP',zmk:'PG_UP',group:'导航',aliases:[]},{id:'PGDN',label:'PgDn',qmk:'KC_PGDN',zmk:'PG_DN',group:'导航',aliases:[]},{id:'INS',label:'Ins',qmk:'KC_INS',zmk:'INS',group:'编辑',aliases:[]},{id:'PSCR',label:'PrtSc',qmk:'KC_PSCR',zmk:'PRINTSCREEN',group:'编辑',aliases:['PRTSC']},
    ...[['VOLU','音量 +','C_VOL_UP'],['VOLD','音量 −','C_VOL_DN'],['MUTE','静音','C_MUTE'],['MPLY','播放 / 暂停','C_PLAY_PAUSE'],['MNXT','下一曲','C_NEXT'],['MPRV','上一曲','C_PREV']].map(([id,label,zmk])=>({id,label,qmk:'KC_'+id,zmk,group:'媒体',aliases:[]})),
    ...MODS.map(id=>({id,label:id,qmk:'KC_'+id,zmk:({LCTL:'LCTRL',LSFT:'LSHFT',RCTL:'RCTRL',RSFT:'RSHFT'}[id]||id),group:'修饰',aliases:[]})),
    {id:'MINS',label:'-',qmk:'KC_MINS',zmk:'MINUS',group:'符号',aliases:['-']},{id:'EQL',label:'=',qmk:'KC_EQL',zmk:'EQUAL',group:'符号',aliases:['=']},{id:'LBRC',label:'[',qmk:'KC_LBRC',zmk:'LBKT',group:'符号',aliases:['[']},{id:'RBRC',label:']',qmk:'KC_RBRC',zmk:'RBKT',group:'符号',aliases:[']']},{id:'BSLS',label:'\\',qmk:'KC_BSLS',zmk:'BSLH',group:'符号',aliases:['\\']},{id:'SCLN',label:';',qmk:'KC_SCLN',zmk:'SEMI',group:'符号',aliases:[';']},{id:'QUOT',label:"'",qmk:'KC_QUOT',zmk:'APOSTROPHE',group:'符号',aliases:["'"]},{id:'COMM',label:',',qmk:'KC_COMM',zmk:'COMMA',group:'符号',aliases:[',']},{id:'DOT',label:'.',qmk:'KC_DOT',zmk:'DOT',group:'符号',aliases:['.']},{id:'SLSH',label:'/',qmk:'KC_SLSH',zmk:'SLASH',group:'符号',aliases:['/']},{id:'GRV',label:'`',qmk:'KC_GRV',zmk:'GRAVE',group:'符号',aliases:['`']}
  ];
  const codeMap = new Map(keycodes.flatMap(k=>[k.id,k.label,...(k.aliases||[])].map(v=>[String(v).toUpperCase(),k])));
  const defaultAction = layer => layer===0?{t:'none'}:{t:'trans'};
  function sanitizeAction(a, layers=1, layer=0){
    if(!a||typeof a!=='object')return defaultAction(layer);
    if(a.t==='kc'&&codeMap.has(String(a.k).toUpperCase()))return {t:'kc',k:codeMap.get(String(a.k).toUpperCase()).id,m:Array.isArray(a.m)?[...new Set(a.m.filter(m=>MODS.includes(m)))]:[]};
    if(['trans','none'].includes(a.t))return {t:a.t};
    if(['mo','tg','to'].includes(a.t)&&Number.isInteger(a.l)&&a.l>=0&&a.l<layers)return {t:a.t,l:a.l};
    return defaultAction(layer);
  }
  function sanitizeFirmware(value){
    if(!value||typeof value!=='object')return null;
    const target=['qmk','zmk'].includes(value.target)?value.target:null;
    if(!target)return null;
    const id=/^[a-z][a-z0-9_]{0,31}$/.test(String(value.id||''))?String(value.id):'my_board';
    // 保留原始名称，校验阶段才能明确提示非 ASCII；生成文件时再做兼容性替换。
    const displayName=String(value.displayName||'My Board').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,64)||'My Board';
    const controller=['promicro_avr','promicro_rp2040','nice_nano_v2','rp2040'].includes(value.controller)?value.controller:'promicro_avr';
    const rows=Math.max(1,Math.min(32,Math.floor(Number(value.rows)||4))),cols=Math.max(1,Math.min(32,Math.floor(Number(value.cols)||12)));
    const pins=v=>Array.isArray(v)?v.slice(0,32).map(n=>Number.isInteger(n)&&pinOptions(controller).some(p=>p.value===n)?n:null):[];
    const layers=(Array.isArray(value.layers)?value.layers:[]).slice(0,10).map((l,i)=>({name:String(l?.name||`Layer ${i}`).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,24)||`Layer ${i}`}));
    if(!layers.length)layers.push({name:'Base'});
    const out={version:1,target,id,displayName,controller,rows,cols,rowPins:pins(value.rowPins),colPins:pins(value.colPins),diode:['col2row','row2col'].includes(value.diode)?value.diode:'col2row',layers};
    // 缺少 USB 字段的旧工程沿用各目标原默认值；非法输入保留为错误，避免重开后静默换成其他 ID。
    if(value.usb!==undefined){
      out.usb={};
      for(const prop of ['vid','pid'])if(value.usb?.[prop]!==undefined)out.usb[prop]=normalizeUsbId(value.usb[prop])??(typeof value.usb[prop]==='string'?value.usb[prop].trim().slice(0,64):'');
      if(!value.usb||typeof value.usb!=='object'||Array.isArray(value.usb))out.usb={vid:'',pid:''};
    }
    if(value.split&&typeof value.split==='object'){
      const sp=value.split,pt=sp.pointing||{};
      out.version=2;out.split={enabled:sp.enabled===true,master:sp.master==='right'?'right':'left',serialPin:pins([sp.serialPin])[0]??null,right:{rowPins:pins(sp.right?.rowPins),colPins:pins(sp.right?.colPins)},pointing:{enabled:pt.enabled===true,side:pt.side==='right'?'right':'left',model:pt.model==='TPS65'?'TPS65':'TPS43',sda:pins([pt.sda])[0]??null,scl:pins([pt.scl])[0]??null,rotation:[0,90,180,270].includes(pt.rotation)?pt.rotation:0}};
      // 旧工程缺少模式时仍按原单线接线保存，不自动增加或分配第二个引脚。
      if(sp.serialMode!==undefined)out.split.serialMode=sp.serialMode==='full_duplex'?'full_duplex':'half_duplex';
      if(sp.serialRxPin!==undefined||sp.serialMode==='full_duplex')out.split.serialRxPin=pins([sp.serialRxPin])[0]??null;
    }
    if(controller==='rp2040')out.version=2;
    return out;
  }
  function normalizeProject(project){
    const firmware=sanitizeFirmware(project?.firmware);const layers=firmware?.layers?.length||1;
    const keys=(project?.keys||[]).map(k=>{const out={...k};if(firmware&&!k.decal){const fw=k.fw||{};out.fw={...(firmware.split||fw.side?{side:['left','right'].includes(fw.side)?fw.side:null}:{}),...(fw.baseBindingManual===true?{baseBindingManual:true}:{}),row:Number.isInteger(fw.row)?fw.row:null,col:Number.isInteger(fw.col)?fw.col:null,bindings:Array.from({length:layers},(_,i)=>sanitizeAction(fw.bindings?.[i],layers,i))};}else if(k.fw)delete out.fw;return out;});
    return {...project,firmware,keys};
  }
  function suggestMatrix(keys){
    const sorted=(keys||[]).filter(k=>!k.decal).slice().sort((a,b)=>a.y-b.y||a.x-b.x||String(a.id).localeCompare(String(b.id))),rows=[];
    let previous=null;for(const k of sorted){if(previous===null||k.y-previous>.5)rows.push([]);rows[rows.length-1].push(k);previous=k.y;}
    // 错列会把相邻行连成长链；超出 Pro Micro 引脚容量时改用 0.5U 行带。
    if(rows.length+Math.max(0,...rows.map(r=>r.length))>18){rows.length=0;for(const k of sorted){if(!rows.length||k.y-rows[rows.length-1][0].y>.5)rows.push([]);rows[rows.length-1].push(k);}}
    return rows.flatMap((r,row)=>r.sort((a,b)=>a.x-b.x||String(a.id).localeCompare(String(b.id))).map((k,col)=>({id:k.id,row,col})));
  }
  const isSplit=f=>f?.split?.enabled===true;
  const serialMode=f=>f?.split?.serialMode??'half_duplex';
  const supportsFullDuplex=f=>['rp2040','promicro_rp2040'].includes(f?.controller);
  const serialPins=f=>!isSplit(f)||f.target!=='qmk'?[]:serialMode(f)==='full_duplex'?[{pin:f.split.serialPin,label:'分体通信 TX'},{pin:f.split.serialRxPin,label:'分体通信 RX'}]:[{pin:f.split.serialPin,label:'分体通信数据'}];
  const sideConfig=(f,side)=>isSplit(f)&&side==='right'?f.split.right:f;
  const sideName=side=>side==='left'?'左手':side==='right'?'右手':'未设左右';
  const pinName=(f,n)=>f.controller==='rp2040'?'GP'+n:AVR[n];
  const pinLabel=(f,n)=>pinOptions(f.controller).find(p=>p.value===n)?.label||pinName(f,n);
  function enableSplit(f,enabled){
    if(!f.split)f.split={enabled:false,master:'left',serialPin:null,right:{rowPins:[],colPins:[]},pointing:{enabled:false,side:'left',model:'TPS43',sda:null,scl:null,rotation:90}};
    f.version=2;f.split.enabled=enabled;
  }
  function switchController(f,controller){
    // 原生 GP 编号与兼容接口编号之间显式换算，避免 GP26 被错误解释为接口 26。
    if((f.controller==='rp2040')!==(controller==='rp2040')){
      const inverse=Object.fromEntries(Object.entries(RP2040).map(([a,b])=>[b,Number(a)]));
      const convert=n=>n==null?null:controller==='rp2040'?(RP2040[n]??null):(inverse[n]??null);
      for(const cfg of [f,f.split?.right].filter(Boolean))for(const prop of ['rowPins','colPins'])cfg[prop]=(cfg[prop]||[]).map(convert);
      if(f.split){f.split.serialPin=convert(f.split.serialPin);if(f.split.serialRxPin!==undefined)f.split.serialRxPin=convert(f.split.serialRxPin);for(const prop of ['sda','scl'])f.split.pointing[prop]=convert(f.split.pointing[prop]);}
    }
    f.controller=controller;if(controller==='rp2040')f.version=2;
  }
  function suggestSides(keys,axis){
    const actual=keys.filter(k=>!k.decal);if(!actual.length)return [];
    const middle=Number.isFinite(axis)?axis:(Math.min(...actual.map(k=>k.x))+Math.max(...actual.map(k=>k.x)))/2;
    return actual.map(k=>({id:k.id,side:k.x<middle?'left':'right'}));
  }
  function suggestSplitMatrix(keys){
    const result=[];
    for(const side of ['left','right']){
      const half=keys.filter(k=>!k.decal&&k.fw?.side===side);if(!half.length)continue;
      // 按该侧最常见角度还原局部列；保留列错位，将每列从上到下编号。
      const angles=new Map();for(const k of half){const a=Math.round(k.angle||0);angles.set(a,(angles.get(a)||0)+1);}
      const angle=[...angles].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0],rad=angle*Math.PI/180;
      const local=half.map(k=>({...k,lx:k.x*Math.cos(rad)+k.y*Math.sin(rad),ly:-k.x*Math.sin(rad)+k.y*Math.cos(rad)}));
      const main=local.filter(k=>Math.abs((k.angle||0)-angle)<=8).sort((a,b)=>a.lx-b.lx||a.ly-b.ly||String(a.id).localeCompare(String(b.id))),columns=[];
      for(const k of main){if(!columns.length||k.lx-columns.at(-1)[0].lx>.4)columns.push([]);columns.at(-1).push(k);}
      if(side==='right')columns.reverse();
      const counts=new Map();for(const c of columns)counts.set(c.length,(counts.get(c.length)||0)+1);
      const mainRows=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0])[0]?.[0]||1;
      const thumbs=local.filter(k=>Math.abs((k.angle||0)-angle)>8);
      columns.forEach((column,col)=>column.sort((a,b)=>a.ly-b.ly||String(a.id).localeCompare(String(b.id))).forEach((k,row)=>{if(row>=mainRows)thumbs.push(k);else result.push({id:k.id,side,row,col});}));
      thumbs.sort((a,b)=>(side==='left'?a.lx-b.lx:b.lx-a.lx)||a.ly-b.ly||String(a.id).localeCompare(String(b.id))).forEach((k,i)=>result.push({id:k.id,side,row:mainRows+Math.floor(i/Math.max(1,columns.length)),col:Math.max(0,columns.length-Math.min(thumbs.length,columns.length))+i%Math.max(1,columns.length)}));
    }
    return result;
  }
  function matrixLabel(key,f){
    const pos=Number.isInteger(key.fw?.row)&&Number.isInteger(key.fw?.col)?`R${key.fw.row} C${key.fw.col}`:'未设行列';
    return isSplit(f)?`${key.fw?.side==='left'?'左':key.fw?.side==='right'?'右':'未设左右'} ${pos}`:pos;
  }
  function legendText(key){
    const text=String(key?.label||'').split(/\n|\r/).map(s=>s.trim()).filter(Boolean).pop()?.trim()||'';
    return text.replace(/<[^>]*>/g,'').trim();
  }
  function inferBinding(key, keys, axis){
    const cleaned=legendText(key);if(!cleaned||key.labelSource==='placeholder')return {t:'none'};
    // 键帽常把上档符号写在前面（如 !1、@2），取末尾的基础字符。
    const token=(cleaned.length>1&&/^[^A-Za-z0-9]?[A-Za-z0-9]$/.test(cleaned)?cleaned.slice(-1):cleaned).toUpperCase();
    const actual=(keys||[]).filter(k=>!k.decal),middle=actual.length?(Math.min(...actual.map(k=>k.x))+Math.max(...actual.map(k=>k.x)))/2:key.x;
    const side=x=>(x??key.x)<(Number.isFinite(axis)?axis:middle)?'L':'R';
    const aliases={ESC:'ESC',ESCAPE:'ESC',TAB:'TAB',CAPS:'CAPS',CAPSLOCK:'CAPS',SHIFT:side(key.x)+'SFT','⇧':side(key.x)+'SFT',CTRL:side(key.x)+'CTL',CONTROL:side(key.x)+'CTL','⌃':side(key.x)+'CTL',ALT:side(key.x)+'ALT',OPT:side(key.x)+'ALT',OPTION:side(key.x)+'ALT','⌥':side(key.x)+'ALT',CMD:side(key.x)+'GUI',COMMAND:side(key.x)+'GUI','⌘':side(key.x)+'GUI',WIN:side(key.x)+'GUI',GUI:side(key.x)+'GUI',SUPER:side(key.x)+'GUI',SPACE:'SPC','空格':'SPC',ENTER:'ENT',RETURN:'ENT','回车':'ENT','⏎':'ENT',BACKSPACE:'BSPC',BKSP:'BSPC','退格':'BSPC','⌫':'BSPC',DELETE:'DEL',DEL:'DEL',LEFT:'LEFT','←':'LEFT',RIGHT:'RIGHT','→':'RIGHT',UP:'UP','↑':'UP',DOWN:'DOWN','↓':'DOWN',HOME:'HOME',END:'END',PGUP:'PGUP',PGDN:'PGDN',INS:'INS',PRTSC:'PSCR'};
    const value=aliases[token]||(/^F([1-9]|1[0-9]|2[0-4])$/.test(token)?token:/^[A-Z]$/.test(token)?token:/^[0-9]$/.test(token)?'N'+token:codeMap.has(token)?codeMap.get(token).id:null);
    return value?{t:'kc',k:value,m:[]}:defaultAction(0);
  }
  // 只在导入、启用固件及文字识别/编辑完成时调用；绘制和撤销不触发自动填充。
  function populateBaseLayer(project){
    const f=project?.firmware,keys=(project?.keys||[]).filter(k=>!k.decal),result={assigned:0,unresolved:0,addedLayers:0};
    if(!f)return result;
    const before=f.layers.length,layerNames=['Lower','Raise'],targets=new Map();
    for(const name of layerNames){const index=f.layers.findIndex((l,i)=>i>0&&l.name.trim().toLowerCase()===name.toLowerCase());if(index>0)targets.set(name,index);}
    function layerFor(name){
      if(targets.has(name))return targets.get(name);
      let index=name==='Lower'?1:2;
      if([...targets.values()].includes(index))index=Array.from({length:9},(_,i)=>i+1).find(i=>![...targets.values()].includes(i));
      if(index===undefined)return null;
      while(f.layers.length<=index){const n=f.layers.length;f.layers.push({name:n===index?name:layerNames[n-1]||'Layer '+n});}
      targets.set(name,index);return index;
    }
    for(const k of keys){
      const current=k.fw?.bindings?.[0];
      if(k.fw?.baseBindingManual||current&&current.t!=='none')continue;
      // 旧截图工程没有来源标记，纯数字按未确认编号处理；真实数字可补读或编辑确认。
      if(k.labelSource==='placeholder'||project.image&&!k.labelSource&&/^\d+$/.test(String(k.label||'').trim())){result.unresolved++;continue;}
      const text=legendText(k).toLowerCase(),name=text==='lower'?'Lower':text==='raise'?'Raise':null;
      const layer=name?layerFor(name):null,action=name&&layer!==null?{t:'mo',l:layer}:inferBinding(k,project.keys,project.options?.mirrorAxis);
      if(action.t==='none'){result.unresolved++;continue;}
      if(!k.fw)k.fw={row:null,col:null,bindings:[]};
      if(!Array.isArray(k.fw.bindings))k.fw.bindings=[];
      k.fw.bindings[0]=action;result.assigned++;
    }
    for(const k of keys){if(!k.fw)k.fw={row:null,col:null,bindings:[]};if(!Array.isArray(k.fw.bindings))k.fw.bindings=[];while(k.fw.bindings.length<f.layers.length)k.fw.bindings.push(defaultAction(k.fw.bindings.length));}
    result.addedLayers=f.layers.length-before;return result;
  }
  const qmkAction=a=>{if(a.t==='trans')return 'KC_TRNS';if(a.t==='none')return 'KC_NO';if(a.t==='mo')return `MO(${a.l})`;if(a.t==='tg')return `TG(${a.l})`;if(a.t==='to')return `TO(${a.l})`;let code=codeMap.get(a.k)?.qmk||'KC_NO';for(const m of (a.m||[]).slice().reverse())code=`${m}(${code})`;return code;};
  const zmkAction=a=>{if(a.t==='trans')return '&trans';if(a.t==='none')return '&none';if(a.t==='mo')return `&mo ${a.l}`;if(a.t==='tg')return `&tog ${a.l}`;if(a.t==='to')return `&to ${a.l}`;const code=codeMap.get(a.k)?.zmk||a.k||'&none';return `&kp ${(a.m||[]).slice().reverse().reduce((s,m)=>({LCTL:`LC(${s})`,RCTL:`RC(${s})`,LSFT:`LS(${s})`,RSFT:`RS(${s})`,LALT:`LA(${s})`,RALT:`RA(${s})`,LGUI:`LG(${s})`,RGUI:`RG(${s})`}[m]||s),code)}`;};
  function ordered(project){return (project.keys||[]).filter(k=>!k.decal).slice().sort((a,b)=>(isSplit(project.firmware)?(a.fw?.side==='right'?1:0)-(b.fw?.side==='right'?1:0):0)||(a.fw?.row??999)-(b.fw?.row??999)||(a.fw?.col??999)-(b.fw?.col??999)||String(a.id).localeCompare(String(b.id)));}
  function physical(keys){
    const corners=keys.flatMap(k=>{const a=(k.angle||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [-1,1].flatMap(x=>[-1,1].map(y=>({x:k.x+x*k.w/2*c-y*k.h/2*s,y:k.y+x*k.w/2*s+y*k.h/2*c})));});
    // 包含未旋转的原点，保证长键大角度旋转时 KLE 原点也不为负。
    const minX=Math.min(...corners.map(p=>p.x),...keys.map(k=>k.x-k.w/2)),minY=Math.min(...corners.map(p=>p.y),...keys.map(k=>k.y-k.h/2)),round=n=>Number(n.toFixed(3));
    return keys.map(k=>{const a={matrix:[k.fw.row,k.fw.col],x:round(k.x-k.w/2-minX),y:round(k.y-k.h/2-minY),w:round(k.w),h:round(k.h)};if(k.angle)Object.assign(a,{r:round(k.angle),rx:round(k.x-minX),ry:round(k.y-minY)});return a;});
  }
  function validate(project){
    const f=project?.firmware,errors=[],warnings=[],keys=(project?.keys||[]).filter(k=>!k.decal);
    if(!f||!['qmk','zmk'].includes(f.target)){errors.push({msg:'请选择 QMK 或 ZMK 固件目标。'});return {errors,warnings};}
    if(!['promicro_avr','promicro_rp2040','nice_nano_v2','rp2040'].includes(f.controller)||(f.controller==='promicro_avr'&&f.target==='zmk')||(f.controller==='nice_nano_v2'&&f.target==='qmk'))errors.push({msg:'主控预设与固件目标不匹配。'});
    if(!/^[a-z][a-z0-9_]{0,31}$/.test(f.id||''))errors.push({msg:'键盘标识必须以小写字母开头，只能包含小写字母、数字和下划线，最长 32 字符。'});
    if(f.usb!==undefined&&(!f.usb||typeof f.usb!=='object'||Array.isArray(f.usb)))errors.push({msg:'USB VID / PID 配置无效，请重新填写。'});
    for(const [prop,value] of Object.entries(usbIds(f)))if(normalizeUsbId(value)===null)errors.push({msg:`USB ${prop.toUpperCase()} 必须是 1–4 位十六进制数，可带 0x 前缀，例如 ${prop==='vid'?'0xFEED':'0x0001'}。`});
    if(![f.rows,f.cols].every(n=>Number.isInteger(n)&&n>=1&&n<=32))errors.push({msg:'矩阵行列数必须为 1–32 的整数。'});
    const split=isSplit(f),allowed=pinOptions(f.controller).map(p=>p.value);
    if(f.controller==='rp2040'&&f.target==='zmk')errors.push({msg:'通用 RP2040 目前仅支持 QMK；ZMK 请选受支持的开发板。'});
    if(split&&f.target==='zmk'&&f.controller!=='nice_nano_v2')errors.push({msg:'ZMK 无线分体需要两块 nice!nano v2；RP2040 没有蓝牙。'});
    for(const side of split?['left','right']:['left']){
      const cfg=sideConfig(f,side)||{},prefix=split?sideName(side)+'：':'';
      const rowPins=Array.isArray(cfg.rowPins)?cfg.rowPins:[],colPins=Array.isArray(cfg.colPins)?cfg.colPins:[],pins=[...rowPins,...colPins];
      if(rowPins.length!==f.rows||rowPins.some(n=>n==null))errors.push({incomplete:rowPins.length<=f.rows,msg:`${prefix}行引脚数量应为 ${f.rows}，且必须全部分配。`});
      if(colPins.length!==f.cols||colPins.some(n=>n==null))errors.push({incomplete:colPins.length<=f.cols,msg:`${prefix}列引脚数量应为 ${f.cols}，且必须全部分配。`});
      if(pins.some(n=>n!==null&&!allowed.includes(n)))errors.push({msg:prefix+'包含主控不支持的引脚。'});
      const assigned=pins.filter(n=>n!==null);if(new Set(assigned).size!==assigned.length)errors.push({msg:prefix+'行列引脚不能重复。'});
      if(f.rows+f.cols>allowed.length)errors.push({msg:`${prefix}行列数之和不能超过 ${allowed.length}。`});
      const reserve=(pin,label)=>{if(!allowed.includes(pin))errors.push({incomplete:pin==null,msg:prefix+label+'尚未选择有效 GPIO。'});else if(assigned.includes(pin))errors.push({msg:prefix+label+'与其他功能引脚重复。'});assigned.push(pin);};
      for(const {pin,label} of serialPins(f))reserve(pin,label);
      const pt=f.split?.pointing;
      if(split&&pt?.enabled&&pt.side===side){reserve(pt.sda,'触控板 SDA');reserve(pt.scl,'触控板 SCL');}
    }
    if(split){
      if(f.target==='qmk'){
        if(!['half_duplex','full_duplex'].includes(serialMode(f)))errors.push({msg:'分体通信方式无效，请选择单线半双工或双线全双工。'});
        if(serialMode(f)==='full_duplex'&&!supportsFullDuplex(f))errors.push({msg:'双线全双工目前需要 RP2040 主控；AVR 请选择单线半双工。'});
      }
      if(!['left','right'].includes(f.split.master))errors.push({msg:'请选择左手或右手作为主手。'});
      for(const side of ['left','right'])if(!keys.some(k=>k.fw?.side===side))errors.push({incomplete:true,msg:sideName(side)+'还没有实体按键。'});
      if(f.target==='qmk'&&f.controller==='promicro_avr'&&![0,1,2,3].includes(f.split.serialPin))errors.push({incomplete:f.split.serialPin==null,msg:'AVR 串行通信请选择 D0 / D1 / D2 / D3 对应的接口。'});
      const pt=f.split.pointing;
      if(pt?.enabled){
        if(f.target!=='qmk'||f.controller!=='rp2040')errors.push({msg:'Azoteq 触控板预设需要 QMK + 通用 RP2040。'});
        if(!['left','right'].includes(pt.side)||!['TPS43','TPS65'].includes(pt.model)||![0,90,180,270].includes(pt.rotation))errors.push({msg:'触控板侧别、型号或旋转角度无效。'});
        if(![2,6,10,14,18,22,26].includes(pt.sda)||![3,7,11,15,19,23,27].includes(pt.scl))errors.push({incomplete:(pt.sda==null||[2,6,10,14,18,22,26].includes(pt.sda))&&(pt.scl==null||[3,7,11,15,19,23,27].includes(pt.scl)),msg:'触控板使用 I2C1：SDA 选 GP2/6/10/14/18/22/26，SCL 选 GP3/7/11/15/19/23/27。'});
      }
    }
    if(!['col2row','row2col'].includes(f.diode))errors.push({msg:'二极管方向无效。'});
    const layers=Array.isArray(f.layers)?f.layers:[];if(layers.length<1||layers.length>10)errors.push({msg:'层数必须为 1–10。'});
    if(!keys.length)errors.push({msg:'实体按键数不能为 0。'});
    const used=new Map();let unknown=0;
    for(const k of keys){
      const row=k.fw?.row,col=k.fw?.col,label=k.label||k.id;
      if(split&&!['left','right'].includes(k.fw?.side))errors.push({incomplete:true,msg:`按键“${label}”尚未设置左手或右手。`,keyId:k.id});
      if(!Number.isInteger(row)||!Number.isInteger(col))errors.push({incomplete:true,msg:`按键“${label}”尚未分配矩阵位置。`,keyId:k.id});
      else if(row<0||row>=f.rows||col<0||col>=f.cols)errors.push({msg:`按键“${label}”的矩阵位置超出范围。`,keyId:k.id});
      else {const slot=`${split?sideName(k.fw?.side)+' ':''}${row},${col}`;if(used.has(slot))errors.push({msg:`矩阵位置 ${slot} 被重复使用。`,keyId:k.id,keyIds:[used.get(slot),k.id]});else used.set(slot,k.id);}
      for(const a of k.fw?.bindings||[]){
        if(['mo','tg','to'].includes(a?.t)&&(!Number.isInteger(a.l)||a.l<0||a.l>=layers.length))errors.push({msg:`按键“${label}”引用了不存在的层。`,keyId:k.id});
        else if(!a||!['kc','mo','tg','to','none','trans'].includes(a.t)||(a.t==='kc'&&(!keycodes.some(c=>c.id===a.k)||!Array.isArray(a.m)||a.m.some(m=>!MODS.includes(m)))))errors.push({msg:`按键“${label}”的动作或键码无效。`,keyId:k.id});
      }
      if(f.target==='qmk'&&(k.fw?.bindings||[]).some(a=>a?.t==='kc'&&a.m?.some(m=>m[0]==='L')&&a.m?.some(m=>m[0]==='R')))errors.push({msg:`按键“${label}”同时使用左右修饰组合，QMK 基础键码无法表示，请选用同一侧修饰键。`,keyId:k.id});
      if(!k.fw?.bindings?.[0]||k.fw.bindings[0].t==='none'){warnings.push({msg:`第 0 层按键“${label}”没有功能。`,keyId:k.id});if(inferBinding(k,keys,project.options?.mirrorAxis).t==='none')unknown++;}
      if(![k.x,k.y,k.w,k.h,k.angle||0].every(Number.isFinite)||k.w<=0||k.h<=0)errors.push({msg:`按键“${label}”的物理尺寸或坐标无效。`,keyId:k.id});
    }
    if(unknown)warnings.push({msg:`${unknown} 个按键的键帽文字未能识别，请手动设置。`});
    const slots=f.rows*f.cols*(split?2:1)-used.size;if(slots>0)warnings.push({msg:`矩阵有 ${slots} 个空位（允许不规则矩阵）。`});
    if(/[^\x20-\x7e]/.test(String(f.displayName||'')))warnings.push({msg:'键盘名称含非 ASCII 字符，将替换为空格。'});
    if(f.target==='zmk'&&String(f.displayName||'').length>16)warnings.push({msg:'ZMK 键盘名称将截断为 16 个字符。'});
    return {errors,warnings};
  }
  const json=value=>JSON.stringify(value,null,2)+'\n';
  const ascii=value=>String(value||'').replace(/[^\x20-\x7e]/g,' ').trim();
  const dts=value=>JSON.stringify(ascii(value));
  const cell=value=>value<0?`(${value})`:String(value);
  function readme(f,display,root){
    return `# ${display}\n\n键盘工坊生成的 ${f.target.toUpperCase()} 固件仓库。锁定版本：${f.target==='qmk'?'QMK '+QMK_VERSION:'ZMK '+ZMK_VERSION}。${isSplit(f)?'左右分体矩阵，按键保存每侧局部行列；右手导出行号偏移 '+f.rows+'。':'独立矩阵键盘。'}示意标记已排除；编码器、屏幕与灯效未启用。${isSplit(f)&&f.split.pointing?.enabled?'已启用 Azoteq '+f.split.pointing.model+'，位于'+sideName(f.split.pointing.side)+'。':'触控板未启用。'}\n\n## 上传与编译\n\n推荐用 GitHub Desktop：File → Add Local Repository，选择此目录；尚未初始化时点击 Create a Repository（在此目录初始化），提交全部文件后 Publish Repository。可选择公开或私有。\n\n也可以在此目录运行以下命令，先在 GitHub 创建一个空仓库，再把 YOUR_NAME / YOUR_REPO 替换为实际地址：\n\n\`\`\`sh\ngit init\ngit add .\ngit commit -m "Initial keyboard firmware"\ngit branch -M main\ngit remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git\ngit push -u origin main\n\`\`\`\n\n**.github 是隐藏文件夹，包含编译流程，必须一并提交。网页上传容易漏掉，建议使用 GitHub Desktop 或 git。**\n\n推送后打开仓库 Actions，等待编译完成；也可在对应流程选择 Run workflow。打开成功的运行，在 Artifacts 下载 firmware（firmware.zip），解压得到 ${f.controller==='promicro_avr'?'.hex':'.uf2'}。下载产物需要登录 GitHub。公开仓库使用标准托管 runner 通常免费；私有仓库消耗账号套餐的 Actions 分钟与存储额度，超出部分按 GitHub 当前价格计费。\n\n## 刷写\n\n${f.controller==='promicro_avr'?'Pro Micro ATmega32U4：用 QMK Toolbox 打开 .hex，选择 ATmega32U4；短接 RST 与 GND 进入 Caterina 引导后 Flash。':'nice!nano / RP2040：按主控说明双击复位（部分 RP2040 需按住 BOOT 再连接 USB）进入 UF2 磁盘，把 .uf2 拖入。'}\n\n${isSplit(f)?f.target==='qmk'?'两侧刷入同一个固件；USB 固定连接'+sideName(f.split.master)+'，通过 MASTER_'+f.split.master.toUpperCase()+' 区分左右手。' + (serialMode(f)==='full_duplex'?'双线全双工：两侧均配置 TX '+pinLabel(f,f.split.serialPin)+'、RX '+pinLabel(f,f.split.serialRxPin)+'；左 TX → 右 RX，左 RX ← 右 TX，GND → GND（共地）。每侧 TX / RX 不可为同一 GPIO；电源按硬件设计连接。':'单线半双工：两侧数据 GPIO 均为 '+pinLabel(f,f.split.serialPin)+'，同名 GPIO 相连，GND → GND（共地）。电源按硬件设计连接。') + '各侧矩阵接线可不同。':'分别把 '+f.id+'_left 和 '+f.id+'_right 的 UF2 刷入对应半边，'+sideName(f.split.master)+'是 central（连接电脑），另一侧是 peripheral；左右之间使用蓝牙。':''}\n\n先核对主控型号、引脚接线和二极管方向。通用 RP2040 使用原生 GP0–GP29，请核对 PCB 实际引出和占用情况；SparkFun Pro Micro RP2040 使用兼容接口映射。名称中的非 ASCII 字符会替换；ZMK 名称限制为 16 字符。USB VID：${normalizeUsbId(usbIds(f).vid)}，PID：${normalizeUsbId(usbIds(f).pid)}，来自软件“固件目标”中的设置。${f.target==='zmk'?'这两个 ID 用于 USB 连接，蓝牙名称及配对标识单独管理。':''}\n`;
  }
  function generate(project){
    // 导入时容错，导出时严格校验，不能先清洗而掩盖非法配置。
    const result=validate(project),f=project?.firmware;if(result.errors.length)return {root:'keyboard-firmware',files:[],...result};
    const p=normalizeProject(project),keys=ordered(p),attrs=physical(keys.map(k=>isSplit(f)&&k.fw.side==='right'?{...k,fw:{...k.fw,row:k.fw.row+f.rows}}:k)),files=[],display=ascii(f.displayName)||'Keyboard';
    const add=(path,content)=>files.push({path,content});
    if(f.target==='qmk'){
      const keyboard={keyboard_name:display,manufacturer:'Keyboard Workshop',maintainer:'keyboard-workshop',usb:{...Object.fromEntries(Object.entries(usbIds(f)).map(([prop,value])=>[prop,normalizeUsbId(value)])),device_version:'1.0.0'},development_board:'promicro',diode_direction:f.diode.toUpperCase(),matrix_pins:{rows:f.rowPins.map(n=>pinName(f,n)),cols:f.colPins.map(n=>pinName(f,n))},features:{bootmagic:true,extrakey:true,mousekey:true},layouts:{LAYOUT:{layout:attrs}}};
      if(f.controller==='rp2040'){delete keyboard.development_board;Object.assign(keyboard,{processor:'RP2040',bootloader:'rp2040',board:'GENERIC_RP_RP2040'});}
      if(isSplit(f)){
        keyboard.split={enabled:true,serial:{driver:f.controller==='promicro_avr'?'bitbang':'vendor',...(serialMode(f)==='full_duplex'?{}:{pin:pinName(f,f.split.serialPin)})},matrix_pins:{right:{rows:f.split.right.rowPins.map(n=>pinName(f,n)),cols:f.split.right.colPins.map(n=>pinName(f,n))}},transport:{sync:{matrix_state:true}}};
        let config='#pragma once\n#define MASTER_'+f.split.master.toUpperCase()+'\n';
        if(serialMode(f)==='full_duplex')config+=`#define SERIAL_USART_FULL_DUPLEX\n#define SERIAL_USART_TX_PIN ${pinName(f,f.split.serialPin)}\n#define SERIAL_USART_RX_PIN ${pinName(f,f.split.serialRxPin)}\n`;
        if(f.controller==='rp2040')config+='#define RP2040_BOOTLOADER_DOUBLE_TAP_RESET\n';
        const pt=f.split.pointing;
        if(pt?.enabled){
          config+=`#define SPLIT_POINTING_ENABLE\n#define POINTING_DEVICE_${pt.side.toUpperCase()}\n#define I2C_DRIVER I2CD1\n#define I2C1_SDA_PIN GP${pt.sda}\n#define I2C1_SCL_PIN GP${pt.scl}\n#define I2C1_CLOCK_SPEED 400000\n#define AZOTEQ_IQS5XX_${pt.model}\n${pt.rotation?`#define AZOTEQ_IQS5XX_ROTATION_${pt.rotation}\n`:''}`;
          add(`keyboards/handwired/${f.id}/rules.mk`,'POINTING_DEVICE_ENABLE = yes\nPOINTING_DEVICE_DRIVER = azoteq_iqs5xx\nI2C_DRIVER_REQUIRED = yes\n');
          add(`keyboards/handwired/${f.id}/halconf.h`,'#pragma once\n#define HAL_USE_I2C TRUE\n#include_next <halconf.h>\n');
          add(`keyboards/handwired/${f.id}/mcuconf.h`,'#pragma once\n#include_next <mcuconf.h>\n#undef RP_I2C_USE_I2C1\n#define RP_I2C_USE_I2C1 TRUE\n');
        }
        add(`keyboards/handwired/${f.id}/config.h`,config);
      }
      add(`keyboards/handwired/${f.id}/keyboard.json`,json(keyboard));
      add(`keyboards/handwired/${f.id}/keymaps/default/keymap.json`,json({version:1,keyboard:`handwired/${f.id}`,keymap:'default',layout:'LAYOUT',layers:f.layers.map((_,i)=>keys.map(k=>qmkAction(k.fw.bindings[i])))}));
      add('.github/workflows/build.yml',`name: Build QMK firmware\non: [push, pull_request, workflow_dispatch]\npermissions:\n  contents: read\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    container: ghcr.io/qmk/qmk_cli:latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/checkout@v4\n        with:\n          repository: qmk/qmk_firmware\n          ref: ${QMK_VERSION}\n          path: qmk_firmware\n          submodules: recursive\n          fetch-depth: 1\n      - name: Install QMK CLI dependencies\n        run: pip install -r qmk_firmware/requirements.txt\n      - name: Configure QMK CLI\n        run: qmk config user.qmk_home="$GITHUB_WORKSPACE/qmk_firmware"\n      - name: Add keyboard definition\n        run: mkdir -p qmk_firmware/keyboards/handwired && cp -R keyboards/handwired/${f.id} qmk_firmware/keyboards/handwired/\n      - name: Compile\n        working-directory: qmk_firmware\n        run: qmk compile -kb handwired/${f.id} -km default${f.controller==='promicro_rp2040'?' -e CONVERT_TO=sparkfun_pm2040':''}\n      - uses: actions/upload-artifact@v4\n        with:\n          name: firmware\n          if-no-files-found: error\n          path: |\n            qmk_firmware/*.hex\n            qmk_firmware/*.uf2\n            qmk_firmware/*.bin\n`);
    }else{
      const board=f.controller==='nice_nano_v2'?'nice_nano_v2':'sparkfun_pro_micro_rp2040',upper=f.id.toUpperCase();
      const pins=(values,input)=>values.map(n=>`<&pro_micro ${n} ${input?'(GPIO_ACTIVE_HIGH | GPIO_PULL_DOWN)':'GPIO_ACTIVE_HIGH'}>`).join(', ');
      const map=attrs.map(a=>`RC(${a.matrix[0]}, ${a.matrix[1]})`).join(' '),keyAttrs=attrs.map(a=>`<&key_physical_attrs ${[a.w,a.h,a.x,a.y,a.r||0,a.rx||0,a.ry||0].map(n=>cell(Math.round(n*100))).join(' ')}>`).join(',\n            ');
      add(`boards/shields/${f.id}/Kconfig.shield`,`config SHIELD_${upper}\n    def_bool $(shields_list_contains,${f.id})\n`);
      add(`boards/shields/${f.id}/Kconfig.defconfig`,`if SHIELD_${upper}\nconfig ZMK_KEYBOARD_NAME\n    default ${dts(display.slice(0,16))}\nendif\n`);
      add(`boards/shields/${f.id}/${f.id}.zmk.yml`,`file_format: "1"\nid: ${f.id}\nname: ${json(display).trim()}\ntype: shield\nrequires: [pro_micro]\nfeatures: [keys]\n`);
      add(`boards/shields/${f.id}/${f.id}.overlay`,`#include <dt-bindings/zmk/matrix_transform.h>\n#include <dt-bindings/gpio/gpio.h>\n#include <physical_layouts.dtsi>\n\n/ {\n    chosen { zmk,kscan = &kscan0; zmk,physical-layout = &physical_layout0; };\n    kscan0: kscan {\n        compatible = "zmk,kscan-gpio-matrix";\n        diode-direction = "${f.diode}";\n        row-gpios = ${pins(f.rowPins,f.diode==='col2row')};\n        col-gpios = ${pins(f.colPins,f.diode==='row2col')};\n    };\n    default_transform: matrix_transform_0 {\n        compatible = "zmk,matrix-transform";\n        rows = <${f.rows*(isSplit(f)?2:1)}>;\n        columns = <${f.cols}>;\n        map = <${map}>;\n    };\n    physical_layout0: physical_layout_0 {\n        compatible = "zmk,physical-layout";\n        display-name = "Default";\n        transform = <&default_transform>;\n        kscan = <&kscan0>;\n        keys = ${keyAttrs};\n    };\n};\n`);
      add(`config/${f.id}.keymap`,`#include <behaviors.dtsi>\n#include <dt-bindings/zmk/keys.h>\n\n/ {\n    keymap {\n        compatible = "zmk,keymap";\n${f.layers.map((l,i)=>`        layer_${i} {\n            display-name = ${dts(l.name)};\n            bindings = <${keys.map(k=>zmkAction(k.fw.bindings[i])).join(' ')}>;\n        };`).join('\n')}\n    };\n};\n`);
      // 两种受支持的 ZMK 板均有 USB；nice!nano 的 peripheral 也保留板级 USB stack。
      add(`config/${f.id}.conf`,`# Keyboard Workshop generated configuration\nCONFIG_USB_DEVICE_VID=${normalizeUsbId(usbIds(f).vid)}\nCONFIG_USB_DEVICE_PID=${normalizeUsbId(usbIds(f).pid)}\n`);
      // 官方 unified-zmk-config-template 原文（v0.3），保留 west 的递归导入。
      add('config/west.yml','manifest:\n  defaults:\n    revision: v0.3\n  remotes:\n    - name: zmkfirmware\n      url-base: https://github.com/zmkfirmware\n    # Additional modules containing boards/shields/custom code can be listed here as well\n    # See https://docs.zephyrproject.org/3.2.0/develop/west/manifest.html#projects\n  projects:\n    - name: zmk\n      remote: zmkfirmware\n      import: app/west.yml\n  self:\n    path: config\n');
      add('zephyr/module.yml','build:\n  settings:\n    board_root: .\n');
      add('.github/workflows/build.yml','name: Build ZMK firmware\non: [push, pull_request, workflow_dispatch]\n\njobs:\n  build:\n    uses: zmkfirmware/zmk/.github/workflows/build-user-config.yml@v0.3\n');
      add('build.yaml',`include:\n  - board: ${board}\n    shield: ${f.id}\n`);
      if(isSplit(f)){
        const folder=`boards/shields/${f.id}`,take=path=>files.find(file=>file.path===path),set=(path,content)=>{const old=take(path);if(old)old.content=content;else add(path,content);};
        const common=take(`${folder}/${f.id}.overlay`);common.path=`${folder}/${f.id}.dtsi`;
        common.content=common.content.replace(/        row-gpios = .*;\n        col-gpios = .*;\n/,'        wakeup-source;\n');
        set(`${folder}/Kconfig.shield`,['left','right'].map(side=>`config SHIELD_${upper}_${side.toUpperCase()}\n    def_bool $(shields_list_contains,${f.id}_${side})\n`).join('\n'));
        set(`${folder}/Kconfig.defconfig`,`if SHIELD_${upper}_LEFT || SHIELD_${upper}_RIGHT\nconfig ZMK_KEYBOARD_NAME\n    default ${dts(display.slice(0,16))}\nconfig ZMK_SPLIT\n    default y\nendif\n\nif SHIELD_${upper}_${f.split.master.toUpperCase()}\nconfig ZMK_SPLIT_ROLE_CENTRAL\n    default y\nendif\n`);
        set(`${folder}/${f.id}.zmk.yml`,`file_format: "1"\nid: ${f.id}\nname: ${json(display).trim()}\ntype: shield\nrequires: [pro_micro]\nfeatures: [keys]\nsiblings: [${f.id}_left, ${f.id}_right]\n`);
        for(const side of ['left','right']){
          const cfg=sideConfig(f,side);
          add(`${folder}/${f.id}_${side}.overlay`,`#include "${f.id}.dtsi"\n\n&default_transform { row-offset = <${side==='right'?f.rows:0}>; };\n&kscan0 {\n    row-gpios = ${pins(cfg.rowPins,f.diode==='col2row')};\n    col-gpios = ${pins(cfg.colPins,f.diode==='row2col')};\n};\n`);
        }
        set('build.yaml',`include:\n  - board: ${board}\n    shield: ${f.id}_left\n  - board: ${board}\n    shield: ${f.id}_right\n`);
      }
    }
    const root=f.target==='qmk'?`${f.id}-qmk`:`zmk-config-${f.id}`;files.unshift({path:'README.md',content:readme(f,display,root)});return {root,files,...result};
  }
  function actionLabel(a){if(!a||a.t==='none')return '无功能';if(a.t==='trans')return '▽';if(a.t!=='kc')return a.t.toUpperCase()+a.l;const symbols={LCTL:'⌃',RCTL:'⌃',LSFT:'⇧',RSFT:'⇧',LALT:'⌥',RALT:'⌥',LGUI:'⌘',RGUI:'⌘'};return (a.m||[]).map(m=>symbols[m]).join('')+(codeMap.get(a.k)?.label||a.k);}
  const api={GPIO,AVR,pinOptions,isSplit,serialMode,supportsFullDuplex,serialPins,sideConfig,sideName,enableSplit,switchController,suggestSides,suggestSplitMatrix,matrixLabel,MODS,QMK_VERSION,ZMK_VERSION,normalizeUsbId,usbIds,keycodes,sanitizeFirmware,sanitizeAction,normalizeProject,populateBaseLayer,suggestMatrix,inferBinding,validate,generate,qmkAction,zmkAction,defaultAction,actionLabel,physical};if(typeof module!=='undefined')module.exports=api;else root.FW=api;
})(typeof window!=='undefined'?window:globalThis);
