(function(root) {
  'use strict';
  const median = a => { const b=a.slice().sort((x,y)=>x-y);return b.length?b[Math.floor(b.length/2)]:1; };
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  function candidate(points, confidence=0.5, source='local') {
    const [tl,tr,br,bl]=points;
    const x=points.reduce((s,p)=>s+p[0],0)/4, y=points.reduce((s,p)=>s+p[1],0)/4;
    const w=(Math.hypot(tr[0]-tl[0],tr[1]-tl[1])+Math.hypot(br[0]-bl[0],br[1]-bl[1]))/2;
    const h=(Math.hypot(bl[0]-tl[0],bl[1]-tl[1])+Math.hypot(br[0]-tr[0],br[1]-tr[1]))/2;
    let angle=Math.atan2(tr[1]-tl[1],tr[0]-tl[0])*180/Math.PI;
    return {x,y,w,h,angle,confidence,source};
  }
  function components(image, sensitivity=1) {
    const scale=Math.min(1,1000/image.naturalWidth), w=Math.round(image.naturalWidth*scale),h=Math.round(image.naturalHeight*scale);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,w,h);
    const rgba=context.getImageData(0,0,w,h).data, gray=new Uint8Array(w*h), visited=new Uint8Array(w*h), stack=new Int32Array(w*h);
    for(let i=0;i<gray.length;i++)gray[i]=rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114;
    const gradient=new Uint8Array(w*h),edge=new Uint8Array(w*h);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x,gx=-gray[i-w-1]+gray[i-w+1]-2*gray[i-1]+2*gray[i+1]-gray[i+w-1]+gray[i+w+1],gy=-gray[i-w-1]-2*gray[i-w]-gray[i-w+1]+gray[i+w-1]+2*gray[i+w]+gray[i+w+1];
      gradient[i]=Math.min(255,Math.hypot(gx,gy)/4);
    }
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;edge[i]=Math.max(gradient[i],gradient[i-1],gradient[i+1],gradient[i-w],gradient[i+w]);}
    const result=[], minSize=Math.max(8,w*.018),maxSize=w*.28;
    const modes=[...[32,48,64,80,100,125,150,175,200,222].flatMap(threshold=>[true,false].map(bright=>({pixels:gray,threshold,bright,source:'local'}))),...[6,9,13,18,25,35].map(threshold=>({pixels:edge,threshold,bright:false,source:'edge'}))];
    for(const {pixels,threshold,bright,source} of modes) {
        visited.fill(0);
        for(let seed=0;seed<gray.length;seed++) {
          if(visited[seed] || (pixels[seed]>threshold)!==bright)continue;
          let head=0,tail=1,count=0,minX=w,maxX=0,minY=h,maxY=0;stack[0]=seed;visited[seed]=1;
          const border=[];
          while(head<tail) {
            const at=stack[head++],x=at%w,y=Math.floor(at/w);count++;
            minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
            let edge=false;
            for(const next of [x>0?at-1:-1,x<w-1?at+1:-1,y>0?at-w:-1,y<h-1?at+w:-1]) {
              if(next<0 || (pixels[next]>threshold)!==bright){edge=true;continue;}
              if(!visited[next]){visited[next]=1;stack[tail++]=next;}
            }
            if(edge && count%2===0)border.push([x,y]);
          }
          const bw=maxX-minX+1,bh=maxY-minY+1;
          if(bw<minSize || bh<minSize || bw>maxSize || bh>maxSize || count/(bw*bh)<.42 || border.length<8 || minX===0 || minY===0 || maxX===w-1 || maxY===h-1) continue;
          let best=null;
          for(let angle=-45;angle<=45;angle+=3) {
            const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);let loX=Infinity,hiX=-Infinity,loY=Infinity,hiY=-Infinity;
            for(const [x,y]of border){const u=x*c+y*s,v=-x*s+y*c;loX=Math.min(loX,u);hiX=Math.max(hiX,u);loY=Math.min(loY,v);hiY=Math.max(hiY,v);}
            const area=(hiX-loX)*(hiY-loY);if(!best||area<best.area)best={area,loX,hiX,loY,hiY,angle,c,s};
          }
          const b=best,rw=b.hiX-b.loX,rh=b.hiY-b.loY,fill=count/b.area;
          if(Math.min(rw,rh)<minSize || Math.max(rw,rh)/Math.min(rw,rh)>6 || fill<(.64-.08*(sensitivity-1)))continue;
          const u=(b.loX+b.hiX)/2,v=(b.loY+b.hiY)/2;
          result.push({x:(u*b.c-v*b.s)/scale,y:(u*b.s+v*b.c)/scale,w:rw/scale,h:rh/scale,angle:b.angle,confidence:Math.min(.95,fill),source});
        }
    }
    return result;
  }
  function filter(candidates,width,height,sensitivity=1) {
    const low=Math.max(10,width*.018),high=Math.min(width*.22,height*.35);
    const possible=candidates.filter(c=>Math.min(c.w,c.h)>=low && Math.min(c.w,c.h)<=high && Math.max(c.w,c.h)/Math.min(c.w,c.h)<=6 && c.x>0&&c.y>0&&c.x<width&&c.y<height);
    if(!possible.length)return [];
    const bins=new Map();for(const c of possible){const b=Math.round(Math.log(Math.min(c.w,c.h))/Math.log(1.15));bins.set(b,(bins.get(b)||0)+1);}
    const bin=[...bins].sort((a,b)=>b[1]-a[1])[0][0],typical=1.15**bin;
    const score=c=>c.confidence+(c.source==='edge'?.3:c.source==='vision'?.1:0)-Math.abs(Math.log(Math.min(c.w,c.h)/typical))*.2;
    const sorted=possible.filter(c=>Math.min(c.w,c.h)>=typical*(.7-.08*(sensitivity-1))&&Math.min(c.w,c.h)<=typical*1.5).sort((a,b)=>score(b)-score(a));
    const unique=[];
    for(const c of sorted) {
      if(unique.some(k=>distance(k,c)<Math.min(k.w,k.h,c.w,c.h)*.58))continue;
      const shape=KB.rectangle(c.x,c.y,c.w*.72,c.h*.72,c.angle);
      if(unique.some(k=>KB.intersects(shape,KB.rectangle(k.x,k.y,k.w*.72,k.h*.72,k.angle))))continue;
      unique.push(c);
    }
    if(unique.length<4||sensitivity>=1.3)return unique;
    return unique.filter(c=>unique.some(k=>k!==c&&distance(k,c)<typical*(2.15+.4*(sensitivity-1))));
  }
  // Return an editable approximation of the visible keyboard silhouette. It is
  // deliberately conservative: the result is a hull of pixels that differ
  // from the image border, so an incomplete screenshot can be corrected by
  // the manual point tool instead of being treated as a certain enclosure.
  function outlineFromImage(image) {
    if(!image?.naturalWidth||!image?.naturalHeight)return null;
    const scale=Math.min(1,700/Math.max(image.naturalWidth,image.naturalHeight));
    const w=Math.max(1,Math.round(image.naturalWidth*scale)),h=Math.max(1,Math.round(image.naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,w,h);
    const rgba=context.getImageData(0,0,w,h).data, border=[];
    const stride=Math.max(1,Math.floor(Math.min(w,h)/90));
    for(let y=0;y<h;y+=stride)for(const x of [0,w-1]){const i=(y*w+x)*4;border.push([rgba[i],rgba[i+1],rgba[i+2]]);}
    for(let x=0;x<w;x+=stride)for(const y of [0,h-1]){const i=(y*w+x)*4;border.push([rgba[i],rgba[i+1],rgba[i+2]]);}
    const bg=border.reduce((s,v)=>s.map((n,i)=>n+v[i]/border.length),[0,0,0]);
    const mask=[];
    for(let y=stride;y<h-stride;y+=stride)for(let x=stride;x<w-stride;x+=stride){
      const i=(y*w+x)*4,delta=Math.hypot(rgba[i]-bg[0],rgba[i+1]-bg[1],rgba[i+2]-bg[2]);
      if(delta>24)mask.push({x,y});
    }
    if(mask.length<12)return null;
    const hull=KB.hull(mask);
    if(hull.length<3)return null;
    return {points:hull.map(p=>({x:p.x/scale,y:p.y/scale})),confidence:Math.min(.9,mask.length/Math.max(1,(w/stride)*(h/stride))+.25)};
  }
  // Infer symmetry only across a visible central gap and a strong one-to-one consensus.
  // Average each pair so neither photographed half is treated as the perfect reference.
  function alignSplit(keys) {
    const unchanged={keys,symmetry:null},actual=keys.filter(k=>!k.decal).slice().sort((a,b)=>a.x-b.x);
    if(actual.length<12||actual.length>500)return unchanged;
    const angleSum=(a,b)=>{
      const period=a.w===a.h&&b.w===b.h?90:180;
      return ((a.angle+b.angle+period/2)%period+period)%period-period/2;
    };
    const compatible=(a,b)=>a.w===b.w&&a.h===b.h&&Math.abs(angleSum(a,b))<=15;
    const fit=(left,right,initialAxis,initialDelta)=>{
      let axis=initialAxis,delta=initialDelta,pairs=[];
      const nearest=(a,others,sign)=>{
        const options=others.filter(b=>compatible(a,b)).map(b=>({key:b,distance:Math.hypot(a.x+b.x-2*axis,a.y-b.y-sign*delta)})).filter(b=>b.distance<=.6).sort((a,b)=>a.distance-b.distance);
        if(!options.length||options[1]&&options[1].distance-options[0].distance<.15)return null;
        return options[0].key;
      };
      const match=()=>{
        const forwards=new Map(left.map(a=>[a,nearest(a,right,1)])),backwards=new Map(right.map(b=>[b,nearest(b,left,-1)]));
        return left.filter(a=>forwards.get(a)&&backwards.get(forwards.get(a))===a).map(a=>({left:a,right:forwards.get(a)}));
      };
      for(let i=0;i<3;i++){
        pairs=match();if(pairs.length<6)return null;
        axis=median(pairs.map(p=>(p.left.x+p.right.x)/2));
        delta=median(pairs.map(p=>p.left.y-p.right.y));
      }
      if(Math.abs(delta)>.75||axis<=left[left.length-1].x+.25||axis>=right[0].x-.25)return null;
      pairs=match().filter(p=>Math.hypot(p.left.x+p.right.x-2*axis,p.left.y-p.right.y-delta)<=.45);
      const coverage=pairs.length/Math.max(left.length,right.length);
      if(pairs.length<6||coverage<.85)return null;
      const residual=pairs.reduce((s,p)=>s+Math.hypot(p.left.x+p.right.x-2*axis,p.left.y-p.right.y-delta),0)/pairs.length;
      return {axis,pairs,score:coverage-residual*.1};
    };
    let best=null;
    for(let i=6;i<=actual.length-6;i++){
      const gap=actual[i].x-actual[i-1].x;
      if(gap<1.6||Math.min(i,actual.length-i)/Math.max(i,actual.length-i)<.85)continue;
      const left=actual.slice(0,i),right=actual.slice(i);
      if([left,right].some(side=>side[side.length-1].x-side[0].x<1.5||Math.max(...side.map(k=>k.y))-Math.min(...side.map(k=>k.y))<1.5))continue;
      const axes=[(actual[0].x+actual[actual.length-1].x)/2,(actual[i-1].x+actual[i].x)/2];
      const deltas=[0,median(left.map(k=>k.y))-median(right.map(k=>k.y))];
      for(const axis of axes)for(const delta of deltas){
        const result=fit(left,right,axis,delta);
        if(result&&(!best||result.score>best.score))best=result;
      }
    }
    if(!best)return unchanged;
    const axis=KB.round(best.axis),updates=new Map();
    for(const {left,right} of best.pairs){
      const half=(right.x-left.x)/2,y=KB.round((left.y+right.y)/2),angle=KB.round(left.angle-angleSum(left,right)/2);
      updates.set(left,{x:KB.round(axis-half),y,angle});
      updates.set(right,{x:KB.round(axis+half),y,angle:-angle});
    }
    const aligned=keys.map(k=>({...k,...updates.get(k)}));
    try{KB.checkKeys(aligned);}catch(_){return unchanged;}
    const shapes=aligned.filter(k=>!k.decal).map(k=>({key:k,points:KB.rectangle(k.x,k.y,k.w-.05,k.h-.05,k.angle)}));
    const moved=new Set(best.pairs.flatMap(p=>[p.left.id,p.right.id]));
    for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++){
      if((moved.has(shapes[i].key.id)||moved.has(shapes[j].key.id))&&KB.intersects(shapes[i].points,shapes[j].points))return unchanged;
    }
    return {keys:aligned,symmetry:{axis,pairCount:best.pairs.length,unmatched:actual.length-best.pairs.length*2}};
  }
  function toLayout(boxes,words=[],pitchOverride=0,options={}) {
    if(!boxes.length)throw Error('暂未识别到键帽。请裁剪到键盘区域、调高灵敏度，或用“描键”逐个标注。');
    const short=median(boxes.map(c=>Math.min(c.w,c.h)));
    const gaps=boxes.map(k=>Math.min(...boxes.filter(o=>o!==k).map(o=>distance(k,o)))).filter(d=>d>short*.8&&d<short*1.8);
    const pitch=pitchOverride||median(gaps.length?gaps:[short*1.15]);
    const originX=Math.min(...boxes.map(c=>c.x))-pitch*.5,originY=Math.min(...boxes.map(c=>c.y))-pitch*.5;
    const normalizeAngle=value=>{while(value>45)value-=90;while(value<=-45)value+=90;return value;};
    let angles=boxes.map(c=>normalizeAngle(c.angle));
    // Vision can skew adjacent contours together. Require three nearby angles to
    // agree, then use a second simultaneous pass to repair a neighbouring outlier.
    // A thumb fan without that consensus keeps its individual angles.
    for(let pass=0;pass<2;pass++)angles=boxes.map((c,i)=>{
      const nearby=boxes.map((b,j)=>({angle:angles[j],distance:distance(b,c),index:j})).filter(b=>b.index!==i&&b.distance<pitch*1.45).sort((a,b)=>a.distance-b.distance).slice(0,4);
      const ordered=nearby.map(b=>b.angle).sort((a,b)=>a-b),groups=[];
      for(let j=0;j<=ordered.length-3;j++){
        const group=ordered.slice(j,j+3);
        if(group[2]-group[0]<6)groups.push(group);
      }
      if(!groups.length)return angles[i];
      const consensus=median(groups.sort((a,b)=>(a[2]-a[0])-(b[2]-b[0]))[0]);
      return Math.abs(angles[i]-consensus)>12?consensus:angles[i];
    });
    const keys=boxes.map((c,i)=>{
      const near=words.filter(w=>Math.abs(w.x-c.x)<c.w*.45&&Math.abs(w.y-c.y)<c.h*.45).sort((a,b)=>b.confidence-a.confidence)[0];
      const angle=angles[i];
      const w=c.w>short*1.4?Math.max(1,Math.round((c.w/pitch+.12)*4)/4):1;
      const h=c.h>short*1.4?Math.max(1,Math.round((c.h/pitch+.12)*4)/4):1;
      return KB.key({label:near?near.label:'',labelSource:near?.label?'recognized':'placeholder',x:(c.x-originX)/pitch,y:(c.y-originY)/pitch,w,h,angle:Math.round(angle*2)/2,confidence:c.confidence});
    });
    // Pixel regions let the native side read each keycap legend after the layout is shown.
    const regions=boxes.map((c,i)=>({id:keys[i].id,x:c.x,y:c.y,w:c.w,h:c.h,angle:angles[i]}));
    const result=options.splitSymmetry===false?{keys,symmetry:null}:alignSplit(keys);
    result.keys.sort((a,b)=>a.y-b.y||a.x-b.x);
    result.keys.forEach((k,i)=>{if(!k.label)k.label=String(i+1);});
    return {...result,regions,pitch,originX,originY};
  }
  const api={candidate,components,filter,outlineFromImage,toLayout,alignSplit,median};
  if(typeof module!=='undefined')module.exports=api;else root.Recognition=api;
})(typeof window!=='undefined'?window:globalThis);
