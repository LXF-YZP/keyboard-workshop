(function(){
  'use strict';
  const E=window.KiCadExport,dialog=$('kicadDialog');
  let prepared=null,source=null,stamp=null,exporting=false;
  const config=()=>({module:$('kicadModule').value,switch:$('kicadSwitch').value,diode:$('kicadDiode').value,mounts:$('kicadMounts').checked});
  function notice(text){$('kicadStatus').textContent=text;}
  function clear(){prepared=null;$('exportKiCad').disabled=true;$('kicadPreview').replaceChildren();}
  function renderPreview(models){
    const host=$('kicadPreview');host.replaceChildren();
    for(const m of models){
      const section=document.createElement('section'),title=document.createElement('h3'),canvasOut=document.createElement('canvas');
      title.textContent=(m.side==='single'?'单体':m.side==='left'?'左手':'右手')+' · '+m.mapping.length+' 个开关 · 未布线';
      canvasOut.width=1000;canvasOut.height=500;canvasOut.setAttribute('aria-label',title.textContent);section.append(title,canvasOut);host.append(section);
      const ctx=canvasOut.getContext('2d'),g=m.geometry,scale=Math.min(900/(g.bounds.w+95),410/Math.max(g.bounds.h+25,75));
      ctx.fillStyle='#f7f8f6';ctx.fillRect(0,0,1000,500);ctx.translate(25,25);ctx.scale(scale,scale);ctx.translate(-20,-20);
      ctx.lineWidth=.4;ctx.strokeStyle='#417058';ctx.beginPath();g.outline.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x+g.offset.x,p.y+g.offset.y));ctx.closePath();ctx.stroke();
      for(const h of g.mounts){ctx.beginPath();ctx.arc(h.x+g.offset.x,h.y+g.offset.y,h.r,0,Math.PI*2);ctx.stroke();}
      for(const c of m.components){
        ctx.save();ctx.translate(c.pcb.x,c.pcb.y);ctx.rotate(c.pcb.angle*Math.PI/180);ctx.strokeStyle=c.lib==='MX'?'#4777a8':'#986e42';
        if(c.lib==='MX'){ctx.strokeRect(-7,-7,14,14);ctx.font='2.5px sans-serif';ctx.textAlign='center';ctx.fillStyle='#29333a';ctx.fillText(c.ref,0,-2);ctx.fillText(c.value.slice(0,10),0,2);}
        else if(c.lib==='Pico'){ctx.strokeRect(-1.5,-1.3,21,51);ctx.font='3px sans-serif';ctx.fillText('U1 Pico',1,20);}
        else if(c.lib==='Header4')ctx.strokeRect(-1.3,-1.3,2.6,10.2);
        else ctx.strokeRect(c.lib==='DO35'?-3.81:-2,-1,c.lib==='DO35'?7.62:4,2);
        ctx.restore();
      }
    }
  }
  function prepare(){
    clear();if(exporting)return;
    source=WorkshopAssistantHost.context().project;stamp=WorkshopAssistantHost.context().stamp;
    const result=E.generate(source,config()),host=$('kicadChecks');host.replaceChildren();
    for(const [list,tone] of [[result.errors,'error'],[result.warnings,'warning']])for(const text of list){const p=document.createElement('p');p.className=tone;p.textContent=text;host.append(p);}
    if(result.errors.length){notice('请先修正上述 '+result.errors.length+' 项问题，再生成。');return;}
    prepared=result;renderPreview(result.models);$('exportKiCad').disabled=!native;
    notice(native?`${result.keyCount} 个开关 + ${result.keyCount} 个二极管，${result.boardCount} 份工程；包含原理图、PCB、元件库、BOM 和引脚对照表。`:'预览已生成；请在键盘工坊 App 中导出整个工程目录。');
  }
  function open(){
    if(busy||pointer)throw Error('请先结束编辑或识别。');
    const current=E.options(state.eda||{});$('kicadModule').value=current.module;$('kicadSwitch').value=current.switch;$('kicadDiode').value=current.diode;$('kicadMounts').checked=current.mounts;
    if(!dialog.open)dialog.showModal();prepare();return {status:'waiting_input',message:'已打开 KiCad 生成窗口，请核对元件和预览，再点击“导出 KiCad 工程”。'};
  }
  for(const id of ['kicadModule','kicadSwitch','kicadDiode','kicadMounts'])$(id).onchange=()=>{clear();notice('元件选项已变化，请重新检查并预览。');};
  $('openKiCad').onclick=()=>{try{open();}catch(e){status(e.message,true);}};
  $('closeKiCad').onclick=()=>{if(!exporting)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(exporting)event.preventDefault();});
  $('previewKiCad').onclick=prepare;
  $('exportKiCad').onclick=async()=>{
    if(!prepared||exporting)return;
    try{
      assistantRequire(stamp,AssistantCore.fingerprint(source));exporting=true;$('exportKiCad').disabled=true;$('previewKiCad').disabled=true;$('closeKiCad').disabled=true;
      notice('请在系统窗口中选择父目录…');
      const result=await WorkshopAssistantHost.exportKiCad(prepared);
      if(result.status==='complete'){
        // Store only the user's selected export settings after a successful save.
        if(AssistantCore.fingerprint(snapshot())===AssistantCore.fingerprint(source)){
          const selectedConfig=config();if(JSON.stringify(state.eda)!==JSON.stringify(selectedConfig)){remember();state.eda=selectedConfig;changed();}
        }
        notice(result.message||'KiCad 工程已导出。');
      }else notice('已取消，未导出工程。');
    }catch(e){notice(e.message);}
    finally{exporting=false;$('previewKiCad').disabled=false;$('closeKiCad').disabled=false;clear();}
  };
  window.addEventListener('workshop:changed',()=>{if(dialog.open&&!exporting){clear();notice('工程已变化，请重新检查并预览。');}});
  window.WorkshopKiCad={open};
})();
