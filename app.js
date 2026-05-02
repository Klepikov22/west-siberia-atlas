const fmt = new Intl.NumberFormat('ru-RU');
const $ = (id) => document.getElementById(id);

const state = {
  manifest:null,
  year:null,
  mode:'admin_parent',
  theme:'light',
  hydroOrder:'above',
  layers:{},
  cache:{},
  map:null,
  colors:{},
  selectedIds:new Set(),
  adminLayerById:new Map(),
  currentGeoJSON:null,
  _lastVals:[]
};

const DATA_BOUNDS = L.latLngBounds([[43.2,58.2],[74.3,91.5]]);
const SOFT_BOUNDS = L.latLngBounds([[40.6,55.0],[76.5,94.5]]);
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
function catColor(v){
  if(!v) return '#9a958d';
  if(!state.colors[v]) state.colors[v]=palette[Object.keys(state.colors).length%palette.length];
  return state.colors[v];
}
function num(v){ return v==null||Number.isNaN(Number(v)) ? '—' : fmt.format(Math.round(Number(v))); }
function num1(v){ return v==null||Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(1).replace('.',','); }
function pct(v){ return v==null||Number.isNaN(Number(v)) ? '—' : (Number(v)*100).toFixed(1).replace('.',',')+'%'; }
async function loadJson(path){ if(state.cache[path]) return state.cache[path]; const r=await fetch(path); if(!r.ok) throw new Error(`${r.status} ${path}`); const j=await r.json(); state.cache[path]=j; return j; }

async function init(){
  document.documentElement.dataset.theme = state.theme;
  state.manifest = await loadJson('data/manifest.json');
  state.year = state.manifest.years.includes(1914)?1914:state.manifest.years[0];
  setYearLabels();
  buildTimeline();
  state.map = L.map('map', {
    zoomControl:true,
    preferCanvas:true,
    zoomSnap:0.25,
    zoomDelta:0.5,
    scrollWheelZoom:'center',
    doubleClickZoom:'center',
    touchZoom:'center',
    wheelPxPerZoomLevel:140,
    wheelDebounceTime:45,
    inertia:true,
    inertiaDeceleration:3200,
    easeLinearity:0.18,
    maxBounds:SOFT_BOUNDS,
    maxBoundsViscosity:0.42,
    zoomAnimation:true,
    markerZoomAnimation:true,
    fadeAnimation:true
  }).setView([57.5,75],4);
  createPanes();
  L.control.scale({imperial:false}).addTo(state.map);
  state.map.on('dragend', () => {
    const center = state.map.getCenter();
    if (!SOFT_BOUNDS.contains(center)) {
      state.map.panInsideBounds(DATA_BOUNDS, {animate:true, duration:0.55, easeLinearity:0.18});
    }
  });
  bindUi();
  await refreshAll();
  setTimeout(()=>state.map.invalidateSize(),300);
  window.addEventListener('resize', () => setTimeout(()=>state.map.invalidateSize(),120));
}

function createPanes(){
  const panes = {
    reliefPane:150,
    oceanPane:210,
    hydroBelowPane:330,
    adminPane:420,
    hydroAbovePane:510,
    circlesPane:560,
    railwayPane:600,
    centersPane:650
  };
  Object.entries(panes).forEach(([name,z])=>{
    if(!state.map.getPane(name)) state.map.createPane(name);
    state.map.getPane(name).style.zIndex = z;
    state.map.getPane(name).style.pointerEvents = name === 'adminPane' || name === 'circlesPane' || name === 'railwayPane' || name === 'centersPane' ? 'auto' : 'none';
  });
}

function bindUi(){
  $('modeSelect').addEventListener('change', async e=>{state.mode=e.target.value; await refreshAdmin();});
  $('themeSelect').addEventListener('change', e=>{state.theme=e.target.value; document.documentElement.dataset.theme=state.theme; refreshVectorStyles();});
  $('hydroOrderSelect').addEventListener('change', async e=>{state.hydroOrder=e.target.value; await refreshHydro(); refreshVisibility();});
  ['toggleRelief','toggleOcean','toggleHydro','toggleCenters','toggleRailways','toggleCircles'].forEach(id=>$(id).addEventListener('change', refreshVisibility));
  $('resetView').addEventListener('click', ()=> state.map.flyToBounds(DATA_BOUNDS, {duration:0.75, easeLinearity:0.18, padding:[18,18]}));
  $('clearSelection').addEventListener('click', ()=>{state.selectedIds.clear(); refreshSelectionStyles(); updateStatsAndSelection();});
  $('selectAll').addEventListener('click', ()=>{ if(!state.currentGeoJSON) return; state.selectedIds = new Set(state.currentGeoJSON.features.map(featureId)); refreshSelectionStyles(); updateStatsAndSelection(); });
}

function buildTimeline(){
  const track = $('yearTimeline');
  track.innerHTML = '';
  state.manifest.years.forEach(y=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='timeline-year';
    btn.dataset.year=String(y);
    btn.textContent=y;
    btn.addEventListener('click', async ()=>{
      if(state.year===y) return;
      state.year = y;
      state.selectedIds.clear();
      setYearLabels();
      setTimelineActive();
      await refreshAll();
    });
    track.appendChild(btn);
  });
  setTimelineActive();
}
function setYearLabels(){
  if($('activeYearLabel')) $('activeYearLabel').textContent = state.year;
  if($('timelineYearLabel')) $('timelineYearLabel').textContent = state.year;
}
function setTimelineActive(){
  document.querySelectorAll('.timeline-year').forEach(btn=>{
    const active = Number(btn.dataset.year) === state.year;
    btn.classList.toggle('active', active);
    if(active) setTimeout(()=>btn.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'}), 60);
  });
}

function clearLayer(name){ if(state.layers[name]){ state.map.removeLayer(state.layers[name]); state.layers[name]=null; }}
async function refreshAll(){ await refreshRelief(); await refreshOcean(); await refreshAdmin(); await refreshHydro(); await refreshCenters(); await refreshRailways(); refreshVisibility(); setYearLabels(); setTimelineActive(); }

async function refreshRelief(){
  clearLayer('relief');
  const b=await loadJson(state.manifest.layers.raster.relief_bounds);
  const [w,s,e,n]=b.bounds_4326;
  state.layers.relief=L.imageOverlay(state.manifest.layers.raster.relief_preview, [[s,w],[n,e]], {pane:'reliefPane', opacity: state.theme==='light' ? .12 : .20, interactive:false});
}

async function refreshOcean(){
  clearLayer('ocean');
  const oceanPath = state.manifest.layers.ocean && state.manifest.layers.ocean.main;
  if(!oceanPath) return;
  const gj=await loadJson(oceanPath);
  state.layers.ocean=L.geoJSON(gj,{pane:'oceanPane', style:oceanStyle, interactive:false});
}

function isReservoirFeature(f){
  const p=f.properties || {};
  const reservoir = String(p.reservoir ?? p.Reservoir ?? p.RESERVOIR ?? '').toLowerCase();
  const feature = String(p.featurecla ?? p.FEATURECLA ?? '').toLowerCase();
  const name = String(p.name ?? p.name_ru ?? '').toLowerCase();
  return reservoir === '1' || reservoir === 'true' || reservoir === 'yes' || reservoir === 'y' || feature.includes('reservoir') || name.includes('vodokhranilishche') || name.includes('водохранили');
}
function filterLakesByYear(lakes){
  if(state.year >= 1959) return lakes;
  return {type:'FeatureCollection', features:lakes.features.filter(f=>!isReservoirFeature(f))};
}
async function refreshHydro(){
  clearLayer('rivers'); clearLayer('lakes');
  const rivers=await loadJson(state.manifest.layers.hydro.rivers);
  const lakesRaw=await loadJson(state.manifest.layers.hydro.lakes);
  const lakes=filterLakesByYear(lakesRaw);
  const t=themeStyle();
  const pane = state.hydroOrder === 'above' ? 'hydroAbovePane' : 'hydroBelowPane';
  state.layers.rivers=L.geoJSON(rivers,{pane, style:f=>({color:t.river,weight: Math.max(.45, Number(f.properties.strokeweig||1.05)), opacity: state.theme==='light' ? .68 : .78}), interactive:false});
  state.layers.lakes=L.geoJSON(lakes,{pane, style:{color:t.lakeLine,weight:.85,fillColor:t.lakeFill,fillOpacity: state.theme==='light' ? .64 : .58, opacity:.92}, interactive:false});
}

function themeStyle(){
  const light = state.theme !== 'dark';
  return {
    adminLine: light ? '#655b4e' : '#e7d8ba',
    adminFillOpacity: light ? .42 : .55,
    selectedLine: light ? '#222222' : '#ffffff',
    oceanFill: light ? '#cfe7f4' : '#17364a',
    oceanLine: light ? '#65a8c8' : '#5bb6e5',
    lakeLine: light ? '#20749d' : '#4ea5d9',
    lakeFill: light ? '#b9dbe8' : '#2b80b9',
    river: light ? '#2b8db4' : '#56b4e9',
    railway: light ? '#1f1b17' : '#1a1712',
    centerStroke: light ? '#ffffff' : '#111111'
  };
}
function oceanStyle(){ const t=themeStyle(); return {color:t.oceanLine, weight:1.0, opacity:.75, fillColor:t.oceanFill, fillOpacity: state.theme==='light' ? .92 : .70}; }

function refreshVectorStyles(){
  const t = themeStyle();
  if(state.layers.relief) state.layers.relief.setOpacity(state.theme==='light' ? .12 : .20);
  if(state.layers.ocean) state.layers.ocean.setStyle(oceanStyle);
  if(state.layers.rivers) state.layers.rivers.setStyle(f=>({color:t.river, weight: Math.max(.45, Number(f.properties.strokeweig||1.05)), opacity: state.theme==='light' ? .68 : .78}));
  if(state.layers.lakes) state.layers.lakes.setStyle({color:t.lakeLine, weight:.85, fillColor:t.lakeFill, fillOpacity: state.theme==='light' ? .64 : .58, opacity:.92});
  if(state.layers.admin) refreshSelectionStyles();
  if(state.layers.railways) state.layers.railways.setStyle({color:t.railway, weight:3.4, opacity:.95});
}

function featureId(f){ return f.properties.unit_id || `${f.properties.year}_${f.properties.raw_objectid || f.properties.name}`; }
function valField(){ return state.mode==='population'?'population':state.mode==='density'?'density':state.mode==='urban_share'?'urban_share':null; }
function adminStyle(feature, vals){
  const p=feature.properties;
  let fill='#999';
  if(state.mode==='admin_parent') fill=catColor(p.admin_parent);
  if(state.mode==='unit_type') fill=catColor(p.unit_type);
  if(state.mode==='population') fill=valueColor(Number(p.population), vals);
  if(state.mode==='density') fill=valueColor(Number(p.density), vals);
  if(state.mode==='urban_share') fill=valueColor(Number(p.urban_share), vals);
  const t=themeStyle();
  const selected = state.selectedIds.has(featureId(feature));
  return {
    color:selected ? t.selectedLine : t.adminLine,
    weight:selected ? 2.8 : 1.05,
    opacity:selected ? 1 : .86,
    fillColor:fill,
    fillOpacity:selected ? Math.min(.72, t.adminFillOpacity + .18) : t.adminFillOpacity
  };
}

async function refreshAdmin(){
  clearLayer('admin'); clearLayer('circles');
  state.adminLayerById.clear();
  const path=state.manifest.layers.admin[String(state.year)];
  const gj=await loadJson(path);
  state.currentGeoJSON = gj;
  const field = valField();
  const vals = field ? gj.features.map(f=>Number(f.properties[field])).filter(v=>!Number.isNaN(v)) : [];
  state._lastVals = vals;
  const admin = L.geoJSON(gj,{
    pane:'adminPane',
    style:f=>adminStyle(f,vals),
    onEachFeature:(f,l)=>{
      const id=featureId(f);
      state.adminLayerById.set(id,l);
      l.on('click',(ev)=>{ L.DomEvent.stopPropagation(ev); toggleFeatureSelection(f); showFeature(f); });
      l.bindTooltip(f.properties.name||'без названия',{sticky:true});
    }
  });
  state.layers.admin=admin;
  state.layers.circles=L.layerGroup([], {pane:'circlesPane'});
  const maxPop=Math.max(...gj.features.map(f=>Number(f.properties.population)||0),1);
  admin.eachLayer(layer=>{
    const p=layer.feature.properties;
    if(!p.population) return;
    const c=layer.getBounds().getCenter();
    const r=4+Math.sqrt(Number(p.population)/maxPop)*28;
    const m=L.circleMarker(c,{pane:'circlesPane', radius:r, color:'#271f12', weight:1, fillColor:'#d9a441', fillOpacity:.52});
    m.on('click',(ev)=>{L.DomEvent.stopPropagation(ev); toggleFeatureSelection(layer.feature); showFeature(layer.feature);});
    m.bindPopup(`<b>${p.name||'объект'}</b><br>Население: ${num(p.population)}<br><span class="muted">Клик — добавить/убрать из выборки</span>`);
    state.layers.circles.addLayer(m);
  });
  updateLegend(gj, vals);
  updateStatsAndSelection();
  if(!state._fitDone){ state.map.flyToBounds(admin.getBounds(), {duration:0.7, easeLinearity:0.18, padding:[18,18]}); state._fitDone=true; }
}

function toggleFeatureSelection(f){
  const id=featureId(f);
  if(state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id);
  refreshSelectionStyles();
  updateStatsAndSelection();
}
function refreshSelectionStyles(){
  if(!state.layers.admin) return;
  state.layers.admin.eachLayer(layer=>{
    layer.setStyle(adminStyle(layer.feature, state._lastVals));
    if(state.selectedIds.has(featureId(layer.feature))) layer.bringToFront();
  });
}

async function refreshCenters(){
  clearLayer('centers');
  const path=state.manifest.layers.centers[String(state.year)];
  if(!path) return;
  const gj=await loadJson(path);
  state.layers.centers=L.geoJSON(gj,{pane:'centersPane',pointToLayer:(f,latlng)=>L.circleMarker(latlng,{pane:'centersPane',radius:4,color:'#111',weight:1.4,fillColor:'#f6d365',fillOpacity:.95}),onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`<b>${p.name||'центр'}</b><br>${p.unit_name||''}<br>${p.admin_parent||''}`)}});
}

async function refreshRailways(){
  clearLayer('railways');
  const gj=await loadJson(state.manifest.layers.railways.main);
  const yr=state.year;
  const filtered={type:'FeatureCollection', features:gj.features.filter(f=>{const p=f.properties; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close); return o<=yr && (c==null || c>yr);})};
  const t=themeStyle();
  state.layers.railways=L.geoJSON(filtered,{pane:'railwayPane',style:{color:t.railway,weight:3.4,opacity:.95},onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`ЖД-сегмент<br>постр.: ${p.year_open||'—'}<br>упразд.: ${p.year_close||'—'}`)}});
}

function refreshVisibility(){
  const order=[['relief','toggleRelief'],['ocean','toggleOcean'],['admin',null],['rivers','toggleHydro'],['lakes','toggleHydro'],['circles','toggleCircles'],['railways','toggleRailways'],['centers','toggleCenters']];
  order.forEach(([layerName,toggle])=>{
    const layer=state.layers[layerName];
    if(!layer) return;
    const show= toggle?$(toggle).checked:true;
    if(show && !state.map.hasLayer(layer)) layer.addTo(state.map);
    if(!show && state.map.hasLayer(layer)) state.map.removeLayer(layer);
  });
  refreshSelectionStyles();
}

function selectedFeatures(){
  if(!state.currentGeoJSON) return [];
  if(!state.selectedIds.size) return state.currentGeoJSON.features;
  return state.currentGeoJSON.features.filter(f=>state.selectedIds.has(featureId(f)));
}
function sumField(features, field){ return features.reduce((s,f)=>{const v=Number(f.properties[field]); return Number.isNaN(v)?s:s+v;},0); }
function valuesOf(features, field){ return features.map(f=>Number(f.properties[field])).filter(v=>!Number.isNaN(v)); }
function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
function currentCharacteristicStats(features){
  const field = valField();
  if(field){
    const vals=valuesOf(features, field);
    if(!vals.length) return '<div class="mini-muted">Для выбранной характеристики нет числовых значений.</div>';
    const sum = vals.reduce((a,b)=>a+b,0);
    return `<div class="metric-line"><span>Показатель</span><b>${labelForMode()}</b></div>
      <div class="metric-line"><span>сумма</span><b>${field==='urban_share'?'—':num(sum)}</b></div>
      <div class="metric-line"><span>среднее</span><b>${field==='urban_share'?pct(mean(vals)):num1(mean(vals))}</b></div>
      <div class="metric-line"><span>мин / макс</span><b>${field==='urban_share'?pct(Math.min(...vals))+' / '+pct(Math.max(...vals)):num1(Math.min(...vals))+' / '+num1(Math.max(...vals))}</b></div>`;
  }
  const catField = state.mode;
  const counts = new Map();
  features.forEach(f=>{const v=f.properties[catField]||'—'; counts.set(v,(counts.get(v)||0)+1);});
  const top=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  return `<div class="metric-line"><span>Группировка</span><b>${labelForMode()}</b></div>` + top.map(([k,v])=>`<div class="metric-line"><span>${k}</span><b>${v}</b></div>`).join('');
}
function labelForMode(){
  return ({admin_parent:'административная принадлежность',population:'население',density:'плотность населения',urban_share:'доля городского населения',unit_type:'тип единицы'})[state.mode] || state.mode;
}
function updateStatsAndSelection(){
  const all = state.currentGeoJSON ? state.currentGeoJSON.features : [];
  const features = selectedFeatures();
  const selectedMode = state.selectedIds.size > 0;
  const pop=sumField(features,'population');
  const urban=sumField(features,'urban_pop');
  const rural=sumField(features,'rural_pop');
  const area=sumField(features,'area_km2');
  const weightedDensity = pop && area ? pop/area : null;
  const densityMean = mean(valuesOf(features,'density'));
  const urbanShare = pop && urban ? urban/pop : null;
  const railwayCount=state.layers.railways?state.layers.railways.getLayers().length:0;
  $('statsBox').innerHTML=`
    <div class="stats-scope ${selectedMode?'selected-scope':''}">${selectedMode?'Выборка':'Весь показанный слой'} · ${labelForMode()}</div>
    <div class="stat-grid">
      <div class="stat"><div class="k">объектов</div><div class="v">${fmt.format(features.length)}</div><div class="sub">из ${fmt.format(all.length)}</div></div>
      <div class="stat"><div class="k">население</div><div class="v">${num(pop)}</div><div class="sub">сумма</div></div>
      <div class="stat"><div class="k">площадь, км²</div><div class="v">${num(area)}</div><div class="sub">после обрезки океаном</div></div>
      <div class="stat"><div class="k">плотность</div><div class="v">${weightedDensity?num1(weightedDensity):'—'}</div><div class="sub">нас. / площадь</div></div>
      <div class="stat"><div class="k">доля городского</div><div class="v">${urbanShare?pct(urbanShare):'—'}</div><div class="sub">по сумме городского</div></div>
      <div class="stat"><div class="k">ЖД-сегм.</div><div class="v">${fmt.format(railwayCount)}</div><div class="sub">на ${state.year}</div></div>
    </div>
    <div class="analytics-block">
      <h3>Текущая характеристика</h3>
      ${currentCharacteristicStats(features)}
    </div>
    <div class="analytics-block compact">
      <div class="metric-line"><span>городское / сельское</span><b>${num(urban)} / ${num(rural)}</b></div>
      <div class="metric-line"><span>средняя плотность районов</span><b>${densityMean?num1(densityMean):'—'}</b></div>
    </div>`;
  updateSelectionBox(features, selectedMode);
}
function updateSelectionBox(features, selectedMode){
  const box=$('selectionBox');
  if(!selectedMode){
    box.innerHTML='<div class="muted">Выборка не задана. Статистика считается по всему слою. Кликните по одному или нескольким районам/уездам, чтобы пересчитать показатели по выборке.</div>';
    return;
  }
  const names=features.map(f=>f.properties.name||'без названия').slice(0,18);
  box.innerHTML=`<div class="selection-count">Выбрано: ${features.length}</div><ol class="selection-list">${names.map(n=>`<li>${n}</li>`).join('')}${features.length>names.length?`<li>…ещё ${features.length-names.length}</li>`:''}</ol>`;
}

function updateLegend(gj, vals){
  const box=$('legendBox');
  let html='<b>Легенда</b>';
  if(state.mode==='admin_parent'||state.mode==='unit_type'){
    const field=state.mode;
    const cats=[...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,12);
    cats.forEach(c=>{html+=`<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${c}</div>`});
  } else {
    ramp.forEach((c,i)=>{html+=`<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===ramp.length-1?'больше':''}</div>`});
  }
  box.innerHTML=html;
}
function showFeature(f){
  const p=f.properties;
  const selected = state.selectedIds.has(featureId(f));
  $('featureInfo').classList.remove('muted');
  $('featureInfo').innerHTML=`<div class="info-title">${p.name||'Без названия'}</div>
  <div class="selection-badge ${selected?'on':''}">${selected?'в выборке':'не выбрано'} · клик по полигону переключает</div>
  <div class="info-row"><span>Год</span><b>${p.year||state.year}</b></div>
  <div class="info-row"><span>Тип</span><b>${p.unit_type||'—'}</b></div>
  <div class="info-row"><span>Подчинение</span><b>${p.admin_parent||'—'}</b></div>
  <div class="info-row"><span>Центр</span><b>${p.center||'—'}</b></div>
  <div class="info-row"><span>Население</span><b>${num(p.population)}</b></div>
  <div class="info-row"><span>Городское</span><b>${num(p.urban_pop)}</b></div>
  <div class="info-row"><span>Сельское</span><b>${num(p.rural_pop)}</b></div>
  <div class="info-row"><span>Доля городского</span><b>${pct(p.urban_share)}</b></div>
  <div class="info-row"><span>Площадь, км²</span><b>${num(p.area_km2)}</b></div>
  <div class="info-row"><span>Плотность</span><b>${p.density==null?'—':Number(p.density).toFixed(2).replace('.',',')}</b></div>
  <div class="info-row"><span>Исходный слой</span><b>${p.source_layer||'—'}</b></div>`;
}

init().catch(err=>{console.error(err); alert('Ошибка загрузки данных: '+err.message);});
