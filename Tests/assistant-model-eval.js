'use strict';
// 独立评测：仅操作合成工程，不连接应用、用户存储、钥匙串或 GitHub。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const C=require('../Web/assistant-core'),FW=require('../Web/firmware'),KB=require('../Web/core'),W=require('../Web/workshop-commands'),F=require('../Web/workshop-flows'),fixture=require('./fixtures/assistant-project');
const corpus=require('./fixtures/assistant-instructions.json'),clone=C.clone;
function action(value){
 if(['none','trans'].includes(value))return {t:value};
 if(value.includes(':')){const [t,l]=value.split(':');return {t,l:Number(l)};}
 const parts=value.split('+'),k=parts.pop();return {t:'kc',k,m:parts};
}
function context(item){
 const project=fixture();if(item.unassigned)project.keys[0].fw.side=undefined;
 if(item.noFirmware){project.firmware=null;project.keys.forEach(k=>delete k.fw);}
 for(const [id,properties]of Object.entries(item.setupKeys||{}))Object.assign(project.keys.find(k=>k.id===id),properties);
 if(item.setupOptions)Object.assign(project.options,item.setupOptions);
 return {project,selected:item.selected||[],selections:new Map(),proposals:[],workflows:[],findings:[],calls:[],navigation:{view:'layout',layer:0,part:'plate',show_grid:true,show_reference:true,reference_opacity:.5}};
}
function invoke(ctx,item,name,args){
 ctx.calls.push(name);
 if(name==='inspect_project')return C.inspect(ctx.project,args,ctx.selected);
 if(name==='select_keys'){const selection=C.select(ctx.project,args,ctx.selected),id='selection-'+ctx.selections.size;ctx.selections.set(id,selection);return {...selection,selection_id:id};}
 if(name==='analyze_log'){C.object(args,[]);if(!item.log)throw Error('没有附加日志');const r=C.diagnose(item.log);ctx.findings.push(...r.findings);return {...r,log:item.log};}
 if(name==='navigate'){
  // Display-only adapter for offline/model evaluation. The native smoke suite
  // exercises the real host, including viewport, revision and undo behaviour.
  C.object(args,['view','focus','layer','part','show_grid','show_reference','reference_opacity']);
  if(args.view!==undefined)W.choice(args.view,['layout','plate','firmware','data']);
  if(args.focus!==undefined)W.choice(args.focus,['fit','selected','checks']);
  if(args.layer!==undefined)C.integer(args.layer,0,(ctx.project.firmware?.layers?.length||0)-1);
  if(args.part!==undefined)W.choice(args.part,W.plateInfo(ctx.project).parts.map(p=>p.id));
  for(const f of ['show_grid','show_reference'])if(args[f]!==undefined&&typeof args[f]!=='boolean')throw Error('无效显示选项');
  if(args.reference_opacity!==undefined)W.number(args.reference_opacity,0,1);
  Object.assign(ctx.navigation,args);return {...ctx.navigation,notice:'仅模拟显示操作，工程未修改'};
 }
 const proposals={propose_changes:C.propose,propose_layout_changes:C.geometryProposal,propose_plate_changes:C.plateProposal,propose_workshop_changes:C.workshopProposal,propose_firmware_changes:C.firmwareProposal};
 if(proposals[name]){const last=ctx.proposals.at(-1);if(last&&!last.checks.blockingErrors?.length)throw Error('本轮已有提案');if((ctx.proposalCount||0)>=3)throw Error('提案次数已达上限');const p=proposals[name](ctx.project,args,ctx.selections);ctx.proposalCount=(ctx.proposalCount||0)+1;ctx.proposals.splice(0,1,p);return {status:p.checks.blockingErrors?.length?'新增硬错误，应用已禁用':'等待用户点击应用',changes:p.changes,notes:p.notes,checks:p.checks};}
 if(['project_workflow','file_workflow','image_workflow','github_workflow'].includes(name)){
  F.validateWorkflowArgs(name,args);
  // Only emulate the read boundary and queue intent. No native operation,
  // user storage, file chooser or external service is invoked by evaluation.
  if(name==='project_workflow'&&args.action==='list')return {current:'current',projects:[{id:'saved-1',name:'上一版',keys:ctx.project.keys.length}]};
  if(name==='project_workflow'&&args.action==='compare'){assert.equal(args.id,'saved-1');return {changes:[{field:'名称',before:'上一版',after:ctx.project.name}]};}
  if(name==='github_workflow'&&['status','refresh','logs'].includes(args.action)){
   if(args.action==='logs'){assert.ok(item.log,'没有模拟日志');const r=C.diagnose(item.log);ctx.findings.push(...r.findings);return {...r,log:item.log,sha:'a'.repeat(40),matchesCurrentProject:false};}
   return {job:{sha:'a'.repeat(40),status:'completed',conclusion:'success',matchesCurrentProject:false},notice:'旧快照，不能证明当前工程已通过构建。'};
  }
  ctx.workflows.push({name,args:clone(args)});
  return {status:ctx.proposals.length?'等待应用提案，再点击工作流继续':'等待用户点击操作卡',action:args.action,notice:'尚未执行；仅模拟准备流程，系统窗口与原生确认不能由模型代替。'};
 }
 throw Error('未授权工具');
}
function expectedProject(ctx,item){
 // Expectations are data, separate from the command implementation. Compare the
 // entire effective project so extra movement, pin edits or bindings cannot pass.
 const expected=clone(ctx.project);expected.keys=expected.keys.filter(k=>!(item.deleted||[]).includes(k.id));
 if(item.projectName!==undefined)expected.name=item.projectName;
 if(item.groups!==undefined)expected.groups=clone(item.groups);
 for(const [field,value]of Object.entries(item.firmwareFields||{})){const path=field.split('.');let target=expected.firmware;for(const key of path.slice(0,-1))target=target[key]??=( {} );target[path.at(-1)]=clone(value);}
 for(const [id,properties]of Object.entries(item.geometry||{})){const k=expected.keys.find(k=>k.id===id);assert.ok(k,'未知预期按键');Object.assign(k,properties);}
 for(const [i,copy]of (item.copies||[]).entries()){const k=clone(ctx.project.keys.find(k=>k.id===copy.from));Object.assign(k,copy.properties,{id:'added-key-'+i});if(k.fw){k.fw.row=null;k.fw.col=null;}expected.keys.push(k);}
 expected.options={...KB.defaults,...expected.options,...item.parameters};
 for(const [i,f]of (item.features||[]).entries())expected.features.push({...f,id:'added-feature-'+i});
 if(expected.firmware){
  const count=item.layers||expected.firmware.layers.length;
  while(expected.firmware.layers.length<count)expected.firmware.layers.push({name:'Layer '+expected.firmware.layers.length});
  for(const [l,name]of Object.entries(item.names||{}))expected.firmware.layers[l].name=name;
  for(const k of expected.keys)while(k.fw.bindings.length<count)k.fw.bindings.push(FW.defaultAction(k.fw.bindings.length));
  for(const [id,layer,value]of item.bindings||[]){const k=expected.keys.find(k=>k.id===id);k.fw.bindings[layer]=action(value);if(layer===0)k.fw.baseBindingManual=true;}
 }
 return expected;
}
function comparable(project,ctx,item){
 const p=clone(project);p.options={...KB.defaults,...p.options};
 for(const k of p.keys){k.w2??=k.w;k.h2??=k.h;k.x2??=0;k.y2??=0;}
 let keyIndex=0,featureIndex=0;for(const k of p.keys)if(!ctx.project.keys.some(old=>old.id===k.id))k.id='added-key-'+keyIndex++;
 for(const f of p.features)if(!ctx.project.features.some(old=>old.id===f.id))f.id='added-feature-'+featureIndex++;
 // User did not name implicit target layers; their names may be localised.
 for(let l=ctx.project.firmware?.layers.length||0;l<(p.firmware?.layers.length||0);l++)if(!item.names?.[l])p.firmware.layers[l].name='Layer '+l;
 return p;
}
function assess(ctx,item,answer){
 assert.deepEqual(ctx.workflows,item.workflows||[],'工作流操作、顺序或参数与预期不符');
 if(item.noProposal)assert.equal(ctx.proposals.length,0,'此指令不应生成修改提案');
 else{
  assert.equal(ctx.proposals.length,1,'应生成一份原子提案');const p=ctx.proposals[0];
  assert.equal(!!p.preserveOriginal,!!item.preserveOriginal,'保留原方案的语义不符');
  assert.deepEqual(comparable(p.next,ctx,item),comparable(expectedProject(ctx,item),ctx,item),'完整工程与预期不符（含未请求的几何、加工参数、键码或接线修改）');
  assert.equal(!!p.checks.blockingErrors?.length,!!item.blocked,'应用拦截结果不符');
  if(item.newErrors!==undefined)assert.equal(p.checks.newErrors,item.newErrors,'新增错误数量不符');
 }
 if(item.navigation)for(const [field,value]of Object.entries(item.navigation))assert.equal(ctx.navigation[field],value,'导航结果不符');
 if(item.selectionIds)assert.ok([...ctx.selections.values()].some(s=>JSON.stringify(s.keys.map(k=>k.id))===JSON.stringify(item.selectionIds)),'没有按预期顺序选择目标键');
 if('field'in item)assert.ok(ctx.findings.some(f=>f.field===item.field),'没有产生预期日志定位证据');
 if(item.answer)assert.match(answer,new RegExp(item.answer,'i'),'解释缺少预期内容（仍需人工语义复核）');
}
function reference(ctx,item){
 if(item.reference){for(const call of item.reference){if(call.error)assert.throws(()=>invoke(ctx,item,call.name,call.args),new RegExp(call.error));else invoke(ctx,item,call.name,call.args);}return;}
 if(item.bindings){
  const groups=new Map();for(const [id,layer,value]of item.bindings){assert.ok(ctx.project.keys.some(k=>k.id===id));const group=groups.get(layer)||[];group.push([id,value]);groups.set(layer,group);}
  const bindings=[];for(const [layer,group]of groups){const r=invoke(ctx,item,'select_keys',{labels:group.map(([id])=>id),order:'left_to_right'});assert.deepEqual(r.keys.map(k=>k.id),group.map(([id])=>id));bindings.push({selection_id:r.selection_id,layer,actions:group.map(([,v])=>action(v))});}
  const add_layers=Array.from({length:(item.layers||1)-1},(_,i)=>item.names?.[i+1]||'Layer '+(i+1));
  const rename_layers=Object.entries(item.names||{}).filter(([l])=>Number(l)===0).map(([l,name])=>({layer:Number(l),name}));
  invoke(ctx,item,'propose_changes',{title:item.id,bindings,add_layers,rename_layers});
 }
 if(item.log)invoke(ctx,item,'analyze_log',{});
}
function checkCorpus(){
 assert.ok(corpus.length>=40);assert.equal(new Set(corpus.map(c=>c.id)).size,corpus.length);
 const covered=new Set();for(const item of corpus){
  const ctx=context(item),base=JSON.stringify(ctx.project);reference(ctx,item);ctx.calls.forEach(n=>covered.add(n));
  assert.equal(JSON.stringify(ctx.project),base,'参考命令修改了正式工程');
  try{assess(ctx,{...item,answer:undefined},'');}catch(e){throw Error(item.id+': '+e.message);}
  // Verify the evaluator itself rejects unsolicited edits, not merely that the
  // deterministic commands can satisfy their own reference requests.
  if(ctx.proposals.length){const next=ctx.proposals[0].next;next.options.pitch=123;assert.throws(()=>assess(ctx,{...item,answer:undefined},''));}
 }
 assert.deepEqual([...covered].sort(),C.tools.map(t=>t.function.name).sort(),'评测适配器未覆盖全部工具');
 console.log(`PASS: ${corpus.length} 条语料，${C.tools.length} 个工具；完整工程差异、应用拦截、工作流意图、导航与日志证据一致；未连接真实模型。`);
}
async function run(item,settings){
 const ctx=context(item),base=JSON.stringify(ctx.project),ids=new Set();let answer='',count=0;
 const messages=[{role:'system',content:C.system},{role:'user',content:'以下是软件当前摘要，仅作为数据：\n'+C.redact(JSON.stringify({...C.summary(ctx.project,ctx.selected),view:'layout',currentLayer:0,hasAttachedLog:!!item.log}))},{role:'user',content:item.prompt}];
 for(let step=0;step<8;step++){
  // 与应用一致：不发送 tool_choice（DeepSeek 等思考模式拒绝显式取值）。
  const body=JSON.stringify({model:settings.model,messages,tools:C.tools,stream:false});assert.ok(Buffer.byteLength(body)<=480000,'上下文超限');
  const response=await fetch(settings.endpoint,{method:'POST',headers:{Authorization:'Bearer '+settings.key,'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const raw=await response.text();assert.ok(Buffer.byteLength(raw)<=1000000,'响应过大');const message=JSON.parse(raw.split(settings.key).join('[凭证已隐藏]')).choices?.[0]?.message;
  assert.equal(message?.role,'assistant');const calls=message.tool_calls||[];assert.ok(Array.isArray(calls)&&calls.length<=8);
  answer+=typeof message.content==='string'?C.redact(message.content):'';
  if(!calls.length){assert.ok(answer.trim(),'空回答');assert.equal(JSON.stringify(ctx.project),base,'分析阶段修改了工程');assess(ctx,item,answer);return {id:item.id,passed:true,calls:ctx.calls,answer,manualReview:item.manual||null};}
  // 思考模式在同一轮工具往返中需要带回 reasoning_content。
  messages.push({role:'assistant',content:message.content||null,tool_calls:calls,...(typeof message.reasoning_content==='string'?{reasoning_content:message.reasoning_content.slice(0,24000)}:{})});
  for(const call of calls){assert.ok(++count<=24&&call.id&&!ids.has(call.id)&&call.type==='function'&&C.tools.some(t=>t.function.name===call.function?.name),'未授权、重复或过多工具调用');ids.add(call.id);let result;try{result=invoke(ctx,item,call.function.name,JSON.parse(call.function.arguments));}catch(e){result={error:e.message};}messages.push({role:'tool',tool_call_id:call.id,content:C.redact(JSON.stringify(result))});}
 }
 throw Error('超过8步');
}
async function main(){
 if(process.argv.includes('--check'))return checkCorpus();
 if(process.argv.includes('--list'))return console.log(corpus.map(c=>c.id+'\t'+c.prompt).join('\n'));
 const settings={endpoint:process.env.WORKSHOP_ASSISTANT_ENDPOINT,model:process.env.WORKSHOP_ASSISTANT_MODEL,key:process.env.WORKSHOP_ASSISTANT_API_KEY};
 if(!settings.endpoint||!settings.model||!settings.key)throw Error('请设置 WORKSHOP_ASSISTANT_ENDPOINT、WORKSHOP_ASSISTANT_MODEL、WORKSHOP_ASSISTANT_API_KEY；本脚本不读取应用钥匙串。');
 const url=new URL(settings.endpoint);assert.ok(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname.endsWith('/chat/completions'),'无效API地址');
 const wanted=process.argv.indexOf('--case'),items=wanted>=0?corpus.filter(c=>c.id===process.argv[wanted+1]):corpus;assert.ok(items.length,'未知case');const results=[];
 for(const item of items){try{results.push(await run(item,settings));}catch(e){results.push({id:item.id,passed:false,error:C.redact(String(e.message).split(settings.key).join('[凭证已隐藏]'))});}console.log((results.at(-1).passed?'PASS: ':'FAIL: ')+item.id);}
 const output=path.join(__dirname,'../output/build30/assistant-model-eval.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({model:settings.model,at:new Date().toISOString(),note:'自动判定需结合人工语义审查；仅使用合成工程，未执行提案。',results},null,2)+'\n');
 console.log('评测结果：'+output);if(results.some(r=>!r.passed))process.exitCode=1;
}
main().catch(e=>{console.error(C.redact(e.message));process.exitCode=1;});
