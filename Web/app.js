'use strict';
const $ = id => document.getElementById(id);
const native = !!window.webkit?.messageHandlers?.workshop;
const send = (action, payload={}) => { if(native) window.webkit.messageHandlers.workshop.postMessage({action,...payload}); };
let state={version:1,name:'未命名键盘',keys:[],features:[],options:{...KB.defaults},image:null,roi:null,firmware:null,groups:[]};
let view='layout', tool='select', selected=new Set(), featureID=null, imageElement=null, vision={rectangles:[],words:[]};
let camera={scale:38,x:40,y:50}, pointer=null, calibration=[], drawBox=null, outlineDraft=[], saveTimer=null, busy=false, lastPlate=null;
let firmwareLayer=0,firmwareFiles=[],firmwareSide='left',wiringPreviewURL=null;
let githubState={connected:false,busy:false,repositories:[]},githubPending=null;
let snapPreview=null, plateLayer='plate', labelRequest=null, labelToken=0;
let layoutRecords=[], activeLayoutId=null, pendingActiveLayoutId=null, layoutStoreReady=!native;
const CURRENT_LAYOUT_OPTION='__current__';
const NUMERIC_OPTIONS=['pitch','pitchY','hole','margin','holeRadius','outlineRadius','kerf','mountHoles','mountDiameter','mountInset','frameWidth','usbWidth','usbX'],NULLABLE_OPTIONS=new Set(['pitchY','usbX']);
const SWITCH_NAMES={square:'方孔','mx-openable':'开盖缺口',alps:'Alps','mx-alps':'MX / Alps'},STAB_NAMES={none:'无卫星轴',pcb:'PCB 避让','mx-basic':'MX Basic','mx-tight':'MX Tight',costar:'Costar','cherry-spec':'Cherry Spec'},OUTLINE_NAMES={hull:'凸包',contour:'沿键位外形',rectangle:'矩形',split:'左右分体',capture:'截图轮廓',custom:'自定义 CAD'};
const PART_LEGENDS={plate:[['','板框'],['switch-line','轴孔'],['module-line','模块 / 固定孔'],['stabilizer-line','卫星轴']],frame:[['','中框'],['switch-line','开口'],['module-line','固定孔'],['reference-line','轴孔参考']],bottom:[['','底板'],['module-line','固定孔']]};
const pitchY=()=>state.options.pitchY??state.options.pitch;
const pitchText=()=>state.options.pitchY===null||state.options.pitchY===undefined||state.options.pitchY===state.options.pitch?`${state.options.pitch}`:`${state.options.pitch} × ${state.options.pitchY}`;
const MAX_LAYOUT_RECORDS=12, MAX_LAYOUT_BYTES=20*1024*1024;
const undoStack=[],redoStack=[];
let assistantSession=KB.uid(),assistantRevision=0,assistantHighlights=new Set(),assistantPreview=null;
const assistantTransactions=new Map();
function assistantTouch(reset=false){if(reset){assistantSession=KB.uid();assistantTransactions.clear();}assistantRevision++;assistantHighlights.clear();assistantPreview=null;window.dispatchEvent(new CustomEvent('workshop:changed'));}
const canvas=$('canvas'),ctx=canvas.getContext('2d');
const design=getComputedStyle(document.documentElement);
const palette={canvas:design.getPropertyValue('--canvas').trim(),surface:design.getPropertyValue('--surface').trim(),accent:design.getPropertyValue('--accent').trim(),accentSoft:design.getPropertyValue('--accent-soft').trim(),ink:design.getPropertyValue('--ink').trim(),secondary:design.getPropertyValue('--secondary').trim(),muted:design.getPropertyValue('--muted').trim()};
function keyLabelColor(color){
  let hex=String(color).slice(1);
  if(hex.length===3||hex.length===4)hex=[...hex].map(c=>c+c).join('');
  if(!/^[a-f0-9]{6}([a-f0-9]{2})?$/i.test(hex))return palette.ink;
  const alpha=.78*(hex.length===8?parseInt(hex.slice(6),16)/255:1);
  const rgb=[0,2,4].map(i=>(parseInt(hex.slice(i,i+2),16)*alpha+parseInt(palette.canvas.slice(i+1,i+3),16)*(1-alpha))/255);
  const linear=rgb.map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722<.21?palette.surface:palette.ink;
}
function status(text,error=false){$('status').textContent=text;$('status').dataset.tone=error?'error':'normal';}
function mirrorNotice(text,error=false){const note=$('mirrorFeedback');note.textContent=text;note.dataset.tone=error?'error':'normal';note.hidden=false;status(text,error);}
function showBusy(message){busy=true;$('busy').hidden=false;$('busyText').textContent=message;for(const id of ['openImage','pasteImage','recognize','readKeyLabels','openLayout'])$(id).disabled=true;inspector();}
function hideBusy(){busy=false;$('busy').hidden=true;for(const id of ['openImage','pasteImage','recognize','readKeyLabels','openLayout'])$(id).disabled=false;inspector();}
function cloneFirmware(firmware){return firmware?JSON.parse(JSON.stringify(firmware)):null;}
function cloneKeyFirmware(fw){if(!fw)return undefined;return {...('side' in fw?{side:fw.side}:{}),...(fw.baseBindingManual===true?{baseBindingManual:true}:{}),row:Number.isInteger(fw.row)?fw.row:null,col:Number.isInteger(fw.col)?fw.col:null,bindings:(fw.bindings||[]).map(a=>a?.t==='kc'?{t:'kc',k:a.k,m:[...(a.m||[])]}:{...a})};}
function snapshot(){const project={ ...state,...(state.eda?{eda:{...state.eda}}:{}),groups:JSON.parse(JSON.stringify(state.groups||[])),firmware:cloneFirmware(state.firmware),keys:state.keys.map(k=>({...k,fw:cloneKeyFirmware(k.fw)})),features:state.features.map(f=>({...f})),options:JSON.parse(JSON.stringify(state.options)),image:state.image?{...state.image}:null };Object.defineProperty(project,'__layoutId',{value:activeLayoutId,enumerable:false,writable:true});return project;}
function remember(){undoStack.push(snapshot());if(undoStack.length>35)undoStack.shift();redoStack.length=0;}
function hasProjectContent(project=state){return !!(project.image||project.keys?.length||project.features?.length||project.options?.outlinePoints?.length);}
function layoutTitle(project){return String(project.name||project.image?.name||'未命名配列').trim().slice(0,120)||'未命名配列';}
function layoutRecord(id,project,savedAt=Date.now(),name=null){return {id,name:String(name||layoutTitle(project)).trim().slice(0,120)||'未命名配列',savedAt,project};}
function trimLayoutRecords(){layoutRecords=layoutRecords.filter(r=>r&&typeof r.id==='string'&&r.project&&r.project.version===1);const keep=new Set();if(activeLayoutId)keep.add(activeLayoutId);layoutRecords.sort((a,b)=>(Number(b.savedAt)||0)-(Number(a.savedAt)||0));while(layoutRecords.length>MAX_LAYOUT_RECORDS)layoutRecords.pop();while(layoutRecords.length&&JSON.stringify(layoutRecords).length>MAX_LAYOUT_BYTES){const index=[...layoutRecords].reverse().findIndex(r=>!keep.has(r.id));if(index<0)break;layoutRecords.splice(layoutRecords.length-1-index,1);}if(activeLayoutId&&!layoutRecords.some(r=>r.id===activeLayoutId))activeLayoutId=null;}
function updateActiveLayout(project=snapshot()){if(!activeLayoutId||!hasProjectContent(project))return;const record=layoutRecords.find(r=>r.id===activeLayoutId);if(!record)return;record.name=layoutTitle(project);record.savedAt=Date.now();record.project=project;trimLayoutRecords();}
function archiveCurrentLayout({forceNew=false}={}){if(!hasProjectContent())return null;const project=snapshot();let record=!forceNew&&activeLayoutId?layoutRecords.find(r=>r.id===activeLayoutId):null;if(record){record.name=layoutTitle(project);record.savedAt=Date.now();record.project=project;}else{const id=`layout-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;record=layoutRecord(id,project);layoutRecords.unshift(record);activeLayoutId=id;}trimLayoutRecords();syncLayoutManager();return record.id;}
function ensureActiveLayout(){if(!layoutStoreReady||!hasProjectContent()||activeLayoutId&&layoutRecords.some(r=>r.id===activeLayoutId))return activeLayoutId;const id=`layout-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;layoutRecords.unshift(layoutRecord(id,snapshot()));activeLayoutId=id;trimLayoutRecords();return activeLayoutId;}
function loadLayouts(payload){const records=Array.isArray(payload)?payload:Array.isArray(payload?.records)?payload.records:[];layoutRecords=records.map(r=>{if(!r||typeof r.id!=='string'||!r.project||r.project.version!==1||!Array.isArray(r.project.keys))return null;return layoutRecord(r.id,r.project,Number.isFinite(Number(r.savedAt))?Number(r.savedAt):Date.now(),r.name);}).filter(Boolean);layoutStoreReady=true;const preferred=pendingActiveLayoutId||activeLayoutId;activeLayoutId=preferred&&layoutRecords.some(r=>r.id===preferred)?preferred:null;pendingActiveLayoutId=null;trimLayoutRecords();ensureActiveLayout();syncLayoutManager();if(hasProjectContent())persist();}
function syncLayoutManager(){
  const list=$('layoutList');if(!list)return;
  list.replaceChildren();
  const hasCurrent=hasProjectContent();
  if(hasCurrent&&!activeLayoutId){
    const option=document.createElement('option');option.value=CURRENT_LAYOUT_OPTION;option.textContent=`${layoutTitle(state)} · 当前（未归档）`;option.title='当前配列尚未归档';list.append(option);
  }
  if(!layoutRecords.length&&!hasCurrent){
    const empty=document.createElement('option');empty.value='';empty.textContent='暂无已保存配列';list.append(empty);
  }else{
    const ordered=[...layoutRecords].sort((a,b)=>(Number(b.savedAt)||0)-(Number(a.savedAt)||0));
    const totals=new Map(),seen=new Map();for(const record of ordered)totals.set(record.name,(totals.get(record.name)||0)+1);
    for(const record of ordered){
      const option=document.createElement('option');option.value=record.id;
      const date=new Date(Number(record.savedAt)||Date.now());
      const savedAt=date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      const name=record.id===activeLayoutId?layoutTitle(state):record.name;
      const index=seen.get(record.name)||0;seen.set(record.name,index+1);
      const version=totals.get(record.name)>1?` · 版本 ${totals.get(record.name)-index}`:'';
      option.textContent=`${name}${version}${record.id===activeLayoutId?' · 当前':''}`;
      option.title=`最后保存：${savedAt}`;list.append(option);
    }
  }
  list.value=activeLayoutId||((hasCurrent&&!activeLayoutId)?CURRENT_LAYOUT_OPTION:'');
  const selectedOption=list.options[list.selectedIndex];
  list.title=selectedOption?.title||'选择已保存的配列';
  list.disabled=busy||(!layoutRecords.length&&!hasCurrent);
  $('renameLayout').disabled=!hasCurrent||busy;
  $('saveLayoutVersion').disabled=!hasCurrent||busy;
  $('layoutManagerNote').textContent=layoutRecords.length?`已保存 ${layoutRecords.length} 个`:hasCurrent?'尚未归档':'自动保存';
  $('layoutManagerNote').title=layoutRecords.length?'点击上方“当前配列”下拉框可直接切换；替换截图前会自动保存当前配列。':'替换截图时会自动保存当前配列，也可点击“保存为新配列”。';
}
function persistNow(){const project=snapshot();updateActiveLayout(project);syncLayoutManager();if(native){send('autosave',{project,layouts:layoutRecords,activeLayoutId});$('saveStatus').textContent='已自动保存';}else try{localStorage.setItem('keyboard-workshop-v1',JSON.stringify({project,layouts:layoutRecords,activeLayoutId}));$('saveStatus').textContent='已自动保存';}catch(_){try{localStorage.setItem('keyboard-workshop-v1',JSON.stringify(project));$('saveStatus').textContent='已自动保存当前工程';}catch(__){$('saveStatus').textContent='请保存工程文件';}}}
function persist(){clearTimeout(saveTimer);$('saveStatus').textContent='等待保存…';saveTimer=setTimeout(persistNow,500);}
function changed(){WorkshopFlows.cleanGroups(state);assistantTouch();ensureFirmwareKeys();ensureActiveLayout();updateActiveLayout(snapshot());sync();persist();}
function restore(snapshot){window.WorkshopCAD?.cancelDraw();assistantTouch(true);pointer=null;drawBox=null;outlineDraft=[];clearSnap();activeLayoutId=snapshot?.__layoutId??null;state=snapshot;selected.clear();featureID=null;loadReference();sync();persist();}
function undo(){if(!undoStack.length)return;redoStack.push(snapshot());restore(undoStack.pop());status('已撤销。');}
function redo(){if(!redoStack.length)return;undoStack.push(snapshot());restore(redoStack.pop());status('已重做。');}
function loadReference(){
  imageElement=null;
  if(state.image?.data){const img=new Image();img.onload=()=>{imageElement=img;draw();};img.src=state.image.data;}
}
function parseProject(text,name){
  let object;try{object=JSON.parse(text);}catch(_){}
  let next;
  if(object && !Array.isArray(object) && object.version===1 && Array.isArray(object.keys)){
    if(object.keys.length)KB.checkKeys(object.keys);
    const keys=object.keys.map(k=>KB.key({...k,id:KB.uid(),label:String(k.label||'').slice(0,200),color:/^#[a-f0-9]{3,8}$/i.test(k.color)?k.color:'#e8e6e0',stab:['auto','none','flip'].includes(k.stab)?k.stab:'auto',cutoutRotation:[0,90,180,270].includes(Number(k.cutoutRotation))?Number(k.cutoutRotation):0,plateOutline:!!(k.decal&&k.plateOutline)}));
    const features=(object.features||[]).slice(0,150).map(f=>({id:KB.uid(),type:f.type==='circle'?'circle':'rect',name:String(f.name||'开孔').slice(0,100),x:Number(f.x),y:Number(f.y),w:Number(f.w),h:Number(f.h),angle:Number(f.angle)})).filter(f=>[f.x,f.y,f.w,f.h,f.angle].every(Number.isFinite)&&f.w>0&&f.h>0);
    const image=object.image && typeof object.image.data==='string' && /^data:image\/(png|jpeg|webp);base64,/.test(object.image.data) && object.image.data.length<22000000 && [object.image.pitch,object.image.originX,object.image.originY,object.image.width,object.image.height].every(Number.isFinite) && object.image.pitch>0?object.image:null;
    const rawPoints=Array.isArray(object.options?.outlinePoints)?object.options.outlinePoints.slice(0,2000).map(p=>({x:Number(p.x),y:Number(p.y)})):[];
    let savedPoints=[];try{savedPoints=rawPoints.length?KB.outlinePoints(rawPoints):[];}catch(_){savedPoints=[];}
    const savedOutline=['hull','contour','rectangle','split','capture','custom'].includes(object.options?.outline)?object.options.outline:'hull';
    const roi=object.roi&&[object.roi.x,object.roi.y,object.roi.w,object.roi.h].every(Number.isFinite)&&object.roi.w>0&&object.roi.h>0?{x:Number(object.roi.x),y:Number(object.roi.y),w:Number(object.roi.w),h:Number(object.roi.h)}:null;
    const idMap=new Map(object.keys.map((k,i)=>[k.id,keys[i].id]));
    const groups=Array.isArray(object.groups)?object.groups.slice(0,30).filter(g=>g&&typeof g.name==='string'&&Array.isArray(g.keyIds)).map(g=>({name:g.name.slice(0,40),keyIds:g.keyIds.map(id=>idMap.get(id)).filter(Boolean)})).filter(g=>g.keyIds.length):[];
    const normalized=FW.normalizeProject({firmware:object.firmware,keys}),firmware=normalized.firmware;keys.splice(0,keys.length,...normalized.keys);
    next={version:1,name:String(object.name||name||'导入的工程').slice(0,120),keys,features,options:{...KB.defaults,...object.options,outline:savedOutline,outlinePoints:savedPoints,outlineSource:object.options?.outlineSource==='manual'?'manual':savedPoints.length?'auto':null,mirrorAxis:Number.isFinite(object.options?.mirrorAxis)&&Math.abs(object.options?.mirrorAxis)<=1000?object.options.mirrorAxis:null},image,roi,firmware,groups};
    if(next.options.cadGeometry)next.options.cadGeometry=PlateCAD.normalizeGeometry(next.options.cadGeometry);
    if(savedOutline==='custom'&&!next.options.cadGeometry)throw Error('工程缺少自定义 CAD 边框数据。');
    if(next.options.cadDraft)next.options.cadDraft={entities:PlateCAD.entities(next.options.cadDraft.entities)};
    if(object.eda&&typeof object.eda==='object'&&!Array.isArray(object.eda))next.eda=Object.fromEntries(['module','switch','diode','mounts'].filter(k=>Object.hasOwn(object.eda,k)).map(k=>[k,k==='mounts'?object.eda[k]===true:String(object.eda[k]).slice(0,60)]));
  }else{
    const parsed=KB.parseKLE(text);next={version:1,name:parsed.name||name,keys:parsed.keys,features:[],options:{...KB.defaults,mirrorAxis:null},image:null,roi:null,firmware:null};
  }
  return WorkshopFlows.cleanGroups(next);
}
function loadText(text,name,{archive=true,layoutId=null,statusMessage=true}={}){
  const next=parseProject(text,name);
  if(archive)archiveCurrentLayout();remember();assistantTouch(true);state=next;activeLayoutId=layoutId;
  const imported=FW.populateBaseLayer(state);
  selected.clear();featureID=null;vision={rectangles:[],words:[]};loadReference();changed();setView('layout');fit();if(statusMessage){const compound=state.keys.filter(KB.hasCompoundShape).length;status(`已导入${compound?`，含 ${compound} 个 KLE 异形键`:''}。${baseLayerNotice(imported)}请核对键位、旋转和实际键距。`);}
}
function setView(next){finishMove();clearSnap();view=next;document.body.dataset.view=view;if(['plate','firmware'].includes(view)&&tool!=='select')setTool('select');document.querySelectorAll('.tabs [data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});window.WorkshopCAD?.cancelDraw();$('dataPanel').hidden=view!=='data';$('viewLabel').textContent=view==='plate'?plateLayer.toUpperCase():view==='firmware'?'FIRMWARE':'LAYOUT';$('canvasUnits').textContent=view==='plate'?'单位 / mm':'单位 / U';$('plateLegend').hidden=view!=='plate'||!lastPlate;canvasHint();if(view==='firmware')syncFirmware();window.WorkshopCAD?.sync();if(view==='data')$('rawData').value=state.keys.length?KB.exportKLE(state.keys,state.name,true):'';draw();}
function setTool(next){finishMove();const enteringAdd=next==='add'&&tool!=='add';tool=next;calibration=[];clearSnap();if(enteringAdd){selected.clear();featureID=null;}document.querySelectorAll('[data-tool]').forEach(b=>{const active=b.dataset.tool===tool;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});canvas.style.cursor=tool==='select'?'default':'crosshair';if(tool!=='outline'&&outlineDraft.length){outlineDraft=[];}if(enteringAdd)inspector();canvasHint();draw();}
function snapDescription(snap){
  const target=state.keys.find(k=>k.id===snap.targetID);
  const angle=Number.isFinite(snap.angleDelta)&&Math.abs(snap.angleDelta)>1e-6?` · 角度校正为 ${KB.round(target?.angle||0)}°`:'';
  return `与「${target?.label||'邻键'}」${snap.axis==='y'?'同列':'同行'}对齐 · 中心距 ${KB.round(snap.spacing)}U${angle}`;
}
function canvasHint(){
  const hints={select:'点击选择并拖动 · Delete 删除 · Shift 多选',add:'单击新增 1U 键 · 拖动描出长键 · Esc 返回选择',roi:'拖动框出键盘区域，再点击“重新识别截图”',calibrate:'依次点击同一排相邻两个 1U 键的中心',outline:'逐点单击截图外沿；接近首点或点击“完成轮廓”闭合'};
  $('canvasHint').textContent=view==='firmware'?'点击选择键位 · Shift 按顺序多选 · 空白处拖动平移':view==='plate'?`${lastPlate?.parts.find(p=>p.id===plateLayer)?.name||'定位板'}预览 · 成品尺寸 · 拖动平移，滚轮缩放`:snapPreview?snapDescription(snapPreview)+' · 松手确认':tool==='select'&&!$('neighborSnap').checked?'拖动键位调整位置 · Shift 多选 · 滚轮缩放':hints[tool];
  $('canvasHint').classList.toggle('snapped',!!snapPreview);
}
function clearSnap(){snapPreview=null;canvasHint();}
function sync(){
  $('projectName').value=state.name;$('emptyState').hidden=state.keys.length>0||!!state.image;
  const count=state.keys.filter(k=>!k.decal).length;
  $('stats').textContent=`${count} 键${state.keys.length>count?' · '+(state.keys.length-count)+' 个标记':''} · ${pitchText()} mm 键距`;
  for(const p of [...NUMERIC_OPTIONS,'outline','stabilizers','caseType'])$(p).value=state.options[p]??'';
  $('hole').disabled=state.options.cutout!=='square';$('caseFields').hidden=state.options.caseType!=='sandwich';
  const capture=state.options.outline==='capture';$('captureOutlineControls').hidden=!capture;$('outlinePointCount').textContent=state.options.outlinePoints?.length?`已保存 ${state.options.outlinePoints.length} 点`:'尚未闭合';$('autoOutline').disabled=!capture||!state.image||busy;$('drawOutline').disabled=!capture||!state.image||busy;$('finishOutline').disabled=!capture||outlineDraft.length<3;$('cancelOutline').disabled=!capture&&!outlineDraft.length;
  $('switchType').value=state.options.cutout!=='square'?state.options.cutout:Math.abs(state.options.hole-14)<.001?'mx':Math.abs(state.options.hole-13.8)<.001?'choc':'custom';
  $('mirrorAxis').value=state.options.mirrorAxis??'';
  $('mirrorAxis').placeholder=state.keys.some(k=>!k.decal)?'自动：'+KB.round(KB.symmetryAxis(state.keys)):'自动中线';
  $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
  syncLayoutManager();syncFirmware();inspector();validate();window.WorkshopCAD?.sync();draw();githubRender();
}
function inspector(){
  firmwareSelection();
  $('mirrorFeedback').hidden=true;
  const keys=state.keys.filter(k=>selected.has(k.id)),k=keys[0];
  $('selectionCount').textContent=keys.length?'已选择 '+keys.length+' 键':'未选择';$('selectionEmpty').hidden=!!k;$('keyFields').hidden=!k;
  $('keySelectionStatus').textContent=keys.length?`选中 ${keys.length}`:'未选';$('keySelectionStatus').dataset.state=keys.length?'selected':'empty';$('keySelectionStatus').title=keys.length?`当前选中 ${keys.length} 个键位或标记`:'当前没有选中键位';
  $('duplicate').disabled=!keys.length||busy;$('deleteKey').disabled=!keys.length||busy;
  $('mirrorSelection').disabled=!keys.length||keys.some(k=>k.decal)||busy;
  for(const id of ['selectLeftHalf','selectRightHalf'])$(id).disabled=busy||!state.keys.some(k=>!k.decal);
  if(k){$('keyLabel').value=k.label;for(const [id,prop] of [['keyX','x'],['keyY','y'],['keyW','w'],['keyH','h'],['keyAngle','angle']])$(id).value=KB.round(k[prop]);$('keyDecal').checked=k.decal;
    for(const id of ['keyW','keyH'])$(id).title=KB.hasCompoundShape(k)?'异形键的主矩形尺寸；外沿还包含 KLE 次矩形，轴心保持在主矩形中心。':'';
    $('keyStab').value=k.stab||'auto';$('keyRotation').value=String(k.cutoutRotation||0);
    const decals=keys.filter(k=>k.decal);$('keyPlateOutlineRow').hidden=!decals.length;$('keyPlateOutline').checked=decals.length>0&&decals.every(k=>k.plateOutline);}
  const list=$('featureList');list.replaceChildren();$('featureSummary').textContent=state.features.length?`${state.features.length} 个`:'无';
  for(const f of state.features){const button=document.createElement('div');button.className='feature-item'+(featureID===f.id?' active':'');button.textContent=f.name;const span=document.createElement('span');span.textContent=f.type==='circle'?`⌀${f.w}`:`${f.w}×${f.h}`;button.append(span);button.onclick=()=>{featureID=f.id;selected.clear();inspector();draw();};list.append(button);}
  const f=state.features.find(f=>f.id===featureID);$('featureFields').hidden=!f;
  if(f){$('featureName').value=f.name;for(const [id,prop]of [['featureX','x'],['featureY','y'],['featureW','w'],['featureH','h'],['featureAngle','angle']])$(id).value=KB.round(f[prop]);$('featureH').disabled=f.type==='circle';$('featureAngle').disabled=f.type==='circle';}
}
function plateSummaries(){
  const o=state.options;
  $('cutoutSummary').textContent=`${o.cutout==='square'?`方孔 ${o.hole}`:SWITCH_NAMES[o.cutout]||''} · ${STAB_NAMES[o.stabilizers]||''}`;
  $('outlineSummary').textContent=`${pitchText()} · ${OUTLINE_NAMES[o.outline]||''}`;
  $('caseSummary').textContent=`${o.mountHoles?`${o.mountHoles} 孔`:'无固定孔'}${o.caseType==='sandwich'?' · 三明治':''}`;
  $('machiningSummary').textContent=o.holeRadius||o.outlineRadius||o.kerf?`R ${o.holeRadius} · 切缝 ${o.kerf}`:'未启用';
}
function syncParts(){
  const parts=lastPlate?.parts||[];
  if(!parts.some(p=>p.id===plateLayer))plateLayer='plate';
  for(const b of document.querySelectorAll('[data-part]')){const available=parts.some(p=>p.id===b.dataset.part)||b.dataset.part==='plate';b.disabled=!available;b.title=available?'':'在“固定孔与外壳”中选择三明治外壳后可预览';const active=b.dataset.part===plateLayer;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));}
  const hasCase=parts.some(p=>p.id==='frame')&&parts.some(p=>p.id==='bottom');
  $('partAvailability').hidden=hasCase||!state.keys.length;
  $('partAvailability').textContent='中框和底板尚未生成：展开“固定孔与外壳”，将外壳设为“三明治”。';
  const part=parts.find(p=>p.id===plateLayer);
  $('plateLayerName').textContent=part?.name||'定位板';if(view==='plate')$('viewLabel').textContent=plateLayer.toUpperCase();
  $('exportAllRow').hidden=parts.length<2;
  $('exportCaption').textContent=`${part?.name||'定位板'} · DXF R2000 / SVG · mm`;
  const legend=$('plateLegend');legend.replaceChildren();
  for(const [cls,text] of PART_LEGENDS[plateLayer]){const span=document.createElement('span'),line=document.createElement('i');line.className='line-sample'+(cls?' '+cls:'');span.append(line,text);legend.append(span);}
}
function validate(){
  const host=$('checks');host.replaceChildren();lastPlate=null;$('plateLegend').hidden=true;$('fixContourOutline').hidden=true;plateSummaries();
  const badge=$('plateBadge');badge.hidden=true;
  if(!state.keys.length){host.textContent='导入配列后自动检查。';syncParts();return;}
  try{lastPlate=KB.plate(state.keys,state.options,state.features);
    $('fixContourOutline').hidden=state.options.outline!=='capture'||lastPlate.outlines.length>0;
    $('plateLegend').hidden=view!=='plate';
    const auto=lastPlate.circles.filter(c=>c.auto).length;
    const lines=lastPlate.errors.length?lastPlate.errors.slice(0,12).map(t=>['check-error','错误 · '+t]):[['check-pass',`通过 · ${state.options.outline==='custom'&&state.options.cadGeometry?.replaceHoles?`${lastPlate.polygons.length} 个导入开孔`:`${lastPlate.count} 个轴孔`} · ${lastPlate.outlines.length} 块板${auto?` · ${auto} 个固定孔`:''}`],['check-pass',`外形 ${lastPlate.bounds.w.toFixed(1)} × ${lastPlate.bounds.h.toFixed(1)} mm`]];
    if(!lastPlate.errors.length&&lastPlate.parts.length>1)lines.push(['check-pass',`外壳 · ${lastPlate.parts.map(p=>p.name).join(' / ')}`]);
    if(lastPlate.errors.length){badge.hidden=false;badge.textContent=String(lastPlate.errors.length);badge.title=`${lastPlate.errors.length} 个几何错误`;}
    for(const t of lastPlate.warnings)lines.push(['check-warning','核对 · '+t]);
    if(state.image)lines.push(['check-warning','核对 · 截图结果需校准；无法从图片确认真实毫米尺寸。']);
    for(const [cls,text]of lines){const div=document.createElement('div');div.className=cls;div.textContent=text;host.append(div);}
  }catch(e){const p=document.createElement('div');p.className='check-error';p.textContent='错误 · '+e.message;host.append(p);badge.hidden=false;badge.textContent='1';badge.title='参数错误';}
  syncParts();
}
function viewport(){const r=canvas.getBoundingClientRect();return {w:r.width,h:r.height};}
function world(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left-camera.x)/camera.scale,y:(e.clientY-r.top-camera.y)/camera.scale};}
function fit(){
  const pts=state.keys.flatMap(k=>KB.keyShape(k));
  if(view==='plate'&&lastPlate)pts.push(...lastPlate.parts.flatMap(p=>p.outlines.flat()).map(v=>({x:v.x/state.options.pitch,y:v.y/pitchY()})));
  if(view==='plate'&&state.options.cadDraft)pts.push(...state.options.cadDraft.entities.flatMap(PlateCAD.sample).map(p=>({x:p.x/state.options.pitch,y:p.y/pitchY()})));
  if(state.options.outline==='capture'&&state.options.outlinePoints?.length)pts.push(...state.options.outlinePoints);
  let b=KB.bounds(pts);
  if(!state.keys.length && state.image)b={x:-state.image.originX/state.image.pitch,y:-state.image.originY/state.image.pitch,w:state.image.width/state.image.pitch,h:state.image.height/state.image.pitch};
  const {w,h}=viewport();camera.scale=Math.max(3,Math.min(90,Math.min((w-85)/Math.max(b.w,2),(h-100)/Math.max(b.h,2))));camera.x=(w-b.w*camera.scale)/2-b.x*camera.scale;camera.y=(h-b.h*camera.scale)/2-b.y*camera.scale;draw();
}
function path(points){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();}
function draw(){
  const {w,h}=viewport(),dpr=window.devicePixelRatio||1;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle=palette.canvas;ctx.fillRect(0,0,w,h);
  if($('showGrid').checked){const space=camera.scale;ctx.fillStyle='#d5d3cb';for(let x=camera.x%space;x<w;x+=space)for(let y=camera.y%space;y<h;y+=space){ctx.beginPath();ctx.arc(x,y,.8,0,Math.PI*2);ctx.fill();}}
  ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.scale,camera.scale);
  if(imageElement && $('showReference').checked && state.image){const im=state.image;ctx.globalAlpha=Number($('imageOpacity').value)*(view==='plate'?.3:1);ctx.drawImage(imageElement,-im.originX/im.pitch,-im.originY/im.pitch,im.width/im.pitch,im.height/im.pitch);ctx.globalAlpha=1;}
  if(view==='layout'&&state.options.outline==='capture'&&state.options.outlinePoints?.length){path(state.options.outlinePoints);ctx.fillStyle=palette.accentSoft+'55';ctx.fill();ctx.strokeStyle=palette.accent;ctx.lineWidth=1.5/camera.scale;ctx.setLineDash([.18,.12]);ctx.stroke();ctx.setLineDash([]);}
  if(view==='plate'&&lastPlate){
    const px=state.options.pitch,py=pitchY(),u=points=>points.map(v=>({x:v.x/px,y:v.y/py}));
    const part=lastPlate.parts.find(p=>p.id===plateLayer)||lastPlate.parts[0];ctx.lineWidth=1.6/camera.scale;
    for(const poly of part.outlines){path(u(poly));ctx.fillStyle=state.options.cadDraft&&part.id==='plate'?palette.accentSoft+'55':palette.accentSoft;ctx.fill();ctx.strokeStyle=palette.accent;if(!state.options.cadDraft||part.id!=='plate')ctx.stroke();}
    for(const hole of part.holes){path(u(hole.points));ctx.fillStyle=palette.canvas;ctx.fill();ctx.strokeStyle=['SWITCH','FRAME_OPENING'].includes(hole.layer)?'#555950':palette.muted;ctx.setLineDash(['SWITCH','FRAME_OPENING'].includes(hole.layer)?[]:hole.layer==='MODULE'?[5/camera.scale,3/camera.scale]:[2/camera.scale,3/camera.scale]);ctx.stroke();}
    // Faint switch cutouts show what the frame opening has to clear.
    if(part.id!=='plate'){ctx.strokeStyle=palette.muted;ctx.lineWidth=1/camera.scale;ctx.setLineDash([1.5/camera.scale,2.5/camera.scale]);for(const hole of lastPlate.polygons){path(u(hole.points));ctx.stroke();}ctx.lineWidth=1.6/camera.scale;}
    ctx.setLineDash([5/camera.scale,3/camera.scale]);
    for(const c of part.circles){ctx.beginPath();ctx.ellipse(c.x/px,c.y/py,c.r/px,c.r/py,0,0,2*Math.PI);ctx.fillStyle=palette.canvas;ctx.fill();ctx.strokeStyle=palette.muted;ctx.stroke();}
    ctx.setLineDash([]);
  }else{
    for(const k of state.keys){
      ctx.save();ctx.translate(k.x,k.y);ctx.rotate(k.angle*Math.PI/180);
      const sel=selected.has(k.id)||assistantHighlights.has(k.id),issue=view==='firmware'&&!k.decal&&firmwareKeyIssues.has(k.id);ctx.lineWidth=(sel?2:1)/camera.scale;ctx.strokeStyle=issue?'#b64732':sel?palette.accent:k.decal?palette.muted:'#96998f';
      if(k.decal)ctx.setLineDash([.12,.08]);
      path(KB.keyLocalShape(k,-.025));ctx.fillStyle=sel?palette.accentSoft:k.decal?'#e2e1d955':k.color;ctx.globalAlpha=sel||k.decal?1:.78;ctx.fill();ctx.globalAlpha=1;ctx.stroke();ctx.setLineDash([]);
      if(!k.decal){ctx.strokeStyle=sel?'#9bac9c':'#fff9';ctx.lineWidth=1/camera.scale;if(KB.hasCompoundShape(k)){path(KB.keyLocalShape(k,-.09));ctx.stroke();}else ctx.strokeRect(-k.w/2+.09,-k.h/2+.07,k.w-.18,k.h-.2);}
      // WebKit can drop glyphs when the font itself is below 1px, even under a
      // large canvas transform. Draw text in screen pixels at the same visual size.
      ctx.save();ctx.scale(1/camera.scale,1/camera.scale);
      const label=view==='firmware'?(k.decal?'已排除':FW.actionLabel(k.fw?.bindings?.[firmwareLayer])):k.label.replace(/\n/g,' / ').slice(0,32);
      ctx.fillStyle=sel?palette.accent:k.decal?palette.ink:keyLabelColor(k.color);ctx.font=`${Math.min(.26,k.w/Math.max(3,label.length)*1.4)*camera.scale}px "SFMono-Regular", Menlo, "PingFang SC", monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(label,0,view==='firmware'?-.12*camera.scale:0);if(view==='firmware'&&!k.decal){ctx.font=`${Math.max(8,.18*camera.scale)}px Menlo, "PingFang SC", monospace`;ctx.fillStyle=issue?'#b64732':sel?palette.accent:keyLabelColor(k.color);ctx.fillText(FW.matrixLabel(k,state.firmware),0,.23*camera.scale,k.w*.85*camera.scale);}ctx.restore();ctx.restore();
    }
    for(const f of state.features){ctx.strokeStyle=featureID===f.id?palette.accent:palette.muted;ctx.lineWidth=1.5/camera.scale;ctx.setLineDash([.12,.08]);const px=state.options.pitch,py=pitchY();
      if(f.type==='circle'){ctx.beginPath();ctx.ellipse(f.x/px,f.y/py,f.w/2/px,f.w/2/py,0,0,2*Math.PI);}else path(KB.rectangle(f.x,f.y,f.w,f.h,f.angle).map(v=>({x:v.x/px,y:v.y/py})));ctx.stroke();ctx.setLineDash([]);
    }
    if(view==='layout'&&state.keys.some(k=>!k.decal&&selected.has(k.id))){
      const axis=KB.symmetryAxis(state.keys,state.options.mirrorAxis),top=-camera.y/camera.scale,bottom=(h-camera.y)/camera.scale;
      ctx.strokeStyle=palette.accent;ctx.lineWidth=1/camera.scale;ctx.setLineDash([6/camera.scale,5/camera.scale]);
      ctx.beginPath();ctx.moveTo(axis,top);ctx.lineTo(axis,bottom);ctx.stroke();ctx.setLineDash([]);
      ctx.save();ctx.scale(1/camera.scale,1/camera.scale);ctx.font='10px Menlo, "PingFang SC", monospace';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle=palette.accent;
      ctx.fillText(`对称轴 X = ${KB.round(axis)} U`,axis*camera.scale,top*camera.scale+40);ctx.restore();
    }
    if(snapPreview){
      const target=state.keys.find(k=>k.id===snapPreview.targetID),moving=state.keys.find(k=>k.id===snapPreview.movingID);
      if(target&&moving){
        ctx.strokeStyle=palette.accent;ctx.lineWidth=2/camera.scale;ctx.setLineDash([5/camera.scale,4/camera.scale]);
        path(KB.keyShape(target));ctx.stroke();
        const axis=KB.rotate(snapPreview.axis==='x'?1:0,snapPreview.axis==='y'?1:0,target.angle),sign=['above','left'].includes(snapPreview.side)?-1:1;
        ctx.beginPath();ctx.moveTo(target.x-axis.x*sign*.3,target.y-axis.y*sign*.3);ctx.lineTo(moving.x+axis.x*sign*.3,moving.y+axis.y*sign*.3);ctx.stroke();ctx.setLineDash([]);
        for(const k of [target,moving]){ctx.beginPath();ctx.arc(k.x,k.y,4/camera.scale,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.stroke();}
      }
    }
  }
  drawAssistantPreview();
  if(state.roi&&state.image){const r=state.roi,im=state.image;ctx.strokeStyle=palette.accent;ctx.lineWidth=1.5/camera.scale;ctx.setLineDash([.15,.1]);ctx.strokeRect((r.x-im.originX)/im.pitch,(r.y-im.originY)/im.pitch,r.w/im.pitch,r.h/im.pitch);ctx.setLineDash([]);}
  if(drawBox){ctx.strokeStyle=palette.accent;ctx.lineWidth=1.5/camera.scale;ctx.setLineDash([.1,.1]);ctx.strokeRect(drawBox.x,drawBox.y,drawBox.w,drawBox.h);ctx.setLineDash([]);}
  if(outlineDraft.length){ctx.strokeStyle=palette.accent;ctx.fillStyle=palette.accentSoft;ctx.lineWidth=1.8/camera.scale;ctx.setLineDash([.14,.1]);path(outlineDraft);ctx.stroke();ctx.setLineDash([]);outlineDraft.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,(i===0?.18:.12),0,Math.PI*2);ctx.fillStyle=i===0?palette.accent:palette.surface;ctx.fill();ctx.strokeStyle=palette.accent;ctx.stroke();});}
  for(const p of calibration){ctx.beginPath();ctx.arc(p.x,p.y,.12,0,Math.PI*2);ctx.fillStyle=palette.accent;ctx.fill();}
  if(view==='plate')window.WorkshopCAD?.draw(ctx);
  ctx.restore();$('zoomLabel').textContent=Math.round(camera.scale/38*100)+'%';
}
function hit(p){return [...state.keys].reverse().find(k=>KB.inside(p,KB.keyShape(k)));}
function moveSelection(p,altKey=false){
  if(pointer?.mode!=='move')return;
  pointer.latest=p;pointer.altKey=altKey;
  const dx=p.x-pointer.start.x,dy=p.y-pointer.start.y;
  if(!pointer.remembered&&pointer.initial.length&&Math.hypot(dx,dy)>.02){remember();pointer.remembered=true;}
  if(!pointer.remembered)return;
  const moving=pointer.initial.map(initial=>({...state.keys.find(k=>k.id===initial.id),x:initial.x+dx,y:initial.y+dy,angle:initial.angle}));
  const previous=snapPreview;
  snapPreview=$('neighborSnap').checked&&!altKey?KB.snapNeighbors(moving,state.keys,{threshold:Math.min(.24,12/camera.scale),previous}):null;
  let offset=snapPreview||{dx:0,dy:0};
  if(!snapPreview&&!altKey&&$('snap').checked){
    const anchor=moving.find(k=>k.id===pointer.anchorID)||moving[0];
    offset={dx:Math.round(anchor.x*4)/4-anchor.x,dy:Math.round(anchor.y*4)/4-anchor.y};
  }
  const angleDelta=snapPreview?.angleDelta||0;
  for(const moved of moving){const k=state.keys.find(k=>k.id===moved.id);k.x=moved.x+offset.dx;k.y=moved.y+offset.dy;k.angle=moved.angle+angleDelta;}
  canvasHint();inspector();draw();
}
function finishMove(){
  if(pointer?.mode!=='move')return;
  const moved=pointer.remembered,preview=snapPreview;
  pointer=null;clearSnap();
  if(moved){changed();if(preview)status('已'+snapDescription(preview)+'。');}
}
function finishOutlineDraft(){
  if(outlineDraft.length<3){status('至少需要 3 个轮廓点。',true);return false;}
  try{const points=KB.outlinePoints(outlineDraft);remember();state.options.outline='capture';state.options.outlinePoints=points;state.options.outlineSource='manual';outlineDraft=[];changed();setTool('select');fit();status(`已保存截图键盘轮廓（${points.length} 点）；可继续在定位板预览中检查开孔。`);return true;}catch(e){status(e.message,true);return false;}
}
function startOutlineDraft(){
  if(!state.image){status('请先导入截图，再描绘截图键盘轮廓。',true);return;}
  setView('layout');setTool('outline');outlineDraft=[];$('finishOutline').disabled=true;status('请在截图可见外沿逐点单击；接近首点或点击“完成轮廓”闭合。');draw();
}
function autoOutline(){
  if(!state.image||!imageElement){status('请先导入截图，再提取轮廓。',true);return;}
  const result=Recognition.outlineFromImage(imageElement);if(!result){status('未能从截图边缘得到可靠轮廓，请手动描绘。',true);return;}
  const points=result.points.map(p=>({x:(p.x-state.image.originX)/state.image.pitch,y:(p.y-state.image.originY)/state.image.pitch}));
  try{const valid=KB.outlinePoints(points);remember();state.options.outline='capture';state.options.outlinePoints=valid;state.options.outlineSource='auto';outlineDraft=[];changed();fit();status(`已生成截图可见区域的初始轮廓（${valid.length} 点，置信度 ${Math.round(result.confidence*100)}%）；请核对并在截图不完整时手动描绘。`);}catch(e){status('自动轮廓无法使用，请手动描绘：'+e.message,true);}
}
function clearOutline(){
  if(!state.options.outlinePoints?.length&&!outlineDraft.length){status('当前没有截图轮廓。');return;}
  remember();outlineDraft=[];state.options.outlinePoints=[];state.options.outlineSource=null;changed();setTool('select');status('已清除截图键盘轮廓。');
}
canvas.addEventListener('pointerdown',e=>{
  if(busy||view==='data')return;clearSnap();canvas.focus();canvas.setPointerCapture(e.pointerId);const p=world(e);
  if(view==='plate'&&window.WorkshopCAD?.pointerDown(e,p))return;
  if(view==='firmware'){const k=hit(p);if(k){featureID=null;if(e.shiftKey){selected.has(k.id)?selected.delete(k.id):selected.add(k.id);}else selected=new Set([k.id]);pointer=null;}else{if(!e.shiftKey)selected.clear();pointer={mode:'pan',x:e.clientX,y:e.clientY,camera:{...camera}};}inspector();draw();return;}
  if(tool==='outline'){
    if(!state.image){status('请先导入截图，再描绘截图键盘轮廓。',true);return;}
    if(outlineDraft.length>=3&&Math.hypot(p.x-outlineDraft[0].x,p.y-outlineDraft[0].y)<Math.max(.25,10/camera.scale)){finishOutlineDraft();pointer=null;draw();return;}
    outlineDraft.push(p);$('finishOutline').disabled=outlineDraft.length<3;canvasHint();draw();return;
  }
  if(tool==='calibrate'){
    if(!state.image){status('请先上传截图，再校准像素键距。',true);return;}
    calibration.push(p);
    if(calibration.length===2){const ratio=Math.hypot(calibration[1].x-calibration[0].x,calibration[1].y-calibration[0].y);if(ratio<.1){calibration=[];status('两个点太近，请重新选择。',true);return;}
      remember();const old=state.image.pitch;state.image.pitch=old*ratio;for(const k of state.keys){k.x/=ratio;k.y/=ratio;}if(state.options.mirrorAxis!==null)state.options.mirrorAxis/=ratio;if(state.options.outlinePoints?.length)state.options.outlinePoints=state.options.outlinePoints.map(p=>({x:p.x/ratio,y:p.y/ratio}));changed();setTool('select');fit();status(`已校准：相邻 1U 键距为 ${state.image.pitch.toFixed(1)} 像素。真实键距为 ${state.options.pitch} mm。`);
    }else{status('请点击相邻的下一个 1U 键中心。');draw();}return;
  }
  if(tool==='roi'&&!state.image){status('请先上传截图。',true);return;}
  if(tool==='add'||tool==='roi'){pointer={mode:tool,start:p};drawBox={x:p.x,y:p.y,w:0,h:0};return;}
  const k=view==='layout'?hit(p):null;
  if(k){featureID=null;if(e.shiftKey){if(selected.has(k.id))selected.delete(k.id);else selected.add(k.id);}else if(!selected.has(k.id)){selected=new Set([k.id]);}
    pointer={mode:'move',start:p,latest:p,altKey:e.altKey,anchorID:k.id,initial:state.keys.filter(k=>selected.has(k.id)).map(k=>({id:k.id,x:k.x,y:k.y,angle:k.angle})),remembered:false};
  }else{if(!e.shiftKey){selected.clear();featureID=null;}pointer={mode:'pan',x:e.clientX,y:e.clientY,camera:{...camera}};}
  inspector();draw();
});
canvas.addEventListener('pointermove',e=>{if(view==='plate'&&window.WorkshopCAD?.pointerMove(e,world(e)))return;if(!pointer)return;const p=world(e);
  if(pointer.mode==='pan'){camera.x=pointer.camera.x+e.clientX-pointer.x;camera.y=pointer.camera.y+e.clientY-pointer.y;draw();return;}
  if(pointer.mode==='move'){
    moveSelection(p,e.altKey);return;
  }
  drawBox={x:Math.min(pointer.start.x,p.x),y:Math.min(pointer.start.y,p.y),w:Math.abs(p.x-pointer.start.x),h:Math.abs(p.y-pointer.start.y)};draw();
});
canvas.addEventListener('pointerup',e=>{
  if(!pointer)return;
  if(pointer.mode==='add'){
    remember();const b=drawBox,w=b.w>.3?Math.max(.25,Math.round(b.w*4)/4):1,h=b.h>.3?Math.max(.25,Math.round(b.h*4)/4):1;
    if(state.keys.length>=500||w>20||h>20){undoStack.pop();pointer=null;drawBox=null;status('单键尺寸最大为 20U，最多支持 500 个键位。',true);draw();return;}
    const k=KB.key({label:String(state.keys.filter(k=>!k.decal).length+1),labelSource:'placeholder',x:b.w>.3?b.x+b.w/2:pointer.start.x,y:b.h>.3?b.y+b.h/2:pointer.start.y,w,h});state.keys.push(k);selected=new Set([k.id]);featureID=null;changed();status('已新增键位；可继续点击新增，按 Esc 返回选择。');
  }else if(pointer.mode==='roi'&&drawBox.w>.2&&drawBox.h>.2){remember();const im=state.image,b=drawBox;state.roi={x:b.x*im.pitch+im.originX,y:b.y*im.pitch+im.originY,w:b.w*im.pitch,h:b.h*im.pitch};changed();status('已限定识别区域。点击“重新识别截图”应用。');setTool('select');}
  else if(pointer.mode==='move')finishMove();
  pointer=null;drawBox=null;clearSnap();draw();
});
canvas.addEventListener('pointercancel',()=>{finishMove();pointer=null;drawBox=null;clearSnap();draw();});
window.addEventListener('blur',()=>{finishMove();pointer=null;drawBox=null;clearSnap();draw();});
canvas.addEventListener('wheel',e=>{e.preventDefault();const p=world(e),factor=Math.exp(-e.deltaY*.0015);camera.scale=Math.max(3,Math.min(200,camera.scale*factor));const r=canvas.getBoundingClientRect();camera.x=e.clientX-r.left-p.x*camera.scale;camera.y=e.clientY-r.top-p.y*camera.scale;draw();},{passive:false});
function zoom(f){const {w,h}=viewport(),p={x:(w/2-camera.x)/camera.scale,y:(h/2-camera.y)/camera.scale};camera.scale=Math.max(3,Math.min(200,camera.scale*f));camera.x=w/2-p.x*camera.scale;camera.y=h/2-p.y*camera.scale;draw();}
async function setImage(payload){
  const decoded=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('图片无法解码。'));img.src=payload.data;});
  archiveCurrentLayout();
  remember();assistantTouch(true);imageElement=decoded;state.image={...payload,pitch:payload.width/18,originX:0,originY:0};state.name=payload.name||'截图键盘';state.firmware=null;state.keys=[];state.features=[];state.roi=null;state.options.mirrorAxis=null;state.options.outline='hull';delete state.options.cadGeometry;delete state.options.cadDraft;state.options.outlinePoints=[];state.options.outlineSource=null;outlineDraft=[];selected.clear();featureID=null;vision={rectangles:[],words:[]};activeLayoutId=null;
  state.image.width=imageElement.naturalWidth;state.image.height=imageElement.naturalHeight;changed();setView('layout');fit();
}
async function recognize(payload=null){
  if(!imageElement){hideBusy();status('请先上传截图。',true);return;}
  showBusy('正在识别键帽轮廓…');await new Promise(r=>setTimeout(r,35));
  let readingLabels=false;
  try{
    if(payload)vision=payload;
    const sensitivity=Number($('sensitivity').value);
    const nativeBoxes=(vision.rectangles||[]).map(r=>Recognition.candidate(r.points,r.confidence,'vision'));
    const local=Recognition.components(imageElement,sensitivity);
    const raw=[...nativeBoxes,...local];
    const boxes=Recognition.filter(raw,state.image.width,state.image.height,sensitivity).filter(c=>!state.roi||(c.x>=state.roi.x&&c.y>=state.roi.y&&c.x<=state.roi.x+state.roi.w&&c.y<=state.roi.y+state.roi.h));
    const result=Recognition.toLayout(boxes,vision.words||[],0,{splitSymmetry:$('recognitionSymmetry').checked});
    const migratedCount=migrateFirmware(state.keys,result.keys,state.image,result);
    remember();assistantTouch(true);state.keys=result.keys;Object.assign(state.image,{pitch:result.pitch,originX:result.originX,originY:result.originY});selected.clear();featureID=null;state.features=[];state.options.mirrorAxis=result.symmetry?.axis??null;state.options.outlinePoints=[];state.options.outlineSource=null;outlineDraft=[];const imported=FW.populateBaseLayer(state);changed();fit();
    const symmetry=result.symmetry?`检测到左右对称分体布局，已将 ${result.symmetry.pairCount} 对按键对齐到相同水平线${result.symmetry.unmatched?`；另有 ${result.symmetry.unmatched} 个候选未匹配，请手动核对`:''}。`:'';
    const message=`识别出 ${result.keys.length} 个候选键位。${symmetry}${state.firmware?`已迁移 ${migratedCount} 个按键的固件配置，${result.keys.filter(k=>!k.decal).length-migratedCount} 个需要重新分配。`:''}${baseLayerNotice(imported)}`;
    if(native){
      // Legends arrive after the layout and share its undo step.
      requestLabels(result.regions,result.keys,message,false);readingLabels=true;
    }else status(`${message}请叠图检查漏键、误识别和角度，并校准相邻键距；文字不可读时以编号代替。`);
  }catch(e){status(e.message,true);}finally{if(!readingLabels)hideBusy();}
}
// Only keys whose label is unchanged since the request are relabeled, so edits made meanwhile win.
function requestLabels(regions,keys,message,standalone){
  labelRequest={token:++labelToken,message,standalone,placeholders:new Map(keys.map(k=>[k.id,k.label]))};
  showBusy('正在识别键帽文字…');status(message+'正在识别键帽文字…');
  send('readLabels',{token:labelRequest.token,regions,width:state.image.width,height:state.image.height,...standalone?{data:state.image.data}:{}});
}
function readKeyLabels(){
  if(busy)return;
  if(!state.image){status('请先导入截图，再识别键帽文字。',true);return;}
  if(!native){status('键帽文字识别需要在键盘工坊应用中使用。',true);return;}
  const keys=state.keys.filter(k=>!k.decal&&(k.labelSource==='placeholder'||!k.labelSource&&/^\d*$/.test(k.label.trim()))),im=state.image;
  if(!keys.length){status('所有键位都已有文字；只会填写仍是编号或空白的键。');return;}
  // A detected keycap face is about 85% of the key pitch.
  const regions=keys.map(k=>({id:k.id,x:im.originX+k.x*im.pitch,y:im.originY+k.y*im.pitch,w:k.w*im.pitch*.85,h:k.h*im.pitch*.85,angle:k.angle}));
  requestLabels(regions,keys,'',true);
}
function applyLabels({token,labels,warning}){
  const request=labelRequest;if(!request||request.token!==token)return;
  labelRequest=null;hideBusy();
  const updates=(Array.isArray(labels)?labels:[]).map(item=>({key:state.keys.find(k=>k.id===item?.id),label:typeof item?.label==='string'?item.label.trim().slice(0,200):''}))
    .filter(({key,label})=>key&&label&&(label!==key.label||key.labelSource!=='recognized')&&key.label===request.placeholders.get(key.id));
  let imported={assigned:0};
  if(updates.length){if(request.standalone)remember();for(const {key,label} of updates)Object.assign(key,{label,labelSource:'recognized'});imported=FW.populateBaseLayer(state);changed();}
  const count=updates.length,rest=state.keys.filter(k=>k.labelSource!=='recognized'&&k.label===request.placeholders.get(k.id)&&/^\d+$/.test(k.label)).length;
  const result=count?`已识别 ${count} 个键帽文字${rest?`，其余 ${rest} 个（图标或无法辨认）保留编号`:''}，可在右侧“键帽文字”修改。`:'未识别到键帽文字，键位保留编号。';
  status(`${request.message}${result}${baseLayerNotice(imported)}${request.standalone?(count?'可用 ⌘Z 撤销。':''):'请叠图检查漏键、误识别和角度，并校准相邻键距。'}${warning?' '+warning:''}`,!!warning&&!count);
}
function save(name,content){if(native){send('save',{name,content});return;}const url=URL.createObjectURL(new Blob([content],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出 '+name);}
function fileName(){return state.name.replace(/[\\/:*?"<>|]/g,'_').slice(0,100)||'键盘';}
async function sample(){
  if(native){send('sample');return;}
  try{const r=await fetch('sample.json');if(!r.ok)throw Error();loadText(await r.text(),'42键 TPS65');}catch(_){status('请通过“导入 KLE / 工程文件”选择示例目录中的 42键-TPS65.kle.json。',true);}
}
let nativeEventQueue=Promise.resolve();
window.nativeEvent=message=>(nativeEventQueue=nativeEventQueue.then(()=>handleNativeEvent(message)));
async function handleNativeEvent({event,payload}){
  try{
    if(event==='restore'){loadText(JSON.stringify(payload),undefined,{archive:false,layoutId:null,statusMessage:false});undoStack.length=0;redoStack.length=0;sync();status('已恢复上次自动保存的工程。');}
    if(event==='layouts')loadLayouts(payload);
    if(event==='layoutActive'){pendingActiveLayoutId=typeof payload==='string'?payload:payload?.id||null;if(layoutRecords.some(r=>r.id===pendingActiveLayoutId)){activeLayoutId=pendingActiveLayoutId;syncLayoutManager();}}
    if(event==='image')await setImage(payload);
    if(event==='recognition')await recognize(payload);
    if(event==='labels')applyLabels(payload||{});
    if(event==='dxf')window.WorkshopCAD?.receiveDXF(payload);
    if(event==='layout'){loadText(payload.text,payload.name);hideBusy();}
    if(event==='busy')showBusy(payload.message);
    if(event==='notice')status(payload.message,!!payload.error);
    if(event==='error'){hideBusy();status(payload.message,true);$('saveStatus').textContent='请检查保存状态';}
    if(event==='saved')status('已保存：'+payload.name);
    if(event==='githubState')githubReceive(payload);
    if(event.startsWith('assistant'))window.dispatchEvent(new CustomEvent('workshop:assistant',{detail:{event,payload}}));
  }catch(e){hideBusy();status(e.message,true);}
}
for(const b of document.querySelectorAll('.tabs [data-view]'))b.onclick=()=>setView(b.dataset.view);
for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>{setView('layout');setTool(b.dataset.tool);};
$('openImage').onclick=()=>native?send('openImage'):$('imageFile').click();$('emptyImport').onclick=()=>$('openImage').click();
$('openLayout').onclick=()=>native?send('openLayout'):$('layoutFile').click();
function selectLayout(id){
  if(id===CURRENT_LAYOUT_OPTION){status('当前已经是未归档的配列。');return;}
  const record=layoutRecords.find(r=>r.id===id);if(!record){syncLayoutManager();return;}
  if(id===activeLayoutId){status('当前已经是该配列。');return;}
  archiveCurrentLayout();persistNow();loadText(JSON.stringify(record.project),record.name,{archive:false,layoutId:id,statusMessage:false});status(`已切换到配列“${record.name}”。`);
}
$('layoutList').onchange=()=>selectLayout($('layoutList').value);
$('saveLayoutVersion').onclick=()=>{const id=archiveCurrentLayout({forceNew:true});if(id){persist();status('已保存为新配列，可在上方下拉框中切换。');}};
async function importBrowserImage(file){
  if(!file||busy)return;
  try{if(file.size>30*1024*1024)throw Error('图片超过 30 MB，请先缩小。');showBusy('读取截图…');const data=await new Promise((r,j)=>{const f=new FileReader();f.onload=()=>r(f.result);f.onerror=j;f.readAsDataURL(file);});const im=new Image();await new Promise((r,j)=>{im.onload=r;im.onerror=j;im.src=data;});const ratio=Math.min(1,2000/Math.max(im.naturalWidth,im.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*ratio);c.height=Math.round(im.naturalHeight*ratio);const cx=c.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,c.width,c.height);cx.drawImage(im,0,0,c.width,c.height);await setImage({data:c.toDataURL('image/png'),name:file.name.replace(/\.[^.]+$/,''),width:c.width,height:c.height});await recognize();}catch(e){hideBusy();status(e.message||'无法读取图片。',true);}
}
$('imageFile').onchange=async e=>{try{await importBrowserImage(e.target.files[0]);}finally{e.target.value='';}};
$('pasteImage').onclick=async()=>{
  if(native){send('pasteImage');return;}
  try{
    if(!navigator.clipboard?.read)throw Error('请直接按 ⌘V 粘贴截图，或选择图片文件。');
    const items=await navigator.clipboard.read();
    for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type){const data=await item.getType(type);await importBrowserImage(new File([data],'粘贴截图.png',{type}));return;}}
    status('剪贴板里没有图片，请先复制截图。',true);
  }catch(e){status(e.name==='NotAllowedError'?'无法读取剪贴板，请直接按 ⌘V 粘贴截图。':e.message,true);}
};
document.addEventListener('paste',e=>{
  const image=Array.from(e.clipboardData?.files||[]).find(f=>f.type.startsWith('image/'));
  if(!image)return;
  e.preventDefault();
  if(busy)return;
  if(native)send('pasteImage');else importBrowserImage(image);
});
$('layoutFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>25*1024*1024)throw Error('文件过大。');loadText(await f.text(),f.name);}catch(e){status(e.message,true);}finally{e.target.value='';}};
$('readKeyLabels').onclick=readKeyLabels;
$('recognize').onclick=()=>{if(!state.image){status('请先上传截图。',true);return;}if(native){showBusy('正在识别…');send('recognize',{data:state.image.data});}else recognize();};
$('sensitivity').oninput=()=>{$('sensitivityValue').textContent=Number($('sensitivity').value)<.95?'严格':Number($('sensitivity').value)>1.05?'宽松':'标准';};
function renameCurrentLayout(){const name=$('projectName').value.trim().slice(0,120)||'未命名键盘';if(name===state.name){syncLayoutManager();return;}remember();state.name=name;changed();status(`当前配列已命名为“${name}”。`);}
$('projectName').onchange=renameCurrentLayout;
$('projectName').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}};
$('renameLayout').onclick=()=>renameCurrentLayout();
$('showPlate').onclick=()=>{setView('plate');fit();};$('loadSample').onclick=sample;$('emptySample').onclick=sample;
$('undo').onclick=undo;$('redo').onclick=redo;$('fit').onclick=fit;$('zoomIn').onclick=()=>zoom(1.2);$('zoomOut').onclick=()=>zoom(1/1.2);
for(const id of ['showReference','showGrid','imageOpacity'])$(id).oninput=draw;
for(const id of ['neighborSnap','snap'])$(id).onchange=()=>{if(pointer?.mode==='move')moveSelection(pointer.latest,pointer.altKey);else{clearSnap();draw();}};
$('clearROI').onclick=()=>{remember();state.roi=null;changed();status('已清除识别区域。');};
for(const [id,property]of [['keyX','x'],['keyY','y'],['keyW','w'],['keyH','h'],['keyAngle','angle']])$(id).onchange=()=>{
  const keys=state.keys.filter(k=>selected.has(k.id)),first=keys[0],value=Number($(id).value);if(!first)return;
  if(!Number.isFinite(value)||(['w','h'].includes(property)&&(value<.25||value>20))||(['x','y'].includes(property)&&Math.abs(value)>1000)){status('请输入有效的位置或尺寸。',true);inspector();return;}
  const delta=value-first[property],next=state.keys.map(k=>{
    if(!selected.has(k.id))return k;
    const updated={...k};
    if(property==='w'&&'w2' in k&&Math.abs(k.w2-k.w)<1e-9)updated.w2=value;
    if(property==='h'&&'h2' in k&&Math.abs(k.h2-k.h)<1e-9)updated.h2=value;
    updated[property]=['x','y'].includes(property)?k[property]+delta:value;return updated;
  });
  try{KB.checkKeys(next);}catch(e){status(e.message,true);inspector();return;}
  if(next.every((k,i)=>JSON.stringify(k)===JSON.stringify(state.keys[i])))return;
  remember();state.keys=next;changed();
};
$('keyLabel').onchange=()=>{remember();for(const k of state.keys)if(selected.has(k.id))Object.assign(k,{label:$('keyLabel').value,labelSource:'manual'});const imported=FW.populateBaseLayer(state);changed();if(imported.assigned)status(baseLayerNotice(imported));};
$('keyDecal').onchange=()=>{remember();for(const k of state.keys)if(selected.has(k.id))k.decal=$('keyDecal').checked;changed();};
function deleteKeys(){const count=selected.size;if(!count)return;remember();state.keys=state.keys.filter(k=>!selected.has(k.id));selected.clear();featureID=null;setTool('select');changed();status(`已删除 ${count} 个键位，已返回选择模式。`);}
$('deleteKey').onclick=deleteKeys;
$('duplicate').onclick=()=>{const list=state.keys.filter(k=>selected.has(k.id));if(!list.length)return;if(state.keys.length+list.length>500){status('最多支持 500 个键位。',true);return;}remember();selected.clear();for(const k of list){const copy=KB.key({...k,id:KB.uid(),x:k.x+1.2,fw:k.fw?{...cloneKeyFirmware(k.fw),row:null,col:null}:undefined});state.keys.push(copy);selected.add(copy.id);}setTool('select');changed();status(`已复制 ${list.length} 个键位，副本已选中；已返回选择模式。`);};
function applyLayoutCommand(operation){
  if(!selected.size)return;
  try{const selection=new Map([['ui',{keys:state.keys.filter(k=>selected.has(k.id))}]]),result=WorkshopCommands.editLayout(snapshot(),[{...operation,selection_id:'ui'}],selection);
    if(!WorkshopCommands.diff(state,result.next).length)return;remember();state.keys=result.next.keys;state.options=result.next.options;changed();
  }catch(e){status(e.message,true);}
}
for(const [id,axis]of [['alignX','x'],['alignY','y']])$(id).onclick=()=>applyLayoutCommand({type:'align',axis,reference:'average'});
$('zeroAngle').onclick=()=>applyLayoutCommand({type:'set_properties',properties:{angle:0}});
$('mirrorAxis').onchange=()=>{
  const text=$('mirrorAxis').value.trim(),value=text===''?null:Number(text);
  try{if($('mirrorAxis').validity.badInput)throw Error('请输入有效的对称轴 X。');if(value!==null)KB.symmetryAxis(state.keys,value);}catch(e){status(e.message,true);sync();return;}
  if(value===state.options.mirrorAxis)return;
  remember();state.options.mirrorAxis=value;changed();
};
for(const [id,side]of [['selectLeftHalf',-1],['selectRightHalf',1]])$(id).onclick=()=>{
  if(busy)return;
  try{
    setView('layout');setTool('select');
    const axis=KB.symmetryAxis(state.keys,state.options.mirrorAxis);
    selected=new Set(state.keys.filter(k=>!k.decal&&Math.sign(k.x-axis)===side).map(k=>k.id));featureID=null;
    inspector();draw();status(`已选择${side<0?'左':'右'}侧 ${selected.size} 个实体按键。`);
  }catch(e){status(e.message,true);}
};
$('mirrorSelection').onclick=()=>{
  if(busy)return;
  finishMove();
  try{
    const result=KB.mirrorSelection(state.keys,selected,{axis:state.options.mirrorAxis});
    if(!result.pairs.some(p=>{const k=state.keys.find(k=>k.id===p.targetID);return ['x','y','w','h','angle'].some(prop=>Math.abs(k[prop]-p[prop])>1e-6)||Math.abs((k.w2??k.w)-p.w2)>1e-6||Math.abs((k.h2??k.h)-p.h2)>1e-6||Math.abs((k.x2??0)-p.x2)>1e-6||Math.abs((k.y2??0)-p.y2)>1e-6;})){mirrorNotice('对应键已对称，无需校正。');return;}
    remember();assistantTouch(true);state.keys=result.keys;
    // Freeze the axis so correcting an outer column cannot shift the next column's mirror line.
    state.options.mirrorAxis=result.axis;
    changed();mirrorNotice(`已以${result.sourceSide==='left'?'左':'右'}侧为基准，镜像校正${result.sourceSide==='left'?'右':'左'}侧 ${result.pairs.length} 个键位${result.recoveredCount?'，含 1 个远移键':''}；可用 ⌘Z 撤销。`);
  }catch(e){mirrorNotice(`镜像未执行：${e.message} 当前配列未改动。`,true);}
};
for(const property of [...NUMERIC_OPTIONS,'stabilizers','caseType'])$(property).onchange=()=>{
  const raw=$(property).value.trim();let value=NUMERIC_OPTIONS.includes(property)?(raw===''&&NULLABLE_OPTIONS.has(property)?null:Number(raw)):raw;
  if(property==='mountHoles'&&Number.isFinite(value))value=Math.round(value);
  if(value===state.options[property]){sync();return;}
  remember();state.options[property]=value;changed();
};
for(const [id,property,parse] of [['keyStab','stab',v=>v],['keyRotation','cutoutRotation',Number]])$(id).onchange=()=>{remember();for(const k of state.keys)if(selected.has(k.id))k[property]=parse($(id).value);changed();};
$('keyPlateOutline').onchange=()=>{remember();for(const k of state.keys)if(selected.has(k.id)&&k.decal)k.plateOutline=$('keyPlateOutline').checked;changed();};
for(const b of document.querySelectorAll('[data-part]'))b.onclick=()=>{if(b.disabled)return;plateLayer=b.dataset.part;syncParts();window.WorkshopCAD?.sync();canvasHint();draw();};
$('outline').onchange=()=>{const value=$('outline').value;if(value==='custom'&&!state.options.cadGeometry){sync();window.WorkshopCAD?.start();return;}if(state.options.cadDraft){status('请先应用边框或放弃 CAD 草稿。',true);sync();return;}if(value==='capture'&&!state.image){status('请先导入截图，才能使用截图键盘轮廓。',true);sync();return;}remember();state.options.outline=value;if(value!=='capture'){state.options.outlinePoints=[];state.options.outlineSource=null;outlineDraft=[];setTool('select');}changed();if(value==='capture')startOutlineDraft();};
$('contourPreset').onclick=()=>{if(state.options.cadDraft){$('cadPanel').open=true;status('请先放弃或完成 CAD 草稿，再生成键位外形边框。',true);return;}remember();state.options.outline='contour';state.options.margin=2.9;state.options.outlinePoints=[];state.options.outlineSource=null;changed();status('已按键位外形生成边框，外扩 2.9 mm；圆角半径可在上方设置。');};
$('fixContourOutline').onclick=()=>$('contourPreset').click();
$('autoOutline').onclick=autoOutline;$('drawOutline').onclick=startOutlineDraft;$('finishOutline').onclick=finishOutlineDraft;$('cancelOutline').onclick=clearOutline;
$('switchType').onchange=()=>{
  const value=$('switchType').value;
  if(value==='custom'){if(state.options.cutout!=='square'){remember();state.options.cutout='square';changed();}$('hole').focus();return;}
  remember();state.options.cutout=['mx','choc'].includes(value)?'square':value;state.options.hole=value==='choc'?13.8:14;changed();
};
function addFeature(type){if(!state.keys.length){status('请先创建配列。',true);return;}remember();const b=KB.bounds(state.keys.map(k=>({x:k.x*state.options.pitch,y:k.y*pitchY()})));const f={id:KB.uid(),name:type==='circle'?'固定孔':'模块开孔',type,x:KB.round(b.x+b.w/2),y:KB.round(b.y+b.h/2),w:type==='circle'?3:30,h:type==='circle'?3:20,angle:0};state.features.push(f);featureID=f.id;selected.clear();changed();status('已添加开孔，请按机械图修改尺寸与位置。');}
$('addRectangle').onclick=()=>addFeature('rect');$('addCircle').onclick=()=>addFeature('circle');
for(const [id,prop]of [['featureName','name'],['featureX','x'],['featureY','y'],['featureW','w'],['featureH','h'],['featureAngle','angle']])$(id).onchange=()=>{const f=state.features.find(f=>f.id===featureID);if(!f)return;const value=prop==='name'?$(id).value:Number($(id).value);if(prop!=='name'&&(!Number.isFinite(value)||(['w','h'].includes(prop)&&value<=0))){status('请输入有效的开孔尺寸。',true);inspector();return;}remember();f[prop]=value;if(f.type==='circle')f.h=f.w;changed();};
$('deleteFeature').onclick=()=>{if(!featureID)return;remember();state.features=state.features.filter(f=>f.id!==featureID);featureID=null;changed();};
$('exportKLE').onclick=()=>{try{save(fileName()+'.kle.json',KB.exportKLE(state.keys,state.name));}catch(e){status(e.message,true);}};
$('exportRaw').onclick=()=>{try{save(fileName()+'.kle-raw.txt',KB.exportKLE(state.keys,state.name,true));}catch(e){status(e.message,true);}};
function exportPlate(format){
  setView('plate');validate();
  try{
    if(!lastPlate)throw Error('请先导入有效配列，并检查定位板参数。');
    const ids=$('exportAllParts').checked&&lastPlate.parts.length>1?lastPlate.parts.map(p=>p.id):[plateLayer];
    save(`${fileName()}.${ids.length>1?'case':plateLayer}.${format}`,format==='svg'?KB.svg(lastPlate,ids):KB.dxf(lastPlate,ids));
  }catch(e){status('无法导出：'+e.message,true);}
}
for(const [id,format] of [['exportPartDXF','dxf'],['exportPartSVG','svg']])$(id).onclick=()=>exportPlate(format);
$('saveProject').onclick=()=>save(fileName()+'.keyboard.json',JSON.stringify(state,null,2));
$('applyData').onclick=()=>{try{const parsed=KB.parseKLE($('rawData').value);remember();assistantTouch(true);state.keys=parsed.keys;state.name=parsed.name;state.options.mirrorAxis=null;selected.clear();changed();setView('layout');fit();status('已应用配列数据。');}catch(e){status(e.message,true);}};
$('helpButton').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&tool==='outline'){outlineDraft=[];setTool('select');status('已取消当前轮廓描绘。');return;}
  if(e.key==='Escape'&&['add','roi','calibrate'].includes(tool)){setTool('select');status('已返回选择模式。');return;}
  if(e.key==='Alt'&&pointer?.mode==='move'){e.preventDefault();moveSelection(pointer.latest,true);return;}
  const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('saveProject').click();return;}
  if(editing||document.querySelector('dialog[open]'))return;
  if(pointer?.mode==='move'&&(['Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)||((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z')))finishMove();
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if(view==='plate'&&window.WorkshopCAD?.keydown(e))return;
  if(view==='layout'&&(e.key==='Backspace'||e.key==='Delete')&&selected.size){e.preventDefault();deleteKeys();return;}
  if(view==='layout'&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&selected.size){e.preventDefault();remember();const step=e.shiftKey?.25:.05;for(const k of state.keys)if(selected.has(k.id)){k.x+=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;k.y+=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;}changed();}
});
document.addEventListener('keyup',e=>{if(e.key==='Alt'&&pointer?.mode==='move'){e.preventDefault();moveSelection(pointer.latest,false);}});
new ResizeObserver(()=>draw()).observe($('canvasHost'));
window.Workshop={getState:()=>snapshot(),getLayouts:()=>layoutRecords.map(r=>({...r,project:snapshotProject(r.project)})),loadText,recognize,getPlate:()=>lastPlate,fit,command:action=>{
  if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))document.execCommand(action);
  else action==='redo'?redo():undo();
}};

const firmwareKeyIssues=new Set();
function baseLayerNotice(result){return result.assigned?`已将 ${result.assigned} 个键帽动作带入第 0 层${result.addedLayers?'，并创建透明功能层':''}；已有和手动动作保留。`:'';}
function ensureFirmwareKeys(){
  const count=state.firmware?.layers?.length||0;if(!count)return;
  for(const k of state.keys){if(k.decal){delete k.fw;continue;}if(!k.fw)k.fw={row:null,col:null,bindings:[]};if(!Array.isArray(k.fw.bindings))k.fw.bindings=[];while(k.fw.bindings.length<count)k.fw.bindings.push(FW.defaultAction(k.fw.bindings.length));k.fw.bindings.length=count;}
}
function migrateFirmware(oldKeys,newKeys,oldImage,newImage){
  if(!state.firmware)return 0;const used=new Set();let count=0;
  for(const next of newKeys.filter(k=>!k.decal)){
    // 先换回旧工程坐标系，避免重新识别改变截图标尺 / 原点而丢失配置。
    const x=(next.x*newImage.pitch+newImage.originX-oldImage.originX)/oldImage.pitch,y=(next.y*newImage.pitch+newImage.originY-oldImage.originY)/oldImage.pitch;
    const matches=oldKeys.filter(k=>!k.decal&&k.fw&&!used.has(k.id)&&Math.abs(k.w-next.w)<=.35&&Math.abs(k.h-next.h)<=.35).map(k=>({k,d:Math.hypot(k.x-x,k.y-y)})).filter(v=>v.d<=.5).sort((a,b)=>a.d-b.d);
    if(matches.length&&!(matches[1]&&matches[1].d-matches[0].d<.1)){next.fw=cloneKeyFirmware(matches[0].k.fw);used.add(matches[0].k.id);count++;}
  }return count;
}
function syncFirmware(){
  const f=state.firmware,enabled=!!f,split=FW.isSplit(f);if(!split)firmwareSide='left';const cfg=f?FW.sideConfig(f,firmwareSide):null;
  $('firmwareTarget').value=f?.target||'';$('firmwareStatus').textContent=f?.target?.toUpperCase()||'未启用';
  $('qmkCompatHelp').hidden=!enabled||f?.target!=='qmk';
  for(const [id,prop] of [['firmwareController','controller'],['firmwareId','id'],['firmwareDisplayName','displayName'],['firmwareRows','rows'],['firmwareCols','cols'],['firmwareDiode','diode']]){$(id).value=f?.[prop]??'';$(id).disabled=!enabled||busy;}
  const usb=FW.usbIds(f);
  for(const [id,prop] of [['firmwareVid','vid'],['firmwarePid','pid']]){$(id).value=enabled?usb[prop]:'';$(id).disabled=!enabled||busy;$(id).setAttribute('aria-invalid',String(enabled&&FW.normalizeUsbId(usb[prop])===null));}
  for(const opt of $('firmwareController').options){opt.disabled=f?.target==='qmk'?opt.value==='nice_nano_v2':f?.target==='zmk'?['promicro_avr','rp2040'].includes(opt.value):false;opt.title=opt.disabled?'不支持当前固件目标':'';}
  $('firmwareControllerHelp').textContent=({rp2040:'使用 RP2040 原生 GP0–GP29；请核对实际开发板是否引出或已占用该引脚。',promicro_rp2040:'按 SparkFun Pro Micro RP2040 的 GP 编号选择引脚；其他 RP2040 开发板请先核对引脚布局。',promicro_avr:'按 Pro Micro ATmega32U4 板上的引脚丝印选择。',nice_nano_v2:'按 nice!nano v2 的 Pro Micro 兼容接口编号选择引脚。'}[f?.controller]||'请选择固件和主控。')+(f?.target==='zmk'?' ZMK 显示名称最多 16 字符。':'');
  $('firmwareTopology').value=split?'split':'single';$('firmwareTopology').disabled=!enabled||busy;
  $('firmwareRowsLabel').textContent=split?'每侧行数':'行数';$('firmwareColsLabel').textContent=split?'每侧列数':'列数';
  for(const id of ['splitSettings','splitKeyTools','pinSideRow'])$(id).hidden=!split;
  $('pinSide').value=firmwareSide;$('pinSide').disabled=busy;
  $('pinSideSummary').textContent=split?['left','right'].map(side=>`${FW.sideName(side)} ${state.keys.filter(k=>!k.decal&&k.fw?.side===side).length} 键`).join(' · ')+` · 正在编辑${FW.sideName(firmwareSide)}`:'';
  const pinOptions=FW.pinOptions(f?.controller);
  const fillPin=(select,value,filter=()=>true)=>{select.replaceChildren();const empty=new Option('未选GPIO','');select.append(empty);for(const pin of pinOptions.filter(filter)){const option=new Option(pin.label,String(pin.value));option.title=pin.title;select.append(option);}select.value=value??'';select.disabled=busy;};
  if(split){
    $('firmwareMaster').value=f.split.master;$('firmwareMaster').disabled=busy;
    $('masterLabel').textContent=f.target==='qmk'?'USB 固定连接侧':'连接电脑的一侧（central）';
    const full=FW.serialMode(f)==='full_duplex',qmk=f.target==='qmk';
    $('serialModeRow').hidden=!qmk;$('serialMode').value=FW.serialMode(f);$('serialMode').disabled=busy;
    $('serialMode').querySelector('[value="full_duplex"]').disabled=!FW.supportsFullDuplex(f);
    $('serialPinRow').hidden=!qmk;$('serialRxPinRow').hidden=!qmk||!full;
    $('serialPinLabel').textContent=full?'两侧 TX（发送）GPIO':'两侧数据 GPIO';
    fillPin($('serialPin'),f.split.serialPin);fillPin($('serialRxPin'),f.split.serialRxPin);
    for(const [id,other] of [['serialPin',full?f.split.serialRxPin:null],['serialRxPin',f.split.serialPin]]){
      const select=$(id);
      for(const option of [...select.options].slice(1)){
        const pin=Number(option.value),pt=f.split.pointing;
        const occupied=['left','right'].some(side=>['rowPins','colPins'].some(prop=>(FW.sideConfig(f,side)[prop]||[]).includes(pin)))||pin===other||(pt.enabled&&[pt.sda,pt.scl].includes(pin));
        option.disabled=occupied&&option.value!==select.value;
      }
    }
    $('splitTransportHelp').textContent=qmk?(full?'双线全双工：两侧 TX / RX 各选一个不同的 GPIO；左 TX → 右 RX，左 RX ← 右 TX，并共地。':'单线半双工：只需 1 个数据 GPIO，两侧同名 GPIO 相连，并共地。若 PCB 使用 TX / RX 两条数据线，请切换双线全双工。')+' 两侧刷同一固件，USB 固定连接所选主手。'+(!FW.supportsFullDuplex(f)?' 当前 AVR 预设仅支持单线；双线模式需要 RP2040。':''):'两侧使用 nice!nano v2，通过蓝牙通信。导出 left / right 两份固件，分别刷入对应半边。';
    $('referenceSplit').disabled=busy;$('divideHands').disabled=busy||!state.keys.some(k=>!k.decal);
    const pt=f.split.pointing;$('azoteqEnabled').checked=pt.enabled;$('azoteqEnabled').disabled=busy||(!pt.enabled&&(f.target!=='qmk'||f.controller!=='rp2040'));
    $('azoteqSettings').hidden=!pt.enabled;
    for(const [id,prop] of [['azoteqSide','side'],['azoteqModel','model'],['azoteqRotation','rotation']]){$(id).value=pt[prop];$(id).disabled=busy;}
    fillPin($('azoteqSda'),pt.sda,p=>[2,6,10,14,18,22,26].includes(p.value));fillPin($('azoteqScl'),pt.scl,p=>[3,7,11,15,19,23,27].includes(p.value));
  }
  for(const [prop,size,prefix] of [['rowPins','rows','R'],['colPins','cols','C']]){const host=$(prop);host.replaceChildren();for(let i=0;i<(f?.[size]||0);i++){
    const label=document.createElement('label');label.className='pin-field';const name=document.createElement('span');name.textContent=prefix+i;const select=document.createElement('select');select.dataset.pin=prop;select.dataset.index=i;select.setAttribute('aria-label',`${split?FW.sideName(firmwareSide):''}${prefix}${i} GPIO 引脚`);fillPin(select,cfg[prop]?.[i]);
    for(const option of [...select.options].slice(1)){const pin=Number(option.value),pt=f.split?.pointing;
      const occupied=['rowPins','colPins'].some(p=>(cfg[p]||[]).some((n,j)=>n===pin&&(p!==prop||i!==j)))||FW.serialPins(f).some(p=>p.pin===pin)||(split&&pt?.enabled&&pt.side===firmwareSide&&[pt.sda,pt.scl].includes(pin));
      option.disabled=occupied&&cfg[prop]?.[i]!==pin;
    }
    select.title=select.selectedOptions[0]?.title||'按实际接线选择此行或列连接的 GPIO';select.onchange=()=>{remember();cfg[prop][i]=select.value===''?null:Number(select.value);changed();};label.append(name,select);host.append(label);
  }}
  firmwareLayer=Math.max(0,Math.min(firmwareLayer,(f?.layers?.length||1)-1));
  $('layerSummary').textContent=`${f?.layers.length||0} 层`;$('layerList').replaceChildren();for(const [i,layer] of (f?.layers||[]).entries()){const b=document.createElement('button');b.textContent=`${i} · ${layer.name}`;b.className=i===firmwareLayer?'active':'';b.onclick=()=>{firmwareLayer=i;syncFirmware();firmwareSelection();draw();};$('layerList').append(b);}
  $('layerName').value=f?.layers[firmwareLayer]?.name||'';$('layerName').disabled=!enabled||busy;$('addLayer').disabled=!enabled||f.layers.length>=10||busy;$('deleteLayer').disabled=!enabled||firmwareLayer===0||busy;
  for(const id of ['suggestMatrix','inferBindings'])$(id).disabled=!enabled||!state.keys.some(k=>!k.decal)||busy;
  const assigned=state.keys.filter(k=>!k.decal&&Number.isInteger(k.fw?.row)&&Number.isInteger(k.fw?.col)&&(!split||['left','right'].includes(k.fw?.side))).length,total=state.keys.filter(k=>!k.decal).length;$('matrixSummary').textContent=`已设 ${assigned} / ${total}`;
  $('matrixHelp').textContent=!enabled?'选择固件后，先设置每个实体按键的矩阵行列。':assigned<total?`${total-assigned} 个按键未设行列。可自动建议，再按实际接线核对；也可选中按键手动设置。`:'R 表示矩阵行，C 表示矩阵列。请按实际接线核对，再选择下方 GPIO。';
  if(split)$('matrixHelp').textContent='先划分左右手，再建议各侧矩阵。左 / 右表示所属半边，R / C 是本侧行列；右手导出行号自动偏移 '+f.rows+'。建议编号须按实际接线核对。';
  const result=FW.validate(state);firmwareKeyIssues.clear();for(const e of result.errors){if(e.keyId)firmwareKeyIssues.add(e.keyId);for(const id of e.keyIds||[])firmwareKeyIssues.add(id);}
  const checks=$('firmwareChecks');checks.replaceChildren();$('firmwareCheckSummary').textContent=`${result.errors.length} 错误 · ${result.warnings.length} 提示`;
  for(const [items,tone] of [[result.errors,'error'],[result.warnings,'warning']])for(const issue of items){const b=document.createElement('button');b.className='firmware-issue '+tone;b.textContent=(tone==='error'?'● ':'△ ')+issue.msg;if(issue.keyId){b.dataset.key=issue.keyId;b.onclick=()=>{selected=new Set(issue.keyIds||[issue.keyId]);const key=state.keys.find(k=>k.id===issue.keyId);if(key){const {w,h}=viewport();camera.x=w/2-key.x*camera.scale;camera.y=h/2-key.y*camera.scale;}inspector();draw();};}checks.append(b);}
  if(!result.errors.length&&!result.warnings.length)checks.textContent='检查通过，可以导出。';
  $('previewFirmware').disabled=!!result.errors.length||busy;$('exportFirmware').disabled=!!result.errors.length||busy;
  for(const id of ['previewWiringDiagramQuick','exportWiringSVG','exportWiringPNG'])$(id).disabled=!enabled||busy;
  $('openKiCad').disabled=busy;
  $('uploadGitHub').disabled=busy;
}
function firmwareSelection(){
  const keys=state.keys.filter(k=>selected.has(k.id)&&!k.decal),one=keys.length===1?keys[0]:null,f=state.firmware,enabled=!!f&&!busy;
  for(const [id,prop] of [['selectedRow','row'],['selectedCol','col']]){$(id).disabled=!enabled||!one;$(id).value=one?.fw?.[prop]??'';$(id).max=f?(prop==='row'?f.rows:f.cols)-1:31;}
  $('selectedSide').disabled=!enabled||!keys.length;$('selectedSide').value=keys.length&&keys.every(k=>k.fw?.side===keys[0].fw?.side)?keys[0].fw?.side||'':'';
  $('sequenceMatrix').disabled=!enabled||!keys.length;for(const id of ['sequenceRow','sequenceCol','bindingType','bindingSearch','bindingKey','bindingLayer','applyBinding'])$(id).disabled=!enabled||!keys.length;
  const a=keys[0]?.fw?.bindings?.[firmwareLayer]||FW.defaultAction(firmwareLayer);if(a.t==='kc'&&![...$('bindingKey').options].some(o=>o.value===a.k)){$('bindingSearch').value='';filterKeycodes();}$('bindingType').value=a.t;$('bindingKey').value=a.t==='kc'?a.k:'A';$('bindingLayer').value=a.l??0;$('bindingLayer').max=(f?.layers.length||1)-1;
  for(const input of $('bindingModifiers').querySelectorAll('input')){input.checked=(a.m||[]).includes(input.value);input.disabled=!enabled||!keys.length;}
  bindingVisibility();
}
function bindingVisibility(){const type=$('bindingType').value;$('bindingKeyRow').hidden=type!=='kc';$('bindingModifiers').hidden=type!=='kc';$('bindingLayerRow').hidden=!['mo','tg','to'].includes(type);}
function firmwareChange(edit){if(!state.firmware||busy)return;remember();edit(state.firmware);changed();}
$('firmwareTarget').onchange=()=>{
  if(busy)return;remember();const target=$('firmwareTarget').value;
  if(!target){state.firmware=null;for(const k of state.keys)delete k.fw;}else{state.firmware=state.firmware||FW.sanitizeFirmware({target,id:'my_board',displayName:'My Board',controller:target==='qmk'?'promicro_avr':'nice_nano_v2',rows:4,cols:12,layers:[{name:'Base'}]});state.firmware.target=target;if(target==='qmk'&&state.firmware.controller==='nice_nano_v2')state.firmware.controller='promicro_avr';if(target==='zmk'&&['promicro_avr','rp2040'].includes(state.firmware.controller))FW.switchController(state.firmware,'nice_nano_v2');}const imported=FW.populateBaseLayer(state);changed();if(imported.assigned)status(baseLayerNotice(imported));
};
for(const [id,prop] of [['firmwareId','id'],['firmwareDisplayName','displayName'],['firmwareDiode','diode']])$(id).onchange=()=>firmwareChange(f=>f[prop]=$(id).value);
for(const [id,prop] of [['firmwareVid','vid'],['firmwarePid','pid']])$(id).onchange=()=>{const value=$(id).value.trim();firmwareChange(f=>{f.usb={...FW.usbIds(f),[prop]:FW.normalizeUsbId(value)??value};});};
for(const [id,prop,pins] of [['firmwareRows','rows','rowPins'],['firmwareCols','cols','colPins']])$(id).onchange=()=>{const n=Number($(id).value);if(!Number.isInteger(n)||n<1||n>32){syncFirmware();status('行列数必须为 1–32 的整数。',true);return;}firmwareChange(f=>{f[prop]=n;for(const cfg of [f,f.split?.right].filter(Boolean))cfg[pins]=Array.from({length:n},(_,i)=>cfg[pins][i]??null);});};
function applyMatrixSuggestion(f,map){
  for(const m of map)Object.assign(state.keys.find(k=>k.id===m.id).fw,{row:m.row,col:m.col});
  f.rows=Math.max(...map.map(m=>m.row))+1;f.cols=Math.max(...map.map(m=>m.col))+1;
  for(const cfg of [f,...(FW.isSplit(f)?[f.split.right]:[])])for(const [prop,size] of [['rowPins','rows'],['colPins','cols']])cfg[prop]=Array.from({length:f[size]},(_,i)=>cfg[prop]?.[i]??null);
}
$('firmwareController').onchange=()=>firmwareChange(f=>FW.switchController(f,$('firmwareController').value));
$('firmwareTopology').onchange=()=>firmwareChange(f=>FW.enableSplit(f,$('firmwareTopology').value==='split'));
$('firmwareMaster').onchange=()=>firmwareChange(f=>f.split.master=$('firmwareMaster').value);
$('serialMode').onchange=()=>firmwareChange(f=>f.split.serialMode=$('serialMode').value);
$('serialPin').onchange=()=>firmwareChange(f=>f.split.serialPin=$('serialPin').value===''?null:Number($('serialPin').value));
$('serialRxPin').onchange=()=>firmwareChange(f=>f.split.serialRxPin=$('serialRxPin').value===''?null:Number($('serialRxPin').value));
$('pinSide').onchange=()=>{firmwareSide=$('pinSide').value;syncFirmware();};
$('selectedSide').onchange=()=>firmwareChange(()=>{for(const k of state.keys.filter(k=>selected.has(k.id)&&!k.decal)){const side=$('selectedSide').value||null;if(k.fw.side!==side)Object.assign(k.fw,{side,row:null,col:null});}});
$('divideHands').onclick=()=>firmwareChange(()=>{for(const m of FW.suggestSides(state.keys,state.options.mirrorAxis)){const k=state.keys.find(k=>k.id===m.id);if(k.fw.side!==m.side)Object.assign(k.fw,{side:m.side,row:null,col:null});}status('已按中线划分左右手；可选中按键调整所属侧，再建议矩阵。');});
$('suggestMatrix').onclick=()=>{
  const f=state.firmware;if(!f)return;
  if(FW.isSplit(f)&&state.keys.some(k=>!k.decal&&!['left','right'].includes(k.fw?.side))){status('请先按中线划分左右手，或选中按键手动设置所属侧。',true);return;}
  const map=FW.isSplit(f)?FW.suggestSplitMatrix(state.keys):FW.suggestMatrix(state.keys);
  if(!map.length||Math.max(...map.map(m=>m.row),...map.map(m=>m.col))>=32){status('建议矩阵超过 32 行或列，请手动分配。',true);return;}
  firmwareChange(f=>{applyMatrixSuggestion(f,map);status('已建议'+(FW.isSplit(f)?'左右各侧':'')+'矩阵；请按实际接线核对行列并分配引脚。');});
};
$('referenceSplit').onclick=()=>firmwareChange(f=>{
  f.target='qmk';FW.switchController(f,'rp2040');FW.enableSplit(f,true);
  for(const m of FW.suggestSides(state.keys,state.options.mirrorAxis))state.keys.find(k=>k.id===m.id).fw.side=m.side;
  const map=FW.suggestSplitMatrix(state.keys);if(map.length)applyMatrixSuggestion(f,map);
  f.rows=Math.max(4,f.rows);f.cols=Math.max(5,f.cols);f.diode='row2col';f.split.master='left';f.split.serialPin=1;
  delete f.split.serialMode;delete f.split.serialRxPin;
  for(const cfg of [f,f.split.right]){cfg.rowPins=Array.from({length:f.rows},(_,i)=>[4,5,27,26][i]??null);cfg.colPins=Array.from({length:f.cols},(_,i)=>[8,9,7,6,28][i]??null);}
  f.split.pointing={enabled:true,side:'left',model:'TPS43',sda:2,scl:3,rotation:90};firmwareSide='left';
  status('已套用参考接线与左手 TPS43；新增行列的 GPIO 留空。矩阵按当前配列建议，请核对实际接线。');
});
$('azoteqEnabled').onchange=()=>firmwareChange(f=>f.split.pointing.enabled=$('azoteqEnabled').checked);
for(const [id,prop] of [['azoteqSide','side'],['azoteqModel','model'],['azoteqRotation','rotation'],['azoteqSda','sda'],['azoteqScl','scl']])$(id).onchange=()=>firmwareChange(f=>f.split.pointing[prop]=['side','model'].includes(prop)?$(id).value:$(id).value===''?null:Number($(id).value));
for(const [id,prop,size] of [['selectedRow','row','rows'],['selectedCol','col','cols']])$(id).onchange=()=>{const k=state.keys.find(k=>selected.has(k.id)&&!k.decal),raw=$(id).value,n=raw===''?null:Number(raw);if(!k||!state.firmware)return;if(n!==null&&(!Number.isInteger(n)||n<0||n>=state.firmware[size])){firmwareSelection();status('矩阵位置超出当前行列范围。',true);return;}firmwareChange(()=>k.fw[prop]=n);};
$('sequenceMatrix').onclick=()=>{const f=state.firmware;if(!f)return;const ids=[...selected].filter(id=>state.keys.some(k=>k.id===id&&!k.decal)),row=Number($('sequenceRow').value),col=Number($('sequenceCol').value);if(FW.isSplit(f)){const sides=ids.map(id=>state.keys.find(k=>k.id===id).fw.side);if(!sides.length||!['left','right'].includes(sides[0])||sides.some(s=>s!==sides[0])){status('连续编号请只选择同一侧的按键。',true);return;}}if(!ids.length||!Number.isInteger(row)||!Number.isInteger(col)||row<0||row>=f.rows||col<0||col+ids.length>f.cols){status('连续编号超出矩阵范围，请调整行号、起始列或选择数量。',true);return;}firmwareChange(()=>ids.forEach((id,i)=>Object.assign(state.keys.find(k=>k.id===id).fw,{row,col:col+i})));};
$('inferBindings').onclick=()=>firmwareChange(()=>{const imported=FW.populateBaseLayer(state);status(`已补齐 ${imported.assigned} 个按键，${imported.unresolved} 个未能识别；已有和手动动作已保留。`,imported.unresolved>0);});
$('addLayer').onclick=()=>firmwareChange(f=>{if(f.layers.length>=10)return;f.layers.push({name:'Layer '+f.layers.length});firmwareLayer=f.layers.length-1;});
$('deleteLayer').onclick=()=>{const f=state.firmware,index=firmwareLayer;if(!f||index===0)return;const refs=state.keys.filter(k=>!k.decal&&k.fw.bindings.some((a,i)=>i!==index&&['mo','tg','to'].includes(a.t)&&a.l===index));if(refs.length){status(`有 ${refs.length} 个按键引用此层，请先修改层操作。`,true);return;}firmwareChange(()=>{f.layers.splice(index,1);for(const k of state.keys.filter(k=>!k.decal)){k.fw.bindings.splice(index,1);for(const a of k.fw.bindings)if(['mo','tg','to'].includes(a.t)&&a.l>index)a.l--;}firmwareLayer=Math.max(0,index-1);});};
$('layerName').onchange=()=>firmwareChange(f=>f.layers[firmwareLayer].name=$('layerName').value.trim().slice(0,24)||'Layer '+firmwareLayer);
$('bindingType').onchange=bindingVisibility;
function filterKeycodes(){const previous=$('bindingKey').value,query=$('bindingSearch').value.trim().toUpperCase(),list=$('bindingKey');list.replaceChildren();for(const group of [...new Set(FW.keycodes.map(k=>k.group))]){const g=document.createElement('optgroup');g.label=group;for(const code of FW.keycodes.filter(k=>k.group===group&&(!query||[k.id,k.label,...k.aliases].some(s=>s.toUpperCase().includes(query))))){const opt=document.createElement('option');opt.value=code.id;opt.textContent=`${code.label} · ${code.id}`;g.append(opt);}if(g.children.length)list.append(g);}if([...list.options].some(o=>o.value===previous))list.value=previous;}
$('bindingSearch').oninput=filterKeycodes;filterKeycodes();
for(const mod of FW.MODS){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=mod;label.append(input,document.createTextNode(({LCTL:'左 Ctrl',RCTL:'右 Ctrl',LSFT:'左 Shift',RSFT:'右 Shift',LALT:'左 Alt',RALT:'右 Alt',LGUI:'左 GUI',RGUI:'右 GUI'})[mod]));$('bindingModifiers').append(label);}
$('applyBinding').onclick=()=>{const type=$('bindingType').value;let action={t:type};if(type==='kc'){if(!$('bindingKey').value){status('请先选择键码。',true);return;}action={t:'kc',k:$('bindingKey').value,m:[...$('bindingModifiers').querySelectorAll('input:checked')].map(i=>i.value)};}if(['mo','tg','to'].includes(type)){const l=Number($('bindingLayer').value);if(!Number.isInteger(l)||l<0||l>=state.firmware.layers.length){status('目标层不存在。',true);return;}action.l=l;}firmwareChange(()=>{for(const k of state.keys.filter(k=>selected.has(k.id)&&!k.decal)){k.fw.bindings[firmwareLayer]=JSON.parse(JSON.stringify(action));if(firmwareLayer===0)k.fw.baseBindingManual=true;}});};
$('previewFirmware').onclick=()=>{const generated=FW.generate(state);if(generated.errors.length){status(generated.errors[0].msg,true);return;}firmwareFiles=generated.files;$('firmwarePreviewRoot').textContent=generated.root;$('firmwareFileList').replaceChildren();for(const [i,file] of firmwareFiles.entries()){const option=document.createElement('option');option.value=i;option.textContent=file.path;$('firmwareFileList').append(option);}$('firmwareFileList').selectedIndex=0;$('firmwarePreview').textContent=firmwareFiles[0]?.content||'';$('firmwarePreviewDialog').showModal();};
$('firmwareFileList').onchange=()=>$('firmwarePreview').textContent=firmwareFiles[Number($('firmwareFileList').value)]?.content||'';
$('closeFirmwarePreview').onclick=()=>$('firmwarePreviewDialog').close();
$('exportFirmware').onclick=()=>{const generated=FW.generate(state);if(generated.errors.length){status(generated.errors[0].msg,true);return;}if(native)send('saveFolder',{name:generated.root,files:generated.files});else status('请在键盘工坊 App 中导出固件仓库。',true);};
function wiringSvg(){if(!state.firmware){status('请先选择固件目标，再生成矩阵接线图。',true);return null;}try{return FW.wiringDiagram(state);}catch(error){status('接线图生成失败：'+error.message,true);return null;}}
function wiringName(ext){return `${fileName()}-矩阵接线图.${ext}`;}
function showWiringDiagram(svgOverride){const svg=svgOverride||wiringSvg();if(!svg)return false;const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});if(wiringPreviewURL)URL.revokeObjectURL(wiringPreviewURL);wiringPreviewURL=URL.createObjectURL(blob);$('wiringDiagramImage').src=wiringPreviewURL;$('wiringDiagramCaption').textContent='图中按键、R/C 地址、行列 GPIO、二极管方向和分体通信均来自当前固件设置；橙色区域表示仍需按实物核对。';$('wiringDiagramDialog').showModal();return true;}
function exportWiringSVG(){const svg=wiringSvg();if(!svg)return;const name=wiringName('svg');if(native)send('save',{name,content:svg});else save(name,svg);}
function renderWiringPNG(svg){return new Promise((resolve,reject)=>{const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),img=new Image();const fail=error=>{URL.revokeObjectURL(url);reject(error instanceof Error?error:Error('接线图无法转换为 PNG。'));};img.onload=()=>{try{const scale=Math.min(2,4096/Math.max(img.naturalWidth,1),4096/Math.max(img.naturalHeight,1)),canvasOut=document.createElement('canvas');canvasOut.width=Math.max(1,Math.round(img.naturalWidth*scale));canvasOut.height=Math.max(1,Math.round(img.naturalHeight*scale));const context=canvasOut.getContext('2d');if(!context)throw Error('PNG 导出失败。');context.fillStyle='#fff';context.fillRect(0,0,canvasOut.width,canvasOut.height);context.drawImage(img,0,0,canvasOut.width,canvasOut.height);canvasOut.toBlob(file=>{if(!file){fail(Error('PNG 导出失败。'));return;}const reader=new FileReader();reader.onload=()=>{URL.revokeObjectURL(url);resolve({blob:file,dataURL:String(reader.result)});};reader.onerror=()=>fail(Error('PNG 导出失败。'));reader.readAsDataURL(file);},'image/png');}catch(error){fail(error);}};img.onerror=()=>fail(Error('接线图无法转换为 PNG。'));img.src=url;});}
window.WorkshopWiring={preview:showWiringDiagram,renderPNG:renderWiringPNG};
function exportWiringPNG(){const svg=wiringSvg();if(!svg)return;renderWiringPNG(svg).then(({blob,dataURL})=>{const name=wiringName('png');if(native)send('saveImage',{name,data:dataURL.split(',')[1]||''});else{const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);status('已导出 '+name);}}).catch(error=>status(error.message||'PNG 导出失败。',true));}
$('previewWiringDiagramQuick').onclick=()=>showWiringDiagram();$('exportWiringSVG').onclick=exportWiringSVG;$('exportWiringPNG').onclick=exportWiringPNG;$('closeWiringDiagram').onclick=()=>{$('wiringDiagramDialog').close();if(wiringPreviewURL){URL.revokeObjectURL(wiringPreviewURL);wiringPreviewURL=null;}$('wiringDiagramImage').removeAttribute('src');};
function githubReceive(payload){
  const previous=githubState.login,oldSHA=githubState.job?.sha;githubState={connected:false,busy:false,repositories:[],...payload};
  if(previous!==githubState.login)$('githubRepository').value='';
  githubRender();
  if(githubState.job?.sha!==oldSHA&&[...$('githubRepository').options].some(o=>o.value===githubState.job?.repo)){$('githubRepository').value=githubState.job.repo;githubRender();}
}
function githubRender(){
  const g=githubState,job=g.job,locked=!!g.busy;
  const matches=!!job?.snapshotId&&job.snapshotId===window.WorkshopAssistantHost?.snapshotId?.(state);
  $('githubAccount').textContent=g.connected?`已连接 · ${g.login}`:'尚未连接账号';
  $('githubConnect').textContent=g.connected?'重新连接':'连接 GitHub';$('githubConnect').disabled=locked;
  $('githubDisconnect').hidden=!g.connected;$('githubDisconnect').disabled=locked;
  const list=$('githubRepository'),previous=list.value;list.replaceChildren(new Option('新建固件仓库',''));
  for(const repo of g.repositories||[])if(githubPending&&repo.keyboard===githubPending.keyboard&&repo.target===githubPending.target)list.add(new Option(`${g.login}/${repo.name}`,repo.name));
  if([...list.options].some(o=>o.value===previous))list.value=previous;
  const create=!list.value;$('githubNewFields').hidden=!create;
  for(const id of ['githubRepository','githubRepoName','githubPrivate'])$(id).disabled=locked||!g.connected||!githubPending;
  $('githubUploadSummary').textContent=githubPending?`${githubPending.target.toUpperCase()} · ${githubPending.keyboard} · ${githubPending.files.length} 个文件。上传当前配置快照${githubPending.target==='qmk'?'，Actions 将分别编译 VIA 与 Vial 固件':'，包含编译流程和接线说明'}。`:'当前配置有错误，请关闭窗口完成配置后重新打开。仍可查看上次编译结果。';
  const name=create?$('githubRepoName').value.trim():list.value,valid=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name);
  $('githubPublish').disabled=locked||!g.connected||!githubPending||!valid;
  $('githubPublish').textContent=locked?'正在处理…':create?'上传并开始编译':'更新仓库并编译';
  $('githubMessage').textContent=(job&&!matches?'历史构建：':'')+(g.message||'连接 GitHub 后可上传固件并自动编译。');$('githubMessage').classList.toggle('github-error',!!g.error);
  const labels={waiting:'等待任务',queued:'排队中',requested:'排队中',pending:'排队中',waiting_approval:'等待批准',in_progress:'编译中',completed:'已结束'};
  $('githubJobStatus').textContent=job?((job.status==='completed'?(job.conclusion==='success'?'编译成功':job.conclusion==='cancelled'?'已取消':'编译未成功'):(labels[job.status]||'等待 GitHub'))+(matches?'':' · 历史快照')):'尚未提交';
  $('githubJobInfo').textContent=job?`${job.owner}/${job.repo} · 提交 ${job.sha.slice(0,7)} · ${new Date(job.startedAt*1000).toLocaleString('zh-CN')} · ${matches?'与当前工程快照一致':job.snapshotId?'当前工程已变化，请重新编译':'未记录工程快照，不能确认当前工程'}`:'';
  for(const id of ['githubRefresh','githubOpenRun'])$(id).disabled=locked||!g.connected||!job;
  $('githubDownload').disabled=locked||!g.connected||job?.status!=='completed'||job?.conclusion!=='success'||!job?.artifactID;
  $('githubBrief').textContent=job?`${job.repo} · ${$('githubJobStatus').textContent}。点击上方入口查看或下载。`:'连接账号后上传配置，自动编译并下载固件。';
}
$('uploadGitHub').onclick=()=>{
  if(!native){status('请在键盘工坊 App 中连接 GitHub 并编译。',true);return;}
  const generated=FW.generate(state);githubPending=generated.errors.length?null:{keyboard:state.firmware.id,target:state.firmware.target,files:generated.files.map(f=>({...f})),snapshotId:window.WorkshopAssistantHost.snapshotId(state),projectName:state.name,generatorVersion:'1.6/33'};
  $('githubRepoName').value=generated.root||'';$('githubPrivate').checked=true;$('githubRepository').value='';
  githubRender();$('githubDialog').showModal();send('githubState');
};
$('closeGitHub').onclick=()=>$('githubDialog').close();
$('githubRepository').onchange=githubRender;$('githubRepoName').oninput=githubRender;
for(const action of ['Connect','Disconnect','Refresh','Download','OpenRun'])$('github'+action).onclick=()=>{if(githubState.busy)return;send('github'+action);};
$('githubPublish').onclick=()=>{
  if($('githubPublish').disabled||!githubPending)return;
  const repo=$('githubRepository').value||$('githubRepoName').value.trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(repo)){status('仓库名称仅支持英文字母、数字、短横线和下划线。',true);return;}
  githubState.busy=true;githubState.message='正在准备上传…';githubState.error=false;githubRender();
  send('githubPublish',{...githubPending,repo,create:!$('githubRepository').value,private:$('githubPrivate').checked});
};
function snapshotProject(project){return JSON.parse(JSON.stringify(project));}
document.body.dataset.view=view;canvasHint();sync();
function assistantFit(points){
  if(!points.length)return;const rect=canvas.getBoundingClientRect(),drawer=$('assistantDrawer');
  const w=drawer&&!drawer.hidden?Math.min(rect.width,Math.max(100,drawer.getBoundingClientRect().left-rect.left-20)):rect.width,h=rect.height,b=KB.bounds(points);
  camera.scale=Math.max(.01,Math.min(90,(w-50)/Math.max(1,b.w),(h-80)/Math.max(1,b.h)));
  camera.x=w/2-(b.x+b.w/2)*camera.scale;camera.y=h/2-(b.y+b.h/2)*camera.scale;draw();
}
function assistantPreviewPoints(proposal){
  if(proposal.view==='plate'){
    const points=[];for(const p of [state,proposal.next])try{points.push(...KB.plate(p.keys,p.options,p.features).parts.flatMap(p=>p.outlines.flat()).map(v=>({x:v.x/state.options.pitch,y:v.y/pitchY()})));}catch(_){}
    return points;
  }
  return [state,proposal.next].flatMap(p=>p.keys.filter(k=>proposal.keyIds.includes(k.id)).flatMap(k=>KB.keyShape(k)));
}
function drawAssistantPreview(){
  if(!assistantPreview)return;const proposal=assistantPreview;
  ctx.save();ctx.lineWidth=2/camera.scale;
  if(view==='plate'&&proposal.view==='plate'){
    const u=pts=>pts.map(v=>({x:v.x/state.options.pitch,y:v.y/pitchY()}));
    for(const [project,color,dashed] of [[state,'#a16d49',true],[proposal.next,palette.accent,false]])try{
      const result=KB.plate(project.keys,project.options,project.features),part=result.parts.find(p=>p.id===plateLayer)||result.parts[0];
      ctx.strokeStyle=color;ctx.setLineDash(dashed?[5/camera.scale,4/camera.scale]:[]);
      for(const points of [...part.outlines,...part.holes.map(h=>h.points)]){path(u(points));ctx.stroke();}
      for(const c of part.circles){ctx.beginPath();ctx.ellipse(c.x/state.options.pitch,c.y/pitchY(),c.r/state.options.pitch,c.r/pitchY(),0,0,2*Math.PI);ctx.stroke();}
    }catch(_){}
  }else if(view==='layout'){
    for(const id of proposal.keyIds){const before=state.keys.find(k=>k.id===id),after=proposal.next.keys.find(k=>k.id===id);
      if(before){ctx.strokeStyle='#a16d49';ctx.setLineDash([5/camera.scale,4/camera.scale]);path(KB.keyShape(before));ctx.stroke();}
      if(after){ctx.strokeStyle=palette.accent;ctx.setLineDash([]);path(KB.keyShape(after));ctx.fillStyle='#41705818';ctx.fill();ctx.stroke();}
      if(before&&after&&(before.x!==after.x||before.y!==after.y)){
        ctx.setLineDash([]);ctx.strokeStyle=palette.accent;ctx.beginPath();ctx.moveTo(before.x,before.y);ctx.lineTo(after.x,after.y);ctx.stroke();
        const a=Math.atan2(after.y-before.y,after.x-before.x),l=7/camera.scale;ctx.beginPath();ctx.moveTo(after.x-l*Math.cos(a-.45),after.y-l*Math.sin(a-.45));ctx.lineTo(after.x,after.y);ctx.lineTo(after.x-l*Math.cos(a+.45),after.y-l*Math.sin(a+.45));ctx.stroke();
      }
    }
  }
  ctx.restore();
}
function assistantRequire(stamp,base){
  if(pointer||busy)throw Error('正在编辑或识别，请结束后重新生成提案。');
  if(stamp.session!==assistantSession||stamp.revision!==assistantRevision||AssistantCore.fingerprint(snapshot())!==base)throw Error('工程已变化，提案失效，请重新生成。');
}
window.WorkshopAssistantHost={
  context:()=>({project:snapshot(),stamp:{session:assistantSession,revision:assistantRevision},selected:[...selected],layer:firmwareLayer,view,editing:!!pointer||busy}),
  highlight:(ids,targetView)=>{assistantHighlights=new Set(ids.filter(id=>state.keys.some(k=>k.id===id&&!k.decal)));if(targetView)setView(targetView);else if(view==='data')setView('layout');
    const pts=state.keys.filter(k=>assistantHighlights.has(k.id)).flatMap(k=>KB.keyShape(k));if(pts.length)assistantFit(pts);else draw();},
  preview:proposal=>{assistantPreview=proposal;if(proposal){setView(proposal.view||'firmware');assistantHighlights=new Set(proposal.keyIds);assistantFit(assistantPreviewPoints(proposal));$('canvasHint').textContent='助手预览 · 棕色虚线为当前，绿色实线为提案 · 尚未应用';}else{canvasHint();draw();}},
  navigate:args=>{
    AssistantCore.object(args,['view','focus','layer','part','show_grid','show_reference','reference_opacity']);if(pointer||busy)throw Error('请先结束当前编辑或识别。');
    if(args.view!==undefined)WorkshopCommands.choice(args.view,['layout','plate','firmware','data']);
    if(args.focus!==undefined)WorkshopCommands.choice(args.focus,['fit','selected','checks']);
    if(args.layer!==undefined)AssistantCore.integer(args.layer,0,(state.firmware?.layers?.length||0)-1);
    if(args.part!==undefined){WorkshopCommands.choice(args.part,['plate','frame','bottom']);if(!lastPlate?.parts.some(p=>p.id===args.part))throw Error('当前工程没有该板层。');}
    for(const field of ['show_grid','show_reference'])if(args[field]!==undefined&&typeof args[field]!=='boolean')throw Error('显示选项须为布尔值。');
    if(args.reference_opacity!==undefined)WorkshopCommands.number(args.reference_opacity,0,1);
    if(args.layer!==undefined)firmwareLayer=args.layer;if(args.part!==undefined){plateLayer=args.part;syncParts();}
    if(args.show_grid!==undefined)$('showGrid').checked=args.show_grid;if(args.show_reference!==undefined)$('showReference').checked=args.show_reference;
    if(args.reference_opacity!==undefined)$('imageOpacity').value=args.reference_opacity;
    setView(args.view||view);
    if(args.focus==='fit')assistantFit(state.keys.flatMap(k=>KB.keyShape(k)).concat(view==='plate'&&lastPlate?lastPlate.outlines.flat().map(v=>({x:v.x/state.options.pitch,y:v.y/pitchY()})):[]));
    if(args.focus==='selected')assistantFit(state.keys.filter(k=>assistantHighlights.has(k.id)||selected.has(k.id)).flatMap(k=>KB.keyShape(k)));
    if(args.focus==='checks'){const panel=$(view==='firmware'?'firmwareChecks':'checks');if(panel){let parent=panel.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}panel.scrollIntoView({block:'center'});}}
    draw();return {view,layer:firmwareLayer,part:plateLayer,show_grid:$('showGrid').checked,show_reference:$('showReference').checked,reference_opacity:Number($('imageOpacity').value),notice:'仅更新视图，工程未修改。'};
  },
  locate:field=>{if(!AssistantCore.settingFields.includes(field))return;setView('firmware');const el=$(field);if(el){let parent=el.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}el.scrollIntoView({block:'center',behavior:'smooth'});el.focus();el.classList.add('assistant-located');setTimeout(()=>el.classList.remove('assistant-located'),1800);}},
  commit:(stamp,base,next,targetView='firmware',preserveOriginal=false)=>{
    assistantRequire(stamp,base);WorkshopCommands.choice(targetView,['layout','plate','firmware']);
    const before=snapshot(),draft=snapshotProject(next);KB.checkKeys(draft.keys);
    const firmware=JSON.stringify(before.firmware)!==JSON.stringify(draft.firmware)||draft.keys.some(k=>{const old=before.keys.find(v=>v.id===k.id);return old&&JSON.stringify(old.fw)!==JSON.stringify(k.fw);});
    const check=WorkshopCommands.validation(before,draft,{firmware});if(check.blockingErrors.length)throw Error('提案存在新增错误，不能应用：'+check.blockingErrors[0].msg);
    if(AssistantCore.fingerprint(before)===AssistantCore.fingerprint(draft))throw Error('没有可应用的变化。');
    if(preserveOriginal)archiveCurrentLayout();
    remember();const undoSnapshot=undoStack.at(-1);state=draft;if(preserveOriginal)archiveCurrentLayout({forceNew:true});selected=new Set([...selected].filter(id=>state.keys.some(k=>k.id===id)));if(!state.features.some(f=>f.id===featureID))featureID=null;
    loadReference();changed();setView(targetView);status('已应用助手提案，可用一次撤销还原。');
    const transactionId=KB.uid();assistantTransactions.set(transactionId,{before,after:snapshot(),session:assistantSession,undoSnapshot});if(assistantTransactions.size>35)assistantTransactions.delete(assistantTransactions.keys().next().value);
    return {stamp:{session:assistantSession,revision:assistantRevision},checks:WorkshopCommands.issues(snapshot()),transactionId};
  },
  undo:transactionId=>{
    if(pointer||busy)throw Error('请先结束当前编辑或识别。');
    if(!transactionId){undo();return;}
    const record=assistantTransactions.get(transactionId);if(!record||record.session!==assistantSession)throw Error('事务已过期或已撤销，不能再次撤销。');
    const current=snapshot();
    if(undoStack.at(-1)===record.undoSnapshot&&AssistantCore.fingerprint(current)===AssistantCore.fingerprint(record.after)){undo();return;}
    const next=WorkshopCommands.reverse(record.before,record.after,current);remember();state=next;loadReference();selected.clear();featureID=null;assistantTransactions.delete(transactionId);changed();status('已撤销助手修改，保留后续不冲突的编辑。');
  }
};
if(native)send('ready');else{try{const saved=localStorage.getItem('keyboard-workshop-v1');if(saved){const parsed=JSON.parse(saved);if(parsed?.project&&parsed.project.version===1){activeLayoutId=parsed.activeLayoutId||null;loadLayouts(parsed.layouts||[]);loadText(JSON.stringify(parsed.project),undefined,{archive:false,layoutId:activeLayoutId,statusMessage:false});}else{loadText(saved,undefined,{archive:false,layoutId:null,statusMessage:false});}undoStack.length=0;redoStack.length=0;sync();}}catch(e){status('上次保存的工程无法读取，请导入工程文件。',true);}}
