const APP_VERSION = '7';
const fmt = new Intl.NumberFormat('ru-RU');
const $ = (id) => document.getElementById(id);

const state = {
  manifest:null, year:null, mode:'admin_parent', theme:'light',
  layers:{}, cache:{}, map:null, colors:{}, selectedIds:new Set(), adminLayerById:new Map(),
  currentGeoJSON:null, _lastVals:[], labelItems:[], selectedFeature:null,
  tool:'pan', dragStart:null, dragRect:null, polygonPoints:[], polygonLine:null, polygonMarkers:null
};

const palette = ['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#d9d9d9'];
const ramp = ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#3182bd','#08519c'];

function valueColor(v, values){
  if(v==null||Number.isNaN(v)) return '#a7adb8';
  const sorted=values.filter(x=>x!=null&&!Number.isNaN(x)).sort((a,b)=>a-b);
  if(!sorted.length) return '#808080';
  const pos=sorted.findIndex(x=>x>=v);
  const q=pos<0?1:pos/(sorted.length-1||1);
  return ramp[Math.max(0, Math.min(ramp.length-1, Math.floor(q*(ramp.length-1))))];
}
function catColor(v){ if(!v) return '#9a958d'; if(!state.colors[v]) state.colors[v]=palette[Object.keys(state.colors).length%palette.length]; return state.colors[v]; }
function num(v){ return v==null||Number.isNaN(Number(v)) ? '—' : fmt.format(Math.round(Number(v))); }
function num1(v){ return v==null||Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(1).replace('.',','); }
function pct(v){ return v==null||Number.isNaN(Number(v)) ? '—' : (Number(v)*100).toFixed(1).replace('.',',')+'%'; }
function fetchUrl(path){ return `${path}${path.includes('?')?'&':'?'}v=${APP_VERSION}`; }
async function loadJson(path){ if(state.cache[path]) return state.cache[path]; const r=await fetch(fetchUrl(path), {cache:'no-store'}); if(!r.ok) throw new Error(`${r.status} ${path}`); const j=await r.json(); state.cache[path]=j; return j; }
function featureId(f){ return f.properties.unit_id || `${f.properties.year}_${f.properties.raw_objectid || f.properties.name}`; }
function valField(){ return state.mode==='population'?'population':state.mode==='density'?'density':state.mode==='urban_share'?'urban_share':null; }

function themeStyle(){
  const dark = state.theme === 'dark';
  return {
    river: dark ? '#58bde7' : '#4da8c7',
    waterFill: dark ? '#12384f' : '#d8edf1',
    waterLine: dark ? '#66c9f0' : '#6eb4c9',
    adminLine: dark ? '#d9c29c' : '#746a5c',
    selectedLine: '#a65b00',
    railway: dark ? '#f3e7d0' : '#18130e',
    adminFillOpacity: dark ? .46 : .43,
    circleLine: dark ? '#2f210b' : '#6d4f1a',
    circleFill: '#d9a441'
  };
}

async function init(){
  document.documentElement.dataset.theme = state.theme;
  state.manifest = await loadJson('data/manifest.json');
  state.year = state.manifest.years.includes(1914)?1914:state.manifest.years[0];
  setYearLabels(); buildTimeline();
  const b = state.manifest.map_bounds_4326_expanded_200km || [57.411848,42.485993,92.272637,74.021644];
  state.dataBounds = L.latLngBounds([[b[1],b[0]],[b[3],b[2]]]);
  state.softBounds = state.dataBounds.pad(0.22);
  state.map = L.map('map', {
    zoomControl:true,
    preferCanvas:false,
    minZoom:3.5,
    zoomSnap:0.25,
    zoomDelta:0.45,
    scrollWheelZoom:'center',
    doubleClickZoom:'center',
    touchZoom:'center',
    wheelPxPerZoomLevel:240,
    wheelDebounceTime:55,
    inertia:true,
    inertiaDeceleration:4200,
    easeLinearity:0.16,
    zoomAnimation:false,
    markerZoomAnimation:false,
    fadeAnimation:false,
    worldCopyJump:false,
    bounceAtZoomLimits:false
  });
  createPanes(); applyPaneOrder();
  state.map.fitBounds(state.dataBounds, {padding:[18,18], animate:false, maxZoom:5});
  if(state.map.getZoom() < 3.5) state.map.setZoom(3.5, {animate:false});
  L.control.scale({imperial:false}).addTo(state.map);
  bindSelectionHandlers();
  state.map.on('dragend', () => {
    const c = state.map.getCenter();
    if(!state.softBounds.contains(c)) state.map.panInsideBounds(state.dataBounds, {animate:true, duration:.35, easeLinearity:.16});
  });
  state.map.on('zoomend moveend', updateLabelsVisibility);
  bindUi();
  await refreshAll();
  setTimeout(()=>state.map.invalidateSize(),250);
  window.addEventListener('resize', () => setTimeout(()=>{state.map.invalidateSize(); updateLabelsVisibility();},120));
}

function createPanes(){
  const panes = ['riversPane','waterPane','adminPane','railwayPane','circlesPane','centersPane','labelsPane','selectionPane'];
  panes.forEach(name=>{ if(!state.map.getPane(name)) state.map.createPane(name); });
  state.map.getPane('labelsPane').classList.add('leaflet-label-pane');
  ['riversPane','waterPane','labelsPane','selectionPane'].forEach(p=>state.map.getPane(p).style.pointerEvents='none');
}
function applyPaneOrder(){
  const z = { riversPane:200, waterPane:225, adminPane:360, railwayPane:520, circlesPane:650, centersPane:690, labelsPane:730, selectionPane:780 };
  Object.entries(z).forEach(([pane,val])=>{ if(state.map && state.map.getPane(pane)) state.map.getPane(pane).style.zIndex=val; });
}
function bindUi(){
  const on = (id, event, handler) => { const el=$(id); if(el) el.addEventListener(event, handler); };
  on('modeSelect','change', async e=>{state.mode=e.target.value; await refreshAdmin();});
  on('themeSelect','change', e=>{state.theme=e.target.value; document.documentElement.dataset.theme=state.theme; refreshVectorStyles(); updateLabelsVisibility();});
  on('toolSelect','change', e=>setTool(e.target.value));
  on('finishPolygon','click', finishPolygonSelection);
  on('cancelSelectionDraw','click', clearSelectionDrawing);
  ['toggleHydro','toggleCenters','toggleRailways','toggleCircles','toggleLabels'].forEach(id=>on(id,'change', refreshVisibility));
  on('resetView','click', ()=> state.map.flyToBounds(state.dataBounds, {duration:.55, easeLinearity:.16, padding:[18,18], maxZoom:5}));
  on('clearSelection','click', ()=>{state.selectedIds.clear(); refreshSelectionStyles(); updateStatsAndSelection();});
  on('selectAll','click', ()=>{ if(!state.currentGeoJSON) return; state.selectedIds = new Set(state.currentGeoJSON.features.map(featureId)); refreshSelectionStyles(); updateStatsAndSelection(); });
}
function setYearLabels(){ const a=$('activeYearLabel'), t=$('timelineYearLabel'); if(a) a.textContent=state.year; if(t) t.textContent=state.year; }
function buildTimeline(){
  const track=$('yearTimeline'); if(!track) return; track.innerHTML='';
  state.manifest.years.forEach(y=>{
    const btn=document.createElement('button'); btn.type='button'; btn.className='timeline-year'; btn.dataset.year=String(y);
    btn.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${y}</span>`;
    btn.addEventListener('click', async ()=>{ if(state.year===y) return; state.year=y; setYearLabels(); updateTimelineActive(); state.selectedIds.clear(); await refreshAll(); });
    track.appendChild(btn);
  }); updateTimelineActive();
}
function updateTimelineActive(){ document.querySelectorAll('.timeline-year').forEach(b=>b.classList.toggle('active', Number(b.dataset.year)===state.year)); }
function clearLayer(name){ if(state.layers[name]){ state.map.removeLayer(state.layers[name]); state.layers[name]=null; }}
async function refreshAll(){ await refreshHydro(); await refreshAdmin(); await refreshCenters(); await refreshRailways(); refreshVisibility(); updateStatsAndSelection(); }

function isReservoirFeature(f){
  const p=f.properties||{}; if(p.water_kind==='ocean') return false;
  const text=Object.values(p).join(' ').toLowerCase();
  return p.reservoir===1 || p.reservoir===true || String(p.reservoir).toLowerCase()==='true' || text.includes('reservoir') || text.includes('водохранилище') || text.includes('vodokhran');
}
async function refreshHydro(){
  clearLayer('rivers'); clearLayer('water'); applyPaneOrder(); const t=themeStyle();
  const showReservoirs = Number(state.year) >= 1959;
  const rivers=await loadJson(state.manifest.layers.hydro.rivers);
  const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
  const water={type:'FeatureCollection', features:waterRaw.features.filter(f=>showReservoirs || !isReservoirFeature(f))};
  state.layers.rivers=L.geoJSON(rivers,{pane:'riversPane', interactive:false, style:f=>({color:t.river, weight: Math.max(.45, Number(f.properties.strokeweig||1.0)), opacity: state.theme==='light'?.62:.75})});
  state.layers.water=L.geoJSON(water,{pane:'waterPane', interactive:false, style:f=>{
    const ocean=(f.properties||{}).water_kind==='ocean';
    return {color:t.waterLine, weight:ocean?1.0:.8, opacity:ocean?.72:.82, fillColor:t.waterFill, fillOpacity:ocean?(state.theme==='light'?.50:.46):(state.theme==='light'?.70:.58)};
  }});
}
function adminStyle(feature, vals){
  const p=feature.properties; let fill='#999';
  if(state.mode==='admin_parent') fill=catColor(p.admin_parent);
  if(state.mode==='unit_type') fill=catColor(p.unit_type);
  if(state.mode==='population') fill=valueColor(Number(p.population), vals);
  if(state.mode==='density') fill=valueColor(Number(p.density), vals);
  if(state.mode==='urban_share') fill=valueColor(Number(p.urban_share), vals);
  const t=themeStyle(); const selected=state.selectedIds.has(featureId(feature));
  return {color:selected?t.selectedLine:t.adminLine, weight:selected?2.8:1.0, opacity:selected?1:.84, fillColor:fill, fillOpacity:selected?Math.min(.64,t.adminFillOpacity+.13):t.adminFillOpacity};
}
async function refreshAdmin(){
  clearLayer('admin'); clearLayer('circles'); clearLayer('labels'); state.adminLayerById.clear(); state.labelItems=[];
  const path=state.manifest.layers.admin[String(state.year)]; const gj=await loadJson(path); state.currentGeoJSON=gj;
  const field=valField(); const vals=field?gj.features.map(f=>Number(f.properties[field])).filter(v=>!Number.isNaN(v)):[]; state._lastVals=vals;
  const admin=L.geoJSON(gj,{pane:'adminPane', style:f=>adminStyle(f,vals), onEachFeature:(f,l)=>{
    const id=featureId(f); state.adminLayerById.set(id,l);
    l.on('click',()=>{ if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f);});
    l.on('mouseover',()=>{ if(!state.selectedIds.has(id)) l.setStyle({weight:1.8, opacity:1}); });
    l.on('mouseout',()=>{ refreshSelectionStylesFor(id); });
  }});
  state.layers.admin=admin;
  buildCircles(admin, gj); buildLabels(admin, gj);
  updateLegend(gj, vals); refreshVisibility(); updateStatsAndSelection();
}
function buildCircles(admin, gj){
  const t=themeStyle(); const maxPop=Math.max(...gj.features.map(f=>Number(f.properties.population)||0),1); const minPop=Math.min(...gj.features.map(f=>Number(f.properties.population)||0).filter(v=>v>0), maxPop);
  state.maxPop=maxPop; state.minPop=minPop;
  state.layers.circles=L.layerGroup();
  admin.eachLayer(layer=>{
    const f=layer.feature; const p=f.properties; const pop=Number(p.population)||0; if(!pop) return;
    const c=layer.getBounds().getCenter(); const r=populationRadius(pop,maxPop);
    const m=L.circleMarker(c,{pane:'circlesPane', radius:r, color:t.circleLine, weight:1.65, fillColor:t.circleFill, fillOpacity:.72, opacity:.98});
    m.feature=f;
    m.bindTooltip(`<b>${p.name||'объект'}</b><br>Население: ${num(pop)}<br>Плотность: ${num1(p.density)} чел./км²`, {direction:'top', sticky:false, className:'circle-tooltip', opacity:.98});
    m.on('click', (e)=>{ L.DomEvent.stopPropagation(e); if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f); });
    state.layers.circles.addLayer(m);
  });
}
function populationRadius(pop,maxPop){ return 5 + Math.sqrt((Number(pop)||0)/(maxPop||1))*34; }
function buildLabels(admin, gj){
  const labels=L.layerGroup(); const dense=gj.features.length>120;
  admin.eachLayer(layer=>{
    const f=layer.feature; const p=f.properties||{}; if(!p.name) return;
    const ll=layer.getBounds().getCenter();
    const area=Number(p.area_km2)||0; const pop=Number(p.population)||0;
    const div=L.divIcon({className:'', html:`<div class="admin-label${dense?' small':''}">${p.name}</div>`, iconSize:[0,0], iconAnchor:[0,0]});
    const marker=L.marker(ll,{icon:div, pane:'labelsPane', interactive:false});
    labels.addLayer(marker); state.labelItems.push({marker, feature:f, area, pop, latlng:ll});
  });
  state.layers.labels=labels; setTimeout(updateLabelsVisibility,0);
}
function updateLabelsVisibility(){
  const layer=state.layers.labels; if(!layer || !state.map) return;
  const show=$('toggleLabels') ? $('toggleLabels').checked : true; const z=state.map.getZoom(); const size=state.map.getSize(); const view=state.map.getBounds();
  state.labelItems.forEach(item=>{
    const pt=state.map.latLngToContainerPoint(item.latlng); const dense=state.currentGeoJSON && state.currentGeoJSON.features.length>120;
    let ok=show && view.contains(item.latlng) && pt.x>100 && pt.x<size.x-100 && pt.y>45 && pt.y<size.y-45;
    if(dense){ ok = ok && (z>=6.2 || (z>=5.2 && item.area>65000) || (z>=4.4 && item.area>180000)); }
    else { ok = ok && (z>=4.1 || item.area>350000); }
    const el=item.marker.getElement(); if(el) el.style.display=ok?'block':'none';
  });
}

function setTool(tool){
  state.tool = tool || 'pan';
  clearSelectionDrawing();
  const selectMode = state.tool !== 'pan';
  if(state.map){
    if(selectMode){ state.map.dragging.disable(); }
    else { state.map.dragging.enable(); }
    if(state.tool === 'polygon') state.map.doubleClickZoom.disable(); else state.map.doubleClickZoom.enable();
  }
  document.body.classList.toggle('selection-tool-active', selectMode);
  document.body.dataset.tool = state.tool;
  const help=$('selectionToolHelp');
  if(help){
    if(state.tool==='pan') help.innerHTML='Рука: двигайте карту и кликайте по объектам для одиночной выборки.';
    if(state.tool==='rectangle') help.innerHTML='Прямоугольная выборка: протяните рамку по карте. Shift — добавить, Alt — убрать из выборки.';
    if(state.tool==='polygon') help.innerHTML='Полигональная выборка: ставьте точки кликами, двойной клик или правая кнопка — завершить.';
  }
  const actions=$('selectionDrawActions'); if(actions) actions.style.display = state.tool==='polygon' ? 'grid' : 'none';
}
function bindSelectionHandlers(){
  state.map.on('mousedown', e=>{
    if(state.tool!=='rectangle') return;
    state.dragStart=e.latlng;
    if(state.dragRect){ state.map.removeLayer(state.dragRect); state.dragRect=null; }
    L.DomEvent.preventDefault(e.originalEvent);
  });
  state.map.on('mousemove', e=>{
    if(state.tool!=='rectangle' || !state.dragStart) return;
    const b=L.latLngBounds(state.dragStart, e.latlng);
    if(!state.dragRect){ state.dragRect=L.rectangle(b,{pane:'selectionPane', color:'#b77816', weight:2, dashArray:'6 4', fillColor:'#d9a441', fillOpacity:.12, interactive:false}).addTo(state.map); }
    else state.dragRect.setBounds(b);
  });
  state.map.on('mouseup', e=>{
    if(state.tool!=='rectangle' || !state.dragStart) return;
    const b=L.latLngBounds(state.dragStart, e.latlng); const op=selectionOp(e.originalEvent);
    state.dragStart=null;
    if(state.dragRect){ state.map.removeLayer(state.dragRect); state.dragRect=null; }
    if(Math.abs(b.getNorth()-b.getSouth())<0.03 && Math.abs(b.getEast()-b.getWest())<0.03) return;
    const feats=featuresInBounds(b); applySelection(feats, op); updateStatsAndSelection();
  });
  state.map.on('click', e=>{
    if(state.tool!=='polygon') return;
    L.DomEvent.stop(e.originalEvent);
    state.polygonPoints.push(e.latlng); redrawPolygonDraft();
  });
  state.map.on('dblclick', e=>{ if(state.tool==='polygon'){ L.DomEvent.stop(e.originalEvent); finishPolygonSelection(e.originalEvent); } });
  state.map.on('contextmenu', e=>{ if(state.tool==='polygon'){ L.DomEvent.stop(e.originalEvent); finishPolygonSelection(e.originalEvent); } });
}
function selectionOp(ev){ return ev && ev.altKey ? 'subtract' : (ev && ev.shiftKey ? 'add' : 'replace'); }
function redrawPolygonDraft(){
  if(state.polygonLine){ state.map.removeLayer(state.polygonLine); state.polygonLine=null; }
  if(state.polygonMarkers){ state.map.removeLayer(state.polygonMarkers); state.polygonMarkers=null; }
  state.polygonMarkers=L.layerGroup([], {pane:'selectionPane'}).addTo(state.map);
  state.polygonPoints.forEach(ll=>L.circleMarker(ll,{pane:'selectionPane', radius:4, color:'#b77816', weight:2, fillColor:'#fff6d8', fillOpacity:1, interactive:false}).addTo(state.polygonMarkers));
  if(state.polygonPoints.length>=2){ state.polygonLine=L.polyline(state.polygonPoints,{pane:'selectionPane', color:'#b77816', weight:2.2, dashArray:'6 4', interactive:false}).addTo(state.map); }
}
function clearSelectionDrawing(){
  state.dragStart=null;
  if(state.dragRect){ state.map.removeLayer(state.dragRect); state.dragRect=null; }
  if(state.polygonLine){ state.map.removeLayer(state.polygonLine); state.polygonLine=null; }
  if(state.polygonMarkers){ state.map.removeLayer(state.polygonMarkers); state.polygonMarkers=null; }
  state.polygonPoints=[];
}
function finishPolygonSelection(ev){
  if(state.tool!=='polygon' || state.polygonPoints.length<3) { clearSelectionDrawing(); return; }
  const op=selectionOp(ev); const poly=state.polygonPoints.slice();
  const feats=featuresInPolygon(poly); clearSelectionDrawing(); applySelection(feats, op); updateStatsAndSelection();
}
function featuresInBounds(bounds){
  const feats=[]; if(!state.layers.admin) return feats;
  state.layers.admin.eachLayer(l=>{ if(l.getBounds && l.getBounds().intersects(bounds)) feats.push(l.feature); });
  return feats;
}
function featuresInPolygon(poly){
  const ring=poly.map(ll=>[ll.lng,ll.lat]); const feats=[]; if(!state.layers.admin) return feats;
  state.layers.admin.eachLayer(l=>{ const c=l.getBounds().getCenter(); if(pointInPoly([c.lng,c.lat], ring)) feats.push(l.feature); });
  return feats;
}
function pointInPoly(pt, ring){
  let inside=false; const x=pt[0], y=pt[1];
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    const intersect=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function applySelection(features, op){
  const ids=features.map(featureId);
  if(op==='replace') state.selectedIds = new Set(ids);
  if(op==='add') ids.forEach(id=>state.selectedIds.add(id));
  if(op==='subtract') ids.forEach(id=>state.selectedIds.delete(id));
  refreshSelectionStyles();
  if(features.length) showFeature(features[features.length-1]);
}

async function refreshCenters(){ clearLayer('centers'); const path=state.manifest.layers.centers[String(state.year)]; if(!path) return; const gj=await loadJson(path); state.layers.centers=L.geoJSON(gj,{pane:'centersPane', pointToLayer:(f,latlng)=>L.circleMarker(latlng,{pane:'centersPane', radius:4.2,color:'#1b1305',weight:1.3,fillColor:'#f1c45f',fillOpacity:.95}), onEachFeature:(f,l)=>{const p=f.properties;l.bindTooltip(`<b>${p.name||'центр'}</b><br>${p.unit_name||''}`,{direction:'top',sticky:false,className:'circle-tooltip'});}}); refreshVisibility(); }
async function refreshRailways(){ clearLayer('railways'); const gj=await loadJson(state.manifest.layers.railways.main); const yr=state.year; const filtered={type:'FeatureCollection', features:gj.features.filter(f=>{const p=f.properties; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close); return o<=yr && (c==null || c>yr);})}; const t=themeStyle(); state.layers.railways=L.geoJSON(filtered,{pane:'railwayPane', style:{color:t.railway,weight:3.2,opacity:.95}, onEachFeature:(f,l)=>{const p=f.properties;l.bindTooltip(`ЖД: ${p.year_open||'—'}`,{sticky:false,className:'circle-tooltip'});}}); refreshVisibility(); updateStatsAndSelection(); }
function refreshVisibility(){
  const vis={hydro:$('toggleHydro')?.checked, centers:$('toggleCenters')?.checked, railways:$('toggleRailways')?.checked, circles:$('toggleCircles')?.checked, labels:$('toggleLabels')?.checked};
  const order=[['rivers',vis.hydro],['water',vis.hydro],['admin',true],['railways',vis.railways],['circles',vis.circles],['centers',vis.centers],['labels',vis.labels]];
  order.forEach(([name,show])=>{const l=state.layers[name]; if(!l) return; if(show && !state.map.hasLayer(l)) l.addTo(state.map); if(!show && state.map.hasLayer(l)) state.map.removeLayer(l);});
  updateLabelsVisibility(); updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
}
function refreshVectorStyles(){
  const t=themeStyle();
  if(state.layers.rivers) state.layers.rivers.setStyle(f=>({color:t.river, weight:Math.max(.45, Number(f.properties.strokeweig||1.0)), opacity:state.theme==='light'?.62:.75}));
  if(state.layers.water) state.layers.water.setStyle(f=>{const ocean=(f.properties||{}).water_kind==='ocean'; return {color:t.waterLine, weight:ocean?1.0:.8, opacity:ocean?.72:.82, fillColor:t.waterFill, fillOpacity:ocean?(state.theme==='light'?.50:.46):(state.theme==='light'?.70:.58)};});
  if(state.layers.railways) state.layers.railways.setStyle({color:t.railway,weight:3.2,opacity:.95});
  if(state.layers.admin) refreshSelectionStyles();
  if(state.layers.circles) state.layers.circles.eachLayer(m=>m.setStyle({color:t.circleLine, fillColor:t.circleFill, fillOpacity:.72, opacity:.98}));
}
function toggleSelection(f){ const id=featureId(f); if(state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id); refreshSelectionStyles(); updateStatsAndSelection(); }
function refreshSelectionStyles(){ if(!state.layers.admin) return; state.layers.admin.eachLayer(l=>l.setStyle(adminStyle(l.feature,state._lastVals))); }
function refreshSelectionStylesFor(id){ const l=state.adminLayerById.get(id); if(l) l.setStyle(adminStyle(l.feature,state._lastVals)); }
function selectedFeatures(){ if(!state.currentGeoJSON) return []; if(!state.selectedIds.size) return state.currentGeoJSON.features; return state.currentGeoJSON.features.filter(f=>state.selectedIds.has(featureId(f))); }
function updateStatsAndSelection(){ if(!state.currentGeoJSON) return; updateStats(selectedFeatures()); updateSelectionBox(); updateLegend(state.currentGeoJSON,state._lastVals); }
function sum(arr){ return arr.reduce((a,b)=>a+(Number(b)||0),0); }
function updateStats(features){
  const all=!state.selectedIds.size; const pops=features.map(f=>Number(f.properties.population)||0); const areas=features.map(f=>Number(f.properties.area_km2)||0); const urban=features.map(f=>Number(f.properties.urban_pop)||0); const rural=features.map(f=>Number(f.properties.rural_pop)||0); const total=sum(pops); const area=sum(areas); const density=area?total/area:null; const urbanTotal=sum(urban); const ruralTotal=sum(rural); const urbanShare=total?urbanTotal/total:null;
  const railwayCount=state.layers.railways?state.layers.railways.getLayers().length:0;
  $('statsBox').innerHTML=`<div class="stats-scope ${all?'':'selected-scope'}">${all?'Показанный слой':'Выборка'} · ${state.year}</div><div class="stat-grid"><div class="stat"><div class="k">объектов</div><div class="v">${fmt.format(features.length)}</div></div><div class="stat"><div class="k">население</div><div class="v">${num(total)}</div></div><div class="stat"><div class="k">площадь, км²</div><div class="v">${num(area)}</div></div><div class="stat"><div class="k">плотность</div><div class="v">${density?density.toFixed(2).replace('.',','):'—'}</div><div class="sub">чел./км²</div></div></div><div class="analytics-block"><h3>Базовая статистика</h3><div class="metric-line"><span>городское население</span><b>${num(urbanTotal)}</b></div><div class="metric-line"><span>сельское население</span><b>${num(ruralTotal)}</b></div><div class="metric-line"><span>доля городского</span><b>${pct(urbanShare)}</b></div><div class="metric-line"><span>активных ЖД-сегментов</span><b>${num(railwayCount)}</b></div></div>`;
}
function updateSelectionBox(){ const box=$('selectionBox'); if(!state.selectedIds.size){box.classList.add('muted'); box.innerHTML='Выборка не задана. Статистика считается по всему показанному слою.'; return;} box.classList.remove('muted'); const feats=state.currentGeoJSON.features.filter(f=>state.selectedIds.has(featureId(f))); const names=feats.slice(0,12).map(f=>`<li>${f.properties.name||'без названия'}</li>`).join(''); const more=feats.length>12?`<li>…и ещё ${feats.length-12}</li>`:''; box.innerHTML=`<div class="selection-count">Выбрано объектов: ${feats.length}</div><ul class="selection-list">${names}${more}</ul>`; }
function updateLegend(gj, vals){
  const box=$('legendBox'); if(!box || !gj) return; let html='<b>Легенда</b>';
  if(state.mode==='admin_parent'||state.mode==='unit_type'){ const field=state.mode; const cats=[...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,14); cats.forEach(c=>{html+=`<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${c}</div>`}); }
  else { ramp.forEach((c,i)=>{html+=`<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===ramp.length-1?'больше':''}</div>`}); }
  html+=`<div class="legend-section">Гидрография</div><div class="legend-row"><span class="swatch water-swatch"></span>океан, озёра и водохранилища</div><div class="legend-row"><span class="river-swatch"></span>реки</div>`;
  if($('toggleCircles')?.checked){
    const max=state.maxPop||0; const mid=max/4; html+=`<div class="legend-section">Круги населения</div>`;
    [[max,'макс.'],[mid,'примерно 1/4 макс.']].forEach(([v,label])=>{ const size=Math.max(8, populationRadius(v,max)*1.25); html+=`<div class="legend-row"><span class="circle-swatch" style="width:${size}px;height:${size}px"></span>${label}: ${num(v)}</div>`; });
    html+=`<div class="mini-muted">Площадь круга пропорциональна населению. Наведите курсор на круг, чтобы увидеть значение.</div>`;
  }
  box.innerHTML=html;
}
function showFeature(f){ const p=f.properties; const id=featureId(f); const selected=state.selectedIds.has(id); $('featureInfo').classList.remove('muted'); $('featureInfo').innerHTML=`<span class="selection-badge ${selected?'on':''}">${selected?'в выборке':'не выбрано'}</span><div class="info-title">${p.name||'Без названия'}</div><div class="info-row"><span>Год</span><b>${p.year||state.year}</b></div><div class="info-row"><span>Тип</span><b>${p.unit_type||'—'}</b></div><div class="info-row"><span>Подчинение</span><b>${p.admin_parent||'—'}</b></div><div class="info-row"><span>Центр</span><b>${p.center||'—'}</b></div><div class="info-row"><span>Население</span><b>${num(p.population)}</b></div><div class="info-row"><span>Городское</span><b>${num(p.urban_pop)}</b></div><div class="info-row"><span>Сельское</span><b>${num(p.rural_pop)}</b></div><div class="info-row"><span>Доля городского</span><b>${pct(p.urban_share)}</b></div><div class="info-row"><span>Площадь, км²</span><b>${num(p.area_km2)}</b></div><div class="info-row"><span>Плотность</span><b>${p.density==null?'—':Number(p.density).toFixed(2).replace('.',',')}</b></div><div class="info-row"><span>Исходный слой</span><b>${p.source_layer||'—'}</b></div>`; }
init().catch(err=>{console.error(err); alert('Ошибка загрузки данных: '+err.message);});
