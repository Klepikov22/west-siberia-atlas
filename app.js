const APP_VERSION = '5';
const fmt = new Intl.NumberFormat('ru-RU');
const $ = (id) => document.getElementById(id);

const state = {
  manifest:null, year:null, mode:'admin_parent', theme:'light', hydroOrder:'above',
  layers:{}, cache:{}, map:null, colors:{}, selectedIds:new Set(), adminLayerById:new Map(),
  currentGeoJSON:null, _lastVals:[], labelItems:[], selectedFeature:null
};

const DEFAULT_EXPANDED_BOUNDS = [[42.485993,57.411848],[74.021644,92.272637]]; // [south,west],[north,east], expanded about 200 km
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
    river: dark ? '#5ebce6' : '#4aa9cf', lakeFill: dark ? '#1d75a6' : '#d7edf3', lakeLine: dark ? '#61c7ee' : '#62adc6',
    oceanFill: dark ? '#123247' : '#dbecea', oceanLine: dark ? '#5fc7ee' : '#74b5c8',
    adminLine: dark ? '#d9c29c' : '#746a5c', selectedLine: '#a65b00', railway: dark ? '#f3e7d0' : '#17140f',
    adminFillOpacity: dark ? .48 : .58, circleLine: dark ? '#3a2709' : '#6d4f1a', circleFill: '#d9a441'
  };
}

async function init(){
  document.documentElement.dataset.theme = state.theme;
  state.manifest = await loadJson('data/manifest.json');
  state.year = state.manifest.years.includes(1914)?1914:state.manifest.years[0];
  setYearLabels(); buildTimeline();
  const b = state.manifest.map_bounds_4326_expanded_200km || [57.411848,42.485993,92.272637,74.021644];
  const bounds = L.latLngBounds([[b[1],b[0]],[b[3],b[2]]]);
  state.dataBounds = bounds;
  state.softBounds = bounds.pad(0.18);
  state.map = L.map('map', {
    zoomControl:true, preferCanvas:true,
    zoomSnap:0.25, zoomDelta:0.5,
    scrollWheelZoom:'center', doubleClickZoom:'center', touchZoom:'center',
    wheelPxPerZoomLevel:170, wheelDebounceTime:30,
    inertia:true, inertiaDeceleration:4200, easeLinearity:0.12,
    maxBounds:state.softBounds, maxBoundsViscosity:0.30,
    zoomAnimation:true, markerZoomAnimation:false, fadeAnimation:false
  });
  createPanes(); applyPaneOrder();
  state.map.fitBounds(bounds, {padding:[18,18], animate:false});
  L.control.scale({imperial:false}).addTo(state.map);
  state.map.on('dragend', () => {
    const c = state.map.getCenter();
    if(!state.softBounds.contains(c)) state.map.panInsideBounds(state.dataBounds, {animate:true, duration:.45, easeLinearity:.12});
  });
  state.map.on('zoomend moveend', updateLabelsVisibility);
  bindUi();
  await refreshAll();
  setTimeout(()=>state.map.invalidateSize(),250);
  window.addEventListener('resize', () => setTimeout(()=>{state.map.invalidateSize(); updateLabelsVisibility();},120));
}

function createPanes(){
  const panes = ['reliefPane','adminPane','riversPane','waterPane','railwayPane','circlesPane','centersPane','labelsPane'];
  panes.forEach(name=>{ if(!state.map.getPane(name)) state.map.createPane(name); });
  state.map.getPane('labelsPane').classList.add('leaflet-label-pane');
  ['reliefPane','riversPane','waterPane','labelsPane'].forEach(p=>state.map.getPane(p).style.pointerEvents='none');
}
function applyPaneOrder(){
  const above = state.hydroOrder === 'above';
  const z = {
    reliefPane:100,
    adminPane:350,
    riversPane: above ? 430 : 210,
    waterPane: above ? 455 : 235,
    railwayPane:520,
    circlesPane:580,
    centersPane:620,
    labelsPane:640
  };
  Object.entries(z).forEach(([pane,val])=>{ if(state.map && state.map.getPane(pane)) state.map.getPane(pane).style.zIndex=val; });
}
function bindUi(){
  const on = (id, event, handler) => { const el=$(id); if(el) el.addEventListener(event, handler); };
  on('modeSelect','change', async e=>{state.mode=e.target.value; await refreshAdmin();});
  on('themeSelect','change', e=>{state.theme=e.target.value; document.documentElement.dataset.theme=state.theme; refreshVectorStyles(); updateLabelsVisibility();});
  const orderControl=$('hydroOrderControl');
  if(orderControl){
    orderControl.querySelectorAll('button[data-order]').forEach(btn=>btn.addEventListener('click', async ()=>{
      state.hydroOrder=btn.dataset.order;
      orderControl.querySelectorAll('button').forEach(b=>b.classList.toggle('active', b===btn));
      applyPaneOrder(); await refreshHydro(); refreshVisibility();
    }));
  }
  ['toggleRelief','toggleOcean','toggleHydro','toggleCenters','toggleRailways','toggleCircles','toggleLabels'].forEach(id=>on(id,'change', refreshVisibility));
  on('resetView','click', ()=> state.map.flyToBounds(state.dataBounds, {duration:.7, easeLinearity:.12, padding:[18,18]}));
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
async function refreshAll(){ await refreshRelief(); await refreshAdmin(); await refreshHydro(); await refreshCenters(); await refreshRailways(); refreshVisibility(); updateStatsAndSelection(); }

async function refreshRelief(){ clearLayer('relief'); const b=await loadJson(state.manifest.layers.raster.relief_bounds); const [w,s,e,n]=b.bounds_4326; state.layers.relief=L.imageOverlay(state.manifest.layers.raster.relief_preview, [[s,w],[n,e]], {opacity: state.theme==='light'?.10:.18, pane:'reliefPane'}); }
function isReservoirFeature(f){
  const p=f.properties||{}; const text=Object.values(p).join(' ').toLowerCase();
  return p.reservoir===1 || p.reservoir===true || String(p.reservoir).toLowerCase()==='true' || text.includes('reservoir') || text.includes('водохранилище') || text.includes('vodokhran');
}
async function refreshHydro(){
  clearLayer('rivers'); clearLayer('lakes'); clearLayer('ocean'); applyPaneOrder(); const t=themeStyle();
  const showReservoirs = Number(state.year) >= 1959;
  const rivers=await loadJson(state.manifest.layers.hydro.rivers); const lakesRaw=await loadJson(state.manifest.layers.hydro.lakes);
  const lakes={type:'FeatureCollection', features:lakesRaw.features.filter(f=>showReservoirs || !isReservoirFeature(f))};
  const ocean=await loadJson(state.manifest.layers.ocean.main);
  state.layers.rivers=L.geoJSON(rivers,{pane:'riversPane', interactive:false, style:f=>({color:t.river, weight: Math.max(.35, Number(f.properties.strokeweig||1.0)), opacity: state.theme==='light'?.58:.72})});
  state.layers.ocean=L.geoJSON(ocean,{pane:'waterPane', interactive:false, style:{color:t.oceanLine, weight:1.05, opacity:.78, fillColor:t.oceanFill, fillOpacity: state.theme==='light'?.92:.70}});
  state.layers.lakes=L.geoJSON(lakes,{pane:'waterPane', interactive:false, style:{color:t.lakeLine, weight:.9, opacity:.95, fillColor:t.lakeFill, fillOpacity: state.theme==='light'?.74:.62}});
}
function adminStyle(feature, vals){
  const p=feature.properties; let fill='#999';
  if(state.mode==='admin_parent') fill=catColor(p.admin_parent);
  if(state.mode==='unit_type') fill=catColor(p.unit_type);
  if(state.mode==='population') fill=valueColor(Number(p.population), vals);
  if(state.mode==='density') fill=valueColor(Number(p.density), vals);
  if(state.mode==='urban_share') fill=valueColor(Number(p.urban_share), vals);
  const t=themeStyle(); const selected=state.selectedIds.has(featureId(feature));
  return {color:selected?t.selectedLine:t.adminLine, weight:selected?2.8:1.0, opacity:selected?1:.86, fillColor:fill, fillOpacity:selected?Math.min(.74,t.adminFillOpacity+.16):t.adminFillOpacity};
}
async function refreshAdmin(){
  clearLayer('admin'); clearLayer('circles'); clearLayer('labels'); state.adminLayerById.clear(); state.labelItems=[];
  const path=state.manifest.layers.admin[String(state.year)]; const gj=await loadJson(path); state.currentGeoJSON=gj;
  const field=valField(); const vals=field?gj.features.map(f=>Number(f.properties[field])).filter(v=>!Number.isNaN(v)):[]; state._lastVals=vals;
  const admin=L.geoJSON(gj,{pane:'adminPane', style:f=>adminStyle(f,vals), onEachFeature:(f,l)=>{
    const id=featureId(f); state.adminLayerById.set(id,l);
    l.on('click',()=>{toggleSelection(f); showFeature(f);});
    l.on('mouseover',()=>{ if(!state.selectedIds.has(id)) l.setStyle({weight:1.9, opacity:1}); });
    l.on('mouseout',()=>{ refreshSelectionStylesFor(id); });
  }});
  state.layers.admin=admin;
  buildCircles(admin, gj); buildLabels(admin, gj);
  updateLegend(gj, vals); refreshVisibility(); updateStatsAndSelection();
}
function buildCircles(admin, gj){
  const t=themeStyle(); const maxPop=Math.max(...gj.features.map(f=>Number(f.properties.population)||0),1); const minPop=Math.min(...gj.features.map(f=>Number(f.properties.population)||0).filter(v=>v>0), maxPop);
  state.maxPop=maxPop; state.minPop=minPop;
  state.layers.circles=L.layerGroup([], {pane:'circlesPane'});
  admin.eachLayer(layer=>{
    const f=layer.feature; const p=f.properties; const pop=Number(p.population)||0; if(!pop) return;
    const c=layer.getBounds().getCenter(); const r=populationRadius(pop,maxPop);
    const m=L.circleMarker(c,{pane:'circlesPane', radius:r, color:t.circleLine, weight:1.25, fillColor:t.circleFill, fillOpacity:.48, opacity:.95});
    m.feature=f;
    m.bindTooltip(`<b>${p.name||'объект'}</b><br>Население: ${num(pop)}<br>Плотность: ${num1(p.density)} чел./км²`, {direction:'top', sticky:false, className:'circle-tooltip', opacity:.98});
    m.on('click', (e)=>{ L.DomEvent.stopPropagation(e); toggleSelection(f); showFeature(f); });
    state.layers.circles.addLayer(m);
  });
}
function populationRadius(pop,maxPop){ return 4 + Math.sqrt((Number(pop)||0)/(maxPop||1))*28; }
function buildLabels(admin, gj){
  const labels=L.layerGroup([], {pane:'labelsPane'}); const dense=gj.features.length>120;
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
    let ok=show && view.contains(item.latlng) && pt.x>80 && pt.x<size.x-80 && pt.y>35 && pt.y<size.y-35;
    if(dense){ ok = ok && (z>=6 || (z>=5 && item.area>65000) || (z>=4.25 && item.area>160000)); }
    else { ok = ok && (z>=3.25 || item.area>350000); }
    const el=item.marker.getElement(); if(el) el.style.display=ok?'block':'none';
  });
}
async function refreshCenters(){ clearLayer('centers'); const path=state.manifest.layers.centers[String(state.year)]; if(!path) return; const gj=await loadJson(path); state.layers.centers=L.geoJSON(gj,{pane:'centersPane', pointToLayer:(f,latlng)=>L.circleMarker(latlng,{pane:'centersPane', radius:4.2,color:'#1b1305',weight:1.3,fillColor:'#f1c45f',fillOpacity:.95}), onEachFeature:(f,l)=>{const p=f.properties;l.bindTooltip(`<b>${p.name||'центр'}</b><br>${p.unit_name||''}`,{direction:'top',sticky:false,className:'circle-tooltip'});}}); refreshVisibility(); }
async function refreshRailways(){ clearLayer('railways'); const gj=await loadJson(state.manifest.layers.railways.main); const yr=state.year; const filtered={type:'FeatureCollection', features:gj.features.filter(f=>{const p=f.properties; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close); return o<=yr && (c==null || c>yr);})}; const t=themeStyle(); state.layers.railways=L.geoJSON(filtered,{pane:'railwayPane', style:{color:t.railway,weight:3.2,opacity:.95}, onEachFeature:(f,l)=>{const p=f.properties;l.bindTooltip(`ЖД: ${p.year_open||'—'}`,{sticky:false,className:'circle-tooltip'});}}); refreshVisibility(); updateStatsAndSelection(); }
function refreshVisibility(){
  const vis={relief:$('toggleRelief')?.checked, ocean:$('toggleOcean')?.checked, hydro:$('toggleHydro')?.checked, centers:$('toggleCenters')?.checked, railways:$('toggleRailways')?.checked, circles:$('toggleCircles')?.checked, labels:$('toggleLabels')?.checked};
  const order=[['relief',vis.relief],['admin',true],['rivers',vis.hydro],['ocean',vis.ocean],['lakes',vis.hydro],['railways',vis.railways],['circles',vis.circles],['centers',vis.centers],['labels',vis.labels]];
  order.forEach(([name,show])=>{const l=state.layers[name]; if(!l) return; if(show && !state.map.hasLayer(l)) l.addTo(state.map); if(!show && state.map.hasLayer(l)) state.map.removeLayer(l);});
  updateLabelsVisibility();
}
function refreshVectorStyles(){
  const t=themeStyle(); if(state.layers.relief) state.layers.relief.setOpacity(state.theme==='light'?.10:.18);
  if(state.layers.rivers) state.layers.rivers.setStyle(f=>({color:t.river, weight:Math.max(.35, Number(f.properties.strokeweig||1.0)), opacity:state.theme==='light'?.58:.72}));
  if(state.layers.ocean) state.layers.ocean.setStyle({color:t.oceanLine, weight:1.05, opacity:.78, fillColor:t.oceanFill, fillOpacity: state.theme==='light'?.92:.70});
  if(state.layers.lakes) state.layers.lakes.setStyle({color:t.lakeLine, weight:.9, opacity:.95, fillColor:t.lakeFill, fillOpacity: state.theme==='light'?.74:.62});
  if(state.layers.railways) state.layers.railways.setStyle({color:t.railway,weight:3.2,opacity:.95});
  if(state.layers.admin) refreshSelectionStyles();
  if(state.layers.circles) state.layers.circles.eachLayer(m=>m.setStyle({color:t.circleLine, fillColor:t.circleFill}));
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
  const box=$('legendBox'); let html='<b>Легенда</b>';
  if(state.mode==='admin_parent'||state.mode==='unit_type'){ const field=state.mode; const cats=[...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,14); cats.forEach(c=>{html+=`<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${c}</div>`}); }
  else { ramp.forEach((c,i)=>{html+=`<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===ramp.length-1?'больше':''}</div>`}); }
  if($('toggleCircles')?.checked){
    const max=state.maxPop||0; const mid=max/4; html+=`<div class="legend-section">Круги населения</div>`;
    [[max,'макс.'],[mid,'примерно 1/4 макс.']].forEach(([v,label])=>{ const size=Math.max(8, populationRadius(v,max)*1.25); html+=`<div class="legend-row"><span class="circle-swatch" style="width:${size}px;height:${size}px"></span>${label}: ${num(v)}</div>`; });
    html+=`<div class="mini-muted">Площадь круга пропорциональна населению.</div>`;
  }
  box.innerHTML=html;
}
function showFeature(f){ const p=f.properties; const id=featureId(f); const selected=state.selectedIds.has(id); $('featureInfo').classList.remove('muted'); $('featureInfo').innerHTML=`<span class="selection-badge ${selected?'on':''}">${selected?'в выборке':'не выбрано'}</span><div class="info-title">${p.name||'Без названия'}</div><div class="info-row"><span>Год</span><b>${p.year||state.year}</b></div><div class="info-row"><span>Тип</span><b>${p.unit_type||'—'}</b></div><div class="info-row"><span>Подчинение</span><b>${p.admin_parent||'—'}</b></div><div class="info-row"><span>Центр</span><b>${p.center||'—'}</b></div><div class="info-row"><span>Население</span><b>${num(p.population)}</b></div><div class="info-row"><span>Городское</span><b>${num(p.urban_pop)}</b></div><div class="info-row"><span>Сельское</span><b>${num(p.rural_pop)}</b></div><div class="info-row"><span>Доля городского</span><b>${pct(p.urban_share)}</b></div><div class="info-row"><span>Площадь, км²</span><b>${num(p.area_km2)}</b></div><div class="info-row"><span>Плотность</span><b>${p.density==null?'—':Number(p.density).toFixed(2).replace('.',',')}</b></div><div class="info-row"><span>Исходный слой</span><b>${p.source_layer||'—'}</b></div>`; }
init().catch(err=>{console.error(err); alert('Ошибка загрузки данных: '+err.message);});
