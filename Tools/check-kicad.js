#!/usr/bin/env node
'use strict';
// Optional integration check against a real KiCad 9+ installation. No app data or network access.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const K=require('../Web/kicad'),KB=require('../Web/core'),FW=require('../Web/firmware');
const cli=process.argv[2]||'kicad-cli',output=path.resolve(process.argv[3]||'build/kicad-verification');
fs.mkdirSync(output,{recursive:true});
function run(args){const result=spawnSync(cli,args,{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});if(result.error||result.status!==0)throw Error([result.error,result.stdout,result.stderr].filter(Boolean).join('\n'));return result.stdout.trim();}
const report={version:run(['version']),boards:[]},C=K.child,CS=K.children,V=K.value;
function fixture(topology,direction){
 const firmware=FW.sanitizeFirmware({target:'qmk',controller:'rp2040',id:'verify',rows:2,cols:2,rowPins:[26,27],colPins:[0,1],diode:direction});
 if(topology!=='single'){FW.enableSplit(firmware,true);Object.assign(firmware.split,{serialMode:topology,serialPin:8,serialRxPin:9,right:{rowPins:[26,27],colPins:[0,1]}});}
 const keys=(topology==='single'?['single']:['left','right']).flatMap(side=>Array.from({length:4},(_,i)=>KB.key({id:side+i,label:'K'+i,x:i%2+(side==='right'?7:0),y:Math.floor(i/2),angle:i===0?15:0,fw:{side:side==='single'?undefined:side,row:Math.floor(i/2),col:i%2}})));
 return {version:1,name:'KiCad CLI integration fixture',keys,firmware,features:[],options:{...KB.defaults,outline:topology==='single'?'rectangle':'split',mountHoles:0}};
}
const cases=[['single','col2row','sod123'],['single','row2col','do35'],['half_duplex','col2row','sod123'],['half_duplex','row2col','do35'],['full_duplex','col2row','do35'],['full_duplex','row2col','sod123']];
for(const [topology,direction,diode] of cases){
 const name=[topology,direction,diode].join('-'),g=K.generate(fixture(topology,direction),{diode});assert.deepEqual(g.errors,[],name);
 const dir=path.join(output,name);for(const f of g.files){const dst=path.join(dir,f.path);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,f.content);}
 for(const m of g.models){
  const base=path.join(dir,m.side==='single'?'':m.side,m.name),net=base+'.net',erc=base+'.erc.json',drc=base+'.drc.json';
  run(['sch','export','netlist',base+'.kicad_sch','-o',net]);
  run(['sch','erc','--format','json',base+'.kicad_sch','-o',erc]);
  run(['pcb','drc','--format','json','--schematic-parity',base+'.kicad_pcb','-o',drc]);
  // Rendering must show actual wires; a zero-width default stroke can disappear in CLI SVG.
  if(report.boards.length===0){
   const svgDir=path.join(dir,'svg');fs.mkdirSync(svgDir,{recursive:true});run(['sch','export','svg',base+'.kicad_sch','-o',svgDir+path.sep]);
   const svg=fs.readFileSync(path.join(svgDir,m.name+'.svg'),'utf8');
   const wire=svg.indexOf('<path d="M50.8000 40.6400');assert.ok(wire>=0,'rendered switch-to-diode wire');
   const style=svg.slice(svg.lastIndexOf('<g ',wire),wire);assert.match(style,/stroke:#[0-9a-fA-F]+;/,'wire has a visible stroke');
  }
  const actual=new Map();for(const n of CS(C(K.parse(fs.readFileSync(net,'utf8')),'nets'),'net'))for(const pin of CS(n,'node'))actual.set(V(C(pin,'ref')[1])+':'+V(C(pin,'pin')[1]),V(C(n,'name')[1]));
  let pads=0;for(const fp of CS(K.parse(fs.readFileSync(base+'.kicad_pcb','utf8')),'footprint')){const ref=CS(fp,'property').find(p=>V(p[1])==='Reference');if(!ref)continue;for(const p of CS(fp,'pad')){if(!V(p[1]))continue;const id=V(ref[2])+':'+V(p[1]);assert.equal(V(C(p,'net')[2]),actual.get(id),name+' '+id);pads++;}}
  assert.equal(pads,actual.size,'all netlist nodes represented by PCB pads');
  const e=JSON.parse(fs.readFileSync(erc,'utf8')),d=JSON.parse(fs.readFileSync(drc,'utf8'));
  assert.deepEqual(e.sheets.flatMap(s=>s.violations),[],name+' ERC');assert.deepEqual(d.schematic_parity,[],name+' schematic parity');
  // These drafts intentionally leave routing and silk cleanup to the PCB editor.
  const allowed=new Set(['silk_overlap','silk_over_copper']);assert.deepEqual(d.violations.filter(v=>!allowed.has(v.type)),[],name+' unexpected DRC');
  const counts={};for(const v of d.violations)counts[v.type]=(counts[v.type]||0)+1;
  report.boards.push({case:name,side:m.side,matchedPads:pads,erc:0,schematicParity:0,unrouted:d.unconnected_items.length,remainingDRC:counts});
  console.log('PASS',name,m.side,pads+' pad nets, ERC and schematic parity');
 }
}
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log('Validated',report.boards.length,'boards with KiCad',report.version);
