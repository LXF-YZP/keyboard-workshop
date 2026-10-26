(function(root){
  'use strict';
  const KB=typeof module!=='undefined'?require('./core'):root.KB;
  const FW=typeof module!=='undefined'?require('./firmware'):root.FW;
  const WC=typeof module!=='undefined'?require('./workshop-commands'):root.WorkshopCommands;
  const clone=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function object(v,fields){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k)))throw Error('参数结构不符合工作流约定。');}
  function text(v,max=120){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw Error('名称为空、过长或含控制字符。');return v.trim();}
  function integer(v,min,max){WC.number(v,min,max);if(!Number.isInteger(v))throw Error('参数须为整数。');return v;}
  function pin(f,value){if(value===null)return null;if(typeof value!=='string')throw Error('引脚须使用软件显示名称（如 GP26），不能猜接口编号。');const opts=FW.pinOptions(f.controller);const matches=opts.filter(p=>p.label.toUpperCase()===value.trim().toUpperCase());if(matches.length!==1)throw Error('当前主控没有引脚 '+value+'，请读取 pin_options。');return matches[0].value;}
  function validateWorkflowArgs(kind,args){
    const definitions={
      project_workflow:[['action','id','name'],['list','compare','duplicate','switch','rename','undo']],
      file_workflow:[['action','part'],['open','project','kle','dxf','svg','firmware','wiring_preview','wiring_svg','wiring_png','kicad']],
      image_workflow:[['action','symmetric'],['open','paste','recognize','labels','roi','calibrate']],
      github_workflow:[['action','repo','create','private'],['status','refresh','logs','publish','download']]
    };
    const def=definitions[kind];if(!def)throw Error('未知工作流。');object(args,def[0]);WC.choice(args.action,def[1]);
    if(args.id!==undefined)text(args.id,120);if(args.name!==undefined)text(args.name);
    if(kind==='project_workflow'&&['duplicate','rename'].includes(args.action))text(args.name);
    if(kind==='project_workflow'&&['compare','switch'].includes(args.action))text(args.id,120);
    if(args.repo!==undefined&&(typeof args.repo!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(args.repo)))throw Error('仓库名称无效。');
    if(args.part!==undefined)WC.choice(args.part,['plate','frame','bottom','all']);
    for(const f of ['symmetric','create','private'])if(args[f]!==undefined&&typeof args[f]!=='boolean')throw Error('开关须为布尔值。');
  }
  function pins(f,values,size){if(!Array.isArray(values)||values.length!==size)throw Error('GPIO 数量须与矩阵行列数一致；尚未接线的位置使用 null。');return values.map(v=>pin(f,v));}
  function editFirmware(project,input,selections=new Map()){
    object(input,['target','controller','id','display_name','rows','cols','diode','usb','split','pins','assignments','suggest_sides','suggest_matrix','populate_base']);
    const next=clone(project),notes=[];
    if(!next.firmware){if(!input.target)throw Error('请明确 QMK 或 ZMK 目标。');next.firmware=FW.sanitizeFirmware({target:WC.choice(input.target,['qmk','zmk']),controller:input.controller||(input.target==='qmk'?'promicro_avr':'nice_nano_v2')});next.keys=FW.normalizeProject(next).keys;}
    const f=next.firmware;
    if(input.target!==undefined)f.target=WC.choice(input.target,['qmk','zmk']);
    if(input.controller!==undefined){WC.choice(input.controller,['promicro_avr','promicro_rp2040','nice_nano_v2','rp2040']);FW.switchController(f,input.controller);notes.push('更换主控沿用现有引脚迁移规则，无法转换的引脚清空；请核对差异与真实接线。');}
    if(input.id!==undefined){if(!/^[a-z][a-z0-9_]{0,31}$/.test(input.id))throw Error('固件标识须为小写字母开头，最多 32 位字母、数字或下划线。');f.id=input.id;}
    if(input.display_name!==undefined)f.displayName=text(input.display_name,64);
    for(const field of ['rows','cols'])if(input[field]!==undefined)f[field]=integer(input[field],1,32);
    if(input.diode!==undefined)f.diode=WC.choice(input.diode,['row2col','col2row']);
    if(input.usb){object(input.usb,['vid','pid']);f.usb={...FW.usbIds(f)};for(const [k,v]of Object.entries(input.usb)){const id=FW.normalizeUsbId(v);if(!id)throw Error('USB '+k.toUpperCase()+' 须为 1–4 位十六进制。');f.usb[k]=id;}}
    if(input.split){object(input.split,['enabled','master','serial_mode','tx','rx','pointing']);const s=input.split;if(s.enabled!==undefined){if(typeof s.enabled!=='boolean')throw Error('分体开关须为布尔值。');FW.enableSplit(f,s.enabled);}else if(!f.split)FW.enableSplit(f,false);
      if(s.master!==undefined)f.split.master=WC.choice(s.master,['left','right']);
      if(s.serial_mode!==undefined)f.split.serialMode=WC.choice(s.serial_mode,['half_duplex','full_duplex']);
      if(s.tx!==undefined)f.split.serialPin=pin(f,s.tx);if(s.rx!==undefined)f.split.serialRxPin=pin(f,s.rx);
      if(s.pointing){object(s.pointing,['enabled','side','model','sda','scl','rotation']);const pt=s.pointing;if(pt.enabled!==undefined&&typeof pt.enabled!=='boolean')throw Error('触控板开关须为布尔值。');for(const k of ['enabled','side','model','rotation'])if(pt[k]!==undefined)f.split.pointing[k]=k==='enabled'?pt[k]:WC.choice(pt[k],k==='side'?['left','right']:k==='model'?['TPS43','TPS65']:[0,90,180,270]);for(const k of ['sda','scl'])if(pt[k]!==undefined)f.split.pointing[k]=pin(f,pt[k]);}
    }
    for(const field of ['suggest_sides','suggest_matrix','populate_base'])if(input[field]!==undefined&&typeof input[field]!=='boolean')throw Error('建议与补齐选项须为布尔值。');
    if(input.suggest_sides){if(!FW.isSplit(f))throw Error('请先启用分体。');for(const m of FW.suggestSides(next.keys,next.options?.mirrorAxis)){const k=next.keys.find(k=>k.id===m.id);if(k.fw.side!==m.side)Object.assign(k.fw,{side:m.side,row:null,col:null});}notes.push('左右手按画面中线建议，请核对实体所属侧。');}
    if(input.assignments!==undefined){if(!Array.isArray(input.assignments)||input.assignments.length>100)throw Error('最多 100 组矩阵分配。');const touched=new Set();for(const a of input.assignments){object(a,['selection_id','side','positions']);const keys=WC.resolve(next,a.selection_id,selections);if(a.side!==undefined&&!FW.isSplit(f))throw Error('单体键盘不能设置左右手。');if(a.side!==undefined)WC.choice(a.side,['left','right']);if(a.positions!==undefined&&(!Array.isArray(a.positions)||a.positions.length!==keys.length))throw Error('矩阵位置数量须与选键数量一致。');keys.forEach((k,i)=>{if(touched.has(k.id))throw Error('同一按键重复分配矩阵。');touched.add(k.id);if(a.side!==undefined&&k.fw.side!==a.side)Object.assign(k.fw,{side:a.side,row:null,col:null});if(a.positions){const pos=a.positions[i];object(pos,['row','col']);k.fw.row=pos.row===null?null:integer(pos.row,0,f.rows-1);k.fw.col=pos.col===null?null:integer(pos.col,0,f.cols-1);}});}}
    if(input.suggest_matrix){if(FW.isSplit(f)&&next.keys.some(k=>!k.decal&&!['left','right'].includes(k.fw?.side)))throw Error('请先明确全部实体键的左右手。');const map=FW.isSplit(f)?FW.suggestSplitMatrix(next.keys):FW.suggestMatrix(next.keys);if(!map.length)throw Error('没有可分配的实体键。');f.rows=integer(Math.max(...map.map(v=>v.row))+1,1,32);f.cols=integer(Math.max(...map.map(v=>v.col))+1,1,32);for(const m of map)Object.assign(next.keys.find(k=>k.id===m.id).fw,{row:m.row,col:m.col});notes.push('自动矩阵只是逻辑建议，不代表 PCB 实际接线。');}
    for(const cfg of [f,f.split?.right].filter(Boolean))for(const [field,size]of [['rowPins','rows'],['colPins','cols']])cfg[field]=Array.from({length:f[size]},(_,i)=>cfg[field]?.[i]??null);
    if(input.pins!==undefined){if(!Array.isArray(input.pins)||input.pins.length>2)throw Error('引脚最多指定左右各一组。');const used=new Set();for(const item of input.pins){object(item,['side','rows','cols']);const side=WC.choice(item.side||'left',['left','right']);if(used.has(side)||side==='right'&&!FW.isSplit(f))throw Error('引脚侧别重复或当前不是分体。');used.add(side);const cfg=FW.sideConfig(f,side);if(item.rows!==undefined)cfg.rowPins=pins(f,item.rows,f.rows);if(item.cols!==undefined)cfg.colPins=pins(f,item.cols,f.cols);}}
    if(input.populate_base){const result=FW.populateBaseLayer(next);notes.push('按现有文字推断补齐第 0 层，保留手动绑定。'+JSON.stringify(result));}
    return {next,notes};
  }
  function firmwareDiff(before,after){
    const out=[],show=v=>v===undefined?'未设置':v===null?'未分配':typeof v==='object'?JSON.stringify(v):String(v);
    function walk(a,b,path){if(same(a,b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],path+'.'+key);}else out.push({kind:'firmware_setting',field:path,before:show(a),after:show(b)});}
    walk(before.firmware,after.firmware,'固件');
    for(const k of after.keys){const old=before.keys.find(v=>v.id===k.id);if(old&&!same(old.fw,k.fw))out.push({kind:'matrix_binding',keyId:k.id,label:k.label,field:'手别／矩阵／层绑定',before:show(old.fw),after:show(k.fw)});}
    return out;
  }
  function editGroups(project,operations,selections){
    if(!Array.isArray(operations)||operations.length>30)throw Error('分组操作最多 30 项。');const next=clone(project);next.groups??=[];
    for(const op of operations){object(op,['type','name','selection_id']);const name=text(op.name,40),old=next.groups.find(g=>g.name===name);WC.choice(op.type,['set','delete']);if(op.type==='delete'){if(!old)throw Error('分组不存在。');next.groups=next.groups.filter(g=>g!==old);}else {const ids=WC.resolve(next,op.selection_id,selections).map(k=>k.id);if(old)old.keyIds=ids;else next.groups.push({name,keyIds:ids});}}
    if(next.groups.length>30)throw Error('最多 30 个语义分组。');return next;
  }
  function groupsDiff(a,b){return same(a.groups||[],b.groups||[])?[]:[{kind:'groups',field:'语义分组',before:JSON.stringify(a.groups||[]),after:JSON.stringify(b.groups||[])}];}
  function cleanGroups(project){project.groups=(project.groups||[]).map(g=>({...g,keyIds:g.keyIds.filter(id=>project.keys.some(k=>k.id===id&&!k.decal))})).filter(g=>g.keyIds.length);return project;}
  function migrateRecognition(before,result,imported=false){
    const keys=clone(result.keys),idMap={},matched=new Set(),uncertain=[];
    if(!imported&&before.image){
      const old=before.keys.filter(k=>!k.decal),im=before.image;
      const candidates=k=>{
        const x=(k.x*result.pitch+result.originX-im.originX)/im.pitch,y=(k.y*result.pitch+result.originY-im.originY)/im.pitch;
        return old.filter(o=>Math.abs(o.w-k.w)<=.35&&Math.abs(o.h-k.h)<=.35).map(o=>({o,d:Math.hypot(o.x-x,o.y-y)})).filter(v=>v.d<=.5).sort((a,b)=>a.d-b.d);
      };
      const lists=keys.map(candidates);
      keys.forEach((k,i)=>{
        const list=lists[i],candidate=list[0];
        if(!candidate||list[1]&&list[1].d-candidate.d<.1||lists.some((other,j)=>j!==i&&other[0]?.o.id===candidate.o.id)){uncertain.push(k.label||k.id);return;}
        const oldKey=candidate.o,temporary=k.id;idMap[temporary]=oldKey.id;k.id=oldKey.id;matched.add(oldKey.id);
        if(oldKey.fw)k.fw=clone(oldKey.fw);
        if(oldKey.labelSource==='manual')Object.assign(k,{label:oldKey.label,labelSource:'manual'});
        for(const field of ['color','stab','cutoutRotation'])if(oldKey[field]!==undefined)k[field]=oldKey[field];
      });
    }
    const lost=before.keys.filter(k=>!matched.has(k.id));
    const groups=imported?[]:(before.groups||[]).map(g=>({...g,keyIds:g.keyIds.filter(id=>matched.has(id))})).filter(g=>g.keyIds.length);
    return {keys,groups,idMap,notes:[imported?'新图片不沿用旧截图的接线与分组；应用前请核对替换范围。':`确定匹配并保留设置 ${matched.size} 键；未匹配旧键 ${lost.length} 个；新增或不确定 ${uncertain.length} 个。不确定键不迁移接线。`,
      ...lost.length?['未迁移旧键：'+lost.map(k=>k.label||k.id).join('、')]:[]]};
  }
  const api={migrateRecognition,editFirmware,firmwareDiff,editGroups,groupsDiff,cleanGroups,text,pin,object,validateWorkflowArgs};
  if(typeof module!=='undefined')module.exports=api;else root.WorkshopFlows=api;
})(typeof window!=='undefined'?window:globalThis);
