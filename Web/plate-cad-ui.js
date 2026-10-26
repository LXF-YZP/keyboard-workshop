/* CAD editing shares the project's undo, autosave and validation pipeline. */
(function(){
  'use strict';
  const C=PlateCAD;let chosen=new Set(),drawing=false,startPoint=null,hover=null,pending=null,prepared=null,initialized=false;
  const draft=()=>state.options.cadDraft;
  const active=()=>view==='plate'&&plateLayer==='plate'&&!!draft();
  const picked=()=>draft()?.entities.filter(e=>chosen.has(e.id))||[];
  function message(text,error=false){$('cadMessage').textContent=text;$('cadMessage').dataset.error=String(error);status(text,error);}
  function run(f){try{f();}catch(e){message(e.message,true);}}
  function numeric(id){const el=$(id);if(!el.value.trim()||!Number.isFinite(el.valueAsNumber))throw Error('请填写有效的毫米数值。');return el.valueAsNumber;}
  function cancelDraw(){drawing=false;startPoint=null;hover=null;$('cadDraw').classList.remove('active');}
  function sync(){
    const d=draft();if(!initialized){$('cadPanel').open=!!d;initialized=true;}chosen=new Set([...chosen].filter(id=>d?.entities.some(e=>e.id===id)));const list=picked(),one=list.length===1?list[0]:null,line=one&&!one.bulge,two=list.length===2&&list.every(e=>!e.bulge);
    $('cadTools').hidden=!d||plateLayer!=='plate';$('cadStart').disabled=!!d||!lastPlate?.design?.outlines.length||busy;$('cadImport').disabled=!state.keys.length||busy;
    $('cadEmptyDraft').hidden=!d||d.entities.length>0;$('cadRecoverEmpty').disabled=!d||d.entities.length>0||busy;$('contourPreset').disabled=!!d||busy;
    $('cadSummary').textContent=d?'草稿 · 未应用':state.options.outline==='custom'?'自定义':'毫米';
    $('cadIntro').hidden=!!d&&plateLayer==='plate';$('cadIntro').textContent=d&&plateLayer!=='plate'?'请切回画布上方的“定位板”图层继续编辑边框。':'按毫米编辑直线与圆弧。支持多片板框；导入可替换板框或整张定位板图形。';$('cadSelection').textContent=one?`${one.bulge?'圆弧':'直线'} · ${Math.hypot(one.b.x-one.a.x,one.b.y-one.a.y).toFixed(3)} mm${one.bulge?' 弦长':''}`:`已选 ${list.length} 条 / 共 ${d?.entities.length||0} 条 · Shift 多选`;
    for(const id of ['cadOffset','cadExtend','cadCoordinates'])$(id).disabled=!line;
    for(const id of ['cadJoin','cadFillet'])$(id).disabled=!two;
    $('cadDelete').disabled=!list.length;$('cadApply').disabled=!d?.entities.length;
    for(const [id,end,axis]of [['cadAX','a','x'],['cadAY','a','y'],['cadBX','b','x'],['cadBY','b','y']]){$(id).disabled=!line;if(document.activeElement!==$(id))$(id).value=one?KB.round(one[end][axis]):'';}
    $('cadDraw').classList.toggle('active',drawing);
    $('margin').disabled=state.options.outline==='custom'||!!d;$('outlineRadius').disabled=state.options.outline==='custom'||!!d;
    if(active())$('canvasHint').textContent=drawing?'画直线 · 点击两个端点 · 吸附已有端点 · Shift 正交 · Esc 结束':'CAD 草稿 · 点击选线 · Shift 多选 · 空白处拖动平移 · Delete 删除 · ⌘Z 撤销';
  }
  function start(){run(()=>{if(draft())return;if(!lastPlate?.design?.outlines.length)throw Error('请先生成定位板。');const entities=lastPlate.design.outlines.flatMap(p=>C.fromPath(p));C.entities(entities);remember();state.options.cadDraft={entities};chosen.clear();plateLayer='plate';$('cadPanel').open=true;setView('plate');changed();message('已进入 CAD 编辑。点击边线选择；复制偏移后可删除原线，再连接端点。');});}
  function mutate(next,selection,text){C.entities(next);remember();state.options.cadDraft={entities:next};chosen=new Set(selection);changed();message(text);}
  function oneLine(){const list=picked();if(list.length!==1||list[0].bulge)throw Error('请先选中一条直线。');return list[0];}
  function remove(){run(()=>{if(!picked().length)return;mutate(draft().entities.filter(e=>!chosen.has(e.id)),[],'已删除选中线段，可用 ⌘Z 撤销。');});}
  function join(radius){run(()=>{const list=picked();if(list.length!==2)throw Error('请按住 Shift 选中两条直线。');const result=C.corner(list[0],list[1],radius),ids=new Set(list.map(e=>e.id));mutate([...draft().entities.filter(e=>!ids.has(e.id)),...result],result.map(e=>e.id),radius?`已连接 R ${radius} mm 圆角。`:'已将两条线修剪 / 延长至交点。');});}
  function apply(){run(()=>{const paths=C.assemble(draft().entities),geometry=C.classify(paths);if(geometry.holes.length)throw Error('边框草稿中存在嵌套闭环。请删除多余原框；开孔请使用 DXF 完整替换或模块开孔功能。');const old=state.options.cadGeometry,g=C.normalizeGeometry({...geometry,holes:state.options.outline==='custom'?old?.holes||[]:[],replaceHoles:state.options.outline==='custom'&&old?.replaceHoles,source:'CAD 手动编辑'});remember();state.options.cadGeometry=g;state.options.outline='custom';delete state.options.cadDraft;chosen.clear();cancelDraw();changed();canvasHint();message(lastPlate?.errors.length?'边框已应用，请查看几何检查并修正开孔位置。':'闭合边框已应用，预览与 DXF / SVG 导出同步更新。',!!lastPlate?.errors.length);});}
  function discard(){if(!draft())return;remember();delete state.options.cadDraft;chosen.clear();cancelDraw();changed();canvasHint();message('已放弃草稿，恢复已应用的边框。此操作也可撤销。');}
  function mm(p){return {x:p.x*state.options.pitch,y:p.y*pitchY()};}
  function snap(p,e){let q={...p};if(startPoint&&e.shiftKey){if(Math.abs(q.x-startPoint.x)>Math.abs(q.y-startPoint.y))q.y=startPoint.y;else q.x=startPoint.x;}const tolerance=8/camera.scale*Math.min(state.options.pitch,pitchY());const nearest=draft().entities.flatMap(l=>[l.a,l.b]).filter(v=>!e.shiftKey||!startPoint||Math.abs(v.x-q.x)<.001||Math.abs(v.y-q.y)<.001).sort((a,b)=>Math.hypot(a.x-q.x,a.y-q.y)-Math.hypot(b.x-q.x,b.y-q.y))[0];return nearest&&Math.hypot(nearest.x-q.x,nearest.y-q.y)<tolerance?{...nearest}:{x:KB.round(q.x),y:KB.round(q.y)};}
  function pointerDown(e,p){if(!active()||e.button!==0)return false;p=mm(p);if(drawing){run(()=>{const q=snap(p,e);if(!startPoint){startPoint=q;hover=q;draw();return;}const line=C.entity({a:startPoint,b:q});mutate([...draft().entities,line],[line.id],'已添加直线；继续点击下一端点，Esc 结束。');startPoint=q;hover=q;draw();});return true;}
    const hit=draft().entities.map(l=>({l,d:C.distance(p,l)})).filter(v=>v.d<=7/camera.scale*Math.min(state.options.pitch,pitchY())).sort((a,b)=>a.d-b.d)[0]?.l;
    if(!hit){if(!e.shiftKey)chosen.clear();sync();draw();return false;}
    if(e.shiftKey){chosen.has(hit.id)?chosen.delete(hit.id):chosen.add(hit.id);}else chosen=new Set([hit.id]);sync();draw();return true;
  }
  function pointerMove(e,p){if(!active()||!drawing||!startPoint)return false;hover=snap(mm(p),e);draw();return true;}
  function drawCAD(ctx){if(!active())return;const px=state.options.pitch,py=pitchY(),scale=camera.scale;ctx.save();ctx.lineWidth=1.8/scale;
    const trace=(e,color,width)=>{const pts=C.sample(e);ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x/px,p.y/py):ctx.moveTo(p.x/px,p.y/py));ctx.strokeStyle=color;ctx.lineWidth=width/scale;ctx.stroke();};
    for(const e of draft().entities)trace(e,chosen.has(e.id)?'#e17328':'#176c87',chosen.has(e.id)?3.5:1.8);
    const list=picked();for(const e of list)for(const [name,p]of [['A',e.a],['B',e.b]]){ctx.beginPath();ctx.arc(p.x/px,p.y/py,4/scale,0,Math.PI*2);ctx.fillStyle='#fff9ed';ctx.fill();ctx.strokeStyle='#c95c17';ctx.lineWidth=1/scale;ctx.stroke();if(list.length===1){ctx.save();ctx.translate(p.x/px,p.y/py);ctx.scale(1/scale,1/scale);ctx.font='bold 12px Menlo';ctx.fillStyle='#a54a10';ctx.fillText(name,7,-7);ctx.restore();}}
    if(startPoint&&hover){ctx.setLineDash([5/scale,3/scale]);trace({a:startPoint,b:hover,bulge:0},'#e17328',2);ctx.setLineDash([]);}ctx.restore();
  }
  function receiveDXF(payload){pending={text:payload.text,name:payload.name||'导入的 DXF',revision:assistantRevision};$('cadUnits').value='auto';$('cadImportMode').value='all';$('cadAlignment').value='original';$('cadImportName').textContent=pending.name;$('cadImportDialog').showModal();previewImport();}
  function previewImport(){prepared=null;$('cadImportApply').disabled=true;const preview=$('cadImportPreview'),c=preview.getContext('2d');c.clearRect(0,0,preview.width,preview.height);
    try{const parsed=C.parseDXF(pending.text,{units:$('cadUnits').value}),geometry=C.classify(C.assemble(parsed.entities));let g=C.normalizeGeometry({...geometry,replaceHoles:$('cadImportMode').value==='all',source:pending.name});
      const b=KB.bounds(g.outlines.flatMap(C.flatten));if($('cadAlignment').value==='center'){const target=lastPlate?.bounds||b,dx=target.x+target.w/2-b.x-b.w/2,dy=target.y+target.h/2-b.y-b.h/2;const move=p=>p.map(v=>({...v,x:v.x+dx,y:v.y+dy}));g.outlines=g.outlines.map(move);g.holes=g.holes.map(h=>({...h,path:move(h.path)}));}
      if(!g.replaceHoles)g.holes=state.options.outline==='custom'&&state.options.cadGeometry?.replaceHoles?C.copy(state.options.cadGeometry.holes):[];
      if(!g.replaceHoles&&state.options.outline==='custom'&&state.options.cadGeometry?.replaceHoles)g.replaceHoles=true;
      prepared=g;const box=KB.bounds(g.outlines.flatMap(C.flatten)),scale=Math.min((preview.width-32)/Math.max(1,box.w),(preview.height-32)/Math.max(1,box.h));c.save();c.translate((preview.width-box.w*scale)/2-box.x*scale,(preview.height-box.h*scale)/2-box.y*scale);c.scale(scale,scale);c.lineWidth=1.5/scale;
      const plot=(p,color)=>{c.beginPath();C.flatten(p).forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));c.closePath();c.strokeStyle=color;c.stroke();};g.outlines.forEach(p=>plot(p,'#32634b'));if($('cadImportMode').value==='all')g.holes.forEach(h=>plot(h.path,'#777870'));else if(lastPlate){lastPlate.polygons.forEach(h=>plot(h.path,'#a5aaa0'));for(const circle of lastPlate.circles){c.beginPath();c.arc(circle.x,circle.y,circle.r,0,2*Math.PI);c.stroke();}}c.restore();
      const ignored=parsed.ignored.length?` 已忽略注释/辅助实体：${parsed.ignored.join('、')}。`:'';$('cadImportReport').textContent=`${geometry.outlines.length} 个板框，${geometry.holes.length} 个文件开孔；${b.w.toFixed(3)} × ${b.h.toFixed(3)} mm。${$('cadImportMode').value==='outline'?'仅取外层闭环作为板框。':''}${ignored}`;$('cadImportReport').dataset.error='false';$('cadImportApply').disabled=false;
    }catch(e){$('cadImportReport').textContent=e.message;$('cadImportReport').dataset.error='true';}
  }
  $('cadStart').onclick=start;$('cadDelete').onclick=remove;$('cadApply').onclick=apply;$('cadDiscard').onclick=discard;$('cadRecoverEmpty').onclick=()=>{if(draft()?.entities.length){message('草稿仍有线段；请使用“放弃草稿”确认恢复原边框。',true);return;}discard();};
  $('cadDraw').onclick=()=>{drawing=!drawing;startPoint=null;hover=null;plateLayer='plate';syncParts();sync();draw();};
  $('cadOffset').onclick=()=>run(()=>{const e=C.offset(oneLine(),numeric('cadOffsetDistance'));mutate([...draft().entities,e],[e.id],'已复制偏移；原线保留。可继续延长，并删除不需要的原线。');});
  $('cadExtend').onclick=()=>run(()=>{const e=C.extend(oneLine(),numeric('cadExtendDistance'),$('cadEnd').value);mutate(draft().entities.map(v=>v.id===e.id?e:v),[e.id],'已按毫米延长选中直线。');});
  $('cadJoin').onclick=()=>join(0);$('cadFillet').onclick=()=>run(()=>join(numeric('cadRadius')));
  $('cadCoordinates').onclick=()=>run(()=>{const old=oneLine(),e=C.entity({...old,a:{x:numeric('cadAX'),y:numeric('cadAY')},b:{x:numeric('cadBX'),y:numeric('cadBY')}});mutate(draft().entities.map(v=>v.id===e.id?e:v),[e.id],'已更新直线端点；相邻线可用“两线接角”重新连接。');});
  $('cadImport').onclick=()=>native?send('openDXF'):$('cadFile').click();
  $('cadFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error('DXF 文件不能超过 10 MB。');receiveDXF({text:await file.text(),name:file.name});}catch(e){message(e.message,true);}finally{e.target.value='';}};
  $('cadImportClose').onclick=()=>$('cadImportDialog').close();
  for(const id of ['cadUnits','cadImportMode','cadAlignment'])$(id).onchange=previewImport;
  $('cadImportApply').onclick=()=>run(()=>{if(!prepared)throw Error('请先修正 DXF 导入错误。');if(pending.revision!==assistantRevision)throw Error('当前工程已变化，请关闭窗口重新导入。');const g=C.normalizeGeometry(prepared);remember();state.options.cadGeometry=g;state.options.outline='custom';delete state.options.cadDraft;chosen.clear();cancelDraw();$('cadImportDialog').close();plateLayer='plate';changed();setView('plate');fit();message(`已用 ${pending.name} 替换定位板${$('cadImportMode').value==='all'?'图形':'板框'}，可用 ⌘Z 撤销。${lastPlate?.errors.length?'请查看几何检查。':''}`);pending=null;prepared=null;});
  window.WorkshopCAD={sync,start,cancelDraw,pointerDown,pointerMove,draw:drawCAD,receiveDXF,keydown(e){if(!active())return false;if(e.key==='Escape'){cancelDraw();chosen.clear();sync();draw();return true;}if(['Delete','Backspace'].includes(e.key)&&chosen.size){e.preventDefault();remove();return true;}return false;}};
  sync();
})();
