const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','timeline-axis.js'),'utf8');

test('year axis reaches the last year beyond the visible carousel',()=>{
  const values={};
  const years=[{offsetLeft:4,offsetWidth:34},{offsetLeft:500,offsetWidth:34}];
  const track={clientWidth:250,querySelectorAll:()=>years,style:{setProperty(key,value){values[key]=value}}};
  vm.runInNewContext(source,{
    document:{getElementById:()=>track,fonts:{ready:Promise.resolve()}},
    window:{addEventListener(){}},
    MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}},
    requestAnimationFrame:callback=>{callback();return 1},cancelAnimationFrame(){}
  });
  assert.equal(values['--timeline-axis-left'],'21px');
  assert.equal(values['--timeline-axis-width'],'496px');
  assert.ok(parseInt(values['--timeline-axis-width'],10)>track.clientWidth);
});
