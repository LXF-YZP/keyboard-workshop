(function (root) {
  'use strict';
  const CAD=typeof module!=='undefined'?require('./plate-cad'):root.PlateCAD;
  const uid = () => 'k' + Math.random().toString(36).slice(2, 11);
  const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const round = v => Math.round(v * 1000000) / 1000000;
  const radians = a => a * Math.PI / 180;
  const rotate = (x, y, angle) => {
    const a = radians(angle); return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  };
  function key(data = {}) {
    return { id: uid(), label: '', x: 0.5, y: 0.5, w: 1, h: 1, angle: 0, decal: false, color: '#e8e6e0', stab: 'auto', cutoutRotation: 0, plateOutline: false, ...data };
  }
  const keyShapeData=k=>({w2:Number.isFinite(k.w2)?k.w2:k.w,h2:Number.isFinite(k.h2)?k.h2:k.h,x2:Number.isFinite(k.x2)?k.x2:0,y2:Number.isFinite(k.y2)?k.y2:0});
  const hasCompoundShape=k=>{const s=keyShapeData(k);return Math.abs(s.w2-k.w)>1e-9||Math.abs(s.h2-k.h)>1e-9||Math.abs(s.x2)>1e-9||Math.abs(s.y2)>1e-9;};
  function parseKLE(text) {
    let raw;
    const trimmed = text.trim().replace(/,\s*$/, '');
    try { raw = JSON.parse(trimmed); } catch (_) {
      try { raw = JSON.parse('[' + trimmed + ']'); }
      catch (_) { throw Error('无法解析配列。请导入 KLE 下载的 JSON，或粘贴使用双引号的 Raw Data。'); }
    }
    if (!Array.isArray(raw)) throw Error('配列应为 KLE 数组，请检查文件格式。');
    if(raw.some(item=>typeof item==='string'))raw=[raw];
    const keys = []; let x = 0, y = 0, rx = 0, ry = 0, r = 0, color = '#e8e6e0';
    let name = '导入的配列', w = 1, h = 1, w2 = 1, h2 = 1, x2 = 0, y2 = 0, decal = false;
    for (const row of raw) {
      if (!Array.isArray(row)) { if (row && typeof row === 'object' && row.name) name = String(row.name); continue; }
      for (const item of row) {
        if (typeof item === 'string') {
          const p = rotate(x + w / 2 - rx, y + h / 2 - ry, r);
          const data={label:item.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '),x:p.x+rx,y:p.y+ry,angle:r,w,h,decal,color};
          if(Math.abs(w2-w)>1e-9||Math.abs(h2-h)>1e-9||Math.abs(x2)>1e-9||Math.abs(y2)>1e-9)Object.assign(data,{w2,h2,x2,y2});
          keys.push(key(data));
          x += w; w = h = w2 = h2 = 1; x2 = y2 = 0; decal = false;
        } else if (item && typeof item === 'object') {
          for(const prop of ['r','rx','ry','x','y','w','h','w2','h2','x2','y2'])if(prop in item&&(typeof item[prop]!=='number'||!Number.isFinite(item[prop])))throw Error('KLE 坐标和尺寸必须是有效数值。');
          if ('r' in item) r = finite(item.r);
          if ('rx' in item) { rx = finite(item.rx); x = rx; y = ry; }
          if ('ry' in item) { ry = finite(item.ry); x = rx; y = ry; }
          x += finite(item.x); y += finite(item.y);
          if ('w' in item) w2 = w = item.w;
          if ('h' in item) h2 = h = item.h;
          if ('w2' in item) w2 = finite(item.w2, w)||w;
          if ('h2' in item) h2 = finite(item.h2, h)||h;
          if ('x2' in item) x2 = finite(item.x2);
          if ('y2' in item) y2 = finite(item.y2);
          if ('d' in item) decal = !!item.d;
          if (typeof item.c === 'string' && /^#[a-f0-9]{3,8}$/i.test(item.c)) color = item.c;
        } else { throw Error('KLE 中含无效键位数据。'); }
      }
      y += 1; x = rx;
    }
    checkKeys(keys); return { name, keys };
  }
  function checkKeys(keys) {
    if (!Array.isArray(keys) || !keys.length || keys.length > 500) throw Error('配列需要包含 1–500 个键位或标记。');
    for (const k of keys) {
      for (const n of ['x', 'y', 'w', 'h', 'angle']) if (!Number.isFinite(k[n])) throw Error('键位参数必须是有限数值。');
      if (Math.abs(k.x) > 1000 || Math.abs(k.y) > 1000 || k.w < .1 || k.h < .1 || k.w > 20 || k.h > 20) throw Error('键位尺寸或位置超出支持范围。');
      for(const n of ['w2','h2','x2','y2'])if(n in k&&!Number.isFinite(k[n]))throw Error('KLE 复合键尺寸和偏移必须是有效数值。');
      const shape=keyShapeData(k);
      if(![shape.w2,shape.h2,shape.x2,shape.y2].every(Number.isFinite)||shape.w2<.1||shape.h2<.1||shape.w2>20||shape.h2>20||Math.abs(shape.x2)>20||Math.abs(shape.y2)>20)throw Error('KLE 复合键尺寸或偏移超出支持范围。');
      if(hasCompoundShape(k))keyLocalShape(k);
    }
  }
  function exportKLE(keys, name, raw = false) {
    checkKeys(keys);
    const rows = [{ name, author: '键盘工坊', notes: '截图配列需按实物校准；Decal 不生成轴孔。' }];
    for (const k of keys) {
      const item={r:round(k.angle),rx:round(k.x),ry:round(k.y),x:round(-k.w/2),y:round(-k.h/2),w:round(k.w),h:round(k.h),c:k.color,d:!!k.decal,a:7};
      if(hasCompoundShape(k)){const s=keyShapeData(k);item.w2=round(s.w2);item.h2=round(s.h2);item.x2=round(s.x2);item.y2=round(s.y2);}
      rows.push([item,k.label]);
    }
    const text = JSON.stringify(rows, null, 2); return raw ? text.slice(1, -1).trim() : text;
  }
  function rectangle(x, y, w, h, angle = 0) {
    return [[-w/2, -h/2], [w/2, -h/2], [w/2, h/2], [-w/2, h/2]].map(([dx,dy]) => {
      const p = rotate(dx,dy,angle); return { x: x+p.x, y: y+p.y };
    });
  }
  // KLE w2/h2/x2/y2 describe a second rectangle relative to the primary
  // rectangle's top-left corner. Keep the primary rectangle centered on the
  // switch; merge both rectangles into one outline for display and board bounds.
  function keyLocalShape(k, margin=0) {
    const s=keyShapeData(k),primary={x1:-k.w/2,y1:-k.h/2,x2:k.w/2,y2:k.h/2};
    const rect=(x1,y1,x2,y2)=>[{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}];
    let points;
    if(!hasCompoundShape(k))points=rect(primary.x1,primary.y1,primary.x2,primary.y2);
    else {
      const secondary={x1:-k.w/2+s.x2,y1:-k.h/2+s.y2,x2:-k.w/2+s.x2+s.w2,y2:-k.h/2+s.y2+s.h2};
      // KLE compound keys are one connected shape. Reject a point-touch or
      // disjoint rectangle rather than silently dropping part of the outline.
      const overlapX=Math.min(primary.x2,secondary.x2)-Math.max(primary.x1,secondary.x1),overlapY=Math.min(primary.y2,secondary.y2)-Math.max(primary.y1,secondary.y1);
      if(overlapX<-1e-9||overlapY<-1e-9||(overlapX<=1e-9&&overlapY<=1e-9))throw Error('KLE 复合键的两个矩形必须相交或沿一段边相接。');
      points=orthogonalUnion([rect(primary.x1,primary.y1,primary.x2,primary.y2),rect(secondary.x1,secondary.y1,secondary.x2,secondary.y2)]);
    }
    if(margin<0){
      // Keep display/collision insets below the narrowest step, so a thin
      // protrusion or neck cannot collapse into an inverted/self-crossing path.
      const gaps=['x','y'].flatMap(axis=>{const values=[...new Set(points.map(p=>p[axis]))].sort((a,b)=>a-b);return values.slice(1).map((v,i)=>v-values[i]);});
      margin=Math.max(margin,-Math.min(...gaps)/4);
    }
    return margin?offsetPolygon(points,margin):points;
  }
  function keyShape(k, margin=0) {
    const points=keyLocalShape(k,margin).map(p=>rotate(p.x,p.y,k.angle));
    return points.map(p=>({x:p.x+k.x,y:p.y+k.y}));
  }
  function keyFootprint(k, margin=0, pitchX=1, pitchY=pitchX) {
    let points=keyLocalShape(k).map(p=>({x:p.x*pitchX,y:p.y*pitchY}));
    if(margin)points=offsetPolygon(points,margin);
    points=points.map(p=>rotate(p.x,p.y,k.angle));
    return points.map(p=>({x:p.x+k.x*pitchX,y:p.y+k.y*pitchY}));
  }
  function bounds(points) {
    if (!points.length) return { x: 0, y: 0, w: 100, h: 100 };
    const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
    const x=Math.min(...xs), y=Math.min(...ys); return { x, y, w: Math.max(...xs)-x, h: Math.max(...ys)-y };
  }
  function hull(points) {
    const list = points.slice().sort((a,b)=>a.x-b.x || a.y-b.y);
    const cross = (o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
    const lower=[], upper=[];
    for(const p of list) { while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop(); lower.push(p); }
    for(const p of list.reverse()) { while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop(); upper.push(p); }
    return lower.slice(0,-1).concat(upper.slice(0,-1));
  }
  function polygonUnion(input) {
    const polygons=input.filter(p=>Array.isArray(p)&&p.length>=3).map(p=>signedArea(p)>0?p:p.slice().reverse());
    if(!polygons.length)return {outlines:[],holes:[]};
    const boxes=polygons.map(points=>bounds(points)),edges=[];
    polygons.forEach((points,polygon)=>points.forEach((a,index)=>{
      const b=points[(index+1)%points.length];
      edges.push({a,b,polygon,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y),cuts:[0,1]});
    }));
    const cross=(a,b)=>a.x*b.y-a.y*b.x,sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}),EPS=1e-9;
    for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
      const a=edges[i],b=edges[j];
      if(a.polygon===b.polygon||a.maxX<b.minX-EPS||b.maxX<a.minX-EPS||a.maxY<b.minY-EPS||b.maxY<a.minY-EPS)continue;
      const r=sub(a.b,a.a),s=sub(b.b,b.a),q=sub(b.a,a.a),den=cross(r,s),rr=r.x*r.x+r.y*r.y,ss=s.x*s.x+s.y*s.y;
      if(Math.abs(den)>EPS){
        const t=cross(q,s)/den,u=cross(q,r)/den;
        if(t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS){a.cuts.push(Math.max(0,Math.min(1,t)));b.cuts.push(Math.max(0,Math.min(1,u)));}
      }else if(Math.abs(cross(q,r))<=EPS){
        const t0=((b.a.x-a.a.x)*r.x+(b.a.y-a.a.y)*r.y)/rr,t1=((b.b.x-a.a.x)*r.x+(b.b.y-a.a.y)*r.y)/rr;
        const lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(1,Math.max(t0,t1));
        if(hi>=lo-EPS){a.cuts.push(lo,hi);for(const t of [lo,hi]){const p={x:a.a.x+r.x*t,y:a.a.y+r.y*t};b.cuts.push(Math.max(0,Math.min(1,((p.x-b.a.x)*s.x+(p.y-b.a.y)*s.y)/ss)));}}
      }
    }
    const occupied=p=>{
      for(let i=0;i<polygons.length;i++){const b=boxes[i];if(p.x>=b.x-EPS&&p.x<=b.x+b.w+EPS&&p.y>=b.y-EPS&&p.y<=b.y+b.h+EPS&&inside(p,polygons[i]))return true;}
      return false;
    };
    const boundary=[],seen=new Set(),probe=1e-5;
    for(const e of edges){
      const cuts=e.cuts.sort((a,b)=>a-b).filter((t,i,list)=>!i||Math.abs(t-list[i-1])>1e-8),dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,len=Math.hypot(dx,dy);
      for(let i=1;i<cuts.length;i++){
        const t0=cuts[i-1],t1=cuts[i];if(t1-t0<1e-9)continue;
        const a={x:e.a.x+dx*t0,y:e.a.y+dy*t0},b={x:e.a.x+dx*t1,y:e.a.y+dy*t1},mx=(a.x+b.x)/2,my=(a.y+b.y)/2,nx=-dy/len*probe,ny=dx/len*probe;
        if(!occupied({x:mx+nx,y:my+ny})||occupied({x:mx-nx,y:my-ny}))continue;
        const key=[a.x,a.y,b.x,b.y].map(v=>Math.round(v*1e6)).join(',');if(seen.has(key))continue;seen.add(key);boundary.push({a,b});
      }
    }
    if(!boundary.length)throw Error('无法生成键位外扩板框，请检查键位是否重叠或调整边距。');
    const nodes=[],node=p=>{for(let i=0;i<nodes.length;i++)if(Math.hypot(nodes[i].p.x-p.x,nodes[i].p.y-p.y)<1e-5)return i;nodes.push({p,out:[],in:0});return nodes.length-1;},segments=[];
    for(const e of boundary){const a=node(e.a),b=node(e.b);if(a===b)continue;segments.push({a,b});nodes[a].out.push(segments.length-1);nodes[b].in++;}
    if(nodes.some(n=>n.out.length!==n.in||n.out.length>1))throw Error('键位外扩轮廓存在相切分叉，请调整键位或边距，或改用 CAD 手动边框。');
    const used=new Set(),loops=[];
    for(let first=0;first<segments.length;first++){
      if(used.has(first))continue;
      const path=[],start=segments[first].a;let edge=first,guard=0,closed=false;
      while(edge!==undefined&&!used.has(edge)&&guard++<=segments.length){
        used.add(edge);const segment=segments[edge];path.push({...nodes[segment.a].p,bulge:0});const end=segment.b;
        if(end===start){closed=true;break;}edge=nodes[end].out.find(candidate=>!used.has(candidate));
      }
      if(!closed||path.length<3)throw Error('键位外扩板框没有形成闭合轮廓，请改用 CAD 手动边框。');
      const simplified=path.filter((p,i)=>{const a=path[(i+path.length-1)%path.length],b=path[(i+1)%path.length],u=sub(p,a),v=sub(b,p);return Math.abs(cross(u,v))>1e-8*Math.max(1,Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y));});
      if(simplified.length<3)throw Error('键位外扩板框转角无效，请检查配列。');
      loops.push(simplified);
    }
    const depths=loops.map((path,i)=>loops.filter((other,j)=>j!==i&&inside(path[0],other)).length);
    return {outlines:loops.filter((_,i)=>depths[i]%2===0),holes:loops.filter((_,i)=>depths[i]%2===1)};
  }
  function intersects(a,b) {
    for (const poly of [a,b]) for(let i=0;i<poly.length;i++) {
      const p=poly[i], q=poly[(i+1)%poly.length], axis={x:q.y-p.y,y:p.x-q.x};
      const aa=a.map(v=>v.x*axis.x+v.y*axis.y), bb=b.map(v=>v.x*axis.x+v.y*axis.y);
      if(Math.max(...aa)<=Math.min(...bb)+.001 || Math.max(...bb)<=Math.min(...aa)+.001) return false;
    }
    return true;
  }
  function pointOnSegment(p,a,b,epsilon=.000001) {
    const cross=(p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x);
    if(Math.abs(cross)>epsilon)return false;
    return p.x>=Math.min(a.x,b.x)-epsilon&&p.x<=Math.max(a.x,b.x)+epsilon&&p.y>=Math.min(a.y,b.y)-epsilon&&p.y<=Math.max(a.y,b.y)+epsilon;
  }
  function segmentsIntersect(a,b,c,d) {
    const orient=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    const ab=orient(a,b,c),ab2=orient(a,b,d),cd=orient(c,d,a),cd2=orient(c,d,b);
    if(pointOnSegment(c,a,b)||pointOnSegment(d,a,b)||pointOnSegment(a,c,d)||pointOnSegment(b,c,d))return true;
    return ((ab>0&&ab2<0)||(ab<0&&ab2>0))&&((cd>0&&cd2<0)||(cd<0&&cd2>0));
  }
  function polygonIntersects(a,b) {
    if(!a?.length||!b?.length)return false;
    for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(segmentsIntersect(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))return true;
    return inside(a[0],b)||inside(b[0],a);
  }
  const signedArea=points=>points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0);
  function crossesItself(points) {
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
      if(j===i+1||(i===0&&j===points.length-1))continue;
      if(segmentsIntersect(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]))return true;
    }
    return false;
  }
  function outlinePoints(points, {space='u'} = {}) {
    if(!Array.isArray(points)||points.length<3||points.length>2000)throw Error('截图键盘轮廓至少需要 3 个点，最多支持 2000 个点。');
    const normalized=points.map(p=>({x:Number(p.x),y:Number(p.y)}));
    if(normalized.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1000||Math.abs(p.y)>1000))throw Error('截图键盘轮廓含有无效或超出范围的坐标。');
    if(Math.abs(signedArea(normalized))<.000001)throw Error('截图键盘轮廓面积不能为零。');
    for(let i=0;i<normalized.length;i++)for(let j=i+1;j<normalized.length;j++){
      if(i===0&&j===normalized.length-1)continue;
      if(Math.hypot(normalized[i].x-normalized[j].x,normalized[i].y-normalized[j].y)<.000001)throw Error('截图键盘轮廓不能含有重复点。');
    }
    if(crossesItself(normalized))throw Error('截图键盘轮廓边线相交，请重新描绘。');
    return normalized;
  }
  // Path vertices carry a DXF-style bulge for the segment to the next vertex: tan(sweep / 4),
  // positive when the arc turns counterclockwise in these raw x/y coordinates (before the DXF Y flip).
  function fillet(points, radius) {
    const n=points.length,radii=Array.isArray(radius)?radius:points.map(()=>radius),out=[],applied=[];let reduced=false;
    for(let i=0;i<n;i++){
      const p=points[i],a=points[(i+n-1)%n],b=points[(i+1)%n],r=radii[i];
      const la=Math.hypot(a.x-p.x,a.y-p.y),lb=Math.hypot(b.x-p.x,b.y-p.y);
      const cross=(p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x);
      const phi=la&&lb?Math.acos(Math.max(-1,Math.min(1,((a.x-p.x)*(b.x-p.x)+(a.y-p.y)*(b.y-p.y))/(la*lb)))):Math.PI;
      // Near-straight hull vertices (< 0.06°) stay sharp; their arcs would be microscopic CAM noise.
      if(!(r>0)||Math.PI-phi<1e-3||phi<1e-6){out.push({x:p.x,y:p.y,bulge:0});applied.push(0);continue;}
      let t=r/Math.tan(phi/2);
      if(t>Math.min(la,lb)/2+1e-9){t=Math.min(la,lb)/2;reduced=true;}
      const bulge=Math.sign(cross)*Math.tan((Math.PI-phi)/4);
      out.push({x:p.x+(a.x-p.x)/la*t,y:p.y+(a.y-p.y)/la*t,bulge},{x:p.x+(b.x-p.x)/lb*t,y:p.y+(b.y-p.y)/lb*t,bulge:0});
      applied.push(t*Math.tan(phi/2));
    }
    // Adjacent corners can meet mid-edge; drop the zero-length segment and keep the later vertex's bulge.
    const path=out.filter((p,i)=>{const q=out[(i+1)%out.length];return Math.hypot(q.x-p.x,q.y-p.y)>1e-9;});
    return {path,radii:applied,reduced};
  }
  function arcPoints(p,q,bulge) {
    const theta=4*Math.atan(bulge),dx=q.x-p.x,dy=q.y-p.y,chord=Math.hypot(dx,dy);
    if(!chord)return [];
    const offset=chord/(2*Math.tan(theta/2)),cx=(p.x+q.x)/2-dy/chord*offset,cy=(p.y+q.y)/2+dx/chord*offset;
    const radius=Math.hypot(p.x-cx,p.y-cy),start=Math.atan2(p.y-cy,p.x-cx),steps=Math.max(2,Math.ceil(Math.abs(theta)/(Math.PI/12)));
    return Array.from({length:steps-1},(_,i)=>({x:cx+radius*Math.cos(start+theta*(i+1)/steps),y:cy+radius*Math.sin(start+theta*(i+1)/steps)}));
  }
  function flatten(path) {
    return path.flatMap((p,i)=>[{x:p.x,y:p.y},...(p.bulge?arcPoints(p,path[(i+1)%path.length],p.bulge):[])]);
  }
  // Miter offset; positive distance grows the polygon regardless of winding.
  function offsetPolygon(points, distance) {
    const n=points.length,outward=signedArea(points)>0?1:-1;
    const normals=points.map((p,i)=>{const q=points[(i+1)%n],l=Math.hypot(q.x-p.x,q.y-p.y);return {x:outward*(q.y-p.y)/l,y:-outward*(q.x-p.x)/l};});
    return points.map((p,i)=>{
      const n1=normals[(i+n-1)%n],n2=normals[i],scale=1+n1.x*n2.x+n1.y*n2.y;
      if(scale<.05)throw Error('板框含过尖的转角，无法计算切缝补偿。');
      return {x:p.x+distance*(n1.x+n2.x)/scale,y:p.y+distance*(n1.y+n2.y)/scale};
    });
  }
  const place=(points,x,y,angle)=>points.map(p=>{const q=rotate(p.x,p.y,angle);return {x:x+q.x,y:y+q.y};});
  function convexFlags(points) {
    const turn=Math.sign(signedArea(points)),n=points.length;
    return points.map((p,i)=>{const a=points[(i+n-1)%n],b=points[(i+1)%n];return Math.sign((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x))===turn;});
  }
  // Rounded geometry keeps its sharp polygon and applied corner radii so kerf offsets can be rebuilt exactly.
  function shape(sharp, radii) {
    const f=fillet(sharp,radii);
    return {sharp,radii:f.radii,reduced:f.reduced,path:f.path,points:flatten(f.path)};
  }
  // Positive distance grows the polygon (outlines, frame material); negative shrinks it (holes).
  function compensate(s, distance) {
    if(!distance)return s.path;
    if(s.custom)return CAD.offsetPath(s.path,distance);
    const moved=offsetPolygon(s.sharp,distance);
    if(crossesItself(moved)||Math.sign(signedArea(moved))!==Math.sign(signedArea(s.sharp)))throw Error('切缝补偿后轮廓失效，请减小补偿值。');
    const convex=convexFlags(s.sharp);
    return fillet(moved,s.radii.map((r,i)=>r>0?Math.max(0,r+(convex[i]?distance:-distance)):0)).path;
  }
  const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;return Math.hypot(a.x+t*dx-p.x,a.y+t*dy-p.y);};
  const edgeDistance=(p,poly)=>poly.reduce((m,a,i)=>Math.min(m,segmentDistance(p,a,poly[(i+1)%poly.length])),Infinity);
  const circlePoints=(c,count=32)=>Array.from({length:count},(_,i)=>({x:c.x+c.r*Math.cos(i*2*Math.PI/count),y:c.y+c.r*Math.sin(i*2*Math.PI/count)}));
  // Coordinates and capture distances are in U; callers convert the screen tolerance.
  function snapNeighbors(movingKeys, fixedKeys, options = {}) {
    const threshold=options.threshold ?? .2, angleTolerance=options.angleTolerance ?? .75, snapAngle=options.snapAngle!==false;
    const movingIDs=new Set(movingKeys.map(k=>k.id));
    const moving=movingKeys.filter(k=>!k.decal), fixed=fixedKeys.filter(k=>!k.decal&&!movingIDs.has(k.id));
    if(!moving.length||!fixed.length||threshold<=0)return null;
    const candidates=[], previous=options.previous;
    for(const m of moving)for(const f of fixed){
      const angleDifference=Math.abs(((m.angle-f.angle)%180+270)%180-90);
      // 默认允许角度不同的键进入吸附范围；确认邻键后由调用方一起校正角度。
      // snapAngle:false 保留旧的“仅同角度吸附”行为，便于兼容性测试或调试。
      if(!snapAngle&&angleDifference>angleTolerance)continue;
      const md=bounds(keyLocalShape(m)),fd=bounds(keyLocalShape(f));
      for(const [side,axis]of [['above','y'],['below','y'],['left','x'],['right','x']]){
        const delta=side==='above'?fd.y-(md.y+md.h):side==='below'?(fd.y+fd.h)-md.y:side==='left'?fd.x-(md.x+md.w):(fd.x+fd.w)-md.x;
        const spacing=Math.abs(delta),offset=rotate(axis==='x'?delta:0,axis==='y'?delta:0,f.angle);
        const dx=f.x+offset.x-m.x,dy=f.y+offset.y-m.y,distance=Math.hypot(dx,dy);
        const held=previous?.movingID===m.id&&previous?.targetID===f.id&&previous?.side===side;
        const angleDelta=((f.angle-m.angle)%360+540)%360-180;
        if(distance<=threshold*(held?1.45:1))candidates.push({dx,dy,distance,movingID:m.id,targetID:f.id,axis,side,spacing,held,angleDelta:snapAngle?angleDelta:0});
      }
    }
    candidates.sort((a,b)=>Number(b.held)-Number(a.held)||a.distance-b.distance);
    if(!candidates.length)return null;
    const fixedShapes=fixed.map(k=>{const points=keyShape(k,-.025);return {key:k,points,box:bounds(points)};});
    for(const candidate of candidates){
      const occupied=moving.some(k=>{
        const x=k.x+candidate.dx,y=k.y+candidate.dy,moved={...k,x,y,angle:k.angle+(candidate.angleDelta||0)},points=keyShape(moved,-.025),box=bounds(points);
        const nearby=fixedShapes.filter(f=>box.x<=f.box.x+f.box.w&&f.box.x<=box.x+box.w&&box.y<=f.box.y+f.box.h&&f.box.y<=box.y+box.h);
        return nearby.some(f=>polygonIntersects(points,f.points));
      });
      if(!occupied)return candidate;
    }
    return null;
  }
  function inside(point, poly) {
    let result=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
      if(pointOnSegment(point,poly[j],poly[i]))return true;
      const a=poly[i],b=poly[j];
      if((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) result=!result;
    }
    return result;
  }
  // Merge orthogonal cutout profiles without adding a geometry dependency.
  // This is used by Cherry Spec, whose wire channel intentionally meets the
  // switch opening. The returned boundary is a single closed cutter.
  function orthogonalUnion(polygons) {
    const source=polygons.filter(p=>Array.isArray(p)&&p.length>=3);
    if(!source.length)return [];
    const uniq=a=>[...new Set(a.map(v=>Number(v.toFixed(9))))].sort((x,y)=>x-y);
    const xs=uniq(source.flatMap(p=>p.map(v=>v.x))),ys=uniq(source.flatMap(p=>p.map(v=>v.y)));
    if(xs.length<2||ys.length<2)return source[0].map(p=>({x:p.x,y:p.y}));
    const id=(i,j)=>`${i},${j}`,filled=new Set();
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){
      const c={x:(xs[i]+xs[i+1])/2,y:(ys[j]+ys[j+1])/2};
      if(source.some(poly=>inside(c,poly)))filled.add(id(i,j));
    }
    const edges=[],add=(a,b)=>edges.push({a,b});
    for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++)if(filled.has(id(i,j))){
      if(!filled.has(id(i,j-1)))add({x:xs[i],y:ys[j]},{x:xs[i+1],y:ys[j]});
      if(!filled.has(id(i+1,j)))add({x:xs[i+1],y:ys[j]},{x:xs[i+1],y:ys[j+1]});
      if(!filled.has(id(i,j+1)))add({x:xs[i+1],y:ys[j+1]},{x:xs[i],y:ys[j+1]});
      if(!filled.has(id(i-1,j)))add({x:xs[i],y:ys[j+1]},{x:xs[i],y:ys[j]});
    }
    const same=(a,b)=>Math.abs(a.x-b.x)<1e-8&&Math.abs(a.y-b.y)<1e-8,loops=[],maxEdges=edges.length;
    while(edges.length){
      const first=edges.pop(),loop=[first.a];let current=first.b,guard=0;
      while(!same(current,loop[0])&&guard++<maxEdges+1){
        loop.push(current);
        const index=edges.findIndex(e=>same(e.a,current));
        if(index<0)break;
        current=edges.splice(index,1)[0].b;
      }
      if(same(current,loop[0])&&loop.length>=3){
        const simplified=loop.filter((p,i)=>{const a=loop[(i+loop.length-1)%loop.length],b=loop[(i+1)%loop.length];return Math.abs((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x))>1e-8;});
        if(simplified.length>=3)loops.push(simplified);
      }
    }
    if(!loops.length)return source[0].map(p=>({x:p.x,y:p.y}));
    loops.sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)));
    return loops[0];
  }
  function symmetryAxis(keys, axis = null) {
    if(axis!==null){
      if(!Number.isFinite(axis)||Math.abs(axis)>1000)throw Error('请输入有效的对称轴 X（−1000–1000U），或留空使用自动中线。');
      return axis;
    }
    const actual=keys.filter(k=>!k.decal);
    if(!actual.length)throw Error('请先创建实体按键。');
    return (Math.min(...actual.map(k=>k.x))+Math.max(...actual.map(k=>k.x)))/2;
  }
  // Prefer nearby, unambiguous counterparts. A complete side can recover its
  // single remaining pair after every other key has matched. Never create keys
  // or use labels as identities.
  function mirrorSelection(keys, selectedIDs, options = {}) {
    checkKeys(keys);
    const ids=new Set(selectedIDs),source=keys.filter(k=>ids.has(k.id));
    if(!source.length)throw Error('请先选择同一侧的一列或多个实体按键。');
    if(source.some(k=>k.decal))throw Error('镜像校正只支持实体按键，请取消选择示意标记。');
    const axis=symmetryAxis(keys,options.axis??null),maxDistance=options.maxDistance??.75;
    if(!Number.isFinite(maxDistance)||maxDistance<=0)throw Error('镜像匹配范围无效。');
    const side=Math.sign(source[0].x-axis);
    if(!side||source.some(k=>Math.abs(k.x-axis)<1e-6||Math.sign(k.x-axis)!==side))throw Error('所选按键需全部位于对称轴的同一侧，请调整选择或对称轴。');
    const targets=keys.filter(k=>!k.decal&&!ids.has(k.id)&&Math.sign(k.x-axis)===-side);
    const used=new Set(),matches=new Map(),missing=[];
    for(const s of source){
      const x=2*axis-s.x,y=s.y;
      const nearby=targets.map(k=>({key:k,distance:Math.hypot(k.x-x,k.y-y)})).sort((a,b)=>a.distance-b.distance);
      const best=nearby[0],name=s.label||'未命名键';
      if(!best||best.distance>maxDistance){missing.push(s);continue;}
      if(nearby[1]&&nearby[1].distance<=maxDistance&&nearby[1].distance-best.distance<.15)throw Error(`「${name}」的对应键不明确，请先调整对侧键的位置或对称轴。`);
      if(used.has(best.key.id))throw Error('多个源键匹配到同一个对侧键，请先调整键位或对称轴。');
      used.add(best.key.id);
      matches.set(s.id,best.key);
    }
    let recoveredCount=0;
    if(missing.length){
      const remaining=targets.filter(k=>!used.has(k.id)),s=missing[0],target=remaining[0];
      const wholeSide=keys.filter(k=>!k.decal&&Math.sign(k.x-axis)===side).length===source.length;
      // Equal counts alone are insufficient: require a complete side, at least
      // two established pairs, exactly one unmatched key per side and similar
      // primary dimensions. Partial columns and ambiguous matches stay strict.
      if(wholeSide&&source.length>=3&&source.length===targets.length&&missing.length===1&&remaining.length===1&&Math.abs(s.w-target.w)<=.25&&Math.abs(s.h-target.h)<=.25){
        matches.set(s.id,target);used.add(target.id);recoveredCount=1;
      }else throw Error(`「${s.label||'未命名键'}」未找到对应键。请调整对称轴，或将对侧键移到镜像位置 ${maxDistance}U 范围内；整侧仅剩唯一一对且尺寸接近时可自动配对。`);
    }
    const pairs=source.map(s=>{
      const target=matches.get(s.id),x=2*axis-s.x,y=s.y;
      const shape=keyShapeData(s);
      return {sourceID:s.id,targetID:target.id,x:round(x),y:round(y),w:s.w,h:s.h,w2:shape.w2,h2:shape.h2,x2:round(s.w-shape.x2-shape.w2),y2:shape.y2,angle:round(-s.angle)};
    });
    const updates=new Map(pairs.map(p=>[p.targetID,p]));
    const mirrored=keys.map(k=>{
      const p=updates.get(k.id);
      return p?{...k,x:p.x,y:p.y,w:p.w,h:p.h,w2:p.w2,h2:p.h2,x2:p.x2,y2:p.y2,angle:p.angle}:{...k};
    });
    checkKeys(mirrored);
    const actual=mirrored.filter(k=>!k.decal);
    const shapes=new Map(actual.map(k=>[k.id,keyShape(k,-.025)]));
    for(let i=0;i<actual.length;i++)for(let j=i+1;j<actual.length;j++){
      if((used.has(actual[i].id)||used.has(actual[j].id))&&polygonIntersects(shapes.get(actual[i].id),shapes.get(actual[j].id)))throw Error('镜像校正会造成键位重叠，请先调整键位或对称轴。');
    }
    return {keys:mirrored,pairs,axis,sourceSide:side<0?'left':'right',recoveredCount};
  }
  const defaults = { pitch: 19.05, pitchY: null, hole: 14, cutout: 'square', margin: 4, outline: 'hull', outlinePoints: [], outlineSource: null, stabilizers: 'none', mirrorAxis: null, holeRadius: 0, outlineRadius: 0, kerf: 0, mountHoles: 0, mountDiameter: 2.2, mountInset: 4, caseType: 'none', frameWidth: 6, usbWidth: 0, usbX: null };
  const cutoutTypes=['square','mx-openable','alps','mx-alps'], stabilizerTypes=['none','pcb','mx-basic','mx-tight','costar','cherry-spec'];
  // Switch cutouts in local mm with +y pointing south, wound like rectangle(). MX openable notches are 0.8 mm deep and
  // 3.1 mm long, centred ±4.45 mm (swill/kad key.go, adamws/kle-ng cutout-generator.ts); Alps SKCM 15.5 × 12.8 mm (ai03, kle-ng).
  function switchShape(type, hole = 14) {
    const list=points=>points.map(([x,y])=>({x,y}));
    if(type==='alps')return rectangle(0,0,15.5,12.8);
    if(type==='mx-alps')return list([[-7,-7],[7,-7],[7,-6.4],[7.75,-6.4],[7.75,6.4],[7,6.4],[7,7],[-7,7],[-7,6.4],[-7.75,6.4],[-7.75,-6.4],[-7,-6.4]]);
    if(type==='mx-openable')return list([[-7,-7],[7,-7],[7,-6],[7.8,-6],[7.8,-2.9],[7,-2.9],[7,2.9],[7.8,2.9],[7.8,6],[7,6],[7,7],[-7,7],[-7,6],[-7.8,6],[-7.8,2.9],[-7,2.9],[-7,-2.9],[-7.8,-2.9],[-7.8,-6],[-7,-6]]);
    return rectangle(0,0,hole,hole);
  }
  // Stabilizer pads along the key's long axis; cy > 0 shifts the pad south. MX Basic / Tight follow ai03 and kle-ng,
  // Costar follows kad. Spacing keeps only values the sources agree on.
  const stabilizerPads={pcb:{w:7,h:14,cy:0},'mx-basic':{w:7,h:15,cy:1.5},'mx-tight':{w:6.75,h:14,cy:1},costar:{w:3.3,h:14.2,cy:.65}};
  const stabilizerNames={pcb:'PCB 矩形避让 7 × 14 mm','mx-basic':'MX Basic 7 × 15 mm','mx-tight':'MX Tight 6.75 × 14 mm',costar:'Costar 3.3 × 14.2 mm','cherry-spec':'Cherry Spec 闭合轮廓'};
  function stabilizerSpacing(size) {
    if(size>=2&&size<=2.75)return 11.9;
    for(const [u,mm] of [[3,19.05],[6.25,50],[7,57.15],[8,66.675]])if(Math.abs(size-u)<.01)return mm;
    return null;
  }
  // Cherry MX Spec profile: two independently closed cutouts with a narrow
  // horizontal wire channel toward the keyboard center. Coordinates are based
  // on the public dimensions documented by kle-ng; kerf and corner rounding
  // are applied later by the same pipeline as switch holes.
  function cherrySpecStabilizerShapes(size) {
    const spacing=stabilizerSpacing(size);
    if(spacing===null)return null;
    const narrow=size>=3;
    const top=narrow?2.3:4.8768,bottom=narrow?-2.3:-5.8166;
    const base=[
      [-3.3274,5.6896],[3.3274,5.6896],[3.3274,top],[spacing,top],[spacing,bottom],[3.3274,bottom],
      [3.3274,-6.604],[1.524,-6.604],[1.524,-7.7724],[-1.524,-7.7724],[-1.524,-6.604],[-3.3274,-6.604],
      [-3.3274,-.508],[-4.191,-.508],[-4.191,2.286],[-3.3274,2.286]
    ];
    return [
      base.map(([x,y])=>({x:x-spacing,y})),
      base.map(([x,y])=>({x:spacing-x,y}))
    ];
  }
  // Mount holes ride on the outline inset by `mountInset`: corners first, then the middle of the longest gaps.
  // A hole that would hit a cutout slides along the inset path until it keeps `wall` mm of material everywhere.
  function placeMountHoles(s, o, blockers, wall = .5) {
    const r=o.mountDiameter/2,n=s.sharp.length,inner=offsetPolygon(s.sharp,-o.mountInset);
    if(crossesItself(inner)||Math.sign(signedArea(inner))!==Math.sign(signedArea(s.sharp)))throw Error('板框过窄，无法按孔心距放置固定孔。');
    const lengths=inner.map((p,i)=>Math.hypot(inner[(i+1)%n].x-p.x,inner[(i+1)%n].y-p.y)),total=lengths.reduce((a,b)=>a+b,0),starts=[];
    lengths.reduce((sum,l,i)=>(starts[i]=sum,sum+l),0);
    const at=t=>{t=((t%total)+total)%total;let i=0;while(i<n-1&&t>starts[i]+lengths[i])i++;const f=lengths[i]?(t-starts[i])/lengths[i]:0,a=inner[i],b=inner[(i+1)%n];return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};};
    const convex=convexFlags(s.sharp),corners=[];
    s.sharp.forEach((p,i)=>{
      const a=s.sharp[(i+n-1)%n],b=s.sharp[(i+1)%n],la=Math.hypot(a.x-p.x,a.y-p.y),lb=Math.hypot(b.x-p.x,b.y-p.y);
      const phi=Math.acos(Math.max(-1,Math.min(1,((a.x-p.x)*(b.x-p.x)+(a.y-p.y)*(b.y-p.y))/(la*lb))));
      if(Math.PI-phi<radians(25))return;
      // A corner hole keeps the inset distance from a rounded corner too, so it moves deeper along the bisector.
      const R=s.radii[i],depth=convex[i]&&R>o.mountInset?R/Math.sin(phi/2)-(R-o.mountInset):o.mountInset/Math.sin(phi/2);
      const dx=inner[i].x-p.x,dy=inner[i].y-p.y,l=Math.hypot(dx,dy);
      corners.push({t:starts[i],point:{x:p.x+dx/l*depth,y:p.y+dy/l*depth}});
    });
    const gap=(a,b)=>{const d=Math.abs(a.t-b.t)%total;return Math.min(d,total-d);};
    let chosen;
    if(!corners.length)chosen=Array.from({length:o.mountHoles},(_,i)=>({t:i*total/o.mountHoles}));
    else if(o.mountHoles<=corners.length){
      chosen=[corners.reduce((best,c)=>c.point.x+c.point.y<best.point.x+best.point.y?c:best)];
      while(chosen.length<o.mountHoles)chosen.push(corners.filter(c=>!chosen.includes(c)).reduce((best,c)=>{const d=Math.min(...chosen.map(q=>gap(c,q)));return !best||d>best.d+1e-9?{c,d}:best;},null).c);
    }else{
      chosen=[...corners];
      while(chosen.length<o.mountHoles){
        const sorted=chosen.slice().sort((a,b)=>a.t-b.t);let best=null;
        sorted.forEach((c,i)=>{const next=sorted[(i+1)%sorted.length],span=((next.t-c.t)%total+total)%total||total;if(!best||span>best.span+1e-9)best={t:c.t+span/2,span};});
        chosen.push({t:best.t});
      }
    }
    const placed=[],missing=[];
    const clear=(p,b)=>p.x<b.box.x-r-wall||p.x>b.box.x+b.box.w+r+wall||p.y<b.box.y-r-wall||p.y>b.box.y+b.box.h+r+wall||(!inside(p,b.points)&&edgeDistance(p,b.points)>=r+wall);
    const valid=p=>inside(p,s.points)&&edgeDistance(p,s.points)>=r+wall&&placed.every(q=>Math.hypot(q.x-p.x,q.y-p.y)>=2*r+wall)&&blockers.every(b=>clear(p,b));
    chosen.forEach((c,i)=>{
      const candidates=[c.point||at(c.t)];
      for(let k=1;k<=80;k++)candidates.push(at(c.t+k*.75),at(c.t-k*.75));
      const p=candidates.find(valid);
      if(p)placed.push(p);else missing.push(i+1);
    });
    return {centers:placed,missing};
  }
  // The frame wall is the outline minus an inset opening; a USB slot splices the two rings into one C-shaped polygon.
  function topHit(points, x) {
    let best=null;
    points.forEach((a,i)=>{const b=points[(i+1)%points.length];if((a.x<=x&&b.x>x)||(b.x<=x&&a.x>x)){const y=a.y+(x-a.x)*(b.y-a.y)/(b.x-a.x);if(!best||y<best.y)best={edge:i,x,y};}});
    return best;
  }
  function walk(entries, from, to) {
    const n=entries.length,out=[{x:from.x,y:from.y,r:0}],a=entries[from.edge],b=entries[(from.edge+1)%n];
    const along=p=>(p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y);
    if(from.edge!==to.edge||along(to)<along(from))for(let i=(from.edge+1)%n;;i=(i+1)%n){out.push(entries[i]);if(i===to.edge)break;}
    out.push({x:to.x,y:to.y,r:0});return out;
  }
  function usbFrame(outer, inner, x1, x2) {
    const [o1,o2,i1,i2]=[topHit(outer,x1),topHit(outer,x2),topHit(inner,x1),topHit(inner,x2)];
    if(!o1||!o2||!i1||!i2||i1.y<=o1.y||i2.y<=o2.y)return null;
    const within=path=>path.slice(1,-1).every(p=>p.x>=x1-1e-9&&p.x<=x2+1e-9);
    const keep=(entries,a,b)=>{const ab=walk(entries,a,b),ba=walk(entries,b,a);return within(ab)&&!within(ba)?ba:within(ba)&&!within(ab)?ab:null;};
    const outside=keep(outer,o1,o2),opening=keep(inner,i1,i2);
    if(!outside||!opening)return null;
    const back=opening.slice().reverse();
    if(Math.abs(back[0].x-outside[outside.length-1].x)>1e-9||Math.abs(back[back.length-1].x-outside[0].x)>1e-9)return null;
    const joined=[...outside,...back].filter((p,i,list)=>{const q=list[(i+1)%list.length];return Math.hypot(q.x-p.x,q.y-p.y)>1e-9;});
    return crossesItself(joined)?null:joined;
  }
  function plate(keys, options = {}, features = []) {
    checkKeys(keys); const o={...defaults,...options};
    if(!['hull','contour','rectangle','split','capture','custom'].includes(o.outline))throw Error('请选择有效的定位板外框类型。');
    if(!Number.isFinite(o.pitch) || o.pitch<10 || o.pitch>30 || !Number.isFinite(o.hole) || o.hole<8 || o.hole>20 || !Number.isFinite(o.margin) || o.margin<1 || o.margin>50) throw Error('请检查键距（10–30 mm）、轴孔（8–20 mm）和边距（1–50 mm）。');
    if(o.pitchY!==null&&(!Number.isFinite(o.pitchY)||o.pitchY<10||o.pitchY>30)) throw Error('请检查纵向键距（10–30 mm），或留空与横向相同。');
    if(!Number.isFinite(o.holeRadius) || o.holeRadius<0 || o.holeRadius>2 || !Number.isFinite(o.outlineRadius) || o.outlineRadius<0 || o.outlineRadius>50 || !Number.isFinite(o.kerf) || o.kerf<0 || o.kerf>1) throw Error('请检查开孔内角（0–2 mm）、板框圆角（0–50 mm）和切缝补偿（0–1 mm）。');
    if(!cutoutTypes.includes(o.cutout)||!stabilizerTypes.includes(o.stabilizers)) throw Error('请选择有效的轴孔和卫星轴类型。');
    if(!Number.isInteger(o.mountHoles)||o.mountHoles<0||o.mountHoles>24||!Number.isFinite(o.mountDiameter)||o.mountDiameter<1||o.mountDiameter>10||!Number.isFinite(o.mountInset)||o.mountInset<1.5||o.mountInset>30) throw Error('请检查固定孔数量（0–24）、孔径（1–10 mm）和孔心距板边（1.5–30 mm）。');
    if(!['none','sandwich'].includes(o.caseType)||!Number.isFinite(o.frameWidth)||o.frameWidth<2||o.frameWidth>40||!Number.isFinite(o.usbWidth)||o.usbWidth<0||o.usbWidth>40||(o.usbX!==null&&!Number.isFinite(o.usbX))) throw Error('请检查外壳类型、中框宽度（2–40 mm）和 USB 开口宽度（0–40 mm）。');
    const actual=keys.filter(k=>!k.decal); if(!actual.length) throw Error('没有实体按键可生成轴孔。');
    const px=o.pitch,py=o.pitchY??o.pitch;
    const polygons=[], circles=[], sharpOutlines=[],outlineVoids=[], errors=[], warnings=[];
    const custom=o.outline==='custom'?CAD.normalizeGeometry(o.cadGeometry):null;
    const rawShape=path=>({custom:true,sharp:CAD.flatten(path),radii:CAD.flatten(path).map(()=>0),reduced:false,path,points:CAD.flatten(path)});
    if(o.cadDraft)errors.push('CAD 边框仍在编辑，请先应用边框或放弃草稿再导出。');
    const mid=(Math.min(...actual.map(k=>k.x*px))+Math.max(...actual.map(k=>k.x*px)))/2;
    // Decals marked plateOutline (e.g. a trackpad area) widen the outline without getting a cutout.
    const outlineKeys=keys.filter(k=>!k.decal||k.plateOutline);
    const groups=o.outline==='split' ? [outlineKeys.filter(k=>k.x*px<mid),outlineKeys.filter(k=>k.x*px>=mid)] : [outlineKeys];
    for(const group of custom?[]:groups) {
      if(!group.length) continue;
      const pts=group.flatMap(k=>keyFootprint(k,o.margin,px,py));
      if(o.outline==='rectangle') { const b=bounds(pts); sharpOutlines.push(rectangle(b.x+b.w/2,b.y+b.h/2,b.w,b.h)); }
      else if(o.outline==='contour'){
        const union=polygonUnion(group.map(k=>keyFootprint(k,o.margin,px,py)));
        sharpOutlines.push(...union.outlines);outlineVoids.push(...union.holes);
      }
      else if(o.outline==='capture') {
        if(sharpOutlines.length)continue;
        try { sharpOutlines.push(outlinePoints(o.outlinePoints||[]).map(p=>({x:p.x*px,y:p.y*py}))); }
        catch(e) { errors.push(e.message); }
      } else sharpOutlines.push(hull(pts));
    }
    if(o.outline==='contour'&&!sharpOutlines.length)errors.push('无法从当前键位生成贴合板框，请检查配列。');
    if(o.outline==='contour'&&o.caseType==='sandwich'&&outlineVoids.length)errors.push('沿键位外扩板框含有内凹闭环，当前不能自动生成三明治中框；请改用 CAD 调整或取消三明治外壳。');
    const outlineShapes=custom?custom.outlines.map(rawShape):sharpOutlines.map(sharp=>shape(sharp,o.outlineRadius)),outlines=outlineShapes.map(s=>s.points);
    const outlineVoidShapes=outlineVoids.map(sharp=>shape(sharp,o.outlineRadius));
    if([...outlineShapes,...outlineVoidShapes].some(s=>s.reduced)) warnings.push('部分板框边长不足，这些转角的圆角已按可用长度减小。');
    for(let i=0;i<outlines.length;i++)for(let j=i+1;j<outlines.length;j++)if(polygonIntersects(outlines[i],outlines[j]))errors.push('定位板外框相交或互相包含，请修正边框。');
    const addHole=(layer,local,x,y,angle,source,radius=o.holeRadius)=>{const sharp=place(local,x,y,angle);polygons.push({layer,source,...shape(sharp,convexFlags(sharp).map(c=>c?radius:0))});};
    if(!custom?.replaceHoles){
    actual.forEach((k,i)=> {
      const x=k.x*px,y=k.y*py,stab=k.stab||'auto';
      const size=Math.max(k.w,k.h);
      const keyAngle=k.angle+(Number(k.cutoutRotation)||0),stabAngle=k.angle+(k.h>k.w?90:0)+(stab==='flip'?180:0);
      if(size>=2&&o.stabilizers==='cherry-spec'&&stab!=='none') {
        const contours=cherrySpecStabilizerShapes(size);
        if(contours) {
          // The Cherry wire channel intentionally enters the switch opening;
          // export one merged cutter so DXF/SVG never contain overlapping paths.
          const relative=stabAngle-keyAngle;
          const rotatedContours=contours.map(contour=>place(contour,0,0,relative));
          const merged=orthogonalUnion([switchShape(o.cutout,o.hole),...rotatedContours]);
          addHole('SWITCH',merged,x,y,keyAngle,`按键 ${i+1} ${k.label} Cherry Spec 合并开孔`,Math.min(o.holeRadius,.4));
          return;
        }
      }
      addHole('SWITCH',switchShape(o.cutout,o.hole),x,y,keyAngle,`按键 ${i+1} ${k.label}`);
      if(size<2||o.stabilizers==='none'||stab==='none') return;
      const offset=stabilizerSpacing(size);
      if(offset===null) { errors.push(`${k.label||i+1} 的 ${size}U 卫星轴间距需自行确认，当前支持 2–2.75U、3U、6.25U、7U、8U；也可在键位属性中设为不装卫星轴。`); return; }
      const pad=stabilizerPads[o.stabilizers];
      for(const sign of [-1,1]) addHole('STABILIZER',rectangle(sign*offset,pad.cy,pad.w,pad.h),x,y,stabAngle,`${k.label} 卫星轴避让`);
    });
    if(o.stabilizers==='none' && actual.some(k=>Math.max(k.w,k.h)>=2)) warnings.push('配列含长键：当前未生成卫星轴孔。');
    if(o.stabilizers==='pcb') warnings.push('卫星轴孔为 PCB 安装式矩形避让，不是板载卡扣式卫星轴孔；需按所购型号试装。');
    else if(o.stabilizers==='cherry-spec') warnings.push('卫星轴开孔采用 Cherry Spec 闭合轮廓，内角圆角最大按 0.4 mm 处理；不同钢丝与轴座公差仍需按所购型号试装。');
    else if(o.stabilizers!=='none') warnings.push(`卫星轴开孔采用 ${stabilizerNames[o.stabilizers]}（向南偏移），不是板载卡扣式轮廓；需按所购型号试装。`);
    for(const f of features) {
      if(![f.x,f.y,f.w,f.h,f.angle].every(Number.isFinite) || f.w<=0 || f.h<=0 || f.w>1000 || f.h>1000 || Math.abs(f.x)>30000 || Math.abs(f.y)>30000) { errors.push('自定义开孔含无效参数。'); continue; }
      if(f.type==='circle') circles.push({layer:'MOUNT',x:f.x,y:f.y,r:f.w/2,source:f.name||'圆孔'});
      else addHole('MODULE',rectangle(0,0,f.w,f.h),f.x,f.y,f.angle,f.name||'模块开孔');
    }
    }
    if(custom?.replaceHoles){polygons.length=0;circles.length=0;custom.holes.forEach((h,i)=>polygons.push({layer:h.layer,source:`DXF 开孔 ${i+1}`,...rawShape(h.path)}));warnings.push('当前使用 DXF 中的开孔；配列轴孔、模块孔和自动固定孔参数不参与本定位板。');}
    const sandwich=o.caseType==='sandwich'&&outlineShapes.length>0,usbX=o.usbX??(outlines.length?bounds(outlines.flat()).x+bounds(outlines.flat()).w/2:0);
    // Reserve the USB slot through the frame wall so no mount hole lands inside it.
    const usbHits=sandwich&&o.usbWidth>0?outlineShapes.map(s=>topHit(s.points,usbX)).filter(Boolean):[];
    const usbSlot=usbHits.length?rectangle(usbX,Math.min(...usbHits.map(h=>h.y))+o.frameWidth/2,o.usbWidth,o.frameWidth+2):null;
    const mounts=[];
    if(o.mountHoles>0&&outlineShapes.length&&!custom?.replaceHoles) {
      const blockers=polygons.map(h=>({points:h.points,box:bounds(h.points)})).concat(circles.map(c=>{const points=circlePoints(c);return {points,box:bounds(points)};}));
      if(usbSlot) blockers.push({points:usbSlot,box:bounds(usbSlot)});
      outlineShapes.forEach((s,g)=>{
        try {
          const {centers,missing}=placeMountHoles(s,o,blockers);
          const prefix=o.outline==='split'&&outlineShapes.length>1?(g?'右半':'左半'):outlineShapes.length>1?`板片 ${g+1} `:'';
          centers.forEach(p=>{const c={layer:'MOUNT',x:p.x,y:p.y,r:o.mountDiameter/2,source:`${prefix}自动固定孔 ${mounts.length+1}`,auto:true};mounts.push(c);blockers.push({points:circlePoints(c),box:bounds(circlePoints(c))});});
          if(missing.length) errors.push(`${prefix}第 ${missing.join('、')} 个自动固定孔找不到空位，请减少数量、调整孔心距或加大外框边距。`);
        } catch(e) { errors.push(e.message); }
      });
      circles.push(...mounts);
    }
    const holes=polygons.concat(circles.map(c=>({...c,points:circlePoints(c)})));
    const boxes=holes.map(h=>bounds(h.points)),overlap=(a,b)=>a.x<=b.x+b.w&&b.x<=a.x+a.w&&a.y<=b.y+b.h&&b.y<=a.y+a.h;
    for(let i=0;i<holes.length;i++) {
      if(outlines.length&&!outlines.some(poly=>holes[i].points.every(p=>inside(p,poly))&&!poly.some((p,n)=>holes[i].points.some((q,m)=>segmentsIntersect(p,poly[(n+1)%poly.length],q,holes[i].points[(m+1)%holes[i].points.length]))))) errors.push(`${holes[i].source} 超出定位板外框，请调整开孔或边距。`);
      for(let j=i+1;j<holes.length;j++) if(overlap(boxes[i],boxes[j])&&polygonIntersects(holes[i].points,holes[j].points)) errors.push(`${holes[i].source} 与 ${holes[j].source} 开孔相交。`);
    }
    const contourCuts=outlineVoidShapes.map((s,i)=>({layer:'OUTLINE',source:`轮廓内空区 ${i+1}`,...s}));
    const parts=[{id:'plate',name:'定位板',outlineLayer:'OUTLINE',outlines:outlineShapes,holes:polygons.concat(contourCuts),circles}];
    if(sandwich) {
      const frameOutlines=[],openings=[],openingChecks=[];let usbDone=!o.usbWidth;
      outlineShapes.forEach(s=>{
        if(s.custom){
          try{const opening=rawShape(CAD.offsetPath(s.path,-o.frameWidth));openingChecks.push(opening.points);frameOutlines.push(s);openings.push({layer:'FRAME_OPENING',source:'中框开口',...opening});}catch(e){errors.push('自定义中框：'+e.message);}
          if(o.usbWidth>0)errors.push('自定义板框暂不支持自动 USB 开口，请将 USB 开口宽度设为 0。');
          return;
        }
        const W=o.frameWidth,inner=offsetPolygon(s.sharp,-W);
        if(crossesItself(inner)||Math.sign(signedArea(inner))!==Math.sign(signedArea(s.sharp))){errors.push('中框宽度超过板框可用范围，开口轮廓无效。');return;}
        const convex=convexFlags(inner),innerRadii=inner.map((p,i)=>convex[i]?Math.max(o.holeRadius,s.radii[i]-W,0):s.radii[i]>0?s.radii[i]+W:0);
        const opening=shape(inner,innerRadii);openingChecks.push(opening.points);
        if(!usbDone){
          const joined=usbFrame(s.sharp.map((p,i)=>({...p,r:s.radii[i]})),inner.map((p,i)=>({...p,r:innerRadii[i]})),usbX-o.usbWidth/2,usbX+o.usbWidth/2);
          if(joined){usbDone=true;frameOutlines.push(shape(joined.map(({x,y})=>({x,y})),joined.map(p=>p.r)));return;}
        }
        frameOutlines.push(s);openings.push({layer:'FRAME_OPENING',source:'中框开口',...opening});
      });
      if(!usbDone) errors.push('USB 开口中心不在板框上沿范围内，请调整位置或宽度。');
      for(const h of polygons) if(!openingChecks.some(poly=>h.points.every(p=>inside(p,poly)))) errors.push(`中框：${h.source} 压到中框，请减小中框宽度或加大外框边距。`);
      for(const c of mounts) if(!frameOutlines.some(s=>inside(c,s.points)&&edgeDistance(c,s.points)>=c.r+.5)||openingChecks.some(poly=>inside(c,poly)||edgeDistance(c,poly)<c.r+.5)) errors.push(`中框：${c.source} 压到中框开口或 USB 开口，请加大中框宽度或减小孔心距。`);
      parts.push({id:'frame',name:'中框',outlineLayer:'FRAME',outlines:frameOutlines,holes:openings,circles:mounts.map(c=>({...c,layer:'FRAME_MOUNT'}))});
      parts.push({id:'bottom',name:'底板',outlineLayer:'BOTTOM',outlines:outlineShapes,holes:[],circles:mounts.map(c=>({...c,layer:'BOTTOM_MOUNT'}))});
      if(o.margin<o.frameWidth) warnings.push(`三明治外壳的外框边距（${round(o.margin)} mm）小于中框宽度，中框会伸到键帽下方，请确认键帽与中框不干涉。`);
    }
    // Preview and checks use finished dimensions; only the exported toolpaths are kerf-compensated.
    const d=o.kerf/2;
    const cut=part=>{
      const toolpaths={outlines:part.outlines.map(s=>s.path),polygons:part.holes.map(h=>({layer:h.layer,path:h.path})),circles:part.circles};
      if(!(d>0)||errors.length)return toolpaths;
      try {
        toolpaths.outlines=part.outlines.map(s=>compensate(s,d));
        toolpaths.polygons=part.holes.map(h=>{try{return {layer:h.layer,path:compensate(h,-d)};}catch(_){throw Error(`${part.name}：${h.source} 小于切缝补偿量。`);}});
        toolpaths.circles=part.circles.map(c=>{if(c.r-d<=0)throw Error(`${c.source} 小于切缝补偿量。`);return {...c,r:c.r-d};});
      } catch(e) { errors.push(e.message.startsWith('切缝补偿后')?`${part.name}：${e.message}`:e.message); }
      return toolpaths;
    };
    for(const part of parts) part.toolpaths=cut(part);
    if(d>0)warnings.push(`DXF 刀路已按 ${round(o.kerf)} mm 切缝补偿：开孔向内、板框向外各偏移 ${round(d)} mm；预览与检查按成品尺寸。`);
    const preview=parts.map(p=>({id:p.id,name:p.name,outlineLayer:p.outlineLayer,outlines:p.outlines.map(s=>s.points),holes:p.holes.map(h=>({layer:h.layer,points:h.points})),circles:p.circles,toolpaths:p.toolpaths}));
    return {design:{outlines:outlineShapes.map(s=>s.path),holes:polygons.map(h=>({layer:h.layer,path:h.path}))},polygons,circles,outlines,toolpaths:parts[0].toolpaths,parts:preview,errors:[...new Set(errors)],warnings,bounds:bounds(outlines.flat()),count:actual.length,options:o};
  }
  // Selected parts are stacked top to bottom with a 12 mm gap so a combined file nests without overlap.
  function layoutParts(result, ids) {
    if(result.errors.length) throw Error(result.errors.join('\n'));
    const parts=(result.parts||[{id:'plate',outlineLayer:'OUTLINE',toolpaths:result.toolpaths||{outlines:result.outlines,polygons:result.polygons.map(p=>({layer:p.layer,path:p.points})),circles:result.circles}}]).filter(p=>ids.includes(p.id));
    if(!parts.length) throw Error('没有可导出的图层，请先在“外壳”中启用三明治外壳。');
    let cursor=null;
    return parts.map(p=>{
      const t=p.toolpaths,pts=[...t.outlines.flatMap(flatten),...t.polygons.flatMap(h=>flatten(h.path)),...t.circles.flatMap(c=>[{x:c.x-c.r,y:c.y-c.r},{x:c.x+c.r,y:c.y+c.r}])];
      const b=bounds(pts),dy=cursor===null?0:cursor-b.y;cursor=b.y+dy+b.h+12;
      const shift=path=>path.map(v=>({...v,y:v.y+dy}));
      return {outlineLayer:p.outlineLayer,outlines:t.outlines.map(shift),polygons:t.polygons.map(h=>({layer:h.layer,path:shift(h.path)})),circles:t.circles.map(c=>({...c,y:c.y+dy})),bounds:{...b,y:b.y+dy}};
    });
  }
  const layerColors={OUTLINE:1,SWITCH:2,STABILIZER:3,MODULE:4,MOUNT:5,FRAME:6,FRAME_OPENING:2,FRAME_MOUNT:5,BOTTOM:7,BOTTOM_MOUNT:5};
  function dxf(result, ids = ['plate']) {
    const parts=layoutParts(result,ids);
    const names=[...new Set(['OUTLINE','SWITCH','STABILIZER','MODULE','MOUNT',...parts.flatMap(p=>[p.outlineLayer,...p.polygons.map(h=>h.layer),...p.circles.map(c=>c.layer)])])];
    const lines=[]; const pair=(code,value)=>lines.push(String(code),typeof value==='number'?String(round(value)):String(value));
    pair(0,'SECTION'); pair(2,'HEADER'); pair(9,'$ACADVER'); pair(1,'AC1015'); pair(9,'$INSUNITS');pair(70,4);pair(9,'$MEASUREMENT');pair(70,1);pair(0,'ENDSEC');
    pair(0,'SECTION');pair(2,'TABLES');pair(0,'TABLE');pair(2,'LAYER');pair(5,'10');pair(100,'AcDbSymbolTable');pair(70,names.length);
    names.forEach(name=> {pair(0,'LAYER');pair(100,'AcDbSymbolTableRecord');pair(100,'AcDbLayerTableRecord');pair(2,name);pair(70,0);pair(62,layerColors[name]||7);pair(6,'CONTINUOUS');});
    pair(0,'ENDTAB');pair(0,'ENDSEC');pair(0,'SECTION');pair(2,'ENTITIES');
    function poly(path,layer) {
      pair(0,'LWPOLYLINE');pair(100,'AcDbEntity');pair(8,layer);pair(100,'AcDbPolyline');pair(90,path.length);pair(70,1);
      // Flipping Y for CAD reverses arc direction, so the bulge sign flips too.
      for(const p of path){ pair(10,p.x);pair(20,-p.y);if(p.bulge)pair(42,String(Number((-p.bulge).toPrecision(10)))); }
    }
    for(const part of parts) {
      part.outlines.forEach(p=>poly(p,part.outlineLayer)); part.polygons.forEach(p=>poly(p.path,p.layer));
      part.circles.forEach(c=> {pair(0,'CIRCLE');pair(100,'AcDbEntity');pair(8,c.layer);pair(100,'AcDbCircle');pair(10,c.x);pair(20,-c.y);pair(30,0);pair(40,c.r);});
    }
    pair(0,'ENDSEC');pair(0,'EOF');return lines.join('\r\n')+'\r\n';
  }
  // SVG keeps the screen Y-down frame, so a positive bulge (angle increasing) maps to sweep-flag 1. Units are mm.
  function svg(result, ids = ['plate']) {
    const parts=layoutParts(result,ids),n=v=>String(round(v));
    const b=bounds(parts.flatMap(p=>[{x:p.bounds.x,y:p.bounds.y},{x:p.bounds.x+p.bounds.w,y:p.bounds.y+p.bounds.h}])),pad=2;
    const d=path=>path.map((p,i)=>{
      const prev=path[(i+path.length-1)%path.length];
      if(!i)return `M${n(p.x)} ${n(p.y)}`;
      if(!prev.bulge)return `L${n(p.x)} ${n(p.y)}`;
      const theta=4*Math.atan(prev.bulge),r=Math.hypot(p.x-prev.x,p.y-prev.y)/(2*Math.sin(Math.abs(theta)/2));
      return `A${n(r)} ${n(r)} 0 ${Math.abs(theta)>Math.PI?1:0} ${prev.bulge>0?1:0} ${n(p.x)} ${n(p.y)}`;
    }).join(' ')+(path[path.length-1].bulge?(()=>{const p=path[0],prev=path[path.length-1],theta=4*Math.atan(prev.bulge),r=Math.hypot(p.x-prev.x,p.y-prev.y)/(2*Math.sin(Math.abs(theta)/2));return ` A${n(r)} ${n(r)} 0 ${Math.abs(theta)>Math.PI?1:0} ${prev.bulge>0?1:0} ${n(p.x)} ${n(p.y)}`;})():'')+' Z';
    const groups=new Map(),add=(layer,element)=>{if(!groups.has(layer))groups.set(layer,[]);groups.get(layer).push(element);};
    for(const part of parts) {
      part.outlines.forEach(p=>add(part.outlineLayer,`<path d="${d(p)}"/>`));
      part.polygons.forEach(p=>add(p.layer,`<path d="${d(p.path)}"/>`));
      part.circles.forEach(c=>add(c.layer,`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(c.r)}"/>`));
    }
    const body=[...groups].map(([layer,items])=>`  <g id="${layer}">\n    ${items.join('\n    ')}\n  </g>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(b.w+pad*2)}mm" height="${n(b.h+pad*2)}mm" viewBox="${n(b.x-pad)} ${n(b.y-pad)} ${n(b.w+pad*2)} ${n(b.h+pad*2)}">\n  <g fill="none" stroke="#000000" stroke-width="0.1">\n${body}\n  </g>\n</svg>\n`;
  }
  const api={uid,finite,round,rotate,key,parseKLE,checkKeys,exportKLE,rectangle,hasCompoundShape,keyShape,keyLocalShape,keyFootprint,bounds,hull,intersects,polygonIntersects,outlinePoints,fillet,flatten,offsetPolygon,snapNeighbors,inside,symmetryAxis,mirrorSelection,defaults,switchShape,stabilizerSpacing,plate,dxf,svg};
  if(typeof module!=='undefined') module.exports=api; else root.KB=api;
})(typeof window!=='undefined'?window:globalThis);
