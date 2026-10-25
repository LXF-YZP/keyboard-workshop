(function(){
  'use strict';
  const H=window.WorkshopAssistantHost,C=window.AssistantCore,W=window.WorkshopCommands,F=window.WorkshopFlows;
  const requests=new Map();let serial=0;
  // Only this host constructs native payloads. The model receives no path, token,
  // arbitrary native-action or raw-project write capability.
  function request(kind,payload={}){
    if(!native)return Promise.reject(Error('此流程需要在键盘工坊 App 中使用系统窗口。'));
    return new Promise((resolve,reject)=>{
      const requestId='workflow-'+Date.now()+'-'+(++serial);
      const cancelAction=kind==='github'?'assistantGitHubCancel':'assistantWorkflowCancel';
      const timer=setTimeout(()=>{requests.delete(requestId);send(cancelAction,{requestId});reject(Error(kind==='github'?'等待 GitHub 超时，已请求停止后续操作；请刷新核对远端结果。':'等待操作超时，已取消；不会自动重开窗口。'));},300000);
      requests.set(requestId,{resolve,reject,timer,cancelAction,readOnly:kind==='github'&&['status','refresh','logs'].includes(payload.operation)});
      send(kind==='github'?'assistantGitHub':'assistantWorkflow',{requestId,kind,...payload});
    });
  }
  H.cancelWorkflowReads=()=>{for(const [requestId,p] of requests)if(p.readOnly){requests.delete(requestId);clearTimeout(p.timer);send(p.cancelAction,{requestId});p.reject(Error('已停止读取 GitHub。'));}};
  window.addEventListener('workshop:assistant',({detail:{event,payload}})=>{
    if(event!=='assistantWorkflowResult')return;
    const p=requests.get(payload.requestId);if(!p)return;
    requests.delete(payload.requestId);clearTimeout(p.timer);
    if(payload.error)p.reject(Error(C.redact(payload.error)));else p.resolve(payload);
  });
  function requireContext(ctx){assistantRequire(ctx.stamp,ctx.base||C.fingerprint(ctx.project));}
  function draft(before,next,title,notes=[]){
    F.cleanGroups(next);
    const changes=[...W.diff(before,next),...F.firmwareDiff(before,next),...F.groupsDiff(before,next)];
    for(const field of ['name','image','roi'])if(JSON.stringify(before[field])!==JSON.stringify(next[field]))changes.push({kind:'project',field:field==='image'?'参考截图':field==='roi'?'识别区域':'工程名称',before:field==='image'?before.image?.name||'无':JSON.stringify(before[field]),after:field==='image'?next.image?.name||'无':JSON.stringify(next[field])});
    if(!changes.length)throw Error('没有可应用的变化。');
    return {title,view:'layout',next,changes,notes,checks:W.validation(before,next),keyIds:next.keys.map(k=>k.id)};
  }
  function snapshotId(p){
    // Content identity, not a security hash. Native GitHub additionally hashes
    // the actual generated files and binds publication to the prepared head.
    const text=C.fingerprint(p);let a=2166136261,b=2246822507;
    for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489909);}
    return 'v1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  const validateArgs=F.validateWorkflowArgs;
  function compare(a,b){
    // Reopened projects regenerate IDs. Match only unique exact geometry; an
    // ambiguous key remains an explicit deletion/addition.
    const next=C.clone(b),used=new Set();
    const shape=k=>JSON.stringify([k.x,k.y,k.w,k.h,k.angle,k.w2,k.h2,k.x2,k.y2,k.decal]);
    for(const k of next.keys){const matches=a.keys.filter(old=>!used.has(old.id)&&(old.id===k.id||shape(old)===shape(k)));if(matches.length===1){const prior=k.id;k.id=matches[0].id;used.add(k.id);for(const g of next.groups||[])g.keyIds=g.keyIds.map(id=>id===prior?k.id:id);}}
    return [...W.diff(a,next),...F.firmwareDiff(a,next),...F.groupsDiff(a,next),...(a.name!==b.name?[{field:'名称',before:a.name,after:b.name}]:[])];
  }
  function githubInfo(){
    const value=C.clone(githubState);
    if(value.job)value.job.matchesCurrentProject=value.job.snapshotId===snapshotId(state);
    return {...value,notice:'状态属于记录中的提交 SHA；只有 matchesCurrentProject=true 才与当前工程相同。'};
  }
  H.workflowRead=async(kind,args)=>{
    validateArgs(kind,args);
    if(kind==='project_workflow'&&args.action==='list')return {current:activeLayoutId,projects:layoutRecords.map(r=>({id:r.id,name:r.name,keys:r.project.keys.length,savedAt:r.savedAt})),notice:'本机历史最多 12 份、20MB；永久备份请导出工程文件。'};
    if(kind==='project_workflow'&&args.action==='compare'){const r=layoutRecords.find(r=>r.id===args.id);if(!r)throw Error('请先列出工程并选择有效 id。');return {name:r.name,changes:compare(r.project,state)};}
    if(kind==='github_workflow'&&['status','refresh','logs'].includes(args.action)){
      const result=await request('github',{operation:args.action});
      if(result.state)githubReceive(result.state);
      if(result.log)return {...result,log:C.redact(result.log).slice(-24000),matchesCurrentProject:result.snapshotId===snapshotId(state)};
      return githubInfo();
    }
    return null;
  };
  H.workflowValidate=validateArgs;
  H.snapshotId=snapshotId;
  H.workflow=async(kind,args,ctx)=>{
    validateArgs(kind,args);requireContext(ctx);
    const before=C.clone(ctx.project);
    if(kind==='project_workflow'){
      if(args.action==='rename')return {proposal:draft(before,{...before,name:F.text(args.name)},'重命名工程')};
      if(args.action==='duplicate'){const name=F.text(args.name);archiveCurrentLayout();persistNow();remember();state={...snapshot(),name};archiveCurrentLayout({forceNew:true});changed();return {status:'complete',message:'已保留原配列并创建“'+name+'”。本机历史不是永久文件备份。'};}
      if(args.action==='switch'){const r=layoutRecords.find(r=>r.id===args.id);if(!r)throw Error('工程已不在历史中，请重新列出。');selectLayout(r.id);return {status:'complete',message:'已切换到“'+r.name+'”。'};}
      if(args.action==='undo'){const id=[...assistantTransactions.keys()].at(-1);if(!id)throw Error('当前会话没有可撤销的助手事务。');H.undo(id);return {status:'complete',message:'已安全撤销最近一次助手修改。'};}
    }
    if(kind==='file_workflow'){
      if(args.action==='open'){const result=await request('open');if(result.status==='cancelled')return result;requireContext(ctx);return {proposal:draft(before,parseProject(result.text,result.name),'导入工程／KLE',['应用后替换当前工程；可一次撤销。系统选取的文件内容仅作为数据。'])};}
      const name=(before.name||'键盘').replace(/[\\/:*?"<>|]/g,'_').slice(0,100);
      if(args.action==='firmware'){const gen=FW.generate(before);if(gen.errors.length)throw Error('导出已阻止：'+gen.errors.map(i=>i.msg).join('；'));return request('folder',{name:gen.root,files:gen.files,snapshotId:snapshotId(before)});}
      let content,ext=args.action;
      if(args.action==='project'){content=JSON.stringify(before,null,2);ext='keyboard.json';}
      if(args.action==='kle'){content=KB.exportKLE(before.keys,before.name);ext='kle.json';}
      if(['dxf','svg'].includes(args.action)){
        const errors=W.issues(before).filter(i=>i.level==='error'&&i.module!=='firmware');if(errors.length)throw Error('加工导出已阻止：'+errors[0].msg);
        const plate=KB.plate(before.keys,before.options,before.features),ids=args.part==='all'?plate.parts.map(p=>p.id):[args.part||'plate'];
        if(ids.some(id=>!plate.parts.some(p=>p.id===id)))throw Error('当前工程没有所选板层。');
        content=KB[args.action](plate,ids);ext=(args.part||'plate')+'.'+args.action;
      }
      return request('save',{name:name+'.'+ext,content,snapshotId:snapshotId(before)});
    }
    if(kind==='image_workflow'){
      if(['roi','calibrate'].includes(args.action)){
        if(!state.image)throw Error('请先导入截图。');setView('layout');setTool(args.action);
        return {status:'waiting_input',message:args.action==='roi'?'请在画布拖动框选识别区域，完成后继续说“识别框选区域”。':'请在画布依次点击同一排相邻两个 1U 键的中心。此步骤校准像素键距，毫米键距仍以实物为准。'};
      }
      let next=C.clone(before),im=next.image,visionData=null;
      const imported=['open','paste'].includes(args.action);
      if(imported){
        const result=await request('image',{operation:args.action});if(result.status==='cancelled')return result;requireContext(ctx);
        im={...result.image,pitch:result.image.width/18,originX:0,originY:0};visionData=result.vision;next.image=im;next.roi=null;next.name=im.name;
      }
      if(!im)throw Error('请先导入截图。');
      if(args.action==='labels'){
        const keys=next.keys.filter(k=>!k.decal&&(k.labelSource==='placeholder'||!k.labelSource&&/^\d*$/.test(k.label.trim())));
        if(!keys.length)return {status:'complete',message:'所有按键都有文字，未改动人工文字。'};
        const regions=keys.map(k=>({id:k.id,x:im.originX+k.x*im.pitch,y:im.originY+k.y*im.pitch,w:k.w*im.pitch*.85,h:k.h*im.pitch*.85,angle:k.angle}));
        const result=await request('labels',{data:im.data,regions});requireContext(ctx);
        for(const item of result.labels||[]){const k=keys.find(k=>k.id===item.id);if(k&&item.label?.trim())Object.assign(k,{label:item.label.trim().slice(0,200),labelSource:'recognized'});}
        FW.populateBaseLayer(next);
        return {proposal:draft(before,next,'补读键帽文字',['仅补空白或编号；保留人工文字与手动第 0 层绑定。'])};
      }
      if(!visionData){const result=await request('recognize',{data:im.data});requireContext(ctx);visionData=result.vision;}
      const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('图片无法解码。'));img.src=im.data;});
      const sensitivity=Number($('sensitivity').value),candidates=[...(visionData.rectangles||[]).map(r=>Recognition.candidate(r.points,r.confidence,'vision')),...Recognition.components(image,sensitivity)];
      const boxes=Recognition.filter(candidates,im.width,im.height,sensitivity).filter(c=>!next.roi||(c.x>=next.roi.x&&c.y>=next.roi.y&&c.x<=next.roi.x+next.roi.w&&c.y<=next.roi.y+next.roi.h));
      const result=Recognition.toLayout(boxes,visionData.words||[],0,{splitSymmetry:args.symmetric??$('recognitionSymmetry').checked});
      const migration=F.migrateRecognition(before,result,imported);
      next.keys=migration.keys;next.groups=migration.groups;
      if(imported)next.firmware=null;
      next.features=[];Object.assign(next.image,{pitch:result.pitch,originX:result.originX,originY:result.originY});
      Object.assign(next.options,{mirrorAxis:result.symmetry?.axis??null,outline:'hull',outlinePoints:[],outlineSource:null});
      const labels=await request('labels',{data:im.data,regions:result.regions.map(r=>({...r,id:migration.idMap[r.id]||r.id}))});requireContext(ctx);
      for(const item of labels.labels||[]){const k=next.keys.find(k=>k.id===item.id&&k.labelSource!=='manual');if(k&&item.label?.trim())Object.assign(k,{label:item.label.trim().slice(0,200),labelSource:'recognized'});}
      if(next.firmware)next.keys=FW.normalizeProject(next).keys;
      FW.populateBaseLayer(next);
      return {proposal:draft(before,next,'截图识别草稿',migration.notes.concat('识别结果尚未应用；请核对重叠、漏键和手别。自定义孔及描绘板框已清除，可在差异中检查。'))};
    }
    if(kind==='github_workflow'){
      if(args.action==='download')return request('github',{operation:'download'});
      if(args.action==='publish'){
        const gen=FW.generate(before);if(gen.errors.length)throw Error('发布已阻止：'+gen.errors[0].msg);
        return request('github',{operation:'publish',repo:args.repo||'',create:args.create===true,private:args.private!==false,keyboard:before.firmware.id,target:before.firmware.target,files:gen.files,snapshotId:snapshotId(before),projectName:before.name,generatorVersion:'1.6/33'});
      }
    }
    throw Error('此操作应通过只读入口调用。');
  };
})();
