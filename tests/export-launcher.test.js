const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const begin=source.lastIndexOf('function positionFloatingExportLauncherV48(){');
const end=source.indexOf('\n(function initV51Patch()',begin);
assert.ok(begin>=0 && end>begin);

test('export launcher stays below the status bar across viewport and panel changes',()=>{
  for(const [width,height] of [[1920,1080],[1366,768],[1280,720]]){
    const button={style:{},offsetWidth:160,offsetHeight:34,classList:{add(){}}};
    let header={height:50,bottom:64},rightPanel=true;
    const context=vm.createContext({window:{innerWidth:width,innerHeight:height},
      document:{getElementById(id){return id==='floatingExportLauncher'?button:id==='mapTopbar'?{getBoundingClientRect:()=>header}:id==='rightPanel'&&rightPanel?{getBoundingClientRect:()=>({left:width-340,top:8})}:null;}}});
    vm.runInContext(source.slice(begin,end),context);
    context.positionFloatingExportLauncherV48();assert.equal(parseFloat(button.style.top),76);
    header={height:100,bottom:114};context.positionFloatingExportLauncherV48();assert.equal(parseFloat(button.style.top),126);
    rightPanel=false;context.positionFloatingExportLauncherV48();assert.equal(parseFloat(button.style.top),126);
    assert.ok(parseFloat(button.style.top)>header.bottom);
  }
});
