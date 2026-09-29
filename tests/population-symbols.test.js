const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=source.indexOf('function buildCircles(admin, gj){');
const end=source.indexOf('\nfunction buildLabels(',start);
assert.ok(start>=0 && end>start);

test('population circles use the visible Leaflet overlay and remain interactive',()=>{
  const markers=[];
  const feature={properties:{unit_id:'one',name:'Район',population:12000}};
  const context=vm.createContext({
    state:{layers:{}},
    clearLayer(){},hideHover(){},styleVars:()=>({circleLine:'#113355',circleFill:'#f8bb33'}),
    isAnalyticsFeature:()=>true,populationSymbolSize:()=>12,
    L:{layerGroup:()=>({addLayer(marker){markers.push(marker)}}),circleMarker:(center,options)=>({center,options,on(){},feature:null})}
  });
  vm.runInContext(source.slice(start,end),context);
  context.buildCircles({eachLayer(fn){fn({feature,getBounds(){return {getCenter(){return {lat:58,lng:82}}}}})}}, {features:[feature]});
  assert.equal(markers.length,1);
  assert.equal(markers[0].options.pane,undefined);
  assert.equal(markers[0].options.interactive,true);
  assert.equal(markers[0].options.bubblingMouseEvents,false);
  assert.equal(markers[0].feature,feature);
});
