(function(root){
  'use strict';
  const KB=typeof module!=='undefined'?require('./core'):root.KB;
  const FW=typeof module!=='undefined'?require('./firmware'):root.FW;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function object(v,fields){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k)))throw Error('参数结构不符合命令约定。');}
  function number(v,min,max){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`数值必须在 ${min}–${max} 之间。`);return v;}
  function choice(v,values){if(!values.includes(v))throw Error('不支持的选项：'+String(v));return v;}
  function label(v,max=100){if(typeof v!=='string'||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw Error('文字过长或含控制字符。');return v;}
  const keyFields=['w','h','angle','label','color','stab','cutoutRotation'];
  const plateFields=['cutout','hole','pitch','pitchY','margin','outline','stabilizers','outlineRadius','holeRadius','kerf','mountHoles','mountDiameter','mountInset','caseType','frameWidth','usbWidth','usbX'];
  const fieldNames={x:'中心 X (U)',y:'中心 Y (U)',w:'宽度 (U)',h:'高度 (U)',angle:'角度 (°)',label:'键帽文字',color:'颜色',stab:'逐键卫星轴',cutoutRotation:'轴孔旋转 (°)',pitch:'横向键距 (mm)',pitchY:'纵向键距 (mm)',hole:'方孔边长 (mm)',cutout:'轴孔类型',margin:'外框边距 (mm)',outline:'板框',stabilizers:'卫星轴类型',outlineRadius:'板框圆角 (mm)',holeRadius:'开孔内角 (mm)',kerf:'切缝补偿 (mm)',mountHoles:'每片固定孔数量',mountDiameter:'固定孔直径 (mm)',mountInset:'孔心距板边 (mm)',caseType:'外壳结构',frameWidth:'中框宽度 (mm)',usbWidth:'USB 开口宽度 (mm)',usbX:'USB 中心 X (mm)',mirrorAxis:'镜像轴 X (U)'};
  function resolve(p,id,selections){const s=selections.get(id);if(!s||!Array.isArray(s.keys)||!s.keys.length)throw Error('选键结果已失效，请重新选择。');return s.keys.map(ref=>{const k=p.keys.find(k=>k.id===ref.id);if(!k)throw Error('目标键已删除，请重新选择。');return k;});}
  function setProperties(keys,properties,notes){
  object(properties,keyFields);if(!Object.keys(properties).length)throw Error('请指定键属性。');
  for(const [prop,value] of Object.entries(properties)){
    if(['w','h'].includes(prop))number(value,.1,20);
    if(prop==='angle')number(value,-360,360);
    if(prop==='label')label(value,200);
    if(prop==='color'&&(typeof value!=='string'||!/^#[a-f0-9]{6}$/i.test(value)))throw Error('颜色须为 #RRGGBB。');
    if(prop==='stab')choice(value,['auto','none','flip']);
    if(prop==='cutoutRotation')choice(value,[0,90,180,270]);
    for(const k of keys){if(['w','h'].includes(prop)&&prop+'2' in k&&k[prop+'2']===k[prop])k[prop+'2']=value;k[prop]=value;if(prop==='label')k.labelSource='manual';}
  }
  if('label' in properties)notes.push('本次修改键帽文字；固件键码保持原值，需要时请同时添加键码提案。');
  }
  // Pure domain commands are shared by UI controls and assistant drafts.
  function editLayout(p,operations,selections){
    if(!Array.isArray(operations)||!operations.length||operations.length>30)throw Error('配列操作须为 1–30 项。');
    const next=clone(p),notes=[];
    for(const op of operations){
      const fields={move:['dx','dy'],set_properties:['properties'],align:['axis','reference'],rotate:['degrees','center'],mirror:['axis'],duplicate:['dx','dy','properties'],delete:[]}[op?.type];
      if(!fields)throw Error('未知配列操作。');object(op,['type','selection_id',...fields]);
      const keys=resolve(next,op.selection_id,selections),ids=new Set(keys.map(k=>k.id));
      if(['move','duplicate'].includes(op.type)){
        if(op.dx===undefined&&op.dy===undefined)throw Error('请给出移动距离（U）。');
        const dx=number(op.dx??0,-1000,1000),dy=number(op.dy??0,-1000,1000);
        if(op.type==='move')keys.forEach(k=>{k.x=KB.round(k.x+dx);k.y=KB.round(k.y+dy);});
        else {if(next.keys.length+keys.length>500)throw Error('最多支持 500 个键位。');for(const k of keys){const copy=clone(k);copy.id=KB.uid();copy.x=KB.round(k.x+dx);copy.y=KB.round(k.y+dy);if(copy.fw){copy.fw.row=null;copy.fw.col=null;}if(op.properties)setProperties([copy],op.properties,notes);next.keys.push(copy);}notes.push('复制键保留键码和形状，矩阵位置清空；请按真实接线重新分配后再导出固件。');}
      }
      if(op.type==='set_properties')setProperties(keys,op.properties,notes);
      if(op.type==='align'){
        if(keys.length<2)throw Error('对齐至少需要两个键。');const axis=choice(op.axis,['x','y']),ref=choice(op.reference??'average',['average','first','min','max']);
        const values=keys.map(k=>k[axis]),value=ref==='first'?values[0]:ref==='min'?Math.min(...values):ref==='max'?Math.max(...values):values.reduce((a,b)=>a+b,0)/values.length;
        keys.forEach(k=>k[axis]=KB.round(value));notes.push(`对齐 ${axis.toUpperCase()}，基准：${{average:'平均中心',first:'选择列表首键',min:'最小坐标',max:'最大坐标'}[ref]}。`);
      }
      if(op.type==='rotate'){
        const degrees=number(op.degrees,-360,360);let center;
        if(op.center===undefined||op.center==='selection')center={x:keys.reduce((s,k)=>s+k.x,0)/keys.length,y:keys.reduce((s,k)=>s+k.y,0)/keys.length};
        else {object(op.center,['x','y']);center={x:number(op.center.x,-1000,1000),y:number(op.center.y,-1000,1000)};}
        for(const k of keys){const v=KB.rotate(k.x-center.x,k.y-center.y,degrees);k.x=KB.round(center.x+v.x);k.y=KB.round(center.y+v.y);k.angle=KB.round(((k.angle+degrees+180)%360+360)%360-180);}
        notes.push(`整组绕 (${KB.round(center.x)}, ${KB.round(center.y)}) U 旋转 ${degrees}°；正值为画面顺时针，键中心与角度同时变化。`);
      }
      if(op.type==='mirror'){
        const axis=op.axis===undefined?(next.options?.mirrorAxis??null):number(op.axis,-1000,1000);
        const result=KB.mirrorSelection(next.keys,ids,{axis});next.keys=result.keys;next.options={...next.options,mirrorAxis:result.axis};
        notes.push(`以画面${result.sourceSide==='left'?'左':'右'}侧为源，校正对侧 ${result.pairs.length} 键；镜像轴 X = ${result.axis} U。保留目标键文字与固件绑定。`);
      }
      if(op.type==='delete'){
        notes.push(`删除 ${keys.length} 键及其 ${keys.reduce((n,k)=>n+(k.fw?.bindings?.length||0),0)} 项层绑定；矩阵不会自动重排。`);
        next.keys=next.keys.filter(k=>!ids.has(k.id));
      }
      KB.checkKeys(next.keys);
    }
    return {next,notes};
  }
  function editPlate(p,input){
    object(input,['parameters','add_features','update_features','delete_features']);const next=clone(p),notes=[];
    const parameters=input.parameters||{};object(parameters,plateFields);
    for(const [key,value] of Object.entries(parameters)){
      if(key==='outline')choice(value,['hull','rectangle','split','capture']);
      if(key==='cutout')choice(value,['square','mx-openable','alps','mx-alps']);
      if(key==='stabilizers')choice(value,['none','pcb','mx-basic','mx-tight','costar','cherry-spec']);
      if(key==='caseType')choice(value,['none','sandwich']);
      if(!['outline','cutout','stabilizers','caseType'].includes(key)&&!(value===null&&['pitchY','usbX'].includes(key)))number(value,-30000,30000);
    }
    next.options={...KB.defaults,...next.options,...parameters};
    if(next.options.outline==='capture'&&!(next.options.outlinePoints?.length>=3))throw Error('尚未描绘闭合截图轮廓，请先在画布描绘。');
    next.features??=[];
    for(const field of ['add_features','update_features','delete_features'])if(input[field]!==undefined&&(!Array.isArray(input[field])||input[field].length>50))throw Error('开孔操作每类最多 50 项。');
    const touched=new Set();
    for(const item of input.update_features||[]){object(item,['id','name','x','y','w','h','angle']);const f=next.features.find(f=>f.id===item.id);if(!f||touched.has(item.id))throw Error('开孔不存在或被重复修改。');touched.add(item.id);Object.assign(f,item);if(f.type==='circle')f.h=f.w;}
    for(const id of input.delete_features||[]){if(!next.features.some(f=>f.id===id)||touched.has(id))throw Error('开孔不存在或操作冲突。');touched.add(id);next.features=next.features.filter(f=>f.id!==id);}
    for(const item of input.add_features||[]){object(item,['type','name','x','y','w','h','angle']);choice(item.type,['rect','circle']);next.features.push({...item,id:KB.uid(),h:item.type==='circle'?item.w:item.h,angle:item.angle??0,name:item.name||'助手开孔'});}
    if(next.features.length>150)throw Error('最多支持 150 个自定义开孔。');
    for(const f of next.features){label(f.name);number(f.x,-30000,30000);number(f.y,-30000,30000);number(f.w,.01,1000);number(f.h,.01,1000);number(f.angle,-360,360);}
    KB.plate(next.keys,next.options,next.features); // Validate scalar bounds before creating a preview.
    if('pitch' in parameters||'pitchY' in parameters)notes.push('键距以 mm 计；键位的 U 坐标不变。自定义开孔使用绝对 mm 坐标，不随键距缩放。');
    return {next,notes};
  }
  const values=v=>v===undefined?'未设置':v===null?'自动':typeof v==='object'?JSON.stringify(v):String(v);
  function diff(before,after){
    const changes=[],previous=new Map(before.keys.map(k=>[k.id,k])),current=new Map(after.keys.map(k=>[k.id,k]));
    for(const k of before.keys)if(!current.has(k.id))changes.push({kind:'delete_key',keyId:k.id,label:k.label,before:`(${k.x}, ${k.y}) U · ${k.fw?.bindings?.length||0} 层绑定`,after:'已删除'});
    for(const k of after.keys){const old=previous.get(k.id);if(!old){changes.push({kind:'add_key',keyId:k.id,label:k.label,before:'无',after:`(${k.x}, ${k.y}) U · ${k.w} × ${k.h} U`});continue;}
      for(const field of ['x','y',...keyFields,'labelSource','w2','h2','x2','y2'])if(!same(old[field],k[field]))changes.push({kind:'key_property',keyId:k.id,label:k.label,field:fieldNames[field]||field,before:values(old[field]),after:values(k[field])});
    }
    for(const field of [...plateFields,'mirrorAxis','outlinePoints','outlineSource'])if(!same(before.options?.[field]??KB.defaults[field],after.options?.[field]??KB.defaults[field]))changes.push({kind:'plate_parameter',field:fieldNames[field]||field,before:values(before.options?.[field]??KB.defaults[field]),after:values(after.options?.[field]??KB.defaults[field])});
    const features=new Map((before.features||[]).map(f=>[f.id,f]));
    for(const f of after.features||[]){const old=features.get(f.id);if(!same(old,f))changes.push({kind:'feature',featureId:f.id,label:f.name,field:'自定义开孔 (mm)',before:old?values(old):'无',after:values(f)});features.delete(f.id);}
    for(const f of features.values())changes.push({kind:'feature',featureId:f.id,label:f.name,field:'删除开孔 (mm)',before:values(f),after:'已删除'});
    return changes;
  }
  function plateInfo(p){
    try{const r=KB.plate(p.keys,p.options,p.features);return {parameters:r.options,bounds:r.bounds,parts:r.parts.map(p=>({id:p.id,name:p.name})),outlineCount:r.outlines.length,mounts:r.circles.filter(c=>c.auto).map(c=>({x:c.x,y:c.y,diameter:c.r*2,name:c.source})),errors:r.errors,warnings:r.warnings};}
    catch(e){return {parameters:{...KB.defaults,...p.options},errors:[e.message],warnings:[],mounts:[]};}
  }
  function issues(p){
    // Validate with unique labels before the geometry validator deduplicates
    // messages. Pairing two independently deduplicated lists by index is unsafe
    // when several keys have the same legend (for example two Space keys).
    const labels=new Map(),token=(kind,id,label)=>{const t=`⟦${kind}:${encodeURIComponent(id)}⟧`;labels.set(t,label||'未命名');return t;};
    const stable={...p,keys:p.keys.map(k=>({...k,label:token('key',k.id,k.label)})),features:(p.features||[]).map(f=>({...f,name:token('feature',f.id,f.name)}))};
    const display=msg=>msg.replace(/⟦(?:key|feature):[^⟧]*⟧/g,t=>labels.get(t)||t);
    const plate=plateInfo(stable),keys=p.keys.filter(k=>!k.decal);
    const result=[];
    for(const [level,list] of [['error',plate.errors],['warning',plate.warnings]])list.forEach(msg=>result.push({module:'plate',level,msg:display(msg),code:msg.replace(/按键 \d+ /g,'按键 ')}));
    const shapes=keys.map(k=>({k,points:KB.keyShape(k,-.025)})).map(s=>({...s,b:KB.bounds(s.points)}));
    for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++){
      const a=shapes[i],b=shapes[j];
      if(a.b.x+a.b.w<=b.b.x||b.b.x+b.b.w<=a.b.x||a.b.y+a.b.h<=b.b.y||b.b.y+b.b.h<=a.b.y)continue;
      if(KB.polygonIntersects(a.points,b.points))result.push({module:'layout',level:'error',msg:`键帽「${a.k.label||a.k.id}」与「${b.k.label||b.k.id}」重叠。`,keyIds:[a.k.id,b.k.id],code:'overlap:'+JSON.stringify([a.k.id,b.k.id].sort())});
    }
    if(p.firmware){
      // Firmware also infers unrecognised legends; keep the real labels for that
      // rule and replace only the labelled key in the issue's stable identity.
      const f=FW.validate(p);for(const [level,list]of [['error',f.errors],['warning',f.warnings]])for(const i of list){
        const key=p.keys.find(k=>k.id===i.keyId),msg=key?i.msg.replace(`“${key.label||key.id}”`,'“按键”'):i.msg;
        result.push({...i,module:'firmware',level,code:JSON.stringify([msg,i.keyId||null,i.keyIds||[]])});
      }
    }
    return result;
  }
  function validation(before,after,{firmware=false}={}){
    const old=issues(before),current=issues(after),signature=i=>JSON.stringify([i.module,i.level,i.code]),known=new Set(old.map(signature));
    const introduced=current.filter(i=>i.level==='error'&&!known.has(signature(i)));
    const blocking=introduced.filter(i=>i.module!=='firmware'||firmware&&!i.incomplete);
    return {existingErrors:old.filter(i=>i.level==='error').length,remainingErrors:current.filter(i=>i.level==='error').length,newErrors:introduced.length,incompleteErrors:current.filter(i=>i.level==='error'&&i.incomplete).length,blockingErrors:blocking,issues:current};
  }
  // Three-way reverse: retain subsequent edits on untouched fields, reject conflicts.
  function reverse(before,after,current){
    const conflicts=[],copy=v=>v===undefined?undefined:clone(v);
    function merge(b,a,c,path){
      if(same(b,a))return copy(c);
      if(same(a,c))return copy(b);
      if(b&&a&&c&&[b,a,c].every(v=>typeof v==='object'&&!Array.isArray(v))){
        const out=copy(c);for(const key of new Set([...Object.keys(b),...Object.keys(a)])){const value=merge(b[key],a[key],c[key],path+'.'+key);if(value===undefined)delete out[key];else out[key]=value;}return out;
      }
      conflicts.push(path);return copy(c);
    }
    const next=clone(current);
    for(const field of ['keys','features']){
      const b=new Map((before[field]||[]).map(k=>[k.id,k])),a=new Map((after[field]||[]).map(k=>[k.id,k])),c=new Map((current[field]||[]).map(k=>[k.id,k]));
      for(const id of new Set([...b.keys(),...a.keys()])){const value=merge(b.get(id),a.get(id),c.get(id),field+'.'+id);if(value===undefined)c.delete(id);else c.set(id,value);}
      const order=(current[field]||[]).map(k=>k.id).filter(id=>c.has(id));
      const original=(before[field]||[]).map(k=>k.id);
      for(let i=0;i<original.length;i++){const id=original[i];if(c.has(id)&&!order.includes(id)){const following=original.slice(i+1).find(id=>order.includes(id));if(following)order.splice(order.indexOf(following),0,id);else order.push(id);}}
      next[field]=order.map(id=>c.get(id));
    }
    for(const field of ['options','firmware','name','groups','image','roi'])next[field]=merge(before[field],after[field],current[field],field);
    if(conflicts.length)throw Error('后续编辑与本次修改冲突，未撤销：'+conflicts.slice(0,5).join('、'));
    KB.checkKeys(next.keys);
    const known=new Set([...issues(before),...issues(current)].filter(i=>i.level==='error').map(i=>i.module+i.code));
    const introduced=issues(next).filter(i=>i.level==='error'&&!known.has(i.module+i.code));
    if(introduced.length)throw Error('撤销会与后续工程配置冲突：'+introduced[0].msg);
    return next;
  }
  const api={editLayout,editPlate,diff,plateInfo,issues,validation,reverse,resolve,number,choice,keyFields,plateFields,fieldNames};
  if(typeof module!=='undefined')module.exports=api;else root.WorkshopCommands=api;
})(typeof window!=='undefined'?window:globalThis);
