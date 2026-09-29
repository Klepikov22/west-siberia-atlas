// Exercise the production selection functions without loading the full browser UI.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function functionSource(name){
  const start=source.indexOf(`function ${name}(`);
  assert.ok(start>=0,`Missing function: ${name}`);
  let depth=0, opening=false;
  for(let i=source.indexOf('{',start);i<source.length;i++){
    if(source[i]==='{'){depth++;opening=true;}
    if(source[i]==='}' && --depth===0 && opening) return source.slice(start,i+1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const names=['selectionOperation','featureMatchesSelection','featureIntersectsRing',
  'getPolygonRings','pointInFeaturePolygon','pointInPolygonWithHoles','pointInRing',
  'orient','onSegment','segmentsIntersect','boundsToLngLatRing','applyIds',
  'applySpatialSelectionByBounds','applySpatialSelectionByPolygon'];
const selection={value:'replace'}, spatial={value:'intersects'};
const state={selectedIds:new Set(),layers:{admin:null}};
const context=vm.createContext({
  state,$:id=>id==='selectionOperation'?selection:id==='selectionSpatialRule'?spatial:null,
  isSelectableFeature:f=>f.properties.include_in_selection!==false,
  featureId:f=>f.properties.unit_id,
  refreshSelectionStyles(){},updateStatsAndSelection(){},
  L:{latLngBounds:points=>({intersects:()=>true,points})}
});
vm.runInContext(names.map(functionSource).join('\n'),context);
const poly=(id,x,y,w=1,h=1,selectable=true)=>({properties:{unit_id:id,include_in_selection:selectable},geometry:{type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]}});
const west=poly('west',0,0),east=poly('east',2,0),excluded=poly('excluded',0.25,0.25,.1,.1,false);
const layers=[west,east,excluded].map(feature=>({feature,getBounds:()=>({intersects:()=>true})}));
state.layers.admin={eachLayer(fn){layers.forEach(fn)}};
const bounds=(x1,y1,x2,y2)=>({getSouthWest:()=>({lng:x1,lat:y1}),getNorthEast:()=>({lng:x2,lat:y2})});

test('rectangle uses geometry and excludes forbidden units',()=>{
  context.applySpatialSelectionByBounds(bounds(.2,.2,.3,.3),{});
  assert.deepEqual([...state.selectedIds],['west']);
  context.applySpatialSelectionByBounds(bounds(1.2,.2,1.8,.8),{});
  assert.deepEqual([...state.selectedIds],[]);
});

test('rectangle containment differs from intersection',()=>{
  spatial.value='within';
  context.applySpatialSelectionByBounds(bounds(.2,.2,1.2,1.2),{});
  assert.equal(state.selectedIds.size,0);
  context.applySpatialSelectionByBounds(bounds(-.2,-.2,1.2,1.2),{});
  assert.deepEqual([...state.selectedIds],['west']);
  context.applySpatialSelectionByBounds(bounds(0,0,1,1),{});
  assert.deepEqual([...state.selectedIds],['west']);
  spatial.value='intersects';
});

test('polygon, add/remove modes and keyboard overrides',()=>{
  context.applySpatialSelectionByBounds(bounds(-.1,-.1,1.1,1.1),{});
  selection.value='add';
  context.applySpatialSelectionByPolygon([{lng:1.9,lat:-.1},{lng:3.1,lat:-.1},{lng:3.1,lat:1.1},{lng:1.9,lat:1.1}],{});
  assert.deepEqual([...state.selectedIds].sort(),['east','west']);
  context.applySpatialSelectionByBounds(bounds(-.1,-.1,1.1,1.1),{altKey:true});
  assert.deepEqual([...state.selectedIds],['east']);
  selection.value='remove';
  context.applySpatialSelectionByBounds(bounds(-.1,-.1,1.1,1.1),{shiftKey:true});
  assert.deepEqual([...state.selectedIds].sort(),['east','west']);
  selection.value='replace';
});

test('polygon hole does not count as an interior hit',()=>{
  const doughnut={type:'Polygon',coordinates:[
    [[0,0],[4,0],[4,4],[0,4],[0,0]],
    [[1,1],[1,3],[3,3],[3,1],[1,1]]
  ]};
  const ring=[[1.4,1.4],[2.6,1.4],[2.6,2.6],[1.4,2.6],[1.4,1.4]];
  assert.equal(context.featureIntersectsRing({geometry:doughnut},ring),false);
});
