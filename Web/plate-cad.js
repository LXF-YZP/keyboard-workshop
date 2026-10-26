// Millimetre CAD geometry. Positive Y points down; bulges follow that coordinate system.
(function(root){
  'use strict';
  const EPS=1e-6,JOIN=.001,MAX=2000;
  const copy=v=>JSON.parse(JSON.stringify(v));
  const uid=()=>`cad-${Math.random().toString(36).slice(2,12)}`;
  const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const add=(a,b,t=1)=>({x:a.x+b.x*t,y:a.y+b.y*t});
  const dot=(a,b)=>a.x*b.x+a.y*b.y,cross=(a,b)=>a.x*b.y-a.y*b.x;
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const unit=v=>{const n=Math.hypot(v.x,v.y);if(n<EPS)throw Error('线段长度不能为零。');return{x:v.x/n,y:v.y/n};};
  const number=(v,name)=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100000)throw Error(`${name} 无效或超出 100000 mm 范围。`);return v;};
  const point=p=>({x:number(p?.x,'X'),y:number(p?.y,'Y')});
  const area=p=>p.reduce((s,a,i)=>s+cross(a,p[(i+1)%p.length]),0)/2;
  function entity(e){const a=point(e.a),b=point(e.b),bulge=e.bulge??0;number(bulge,'圆弧');if(dist(a,b)<EPS)throw Error('线段长度不能为零。');if(Math.abs(bulge)>1000)throw Error('圆弧夹角过大，请拆分圆弧。');return {id:String(e.id||uid()),a,b,bulge,layer:String(e.layer||'OUTLINE').replace(/[^\w\u4e00-\u9fff-]/g,'_').slice(0,60)};}
  function entities(list){if(!Array.isArray(list)||list.length>MAX)throw Error(`最多支持 ${MAX} 条线或圆弧。`);const out=list.map(entity);if(new Set(out.map(e=>e.id)).size!==out.length)throw Error('线段编号重复。');return out;}
  function arc(e){const d=sub(e.b,e.a),c=Math.hypot(d.x,d.y),sweep=4*Math.atan(e.bulge),h=c/(2*Math.tan(sweep/2)),center={x:(e.a.x+e.b.x)/2-d.y/c*h,y:(e.a.y+e.b.y)/2+d.x/c*h};return {center,r:dist(center,e.a),start:Math.atan2(e.a.y-center.y,e.a.x-center.x),sweep};}
  function sample(e){if(!e.bulge)return [e.a,e.b];const g=arc(e),step=Math.min(Math.PI/24,2*Math.acos(Math.max(-1,1-.02/g.r))),n=Math.max(2,Math.min(512,Math.ceil(Math.abs(g.sweep)/Math.max(step,.0001))));return Array.from({length:n+1},(_,i)=>i===0?e.a:i===n?e.b:{x:g.center.x+g.r*Math.cos(g.start+g.sweep*i/n),y:g.center.y+g.r*Math.sin(g.start+g.sweep*i/n)});}
  const fromPath=(p,layer='OUTLINE')=>p.map((a,i)=>entity({a,b:p[(i+1)%p.length],bulge:a.bulge||0,layer}));
  const flatten=p=>fromPath(p).flatMap(e=>sample(e).slice(0,-1));
  function offset(e,d){e=entity(e);number(d,'偏移距离');if(e.bulge)throw Error('复制偏移目前支持直线，请选择一条直线。');if(Math.abs(d)<EPS)throw Error('偏移距离不能为零。');const u=unit(sub(e.b,e.a)),n={x:-u.y,y:u.x};return entity({...e,id:uid(),a:add(e.a,n,d),b:add(e.b,n,d)});}
  function extend(e,d,end='b'){e=entity(e);number(d,'延长距离');if(e.bulge)throw Error('延长目前支持直线。');if(d<=0)throw Error('延长距离必须大于零。');if(!['a','b','both'].includes(end))throw Error('请选择延长的端点。');const u=unit(sub(e.b,e.a));if(end!=='b')e.a=add(e.a,u,-d);if(end!=='a')e.b=add(e.b,u,d);return entity(e);}
  function intersection(a,b){if(a.bulge||b.bulge)throw Error('请选中两条直线。');const u=sub(a.b,a.a),v=sub(b.b,b.a),c=cross(u,v);if(Math.abs(c)<EPS*Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y))throw Error('两条线平行或重合，不能连接。');return add(a.a,u,cross(sub(b.a,a.a),v)/c);}
  function corner(a,b,r=0){a=entity(a);b=entity(b);number(r,'圆角半径');if(r<0)throw Error('圆角半径不能为负。');const p=intersection(a,b);
    // Keep the farther endpoint on each line, trim/extend the near endpoint.
    const endA=dist(a.a,p)<dist(a.b,p)?'a':'b',endB=dist(b.a,p)<dist(b.b,p)?'a':'b';
    const farA=a[endA==='a'?'b':'a'],farB=b[endB==='a'?'b':'a'],u=unit(sub(farA,p)),v=unit(sub(farB,p));
    const angle=Math.acos(Math.max(-1,Math.min(1,dot(u,v))));if(angle<EPS||Math.PI-angle<EPS)throw Error('两条线不能形成有效转角。');
    const t=r/Math.tan(angle/2);if(t>=Math.min(dist(farA,p),dist(farB,p))-EPS)throw Error('圆角半径太大，切点超出了保留的线段。');
    const q=add(p,u,t),s=add(p,v,t);a[endA]=q;b[endB]=s;
    const result=[entity(a),entity(b)];if(r>0)result.push(entity({a:q,b:s,bulge:-Math.sign(cross(u,v))*Math.tan((Math.PI-angle)/4),layer:a.layer}));return result;
  }
  function distance(p,e){const pts=sample(e);let best=Infinity;for(let i=1;i<pts.length;i++){const a=pts[i-1],v=sub(pts[i],a),l=dot(v,v),t=l?Math.max(0,Math.min(1,dot(sub(p,a),v)/l)):0;best=Math.min(best,dist(p,add(a,v,t)));}return best;}
  function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
  function touches(a,b,c,d){if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-EPS||Math.max(c.x,d.x)<Math.min(a.x,b.x)-EPS||Math.max(a.y,b.y)<Math.min(c.y,d.y)-EPS||Math.max(c.y,d.y)<Math.min(a.y,b.y)-EPS)return false;const ab=sub(b,a),cd=sub(d,c);return cross(ab,sub(c,a))*cross(ab,sub(d,a))<=EPS&&cross(cd,sub(a,c))*cross(cd,sub(b,c))<=EPS;}
  function validatePath(path){if(!Array.isArray(path)||path.length<2||path.length>MAX)throw Error('轮廓必须包含至少两段线或圆弧。');const p=path.map(v=>({...point(v),bulge:number(v.bulge??0,'圆弧')})),es=fromPath(p),flat=es.flatMap(e=>sample(e).slice(0,-1));if(flat.length>12000)throw Error('轮廓过于复杂，请先在 CAD 中简化。');if(Math.abs(area(flat))<.001)throw Error('闭合轮廓面积不能为零。');for(let i=0;i<flat.length;i++)for(let j=i+2;j<flat.length;j++){if(i===0&&j===flat.length-1)continue;if(touches(flat[i],flat[(i+1)%flat.length],flat[j],flat[(j+1)%flat.length]))throw Error('轮廓存在自交或重叠，请先修剪线段。');}return p;}
  function assemble(input){const es=entities(input);if(!es.length)throw Error('没有可应用的线段。');const nodes=[],links=[];
    const node=p=>{const found=nodes.findIndex(n=>dist(n.p,p)<=JOIN);if(found>=0)return found;nodes.push({p,edges:[]});return nodes.length-1;};
    es.forEach((e,i)=>{const a=node(e.a),b=node(e.b);if(a===b)throw Error('存在过短线段。');links.push([a,b]);nodes[a].edges.push(i);nodes[b].edges.push(i);});
    if(nodes.some(n=>n.edges.length!==2))throw Error('边框尚未闭合或存在分叉。请删除多余原线，用“两线接角”连接端点；端点容差为 0.001 mm。');
    const used=new Set(),paths=[];for(let first=0;first<es.length;first++){if(used.has(first))continue;let n=links[first][0],i=first,start=n,path=[];do{if(used.has(i))throw Error('轮廓连接顺序无效。');used.add(i);const forward=links[i][0]===n,e=es[i];path.push({...nodes[n].p,bulge:forward?e.bulge:-e.bulge});n=links[i][forward?1:0];i=nodes[n].edges.find(j=>!used.has(j));}while(n!==start&&i!==undefined);if(n!==start)throw Error('存在未闭合轮廓。');paths.push({path:validatePath(path),layer:es[first].layer});}return paths;
  }
  function classify(paths){const polys=paths.map(p=>flatten(p.path));if(polys.reduce((n,p)=>n+p.length,0)>16000)throw Error('图形过于复杂，请简化后再导入。');const depths=polys.map((p,i)=>polys.filter((q,j)=>i!==j&&inside(p[0],q)).length);for(let i=0;i<polys.length;i++)for(let j=i+1;j<polys.length;j++)for(let a=0;a<polys[i].length;a++)for(let b=0;b<polys[j].length;b++)if(touches(polys[i][a],polys[i][(a+1)%polys[i].length],polys[j][b],polys[j][(b+1)%polys[j].length]))throw Error('不同轮廓相交或相切，无法区分板框和开孔。');if(depths.some(d=>d>1))throw Error('不支持孔内孤岛，请拆分为独立定位板文件。');return {outlines:paths.filter((_,i)=>depths[i]===0).map(p=>p.path),holes:paths.filter((_,i)=>depths[i]===1).map(p=>({layer:['SWITCH','STABILIZER','MODULE','MOUNT'].includes(p.layer)?p.layer:'MODULE',path:p.path}))};}
  function normalizeGeometry(g){if(!g||!Array.isArray(g.outlines)||!g.outlines.length||g.outlines.length>40||!Array.isArray(g.holes)||g.holes.length>1000)throw Error('自定义定位板数据无效。');const outlines=g.outlines.map(validatePath),holes=g.holes.map(h=>({layer:['SWITCH','STABILIZER','MODULE','MOUNT'].includes(h.layer)?h.layer:'MODULE',path:validatePath(h.path)}));if([...outlines,...holes.map(h=>h.path)].reduce((n,p)=>n+p.length,0)>MAX)throw Error(`定位板最多支持 ${MAX} 条线或圆弧。`);return {outlines,holes,replaceHoles:g.replaceHoles===true,source:String(g.source||'自定义边框').slice(0,120)};}
  // Parallel offsets retain circular arcs; intersections trim adjacent primitives.
  function offsetPath(path,d){
    const p=validatePath(path);if(!d)return copy(p);number(d,'偏移距离');const winding=Math.sign(area(flatten(p)));
    const original=fromPath(p);const moved=original.map((e,i)=>{if(!e.bulge){const u=unit(sub(e.b,e.a)),n={x:winding*u.y,y:-winding*u.x};return {...e,origin:e.a,a:add(e.a,n,d),b:add(e.b,n,d)};}const g=arc(e),r=g.r+Math.sign(g.sweep)*winding*d;if(r<=EPS){const prev=original[(i+original.length-1)%original.length],next=original[(i+1)%original.length];if(!prev.bulge&&!next.bulge&&Math.abs(dot(unit(sub(prev.b,prev.a)),unit(sub(e.a,g.center))))<1e-5&&Math.abs(dot(unit(sub(next.b,next.a)),unit(sub(e.b,g.center))))<1e-5)return null;throw Error('偏移距离超过圆弧半径。');}return {...e,origin:e.a,a:add(g.center,sub(e.a,g.center),r/g.r),b:add(g.center,sub(e.b,g.center),r/g.r),circle:{...g,r}};}).filter(Boolean);if(moved.length<2)throw Error('偏移后轮廓消失。');
    function hits(a,b){
      if(!a.circle&&!b.circle)return [intersection(a,b)];
      if(!a.circle||!b.circle){const line=a.circle?b:a,g=(a.circle?a:b).circle,v=sub(line.b,line.a),w=sub(line.a,g.center),A=dot(v,v),B=2*dot(w,v),C=dot(w,w)-g.r*g.r,D=B*B-4*A*C;if(D<-EPS)return [];return [(-B+Math.sqrt(Math.max(0,D)))/(2*A),(-B-Math.sqrt(Math.max(0,D)))/(2*A)].map(t=>add(line.a,v,t));}
      const g=a.circle,h=b.circle,v=sub(h.center,g.center),l=Math.hypot(v.x,v.y);if(l<EPS)return [];const x=(g.r*g.r-h.r*h.r+l*l)/(2*l),y2=g.r*g.r-x*x;if(y2<-EPS)return [];const u=unit(v),c=add(g.center,u,x),n={x:-u.y,y:u.x};return [add(c,n,Math.sqrt(Math.max(0,y2))),add(c,n,-Math.sqrt(Math.max(0,y2)))];
    }
    const vertices=moved.map((e,i)=>{const prev=moved[(i+moved.length-1)%moved.length];if(dist(prev.b,e.a)<EPS)return e.a;const points=hits(prev,e).sort((a,b)=>dist(a,e.origin)-dist(b,e.origin));if(!points.length||dist(points[0],e.origin)>Math.max(Math.abs(d)*100,1))throw Error('偏移后相邻边无法可靠连接，请减小偏移量。');return points[0];});
    const result=vertices.map((a,i)=>{const e=moved[i],b=vertices[(i+1)%vertices.length];if(!e.circle){if(dot(sub(b,a),sub(e.b,e.a))<=EPS)throw Error('偏移后线段反转或消失，请减小偏移量。');return {...a,bulge:0};}const g=e.circle,start=Math.atan2(a.y-g.center.y,a.x-g.center.x),end=Math.atan2(b.y-g.center.y,b.x-g.center.x),sign=Math.sign(g.sweep);let sweep=((sign*(end-start))%(Math.PI*2)+Math.PI*2)%(Math.PI*2);if(sweep<EPS||sweep>Math.abs(g.sweep)+Math.PI)throw Error('偏移导致圆弧反转，请减小偏移量。');return {...a,bulge:Math.tan(sign*sweep/4)};});
    validatePath(result);if(Math.sign(area(flatten(result)))!==winding)throw Error('偏移后轮廓反转，请减小偏移量。');return result;
  }
  // ASCII DXF only. Reject unsupported geometry rather than losing cutter paths.
  function parseDXF(text,{units='auto'}={}){if(typeof text!=='string'||text.length>10*1024*1024)throw Error('DXF 超过 10 MB。');if(text.startsWith('AutoCAD Binary DXF'))throw Error('请在 CAD 中另存为 ASCII DXF。');const lines=text.replace(/^\uFEFF/,'').replace(/\r/g,'').trimEnd().split('\n');if(lines.length%2)throw Error('DXF 组码不完整。');const pairs=[];for(let i=0;i<lines.length;i+=2){const code=Number(lines[i].trim());if(!/^\d+$/.test(lines[i].trim())||!Number.isInteger(code))throw Error('不是有效的 ASCII DXF 组码。');pairs.push([code,lines[i+1].trim()]);}
    const uIndex=pairs.findIndex(p=>p[0]===9&&p[1]==='$INSUNITS'),unitCode=uIndex>=0?Number(pairs[uIndex+1]?.[1]):0,unitMap={1:25.4,2:304.8,4:1,5:10,6:1000,9:.0254,10:914.4,14:100,21:1200000/3937};
    if(!['auto','mm','inch','cm'].includes(units))throw Error('请选择文件单位。');const scale=units==='auto'?unitMap[unitCode]:{mm:1,inch:25.4,cm:10}[units];if(!scale)throw Error('DXF 未声明可识别的单位，请在导入窗口指定毫米或英寸。');
    let section='',current=null,records=[];for(let i=0;i<pairs.length;i++){const [c,v]=pairs[i];if(c===0&&v==='SECTION'){section=pairs[++i]?.[1];current=null;continue;}if(c===0&&v==='ENDSEC'){section='';current=null;continue;}if(section!=='ENTITIES')continue;if(c===0){current={type:v,data:[]};records.push(current);}else if(current)current.data.push([c,v]);}
    if(!records.length)throw Error('DXF 没有模型空间图形。');const es=[],ignored=new Set(),unsupported=new Set();let poly=null;
    const value=(r,c,f)=>{const v=r.data.find(p=>p[0]===c);return v?v[1]:f;};
    const num=(r,c,f)=>{const v=value(r,c,f);if(v===undefined||v===''||!Number.isFinite(Number(v)))throw Error(`DXF ${r.type} 的组码 ${c} 无效。`);return Number(v);};
    const xy=(r,c=10)=>({x:num(r,c)*scale,y:-num(r,c+10)*scale});
    const push=(a,b,bulge,layer)=>{es.push(entity({a,b,bulge,layer}));if(es.length>MAX)throw Error(`最多支持 ${MAX} 条线或圆弧。`);};
    const emitPoly=p=>{if(p.points.length<2)throw Error('DXF 多段线缺少顶点。');for(let i=0;i<p.points.length-(p.closed?0:1);i++){const a=p.points[i],b=p.points[(i+1)%p.points.length];if(dist(a,b)<EPS){if(a.bulge)throw Error('DXF 含零长度圆弧。');continue;}push(a,b,a.bulge,p.layer);}};
    for(const r of records){if(num(r,67,0)===1){ignored.add('图纸空间');continue;}const type=r.type,layer=value(r,8,'OUTLINE');
      if(['TEXT','MTEXT','DIMENSION','POINT','HATCH','LEADER','MLEADER','VIEWPORT','ATTDEF','ATTRIB','SEQEND'].includes(type)&&type!=='SEQEND'){ignored.add(type);continue;}
      if(type!=='VERTEX'&&type!=='SEQEND'&&poly)throw Error('DXF POLYLINE 缺少 SEQEND。');
      if(num(r,210,0)!==0||num(r,220,0)!==0||num(r,230,1)!==1||[30,31,38,39].some(c=>Math.abs(num(r,c,0))>EPS))throw Error('仅支持 XY 平面、Z=0 的二维 DXF；请先在 CAD 中投影到 XY 平面。');
      if(['40','41','43'].some(c=>['LWPOLYLINE','POLYLINE','VERTEX'].includes(type)&&r.data.some(p=>p[0]===Number(c)&&Number(p[1])!==0)))throw Error('不支持带宽度的多段线，请转换为闭合轮廓。');
      if(type==='LINE')push(xy(r),xy(r,11),0,layer);
      else if(type==='ARC'||type==='CIRCLE'){const center=xy(r),rad=num(r,40)*scale;if(rad<=0)throw Error('DXF 圆半径无效。');const start=type==='CIRCLE'?0:num(r,50)*Math.PI/180;let sweep=type==='CIRCLE'?2*Math.PI:((num(r,51)*Math.PI/180-start)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);if(sweep<EPS)throw Error('DXF 圆弧夹角为零。');const n=Math.ceil(sweep/(Math.PI/2));for(let i=0;i<n;i++){const p=t=>({x:center.x+rad*Math.cos(t),y:center.y-rad*Math.sin(t)});push(p(start+sweep*i/n),p(start+sweep*(i+1)/n),-Math.tan(sweep/n/4),layer);}}
      else if(type==='LWPOLYLINE'){const p={points:[],closed:!!(num(r,70,0)&1),layer};let v=null;for(const [c,s]of r.data){if(c===10){v={x:Number(s)*scale,y:NaN,bulge:0};p.points.push(v);}else if(c===20&&v)v.y=-Number(s)*scale;else if(c===42&&v)v.bulge=-Number(s);}if(num(r,90)!==p.points.length)throw Error('DXF 多段线顶点数量不符。');emitPoly(p);}
      else if(type==='POLYLINE'){if(num(r,70,0)&(8|16|64))throw Error('不支持三维多段线或网格。');poly={points:[],closed:!!(num(r,70,0)&1),layer};}
      else if(type==='VERTEX'){if(!poly)throw Error('DXF VERTEX 缺少 POLYLINE。');if(num(r,70,0)&(32|64|128))throw Error('不支持三维顶点。');poly.points.push({...xy(r),bulge:-num(r,42,0)});}
      else if(type==='SEQEND'){if(poly){emitPoly(poly);poly=null;}}
      else unsupported.add(type);
    }
    if(poly)throw Error('DXF POLYLINE 未结束。');if(unsupported.size)throw Error(`DXF 含暂不支持的实体：${[...unsupported].join('、')}。请将块炸开，并将样条/椭圆转换为直线和圆弧。`);if(!es.length)throw Error('DXF 没有可用的二维线条。');return {entities:es,unitCode,scale,ignored:[...ignored]};
  }
  const api={copy,uid,entity,entities,arc,sample,fromPath,flatten,offset,extend,intersection,corner,distance,validatePath,assemble,classify,normalizeGeometry,parseDXF,offsetPath,inside,area};
  if(typeof module!=='undefined')module.exports=api;else root.PlateCAD=api;
})(typeof window!=='undefined'?window:globalThis);
