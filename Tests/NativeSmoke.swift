import AppKit
import WebKit
class Smoke: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
 var web:WKWebView!
 func applicationDidFinishLaunching(_ note:Notification){
   let config=WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent(); config.userContentController.add(self,name:"workshop")
   web=WKWebView(frame:NSRect(x:0,y:0,width:1380,height:900),configuration:config);web.navigationDelegate=self
   let root=URL(fileURLWithPath:CommandLine.arguments[1]);web.loadFileURL(root.appendingPathComponent("index.html"),allowingReadAccessTo:root)
   DispatchQueue.main.asyncAfter(deadline:.now()+45){print("FAIL: timeout");exit(1)}
 }
 func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage){}
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
   let sample=try! String(contentsOfFile:CommandLine.arguments[2],encoding:.utf8)
   let literal=String(data:try! JSONSerialization.data(withJSONObject:[sample]),encoding:.utf8)!
   let fixtureURL=URL(fileURLWithPath:CommandLine.arguments[1]).deletingLastPathComponent().appendingPathComponent("Tests/fixtures/split-mirror-outlier.json")
   let fixture=try! String(contentsOf:fixtureURL,encoding:.utf8)
   let fixtureLiteral=String(data:try! JSONSerialization.data(withJSONObject:[fixture]),encoding:.utf8)!
   let script="""
   const input=\(literal)[0];
   if(document.getElementById('showReference').checked)throw Error('reference image enabled by default');
   Workshop.loadText(input);
   const angleCheckTarget=KB.key({x:0,y:0,angle:25}),angleCheckOffset=KB.rotate(0,-1,25),angleCheckMoving=KB.key({x:angleCheckOffset.x+.05,y:angleCheckOffset.y-.04,angle:-10}),snap=KB.snapNeighbors([angleCheckMoving],[angleCheckTarget]);
   if(!snap||Math.abs(angleCheckMoving.angle+snap.angleDelta-angleCheckTarget.angle)>1e-6)throw Error('neighbor snap angle');
   if(Workshop.getState().keys.filter(k=>!k.decal).length!==42)throw Error('key count');
   document.getElementById('showPlate').click();
   if(Workshop.getPlate().errors.length)throw Error('plate errors');
   const dxf=KB.dxf(Workshop.getPlate());
   if(!dxf.includes('LWPOLYLINE'))throw Error('DXF');
   const outlineSelect=document.getElementById('outline');
   if(![...outlineSelect.options].some(o=>o.value==='contour'))throw Error('key-following outline option missing');
   outlineSelect.value='contour';outlineSelect.dispatchEvent(new Event('change'));
   const setPlateField=(id,value)=>{const field=document.getElementById(id);field.value=String(value);field.dispatchEvent(new Event('change'));};
   setPlateField('margin',2.9);setPlateField('outlineRadius',2);
   const contoured=Workshop.getPlate(),contourDXF=KB.dxf(contoured);
   if(contoured.errors.length||contoured.options.outline!=='contour'||contoured.options.margin!==2.9||contoured.options.outlineRadius!==2||!contourDXF.includes('LWPOLYLINE')||(contourDXF.match(/\\r\\n42\\r\\n/g)||[]).length<5)throw Error('key-following board preview / rounded DXF');
   for(let i=0;i<3;i++)document.getElementById('undo').click();
   if(Workshop.getState().options.outline!=='hull'||Workshop.getState().options.margin!==4||Workshop.getState().options.outlineRadius!==0)throw Error('key-following board undo');
   const cherry=KB.plate([KB.key({w:2})],{stabilizers:'cherry-spec',holeRadius:.4,kerf:.2});
   if(cherry.errors.length||cherry.polygons.length!==1||cherry.polygons[0].layer!=='SWITCH'||cherry.polygons[0].points.length<20||!/\\r\\nSWITCH\\r\\n/.test(KB.dxf(cherry)))throw Error('Cherry Spec');
   document.getElementById('addRectangle').click();
   document.getElementById('undo').click();
   if(Workshop.getState().features.length!==0)throw Error('undo');
   for(const id of ['holeRadius','outlineRadius','kerf'])if(Number(document.getElementById(id).value)!==0||Workshop.getState().options[id]!==0)throw Error('machining default '+id);
   if(/\\r\\n42\\r\\n/.test(dxf))throw Error('default DXF has arcs');
   const setField=(id,value)=>{const field=document.getElementById(id);field.value=String(value);field.dispatchEvent(new Event('change'));};
   const machiningHistory=undoStack.length;
   setField('holeRadius',.5);setField('outlineRadius',3);setField('kerf',.2);
   const machined=Workshop.getState().options,machinedPlate=Workshop.getPlate(),machinedDXF=KB.dxf(machinedPlate);
   if(machined.holeRadius!==.5||machined.outlineRadius!==3||machined.kerf!==.2||undoStack.length!==machiningHistory+3)throw Error('machining options');
   if(machinedPlate.errors.length||!/\\r\\n42\\r\\n/.test(machinedDXF)||!machinedPlate.warnings.some(t=>t.includes('切缝补偿'))||!document.getElementById('checks').textContent.includes('切缝补偿'))throw Error('machining DXF');
   setField('holeRadius',3);
   if(!document.getElementById('checks').textContent.includes('开孔内角'))throw Error('machining range check');
   for(let i=0;i<4;i++)document.getElementById('undo').click();
   for(const id of ['holeRadius','outlineRadius','kerf'])if(Workshop.getState().options[id]!==0||Number(document.getElementById(id).value)!==0)throw Error('machining undo '+id);
   const visible=id=>getComputedStyle(document.getElementById(id)).display!=='none';
   if(document.body.dataset.view!=='plate'||!visible('plateInspector')||visible('layoutInspector')||!visible('partTabs')||visible('layoutTools'))throw Error('plate view panels');
   const caseHistory=undoStack.length;
   document.getElementById('switchType').value='mx-openable';document.getElementById('switchType').dispatchEvent(new Event('change'));
   setField('margin',9);setField('mountHoles',8);setField('caseType','sandwich');setField('frameWidth',7);setField('usbWidth',12);setField('pitchY',19.05);setField('pitchY','');
   const cased=Workshop.getPlate();
   if(Workshop.getState().options.cutout!=='mx-openable'||document.getElementById('hole').disabled!==true||Workshop.getState().options.pitchY!==null)throw Error('cutout / pitchY options');
   if(cased.errors.length||cased.parts.map(p=>p.id).join()!=='plate,frame,bottom'||cased.circles.filter(c=>c.auto).length!==8)throw Error('sandwich parts '+cased.errors.join());
   if(document.querySelector('[data-part="frame"]').disabled||!document.getElementById('plateBadge').hidden)throw Error('part tabs / badge');
   document.querySelector('[data-part="frame"]').click();
   if(plateLayer!=='frame'||document.getElementById('plateLayerName').textContent!=='中框'||!document.getElementById('plateLegend').textContent.includes('开口'))throw Error('frame layer');
   const caseDXF=KB.dxf(cased,['plate','frame','bottom']),frameSVG=KB.svg(cased,['frame']);
   if(!/\\r\\nFRAME_MOUNT\\r\\n/.test(caseDXF)||!frameSVG.includes('<g id="FRAME">')||frameSVG.includes('SWITCH'))throw Error('case export');
   setField('mountHoles',30);
   if(document.getElementById('plateBadge').hidden||document.querySelector('[data-part="frame"]').disabled!==true||plateLayer!=='plate')throw Error('error badge');
   for(let i=0;i<40&&undoStack.length>caseHistory;i++)document.getElementById('undo').click();
   if(Workshop.getState().options.caseType!=='none'||Workshop.getState().options.cutout!=='square'||Workshop.getState().options.mountHoles!==0)throw Error('case undo');
   document.querySelector('[data-view="layout"]').click();
   if(!visible('layoutInspector')||visible('plateInspector')||!visible('layoutTools'))throw Error('layout view panels');
   selected.clear();inspector();
   const keyEditGroup=document.querySelector('.key-edit-group'),addTool=document.querySelector('[data-tool="add"]');
   if(!keyEditGroup||!addTool||document.getElementById('duplicate').disabled!==true||document.getElementById('deleteKey').disabled!==true)throw Error('key edit toolbar initial state');
   const editStart=Workshop.getState().keys.length,canvasRect=canvas.getBoundingClientRect();
   addTool.click();
   if(!addTool.classList.contains('active')||document.querySelector('[data-tool="select"]').classList.contains('active'))throw Error('add mode state');
   canvas.setPointerCapture=()=>{};
   const addPoint=(x,y)=>{canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:x,clientY:y,pointerId:41,buttons:1}));canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y,pointerId:41,buttons:0}));};
   addPoint(canvasRect.right-100,canvasRect.bottom-100);addPoint(canvasRect.right-160,canvasRect.bottom-100);
   if(Workshop.getState().keys.length!==editStart+2||document.getElementById('duplicate').disabled||document.getElementById('deleteKey').disabled||!addTool.classList.contains('active'))throw Error('continuous add');
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
   if(!document.querySelector('[data-tool="select"]').classList.contains('active')||addTool.classList.contains('active'))throw Error('escape add mode');
   document.getElementById('duplicate').click();
   if(Workshop.getState().keys.length!==editStart+3||!document.querySelector('[data-tool="select"]').classList.contains('active')||document.getElementById('duplicate').disabled||document.getElementById('deleteKey').disabled)throw Error('duplicate action');
   document.getElementById('deleteKey').click();
   if(Workshop.getState().keys.length!==editStart+2||selected.size!==0||!document.querySelector('[data-tool="select"]').classList.contains('active'))throw Error('delete action');
   document.getElementById('undo').click();
   if(Workshop.getState().keys.length!==editStart+3)throw Error('delete undo');
   for(let i=0;i<3;i++)document.getElementById('undo').click();
   if(Workshop.getState().keys.length!==editStart||selected.size!==0)throw Error('edit undo restore');
   const longKey=Workshop.getState().keys.find(k=>!k.decal),marker=Workshop.getState().keys.find(k=>k.decal);
   selected=new Set([longKey.id,marker.id]);inspector();
   if(document.getElementById('keyPlateOutlineRow').hidden)throw Error('decal outline row');
   document.getElementById('keyStab').value='none';document.getElementById('keyStab').dispatchEvent(new Event('change'));
   document.getElementById('keyRotation').value='90';document.getElementById('keyRotation').dispatchEvent(new Event('change'));
   document.getElementById('keyPlateOutline').checked=true;document.getElementById('keyPlateOutline').dispatchEvent(new Event('change'));
   const overridden=Workshop.getState().keys;
   if(overridden.find(k=>k.id===longKey.id).stab!=='none'||overridden.find(k=>k.id===longKey.id).cutoutRotation!==90||overridden.find(k=>k.id===longKey.id).plateOutline||!overridden.find(k=>k.id===marker.id).plateOutline)throw Error('per-key overrides');
   Workshop.loadText(JSON.stringify(Workshop.getState()));
   const reloaded=Workshop.getState().keys;
   if(reloaded.filter(k=>k.stab==='none').length!==2||!reloaded.some(k=>k.decal&&k.plateOutline))throw Error('per-key overrides restore');
   for(let i=0;i<4;i++)document.getElementById('undo').click();
   if(Workshop.getState().keys.some(k=>k.stab!=='auto'||k.cutoutRotation||k.plateOutline))throw Error('per-key undo');
   const left=[0,1,2].map(i=>KB.key({x:1+i*.15,y:1+i*1.3,angle:6,label:'左'+i}));
   const right=left.map((k,i)=>KB.key({x:12-k.x+.12,y:k.y-.08,angle:-3,w:1.1,label:'右'+i,color:'#234534'}));
   const feature={id:'feature',type:'circle',name:'保留的固定孔',x:19.05,y:19.05,w:3,h:3,angle:0};
   const reference={data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',width:1,height:1,pitch:38,originX:0,originY:0};
   Workshop.loadText(JSON.stringify({version:1,name:'分体工程验证',keys:[...left,...right,KB.key({x:100,decal:true,label:'标记'})],features:[feature],options:{pitch:19.05,hole:14,margin:4,outline:'split',stabilizers:'none'},image:reference}));
   if(Workshop.getState().options.mirrorAxis!==null)throw Error('legacy project axis');
   if(Workshop.getState().options.holeRadius!==0||Workshop.getState().options.outlineRadius!==0||Workshop.getState().options.kerf!==0)throw Error('legacy project machining defaults');
   const axisInput=document.getElementById('mirrorAxis');axisInput.value='6';axisInput.dispatchEvent(new Event('change'));
   document.getElementById('selectLeftHalf').click();
   if(selected.size!==3)throw Error('select left half includes decal');
   if(document.getElementById('mirrorSelection').disabled)throw Error('mirror button disabled');
   const before=JSON.stringify(Workshop.getState());
   document.getElementById('mirrorSelection').click();
   const mirrored=Workshop.getState();
   for(let i=0;i<3;i++){
     const a=mirrored.keys[i],b=mirrored.keys[i+3];
     if(Math.abs(a.x+b.x-12)>1e-6||a.y!==b.y||a.angle!==-b.angle||b.w!==a.w||b.label!=='右'+i||b.color!=='#234534')throw Error('mirror geometry/metadata');
   }
   if(mirrored.features.length!==1||JSON.stringify(mirrored.image)!==JSON.stringify(reference))throw Error('mirror changed project data');
   document.getElementById('undo').click();
   if(JSON.stringify(Workshop.getState())!==before)throw Error('mirror undo');
   document.getElementById('redo').click();
   if(JSON.stringify(Workshop.getState())!==JSON.stringify(mirrored))throw Error('mirror redo');
   Workshop.loadText(JSON.stringify(mirrored));
   const restored=Workshop.getState();
   if(restored.options.mirrorAxis!==6||restored.keys.length!==7||restored.features[0].name!==feature.name||JSON.stringify(restored.image)!==JSON.stringify(reference))throw Error('mirror project restore');
   selected=new Set(restored.keys.slice(0,3).map(k=>k.id));inspector();
   const historyLength=undoStack.length;
   document.getElementById('mirrorSelection').click();
   if(undoStack.length!==historyLength||!document.getElementById('status').textContent.includes('无需校正'))throw Error('mirror no-op');
   axisInput.value='5';axisInput.dispatchEvent(new Event('change'));
   const failedBefore=JSON.stringify(Workshop.getState()),failedHistory=undoStack.length;
   document.getElementById('mirrorSelection').click();
   if(JSON.stringify(Workshop.getState())!==failedBefore||undoStack.length!==failedHistory||document.getElementById('status').dataset.tone!=='error')throw Error('failed mirror changed state');
   if(document.getElementById('mirrorFeedback').hidden||document.getElementById('mirrorFeedback').dataset.tone!=='error'||!document.getElementById('mirrorFeedback').textContent.includes('镜像未执行'))throw Error('mirror error not shown by action');
   const autoProject=JSON.parse(before);delete autoProject.options.mirrorAxis;
   Workshop.loadText(JSON.stringify(autoProject));
   const automaticBefore=JSON.stringify(Workshop.getState());
   document.getElementById('selectLeftHalf').click();document.getElementById('mirrorSelection').click();
   if(Math.abs(Workshop.getState().options.mirrorAxis-6.06)>1e-6)throw Error('automatic mirror axis not frozen');
   document.getElementById('undo').click();
   if(JSON.stringify(Workshop.getState())!==automaticBefore)throw Error('automatic axis undo');
   const outlierFixture=JSON.parse(\(fixtureLiteral)[0]);
   Workshop.loadText(JSON.stringify({version:1,name:'整侧远移键验证',keys:outlierFixture.keys.map(k=>KB.key(k)),features:[],options:{...KB.defaults,mirrorAxis:outlierFixture.axis},image:null}));
   document.getElementById('selectLeftHalf').click();
   const outlierBefore=JSON.stringify(Workshop.getState()),outlierHistory=undoStack.length;
   document.getElementById('mirrorSelection').click();
   const outlierFixed=Workshop.getState(),source46=outlierFixed.keys.find(k=>k.label==='46'),target54=outlierFixed.keys.find(k=>k.label==='54'),mirrorFeedback=document.getElementById('mirrorFeedback');
   if(Math.abs(source46.x+target54.x-2*outlierFixture.axis)>1e-6||Math.abs(source46.y-target54.y)>1e-6||target54.angle!==-source46.angle)throw Error('54 key outlier not mirrored');
   if(undoStack.length!==outlierHistory+1||mirrorFeedback.hidden||!mirrorFeedback.textContent.includes('27 个键位')||!mirrorFeedback.textContent.includes('1 个远移键'))throw Error('outlier feedback / history');
   for(const a of outlierFixed.keys.filter(k=>k.x<outlierFixture.axis))if(!outlierFixed.keys.some(b=>b.x>outlierFixture.axis&&Math.abs(a.x+b.x-2*outlierFixture.axis)<1e-6&&Math.abs(a.y-b.y)<1e-6&&Math.abs(a.angle+b.angle)<1e-6))throw Error('remaining mirrored pairs');
   document.getElementById('mirrorSelection').click();
   if(undoStack.length!==outlierHistory+1||mirrorFeedback.hidden||!mirrorFeedback.textContent.includes('无需校正'))throw Error('outlier repeat no-op');
   document.getElementById('undo').click();
   if(JSON.stringify(Workshop.getState())!==outlierBefore||!mirrorFeedback.hidden)throw Error('outlier undo / feedback reset');
   document.getElementById('redo').click();
   if(JSON.stringify(Workshop.getState())!==JSON.stringify(outlierFixed))throw Error('outlier redo');
   Workshop.loadText(automaticBefore);
   await window.nativeEvent({event:'layouts',payload:[]});
   if(Workshop.getLayouts().length!==1||document.getElementById('layoutList').value!==Workshop.getLayouts()[0].id)throw Error('current layout missing from dropdown');
   const layoutSelect=document.getElementById('layoutList'),activeOption=layoutSelect.options[layoutSelect.selectedIndex],activeRecord=Workshop.getLayouts()[0];
   if(activeOption.textContent.includes('最后保存')||activeOption.textContent.includes(String(activeRecord.savedAt))||!activeOption.title.startsWith('最后保存：')||layoutSelect.title!==activeOption.title)throw Error('layout save time should be a tooltip');
   const nameField=document.getElementById('projectName');nameField.value='配列 A';document.getElementById('renameLayout').click();
   if(Workshop.getState().name!=='配列 A'||Workshop.getLayouts()[0].name!=='配列 A')throw Error('layout rename');
   Workshop.loadText(JSON.stringify({version:1,name:'配列 B',keys:[KB.key({x:1,y:2,label:'B'})],features:[],options:{...KB.defaults},image:null,roi:null}));
   if(Workshop.getLayouts().length!==2)throw Error('layout history count');
   const selector=document.getElementById('layoutList'),layoutA=Workshop.getLayouts().find(r=>r.name==='配列 A');
   selector.value=layoutA.id;selector.dispatchEvent(new Event('change'));
   if(Workshop.getState().name!=='配列 A'||Workshop.getState().keys.length!==7)throw Error('dropdown restore A');
   const layoutB=Workshop.getLayouts().find(r=>r.name==='配列 B');selector.value=layoutB.id;selector.dispatchEvent(new Event('change'));
   if(Workshop.getState().name!=='配列 B'||Workshop.getState().keys.length!==1)throw Error('dropdown restore B');
   const dragSnapTarget=KB.key({x:2,y:3,angle:28,label:'snap-target'}),dragSnapOffset=KB.rotate(0,-1,dragSnapTarget.angle),dragSnapMoving=KB.key({x:dragSnapTarget.x+dragSnapOffset.x-.18,y:dragSnapTarget.y+dragSnapOffset.y+.05,angle:-12,label:'snap-moving'}),dragSnapProject={version:1,name:'角度吸附验证',keys:[dragSnapTarget,dragSnapMoving],features:[],options:{...KB.defaults},image:null,roi:null};
   Workshop.loadText(JSON.stringify(dragSnapProject));
   const dragState=Workshop.getState(),dragTarget=dragState.keys.find(k=>k.label==='snap-target'),dragMoving=dragState.keys.find(k=>k.label==='snap-moving'),dragOriginal={x:dragMoving.x,y:dragMoving.y,angle:dragMoving.angle};
   selected=new Set([dragMoving.id]);camera.scale=38;
   pointer={mode:'move',start:{x:dragMoving.x-.25,y:dragMoving.y},initial:[{id:dragMoving.id,x:dragMoving.x,y:dragMoving.y,angle:dragMoving.angle}],anchorID:dragMoving.id,remembered:false};
   moveSelection({x:dragMoving.x-.1,y:dragMoving.y},false);
   const duringSnap=Workshop.getState(),snapped=duringSnap.keys.find(k=>k.id===dragMoving.id);
   if(!snapPreview||Math.abs(snapped.angle-dragTarget.angle)>1e-6||Math.abs(snapped.x-(dragTarget.x+dragSnapOffset.x))>.24||Math.abs(snapped.y-(dragTarget.y+dragSnapOffset.y))>.24)throw Error('drag did not preview angle and position snap');
   finishMove();
   if(Math.abs(Workshop.getState().keys.find(k=>k.id===dragMoving.id).angle-dragTarget.angle)>1e-6)throw Error('angle snap was not committed');
   undo();
   const snapRestored=Workshop.getState().keys.find(k=>k.id===dragMoving.id);
   if(snapRestored.angle!==dragOriginal.angle||snapRestored.x!==dragOriginal.x||snapRestored.y!==dragOriginal.y)throw Error('angle snap undo');
   const isoRaw=[[{w:1.25,h:2,w2:1.5,h2:1,x2:-.25},'ISO Enter'],[{x:3},'A']];
   Workshop.loadText(JSON.stringify(isoRaw));
   const iso=Workshop.getState().keys[0];
   if(!KB.hasCompoundShape(iso)||hit({x:-.15,y:.5})?.id!==iso.id||hit({x:-.15,y:1.5}))throw Error('compound key hit area');
   if(Workshop.getPlate().errors.length||Workshop.getPlate().polygons.length!==2)throw Error('compound plate');
   const canvasPoint=p=>({clientX:canvasRect.left+camera.x+p.x*camera.scale,clientY:canvasRect.top+camera.y+p.y*camera.scale});
   const pointerAt=(type,p)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,...canvasPoint(p),pointerId:42,buttons:type==='pointerup'?0:1,altKey:true}));
   pointerAt('pointerdown',{x:-.15,y:.5});pointerAt('pointermove',{x:.15,y:.5});pointerAt('pointerup',{x:.15,y:.5});
   const movedISO=Workshop.getState().keys[0];
   if(Math.abs(movedISO.x-iso.x-.3)>1e-6||movedISO.x2!==-.25||movedISO.w2!==1.5||!selected.has(iso.id))throw Error('compound protrusion drag');
   undo();
   if(Math.abs(Workshop.getState().keys[0].x-iso.x)>1e-6)throw Error('compound drag undo');
   selected=new Set([iso.id]);inspector();
   setField('keyAngle',31);setField('keyH',2.25);
   const editedISO=Workshop.getState().keys[0],compoundSaved=JSON.stringify(Workshop.getState());
   if(editedISO.angle!==31||editedISO.h!==2.25||editedISO.h2!==1)throw Error('compound geometry edit');
   Workshop.loadText(compoundSaved);
   const isoReloaded=Workshop.getState().keys[0];
   for(const prop of ['x','y','w','h','angle','w2','h2','x2','y2'])if(isoReloaded[prop]!==editedISO[prop])throw Error('compound project restore '+prop);
   persistNow();
   const compoundRecord=Workshop.getLayouts().find(r=>r.id===activeLayoutId);
   if(!compoundRecord||compoundRecord.project.keys[0].w2!==1.5||compoundRecord.project.keys[0].x2!==-.25)throw Error('compound layout archive');
   document.querySelector('[data-view="data"]').click();
   const isoRoundtrip=KB.parseKLE(document.getElementById('rawData').value).keys[0];
   for(const prop of ['x','y','w','h','angle','w2','h2','x2','y2'])if(Math.abs(isoRoundtrip[prop]-editedISO[prop])>1e-6)throw Error('compound Raw Data '+prop);
   document.querySelector('[data-view="layout"]').click();
   const narrow=KB.key({x:3,w2:.5,h2:.5,x2:.75,y2:.25});
   Workshop.loadText(JSON.stringify({version:1,name:'尺寸校验',keys:[KB.key(),narrow],features:[],options:{...KB.defaults}}));
   selected=new Set(Workshop.getState().keys.map(k=>k.id));inspector();
   const invalidEditBefore=JSON.stringify(Workshop.getState()),invalidEditHistory=undoStack.length;
   setField('keyW',.5);
   if(JSON.stringify(Workshop.getState())!==invalidEditBefore||undoStack.length!==invalidEditHistory||document.getElementById('status').dataset.tone!=='error')throw Error('invalid compound multi-edit changed project');
   selected=new Set([Workshop.getState().keys[0].id]);inspector();setField('keyW',1.5);
   if(Workshop.getState().keys[0].w!==1.5||Workshop.getState().keys[0].w2!==undefined)throw Error('ordinary edit adds compound data');
   const isoLeft=KB.key({...iso,x:2,y:3,angle:23}),isoRight=KB.key({x:8,y:3,label:'右回车'});
   Workshop.loadText(JSON.stringify({version:1,name:'异形镜像',keys:[isoLeft,isoRight],features:[],options:{...KB.defaults,mirrorAxis:5}}));
   selected=new Set([Workshop.getState().keys[0].id]);inspector();
   const compoundMirrorBefore=JSON.stringify(Workshop.getState());
   document.getElementById('mirrorSelection').click();
   const reflected=Workshop.getState().keys[1],compoundMirrorHistory=undoStack.length;
   if(reflected.x2!==0||reflected.w2!==1.5||reflected.y2!==0||reflected.angle!==-23||reflected.label!=='右回车')throw Error('compound mirror');
   document.getElementById('mirrorSelection').click();
   if(undoStack.length!==compoundMirrorHistory)throw Error('compound mirror no-op');
   undo();if(JSON.stringify(Workshop.getState())!==compoundMirrorBefore)throw Error('compound mirror undo');
   Workshop.loadText(JSON.stringify([{name:'KLE 异形键示例'},[{x:3,w:1.25,h:2,w2:1.5,h2:1,x2:-.25},'ISO Enter'],[{w:1.25,w2:1.75},'Caps Lock',{x:.5},'A']]));
   selected=new Set([Workshop.getState().keys[0].id]);inspector();fit();draw();
   const labelKey=Workshop.getState().keys[0],pixelRatio=window.devicePixelRatio||1;
   const labelPixels=ctx.getImageData(Math.round((camera.x+(labelKey.x-.3)*camera.scale)*pixelRatio),Math.round((camera.y+(labelKey.y-.12)*camera.scale)*pixelRatio),Math.round(.6*camera.scale*pixelRatio),Math.round(.24*camera.scale*pixelRatio)).data;
   if(!labelPixels.some((v,i)=>i%4===0&&v<150&&labelPixels[i+1]<170&&labelPixels[i+2]<150))throw Error('keycap text did not paint in WebKit');
   Workshop.loadText(JSON.stringify({version:1,name:'分体镜像校正验证',keys:outlierFixture.keys.map(k=>KB.key(k)),features:[],options:{...KB.defaults,mirrorAxis:outlierFixture.axis},image:null}));
   document.getElementById('selectLeftHalf').click();document.getElementById('mirrorSelection').click();fit();draw();
   document.getElementById('mirrorSelection').scrollIntoView({block:'nearest'});
   return {keys:42,entities:(dxf.match(/LWPOLYLINE/g)||[]).length,mirrorKeys:3,mirrorUndoRedo:true,projectRestore:true,failedMirrorPreserved:true,automaticAxis:true,outlierMirror:true,mirrorInlineFeedback:true,outlierUndoRedo:true,layoutDropdown:true,layoutTimestampTooltip:true,referenceOffByDefault:true,rename:true,layoutSwitch:true,machiningOptions:true,machiningUndo:true,cherrySpec:true,platePanels:true,sandwichCase:true,perKeyOverrides:true,automaticAngleSnap:true,angleSnapUndo:true,compoundHitAndDrag:true,compoundEditAndRestore:true,compoundRawData:true,compoundMirror:true,compoundLayoutArchive:true,invalidCompoundEditPreserved:true,keycapTextPainted:true,viewport:document.getElementById('canvas').width};
   """
   web.callAsyncJavaScript(script,arguments:[:],in:nil,in:.page){result in
      switch result {
      case .success(let data):
        print("PASS: \(data)")
        guard CommandLine.arguments.count>3 else {exit(0)}
        self.web.takeSnapshot(with:nil){image,error in
          guard let tiff=image?.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]) else {print("FAIL: snapshot \(String(describing:error))");exit(1)}
          do {try png.write(to:URL(fileURLWithPath:CommandLine.arguments[3]));print("Snapshot: \(CommandLine.arguments[3])");exit(0)} catch {print("FAIL: \(error)");exit(1)}
        }
      case .failure(let error):print("FAIL: \(error)");exit(1)
      }
   }
 }
}
let app=NSApplication.shared
let smoke=Smoke();app.delegate=smoke;app.setActivationPolicy(.accessory);app.run()
