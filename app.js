const APP_VERSION = '17';
const fmt = new Intl.NumberFormat('ru-RU');
const $ = (id) => document.getElementById(id);

const state = {
  manifest:null, year:null, mode:'admin_parent', theme:'light', tool:'pan',
  map:null, cache:{}, layers:{}, colors:{}, currentGeoJSON:null, _lastVals:[],
  selectedIds:new Set(), adminLayerById:new Map(), labelItems:[], selectedFeature:null, selectedCenterLayer:null, attributesPanelOpen:false,
  dragStart:null, dragRect:null, polygonPoints:[], polygonLine:null, polygonMarkers:null, middlePan:null, hoverBox:null, hoverTimer:null, hoverPayload:null, centerLabelOverlay:null, centerLabelItems:[]
};

const palette = ['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#d9d9d9'];
const ramp = ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#3182bd','#08519c'];

function fetchUrl(path){ return `${path}${path.includes('?')?'&':'?'}v=${APP_VERSION}`; }
async function loadJson(path){
  if(state.cache[path]) return state.cache[path];
  const r = await fetch(fetchUrl(path), {cache:'no-store'});
  if(!r.ok) throw new Error(`${r.status} ${path}`);
  const j = await r.json(); state.cache[path]=j; return j;
}
function featureId(f){ return f.properties.unit_id || `${f.properties.year}_${f.properties.raw_objectid || f.properties.name}`; }
function valField(){ return state.mode==='population'?'population':state.mode==='density'?'density':state.mode==='urban_share'?'urban_share':state.mode==='rail_length'?'rail_length_km':state.mode==='rail_density'?'rail_density_km_1000':null; }
function num(v){ return v==null||Number.isNaN(Number(v)) ? '—' : fmt.format(Math.round(Number(v))); }
function num1(v){ return v==null||Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(1).replace('.',','); }
function pct(v){ return v==null||Number.isNaN(Number(v)) ? '—' : (Number(v)*100).toFixed(1).replace('.',',')+'%'; }
function escapeHtml(v){ return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function sum(arr){ return arr.reduce((a,b)=>a+(Number(b)||0),0); }
function catColor(v){ if(!v) return '#9a958d'; if(!state.colors[v]) state.colors[v]=palette[Object.keys(state.colors).length%palette.length]; return state.colors[v]; }
function valueColor(v, values){
  if(v==null||Number.isNaN(v)) return '#a7adb8';
  const sorted=values.filter(x=>x!=null&&!Number.isNaN(x)).sort((a,b)=>a-b);
  if(!sorted.length) return '#808080';
  const pos=sorted.findIndex(x=>x>=v);
  const q=pos<0?1:pos/(sorted.length-1||1);
  return ramp[Math.max(0, Math.min(ramp.length-1, Math.floor(q*(ramp.length-1))))];
}
function styleVars(){
  const dark = state.theme === 'dark';
  return {
    river: dark ? '#4bb5df' : '#4da8c7',
    waterFill: dark ? '#17394a' : '#d9eef4',
    waterLine: dark ? '#65c9ef' : '#6eb4c9',
    adminLine: dark ? '#e3cdaa' : '#746a5c',
    selectedLine: '#a65b00',
    railway: dark ? '#f3e7d0' : '#18130e',
    adminFillOpacity: dark ? .50 : .50,
    circleLine: dark ? '#2f210b' : '#6d4f1a',
    circleFill: '#d9a441'
  };
}


function ensureHoverBox(){
  if(state.hoverBox) return state.hoverBox;
  const box=document.createElement('div');
  box.id='mapHoverCard';
  box.className='map-hover-card';
  box.style.display='none';
  document.body.appendChild(box);
  state.hoverBox=box;
  return box;
}
function showHoverLater(payload, originalEvent){
  clearTimeout(state.hoverTimer);
  state.hoverPayload=payload;
  state.lastHoverEvent=originalEvent || state.lastHoverEvent;
  moveHover(originalEvent || state.lastHoverEvent);
  state.hoverTimer=setTimeout(()=>{
    if(!state.hoverPayload) return;
    const box=ensureHoverBox();
    const rows=[];
    if(payload.subtitle) rows.push(`<div class="hover-subtitle">${escapeHtml(payload.subtitle)}</div>`);
    if(payload.population!=null && !Number.isNaN(Number(payload.population))) rows.push(`<div class="hover-row"><span>население</span><b>${num(payload.population)}</b></div>`);
    if(payload.density!=null && !Number.isNaN(Number(payload.density))) rows.push(`<div class="hover-row"><span>плотность</span><b>${num1(payload.density)}</b></div>`);
    if(payload.extra) rows.push(`<div class="hover-extra">${escapeHtml(payload.extra)}</div>`);
    box.innerHTML=`<div class="hover-title">${escapeHtml(payload.title||'объект')}</div>${rows.join('')}`;
    box.style.display='block';
    moveHover(state.lastHoverEvent);
    requestAnimationFrame(()=>box.classList.add('visible'));
  }, 500);
}
function moveHover(originalEvent){
  const box=ensureHoverBox(); if(!originalEvent) return;
  state.lastHoverEvent=originalEvent;
  let x=(originalEvent.clientX||0)+16, y=(originalEvent.clientY||0)+16;
  const rect=box.getBoundingClientRect();
  const w=rect.width || 220, h=rect.height || 90;
  if(x+w+14>window.innerWidth) x=(originalEvent.clientX||0)-w-16;
  if(y+h+14>window.innerHeight) y=(originalEvent.clientY||0)-h-16;
  box.style.left=Math.max(10,x)+'px'; box.style.top=Math.max(10,y)+'px';
}
function hideHover(){
  clearTimeout(state.hoverTimer);
  state.hoverTimer=null; state.hoverPayload=null;
  if(state.hoverBox){ state.hoverBox.classList.remove('visible'); setTimeout(()=>{ if(!state.hoverPayload && state.hoverBox) state.hoverBox.style.display='none'; }, 170); }
}
function ensureCenterLabelOverlay(){
  if(state.centerLabelOverlay) return state.centerLabelOverlay;
  const mapEl=state.map?.getContainer?.(); if(!mapEl) return null;
  const overlay=document.createElement('div');
  overlay.id='centerLabelOverlay';
  overlay.className='center-label-overlay';
  mapEl.appendChild(overlay);
  state.centerLabelOverlay=overlay;
  return overlay;
}
function clearCenterLabels(){
  if(state.centerLabelOverlay) state.centerLabelOverlay.innerHTML='';
  state.centerLabelItems=[];
}
function addCenterLabel(latlng, text, priority=0, meta={}){
  const overlay=ensureCenterLabelOverlay(); if(!overlay || !text) return;
  const el=document.createElement('div');
  const cls=['center-map-label'];
  if(meta.city) cls.push('city-label');
  if(meta.large) cls.push('large-city-label');
  el.className=cls.join(' ');
  el.textContent=cleanCenterLabelName(text);
  overlay.appendChild(el);
  state.centerLabelItems.push({latlng, el, priority, city:!!meta.city, large:!!meta.large, pop:meta.pop||0});
}
function updateCenterLabels(){
  if(!state.map || !state.centerLabelItems) return;
  const show=$('toggleCenters')?.checked !== false;
  const z=state.map.getZoom(); const size=state.map.getSize();
  const placed=[];
  const items=[...state.centerLabelItems].sort((a,b)=>(b.priority||0)-(a.priority||0));
  for(const item of items){
    const pnt=state.map.latLngToContainerPoint(item.latlng);
    const inside=pnt.x>38 && pnt.x<size.x-38 && pnt.y>38 && pnt.y<size.y-38;
    let zoomOk = item.city ? z>=3.45 : z>=5.15;
    if(!item.city && state.centerLabelItems.length<80) zoomOk = z>=4.45;
    let ok=show && inside && zoomOk;
    item.el.style.transform=`translate(${Math.round(pnt.x)}px, ${Math.round(pnt.y)}px) translate(-50%, -145%)`;
    item.el.style.display=ok?'block':'none';
    if(ok){
      const r=item.el.getBoundingClientRect();
      const pad=item.large?7:5; const rr={left:r.left-pad,right:r.right+pad,top:r.top-pad,bottom:r.bottom+pad};
      if(placed.some(q=>!(rr.right<q.left || rr.left>q.right || rr.bottom<q.top || rr.top>q.bottom))){ item.el.style.display='none'; }
      else placed.push(rr);
    }
  }
}
function cleanCenterLabelName(name){
  let n=String(name||'').trim();
  n=n.replace(/^г[.\s]+/i,'').replace(/^город\s+/i,'');
  n=n.replace(/\s*\(.*?сельское население.*?\)\s*/i,'');
  return n;
}
function looksLikeAdminUnitName(name){ return /(уезд|округ|район|область|край|волость|сельское население)/i.test(String(name||'')); }
function isCityCenter(p){
  const name=String(p?.name||''); const unit=String(p?.unit_name||'');
  const text=(name+' '+unit).toLowerCase();
  if(/(^|\s)г[.\s]/i.test(name) || /(^|\s)г[.\s]/i.test(unit)) return true;
  if(text.includes('город') || text.includes('горсовет') || text.includes('городской')) return true;
  const src=String(p?.center_pop_urban_source||'').toLowerCase();
  const pop=Number(p?.center_pop_urban);
  if(Number(p?.year)<1926 && src.includes('pop_urban') && pop>0 && !looksLikeAdminUnitName(name)) return true;
  return false;
}
function largeCityThreshold(year){ if(Number(year)<1926) return 20000; if(Number(year)<=1939) return 50000; return 100000; }
function labelPriority(p){
  const pop=pointPopulation(p); const city=isCityCenter(p); const large=city && pop>=largeCityThreshold(p?.year||state.year);
  if(large) return 100000000+pop;
  if(city) return 50000000+pop;
  return pop;
}
function pointPopulation(p){
  const keys=['center_pop_urban','Pop_urban','Pop_Urban','urban_pop','Городское_население_1959','Городское_оба_пола','population'];
  for(const k of keys){ const v=Number(p?.[k]); if(!Number.isNaN(v) && v>0) return v; }
  return 0;
}

async function init(){
  document.documentElement.dataset.theme = state.theme;
  state.manifest = await loadJson('data/manifest.json');
  state.year = state.manifest.years.includes(1914) ? 1914 : state.manifest.years[0];
  setYearLabels(); buildTimeline();

  const b = state.manifest.map_bounds_4326_expanded_200km || [57.411848,42.485993,92.272637,74.021644];
  state.dataBounds = L.latLngBounds([[b[1],b[0]],[b[3],b[2]]]);
  state.softBounds = state.dataBounds.pad(0.20);
  state.map = L.map('map', {
    zoomControl:true,
    minZoom:3.5,
    zoomSnap:0.25,
    zoomDelta:0.5,
    wheelPxPerZoomLevel:220,
    wheelDebounceTime:50,
    scrollWheelZoom:'center',
    doubleClickZoom:'center',
    touchZoom:'center',
    zoomAnimation:false,
    markerZoomAnimation:false,
    fadeAnimation:false,
    worldCopyJump:false,
    maxBounds: state.softBounds,
    maxBoundsViscosity: .45,
    bounceAtZoomLimits:false
  });
  state.map.fitBounds(state.dataBounds, {padding:[18,18], animate:false, maxZoom:5});
  if(state.map.getZoom() < 3.5) state.map.setZoom(3.5, {animate:false});
  L.control.scale({imperial:false}).addTo(state.map);
  ensureHoverBox(); ensureCenterLabelOverlay();
  document.addEventListener('mousemove', ev=>{ if(state.hoverPayload && state.hoverBox && state.hoverBox.style.display !== 'none') moveHover(ev); }, {passive:true});
  bindUi(); bindSelectionHandlers(); setTool('pan');
  state.map.on('zoomend moveend', ()=>{ updateLabelsVisibility(); updateCenterLabels(); });
  await refreshAll();
  setTimeout(()=>{state.map.invalidateSize(); updateLabelsVisibility(); updateCenterLabels();},250);
  window.addEventListener('resize', () => setTimeout(()=>{state.map.invalidateSize(); updateLabelsVisibility(); updateCenterLabels();},120));
}

function bindUi(){
  const on = (id, event, handler) => { const el=$(id); if(el) el.addEventListener(event, handler); };
  on('modeSelect','change', async e=>{state.mode=e.target.value; await refreshAdmin();});
  on('themeSelect','change', e=>{state.theme=e.target.value; document.documentElement.dataset.theme=state.theme; refreshVectorStyles(); updateLabelsVisibility();});
  on('toolSelect','change', e=>setTool(e.target.value));
  document.querySelectorAll('[data-tool-button]').forEach(btn=>btn.addEventListener('click', ()=>setTool(btn.dataset.toolButton)));
  on('finishPolygon','click', finishPolygonSelection);
  on('cancelSelectionDraw','click', clearSelectionDrawing);
  ['toggleHydro','toggleAdmin','toggleCenters','toggleRailways','toggleCircles'].forEach(id=>on(id,'change', refreshVisibility));
  on('resetView','click', ()=> state.map.flyToBounds(state.dataBounds, {duration:.45, padding:[18,18], maxZoom:5}));
  on('clearSelection','click', ()=>{state.selectedIds.clear(); refreshSelectionStyles(); updateStatsAndSelection();});
  on('selectAll','click', ()=>{ if(!state.currentGeoJSON) return; state.selectedIds = new Set(state.currentGeoJSON.features.map(featureId)); refreshSelectionStyles(); updateStatsAndSelection(); });
  on('toggleAttributePanel','click', ()=>{ state.attributesPanelOpen = !state.attributesPanelOpen; updateAttributePanel(); });
  on('selectedFeatureSelect','change', e=>{ const id=e.target.value; if(!id || !state.currentGeoJSON) return; const f=state.currentGeoJSON.features.find(x=>featureId(x)===id); if(f){ showFeature(f); const layer=state.adminLayerById.get(id); if(layer){ state.map.fitBounds(layer.getBounds(), {padding:[80,80], maxZoom:6.5, animate:true, duration:.35}); } } });
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
  clearLayer('rivers'); clearLayer('water'); const s=styleVars();
  const rivers=await loadJson(state.manifest.layers.hydro.rivers);
  const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
  const showReservoirs = Number(state.year) >= 1959;
  const water={type:'FeatureCollection', features:waterRaw.features.filter(f=>showReservoirs || !isReservoirFeature(f))};
  state.layers.rivers=L.geoJSON(rivers,{interactive:false, style:f=>({color:s.river, weight: Math.max(.45, Number(f.properties.strokeweig||1.0)), opacity: state.theme==='light'?.55:.75})});
  state.layers.water=L.geoJSON(water,{interactive:false, style:f=>{
    const ocean=(f.properties||{}).water_kind==='ocean';
    return {color:s.waterLine, weight:ocean?1.0:.75, opacity:ocean?.78:.86, fillColor:s.waterFill, fillOpacity:ocean?(state.theme==='light'?.54:.48):(state.theme==='light'?.78:.60)};
  }});
}
function adminStyle(feature, vals){
  const p=feature.properties; let fill='#999';
  if(state.mode==='admin_parent') fill=catColor(p.admin_parent);
  if(state.mode==='unit_type') fill=catColor(p.unit_type);
  if(state.mode==='population') fill=valueColor(Number(p.population), vals);
  if(state.mode==='density') fill=valueColor(Number(p.density), vals);
  if(state.mode==='urban_share') fill=valueColor(Number(p.urban_share), vals);
  if(state.mode==='rail_length') fill=valueColor(Number(p.rail_length_km), vals);
  if(state.mode==='rail_density') fill=valueColor(Number(p.rail_density_km_1000), vals);
  const s=styleVars(); const selected=state.selectedIds.has(featureId(feature));
  return {color:selected?s.selectedLine:s.adminLine, weight:selected?2.8:1.05, opacity:selected?1:.92, fillColor:fill, fillOpacity:selected?Math.min(.70,s.adminFillOpacity+.14):s.adminFillOpacity};
}
async function refreshAdmin(){
  clearLayer('admin'); clearLayer('circles'); state.adminLayerById.clear();
  const path=state.manifest.layers.admin[String(state.year)]; const gj=await loadJson(path); state.currentGeoJSON=gj;
  const field=valField(); const vals=field?gj.features.map(f=>Number(f.properties[field])).filter(v=>!Number.isNaN(v)):[]; state._lastVals=vals;
  const admin=L.geoJSON(gj,{style:f=>adminStyle(f,vals), onEachFeature:(f,l)=>{
    const id=featureId(f); state.adminLayerById.set(id,l);
    l.on('click',()=>{ if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f);});
    l.on('mouseover',(e)=>{ if(!state.selectedIds.has(id)) l.setStyle({weight:1.9, opacity:1}); const pp=f.properties||{}; showHoverLater({title:pp.name, subtitle:pp.unit_type || pp.admin_parent, population:pp.population, density:pp.density}, e.originalEvent); });
    l.on('mousemove',(e)=>moveHover(e.originalEvent));
    l.on('mouseout',()=>{ refreshSelectionStylesFor(id); hideHover(); });
  }});
  state.layers.admin=admin; buildCircles(admin, gj);
  updateLegend(gj, vals); refreshVisibility(); updateStatsAndSelection(); updateAttributePanel();
}
function populationRadius(pop,maxPop){ return 5 + Math.sqrt((Number(pop)||0)/(maxPop||1))*34; }
function buildCircles(admin, gj){
  const s=styleVars(); const maxPop=Math.max(...gj.features.map(f=>Number(f.properties.population)||0),1); const minPop=Math.min(...gj.features.map(f=>Number(f.properties.population)||0).filter(v=>v>0), maxPop);
  state.maxPop=maxPop; state.minPop=minPop; state.layers.circles=L.layerGroup();
  admin.eachLayer(layer=>{
    const f=layer.feature; const p=f.properties; const pop=Number(p.population)||0; if(!pop) return;
    const c=layer.getBounds().getCenter(); const r=populationRadius(pop,maxPop);
    const m=L.circleMarker(c,{radius:r, color:s.circleLine, weight:1.65, fillColor:s.circleFill, fillOpacity:.74, opacity:.98});
    m.feature=f;
    m.on('mouseover',(e)=>showHoverLater({title:p.name||'объект', subtitle:'круг населения', population:pop, density:p.density}, e.originalEvent));
    m.on('mousemove',(e)=>moveHover(e.originalEvent));
    m.on('mouseout', hideHover);
    m.on('click',(e)=>{L.DomEvent.stopPropagation(e); if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f);});
    state.layers.circles.addLayer(m);
  });
}
function buildLabels(admin, gj){
  // Подписи административных полигонов временно отключены: вместо них используем подписи центров.
}
function updateLabelsVisibility(){
  const show=$('toggleLabels') ? $('toggleLabels').checked : true;
  if(!state.map) return;
  const z=state.map.getZoom(); const size=state.map.getSize(); const view=state.map.getBounds();
  const placed=[];
  const items=[...state.labelItems].sort((a,b)=>(b.priority||0)-(a.priority||0));
  items.forEach(item=>{
    const tooltip = item.marker?.getTooltip ? item.marker.getTooltip() : null;
    const el = tooltip?.getElement ? tooltip.getElement() : null;
    if(!el) return;
    const pt=state.map.latLngToContainerPoint(item.latlng);
    let ok=show && view.contains(item.latlng) && pt.x>55 && pt.x<size.x-55 && pt.y>42 && pt.y<size.y-42;
    if(state.labelItems.length>420) ok = ok && z>=5.35;
    else if(state.labelItems.length>180) ok = ok && z>=4.75;
    else if(state.labelItems.length>70) ok = ok && z>=4.15;
    else ok = ok && z>=3.5;
    if(ok){
      el.style.display='block';
      const rect=el.getBoundingClientRect();
      const pad=5;
      const r={left:rect.left-pad,right:rect.right+pad,top:rect.top-pad,bottom:rect.bottom+pad};
      const overlaps=placed.some(q=>!(r.right<q.left || r.left>q.right || r.bottom<q.top || r.top>q.bottom));
      if(overlaps) ok=false; else placed.push(r);
    }
    el.style.display=ok?'block':'none';
  });
}

async function refreshCenters(){
  clearLayer('centers'); clearLayer('labels'); clearCenterLabels(); state.maxCenterPop=0;
  const path=state.manifest.layers.centers[String(state.year)]; if(!path){ refreshVisibility(); return; }
  const gj=await loadJson(path);
  const pops=gj.features.map(f=>pointPopulation(f.properties||{})).filter(v=>v>0);
  const maxCenterPop=Math.max(...pops,1); state.maxCenterPop=maxCenterPop;
  const centerGroup=L.layerGroup();
  const labelSeen=new Set();
  gj.features.forEach(f=>{
    if(!f.geometry || f.geometry.type!=='Point') return;
    const coords=f.geometry.coordinates; const latlng=L.latLng(coords[1], coords[0]); const p=f.properties||{};
    const pop=pointPopulation(p); const r=centerRadius(pop,maxCenterPop);
    const city=isCityCenter(p); const large=city && pop>=largeCityThreshold(state.year);
    const m=L.circleMarker(latlng,{radius:r, color:large?'#201105':'#3a2607', weight:large?2.1:1.45, fillColor:large?'#ffd25e':'#f6c85f', fillOpacity:large?.92:.86, opacity:.98});
    m.feature=f;
    m.on('mouseover',(e)=>showHoverLater({title:cleanCenterLabelName(p.name||'центр'), subtitle:p.unit_name || p.admin_parent || (city?'город':'центр'), population:pop, extra:city?'город / городской центр':'центр'}, e.originalEvent));
    m.on('mousemove',(e)=>moveHover(e.originalEvent));
    m.on('mouseout', hideHover);
    m.on('click',(e)=>{ L.DomEvent.stopPropagation(e); showCenterFeature(f,m); });
    centerGroup.addLayer(m);
    const labelText=p.name || p.unit_name || '';
    const key=cleanCenterLabelName(labelText).toLowerCase();
    if(key && !labelSeen.has(key)){
      labelSeen.add(key);
      addCenterLabel(latlng, labelText, labelPriority(p), {city, large, pop});
    }
  });
  state.layers.centers=centerGroup; state.layers.labels=null;
  refreshVisibility(); updateCenterLabels();
}
function buildFallbackAdminCenterLabels(){ state.labelItems=[]; clearLayer('labels'); }
function centerRadius(pop,maxPop){ return 3.2 + Math.sqrt((Number(pop)||0)/(maxPop||1))*15; }
async function refreshRailways(){
  clearLayer('railways'); const gj=await loadJson(state.manifest.layers.railways.main); const yr=state.year;
  const filtered={type:'FeatureCollection', features:gj.features.filter(f=>{const p=f.properties; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close); return o<=yr && (c==null || c>yr);})};
  const s=styleVars(); state.layers.railways=L.geoJSON(filtered,{style:{color:s.railway,weight:3.0,opacity:.95},onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`ЖД-сегмент<br>постр.: ${p.year_open||'—'}<br>упразд.: ${p.year_close||'—'}`)}});
}

function refreshVisibility(){
  const vis={hydro:$('toggleHydro')?.checked, admin:$('toggleAdmin')?.checked, centers:$('toggleCenters')?.checked, railways:$('toggleRailways')?.checked, circles:$('toggleCircles')?.checked};
  const entries=[['rivers',vis.hydro],['water',vis.hydro],['admin',vis.admin],['railways',vis.railways],['circles',vis.circles],['centers',vis.centers]];
  // Пересобираем порядок слоёв каждый раз. Это грубее, но надёжнее для GitHub/Leaflet и не даёт воде съедать АТД.
  entries.forEach(([name])=>{ const l=state.layers[name]; if(l && state.map.hasLayer(l)) state.map.removeLayer(l); });
  entries.forEach(([name,show])=>{ const l=state.layers[name]; if(l && show) l.addTo(state.map); });
  // Финальная страховка порядка.
  if(state.layers.rivers?.bringToBack) state.layers.rivers.bringToBack();
  if(state.layers.water?.bringToBack) state.layers.water.bringToBack();
  if(state.layers.admin?.bringToFront) state.layers.admin.bringToFront();
  if(state.layers.railways?.bringToFront) state.layers.railways.bringToFront();
  bringLayerGroupToFront(state.layers.circles); bringLayerGroupToFront(state.layers.centers);
  updateLabelsVisibility(); updateCenterLabels(); updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
}
function bringLayerGroupToFront(layer){ if(!layer) return; if(layer.bringToFront) layer.bringToFront(); if(layer.eachLayer) layer.eachLayer(l=>{ if(l.bringToFront) l.bringToFront(); }); }
function refreshVectorStyles(){
  const s=styleVars();
  if(state.layers.rivers) state.layers.rivers.setStyle(f=>({color:s.river, weight:Math.max(.45, Number(f.properties.strokeweig||1.0)), opacity:state.theme==='light'?.55:.75}));
  if(state.layers.water) state.layers.water.setStyle(f=>{const ocean=(f.properties||{}).water_kind==='ocean'; return {color:s.waterLine, weight:ocean?1.0:.75, opacity:ocean?.78:.86, fillColor:s.waterFill, fillOpacity:ocean?(state.theme==='light'?.54:.48):(state.theme==='light'?.78:.60)};});
  if(state.layers.railways) state.layers.railways.setStyle({color:s.railway,weight:3.0,opacity:.95});
  if(state.layers.admin) refreshSelectionStyles();
  if(state.layers.circles) state.layers.circles.eachLayer(m=>m.setStyle({color:s.circleLine, fillColor:s.circleFill, fillOpacity:.74, opacity:.98}));
  if(state.layers.centers) state.layers.centers.eachLayer(m=>m.setStyle && m.setStyle({color:'#3a2607', fillColor:'#f6c85f', fillOpacity:.82, opacity:.98}));
  refreshVisibility();
}

function toggleSelection(f){ const id=featureId(f); if(state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id); refreshSelectionStyles(); updateStatsAndSelection(); showFeature(f); }
function refreshSelectionStyles(){ if(!state.layers.admin) return; state.layers.admin.eachLayer(l=>l.setStyle(adminStyle(l.feature,state._lastVals))); }
function refreshSelectionStylesFor(id){ const l=state.adminLayerById.get(id); if(l) l.setStyle(adminStyle(l.feature,state._lastVals)); }
function selectedFeatures(){ if(!state.currentGeoJSON) return []; if(!state.selectedIds.size) return state.currentGeoJSON.features; return state.currentGeoJSON.features.filter(f=>state.selectedIds.has(featureId(f))); }
function updateStatsAndSelection(){ if(!state.currentGeoJSON) return; updateStats(selectedFeatures()); updateSelectionBox(); updateLegend(state.currentGeoJSON,state._lastVals); }
function updateStats(features){
  const all=!state.selectedIds.size;
  const pops=features.map(f=>Number(f.properties.population)||0);
  const areas=features.map(f=>Number(f.properties.area_km2)||0);
  const urban=features.map(f=>Number(f.properties.urban_pop)||0);
  const rural=features.map(f=>Number(f.properties.rural_pop)||0);
  const rails=features.map(f=>Number(f.properties.rail_length_km)||0);
  const total=sum(pops); const area=sum(areas); const density=area?total/area:null;
  const urbanTotal=sum(urban); const ruralTotal=sum(rural); const urbanShare=total?urbanTotal/total:null;
  const railwayCount=state.layers.railways?state.layers.railways.getLayers().length:0;
  const baseAte=features.filter(f=>Number(f.properties.area_km2)>=700);
  const avgArea=avg(baseAte.map(f=>Number(f.properties.area_km2)));
  const avgPop=avg(baseAte.map(f=>Number(f.properties.population)));
  const avgDensity=avg(baseAte.map(f=>Number(f.properties.density)));
  const avgRail=avg(baseAte.map(f=>Number(f.properties.rail_length_km)));
  const avgRailD=avg(baseAte.map(f=>Number(f.properties.rail_density_km_1000)));
  const html=`<div class="stats-scope ${all?'':'selected-scope'}">${all?'Показанный слой':'Выборка'} · ${state.year}</div><div class="stat-grid"><div class="stat"><div class="k">объектов</div><div class="v">${fmt.format(features.length)}</div></div><div class="stat"><div class="k">население</div><div class="v">${num(total)}</div></div><div class="stat"><div class="k">площадь, км²</div><div class="v">${num(area)}</div></div><div class="stat"><div class="k">плотность</div><div class="v">${density?density.toFixed(2).replace('.',','):'—'}</div><div class="sub">чел./км²</div></div></div><div class="analytics-block"><h3>Базовая статистика</h3><div class="metric-line"><span>городское население</span><b>${num(urbanTotal)}</b></div><div class="metric-line"><span>сельское население</span><b>${num(ruralTotal)}</b></div><div class="metric-line"><span>доля городского</span><b>${pct(urbanShare)}</b></div><div class="metric-line"><span>активных ЖД-сегментов</span><b>${num(railwayCount)}</b></div><div class="metric-line"><span>ЖД внутри АТЕ, км</span><b>${num(sum(rails))}</b></div></div><div class="analytics-block"><h3>Средние по АТЕ ≥ 700 км²</h3><div class="metric-line"><span>учтено АТЕ</span><b>${num(baseAte.length)}</b></div><div class="metric-line"><span>средняя площадь</span><b>${num(avgArea)} км²</b></div><div class="metric-line"><span>среднее население</span><b>${num(avgPop)}</b></div><div class="metric-line"><span>средняя плотность</span><b>${num1(avgDensity)}</b></div><div class="metric-line"><span>средняя длина ЖД</span><b>${num1(avgRail)} км</b></div><div class="metric-line"><span>средняя плотность ЖД</span><b>${num1(avgRailD)} км/1000 км²</b></div></div>`;
  const left=$('statsBox'); if(left) left.innerHTML=html;
  const right=$('rightStatsBox'); if(right) right.innerHTML=html;
  updateGroupAnalytics(state.currentGeoJSON?.features || []);
}
function avg(arr){ const vals=arr.map(Number).filter(v=>!Number.isNaN(v) && Number.isFinite(v)); return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null; }
function updateGroupAnalytics(features){
  const box=$('groupAnalyticsBox'); if(!box) return;
  const base=features.filter(f=>Number(f.properties.area_km2)>=700 && f.properties.admin_parent);
  const groups=new Map();
  base.forEach(f=>{ const p=f.properties; const key=p.admin_parent || '—'; if(!groups.has(key)) groups.set(key, []); groups.get(key).push(f); });
  const metrics=[
    ['avg_area','Средняя площадь АТЕ, км²', fs=>avg(fs.map(f=>Number(f.properties.area_km2)))],
    ['avg_pop','Среднее население АТЕ', fs=>avg(fs.map(f=>Number(f.properties.population)))],
    ['avg_density','Средняя плотность, чел./км²', fs=>avg(fs.map(f=>Number(f.properties.density)))],
    ['avg_rail_density','Средняя плотность ЖД, км/1000 км²', fs=>avg(fs.map(f=>Number(f.properties.rail_density_km_1000)))],
  ];
  let html=`<div class="analytics-title">По верхнему уровню <span>без городов и малых полигонов &lt;700 км²</span></div>`;
  metrics.forEach(([id,title,fn])=>{
    const rows=[...groups.entries()].map(([name,fs])=>({name, n:fs.length, value:fn(fs)})).filter(r=>r.value!==null && !Number.isNaN(r.value)).sort((a,b)=>b.value-a.value).slice(0,8);
    const max=Math.max(...rows.map(r=>r.value),1);
    html+=`<div class="bar-chart"><h3>${title}</h3>${rows.map(r=>`<div class="bar-row"><div class="bar-label" title="${escapeHtml(r.name)}">${escapeHtml(r.name)} <span>${r.n}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,r.value/max*100)}%"></div></div><b>${id.includes('density')?num1(r.value):num(r.value)}</b></div>`).join('') || '<div class="mini-muted">Нет данных.</div>'}</div>`;
  });
  box.innerHTML=html;
}
function updateSelectionBox(){
  const box=$('selectionBox'); const sel=$('selectedFeatureSelect'); const selLabel=$('selectedFeatureSelectLabel'); const info=$('featureInfo');
  const feats=state.currentGeoJSON ? state.currentGeoJSON.features.filter(f=>state.selectedIds.has(featureId(f))) : [];
  if(sel){
    sel.innerHTML='';
    if(feats.length<=1){ sel.disabled=true; sel.style.display='none'; if(selLabel) selLabel.style.display='none'; }
    else { sel.disabled=false; sel.style.display='block'; if(selLabel) selLabel.style.display='block'; const head=document.createElement('option'); head.value=''; head.textContent='Выберите объект из выборки…'; sel.appendChild(head); feats.forEach(f=>{ const o=document.createElement('option'); o.value=featureId(f); o.textContent=f.properties.name || featureId(f); sel.appendChild(o); }); }
  }
  if(!feats.length){
    if(box){ box.classList.add('muted'); box.innerHTML=''; }
    if(info){ info.classList.add('muted'); info.innerHTML=''; }
    return;
  }
  if(feats.length===1){
    if(box){ box.classList.add('muted'); box.innerHTML=''; }
    showFeature(feats[0]);
    return;
  }
  if(box){
    box.classList.remove('muted');
    const names=feats.slice(0,12).map(f=>`<li>${f.properties.name||'без названия'}</li>`).join(''); const more=feats.length>12?`<li>…и ещё ${feats.length-12}</li>`:'';
    box.innerHTML=`<div class="selection-count">Выбрано объектов: ${feats.length}</div><ul class="selection-list">${names}${more}</ul><div class="mini-muted">Ниже можно переключаться между выбранными объектами и смотреть их атрибуты в карточке.</div>`;
  }
}
function objectAttributesHtml(f){
  const props=f?.properties || {};
  const rows=Object.entries(props).map(([k,v])=>`<div class="info-row attr-object-row"><span>${k}</span><b>${v===null||v===undefined||v===''?'—':String(v)}</b></div>`).join('');
  return `<div class="analytics-block object-attrs"><h3>Все атрибуты объекта</h3>${rows}</div>`;
}
function updateLegend(gj, vals){
  const box=$('legendBox'); if(!box || !gj) return; let html='<b>Легенда</b>';
  if(state.mode==='admin_parent'||state.mode==='unit_type'){ const field=state.mode; const cats=[...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,14); cats.forEach(c=>{html+=`<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${c}</div>`}); }
  else { ramp.forEach((c,i)=>{html+=`<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===ramp.length-1?'больше':''}</div>`}); }
  html+=`<div class="legend-section">Гидрография</div><div class="legend-row"><span class="swatch water-swatch"></span>океан, озёра и водохранилища</div><div class="legend-row"><span class="river-swatch"></span>реки</div>`;
  if($('toggleCircles')?.checked){ const max=state.maxPop||0; const mid=max/4; html+=`<div class="legend-section">Круги населения</div>`; [[max,'макс.'],[mid,'примерно 1/4 макс.']].forEach(([v,label])=>{ const size=Math.max(8, populationRadius(v,max)*1.25); html+=`<div class="legend-row"><span class="circle-swatch" style="width:${size}px;height:${size}px"></span>${label}: ${num(v)}</div>`; }); html+=`<div class="mini-muted">Площадь круга пропорциональна населению. Наведите курсор на круг, чтобы увидеть значение.</div>`; }
  if($('toggleCenters')?.checked && state.maxCenterPop){ const cmax=state.maxCenterPop; const cmid=cmax/4; html+=`<div class="legend-section">Центры</div>`; [[cmax,'макс.'],[cmid,'примерно 1/4 макс.']].forEach(([v,label])=>{ const size=Math.max(7, centerRadius(v,cmax)*1.45); html+=`<div class="legend-row"><span class="center-circle-swatch" style="width:${size}px;height:${size}px"></span>${label}: ${num(v)}</div>`; }); }
  box.innerHTML=html;
}
function showCenterFeature(f, marker){
  if(state.selectedCenterLayer && state.selectedCenterLayer.setStyle){
    state.selectedCenterLayer.setStyle({color:'#3a2607', weight:1.45, fillColor:'#f6c85f', fillOpacity:.86, opacity:.98});
  }
  state.selectedCenterLayer = marker;
  if(marker && marker.setStyle){ marker.setStyle({color:'#a65b00', weight:3.2, fillColor:'#ffcf67', fillOpacity:.95, opacity:1}); }
  const p=f.properties||{};
  const info=$('featureInfo'); if(!info) return;
  info.classList.remove('muted');
  info.innerHTML=`<span class="selection-badge on">центр</span><div class="info-title">${escapeHtml(p.name||'Центр')}</div><div class="info-row"><span>Единица</span><b>${escapeHtml(p.unit_name||'—')}</b></div><div class="info-row"><span>Подчинение</span><b>${escapeHtml(p.admin_parent||'—')}</b></div><div class="info-row"><span>Городское население центра</span><b>${num(pointPopulation(p))}</b></div><div class="info-row"><span>Источник показателя</span><b>${escapeHtml(p.center_pop_urban_source||'—')}</b></div>${objectAttributesHtml(f)}`;
}
function showFeature(f){ const p=f.properties; const id=featureId(f); const selected=state.selectedIds.has(id); const sel=$('selectedFeatureSelect'); if(sel && [...sel.options].some(o=>o.value===id)) sel.value=id; $('featureInfo').classList.remove('muted'); $('featureInfo').innerHTML=`<span class="selection-badge ${selected?'on':''}">${selected?'в выборке':'не выбрано'}</span><div class="info-title">${p.name||'Без названия'}</div><div class="info-row"><span>Год</span><b>${p.year||state.year}</b></div><div class="info-row"><span>Тип</span><b>${p.unit_type||'—'}</b></div><div class="info-row"><span>Подчинение</span><b>${p.admin_parent||'—'}</b></div><div class="info-row"><span>Центр</span><b>${p.center||'—'}</b></div><div class="info-row"><span>Население</span><b>${num(p.population)}</b></div><div class="info-row"><span>Городское</span><b>${num(p.urban_pop)}</b></div><div class="info-row"><span>Сельское</span><b>${num(p.rural_pop)}</b></div><div class="info-row"><span>Доля городского</span><b>${pct(p.urban_share)}</b></div><div class="info-row"><span>Площадь, км²</span><b>${num(p.area_km2)}</b></div><div class="info-row"><span>Плотность</span><b>${p.density==null?'—':Number(p.density).toFixed(2).replace('.',',')}</b></div><div class="info-row"><span>Исходный слой</span><b>${p.source_layer||'—'}</b></div>${objectAttributesHtml(f)}`; }


function updateAttributePanel(){
  const box=$('attributePanel'); if(!box || !state.currentGeoJSON) return;
  if(!state.attributesPanelOpen){ box.classList.add('muted'); box.innerHTML='Нажмите кнопку «Структура атрибутов слоя» слева.'; return; }
  box.classList.remove('muted');
  const feats=state.currentGeoJSON.features||[]; const fields=[]; const seen=new Set();
  feats.forEach(f=>Object.keys(f.properties||{}).forEach(k=>{ if(!seen.has(k)){ seen.add(k); fields.push(k); }}));
  const rows=fields.map(k=>{
    let filled=0; const types=new Set(); const samples=[];
    feats.forEach(f=>{ const v=(f.properties||{})[k]; if(v!==null && v!==undefined && v!==''){ filled++; types.add(Array.isArray(v)?'array':typeof v); if(samples.length<3 && !samples.includes(String(v))) samples.push(String(v)); }});
    return `<tr><td>${k}</td><td>${[...types].join(', ')||'—'}</td><td>${filled}/${feats.length}</td><td>${samples.join(' · ')||'—'}</td></tr>`;
  }).join('');
  box.innerHTML=`<div class="attr-head"><b>Слой ${state.year}</b><span>${feats.length} объектов · ${fields.length} полей</span></div><div class="attr-table-wrap"><table class="attr-table"><thead><tr><th>Поле</th><th>Тип</th><th>Заполнено</th><th>Примеры</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function setTool(tool){
  state.tool = tool || 'pan'; clearSelectionDrawing(); const selectMode=state.tool!=='pan';
  const select=$('toolSelect'); if(select && select.value!==state.tool) select.value=state.tool;
  document.querySelectorAll('[data-tool-button]').forEach(btn=>btn.classList.toggle('active', btn.dataset.toolButton===state.tool));
  if(state.map){
    if(selectMode) state.map.dragging.disable(); else state.map.dragging.enable();
    if(state.tool==='polygon') state.map.doubleClickZoom.disable(); else state.map.doubleClickZoom.enable();
  }
  document.body.classList.toggle('selection-tool-active', selectMode); document.body.dataset.tool = state.tool;
  const help=$('selectionToolHelp'); if(help){
    if(state.tool==='pan') help.innerHTML='Курсор: одиночный выбор кликом по району, кругу населения или центру. Карту можно двигать обычным перетаскиванием.';
    if(state.tool==='rectangle') help.innerHTML='Прямоугольная выборка: протяните рамку по карте. СКМ зажать — двигать карту. Shift — добавить, Alt — убрать.';
    if(state.tool==='polygon') help.innerHTML='Полигональная выборка: ставьте точки кликами, двойной клик или правая кнопка — завершить. СКМ зажать — двигать карту.';
  }
  const actions=$('selectionDrawActions'); if(actions) actions.style.display = state.tool==='polygon' ? 'grid' : 'none';
}
function bindSelectionHandlers(){
  state.map.on('mousedown', e=>{
    if(e.originalEvent && e.originalEvent.button===1){ startMiddlePan(e); return; }
    if(state.tool!=='rectangle') return;
    state.dragStart=e.latlng; if(state.dragRect){state.map.removeLayer(state.dragRect); state.dragRect=null;} L.DomEvent.preventDefault(e.originalEvent);
  });
  state.map.on('mousemove', e=>{ if(state.tool!=='rectangle'||!state.dragStart) return; const b=L.latLngBounds(state.dragStart,e.latlng); if(!state.dragRect) state.dragRect=L.rectangle(b,{color:'#b7791f',weight:1.8,fillColor:'#d9a441',fillOpacity:.12,interactive:false}).addTo(state.map); else state.dragRect.setBounds(b); });
  state.map.on('mouseup', e=>{ if(state.tool!=='rectangle'||!state.dragStart) return; const b=L.latLngBounds(state.dragStart,e.latlng); applySpatialSelectionByBounds(b,e.originalEvent); clearSelectionDrawing(false); state.dragStart=null; });
  state.map.on('click', e=>{ if(state.tool!=='polygon') return; addPolygonPoint(e.latlng); });
  state.map.on('dblclick contextmenu', e=>{ if(state.tool==='polygon'){ L.DomEvent.preventDefault(e.originalEvent); finishPolygonSelection(e.originalEvent); } });
  const container=state.map.getContainer();
  container.addEventListener('auxclick', ev=>{ if(ev.button===1){ ev.preventDefault(); ev.stopPropagation(); } });
}
function startMiddlePan(e){
  if(!state.map || !e.originalEvent) return;
  L.DomEvent.preventDefault(e.originalEvent); L.DomEvent.stopPropagation(e.originalEvent);
  state.middlePan={point:state.map.mouseEventToContainerPoint(e.originalEvent)};
  state.map.getContainer().classList.add('middle-panning');
  document.addEventListener('mousemove', onMiddlePanMove, {passive:false});
  document.addEventListener('mouseup', endMiddlePan, {passive:false});
}
function onMiddlePanMove(ev){
  if(!state.middlePan || !state.map) return;
  ev.preventDefault();
  const pt=state.map.mouseEventToContainerPoint(ev);
  const last=state.middlePan.point;
  state.map.panBy([last.x-pt.x, last.y-pt.y], {animate:false});
  state.middlePan.point=pt;
}
function endMiddlePan(ev){
  if(ev) ev.preventDefault();
  state.middlePan=null;
  if(state.map) state.map.getContainer().classList.remove('middle-panning');
  document.removeEventListener('mousemove', onMiddlePanMove);
  document.removeEventListener('mouseup', endMiddlePan);
}
function addPolygonPoint(latlng){
  state.polygonPoints.push(latlng); if(!state.polygonMarkers) state.polygonMarkers=L.layerGroup().addTo(state.map); L.circleMarker(latlng,{radius:4,color:'#b7791f',fillColor:'#d9a441',fillOpacity:.95,weight:1}).addTo(state.polygonMarkers);
  if(state.polygonLine){ state.map.removeLayer(state.polygonLine); }
  state.polygonLine=L.polyline(state.polygonPoints,{color:'#b7791f',weight:2,dashArray:'5 5'}).addTo(state.map);
}
function finishPolygonSelection(ev){ if(state.tool!=='polygon'||state.polygonPoints.length<3) return; applySpatialSelectionByPolygon(state.polygonPoints, ev||{}); clearSelectionDrawing(false); }
function clearSelectionDrawing(removePoints=true){ if(state.dragRect){state.map.removeLayer(state.dragRect); state.dragRect=null;} state.dragStart=null; if(removePoints){state.polygonPoints=[];} if(state.polygonLine){state.map.removeLayer(state.polygonLine); state.polygonLine=null;} if(state.polygonMarkers){state.map.removeLayer(state.polygonMarkers); state.polygonMarkers=null;} }
function applySpatialSelectionByBounds(bounds, event){
  const mode=event?.altKey?'remove':event?.shiftKey?'add':'replace';
  const ring=boundsToLngLatRing(bounds);
  const ids=[];
  if(state.layers.admin){
    state.layers.admin.eachLayer(l=>{
      // Быстрый bbox-фильтр + проверка пересечения геометрии. Теперь объект выбирается не по центроиду,
      // а при реальном касании рамки с полигоном.
      if(!l.getBounds().intersects(bounds)) return;
      if(featureIntersectsRing(l.feature, ring)) ids.push(featureId(l.feature));
    });
  }
  applyIds(ids,mode);
}
function applySpatialSelectionByPolygon(points, event){
  const mode=event?.altKey?'remove':event?.shiftKey?'add':'replace';
  const ring=points.map(ll=>[ll.lng,ll.lat]);
  if(ring.length && (ring[0][0]!==ring[ring.length-1][0] || ring[0][1]!==ring[ring.length-1][1])) ring.push(ring[0]);
  const polyBounds=L.latLngBounds(points);
  const ids=[];
  if(state.layers.admin){
    state.layers.admin.eachLayer(l=>{
      if(!l.getBounds().intersects(polyBounds)) return;
      if(featureIntersectsRing(l.feature, ring)) ids.push(featureId(l.feature));
    });
  }
  applyIds(ids,mode);
}
function applyIds(ids, mode){ if(mode==='replace') state.selectedIds=new Set(ids); else if(mode==='add') ids.forEach(id=>state.selectedIds.add(id)); else if(mode==='remove') ids.forEach(id=>state.selectedIds.delete(id)); refreshSelectionStyles(); updateStatsAndSelection(); }
function boundsToLngLatRing(bounds){
  const sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
  return [[sw.lng,sw.lat],[ne.lng,sw.lat],[ne.lng,ne.lat],[sw.lng,ne.lat],[sw.lng,sw.lat]];
}
function featureIntersectsRing(feature, selectionRing){
  const geom=feature?.geometry; if(!geom || !selectionRing?.length) return false;
  const featureRings=getPolygonRings(geom); if(!featureRings.length) return false;
  // 1) вершина объекта внутри выборки
  for(const ring of featureRings){ for(const pt of ring){ if(pointInRing(pt, selectionRing)) return true; } }
  // 2) вершина выборки внутри объекта
  for(const pt of selectionRing){ if(pointInFeaturePolygon(pt, geom)) return true; }
  // 3) пересечение ребер
  for(const ring of featureRings){
    for(let i=1;i<ring.length;i++){
      for(let j=1;j<selectionRing.length;j++){
        if(segmentsIntersect(ring[i-1], ring[i], selectionRing[j-1], selectionRing[j])) return true;
      }
    }
  }
  return false;
}
function getPolygonRings(geom){
  if(!geom) return [];
  if(geom.type==='Polygon') return geom.coordinates || [];
  if(geom.type==='MultiPolygon') return (geom.coordinates || []).flat();
  if(geom.type==='GeometryCollection') return (geom.geometries || []).flatMap(getPolygonRings);
  return [];
}
function pointInFeaturePolygon(pt, geom){
  if(geom.type==='Polygon') return pointInPolygonWithHoles(pt, geom.coordinates || []);
  if(geom.type==='MultiPolygon') return (geom.coordinates || []).some(poly=>pointInPolygonWithHoles(pt, poly));
  if(geom.type==='GeometryCollection') return (geom.geometries || []).some(g=>pointInFeaturePolygon(pt,g));
  return false;
}
function pointInPolygonWithHoles(pt, rings){
  if(!rings.length || !pointInRing(pt, rings[0])) return false;
  for(let i=1;i<rings.length;i++){ if(pointInRing(pt, rings[i])) return false; }
  return true;
}
function pointInRing(point, vs){
  const x=point[0], y=point[1]; let inside=false;
  for(let i=0,j=vs.length-1;i<vs.length;j=i++){
    const xi=vs[i][0], yi=vs[i][1], xj=vs[j][0], yj=vs[j][1];
    const intersect=((yi>y)!=(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function orient(a,b,c){ return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]); }
function onSegment(a,b,c){ return Math.min(a[0],c[0])-1e-12<=b[0] && b[0]<=Math.max(a[0],c[0])+1e-12 && Math.min(a[1],c[1])-1e-12<=b[1] && b[1]<=Math.max(a[1],c[1])+1e-12; }
function segmentsIntersect(a,b,c,d){
  const o1=orient(a,b,c), o2=orient(a,b,d), o3=orient(c,d,a), o4=orient(c,d,b);
  if(Math.abs(o1)<1e-12 && onSegment(a,c,b)) return true;
  if(Math.abs(o2)<1e-12 && onSegment(a,d,b)) return true;
  if(Math.abs(o3)<1e-12 && onSegment(c,a,d)) return true;
  if(Math.abs(o4)<1e-12 && onSegment(c,b,d)) return true;
  return (o1>0)!=(o2>0) && (o3>0)!=(o4>0);
}

init().catch(err=>{console.error(err); alert('Ошибка загрузки данных: '+err.message);});
