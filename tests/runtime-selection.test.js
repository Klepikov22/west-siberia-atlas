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

test('admin hover and selection do not move polygon above population symbol',()=>{
  let moved=0;
  const admin={feature:features[0],setStyle(){},bringToFront(){moved++}};
  state.adminLayerById=new Map([['a',admin]]);
  context.adminStyle=()=>({weight:1,fillOpacity:.65});
  context.regionStyleConfig=()=>({weight:1});
  runtime.showHover=()=>{};
  state.tool='pan';
  runtime.onAdminEnter('a',admin,{originalEvent:{clientX:10,clientY:10}});
  state.selectedIds.add('a');
  runtime.applyAdminVisualState('a');
  assert.equal(moved,0);
  runtime.onAdminLeave('a');
  state.selectedIds.clear();
});
