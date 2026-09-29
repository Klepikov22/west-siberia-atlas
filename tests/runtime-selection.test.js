const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','map-runtime.js'),'utf8');
const classStart=source.indexOf('class AtlasRuntimeV149 {');
const classEnd=source.indexOf('\n  const runtime=new AtlasRuntimeV149();',classStart);
assert.ok(classStart>=0 && classEnd>classStart);
const features=[
  {properties:{unit_id:'a',admin_parent:'Томская губерния'}},
  {properties:{unit_id:'b',admin_parent:'Томская губерния'}},
  {properties:{unit_id:'c',admin_parent:'Тобольская губерния'}},
  {properties:{unit_id:'x',admin_parent:'Томская губерния',include_in_selection:false}}
];
const state={tool:'pan',currentGeoJSON:{features},selectedIds:new Set()};
let shown=null,operation='replace';
const context=vm.createContext({
  state,featureId:f=>f.properties.unit_id,
  isSelectableFeature:f=>f.properties.include_in_selection!==false,
  selectionOperation:event=>event?.shiftKey?'add':event?.altKey?'remove':operation,
  applyIds(ids,mode){if(mode==='replace') state.selectedIds=new Set(ids);if(mode==='add') ids.forEach(id=>state.selectedIds.add(id));if(mode==='remove') ids.forEach(id=>state.selectedIds.delete(id));},
  showFeature:f=>{shown=f},
  L:{DomEvent:{stopPropagation(){}}},
  document:{},window:{},byId:()=>null,
  fmt:new Intl.NumberFormat('ru-RU'),finite:value=>Number.isFinite(Number(value))?Number(value):null,
  requestAnimationFrame:callback=>callback()
});
vm.runInContext(source.slice(classStart,classEnd)+'\nglobalThis.TestRuntime=AtlasRuntimeV149;',context);
const runtime=new context.TestRuntime();
runtime.applyAdminVisualStates=()=>{};
runtime.scheduleLabels=()=>{};
runtime.flashSelectionCount=()=>{};

test('cursor click shows the object and creates a single selection',()=>{
  state.tool='pan';operation='replace';
  runtime.onAdminClick({feature:features[0]},{originalEvent:{}});
  assert.deepEqual([...state.selectedIds],['a']);
  assert.equal(shown,features[0]);
});

test('ATE-1 click groups only currently visible selectable units',()=>{
  state.tool='parent';
  runtime.onAdminClick({feature:features[1]},{originalEvent:{}});
  assert.deepEqual([...state.selectedIds],['a','b']);
  operation='remove';
  runtime.onAdminClick({feature:features[0]},{originalEvent:{}});
  assert.deepEqual([...state.selectedIds],[]);
  operation='replace';
});

test('nonselectable unit can show information without joining selection',()=>{
  state.tool='pan';
  runtime.onAdminClick({feature:features[2]},{originalEvent:{}});
  runtime.onAdminClick({feature:features[3]},{originalEvent:{}});
  assert.deepEqual([...state.selectedIds],['c']);
  assert.equal(shown,features[3]);
});

test('population symbol shows a hover card and selects its administrative unit',()=>{
  const handlers={};
  const layer={feature:{properties:{unit_id:'a',name:'Томский район',population:12000,year:1914}},
    options:{color:'#633',weight:1.65,fillColor:'#fb5',fillOpacity:.74,opacity:.98},
    radius:9,getRadius(){return this.radius},setRadius(value){this.radius=value},
    setStyle(style){Object.assign(this.options,style)},off(){},on(name,handler){handlers[name]=handler},
    getElement(){return null}
  };
  state.layers={circles:{eachLayer(fn){fn(layer)},hasLayer(candidate){return candidate===layer}}};
  let hover=null;
  runtime.showHover=content=>{hover=content};
  runtime.hideHover=()=>{hover=null};
  runtime.bindCircleInteractions();
  state.tool='pan';operation='replace';
  handlers.mouseover({originalEvent:{clientX:20,clientY:20}});
  assert.equal(hover.title,'Томский район');
  assert.equal(layer.radius,11.4);
  handlers.click({originalEvent:{}});
  assert.deepEqual([...state.selectedIds],['a']);
  assert.equal(shown,layer.feature);
  handlers.mouseout();
  assert.equal(layer.radius,10.1);
});
