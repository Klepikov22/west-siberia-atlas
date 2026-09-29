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
let adminOn=true;
const info={textContent:'',classList:{add(){}}};
const context=vm.createContext({
  state,featureId:f=>f.properties.unit_id,
  isSelectableFeature:f=>f.properties.include_in_selection!==false,
  selectionOperation:event=>event?.shiftKey?'add':event?.altKey?'remove':operation,
  applyIds(ids,mode){if(mode==='replace') state.selectedIds=new Set(ids);if(mode==='add') ids.forEach(id=>state.selectedIds.add(id));if(mode==='remove') ids.forEach(id=>state.selectedIds.delete(id));},
  showFeature:f=>{shown=f},
  L:{DomEvent:{stopPropagation(){}}},
  document:{},window:{},byId:id=>id==='featureInfo'?info:null,
  AtlasGeometry:require('../atlas-geometry.js'),isChecked:()=>adminOn,
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

const square={type:'Feature',properties:{unit_id:'square',admin_parent:'Область'},
  geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}};
const click=(lng=10,lat=10,timeStamp=200)=>({latlng:{lng,lat},containerPoint:{x:lng*10,y:lat*10},originalEvent:{button:0,timeStamp}});

test('empty map click clears selection and feature card in all four tools',()=>{
  state.currentGeoJSON={features:[square]};
  for(const tool of ['pan','parent','rectangle','polygon']){
    state.tool=tool;state.selectedIds=new Set(['square']);state.polygonPoints=[];
    info.textContent='Свойства объекта';
    runtime.handleMapSelectionClick(click());
    assert.equal(state.selectedIds.size,0,tool);
    assert.equal(state.polygonPoints.length,0,tool);
    assert.match(info.textContent,/Выберите объект/);
  }
});

test('click inside a visible feature still selects it; invisible polygons do not prevent clearing',()=>{
  state.tool='pan';state.selectedIds=new Set();state.currentGeoJSON={features:[square]};
  runtime.handleMapSelectionClick(click(1,1));assert.deepEqual([...state.selectedIds],['square']);
  adminOn=false;runtime.handleMapSelectionClick(click(1,1));adminOn=true;
  assert.equal(state.selectedIds.size,0);
});

test('finishing a rectangle outside features does not immediately clear the result',()=>{
  state.tool='rectangle';state.currentGeoJSON={features:[square]};state.dragStart={lat:0,lng:0};
  runtime.map={latLngToContainerPoint(ll){return {x:ll.lng*10,y:ll.lat*10,distanceTo(other){return Math.hypot(this.x-other.x,this.y-other.y);}};}};
  runtime.mapContainer={classList:{remove(){}}};
  context.L.latLngBounds=()=>({});
  context.applySpatialSelectionByBounds=()=>{state.selectedIds=new Set(['square']);};
  runtime.completeRectangle({lat:10,lng:10},{timeStamp:100});
  runtime.handleMapSelectionClick(click(10,10,101));assert.equal(state.selectedIds.size,1);
  runtime.handleMapSelectionClick(click(10,10,400));assert.equal(state.selectedIds.size,0);
});

test('an in-progress polygon can cross empty map areas while clearing old selection',()=>{
  state.tool='polygon';state.currentGeoJSON={features:[square]};state.selectedIds=new Set(['square']);
  state.polygonPoints=[{lat:1,lng:1}];
  runtime.redrawPolygonSketch=()=>{};
  runtime.handleMapSelectionClick(click());
  assert.equal(state.selectedIds.size,0);assert.equal(state.polygonPoints.length,2);
});

test('middle and right clicks do not dismiss the selection',()=>{
  state.tool='pan';state.selectedIds=new Set(['square']);
  for(const button of [1,2]){const event=click();event.originalEvent.button=button;runtime.handleMapSelectionClick(event);}
  assert.equal(state.selectedIds.size,1);
});

test('empty click also clears a selected center and both hover overlays',()=>{
  state.tool='pan';state.selectedIds=new Set();state.currentGeoJSON={features:[square]};
  let centerStyle,legacyHidden=0,populationHidden=0;
  state.selectedCenterLayer={setStyle(style){centerStyle=style;}};
  runtime.hideHover=()=>{legacyHidden++;};
  state.layers={circles:{hideHover(){populationHidden++;}}};
  runtime.handleMapSelectionClick(click());
  assert.equal(state.selectedCenterLayer,null);
  assert.equal(centerStyle.weight,1.45);
  assert.equal(legacyHidden,1);assert.equal(populationHidden,1);
  state.layers={};
});
