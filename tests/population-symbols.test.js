const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

require('../population-symbols.js');
const {create}=globalThis.AtlasPopulationSymbols;
// EventTarget supplies real event dispatch; this small DOM/map harness verifies
// the layer lifecycle and events without claiming browser paint/hit testing.
class Element extends EventTarget{
  constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.style={};this.dataset={};this.attrs={};this.hidden=false;this.classes=new Set();
    this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
  append(...nodes){nodes.forEach(node=>this.appendChild(node));}
  appendChild(node){node.parentNode=this;this.children.push(node);return node;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(name,value){this.attrs[name]=value;}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
}
class BaseLayer{
  static extend(methods){class Derived extends this{constructor(){super();methods.initialize.call(this);}};Object.assign(Derived.prototype,methods);return Derived;}
  addTo(map){map.addLayer(this);return this;}
  remove(){if(this._map)this._map.removeLayer(this);return this;}
}
const L={Layer:BaseLayer};
function mapHarness(){
  const doc={createElement:tag=>new Element(doc,tag)};
  const container=doc.createElement('div'),listeners=new Map(),layers=new Set();
  return {container,listeners,offset:0,dragging:{moved:()=>false},
    getContainer:()=>container,getSize:()=>({x:800,y:600}),
    latLngToContainerPoint(ll){return {x:ll.lng+this.offset,y:ll.lat};},
    addLayer(layer){layers.add(layer);layer._map=this;layer.onAdd(this);},
    removeLayer(layer){if(layers.delete(layer)){layer.onRemove(this);layer._map=null;}},
    hasLayer:layer=>layers.has(layer),
    on(names,fn){for(const name of names.split(' ')){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);}},
    off(names,fn){for(const name of names.split(' '))listeners.get(name)?.delete(fn);},
    fire(name){listeners.get(name)?.forEach(fn=>fn());}
  };
}
function event(type,fields={}){const e=new Event(type,{cancelable:true});Object.assign(e,{clientX:200,clientY:200,detail:1,...fields});return e;}
let nextFrame=1;
const frames=new Map();
globalThis.requestAnimationFrame=fn=>{const id=nextFrame++;frames.set(id,fn);return id;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
function flushFrames(){const queued=[...frames.values()];frames.clear();queued.forEach(fn=>fn());}
const feature={properties:{unit_id:'one',name:'Томский район',population:12000,year:1914,admin_parent:'Томская губерния'}};
function fixture(){
  const map=mapHarness(),selected=new Set();let tool='pan',calls=0;
  const config={items:[{feature,latlng:{lat:200,lng:200},radius:12}],style:{color:'#333',fillColor:'#fb5',fillOpacity:.74},
    getTool:()=>tool,getYear:()=>1914,isSelected:f=>selected.has(f.properties.unit_id),
    onSelect(f){calls++;selected.add(f.properties.unit_id);}};
  const layer=create(L,config).addTo(map);
  return {map,layer,selected,config,setTool:t=>{tool=t;layer.setTool();},calls:()=>calls,button:layer.getLayers()[0].getElement()};
}

test('population tooltip belongs to its DOM layer and survives unrelated SVG changes',()=>{
  const {map,layer,button}=fixture();
  const polygon=map.container.ownerDocument.createElement('svg');map.container.append(polygon);
  button.dispatchEvent(event('pointerenter'));
  assert.equal(layer._tooltip.hidden,false);
  assert.match(layer._tooltip.children.map(el=>el.textContent).join(' '),/Томский район.*12\s000.*1914/);
  assert.equal(button.parentNode.parentNode,map.container);
  assert.notEqual(button.parentNode,polygon);
  button.dispatchEvent(event('pointerleave'));
  assert.equal(layer._tooltip.hidden,true);
});

test('population click selects once, stops bubbling and updates selection style',()=>{
  const {layer,button,calls}=fixture();const click=event('click');
  button.dispatchEvent(click);
  assert.equal(calls(),1);assert.equal(click.defaultPrevented,true);
  assert.equal(button.attrs['aria-pressed'],'true');
  assert.equal(button.style.borderColor,'#163e73');
  layer.syncSelection();assert.equal(calls(),1);
});

test('rectangle and polygon release pointer events and disable button activation',()=>{
  const f=fixture();
  for(const mode of ['rectangle','polygon']){
    f.setTool(mode);f.button.dispatchEvent(event('pointerenter'));f.button.dispatchEvent(event('click'));
    assert.equal(f.button.disabled,true);assert.equal(f.button.style.pointerEvents,'none');
    assert.equal(f.layer._tooltip.hidden,true);assert.equal(f.calls(),0);
  }
  f.setTool('parent');f.button.dispatchEvent(event('click',{detail:0}));assert.equal(f.calls(),1);
});

test('dragging a population symbol does not select it; keyboard activation still works',()=>{
  const {button,calls}=fixture();
  button.dispatchEvent(event('pointerdown'));
  button.dispatchEvent(event('pointermove',{clientX:240}));
  button.dispatchEvent(event('pointerup',{clientX:240}));button.dispatchEvent(event('click'));
  assert.equal(calls(),0);
  button.dispatchEvent(event('focus'));button.dispatchEvent(event('click',{detail:0}));assert.equal(calls(),1);
});

test('hide, re-enable and year replacement remove DOM and map subscriptions',()=>{
  const {layer,map,config}=fixture();
  assert.equal(map.container.children.length,2);
  const first=layer.getLayers()[0].getElement();map.fire('move');layer.remove();
  assert.equal(frames.size,0);
  assert.equal(map.container.children.length,0);assert.equal(layer.getLayers()[0].getElement(),null);
  assert.equal([...map.listeners.values()].reduce((n,set)=>n+set.size,0),0);
  layer.addTo(map);assert.equal(map.container.children.length,2);assert.notEqual(layer.getLayers()[0].getElement(),first);
  layer.remove();
  config.items=[{feature:{properties:{...feature.properties,year:1959,population:24000}},latlng:{lat:100,lng:300},radius:20}];
  const next=create(L,config).addTo(map);next.getLayers()[0].getElement().dispatchEvent(event('pointerenter'));
  assert.match(next._tooltip.children.map(el=>el.textContent).join(' '),/24\s000.*1959/);
  assert.equal(map.container.children.length,2);
});

test('pan, resize, offscreen culling and theme style updates retain selection',()=>{
  const f=fixture();f.button.dispatchEvent(event('click'));
  f.map.offset=50;f.map.fire('move');flushFrames();assert.match(f.button.style.transform,/250px/);
  f.map.offset=900;f.map.fire('resize');flushFrames();assert.equal(f.button.hidden,true);
  f.map.fire('zoomstart');assert.equal(f.layer._root.style.visibility,'hidden');
  f.map.fire('zoomend');flushFrames();assert.equal(f.layer._root.style.visibility,'');
  f.layer.getLayers()[0].setStyle({color:'#eee',fillColor:'#d90'});
  assert.equal(f.button.style.backgroundColor,'#d90');assert.equal(f.button.attrs['aria-pressed'],'true');
});

test('app builder filters invalid population and keeps the runtime selection callback',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const start=source.indexOf('function buildCircles(admin, gj){'),end=source.indexOf('\nfunction buildLabels(',start);
  const features=[12000,0,-1,null,Infinity].map((population,i)=>({properties:{unit_id:String(i),population}}));
  features.push({properties:{population:800,include_in_analytics:false}});
  let chosen=null;
  const context=vm.createContext({L,AtlasPopulationSymbols:globalThis.AtlasPopulationSymbols,
    state:{layers:{},tool:'pan',year:1914,selectedIds:new Set()},
    window:{__WS_ATLAS_RUNTIME_V149__:{selectAdminFeature:f=>{chosen=f}}},
    clearLayer(){},styleVars:()=>({circleLine:'#333',circleFill:'#fb5'}),
    hideHover(){},
    isAnalyticsFeature:f=>f.properties.include_in_analytics!==false,populationSymbolSize:()=>12,
    featureId:f=>f.properties.unit_id});
  vm.runInContext(source.slice(start,end),context);
  context.buildCircles({eachLayer(fn){features.forEach(feature=>fn({feature,getBounds:()=>({getCenter:()=>({lat:200,lng:200})})}));}},{features});
  const layer=context.state.layers.circles;assert.equal(layer.getLayers().length,1);
  layer.addTo(mapHarness());layer.getLayers()[0].getElement().dispatchEvent(event('click'));
  assert.equal(chosen,features[0]);assert.equal(context.state.maxPop,12000);
});

test('runtime checkbox controls the new layer even when administrative polygons are off',()=>{
  const map=mapHarness(),config={items:[{feature,latlng:{lat:200,lng:200},radius:12}],
    getTool:()=> 'pan',getYear:()=>1914,isSelected:()=>false,onSelect(){}};
  const layer=create(L,config),state={layers:{circles:layer}};
  const flags={toggleCircles:true,toggleAdmin:false};
  const code=fs.readFileSync(path.join(__dirname,'..','map-runtime.js'),'utf8');
  const begin=code.indexOf('class AtlasRuntimeV149 {'),end=code.indexOf('\n  const runtime=new AtlasRuntimeV149();',begin);
  const context=vm.createContext({state,isChecked:id=>!!flags[id],byId:()=>null,
    document:{querySelectorAll:()=>[]},window:{},HTMLElement:Element,SVGElement:Element,console});
  vm.runInContext(code.slice(begin,end)+'\nglobalThis.Runtime=AtlasRuntimeV149;',context);
  const runtime=new context.Runtime();runtime.map=map;runtime.updateLayerStatus=()=>{};runtime.scheduleLabels=()=>{};
  runtime.applyVisibility();assert.equal(map.hasLayer(layer),true);assert.equal(map.container.children.length,2);
  flags.toggleCircles=false;runtime.applyVisibility();assert.equal(map.hasLayer(layer),false);assert.equal(map.container.children.length,0);
  flags.toggleCircles=true;runtime.applyVisibility();assert.equal(map.hasLayer(layer),true);assert.equal(map.container.children.length,2);
});
