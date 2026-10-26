(function(root){
  'use strict';
  const KB=typeof module!=='undefined'?require('./core'):root.KB;
  const FW=typeof module!=='undefined'?require('./firmware'):root.FW;
  const LIB=typeof module!=='undefined'?require('./kicad-library'):root.KiCadLibrary;
  const q=v=>JSON.stringify(String(v)),n=v=>Number(Number(v).toFixed(5));
  const defaults={module:'pico',switch:'mx',diode:'sod123',mounts:true};
  const gpioPads=Object.fromEntries(LIB.picoPins.filter(p=>/^GPIO\d+/.test(p.name)).map(p=>[Number(p.name.match(/^GPIO(\d+)/)[1]),p.number]));
  const children=(node,tag)=>node.filter(v=>Array.isArray(v)&&v[0]===tag),child=(node,tag)=>children(node,tag)[0];
  const value=atom=>String(atom).startsWith('"')?JSON.parse(atom):String(atom);
  // A bounded data parser, also used for the bundled official footprint files.
  function parse(source){
    if(typeof source!=='string'||source.length>25000000)throw Error('KiCad 文件过大。');
    const tokens=source.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g)||[];let i=0;
    function read(depth){if(depth>80||tokens[i++]!=='(')throw Error('KiCad 文件结构无效。');const out=[];while(i<tokens.length&&tokens[i]!==')')out.push(tokens[i]==='('?read(depth+1):tokens[i++]);if(tokens[i++]!==')')throw Error('KiCad 文件未闭合。');return out;}
    const out=read(0);if(i!==tokens.length)throw Error('KiCad 文件存在多余内容。');return out;
  }
  const pcbNet=name=>name.startsWith('unconnected-(')?name:'/'+name;
  const serialize=node=>Array.isArray(node)?'('+node.map(serialize).join(' ')+')':String(node);
  function uuid(text){const hashes=[2166136261,2246822507,3266489909,668265263].map(seed=>{for(const c of text)seed=Math.imul(seed^c.charCodeAt(0),16777619);return (seed>>>0).toString(16).padStart(8,'0');}).join('');return hashes.slice(0,8)+'-'+hashes.slice(8,12)+'-4'+hashes.slice(13,16)+'-a'+hashes.slice(17,20)+'-'+hashes.slice(20);}
  function options(raw={}){return {...defaults,...raw};}
  function validate(project,raw={}){
    const config=options(raw),errors=[],warnings=[],f=project?.firmware,keys=(project?.keys||[]).filter(k=>!k.decal),split=FW.isSplit(f);
    if(config.module!=='pico')errors.push('请选择 Raspberry Pi Pico 排针模块。');
    if(config.switch!=='mx')errors.push('首期支持 Cherry MX 五脚焊接开关。');
    if(!['sod123','do35'].includes(config.diode))errors.push('请选择支持的二极管封装。');
    if(typeof config.mounts!=='boolean')errors.push('固定孔选项无效。');
    if(Object.keys(config).some(k=>!Object.hasOwn(defaults,k)))errors.push('存在不支持的 KiCad 选项。');
    if(!f||f.controller!=='rp2040'||f.target!=='qmk')errors.push('首期 Pico 工程需要 QMK + 通用 RP2040（原生 GPIO）配置；其他主控的焊盘布局不同。');
    if(!keys.length||keys.length>500)errors.push('需要 1–500 个实体按键。');
    try{KB.checkKeys(project?.keys||[]);}catch(e){errors.push(e.message);}
    if(!Number.isInteger(f?.rows)||f.rows<1||f.rows>32||!Number.isInteger(f?.cols)||f.cols<1||f.cols>32)errors.push('请设置有效的矩阵行列数。');
    if(!['col2row','row2col'].includes(f?.diode))errors.push('请设置二极管扫描方向。');
    if(split&&f.split.pointing?.enabled)errors.push('首期尚未生成触控板电路与封装，暂不支持启用触控板的工程。');
    const slots=new Set();
    for(const k of keys){const m=k.fw;
      if(!m||!Number.isInteger(m.row)||!Number.isInteger(m.col)||m.row<0||m.row>=f?.rows||m.col<0||m.col>=f?.cols||split&&!['left','right'].includes(m.side)){errors.push(`按键 ${k.label||k.id} 尚未设置有效的所属侧和矩阵行列。`);continue;}
      const slot=[split?m.side:'single',m.row,m.col].join(':');if(slots.has(slot))errors.push(`矩阵地址 ${slot} 重复。`);slots.add(slot);
    }
    for(const side of split?['left','right']:['single']){
      if(split&&!keys.some(k=>k.fw?.side===side))errors.push(`${FW.sideName(side)}没有实体按键。`);
      const cfg=FW.sideConfig(f||{},side==='single'?'left':side)||{},used=new Map();
      const checkPin=(pin,net)=>{if(!Number.isInteger(pin)||!Object.hasOwn(gpioPads,pin))errors.push(`${side==='single'?'主控':FW.sideName(side)} ${net}：Pico 没有可用的 GP${pin??'（未分配）'} 排针焊盘。`);else if(used.has(pin))errors.push(`${FW.sideName(side)} GP${pin} 同时用于 ${used.get(pin)} 和 ${net}。`);else used.set(pin,net);};
      for(const [prop,count,prefix] of [['rowPins',f?.rows,'R'],['colPins',f?.cols,'C']]){
        if(!Array.isArray(cfg[prop])||cfg[prop].length!==count)errors.push(`${side} 的 ${prefix} GPIO 数量与矩阵不符。`);
        else cfg[prop].forEach((p,i)=>checkPin(p,prefix+i));
      }
      if(split){checkPin(f.split.serialPin,'分体 DATA / TX');if(FW.serialMode(f)==='full_duplex')checkPin(f.split.serialRxPin,'分体 RX');}
    }
    if(split&&project.options?.outline==='custom')errors.push('自定义 CAD 板框暂不支持拆分为左右 PCB；请切回左右分体自动板框后生成 KiCad 工程。');
    if(split&&project.options?.outline==='capture')errors.push('当前描绘轮廓只有一条，无法可靠拆成左右 PCB；请先选择左右分体或自动板框。');
    if(!errors.length)try{geometry(project,split?'left':'single',config);if(split)geometry(project,'right',config);}catch(e){errors.push(e.message);}
    warnings.push('PCB 为未布线草稿；主控和分体连接器在板框旁待摆放。需在 KiCad 完成布局、布线、丝印整理和 ERC / DRC。');
    if(keys.some(k=>Math.max(k.w,k.h)>=2))warnings.push('长键仅生成开关封装；卫星轴安装孔需按实际型号在 KiCad 中补齐。');
    if(project.features?.length)warnings.push('自定义模块开孔作为 Dwgs.User 参考线；圆形固定孔可按选项生成 NPTH。');
    if(split)warnings.push('分体接口使用 1×4、2.54 mm 排针：1 GND、2 VSYS、3/4 通信。接线表包含全双工 TX/RX 对调；供电只选一侧 USB，需另行核对供电保护。');
    return {errors:[...new Set(errors)],warnings,config,keyCount:keys.length,boardCount:split?2:1};
  }
  function geometry(project,side,config){
    const split=side!=='single',keys=project.keys.filter(k=>!k.decal&&(!split||k.fw?.side===side));
    const opts={...KB.defaults,...project.options,kerf:0,caseType:'none',mountHoles:config.mounts?(project.options?.mountHoles||0):0};
    if(opts.outline==='custom')opts.cadGeometry={...opts.cadGeometry,replaceHoles:false,holes:[]};
    if(split&&opts.outline==='split')opts.outline='hull';
    const candidates=project.keys.filter(k=>!split||!k.decal&&k.fw?.side===side||k.decal&&k.plateOutline&&((k.x<KB.symmetryAxis(project.keys))===(side==='left')));
    const base=KB.plate(candidates,opts,[]);
    if(base.outlines.length!==1)throw Error('每份 PCB 工程需要一条独立板框；单体工程请改用单体外框。');
    if(base.errors.length)throw Error('板框或固定孔无效：'+base.errors[0]);
    if(base.parts[0].holes.some(h=>h.layer==='OUTLINE'))throw Error('KiCad 暂不支持板框内部空区切割；请改用凸包、矩形或 CAD 边框。');
    const outline=base.outlines[0],bounds=KB.bounds(outline),offset={x:30-bounds.x,y:30-bounds.y};
    const features=(project.features||[]).filter(f=>KB.inside({x:f.x,y:f.y},outline));
    const mounts=config.mounts?[...base.circles.filter(c=>c.auto),...features.filter(f=>f.type==='circle').map(f=>({x:f.x,y:f.y,r:f.w/2,source:f.name}))]:[];
    for(const c of mounts)if(c.r<=0||!Number.isFinite(c.r)||![0,90,180,270].every(a=>{const d=KB.rotate(c.r,c.r,a);return KB.inside({x:c.x+d.x,y:c.y+d.y},outline);}))throw Error('固定孔超出 PCB 板框，请调整位置或孔径。');
    return {keys,outline,bounds,offset,mounts,features,pitch:opts.pitch,pitchY:opts.pitchY??opts.pitch};
  }
  function model(project,side,config){
    const f=project.firmware,g=geometry(project,side,config),prefix=side==='single'?'':side+'_',name=(/^[a-z][a-z0-9_]{0,63}$/.test(f.id)?f.id:'keyboard')+'_'+(side==='single'?'pcb':side),rootId=uuid(name+'/sheet');
    const m={name,side,rootId,config,geometry:g,components:[],nets:new Map(),mapping:[],warnings:[]};
    const net=name=>{if(!m.nets.has(name))m.nets.set(name,m.nets.size+1);return name;};
    const component=(ref,lib,value,nets,pcb,sch,key=null)=>{const c={ref,lib,value,nets:Object.fromEntries(Object.entries(nets).map(([p,v])=>[p,v?net(v):null])),pcb,sch,uuid:uuid(name+'/'+ref+'/'+(key?.id||'')),key};m.components.push(c);return c;};
    const keys=g.keys.slice().sort((a,b)=>a.fw.row-b.fw.row||a.fw.col-b.fw.col||a.id.localeCompare(b.id));
    for(const [i,k] of keys.entries()){
      const ref=i+1,r=k.fw.row,c=k.fw.col,x=k.x*g.pitch+g.offset.x,y=k.y*g.pitchY+g.offset.y,angle=k.angle+(k.cutoutRotation||0),displayCol=side==='right'?f.cols-1-c:c,sx=45.72+(displayCol%10)*76.2,sy=40.64+(r+Math.floor(displayCol/10)*(f.rows+1))*30.48;
      const row=prefix+'ROW'+r,col=prefix+'COL'+c,link=prefix+'KEY'+ref,delta=KB.rotate(0,8,angle),col2row=f.diode==='col2row';
      component('SW'+ref,'MX',k.label||'MX',{'1':row,'2':link},{x,y,angle},{x:sx,y:sy,angle:0},k);
      component('D'+ref,config.diode==='sod123'?'SOD123':'DO35','1N4148'+(config.diode==='sod123'?'W':''),{'1':col2row?link:col,'2':col2row?col:link},{x:x+delta.x,y:y+delta.y,angle},{x:sx+22.86,y:sy,angle:col2row?0:180});
      m.mapping.push({reference:'SW'+ref,diode:'D'+ref,keyId:k.id,label:k.label,row:r,col:c,x:n(x),y:n(y),angle:n(angle),rowNet:row,colNet:col});
    }
    const cfg=FW.sideConfig(f,side==='single'?'left':side),moduleNets={},pinMap=[];
    for(const [pins,kind] of [[cfg.rowPins,'ROW'],[cfg.colPins,'COL']])pins.forEach((p,i)=>{const name=prefix+kind+i;moduleNets[gpioPads[p]]=name;pinMap.push({net:name,gpio:'GP'+p,pad:gpioPads[p]});});
    for(const p of LIB.picoPins)if(p.name==='GND')moduleNets[p.number]='GND';
    if(side!=='single'){
      moduleNets[39]='VSYS';
      const full=FW.serialMode(f)==='full_duplex';
      const tx=full?(side==='left'?'LEFT_TX_RIGHT_RX':'LEFT_RX_RIGHT_TX'):'SPLIT_DATA',rx=side==='left'?'LEFT_RX_RIGHT_TX':'LEFT_TX_RIGHT_RX';
      moduleNets[gpioPads[f.split.serialPin]]=tx;pinMap.push({net:tx,gpio:'GP'+f.split.serialPin,pad:gpioPads[f.split.serialPin]});
      if(full){moduleNets[gpioPads[f.split.serialRxPin]]=rx;pinMap.push({net:rx,gpio:'GP'+f.split.serialRxPin,pad:gpioPads[f.split.serialRxPin]});}
      component('J1','Header4','SPLIT',{'1':'GND','2':'VSYS','3':full?'LEFT_TX_RIGHT_RX':'SPLIT_DATA','4':full?'LEFT_RX_RIGHT_TX':null},{x:g.bounds.w+75,y:40,angle:0},{x:116.84+Math.min(f.cols,10)*76.2,y:152.4,angle:0});
    }
    component('U1','Pico','Raspberry Pi Pico',moduleNets,{x:g.bounds.w+50,y:40,angle:0},{x:116.84+Math.min(f.cols,10)*76.2,y:81.28,angle:0});
    // KiCad gives NC pins individual named nets; preserve them for schematic parity.
    for(const c of m.components){c.pcbNets={};for(const p of symbolPins(symbolType(c))){
      c.pcbNets[p.number]=c.nets[p.number]||net(`unconnected-(${c.ref}-${p.name&&p.name!=='~'?p.name+'-':''}Pad${p.number})`);
    }}
    m.pinMap=pinMap;
    return m;
  }
  const font=(size=1.27,extra='')=>`(effects (font (size ${size} ${size})) ${extra})`;
  function librarySymbol(name,pins,shape){return `(symbol ${q('Workshop:'+name)} ${name==='PowerFlag'?'(power)':''} (pin_names (offset 0.5)) (in_bom ${name==='PowerFlag'?'no':'yes'}) (on_board ${name==='PowerFlag'?'no':'yes'})
    (property "Reference" ${q(name==='Switch'?'SW':name==='Diode'?'D':name==='Pico'?'U':name==='PowerFlag'?'#FLG':'J')} (at 0 5.08 0) ${font()})
    (property "Value" ${q(name)} (at 0 -5.08 0) ${font()})
    (property "Footprint" "" (at 0 0 0) ${font(1.27,'(hide yes)')})
    (symbol ${q(name+'_0_1')} ${shape}) (symbol ${q(name+'_1_1')}
    ${pins.map(p=>`(pin ${p.type||'passive'} line (at ${p.x} ${p.y} ${p.angle||0}) (length ${p.length??2.54}) (name ${q(p.name||'~')} ${font(1)}) (number ${q(p.number)} ${font(1)}))`).join('\n')}))`;}
  const switchPins=[{number:1,x:-5.08,y:0},{number:2,x:5.08,y:0,angle:180}];
  const diodePins=[{number:1,name:'K',x:-3.81,y:0},{number:2,name:'A',x:3.81,y:0,angle:180}];
  const picoPins=LIB.picoPins.map(p=>({...p,x:p.number<=20?-20.32:20.32,y:p.number<=20?24.13-(p.number-1)*2.54:24.13-(40-p.number)*2.54,angle:p.number<=20?0:180,length:5.08}));
  const flagPins=[{number:1,name:'pwr',type:'power_out',x:0,y:0,length:0}];
  const headerPins=Array.from({length:4},(_,i)=>({number:i+1,x:-7.62,y:3.81-i*2.54,length:2.54}));
  const stroke='(stroke (width 0.254) (type default))',fill='(fill (type none))';
  const symbols={
    Switch:librarySymbol('Switch',switchPins,`(circle (center -2.54 0) (radius 0.5) ${stroke} ${fill}) (circle (center 2.54 0) (radius 0.5) ${stroke} ${fill}) (polyline (pts (xy -2.54 0.5) (xy 2.54 2.54)) ${stroke} ${fill})`),
    Diode:librarySymbol('Diode',diodePins,`(polyline (pts (xy -1.27 -1.27) (xy -1.27 1.27)) ${stroke} ${fill}) (polyline (pts (xy -1.27 0) (xy 1.27 1.27) (xy 1.27 -1.27) (xy -1.27 0)) ${stroke} ${fill})`),
    Pico:librarySymbol('Pico',picoPins,`(rectangle (start -15.24 26.67) (end 15.24 -26.67) ${stroke} (fill (type background)))`),
    PowerFlag:librarySymbol('PowerFlag',flagPins,`(polyline (pts (xy 0 0) (xy 0 2.54) (xy -1.27 3.81) (xy 0 5.08) (xy 1.27 3.81) (xy 0 2.54)) ${stroke} ${fill})`),
    Header:librarySymbol('Header',headerPins,`(rectangle (start -5.08 5.08) (end 2.54 -5.08) ${stroke} (fill (type background)))`)
  };
  const symbolType=c=>c.lib==='MX'?'Switch':c.lib==='Pico'?'Pico':c.lib==='Header4'?'Header':c.lib==='PowerFlag'?'PowerFlag':'Diode';
  const symbolPins=type=>({Switch:switchPins,Diode:diodePins,Pico:picoPins,Header:headerPins,PowerFlag:flagPins}[type]);
  function schematic(m,f){
    const components=m.components.slice();
    if(m.side!=='single')components.push({ref:'#FLG01',lib:'PowerFlag',value:'USB_VSYS',nets:{1:'VSYS'},sch:{x:116.84+Math.min(f.cols,10)*76.2,y:175.26},uuid:uuid(m.name+'/powerflag')});
    const out=[],used=new Set(components.map(symbolType)),sid=key=>q(uuid(m.name+'/sch/'+key));
    const width=Math.max(420,180+Math.min(f.cols,10)*76.2),height=Math.max(297,90+(f.rows+1)*Math.ceil(f.cols/10)*30.48);
    for(const c of components){const type=symbolType(c),s=c.sch,a=s.angle||0;
      const props=(name,val,x,y,hidden=false)=>`(property ${q(name)} ${q(val)} (at ${n(x)} ${n(y)} 0) ${font(1.27,hidden?'(hide yes)':'')})`;
      out.push(`(symbol (lib_id ${q('Workshop:'+type)}) (at ${s.x} ${s.y} ${a}) (unit 1) (in_bom ${type==='PowerFlag'?'no':'yes'}) (on_board ${type==='PowerFlag'?'no':'yes'}) (dnp no) (uuid ${q(c.uuid)})
        ${props('Reference',c.ref,s.x,s.y-(type==='Pico'?32:5.08))} ${props('Value',c.value,s.x,s.y+(type==='Pico'?32:5.08))}
        ${props('Footprint',type==='PowerFlag'?'':'Workshop:'+c.lib,s.x,s.y,true)}
        ${symbolPins(type).map(p=>`(pin ${q(p.number)} (uuid ${sid(c.ref+'/pin/'+p.number)}))`).join('\n')}
        (instances (project ${q(m.name)} (path ${q('/'+m.rootId)} (reference ${q(c.ref)}) (unit 1)))))`);
      for(const p of symbolPins(type)){
        const pos=KB.rotate(p.x,-p.y,-a),x=n(s.x+pos.x),y=n(s.y+pos.y),net=c.nets[p.number];
        if(!net){out.push(`(no_connect (at ${x} ${y}) (uuid ${sid(c.ref+'/nc/'+p.number)}))`);continue;}
        // Join each switch to its diode with a real wire and one net label.
        if(/(?:^|_)KEY\d+$/.test(net)){
          if(type==='Switch'){
            const end=n(s.x+22.86-3.81);
            out.push(`(wire (pts (xy ${x} ${y}) (xy ${end} ${y})) (stroke (width 0.1524) (type default)) (uuid ${sid(c.ref+'/keywire')}))`);
            out.push(`(label ${q(net)} (at ${x} ${y} 0) ${font(1,'(justify left bottom)')} (uuid ${sid(c.ref+'/keylabel')}))`);
          }
          continue;
        }
        // Outward labels keep matrix and GPIO names clear of the symbols.
        const left=x<s.x,ex=n(x+(left?-5.08:5.08));
        out.push(`(wire (pts (xy ${x} ${y}) (xy ${ex} ${y})) (stroke (width 0.1524) (type default)) (uuid ${sid(c.ref+'/wire/'+p.number)}))`);
        out.push(`(label ${q(net)} (at ${ex} ${y} ${left?180:0}) ${font(1,'(justify '+(left?'right':'left')+' bottom)')} (uuid ${sid(c.ref+'/label/'+p.number)}))`);
      }
    }
    out.push(`(text "UNROUTED DRAFT - Verify module, power and ERC/DRC before manufacture" (at 25 20 0) ${font(1.5,'(justify left)')} (uuid ${sid('notice')}))`);
    return `(kicad_sch (version 20250114) (generator "keyboard_workshop") (uuid ${q(m.rootId)}) (paper "User" ${width} ${height})
      (title_block (title ${q(m.name+' - matrix draft')})) (lib_symbols ${[...used].map(t=>symbols[t]).join('\n')})
      ${out.join('\n')} (sheet_instances (path "/" (page "1"))) (embedded_fonts no))\n`;
  }
  function strip(node,tags){return node.filter(v=>!Array.isArray(v)||!tags.includes(v[0]));}
  function footprintLibrary(lib){let fp=parse(LIB.footprints[lib]);fp[1]=q(lib);fp=strip(fp,['model']);return fp;}
  function footprint(c,m){
    let fp=strip(footprintLibrary(c.lib),['version','generator','generator_version','uuid','at']);fp[1]=q('Workshop:'+c.lib);
    // KiCad uses counter-clockwise footprint angles. Its MX origin is at pad 1;
    // the actual switch centre in the official footprint is (-2.54, 5.08).
    const center=c.lib==='MX'?{x:-2.54,y:5.08}:c.lib==='DO35'?{x:3.81,y:0}:{x:0,y:0};
    const a=n(-c.pcb.angle),offset=KB.rotate(center.x,center.y,c.pcb.angle),x=n(c.pcb.x-offset.x),y=n(c.pcb.y-offset.y);
    let sequence=0;function freshUUIDs(node){for(const v of node)if(Array.isArray(v)){if(v[0]==='uuid')v[1]=q(uuid(m.name+'/'+c.ref+'/fp/'+sequence++));else freshUUIDs(v);}}freshUUIDs(fp);
    for(const p of children(fp,'property')){const key=value(p[1]);if(key==='Reference')p[2]=q(c.ref);if(key==='Value')p[2]=q(c.value);}
    for(const pad of children(fp,'pad')){const number=value(pad[1]),net=c.pcbNets[number];if(net)pad.push(['net',String(m.nets.get(net)),q(pcbNet(net))]);}
    fp.push(['at',String(x),String(y),String(a)],['uuid',q(uuid(m.name+'/'+c.ref+'/footprint'))],['path',q('/'+m.rootId+'/'+c.uuid)],['sheetname',q('')],['sheetfile',q(m.name+'.kicad_sch')]);
    return serialize(fp);
  }
  function pcb(m){
    const g=m.geometry,out=[],uid=s=>q(uuid(m.name+'/pcb/'+s)),at=p=>({x:n(p.x+g.offset.x),y:n(p.y+g.offset.y)});
    const line=(p1,p2,layer,key)=>{const a=at(p1),b=at(p2);return `(gr_line (start ${a.x} ${a.y}) (end ${b.x} ${b.y}) (stroke (width 0.05) (type default)) (layer ${q(layer)}) (uuid ${uid(key)}))`;};
    g.outline.forEach((p,i)=>out.push(line(p,g.outline[(i+1)%g.outline.length],'Edge.Cuts','edge/'+i)));
    for(const [i,f] of g.features.entries())if(f.type==='rect'){const pts=KB.rectangle(f.x,f.y,f.w,f.h,f.angle);pts.forEach((p,j)=>out.push(line(p,pts[(j+1)%pts.length],'Dwgs.User','feature/'+i+'/'+j)));}
    for(const [i,h] of g.mounts.entries()){const p=at(h);out.push(`(footprint "Workshop:MountingHole" (layer "F.Cu") (at ${p.x} ${p.y}) (uuid ${uid('mount/'+i)}) (attr board_only exclude_from_pos_files exclude_from_bom) (pad "" np_thru_hole circle (at 0 0) (size ${n(h.r*2)} ${n(h.r*2)}) (drill ${n(h.r*2)}) (layers "*.Cu" "*.Mask") (uuid ${uid('mountpad/'+i)})))`);}
    out.push(`(gr_text "UNROUTED - MOVE U1 / J1 INSIDE BOARD" (at ${n(g.bounds.w+60)} 25) (layer "Dwgs.User") (effects (font (size 1 1) (thickness 0.15))) (uuid ${uid('notice')}))`);
    return `(kicad_pcb (version 20241229) (generator "keyboard_workshop") (general (thickness 1.6)) (paper "A3")
      (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (32 "B.Adhes" user "B.Adhesive") (33 "F.Adhes" user "F.Adhesive") (34 "B.Paste" user) (35 "F.Paste" user) (36 "B.SilkS" user "B.Silkscreen") (37 "F.SilkS" user "F.Silkscreen") (38 "B.Mask" user) (39 "F.Mask" user) (40 "Dwgs.User" user "User.Drawings") (41 "Cmts.User" user "User.Comments") (44 "Edge.Cuts" user) (46 "B.CrtYd" user "B.Courtyard") (47 "F.CrtYd" user "F.Courtyard") (48 "B.Fab" user) (49 "F.Fab" user))
      (setup (pad_to_mask_clearance 0)) (net 0 "") ${[...m.nets].map(([name,id])=>`(net ${id} ${q(pcbNet(name))})`).join('\n')}
      ${m.components.map(c=>footprint(c,m)).join('\n')} ${out.join('\n')} (embedded_fonts no))\n`;
  }
  const csv=rows=>'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
  function generate(project,raw={}){
    const check=validate(project,raw);if(check.errors.length)return {root:'keyboard-kicad',files:[],models:[],...check};
    const sides=FW.isSplit(project.firmware)?['left','right']:['single'],models=sides.map(side=>model(project,side,check.config)),files=[],add=(path,content)=>files.push({path,content});
    for(const m of models){const dir=m.side==='single'?'':m.side+'/',libs=[...new Set(m.components.map(c=>c.lib))];
      add(dir+m.name+'.kicad_sch',schematic(m,project.firmware));add(dir+m.name+'.kicad_pcb',pcb(m));
      add(dir+m.name+'.kicad_pro',JSON.stringify({meta:{filename:m.name+'.kicad_pro',version:1},net_settings:{classes:[{name:'Default',clearance:0.2,track_width:0.25,via_diameter:0.6,via_drill:0.3}],meta:{version:3}}},null,2)+'\n');
      add(dir+'fp-lib-table','(fp_lib_table (version 7) (lib (name "Workshop") (type "KiCad") (uri "${KIPRJMOD}/Workshop.pretty") (options "") (descr "Bundled KiCad 9 footprints")))\n');
      for(const lib of libs)add(dir+'Workshop.pretty/'+lib+'.kicad_mod',serialize(footprintLibrary(lib))+'\n');
      const used=[...new Set(m.components.map(symbolType))];if(m.side!=='single')used.push('PowerFlag');add(dir+'Workshop.kicad_sym','(kicad_symbol_lib (version 20241209) (generator "keyboard_workshop") '+used.map(t=>symbols[t].replace(q('Workshop:'+t),q(t))).join('\n')+')\n');
      add(dir+'sym-lib-table','(sym_lib_table (version 7) (lib (name "Workshop") (type "KiCad") (uri "${KIPRJMOD}/Workshop.kicad_sym") (options "") (descr "Keyboard Workshop symbols")))\n');
      add(dir+'key-map.csv',csv([['Switch','Diode','Label','Key ID','Row','Column','X mm','Y mm','Clockwise angle','Row net','Column net'],...m.mapping.map(k=>[k.reference,k.diode,k.label,k.keyId,k.row,k.col,k.x,k.y,k.angle,k.rowNet,k.colNet])]));
      add(dir+'pin-map.csv',csv([['Net','Pico GPIO','Physical pad'],...m.pinMap.map(p=>[p.net,p.gpio,p.pad])]));
      add(dir+'bom.csv',csv([['Reference','Value','Footprint'],...m.components.map(c=>[c.ref,c.value,'Workshop:'+c.lib])]));
    }
    add('source.keyboard.json',JSON.stringify({...project,image:null,eda:check.config},null,2)+'\n');
    add('LIBRARY-LICENSE.md','KiCad library contributors · version 9.0.0\n\n'+Object.values(LIB.sources).join('\n')+'\n\n'+LIB.license);
    add('README.md',`# ${project.name||'键盘'} · KiCad 工程草稿\n\n使用 KiCad 9 或更新版本打开各目录的 .kicad_pro。原理图和 PCB 可独立打开；封装及符号库已随工程提供，不需要在线下载。\n\n## 生成内容\n\n- Raspberry Pi Pico（RP2040，排针安装），Cherry MX 五脚焊接开关，${check.config.diode==='sod123'?'1N4148W / SOD-123':'1N4148 / DO-35，7.62 mm 跨距'}。\n- 每键一个开关和二极管；${project.firmware.diode.toUpperCase()}；二极管焊盘 1 为阴极 K，2 为阳极 A。\n- PCB 从顶面观察，保留真实毫米键距、中心、键位角度和轴孔旋转。分体两侧分别生成独立工程，不做背面镜像。\n- 板框不使用激光切缝补偿；不把定位板方形轴孔切进 PCB。圆形固定孔按设置生成 NPTH，自定义矩形开孔在 Dwgs.User 作参考。\n- key-map.csv 对应每个按键与位号，pin-map.csv 区分 GPIO 与 Pico 实际焊盘；source.keyboard.json 记录生成时的配置（不含截图）。\n\n## 接下来\n\n${check.warnings.map(w=>'- '+w).join('\n')}\n- 分体 VSYS 的电源标记表示由单侧 USB 经 Pico 板载电源电路供电；AGND 和不用的引脚保留 NC。禁止双侧同时接 USB 时直接互连 VSYS。\n- 原理图以同名网络标签连接；PCB 内已写入网络、封装和符号对应路径，未生成铜线、过孔或铺铜。\n- 在原理图编辑器运行 ERC，在 PCB 编辑器运行 DRC；未布线连接和板框外元件需要人工处理。本工具的生成前检查不是 KiCad ERC / DRC，也不是硬件验证。\n- 不要直接投板；先核对所购模块、二极管极性、长键卫星轴、供电及所有孔位。\n- 重新导出会创建新目录，不合并或覆盖 KiCad 中的人工编辑。\n- 嘉立创 EDA 导入兼容性尚未验证，首期以 KiCad 工程为交付目标。\n`);
    return {root:(/^[a-z][a-z0-9_]{0,63}$/.test(project.firmware.id)?project.firmware.id:'keyboard')+'-kicad',files,models,...check};
  }
  const api={defaults,options,validate,generate,gpioPads,parse,serialize,children,child,value};
  if(typeof module!=='undefined')module.exports=api;else root.KiCadExport=api;
})(typeof window!=='undefined'?window:globalThis);
