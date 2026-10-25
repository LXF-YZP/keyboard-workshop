'use strict';
const KB=require('../../Web/core'),FW=require('../../Web/firmware');
module.exports=function project(){
 const p={version:1,name:'助手评测样例',options:{},features:[],image:null,keys:[],firmware:{version:1,target:'qmk',id:'fixture',displayName:'Fixture',controller:'rp2040',rows:3,cols:3,rowPins:[0,1,2],colPins:[3,4,5],diode:'col2row',layers:[{name:'Base'}]}};
 for(const side of ['left','right'])for(let r=0;r<3;r++)for(let c=0;c<3;c++)p.keys.push(KB.key({id:`${side}-${r}-${c}`,x:c+(side==='right'?7:0),y:r,label:`${side}-${r}-${c}`,fw:{side,row:r,col:c,bindings:[{t:'kc',k:'A',m:[]}]}}));
 FW.enableSplit(p.firmware,true);p.firmware.split.serialPin=6;p.firmware.split.right={rowPins:[0,1,2],colPins:[3,4,5]};return p;
};
