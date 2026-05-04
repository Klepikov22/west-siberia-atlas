const APP_VERSION = '58';
const BASE_MIN_ZOOM = 3.5;
const WHEEL_ZOOM_STEP = 0.25;
const MIN_ZOOM_WHEEL_STEPS_IN = 6;
const MAP_MIN_ZOOM = BASE_MIN_ZOOM + WHEEL_ZOOM_STEP * MIN_ZOOM_WHEEL_STEPS_IN; // 5.0: на 6 snap-шагов колёсика ближе прежнего минимума
const MAP_RESET_MAX_ZOOM = Math.max(5, MAP_MIN_ZOOM);
const fmt = new Intl.NumberFormat('ru-RU');
const $ = (id) => document.getElementById(id);

const state = {
  manifest:null, year:null, mode:'admin_parent', theme:'light', uiStyle:'normal', tool:'pan', pieGrouping:'upper', regionStyle:'soft', basemapStyle:'sage', populationSymbol:{type:'circle', scale:'sqrt', minSize:5, maxSize:39},
  map:null, cache:{}, layers:{}, colors:{}, currentGeoJSON:null, rawGeoJSON:null, rawCentersGeoJSON:null, _lastVals:[],
  selectedIds:new Set(), adminLayerById:new Map(), labelItems:[], selectedFeature:null, selectedCenterLayer:null, attributesPanelOpen:false,
  lastAnalyticsFeatures:[], lastAnalyticsScope:'текущему слою', activePieField:null, activePieTitle:null, piePalette:'softPastel',
  visibleParents:new Set(), parentCounts:new Map(), parentFilterYear:null,
  export:{open:false, scope:'currentLayer', showLegend:true, showStats:true, showContext:true, showGraticule:true, showScale:true, showAdmin:true, showHydro:true, showRailways:true, showPopulation:true, showLabels:true, fitScope:true, contextMode:'short', title:'', subtitle:'', contextText:'', mapImage:'', paper:'a4Landscape', template:'thesis', projection:'lambert', centralMeridian:75, labelMode:'balanced', minPopulation:0, minArea:0, liveMap:null, liveLayers:[], overlayPositions:{}},
  filters:{
    population:{minFraction:0, maxFraction:1, min:0, max:0, minThreshold:null, maxThreshold:null},
    area_km2:{minFraction:0, maxFraction:1, min:0, max:0, minThreshold:null, maxThreshold:null},
    density:{minFraction:0, maxFraction:1, min:0, max:0, minThreshold:null, maxThreshold:null}
  },
  metricFilterDrag:{active:false, dx:0, dy:0}, parentFilterDrag:{active:false, dx:0, dy:0}, sidePanels:{left:false,right:false}, bottomWidgetsPositioned:false,
  dragStart:null, dragRect:null, polygonPoints:[], polygonLine:null, polygonMarkers:null, middlePan:null, hoverBox:null, hoverTimer:null, hoverPayload:null, centerLabelOverlay:null, centerLabelItems:[], refreshSeq:0
};

const palette = ['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#d9d9d9'];
const chartPalettes = {
  softPastel:['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#d9d9d9'],
  classic:['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ab'],
  earth:['#a97142','#d9a441','#6f8f72','#b88a6a','#7e6d53','#c7b37a','#8ab0a5','#d07b5f','#9b8066','#c7a46b'],
  north:['#5aa6c8','#7ccba2','#b8de6f','#f3e79b','#f2a65a','#d95f53','#8da0cb','#66c2a5','#a6d854','#ffd92f'],
  contrast:['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02','#a6761d','#666666','#1f78b4','#b2df8a'],
  monoBlue:['#08306b','#08519c','#2171b5','#4292c6','#6baed6','#9ecae1','#c6dbef','#41b6c4','#2c7fb8','#253494']
};
function chartPalette(){
  return chartPalettes[state.piePalette] || chartPalettes.softPastel;
}
function chartSliceColor(name, index){
  if(String(name || '').trim().toLowerCase()==='прочие') return '#d6d6d6';
  const colors=chartPalette();
  return colors[index % colors.length];
}

const regionPalettes = {
  soft:['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#d9d9d9'],
  paper:['#c7b37a','#9fb17b','#d6a66f','#a9b8b5','#c7967d','#b7a18a','#9da77f','#d8c590','#bfa080','#c8bca3'],
  thin:['#b6d7c9','#dce9b8','#c7c5df','#e6b7a9','#accbe1','#eac989','#bddaaa','#e4c3d2','#c8b6cf','#d5e4c9'],
  ink:['#b8c7cf','#d8d4b2','#b3adc8','#c7a493','#9fb5c2','#c6aa78','#a9b28b','#c3a7ba','#a99db6','#c5c4ad'],
  vivid:['#2dd4bf','#facc15','#a78bfa','#fb7185','#38bdf8','#f59e0b','#84cc16','#f472b6','#c084fc','#22c55e'],
  contrast:['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02','#a6761d','#1f78b4','#b2df8a','#fb9a99'],
  matchaLatte:['#b8d2a0','#efe4bd','#97b989','#d8cda3','#accbb4','#c9b07e','#e6d7b0','#88aa7d','#c4d7a1','#b2c7ad']
};
function regionPalette(){ return regionPalettes[state.regionStyle] || regionPalettes.soft; }
function regionStyleConfig(){
  const dark = state.theme === 'dark';
  const configs = {
    soft:{line:dark?'#e3cdaa':'#746a5c', weight:1.05, opacity:.92, fillOpacity:dark ? .50 : .50, selectedWeight:2.8},
    paper:{line:dark?'#d8c08d':'#8b7045', weight:1.20, opacity:.88, fillOpacity:dark ? .42 : .38, selectedWeight:2.7, dashArray:'5 3'},
    thin:{line:dark?'#cbd5d0':'#8a958a', weight:.70, opacity:.82, fillOpacity:dark ? .36 : .32, selectedWeight:2.2},
    ink:{line:dark?'#efe2c2':'#4d463d', weight:1.35, opacity:.95, fillOpacity:dark ? .42 : .40, selectedWeight:3.1},
    vivid:{line:dark?'#fff0cc':'#6b4308', weight:1.20, opacity:.96, fillOpacity:dark ? .58 : .62, selectedWeight:3.2},
    contrast:{line:dark?'#f6f1e5':'#242a31', weight:1.45, opacity:1, fillOpacity:dark ? .62 : .66, selectedWeight:3.4},
    matchaLatte:{line:dark?'#d9e6bf':'#6f8454', weight:1.12, opacity:.94, fillOpacity:dark ? .48 : .53, selectedWeight:3.0}
  };
  return configs[state.regionStyle] || configs.soft;
}
const ramp = ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#3182bd','#08519c'];
const valueRamps = {
  default:ramp,
  matchaLatte:['#fbf8e9','#e8efd0','#cfe3ad','#aacb83','#7fa95e','#5e8843','#3f652e'],
  vivid:['#fff7ad','#d9f99d','#86efac','#34d399','#22d3ee','#38bdf8','#6366f1'],
  contrast:['#f7f7f7','#d9f0a3','#addd8e','#78c679','#31a354','#006837','#004529'],
  paper:['#f6edd5','#ead9af','#d5ba7a','#bd9854','#987243','#765334','#573b28'],
  darkOcean:['#e4f5f1','#b8ddd6','#86c5bb','#57aa9d','#2f8b7d','#166b61','#064d49']
};
function activeValueRamp(){ return valueRamps[state.regionStyle] || valueRamps[state.basemapStyle] || valueRamps.default; }

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
function finiteNumber(v){ const n=Number(v); return Number.isFinite(n) ? n : null; }
function hasFiniteNumber(v){ return finiteNumber(v) !== null; }
function catColor(v){ if(!v) return '#9a958d'; const pal=regionPalette(); if(!state.colors[v]) state.colors[v]=pal[Object.keys(state.colors).length%pal.length]; return state.colors[v]; }
function valueColor(v, values){
  if(v==null||Number.isNaN(v)) return '#a7adb8';
  const sorted=values.filter(x=>x!=null&&!Number.isNaN(x)).sort((a,b)=>a-b);
  if(!sorted.length) return '#808080';
  const pos=sorted.findIndex(x=>x>=v);
  const q=pos<0?1:pos/(sorted.length-1||1);
  const rr=activeValueRamp();
  return rr[Math.max(0, Math.min(rr.length-1, Math.floor(q*(rr.length-1))))];
}
function styleVars(){
  const dark = state.theme === 'dark';
  return {
    river: dark ? '#4bb5df' : '#209fc6',
    waterFill: dark ? '#17394a' : '#d9eef4',
    waterLine: dark ? '#65c9ef' : '#6eb4c9',
    adminLine: regionStyleConfig().line,
    selectedLine: '#a65b00',
    railway: dark ? '#f3e7d0' : '#18130e',
    adminFillOpacity: regionStyleConfig().fillOpacity,
    circleLine: state.regionStyle==='matchaLatte' ? (dark ? '#efe8c7' : '#5f7346') : (dark ? '#2f210b' : '#6d4f1a'),
    circleFill: state.regionStyle==='matchaLatte' ? '#b7d889' : '#d9a441',
    barFill: state.regionStyle==='matchaLatte' ? '#94b76f' : '#d9a441',
    barLine: state.regionStyle==='matchaLatte' ? (dark ? '#e7efc9' : '#617845') : (dark ? '#2f210b' : '#6d4f1a')
  };
}

function storageGet(key){
  try { return window.localStorage?.getItem(key); } catch(_) { return null; }
}
function storageSet(key, value){
  try { window.localStorage?.setItem(key, value); } catch(_) {}
}
function restoreAppearancePrefs(){
  const savedTheme = storageGet('wsAtlasTheme');
  const savedUiStyle = storageGet('wsAtlasUiStyle');
  const savedPiePalette = storageGet('wsAtlasPiePalette');
  const savedRegionStyle = storageGet('wsAtlasRegionStyle');
  const savedBasemapStyle = storageGet('wsAtlasBasemapStyle');
  const savedSymbolType = storageGet('wsAtlasPopulationSymbolType');
  const savedSymbolScale = storageGet('wsAtlasPopulationScale');
  const savedSymbolMin = Number(storageGet('wsAtlasPopulationMinSize'));
  const savedSymbolMax = Number(storageGet('wsAtlasPopulationMaxSize'));
  if(savedTheme === 'light' || savedTheme === 'dark') state.theme = savedTheme;
  if(savedUiStyle === 'normal' || savedUiStyle === 'glass') state.uiStyle = savedUiStyle;
  if(savedPiePalette && chartPalettes[savedPiePalette]) state.piePalette = savedPiePalette;
  if(savedRegionStyle && regionPalettes[savedRegionStyle]) state.regionStyle = savedRegionStyle;
  if(savedBasemapStyle && ['sage','paper','cold','clean','vivid','darkOcean','matchaLatte'].includes(savedBasemapStyle)) state.basemapStyle = savedBasemapStyle;
  state.populationSymbol.type='circle';
  if(['sqrt','linear','log','quantile'].includes(savedSymbolScale)) state.populationSymbol.scale=savedSymbolScale;
  if(Number.isFinite(savedSymbolMin)) state.populationSymbol.minSize=Math.max(2, Math.min(26, savedSymbolMin));
  if(Number.isFinite(savedSymbolMax)) state.populationSymbol.maxSize=Math.max(10, Math.min(72, savedSymbolMax));
  if(state.populationSymbol.maxSize <= state.populationSymbol.minSize) state.populationSymbol.maxSize = state.populationSymbol.minSize + 6;
}
function applyAppearance(persist=false){
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.ui = state.uiStyle;
  document.documentElement.dataset.basemap = state.basemapStyle;
  const themeSelect = $('themeSelect');
  if(themeSelect && themeSelect.value !== state.theme) themeSelect.value = state.theme;
  const regionStyleSelect = $('regionStyleSelect');
  if(regionStyleSelect && regionStyleSelect.value !== state.regionStyle) regionStyleSelect.value = state.regionStyle;
  const basemapStyleSelect = $('basemapStyleSelect');
  if(basemapStyleSelect && basemapStyleSelect.value !== state.basemapStyle) basemapStyleSelect.value = state.basemapStyle;
  state.populationSymbol.type='circle';
  const symbolScaleSelect = $('populationScaleMethod');
  if(symbolScaleSelect && symbolScaleSelect.value !== state.populationSymbol.scale) symbolScaleSelect.value = state.populationSymbol.scale;
  updatePopulationSymbolControls();
  const btn = $('uiStyleToggle');
  if(btn){
    const glass = state.uiStyle === 'glass';
    btn.classList.toggle('is-glass', glass);
    btn.setAttribute('aria-pressed', String(glass));
    const title = $('uiStyleToggleTitle');
    const text = $('uiStyleToggleText');
    if(title) title.textContent = glass ? 'Liquid glass включён' : 'Обычный интерфейс';
    if(text) text.textContent = glass ? 'Стеклянные боковые панели и таймслайдер' : 'Плотные панели без стеклянного эффекта';
  }
  if(persist){
    storageSet('wsAtlasTheme', state.theme);
    storageSet('wsAtlasUiStyle', state.uiStyle);
    storageSet('wsAtlasRegionStyle', state.regionStyle);
    storageSet('wsAtlasBasemapStyle', state.basemapStyle);
    storageSet('wsAtlasPopulationScale', state.populationSymbol.scale);
    storageSet('wsAtlasPopulationMinSize', state.populationSymbol.minSize);
    storageSet('wsAtlasPopulationMaxSize', state.populationSymbol.maxSize);
  }
  refreshPieLightboxIfOpen();
}
function updatePopulationSymbolControls(){
  const min=$('populationMinSize'); const max=$('populationMaxSize');
  const minLabel=$('populationMinSizeValue'); const maxLabel=$('populationMaxSizeValue');
  if(min && Number(min.value)!==Number(state.populationSymbol.minSize)) min.value=state.populationSymbol.minSize;
  if(max && Number(max.value)!==Number(state.populationSymbol.maxSize)) max.value=state.populationSymbol.maxSize;
  if(minLabel) minLabel.textContent=String(Math.round(state.populationSymbol.minSize));
  if(maxLabel) maxLabel.textContent=String(Math.round(state.populationSymbol.maxSize));
  const hint=$('populationSymbolHint');
  if(hint){
    const type='круги';
    const scale={sqrt:'квадратный корень',linear:'линейное',log:'логарифмическое',quantile:'квантильное'}[state.populationSymbol.scale] || state.populationSymbol.scale;
    hint.textContent=`${type}: ${scale} нормирование, размер ${Math.round(state.populationSymbol.minSize)}–${Math.round(state.populationSymbol.maxSize)} px.`;
  }
}
function persistPopulationSymbolSettings(){
  storageSet('wsAtlasPopulationScale', state.populationSymbol.scale);
  storageSet('wsAtlasPopulationMinSize', state.populationSymbol.minSize);
  storageSet('wsAtlasPopulationMaxSize', state.populationSymbol.maxSize);
}
function rebuildPopulationSymbols(){
  if(!state.layers.admin || !state.currentGeoJSON) return;
  buildCircles(state.layers.admin, state.currentGeoJSON);
  refreshVisibility(); updateLegend(state.currentGeoJSON, state._lastVals);
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
    if(payload.area!=null && !Number.isNaN(Number(payload.area))) rows.push(`<div class="hover-row"><span>площадь</span><b>${num(payload.area)} км²</b></div>`);
    if(payload.density!=null && !Number.isNaN(Number(payload.density))) rows.push(`<div class="hover-row"><span>плотность</span><b>${num1(payload.density)}</b></div>`);
    if(payload.extra) rows.push(`<div class="hover-extra">${escapeHtml(payload.extra)}</div>`);
    box.innerHTML=`<div class="hover-title">${escapeHtml(payload.title||'объект')}</div>${rows.join('')}`;
    box.style.display='block';
    moveHover(state.lastHoverEvent);
    requestAnimationFrame(()=>box.classList.add('visible'));
  }, payload.delay ?? 500);
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

function ensureCenterLabelLayer(){
  if(state.centerLabelLayer) return state.centerLabelLayer;
  state.centerLabelLayer = L.layerGroup();
  state.layers.centerLabels = state.centerLabelLayer;
  return state.centerLabelLayer;
}
function ensureCenterLabelOverlay(){ return null; }
function clearCenterLabels(){
  if(state.centerLabelLayer && state.map && state.map.hasLayer(state.centerLabelLayer)) state.map.removeLayer(state.centerLabelLayer);
  state.centerLabelLayer = L.layerGroup();
  state.layers.centerLabels = state.centerLabelLayer;
  state.centerLabelItems=[];
}
function addCenterLabel(){
  // v35: постоянные подписи больше не берутся из точек центров.
  // Подписи строятся только по полигонам административных единиц в buildLabels().
}
function updateCenterLabels(){
  // v35: центр-подписи отключены, чтобы не дублировать подписи административных полигонов.
}
function cleanAdminLabelName(name){
  let n=String(name||'').trim();
  n=n.replace(/\s+/g,' ');
  return n || 'АТЕ';
}
function adminLabelPriority(f){
  const p=f?.properties||{};
  const pop=Number(p.population)||0;
  const area=Number(p.area_km2)||0;
  return pop*1000 + area;
}
function adminLabelLatLng(layer){
  try{
    if(layer.getCenter) return layer.getCenter();
    const b=layer.getBounds?.();
    if(b?.isValid?.()) return b.getCenter();
  }catch(_){}
  return null;
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
  if(/(^|[\s(])г[.\s]/i.test(name) || /(^|[\s(])г[.\s]/i.test(unit)) return true;
  if(text.includes('город') || text.includes('горсовет') || text.includes('городской') || text.includes('рубцовск')) return true;
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
function normalizeAdminStats(gj){
  if(!gj?.features) return gj;
  const hasBreakdown = gj.features.some(f=>hasFiniteNumber(f.properties?.urban_pop) || hasFiniteNumber(f.properties?.rural_pop) || hasFiniteNumber(f.properties?.urban_share));
  gj.features.forEach(f=>{
    const p=f.properties||{}; const year=Number(p.year||state.year); const pop=finiteNumber(p.population);
    let urban=finiteNumber(p.urban_pop); let rural=finiteNumber(p.rural_pop); let share=finiteNumber(p.urban_share);
    if(share !== null && share > 1) share = share / 100;
    const shouldNormalize = hasBreakdown || year === 1926;
    if(shouldNormalize && pop !== null){
      if(urban === null && rural !== null) urban = Math.max(0, pop-rural);
      if(rural === null && urban !== null) rural = Math.max(0, pop-urban);
      if(year === 1926){
        if(urban === null) urban = 0;
        if(rural === null) rural = Math.max(0, pop-urban);
      }
      if(share === null && urban !== null && pop) share = urban/pop;
    }
    p.urban_pop = urban;
    p.rural_pop = rural;
    p.urban_share = share;
  });
  return gj;
}
function urbanBreakdown(features){
  const hasBreakdown=features.some(f=>hasFiniteNumber(f.properties?.urban_pop) || hasFiniteNumber(f.properties?.rural_pop));
  if(!hasBreakdown) return {available:false, urbanTotal:null, ruralTotal:null, urbanShare:null};
  const total=sum(features.map(f=>Number(f.properties.population)||0));
  const urbanTotal=sum(features.map(f=>Number(f.properties.urban_pop)||0));
  let ruralTotal=sum(features.map(f=>Number(f.properties.rural_pop)||0));
  if(total && urbanTotal && Math.abs((urbanTotal+ruralTotal)-total)>1 && ruralTotal < total-urbanTotal) ruralTotal=Math.max(0,total-urbanTotal);
  return {available:true, urbanTotal, ruralTotal, urbanShare:total?urbanTotal/total:null};
}

function currentParentNames(){ return [...state.visibleParents]; }
function parentNameFromFeature(f){ const v=String(f?.properties?.admin_parent ?? '').trim(); return v || null; }
function syncVisibleParents(gj){
  const parents=[...new Set((gj?.features||[]).map(parentNameFromFeature).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  state.parentCounts = new Map(parents.map(name=>[name,(gj?.features||[]).filter(f=>parentNameFromFeature(f)===name).length]));
  if(state.parentFilterYear !== state.year){
    state.visibleParents = new Set(parents);
    state.parentFilterYear = state.year;
  } else {
    const keep=new Set(parents.filter(name=>state.visibleParents.has(name)));
    state.visibleParents = keep.size ? keep : new Set(parents);
  }
  renderParentCheckboxes(parents);
}
function renderParentCheckboxes(parents){
  const box=$('parentCheckboxes'); if(!box) return;
  box.innerHTML='';
  parents.forEach(name=>{
    const id=`parent_${name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g,'_')}`;
    const label=document.createElement('label'); label.className='parent-check';
    label.innerHTML=`<input type="checkbox" id="${id}" ${state.visibleParents.has(name)?'checked':''} data-parent-name="${escapeHtml(name)}"><span>${escapeHtml(name)}</span><b>${num(state.parentCounts.get(name)||0)}</b>`;
    const input=label.querySelector('input');
    input.addEventListener('change', ()=>{
      if(input.checked) state.visibleParents.add(name); else state.visibleParents.delete(name);
      rerenderFilteredLayers();
    });
    box.appendChild(label);
  });
}
function setAllParentsVisible(flag){
  const parents=[...state.parentCounts.keys()];
  state.visibleParents = flag ? new Set(parents) : new Set();
  renderParentCheckboxes(parents);
  rerenderFilteredLayers();
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function initDraggableWidget(panelId, handleId, dragStateKey){
  const panel=$(panelId); const handle=$(handleId) || panel?.querySelector('.drag-handle');
  if(!panel || !handle || panel.dataset.dragReady==='1') return;
  panel.dataset.dragReady='1';
  const startDrag=(ev)=>{
    if(ev.target.closest('button,input,select,label,a')) return;
    const point=ev.touches?.[0] || ev;
    const rect=panel.getBoundingClientRect();
    state[dragStateKey]={active:true, dx:point.clientX-rect.left, dy:point.clientY-rect.top};
    panel.classList.add('is-dragging');
    panel.dataset.userDragged='1';
    panel.style.left=`${rect.left}px`; panel.style.top=`${rect.top}px`;
    panel.style.right='auto'; panel.style.bottom='auto'; panel.style.width=`${rect.width}px`;
    ev.preventDefault();
  };
  const moveDrag=(ev)=>{
    if(!state[dragStateKey]?.active) return;
    const point=ev.touches?.[0] || ev;
    const rect=panel.getBoundingClientRect();
    const left=clamp(point.clientX-state[dragStateKey].dx, 8, window.innerWidth-rect.width-8);
    const top=clamp(point.clientY-state[dragStateKey].dy, 8, window.innerHeight-rect.height-8);
    panel.style.left=`${left}px`; panel.style.top=`${top}px`; panel.style.transform='none';
    ev.preventDefault();
  };
  const endDrag=()=>{
    if(!state[dragStateKey]?.active) return;
    state[dragStateKey].active=false;
    panel.classList.remove('is-dragging');
  };
  handle.addEventListener('mousedown', startDrag);
  handle.addEventListener('touchstart', startDrag, {passive:false});
  window.addEventListener('mousemove', moveDrag, {passive:false});
  window.addEventListener('touchmove', moveDrag, {passive:false});
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('touchend', endDrag);
  window.addEventListener('resize', ()=>{
    const rect=panel.getBoundingClientRect();
    if(panel.style.top){
      panel.style.left=`${clamp(rect.left,8,Math.max(8,window.innerWidth-rect.width-8))}px`;
      panel.style.top=`${clamp(rect.top,8,Math.max(8,window.innerHeight-rect.height-8))}px`;
    }
  });
}
function positionBottomWidgets(force=false){
  const timeline=$('timelineBar');
  const metric=$('metricFilters');
  const parent=$('parentFilterBar');
  if(!timeline || !metric || !parent) return;
  const gap=10;
  const t=timeline.getBoundingClientRect();
  const mRect=metric.getBoundingClientRect();
  const pRect=parent.getBoundingClientRect();
  const bottom=Math.max(8, window.innerHeight - t.bottom);
  const maxLeft=(elRect)=>Math.max(8, window.innerWidth - elRect.width - 8);
  if(force || metric.dataset.userDragged!=='1'){
    const left=clamp(t.left - mRect.width - gap, 8, maxLeft(mRect));
    metric.style.left=`${left}px`;
    metric.style.right='auto';
    metric.style.top='auto';
    metric.style.bottom=`${bottom}px`;
    metric.style.transform='none';
  }
  if(force || parent.dataset.userDragged!=='1'){
    const left=clamp(t.right + gap, 8, maxLeft(pRect));
    parent.style.left=`${left}px`;
    parent.style.right='auto';
    parent.style.top='auto';
    parent.style.bottom=`${bottom}px`;
    parent.style.transform='none';
  }
}
function initCollapsiblePanel(panelId, buttonId){
  const panel=$(panelId); const button=$(buttonId);
  if(!panel || !button || button.dataset.collapseReady==='1') return;
  button.dataset.collapseReady='1';
  const apply=()=>{
    const collapsed=panel.classList.contains('is-collapsed');
    button.setAttribute('aria-expanded', String(!collapsed));
    button.textContent = collapsed ? 'Развернуть' : 'Свернуть';
  };
  button.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    panel.classList.toggle('is-collapsed');
    apply();
  });
  apply();
}

function initSidePanelToggles(){
  const savedLeft=storageGet('wsAtlasLeftPanelHidden')==='1';
  const savedRight=storageGet('wsAtlasRightPanelHidden')==='1';
  setSidePanelHidden('left', savedLeft, false);
  setSidePanelHidden('right', savedRight, false);
  const leftBtn=$('toggleLeftPanel');
  const rightBtn=$('toggleRightPanel');
  if(leftBtn && leftBtn.dataset.ready!=='1'){
    leftBtn.dataset.ready='1';
    leftBtn.addEventListener('click', ()=>setSidePanelHidden('left', !document.body.classList.contains('left-panel-hidden'), true));
  }
  if(rightBtn && rightBtn.dataset.ready!=='1'){
    rightBtn.dataset.ready='1';
    rightBtn.addEventListener('click', ()=>setSidePanelHidden('right', !document.body.classList.contains('right-panel-hidden'), true));
  }
}
function setSidePanelHidden(side, hidden, persist=true){
  const isLeft=side==='left';
  const cls=isLeft?'left-panel-hidden':'right-panel-hidden';
  const btn=$(isLeft?'toggleLeftPanel':'toggleRightPanel');
  document.body.classList.toggle(cls, !!hidden);
  state.sidePanels[side]=!!hidden;
  if(btn){
    btn.setAttribute('aria-expanded', String(!hidden));
    btn.title = hidden ? `Показать ${isLeft?'левую':'правую'} панель` : `Скрыть ${isLeft?'левую':'правую'} панель`;
    btn.textContent = isLeft ? (hidden ? '›' : '‹') : (hidden ? '‹' : '›');
  }
  if(persist) storageSet(isLeft?'wsAtlasLeftPanelHidden':'wsAtlasRightPanelHidden', hidden?'1':'0');
  window.setTimeout(()=>{ state.map?.invalidateSize(); updateLabelsVisibility(); updateCenterLabels(); }, 360);
}
function metricValueLabel(field, value){
  if(value==null || !Number.isFinite(Number(value))) return '—';
  return field==='density' ? num1(value) : num(value);
}
function metricThreshold(filter, kind){
  const frac = Math.max(0, Math.min(1, kind==='min' ? (filter.minFraction ?? 0) : (filter.maxFraction ?? 1)));
  if(!(filter.max>filter.min)) return null;
  return filter.min + (filter.max-filter.min)*frac;
}
function normalizeFilterFractions(field){
  const filter=state.filters[field];
  filter.minFraction=Math.max(0, Math.min(1, filter.minFraction ?? 0));
  filter.maxFraction=Math.max(0, Math.min(1, filter.maxFraction ?? 1));
  if(filter.minFraction > filter.maxFraction){
    const tmp=filter.minFraction;
    filter.minFraction=filter.maxFraction;
    filter.maxFraction=tmp;
  }
  filter.minThreshold = metricThreshold(filter,'min');
  filter.maxThreshold = metricThreshold(filter,'max');
}
function updateDualRangeVisual(field){
  const filter=state.filters[field];
  const minPct=Math.round((filter.minFraction||0)*100);
  const maxPct=Math.round((filter.maxFraction??1)*100);
  const fill=$(`filter_${field}_fill`);
  const minRange=$(`filter_${field}_minRange`);
  const maxRange=$(`filter_${field}_maxRange`);
  if(fill){
    fill.style.left=`${minPct}%`;
    fill.style.width=`${Math.max(0,maxPct-minPct)}%`;
  }
  if(minRange) minRange.style.setProperty('--thumb-pos', `${minPct}%`);
  if(maxRange) maxRange.style.setProperty('--thumb-pos', `${maxPct}%`);
}
function updateMetricFilterControls(){
  ['population','area_km2','density'].forEach(field=>{
    const filter=state.filters[field];
    normalizeFilterFractions(field);
    const minRange=$(`filter_${field}_minRange`), maxRange=$(`filter_${field}_maxRange`);
    const label=$(`filter_${field}_rangeLabel`); const summary=$(`filter_${field}_summary`);
    const hasRange=filter.max>filter.min;
    if(minRange){ minRange.value=String(Math.round((filter.minFraction||0)*100)); minRange.disabled=!hasRange; }
    if(maxRange){ maxRange.value=String(Math.round((filter.maxFraction??1)*100)); maxRange.disabled=!hasRange; }
    updateDualRangeVisual(field);
    if(label){
      if(!hasRange) label.textContent='недостаточно данных';
      else label.textContent=`диапазон слоя: ${metricValueLabel(field, filter.min)} — ${metricValueLabel(field, filter.max)}`;
    }
    if(summary){
      const isFull=(filter.minFraction<=0.0001 && filter.maxFraction>=0.9999);
      summary.textContent=isFull || !hasRange
        ? 'все'
        : `${metricValueLabel(field, filter.minThreshold)} — ${metricValueLabel(field, filter.maxThreshold)}`;
    }
  });
}
function syncFilterRanges(features){
  ['population','area_km2','density'].forEach(field=>{
    const vals=features.map(f=>Number(f.properties?.[field])).filter(v=>Number.isFinite(v));
    const filter=state.filters[field];
    filter.min = vals.length ? Math.min(...vals) : 0;
    filter.max = vals.length ? Math.max(...vals) : 0;
    normalizeFilterFractions(field);
  });
  updateMetricFilterControls();
}
function featurePassesFilters(f){
  const parent=parentNameFromFeature(f);
  const totalParents=state.parentCounts?.size || 0;
  if(totalParents && !parent) return false;
  if(totalParents && state.visibleParents.size!==totalParents && !state.visibleParents.has(parent)) return false;
  return ['population','area_km2','density'].every(field=>{
    const filter=state.filters[field];
    const isFull=(filter.minFraction<=0.0001 && filter.maxFraction>=0.9999);
    if(isFull) return true;
    const value=Number(f.properties?.[field]); if(!Number.isFinite(value)) return false;
    if(filter.minThreshold!=null && value < filter.minThreshold) return false;
    if(filter.maxThreshold!=null && value > filter.maxThreshold) return false;
    return true;
  });
}
function filteredGeoJSON(gj){
  if(!gj?.features) return {type:'FeatureCollection', features:[]};
  return {type:'FeatureCollection', features: gj.features.filter(featurePassesFilters)};
}
async function rerenderFilteredLayers(){
  if(!state.manifest || !state.map || !state.rawGeoJSON) return;
  const seq=++state.refreshSeq;
  clearLayer('admin'); clearLayer('circles'); clearLayer('centers'); clearLayer('labels'); clearCenterLabels();
  state.adminLayerById.clear();
  await refreshAdmin(seq); if(isStaleRefresh(seq)) return;
  await refreshCenters(seq); if(isStaleRefresh(seq)) return;
  refreshVisibility(); updateStatsAndSelection();
}

async function init(){
  restoreAppearancePrefs();
  applyAppearance(false);
  state.manifest = await loadJson('data/manifest.json');
  state.year = state.manifest.years.includes(1914) ? 1914 : state.manifest.years[0];
  setYearLabels(); buildTimeline();

  const b = state.manifest.map_bounds_4326_expanded_200km || [57.411848,42.485993,92.272637,74.021644];
  const centerLat=(b[1]+b[3])/2;
  const lonPad=275/(111.32*Math.max(0.25, Math.cos(centerLat*Math.PI/180)));
  const expandedBounds=[b[0]-lonPad,b[1],b[2]+lonPad,b[3]];
  state.dataBounds = L.latLngBounds([[expandedBounds[1],expandedBounds[0]],[expandedBounds[3],expandedBounds[2]]]);
  state.softBounds = state.dataBounds.pad(0.20);
  state.map = L.map('map', {
    zoomControl:true,
    minZoom:MAP_MIN_ZOOM,
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
  if(state.map.getZoom() < MAP_MIN_ZOOM) state.map.setZoom(MAP_MIN_ZOOM, {animate:false});
  L.control.scale({imperial:false}).addTo(state.map);
  ensureHoverBox(); ensureCenterLabelLayer();
  document.addEventListener('mousemove', ev=>{ if(state.hoverPayload && state.hoverBox && state.hoverBox.style.display !== 'none') moveHover(ev); }, {passive:true});
  bindUi(); bindSelectionHandlers(); setTool('pan');
  state.map.on('zoomend moveend zoom move', ()=>{ updateLabelsVisibility(); updateCenterLabels(); });
  await refreshAll();
  setTimeout(()=>{positionBottomWidgets(); state.map.invalidateSize(); updateLabelsVisibility(); updateCenterLabels();},250);
  window.addEventListener('resize', () => setTimeout(()=>{positionBottomWidgets(); state.map.invalidateSize(); updateLabelsVisibility(); updateCenterLabels();},120));
}

function bindUi(){
  const on = (id, event, handler) => { const el=$(id); if(el) el.addEventListener(event, handler); };
  initSidePanelToggles();
  on('modeSelect','change', async e=>{state.mode=e.target.value; const seq=state.refreshSeq; await refreshAdmin(seq);});
  const themeSelect=$('themeSelect'); if(themeSelect) themeSelect.value=state.theme;
  const pieSelect=$('pieLevelSelect'); if(pieSelect) pieSelect.value=state.pieGrouping;
  const piePaletteSelect=$('piePaletteSelect'); if(piePaletteSelect) piePaletteSelect.value=state.piePalette;
  const regionStyleSelect=$('regionStyleSelect'); if(regionStyleSelect) regionStyleSelect.value=state.regionStyle;
  const basemapStyleSelect=$('basemapStyleSelect'); if(basemapStyleSelect) basemapStyleSelect.value=state.basemapStyle;
  on('themeSelect','change', e=>{state.theme=e.target.value; applyAppearance(true); refreshVectorStyles(); updateLabelsVisibility();});
  on('regionStyleSelect','change', e=>{ state.regionStyle=regionPalettes[e.target.value]?e.target.value:'soft'; state.colors={}; applyAppearance(true); refreshVectorStyles(); updateLegend(state.currentGeoJSON,state._lastVals||[]); });
  on('basemapStyleSelect','change', e=>{ state.basemapStyle=['sage','paper','cold','clean','vivid','darkOcean','matchaLatte'].includes(e.target.value)?e.target.value:'sage'; applyAppearance(true); });
  on('populationScaleMethod','change', e=>{ state.populationSymbol.scale=['sqrt','linear','log','quantile'].includes(e.target.value)?e.target.value:'sqrt'; updatePopulationSymbolControls(); persistPopulationSymbolSettings(); rebuildPopulationSymbols(); });
  on('populationMinSize','input', e=>{ const v=Math.max(2, Math.min(26, Number(e.target.value)||5)); state.populationSymbol.minSize=Math.min(v, state.populationSymbol.maxSize-2); updatePopulationSymbolControls(); persistPopulationSymbolSettings(); rebuildPopulationSymbols(); });
  on('populationMaxSize','input', e=>{ const v=Math.max(10, Math.min(72, Number(e.target.value)||39)); state.populationSymbol.maxSize=Math.max(v, state.populationSymbol.minSize+2); updatePopulationSymbolControls(); persistPopulationSymbolSettings(); rebuildPopulationSymbols(); });
  on('uiStyleToggle','click', ()=>{ state.uiStyle = state.uiStyle === 'glass' ? 'normal' : 'glass'; applyAppearance(true); });
  on('pieLevelSelect','change', e=>{ state.pieGrouping=e.target.value||'upper'; updateGroupAnalytics(selectedFeatures()); refreshPieLightboxIfOpen(); });
  on('piePaletteSelect','change', e=>{ state.piePalette=chartPalettes[e.target.value]?e.target.value:'softPastel'; storageSet('wsAtlasPiePalette', state.piePalette); updateGroupAnalytics(selectedFeatures()); refreshPieLightboxIfOpen(); });
  document.querySelectorAll('[data-tool-button]').forEach(btn=>btn.addEventListener('click', ()=>setTool(btn.dataset.toolButton)));
  ['population','area_km2','density'].forEach(field=>{
    const updateRange=(kind, value, commit=false)=>{
      const filter=state.filters[field];
      const fraction=Math.max(0, Math.min(1, (Number(value)||0)/100));
      if(kind==='min') filter.minFraction=Math.min(fraction, filter.maxFraction ?? 1);
      else filter.maxFraction=Math.max(fraction, filter.minFraction ?? 0);
      syncFilterRanges(state.rawGeoJSON?.features||[]);
      if(commit) rerenderFilteredLayers();
    };
    on(`filter_${field}_minRange`,'input', e=>updateRange('min', e.target.value, false));
    on(`filter_${field}_maxRange`,'input', e=>updateRange('max', e.target.value, false));
    on(`filter_${field}_minRange`,'change', e=>updateRange('min', e.target.value, true));
    on(`filter_${field}_maxRange`,'change', e=>updateRange('max', e.target.value, true));
  });
  on('resetMetricFilters','click', ()=>{ ['population','area_km2','density'].forEach(field=>{ Object.assign(state.filters[field], {minFraction:0, maxFraction:1, minThreshold:null, maxThreshold:null}); }); syncFilterRanges(state.rawGeoJSON?.features||[]); rerenderFilteredLayers(); });
  initDraggableWidget('metricFilters','metricFiltersHandle','metricFilterDrag');
  initDraggableWidget('parentFilterBar','parentFilterHandle','parentFilterDrag');
  initCollapsiblePanel('metricFilters','collapseMetricFilters');
  initCollapsiblePanel('parentFilterBar','collapseParentFilter');
  requestAnimationFrame(()=>positionBottomWidgets());
  on('finishPolygon','click', finishPolygonSelection);
  on('cancelSelectionDraw','click', clearSelectionDrawing);
  ['toggleHydro','toggleAdmin','toggleCenters','toggleRailways','toggleCircles'].forEach(id=>on(id,'change', refreshVisibility));
  on('resetView','click', ()=> state.map.flyToBounds(state.dataBounds, {duration:.45, padding:[18,18], maxZoom:MAP_RESET_MAX_ZOOM}));
  on('clearSelection','click', ()=>{state.selectedIds.clear(); refreshSelectionStyles(); updateStatsAndSelection();});
  on('selectAll','click', ()=>{ if(!state.currentGeoJSON) return; state.selectedIds = new Set(state.currentGeoJSON.features.map(featureId)); refreshSelectionStyles(); updateStatsAndSelection(); });
  on('toggleAttributePanel','click', ()=>{ state.attributesPanelOpen = !state.attributesPanelOpen; updateAttributePanel(); });
  on('selectedFeatureSelect','change', e=>{ const id=e.target.value; if(!id || !state.currentGeoJSON) return; const f=state.currentGeoJSON.features.find(x=>featureId(x)===id); if(f){ showFeature(f); const layer=state.adminLayerById.get(id); if(layer){ state.map.fitBounds(layer.getBounds(), {padding:[80,80], maxZoom:6.5, animate:true, duration:.35}); } } });
  const ga=$('groupAnalyticsBox');
  if(ga){
    ga.addEventListener('click', e=>{ const card=e.target.closest('.pie-card[data-chart-field]'); if(card) openPieLightbox(card.dataset.chartField, card.dataset.chartTitle || 'Диаграмма'); });
    ga.addEventListener('keydown', e=>{ if((e.key==='Enter'||e.key===' ') && e.target.closest('.pie-card[data-chart-field]')){ e.preventDefault(); const card=e.target.closest('.pie-card[data-chart-field]'); openPieLightbox(card.dataset.chartField, card.dataset.chartTitle || 'Диаграмма'); } });
  }
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closePieLightbox(); closeExportMode(); } });
  on('openExportMode','click', openExportMode);
  updateMetricFilterControls();
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
function isStaleRefresh(seq){ return seq != null && seq !== state.refreshSeq; }
function clearYearLayers(){
  ['rivers','water','admin','circles','centers','labels','centerLabels','railways'].forEach(clearLayer);
  state.adminLayerById.clear();
  state.selectedCenterLayer=null;
  state.labelItems=[];
  state.centerLabelItems=[];
  if(state.centerLabelLayer) state.centerLabelLayer=L.layerGroup();
  state.layers.centerLabels=state.centerLabelLayer || null;
}
async function refreshAll(){
  const seq=++state.refreshSeq;
  clearYearLayers();
  await refreshHydro(seq); if(isStaleRefresh(seq)) return;
  await refreshAdmin(seq); if(isStaleRefresh(seq)) return;
  await refreshCenters(seq); if(isStaleRefresh(seq)) return;
  await refreshRailways(seq); if(isStaleRefresh(seq)) return;
  refreshVisibility(); updateStatsAndSelection();
}

function isAlwaysVisibleWaterFeature(f){
  const p=f.properties||{};
  if(p.always_visible || p.alwaysVisible || p.force_visible || p.forceVisible || p.lake_zaysan) return true;
  const text=Object.values(p).join(' ').toLowerCase();
  return text.includes('zaysan') || text.includes('zaisan') || text.includes('зайсан') || text.includes('bukhtarma') || text.includes('bukhtarmin') || text.includes('бухтарм');
}
function isReservoirFeature(f){
  const p=f.properties||{}; if(p.water_kind==='ocean') return false;
  if(p.water_kind==='reservoir') return true;
  const text=Object.values(p).join(' ').toLowerCase();
  return p.reservoir===1 || p.reservoir===true || String(p.reservoir).toLowerCase()==='true' || text.includes('reservoir') || text.includes('водохранилище') || text.includes('vodokhran');
}
function riverStyle(f){
  const s=styleVars();
  const p=f.properties||{};
  const raw=Number(p.strokeweig || p.strokeweight || p.weight || 1);
  return {color:s.river, weight:Math.max(.45, Math.min(2.05, raw*.92)), opacity:state.theme==='light'?.70:.74};
}
function waterStyle(f){
  const s=styleVars();
  const p=f.properties||{};
  const kind=p.water_kind || '';
  const ocean=kind==='ocean';
  const reservoir=kind==='reservoir' || isReservoirFeature(f);
  return {color:s.waterLine, weight:ocean?.85:.70, opacity:ocean?.70:.88, fillColor:s.waterFill, fillOpacity:ocean?(state.theme==='light'?.62:.52):(reservoir?(state.theme==='light'?.90:.78):(state.theme==='light'?.96:.86))};
}
async function refreshHydro(seq){
  clearLayer('rivers'); clearLayer('water');
  const rivers=await loadJson(state.manifest.layers.hydro.rivers);
  const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
  if(isStaleRefresh(seq)) return;
  const showReservoirs = Number(state.year) >= 1959;
  const water={type:'FeatureCollection', features:waterRaw.features.filter(f=>showReservoirs || !isReservoirFeature(f) || isAlwaysVisibleWaterFeature(f))};
  state.layers.rivers=L.geoJSON(rivers,{interactive:false, style:riverStyle});
  state.layers.water=L.geoJSON(water,{interactive:false, style:waterStyle});
}
function adminStyle(feature, vals){
  const p=feature.properties; let fill='#999';
  if(state.mode==='admin_parent') fill=catColor(p.admin_parent);
  if(state.mode==='admin_intermediate') fill=catColor(p.admin_intermediate || p.admin_parent);
  if(state.mode==='admin_superparent') fill=catColor(p.admin_superparent || p.admin_parent);
  if(state.mode==='unit_type') fill=catColor(p.unit_type);
  if(state.mode==='population') fill=valueColor(Number(p.population), vals);
  if(state.mode==='density') fill=valueColor(Number(p.density), vals);
  if(state.mode==='urban_share') fill=valueColor(Number(p.urban_share), vals);
  if(state.mode==='rail_length') fill=valueColor(Number(p.rail_length_km), vals);
  if(state.mode==='rail_density') fill=valueColor(Number(p.rail_density_km_1000), vals);
  const s=styleVars(); const cfg=regionStyleConfig(); const selected=state.selectedIds.has(featureId(feature));
  return {color:selected?s.selectedLine:(cfg.line||s.adminLine), weight:selected?(cfg.selectedWeight||2.8):(cfg.weight||1.05), opacity:selected?1:(cfg.opacity??.92), dashArray:selected?null:(cfg.dashArray||null), lineJoin:'round', lineCap:'round', fillColor:fill, fillOpacity:selected?Math.min(.74,(cfg.fillOpacity??s.adminFillOpacity)+.14):(cfg.fillOpacity??s.adminFillOpacity)};
}
async function refreshAdmin(seq){
  clearLayer('admin'); clearLayer('circles'); state.adminLayerById.clear();
  const path=state.manifest.layers.admin[String(state.year)]; const raw=normalizeAdminStats(await loadJson(path));
  if(isStaleRefresh(seq)) return;
  state.rawGeoJSON=raw;
  syncVisibleParents(raw);
  syncFilterRanges(raw.features||[]);
  const gj=filteredGeoJSON(raw);
  state.currentGeoJSON=gj;
  const visibleIds=new Set(gj.features.map(featureId));
  state.selectedIds = new Set([...state.selectedIds].filter(id=>visibleIds.has(id)));
  const field=valField(); const vals=field?gj.features.map(f=>Number(f.properties[field])).filter(v=>!Number.isNaN(v)):[]; state._lastVals=vals;
  const admin=L.geoJSON(gj,{style:f=>adminStyle(f,vals), onEachFeature:(f,l)=>{
    const id=featureId(f); state.adminLayerById.set(id,l);
    l.on('click',()=>{ if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f);});
    l.on('mouseover',(e)=>{ if(!state.selectedIds.has(id)) l.setStyle({weight:Math.max(1.8,(regionStyleConfig().weight||1.05)+.65), opacity:1}); if(state.tool !== 'pan') return; const pp=f.properties||{}; showHoverLater({title:pp.name, subtitle:[pp.unit_type, pp.admin_parent].filter(Boolean).join(' · '), population:pp.population, area:pp.area_km2, density:pp.density, extra:`год ${pp.year || state.year}`, delay:500}, e.originalEvent); });
    l.on('mousemove',(e)=>moveHover(e.originalEvent));
    l.on('mouseout',()=>{ refreshSelectionStylesFor(id); hideHover(); });
  }});
  state.layers.admin=admin; buildCircles(admin, gj); buildLabels(admin, gj);
  updateLegend(gj, vals); refreshVisibility(); updateStatsAndSelection(); updateAttributePanel();
}
function populationScaleValue(pop, vals){
  const v=Number(pop)||0; if(!v) return 0;
  const values=(vals||[]).filter(x=>Number.isFinite(x) && x>0).sort((a,b)=>a-b);
  if(!values.length) return 0;
  const min=values[0], max=values[values.length-1];
  if(max===min) return 1;
  if(state.populationSymbol.scale==='log'){
    return (Math.log1p(v)-Math.log1p(min))/(Math.log1p(max)-Math.log1p(min)||1);
  }
  if(state.populationSymbol.scale==='quantile'){
    let idx=values.findIndex(x=>x>=v); if(idx<0) idx=values.length-1;
    return idx/(values.length-1||1);
  }
  const linear=(v-min)/(max-min||1);
  if(state.populationSymbol.scale==='sqrt') return Math.sqrt(Math.max(0,linear));
  return Math.max(0, linear);
}
function populationSymbolSize(pop, vals){
  const min=Number(state.populationSymbol.minSize)||5;
  const max=Math.max(min+2, Number(state.populationSymbol.maxSize)||39);
  const t=Math.max(0, Math.min(1, populationScaleValue(pop, vals)));
  return min + t*(max-min);
}
function populationRadius(pop,maxPop){
  const vals=state.currentGeoJSON?.features?.map(f=>Number(f.properties?.population)||0).filter(v=>v>0) || [maxPop||1];
  return populationSymbolSize(pop, vals);
}
function buildPopulationBarMarker(latlng, f, height, s){
  const width=Math.max(8, Math.min(18, Math.round(height*.32)));
  const html=`<div class="population-bar-symbol" style="width:${width}px;height:${height}px;background:${s.barFill};border-color:${s.barLine};"></div>`;
  return L.marker(latlng,{interactive:true, icon:L.divIcon({className:'population-bar-icon', html, iconSize:[width+8,height+8], iconAnchor:[Math.round((width+8)/2), height+6]})});
}
function buildCircles(admin, gj){
  clearLayer('circles');
  const s=styleVars(); const vals=gj.features.map(f=>Number(f.properties.population)||0).filter(v=>v>0);
  const maxPop=Math.max(...vals,1); const minPop=Math.min(...vals, maxPop);
  state.maxPop=maxPop; state.minPop=minPop; state.layers.circles=L.layerGroup();
  admin.eachLayer(layer=>{
    const f=layer.feature; const p=f.properties; const pop=Number(p.population)||0; if(!pop) return;
    const c=layer.getBounds().getCenter(); const size=populationSymbolSize(pop, vals);
    const m=L.circleMarker(c,{radius:size, color:s.circleLine, weight:1.65, fillColor:s.circleFill, fillOpacity:.74, opacity:.98});
    m.feature=f;
    m.on('mouseover',(e)=>showHoverLater({title:p.name||'объект', subtitle:'круг населения', population:pop, density:p.density}, e.originalEvent));
    m.on('mousemove',(e)=>moveHover(e.originalEvent));
    m.on('mouseout', hideHover);
    m.on('click',(e)=>{L.DomEvent.stopPropagation(e); if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f);});
    state.layers.circles.addLayer(m);
  });
}
function buildLabels(admin, gj){
  clearLayer('labels');
  state.labelItems=[];
  if(!admin || !gj?.features?.length) return;
  const group=L.layerGroup();
  admin.eachLayer(layer=>{
    const f=layer.feature;
    if(!f?.properties) return;
    const p=f.properties;
    const label=cleanAdminLabelName(p.name || p.unit_name || p.admin_name || p.unit_id);
    if(!label) return;
    const latlng=adminLabelLatLng(layer);
    if(!latlng) return;
    const pop=Number(p.population)||0;
    const area=Number(p.area_km2)||0;
    const cls=['admin-poly-label'];
    if(pop>=1000000) cls.push('major');
    else if(pop>=300000) cls.push('medium');
    else cls.push('minor');
    const marker=L.marker(latlng,{
      opacity:0,
      interactive:false,
      keyboard:false,
      zIndexOffset:980,
      icon:L.divIcon({className:'empty-label-anchor', html:'', iconSize:[0,0], iconAnchor:[0,0]})
    });
    marker.bindTooltip(escapeHtml(label),{
      permanent:true,
      direction:'center',
      offset:[0,0],
      opacity:1,
      className:cls.join(' '),
      interactive:false
    });
    group.addLayer(marker);
    state.labelItems.push({latlng, marker, feature:f, label, priority:adminLabelPriority(f), pop, area});
  });
  state.labelItems.sort((a,b)=>(b.priority||0)-(a.priority||0));
  state.layers.labels=group;
}
function updateLabelsVisibility(){
  const show=$('toggleAdmin')?.checked !== false;
  if(!state.map || !state.labelItems) return;
  const z=state.map.getZoom(); const size=state.map.getSize(); const view=state.map.getBounds();
  const placed=[];
  const items=[...state.labelItems].sort((a,b)=>(b.priority||0)-(a.priority||0));
  items.forEach((item,rank)=>{
    const tooltip = item.marker?.getTooltip ? item.marker.getTooltip() : null;
    const el = tooltip?.getElement ? tooltip.getElement() : null;
    if(!el) return;
    const pt=state.map.latLngToContainerPoint(item.latlng);
    let ok=show && view.contains(item.latlng) && pt.x>48 && pt.x<size.x-48 && pt.y>38 && pt.y<size.y-38;
    // Генерализация: при малом масштабе оставляем прежде всего самые населённые АТЕ.
    if(rank>45 && z<5.15) ok=false;
    if(rank>95 && z<5.55) ok=false;
    if(rank>180 && z<6.05) ok=false;
    if(ok){
      el.style.display='block';
      const rect=el.getBoundingClientRect();
      const pad=rank<30?8:6;
      const r={left:rect.left-pad,right:rect.right+pad,top:rect.top-pad,bottom:rect.bottom+pad};
      const overlaps=placed.some(q=>!(r.right<q.left || r.left>q.right || r.bottom<q.top || r.top>q.bottom));
      if(overlaps) ok=false; else placed.push(r);
    }
    el.style.display=ok?'block':'none';
  });
}


async function refreshCenters(seq){
  clearLayer('centers'); clearCenterLabels(); state.maxCenterPop=0;
  const path=state.manifest.layers.centers[String(state.year)]; if(!path){ refreshVisibility(); return; }
  const gj=await loadJson(path);
  if(isStaleRefresh(seq)) return;
  state.rawCentersGeoJSON=gj;
  const visibleNames=new Set((state.currentGeoJSON?.features||[]).map(f=>String(f.properties?.name||'').trim().toLowerCase()).filter(Boolean));
  const visibleParents=new Set((state.currentGeoJSON?.features||[]).map(f=>String(f.properties?.admin_parent||'').trim()).filter(Boolean));
  const visibleUnitIds=new Set((state.currentGeoJSON?.features||[]).map(f=>String(f.properties?.unit_id||'')).filter(Boolean));
  const filteredFeatures=(gj.features||[]).filter(f=>{
    const p=f.properties||{};
    const unitId=String(p.unit_id||'');
    const unitName=String(p.unit_name||p.name||'').trim().toLowerCase();
    const parent=String(p.admin_parent||'').trim();
    const hasMatchMeta = unitId || unitName || parent;
    if(!hasMatchMeta) return true;
    if(unitId && visibleUnitIds.has(unitId)) return true;
    if(unitName && visibleNames.has(unitName)) return true;
    if(parent && visibleParents.has(parent)) return true;
    return false;
  });
  const pops=filteredFeatures.filter(f=>f.geometry && f.geometry.type==='Point').map(f=>pointPopulation(f.properties||{})).filter(v=>v>0);
  const maxCenterPop=Math.max(...pops,1); state.maxCenterPop=maxCenterPop;
  const centerGroup=L.layerGroup();
  filteredFeatures.forEach(f=>{
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
  });
  state.layers.centers=centerGroup;
  refreshVisibility();
}
function buildFallbackAdminCenterLabels(){ state.labelItems=[]; clearLayer('labels'); }
function centerRadius(pop,maxPop){ return 3.2 + Math.sqrt((Number(pop)||0)/(maxPop||1))*15; }
async function refreshRailways(seq){
  clearLayer('railways'); const gj=await loadJson(state.manifest.layers.railways.main);
  if(isStaleRefresh(seq)) return;
  const yr=state.year;
  const filtered={type:'FeatureCollection', features:gj.features.filter(f=>{const p=f.properties; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close); return o<=yr && (c==null || c>yr);})};
  const s=styleVars(); state.layers.railways=L.geoJSON(filtered,{style:{color:s.railway,weight:1.65,opacity:.88},onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`ЖД-сегмент<br>постр.: ${p.year_open||'—'}<br>упразд.: ${p.year_close||'—'}`)}});
}

function refreshVisibility(){
  const vis={hydro:$('toggleHydro')?.checked, admin:$('toggleAdmin')?.checked, centers:$('toggleCenters')?.checked, railways:$('toggleRailways')?.checked, circles:$('toggleCircles')?.checked};
  const entries=[['rivers',vis.hydro],['water',vis.hydro],['admin',vis.admin],['railways',vis.railways],['circles',vis.circles],['centers',vis.centers],['labels',vis.admin],['centerLabels',false]];
  // Пересобираем порядок слоёв каждый раз. Это грубее, но надёжнее для GitHub/Leaflet и не даёт воде съедать АТД.
  entries.forEach(([name])=>{ const l=state.layers[name]; if(l && state.map.hasLayer(l)) state.map.removeLayer(l); });
  entries.forEach(([name,show])=>{ const l=state.layers[name]; if(l && show) l.addTo(state.map); });
  // Финальная страховка порядка.
  if(state.layers.rivers?.bringToBack) state.layers.rivers.bringToBack();
  if(state.layers.water?.bringToFront) state.layers.water.bringToFront();
  if(state.layers.admin?.bringToFront) state.layers.admin.bringToFront();
  if(state.layers.railways?.bringToFront) state.layers.railways.bringToFront();
  bringLayerGroupToFront(state.layers.circles); bringLayerGroupToFront(state.layers.centers); bringLayerGroupToFront(state.layers.labels);
  updateLabelsVisibility(); updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
}
function bringLayerGroupToFront(layer){ if(!layer) return; if(layer.bringToFront) layer.bringToFront(); if(layer.eachLayer) layer.eachLayer(l=>{ if(l.bringToFront) l.bringToFront(); }); }
function refreshVectorStyles(){
  const s=styleVars();
  if(state.layers.rivers) state.layers.rivers.setStyle(riverStyle);
  if(state.layers.water) state.layers.water.setStyle(waterStyle);
  if(state.layers.railways) state.layers.railways.setStyle({color:s.railway,weight:1.65,opacity:.88});
  if(state.layers.admin) refreshSelectionStyles();
  if(state.layers.circles){
    state.layers.circles.eachLayer(m=>m.setStyle && m.setStyle({color:s.circleLine, fillColor:s.circleFill, fillOpacity:.74, opacity:.98}));
  }
  if(state.layers.centers) state.layers.centers.eachLayer(m=>m.setStyle && m.setStyle({color:'#3a2607', fillColor:'#f6c85f', fillOpacity:.82, opacity:.98}));
  refreshVisibility();
}

function toggleSelection(f){ const id=featureId(f); if(state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id); refreshSelectionStyles(); updateStatsAndSelection(); showFeature(f); }
function refreshSelectionStyles(){ if(!state.layers.admin) return; state.layers.admin.eachLayer(l=>l.setStyle(adminStyle(l.feature,state._lastVals))); }
function refreshSelectionStylesFor(id){ const l=state.adminLayerById.get(id); if(l) l.setStyle(adminStyle(l.feature,state._lastVals)); }

function baseExportScopeFeatures(scope=state.export.scope){
  const current=state.currentGeoJSON?.features || [];
  if(scope==='selection'){
    const sel=selectedFeatures();
    return state.selectedIds.size ? sel : current;
  }
  if(scope==='parents'){
    const names=[...state.visibleParents];
    return (state.rawGeoJSON?.features || current).filter(f=> names.includes(parentNameFromFeature(f)));
  }
  return current;
}
function exportScopeFeatures(scope=state.export.scope){
  let features=baseExportScopeFeatures(scope);
  const minPop=Number(state.export.minPopulation)||0;
  const minArea=Number(state.export.minArea)||0;
  if(minPop>0) features=features.filter(f=>(Number(f.properties?.population)||0)>=minPop);
  if(minArea>0) features=features.filter(f=>(Number(f.properties?.area_km2)||0)>=minArea);
  return features;
}
function exportFilterStatusHtml(){
  const parts=[];
  if(Number(state.export.minPopulation)>0) parts.push(`население ≥ ${num(state.export.minPopulation)}`);
  if(Number(state.export.minArea)>0) parts.push(`площадь ≥ ${num(state.export.minArea)} км²`);
  return parts.length ? `<div class="export-filter-note">Фильтр: ${escapeHtml(parts.join(' · '))}</div>` : '';
}
function featuresBounds(features){
  try{
    if(!features?.length) return state.dataBounds || null;
    const b=L.geoJSON({type:'FeatureCollection', features}).getBounds();
    return b.isValid() ? b : (state.dataBounds || null);
  }catch(_){ return state.dataBounds || null; }
}
function exportScopeLabel(){
  return state.export.scope==='selection' ? (state.selectedIds.size ? 'выбранной выборке' : 'текущему слою') : state.export.scope==='parents' ? 'отмеченным верхнеуровневым АТЕ' : 'текущему слою';
}
function parentSummary(features){
  const names=[...new Set(features.map(parentNameFromFeature).filter(Boolean))];
  return names.slice(0,6).join(', ') + (names.length>6 ? ` и ещё ${names.length-6}` : '');
}
function exportContextPresets(year){
  const y=Number(year);
  const base = {
    1897:{short:'Конец XIX века: дореволюционная система административно-территориального деления Западной Сибири. На карте представлены губернии и области Степного края, внутри которых показаны уезды.', long:'Конец XIX века: дореволюционная система административно-территориального деления Западной Сибири. Пространственная организация региона опиралась на губернии и области (Тобольская и Томская губернии, Акмолинская и Семипалатинская области), а базовым уровнем внутри них выступали уезды. Карта полезна для фиксации исходной конфигурации перед преобразованиями XX века.'},
    1914:{short:'Позднеимперский этап: сеть губерний, областей и уездов накануне революционных преобразований.', long:'Позднеимперский этап: сеть губерний, областей и уездов накануне революционных преобразований. Для Западной Сибири это финальная версия имперской сетки АТЕ перед советской перекройкой пространства, что важно для сравнения с последующим окружно-районным и областным устройством.'},
    1926:{short:'Раннесоветский переходный этап: окружно-районная система Сибирского края по материалам переписи 1926 года.', long:'Раннесоветский переходный этап: окружно-районная система Сибирского края по материалам переписи 1926 года. Карта фиксирует один из ключевых моментов трансформации АТЕ Западной Сибири, когда дореволюционные уезды уже исчезли, а новая окружно-районная сеть ещё не сменилась устойчивой областной схемой.'},
    1939:{short:'Предвоенный советский этап: укрепление областной системы административно-территориального деления.', long:'Предвоенный советский этап: укрепление областной системы административно-территориального деления. К этому моменту в Западной Сибири сформировалась более стабильная областная сетка, отражающая результаты советской административной реформы 1930-х годов.'},
    1959:{short:'Послевоенный этап: административная система Западной Сибири по переписи 1959 года.', long:'Послевоенный этап: административная система Западной Сибири по переписи 1959 года. Карта позволяет оценить пространственную конфигурацию районов и верхнеуровневых АТЕ на рубеже массовой урбанизации и индустриального освоения региона.'},
    1970:{short:'Зрелый советский период: сеть районов и областей в условиях устойчивой административной структуры.', long:'Зрелый советский период: сеть районов и областей в условиях устойчивой административной структуры. Карта отражает этап относительной стабильности советской сетки АТЕ и пригодна для сопоставления динамики населения и плотности.'},
    1979:{short:'Позднесоветский этап: пространственная структура АТЕ Западной Сибири в конце 1970-х годов.', long:'Позднесоветский этап: пространственная структура АТЕ Западной Сибири в конце 1970-х годов. Используется для анализа изменений накануне заключительного десятилетия СССР.'},
    1989:{short:'Финальный советский этап: система АТЕ Западной Сибири по переписи 1989 года.', long:'Финальный советский этап: система АТЕ Западной Сибири по переписи 1989 года. Этот срез удобен как база для сопоставления с современным административно-территориальным устройством.'},
    2021:{short:'Современный этап: актуальная система административно-территориального деления и населения.', long:'Современный этап: актуальная система административно-территориального деления и населения. Карта показывает современную конфигурацию районов и регионов Западной Сибири и служит конечной точкой для сравнения с историческими состояниями.'}
  };
  return base[y] || {short:'Исторический срез административно-территориального деления Западной Сибири.', long:'Исторический срез административно-территориального деления Западной Сибири. Карта предназначена для анализа пространственной трансформации АТЕ региона в рамках дипломного исследования.'};
}
function defaultExportTitle(){
  const modeTitles={admin_parent:'Административно-территориальное деление', admin_intermediate:'Промежуточный уровень АТД', admin_superparent:'Вышестоящие административные группировки', population:'Население административных единиц', density:'Плотность населения', urban_share:'Доля городского населения', rail_length:'Длина железных дорог в пределах АТЕ', rail_density:'Плотность железных дорог', unit_type:'Типы административных единиц'};
  return `${modeTitles[state.mode] || 'Карта Западной Сибири'} (${state.year} г.)`;
}
function defaultExportSubtitle(features){
  const level=state.pieGrouping==='lower' ? 'нижний уровень АТЕ' : 'верхние АТЕ';
  const parents=parentSummary(features);
  return parents ? `Западная Сибирь · ${level} · ${parents}` : 'Западная Сибирь';
}
function exportStatsHtml(features){
  const totalPop=sum(features.map(f=>Number(f.properties?.population)||0));
  const totalArea=sum(features.map(f=>Number(f.properties?.area_km2)||0));
  const density=totalArea ? totalPop/totalArea : null;
  const urban=urbanBreakdown(features);
  return `<div class="export-info-grid"><div class="export-info-card"><span>Объектов</span><b>${num(features.length)}</b></div><div class="export-info-card"><span>Население</span><b>${num(totalPop)}</b></div><div class="export-info-card"><span>Площадь, км²</span><b>${num(totalArea)}</b></div><div class="export-info-card"><span>Плотность</span><b>${num1(density)}</b></div>${urban.available?`<div class="export-info-card"><span>Доля городского населения</span><b>${pct(urban.urbanShare)}</b></div>`:''}<div class="export-info-card"><span>Охват</span><b>${escapeHtml(exportScopeLabel())}</b></div></div>`;
}
function exportLegendHtml(){
  return `<div class="export-legend-wrap">${$('legendBox')?.innerHTML || ''}</div>`;
}
function ensureExportModal(){
  let modal=$('exportMode'); if(modal) return modal;
  modal=document.createElement('div');
  modal.id='exportMode'; modal.className='export-modal'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div><section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle"><aside class="export-controls"><div class="export-controls-head"><div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div><button type="button" class="export-close" aria-label="Закрыть экспорт">×</button></div><label class="control-label" for="exportTitleInput">Название карты</label><input id="exportTitleInput" class="export-text-input" type="text"><label class="control-label" for="exportSubtitleInput">Подзаголовок</label><input id="exportSubtitleInput" class="export-text-input" type="text"><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select><div class="export-option-grid"><label><input type="checkbox" id="exportFitScope" checked> Автоцентрирование по охвату</label><label><input type="checkbox" id="exportShowLegend" checked> Показать легенду</label><label><input type="checkbox" id="exportShowStats" checked> Показать общую информацию</label><label><input type="checkbox" id="exportShowContext" checked> Показать контекст</label></div><details id="exportContextDetails" class="export-context-box" open><summary>Контекст периода</summary><label class="control-label" for="exportContextMode">Режим текста</label><select id="exportContextMode"><option value="short">Краткий</option><option value="long">Развёрнутый</option></select><textarea id="exportContextText" class="export-context-text" rows="6"></textarea></details><div class="button-row export-buttons"><button id="exportFitNow" type="button">Подогнать карту</button><button id="refreshExportPreview" type="button">Обновить превью</button></div><button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button><div class="mini-muted">В экспортный макет боковые панели интерфейса не попадают. В PNG включаются только карта, заголовок, контекст, легенда и общая сводка.</div></aside><div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div></section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportSubtitleInput','input', e=>{ state.export.subtitle=e.target.value; renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(); });
  bind('exportFitScope','change', e=>{ state.export.fitScope=!!e.target.checked; });
  bind('exportShowLegend','change', e=>{ state.export.showLegend=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowStats','change', e=>{ state.export.showStats=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowContext','change', e=>{ state.export.showContext=!!e.target.checked; $('exportContextDetails').style.display=state.export.showContext?'block':'none'; renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('exportFitNow','click', async ()=>{ await applyExportScopeToMap(); await refreshExportPreview(); });
  bind('refreshExportPreview','click', refreshExportPreview);
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function syncExportDefaults(resetTitle=true){
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(resetTitle || !state.export.subtitle) state.export.subtitle=defaultExportSubtitle(features);
  syncExportContextText();
  const map={title:'exportTitleInput', subtitle:'exportSubtitleInput', scope:'exportScopeSelect', fit:'exportFitScope', legend:'exportShowLegend', stats:'exportShowStats', context:'exportShowContext', mode:'exportContextMode'};
  if($(map.title)) $(map.title).value=state.export.title;
  if($(map.subtitle)) $(map.subtitle).value=state.export.subtitle;
  if($(map.scope)) $(map.scope).value=state.export.scope;
  if($(map.fit)) $(map.fit).checked=state.export.fitScope;
  if($(map.legend)) $(map.legend).checked=state.export.showLegend;
  if($(map.stats)) $(map.stats).checked=state.export.showStats;
  if($(map.context)) $(map.context).checked=state.export.showContext;
  if($(map.mode)) $(map.mode).value=state.export.contextMode;
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none';
  if($('exportContextText')) $('exportContextText').value=state.export.contextText;
  updateExportFilterLabels();
}
function syncExportContextText(){
  const preset=exportContextPresets(state.year);
  state.export.contextText = state.export.contextMode==='long' ? preset.long : preset.short;
  if($('exportContextText')) $('exportContextText').value=state.export.contextText;
  updateExportFilterLabels();
}
function updateExportFilterLabels(){
  const pop=$('exportMinPopLabel'); if(pop) pop.textContent=(Number(state.export.minPopulation)||0)>0 ? `показывать АТЕ с населением ≥ ${num(state.export.minPopulation)}` : 'без ограничения';
  const area=$('exportMinAreaLabel'); if(area) area.textContent=(Number(state.export.minArea)||0)>0 ? `показывать АТЕ с площадью ≥ ${num(state.export.minArea)} км²` : 'без ограничения';
}
async function openExportMode(){
  const modal=ensureExportModal();
  state.export.open=true; syncExportDefaults(true);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  await refreshExportPreview();
}
function closeExportMode(){
  const modal=$('exportMode'); if(!modal) return; state.export.open=false; modal.classList.remove('open'); modal.setAttribute('aria-hidden','true');
}
async function applyExportScopeToMap(){
  const features=exportScopeFeatures();
  const b=featuresBounds(features);
  if(b && state.map){ state.map.fitBounds(b,{padding:[38,38], animate:true, duration:.35, maxZoom:6.2}); await new Promise(r=>setTimeout(r, 420)); }
}
async function captureMapForExport(){
  const target=$('map');
  if(!target || typeof window.html2canvas!=='function') return '';
  const canvas=await window.html2canvas(target,{backgroundColor:null, useCORS:true, logging:false, scale:2});
  return canvas.toDataURL('image/png');
}
function renderExportPreviewCard(){
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const previewImg = state.export.mapImage ? `<img src="${state.export.mapImage}" alt="Предпросмотр карты" class="export-map-image">` : `<div class="export-map-placeholder">Карта будет показана здесь после обновления превью.</div>`;
  wrap.innerHTML=`<article class="export-layout"><header class="export-header"><div class="export-title-block"><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p>${exportFilterStatusHtml()}</div><div class="export-header-meta"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div></header>${state.export.showContext?`<section class="export-context"><h3>Контекст</h3><p>${escapeHtml(state.export.contextText || '')}</p></section>`:''}<section class="export-main"><div class="export-map-frame">${previewImg}</div><aside class="export-side">${state.export.showStats?`<section class="export-side-block"><h3>Общая информация</h3>${exportStatsHtml(features)}</section>`:''}${state.export.showLegend?`<section class="export-side-block"><h3>Легенда</h3>${exportLegendHtml()}</section>`:''}</aside></section><footer class="export-footer">Источник: интерактивный веб‑атлас дипломного исследования «Пространственная трансформация системы АТЕ Западной Сибири в XVIII–XX веках». Подготовлено в режиме экспорта v${APP_VERSION}.</footer></article>`;
}
async function refreshExportPreview(){
  if(!state.export.open) return;
  const status=$('exportPreviewStatus');
  if(status) status.textContent='Готовим макет и снимок карты…';
  if(state.export.fitScope) await applyExportScopeToMap();
  await new Promise(r=>setTimeout(r, 120));
  state.export.mapImage = await captureMapForExport();
  renderExportPreviewCard();
  if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
}
function addExportAdminLabels(map, admin, features){
  if(!admin || !features?.length) return;
  const items=[];
  admin.eachLayer(layer=>{
    const f=layer.feature; if(!f?.properties) return;
    const latlng=adminLabelLatLng(layer); if(!latlng) return;
    const label=cleanAdminLabelName(f.properties.name || f.properties.unit_name || f.properties.admin_name || f.properties.unit_id);
    const pop=Number(f.properties.population)||0;
    items.push({latlng,label,pop,priority:adminLabelPriority(f)});
  });
  const top=items.sort((a,b)=>(b.priority||0)-(a.priority||0)).slice(0,85);
  top.forEach((item,rank)=>{
    const cls=['admin-poly-label','export-admin-label'];
    if(rank<20) cls.push('major'); else if(rank<55) cls.push('medium'); else cls.push('minor');
    const marker=L.marker(item.latlng,{opacity:0,interactive:false,keyboard:false,icon:L.divIcon({className:'empty-label-anchor',html:'',iconSize:[0,0]})});
    marker.bindTooltip(escapeHtml(item.label),{permanent:true,direction:'center',offset:[0,0],opacity:1,className:cls.join(' '),interactive:false});
    marker.addTo(map);
  });
}
async function downloadExportPng(){
  const node=$('exportPreviewCard');
  if(!node || typeof window.html2canvas!=='function') return;
  const status=$('exportPreviewStatus'); if(status) status.textContent='Сохраняем PNG…';
  const canvas=await window.html2canvas(node,{backgroundColor:'#f7f5ef', useCORS:true, logging:false, scale:2});
  const a=document.createElement('a');
  a.href=canvas.toDataURL('image/png');
  a.download=`west_siberia_export_${state.year}_${state.mode}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  if(status) status.textContent='PNG готов. Файл сохранён в загрузки браузера.';
}
function selectedFeatures(){ if(!state.currentGeoJSON) return []; if(!state.selectedIds.size) return state.currentGeoJSON.features; return state.currentGeoJSON.features.filter(f=>state.selectedIds.has(featureId(f))); }
function updateStatsAndSelection(){ if(!state.currentGeoJSON) return; updateStats(selectedFeatures()); updateSelectionBox(); updateLegend(state.currentGeoJSON,state._lastVals); if(state.export.open) renderExportPreviewCard(); }
function updateStats(features){
  const all=!state.selectedIds.size;
  const pops=features.map(f=>Number(f.properties.population)||0);
  const areas=features.map(f=>Number(f.properties.area_km2)||0);
  const rails=features.map(f=>Number(f.properties.rail_length_km)||0);
  const total=sum(pops); const area=sum(areas); const density=area?total/area:null;
  const parts=urbanBreakdown(features);
  const urbanTotal=parts.urbanTotal; const ruralTotal=parts.ruralTotal; const urbanShare=parts.urbanShare;
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
  updateGroupAnalytics(features);
}
function avg(arr){ const vals=arr.map(Number).filter(v=>!Number.isNaN(v) && Number.isFinite(v)); return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null; }
function updateGroupAnalytics(features){
  const box=$('groupAnalyticsBox'); if(!box) return;
  state.lastAnalyticsFeatures=features;
  state.lastAnalyticsScope=state.selectedIds.size ? 'выборке' : 'текущему слою';
  const groupName=f=>String(f.properties?.admin_parent || f.properties?.region || f.properties?.oblast || f.properties?.province || '').trim();
  let base=features.filter(f=>Number(f.properties.area_km2)>=700 && groupName(f));
  if(base.length<2) base=features.filter(f=>groupName(f));
  const groups=new Map();
  base.forEach(f=>{ const key=groupName(f); if(!key) return; if(!groups.has(key)) groups.set(key, []); groups.get(key).push(f); });
  const metrics=[
    ['avg_area','Средняя площадь АТЕ, км²', fs=>avg(fs.map(f=>Number(f.properties.area_km2)))],
    ['avg_pop','Среднее население АТЕ', fs=>avg(fs.map(f=>Number(f.properties.population)))],
    ['avg_density','Средняя плотность, чел./км²', fs=>avg(fs.map(f=>Number(f.properties.density)))],
    ['avg_rail_density','Средняя плотность ЖД, км/1000 км²', fs=>avg(fs.map(f=>Number(f.properties.rail_density_km_1000)))],
  ];
  const scope=state.selectedIds.size ? 'выборке' : 'текущему слою';
  let html=pieChartsHtml(features, scope);
  html+=`<div class="analytics-title">По верхнему уровню <span>без городов и малых полигонов &lt;700 км² · расчёт по ${scope}</span></div>`;
  metrics.forEach(([id,title,fn])=>{
    const rows=[...groups.entries()].map(([name,fs])=>({name, n:fs.length, value:fn(fs)})).filter(r=>r.value!==null && !Number.isNaN(r.value)).sort((a,b)=>b.value-a.value).slice(0,8);
    const max=Math.max(...rows.map(r=>r.value),1);
    html+=`<div class="bar-chart"><h3>${title}</h3>${rows.map(r=>`<div class="bar-row"><div class="bar-label" title="${escapeHtml(r.name)}">${escapeHtml(r.name)} <span>${r.n}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,r.value/max*100)}%"></div></div><b>${id.includes('density')?num1(r.value):num(r.value)}</b></div>`).join('') || '<div class="mini-muted">Нет данных.</div>'}</div>`;
  });
  box.innerHTML=html;
  refreshPieLightboxIfOpen();
}
function pieGroupingMeta(){
  return state.pieGrouping==='lower'
    ? {label:'нижнего уровня', scopeText:'по выбранным АТЕ нижнего уровня'}
    : {label:'верхнего уровня', scopeText:'по верхнему уровню АТД'};
}
function pieChartsHtml(features, scope){
  const meta=pieGroupingMeta();
  return `<div class="pie-charts"><div class="analytics-title">Доли ${meta.label} <span>население и площадь от суммы по ${scope} · ${meta.scopeText}</span></div><div class="pie-grid">${sharePieHtml(features, 'population', 'Население')}${sharePieHtml(features, 'area_km2', 'Площадь')}</div></div>`;
}
function sharePieHtml(features, field, title){
  const rows=shareRows(features, field, state.pieGrouping);
  if(!rows.length) return `<div class="pie-card empty"><h3>${escapeHtml(title)}</h3><div class="mini-muted">Нет данных для диаграммы.</div></div>`;
  const total=sum(rows.map(r=>r.value));
  let angle=0;
  const slices=rows.map((r,i)=>{
    const share=total ? r.value/total : 0;
    const start=angle; const end=angle + share*360; angle=end;
    const color=chartSliceColor(r.name, i);
    const path=share>=0.9999
      ? `<circle cx="50" cy="50" r="42" fill="${color}"></circle>`
      : `<path d="${pieSlicePath(50,50,42,start,end)}" fill="${color}"></path>`;
    return {path, color, share, name:r.name, value:r.value};
  });
  const legend=slices.map(s=>`<div class="pie-legend-row"><span class="pie-dot" style="background:${s.color}"></span><span title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span><b>${pct(s.share)}</b></div>`).join('');
  return `<div class="pie-card" role="button" tabindex="0" data-chart-field="${escapeHtml(field)}" data-chart-title="${escapeHtml(title)}" title="Открыть диаграмму крупно"><h3>${escapeHtml(title)}<span class="pie-open-hint">↗</span></h3><div class="pie-wrap"><svg class="pie-svg" viewBox="0 0 100 100" role="img" aria-label="${escapeHtml(title)}">${slices.map(s=>s.path).join('')}<circle cx="50" cy="50" r="22" class="pie-hole"></circle></svg><div class="pie-total"><span>итого</span><b>${num(total)}</b></div></div><div class="pie-legend">${legend}</div></div>`;
}
function shareRows(features, field, grouping='upper'){
  const groups=new Map();
  features.forEach(f=>{
    const p=f.properties||{}; const value=Number(p[field])||0; if(value<=0) return;
    let key;
    if(grouping==='lower'){
      key = p.name ? `${p.name}${p.admin_parent ? ` · ${p.admin_parent}` : ''}` : (p.unit_id || '—');
    } else {
      key = String(p.admin_parent || '').trim();
      if(!key) return;
    }
    groups.set(key, (groups.get(key)||0)+value);
  });
  const sorted=[...groups.entries()].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const limit=grouping==='lower' ? 12 : 10;
  const top=sorted.slice(0,limit);
  const other=sum(sorted.slice(limit).map(r=>r.value));
  if(other>0) top.push({name:'Прочие', value:other});
  return top;
}
function pieSlicePath(cx, cy, r, startAngle, endAngle){
  const start=polarPoint(cx, cy, r, endAngle);
  const end=polarPoint(cx, cy, r, startAngle);
  const largeArc=endAngle-startAngle<=180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}
function polarPoint(cx, cy, r, angle){
  const rad=(angle-90)*Math.PI/180;
  return {x:cx + r*Math.cos(rad), y:cy + r*Math.sin(rad)};
}
function ensurePieLightbox(){
  let modal=$('chartLightbox'); if(modal) return modal;
  modal=document.createElement('div'); modal.id='chartLightbox'; modal.className='chart-lightbox'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="chart-lightbox-scrim" data-close-chart="1"></div><section class="chart-lightbox-card" role="dialog" aria-modal="true" aria-labelledby="chartLightboxTitle"><button type="button" class="chart-lightbox-close" aria-label="Закрыть увеличенную диаграмму">×</button><div class="chart-lightbox-kicker">Интерактивная аналитика · ${APP_VERSION}</div><h2 id="chartLightboxTitle"></h2><div id="chartLightboxBody" class="chart-lightbox-body"></div></section>`;
  document.body.appendChild(modal);
  modal.querySelector('.chart-lightbox-close').addEventListener('click', closePieLightbox);
  modal.querySelector('[data-close-chart]').addEventListener('click', closePieLightbox);
  return modal;
}
function openPieLightbox(field, title){
  state.activePieField=field; state.activePieTitle=title;
  const modal=ensurePieLightbox();
  renderPieLightbox(field, title);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
}
function closePieLightbox(){
  const modal=$('chartLightbox'); if(!modal) return;
  modal.classList.remove('open'); modal.setAttribute('aria-hidden','true');
}
function refreshPieLightboxIfOpen(){
  const modal=$('chartLightbox');
  if(modal?.classList.contains('open') && state.activePieField) renderPieLightbox(state.activePieField, state.activePieTitle || 'Диаграмма');
}
function renderPieLightbox(field, title){
  const modal=ensurePieLightbox(); const head=modal.querySelector('#chartLightboxTitle'); const body=modal.querySelector('#chartLightboxBody');
  const features=state.lastAnalyticsFeatures || selectedFeatures(); const scope=state.lastAnalyticsScope || (state.selectedIds.size ? 'выборке' : 'текущему слою');
  const meta=pieGroupingMeta();
  if(head) head.textContent=`${title}: доли ${meta.label}`;
  if(body) body.innerHTML=expandedSharePieHtml(features, field, title, scope);
  bindExpandedPieHover(modal);
}
function bindExpandedPieHover(modal){
  if(!modal) return;
  const setActive=(idx)=>{
    modal.querySelectorAll('[data-slice-index]').forEach(el=>el.classList.toggle('is-linked-hover', el.dataset.sliceIndex===String(idx)));
  };
  const clearActive=()=>modal.querySelectorAll('[data-slice-index]').forEach(el=>el.classList.remove('is-linked-hover'));
  modal.querySelectorAll('[data-slice-index]').forEach(el=>{
    el.addEventListener('mouseenter', ()=>setActive(el.dataset.sliceIndex));
    el.addEventListener('mouseleave', clearActive);
    el.addEventListener('focus', ()=>setActive(el.dataset.sliceIndex));
    el.addEventListener('blur', clearActive);
  });
}
function expandedSharePieHtml(features, field, title, scope){
  const rows=shareRows(features, field, state.pieGrouping); if(!rows.length) return '<div class="mini-muted">Нет данных для диаграммы.</div>';
  const total=sum(rows.map(r=>r.value)); let angle=0;
  const slices=rows.map((r,i)=>{
    const share=total ? r.value/total : 0; const start=angle; const end=angle+share*360; angle=end; const color=chartSliceColor(r.name, i);
    const shape=share>=0.9999
      ? `<circle class="expanded-pie-slice" data-slice-index="${i}" tabindex="0" cx="50" cy="50" r="42" fill="${color}"></circle>`
      : `<path class="expanded-pie-slice" data-slice-index="${i}" tabindex="0" d="${pieSlicePath(50,50,42,start,end)}" fill="${color}"></path>`;
    return {...r, share, color, shape, index:i};
  });
  const rowsHtml=slices.map(s=>`<div class="chart-legend-row" data-slice-index="${s.index}" tabindex="0"><span class="pie-dot" style="background:${s.color}"></span><span title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span><b>${pct(s.share)}</b><em>${num(s.value)}</em></div>`).join('');
  const meta=pieGroupingMeta();
  return `<div class="expanded-chart-summary"><div><span>Год</span><b>${state.year}</b></div><div><span>Расчёт</span><b>${scope}</b></div><div><span>Группировка</span><b>${meta.label}</b></div><div><span>Итого</span><b>${num(total)}</b></div></div><div class="expanded-chart-layout"><div class="expanded-pie-wrap"><svg class="pie-svg pie-svg-expanded" viewBox="0 0 100 100" role="img" aria-label="${escapeHtml(title)}">${slices.map(s=>s.shape).join('')}<circle cx="50" cy="50" r="22" class="pie-hole"></circle></svg><div class="pie-total pie-total-expanded"><span>${escapeHtml(field==='area_km2'?'км²':'чел.')}</span><b>${num(total)}</b></div></div><div class="chart-legend"><div class="chart-legend-head"><i></i><span>Группа</span><b>доля</b><em>значение</em></div>${rowsHtml}</div></div><div class="mini-muted chart-modal-note">Наведи на сектор или строку легенды — связанный элемент подсветится и слегка увеличится.</div>`;
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
  if(state.mode==='admin_parent'||state.mode==='admin_intermediate'||state.mode==='admin_superparent'||state.mode==='unit_type'){ const field=state.mode; const cats=[...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,14); cats.forEach(c=>{html+=`<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${c}</div>`}); }
  else { activeValueRamp().forEach((c,i,arr)=>{html+=`<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===arr.length-1?'больше':''}</div>`}); }
  html+=`<div class="legend-section">Гидрография</div><div class="legend-row"><span class="swatch water-swatch"></span>океан, озёра и водохранилища</div><div class="legend-row"><span class="river-swatch"></span>реки</div>`;
  if($('toggleCircles')?.checked){ const max=state.maxPop||0; const mid=max/4; const vals=state.currentGeoJSON?.features?.map(f=>Number(f.properties?.population)||0).filter(v=>v>0)||[]; html+=`<div class="legend-section">Круги населения</div>`; [[max,'макс.'],[mid,'примерно 1/4 макс.']].forEach(([v,label])=>{ const size=Math.max(8, populationSymbolSize(v, vals)); html+=`<div class="legend-row"><span class="circle-swatch" style="width:${size*1.25}px;height:${size*1.25}px"></span>${label}: ${num(v)}</div>`; }); const scaleName={sqrt:'квадратный корень',linear:'линейное',log:'логарифмическое',quantile:'квантильное'}[state.populationSymbol.scale]||state.populationSymbol.scale; html+=`<div class="mini-muted">Нормирование: ${scaleName}. Диапазон размера: ${Math.round(state.populationSymbol.minSize)}–${Math.round(state.populationSymbol.maxSize)} px.</div>`; }
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

/* v34 overrides: export map as live vector map, A4 modes, academic templates, circle-only symbols */
function exportTemplateName(){
  return {thesis:'карта для диплома', article:'карта для статьи', presentation:'презентационный слайд'}[state.export.template] || 'карта для диплома';
}
function exportPaperName(){
  return {a4Landscape:'A4 horizontal', a4Portrait:'A4 vertical', screen:'экранный формат'}[state.export.paper] || 'A4 horizontal';
}
function exportSourceCaption(){
  return 'Составлено автором по материалам: историко‑административные слои веб‑атласа, данные переписей населения Российской империи, СССР и РФ за 1897–2021 гг.; авторская обработка и визуализация в ГИС.';
}
function ensureExportModal(){
  let modal=$('exportMode'); if(modal) return modal;
  modal=document.createElement('div');
  modal.id='exportMode'; modal.className='export-modal'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div><section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle"><aside class="export-controls"><div class="export-controls-head"><div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div><button type="button" class="export-close" aria-label="Закрыть экспорт">×</button></div><label class="control-label" for="exportTitleInput">Название карты</label><input id="exportTitleInput" class="export-text-input" type="text"><label class="control-label" for="exportSubtitleInput">Подзаголовок</label><input id="exportSubtitleInput" class="export-text-input" type="text"><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select><label class="control-label" for="exportPaperSelect">Формат листа</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select><label class="control-label" for="exportTemplateSelect">Режим оформления</label><select id="exportTemplateSelect"><option value="thesis">Карта для диплома</option><option value="article">Карта для статьи</option><option value="presentation">Презентационный слайд</option></select><div class="export-option-grid"><label><input type="checkbox" id="exportFitScope" checked> Автоцентрирование по охвату</label><label><input type="checkbox" id="exportShowLegend" checked> Показать легенду</label><label><input type="checkbox" id="exportShowStats" checked> Показать общую информацию</label><label><input type="checkbox" id="exportShowContext" checked> Показать контекст</label></div><details id="exportContextDetails" class="export-context-box" open><summary>Контекст периода</summary><label class="control-label" for="exportContextMode">Режим текста</label><select id="exportContextMode"><option value="short">Краткий</option><option value="long">Развёрнутый</option></select><textarea id="exportContextText" class="export-context-text" rows="6"></textarea></details><div class="button-row export-buttons"><button id="exportFitNow" type="button">Подогнать карту</button><button id="refreshExportPreview" type="button">Обновить превью</button></div><button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button><div class="mini-muted">В PNG попадает отдельный чистый макет: карта, шапка, контекст, легенда, сводка и автоматическая подпись источников.</div></aside><div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div></section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportSubtitleInput','input', e=>{ state.export.subtitle=e.target.value; renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; renderExportPreviewCard(); });
  bind('exportTemplateSelect','change', e=>{ state.export.template=e.target.value; renderExportPreviewCard(); });
  bind('exportProjectionSelect','change', e=>{ state.export.projection=e.target.value; renderExportPreviewCard(); });
  ['Admin','Hydro','Railways','Population','Labels'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportMinPopRange','input', e=>{ state.export.minPopulation=Number(e.target.value)||0; updateExportFilterLabels(); renderExportPreviewCard(); });
  bind('exportMinAreaRange','input', e=>{ state.export.minArea=Number(e.target.value)||0; updateExportFilterLabels(); renderExportPreviewCard(); });
  bind('exportFitScope','change', e=>{ state.export.fitScope=!!e.target.checked; });
  bind('exportShowLegend','change', e=>{ state.export.showLegend=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowStats','change', e=>{ state.export.showStats=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowContext','change', e=>{ state.export.showContext=!!e.target.checked; $('exportContextDetails').style.display=state.export.showContext?'block':'none'; renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('exportFitNow','click', async ()=>{ await refreshExportPreview(true); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function syncExportDefaults(resetTitle=true){
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(resetTitle || !state.export.subtitle) state.export.subtitle=defaultExportSubtitle(features);
  syncExportContextText();
  const fields={title:'exportTitleInput', subtitle:'exportSubtitleInput', scope:'exportScopeSelect', fit:'exportFitScope', legend:'exportShowLegend', stats:'exportShowStats', context:'exportShowContext', mode:'exportContextMode', paper:'exportPaperSelect', template:'exportTemplateSelect'};
  if($(fields.title)) $(fields.title).value=state.export.title;
  if($(fields.subtitle)) $(fields.subtitle).value=state.export.subtitle;
  if($(fields.scope)) $(fields.scope).value=state.export.scope;
  if($(fields.paper)) $(fields.paper).value=state.export.paper;
  if($(fields.template)) $(fields.template).value=state.export.template;
  if($(fields.projection)) $(fields.projection).value=state.export.projection;
  if($(fields.labelMode)) $(fields.labelMode).value=state.export.labelMode;
  if($(fields.minPop)) $(fields.minPop).value=String(state.export.minPopulation||0);
  if($(fields.minArea)) $(fields.minArea).value=String(state.export.minArea||0);
  if($(fields.fit)) $(fields.fit).checked=state.export.fitScope;
  if($(fields.legend)) $(fields.legend).checked=state.export.showLegend;
  if($(fields.stats)) $(fields.stats).checked=state.export.showStats;
  if($(fields.context)) $(fields.context).checked=state.export.showContext;
  if($(fields.mode)) $(fields.mode).value=state.export.contextMode;
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none';
  if($('exportContextText')) $('exportContextText').value=state.export.contextText;
  updateExportFilterLabels();
}
function updateExportFilterLabels(){
  const pop=$('exportMinPopLabel'); if(pop) pop.textContent=(Number(state.export.minPopulation)||0)>0 ? `показывать АТЕ с населением ≥ ${num(state.export.minPopulation)}` : 'без ограничения';
  const area=$('exportMinAreaLabel'); if(area) area.textContent=(Number(state.export.minArea)||0)>0 ? `показывать АТЕ с площадью ≥ ${num(state.export.minArea)} км²` : 'без ограничения';
}
async function openExportMode(){
  const modal=ensureExportModal();
  state.export.open=true; syncExportDefaults(true);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  await refreshExportPreview(false);
}
function closeExportMode(){
  const modal=$('exportMode'); if(!modal) return;
  state.export.open=false; modal.classList.remove('open'); modal.setAttribute('aria-hidden','true');
  if(state.export.liveMap){ try{state.export.liveMap.remove();}catch(_){} state.export.liveMap=null; }
}
function renderExportPreviewCard(){
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const template=state.export.template || 'thesis';
  const paper=state.export.paper || 'a4Landscape';
  wrap.innerHTML=`<article class="export-layout export-paper-${paper} export-template-${template}"><header class="export-header"><div class="export-title-block"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p>${exportFilterStatusHtml()}</div><div class="export-header-meta"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div></header>${state.export.showContext?`<section class="export-context"><h3>Контекст периода</h3><p>${escapeHtml(state.export.contextText || '')}</p></section>`:''}<section class="export-main"><div class="export-map-frame"><div id="exportLiveMap" class="export-live-map"></div></div><aside class="export-side">${state.export.showStats?`<section class="export-side-block"><h3>Общая информация</h3>${exportStatsHtml(features)}</section>`:''}${state.export.showLegend?`<section class="export-side-block"><h3>Легенда</h3>${exportLegendHtml()}</section>`:''}</aside></section><footer class="export-footer">${escapeHtml(exportSourceCaption())}</footer></article>`;
  setTimeout(()=>updateExportLiveMap(), 40);
}
async function refreshExportPreview(fitMainMap=false){
  if(!state.export.open) return;
  const status=$('exportPreviewStatus');
  if(status) status.textContent='Обновляем экспортный макет…';
  if(fitMainMap && state.export.fitScope) await applyExportScopeToMap();
  renderExportPreviewCard();
  await updateExportLiveMap();
  if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
}
async function updateExportLiveMap(){
  const el=$('exportLiveMap'); if(!el || !window.L) return;
  if(state.export.liveMap){ try{state.export.liveMap.remove();}catch(_){} state.export.liveMap=null; }
  const map=L.map(el,{zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, preferCanvas:false});
  state.export.liveMap=map;
  const features=exportScopeFeatures();
  const bounds=featuresBounds(features) || state.dataBounds;
  const bg=document.createElement('div');
  bg.className='export-map-bg';
  el.appendChild(bg);
  await addExportVectorLayers(map, features);
  setTimeout(()=>{ map.invalidateSize(); if(bounds) map.fitBounds(bounds,{padding:[24,24], maxZoom:6.4, animate:false}); }, 40);
}
async function addExportVectorLayers(map, features){
  const field=valField(); const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)):[];
  try{
    if(state.manifest?.layers?.hydro && $('toggleHydro')?.checked !== false){
      const rivers=await loadJson(state.manifest.layers.hydro.rivers);
      const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
      const showReservoirs=Number(state.year)>=1959;
      const water={type:'FeatureCollection', features:(waterRaw.features||[]).filter(f=>showReservoirs || !isReservoirFeature(f) || isAlwaysVisibleWaterFeature(f))};
      L.geoJSON(rivers,{interactive:false, style:riverStyle}).addTo(map);
      L.geoJSON(water,{interactive:false, style:waterStyle}).addTo(map);
    }
  }catch(e){ console.warn('export hydro skipped', e); }
  if($('toggleAdmin')?.checked !== false){
    const admin=L.geoJSON({type:'FeatureCollection',features}, {interactive:false, style:f=>adminStyle(f, vals)}).addTo(map);
    if($('toggleCircles')?.checked !== false){
      const popVals=features.map(f=>Number(f.properties?.population)||0).filter(v=>v>0);
      admin.eachLayer(layer=>{
        const f=layer.feature; const p=f.properties||{}; const pop=Number(p.population)||0; if(!pop) return;
        const c=layer.getBounds().getCenter(); const size=populationSymbolSize(pop,popVals);
        L.circleMarker(c,{radius:size,color:styleVars().circleLine,weight:1.45,fillColor:styleVars().circleFill,fillOpacity:.74,opacity:.98,interactive:false}).addTo(map);
      });
    }
    addExportAdminLabels(map, admin, features);
  }
  try{
    if(state.manifest?.layers?.railways && $('toggleRailways')?.checked !== false){
      const rail=await loadJson(state.manifest.layers.railways.main);
      const filtered={type:'FeatureCollection', features:(rail.features||[]).filter(f=>{const p=f.properties||{}; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close); return o<=state.year && (c==null || c>state.year);})};
      L.geoJSON(filtered,{interactive:false, style:{color:styleVars().railway,weight:1.35,opacity:.72}}).addTo(map);
    }
  }catch(e){ console.warn('export railways skipped', e); }
}
async function downloadExportPng(){
  const node=$('exportPreviewCard');
  if(!node || typeof window.html2canvas!=='function'){
    const status=$('exportPreviewStatus'); if(status) status.textContent='Не загружена библиотека сохранения PNG. Проверьте подключение html2canvas.';
    return;
  }
  await updateExportLiveMap();
  await new Promise(r=>setTimeout(r,180));
  const status=$('exportPreviewStatus'); if(status) status.textContent='Сохраняем PNG…';
  const bg=getComputedStyle(node.querySelector('.export-layout')||node).backgroundColor || '#f7f5ef';
  const canvas=await window.html2canvas(node,{backgroundColor:bg, useCORS:true, logging:false, scale:2});
  const a=document.createElement('a');
  a.href=canvas.toDataURL('image/png');
  a.download=`west_siberia_${state.year}_${state.mode}_${state.export.template}_${state.export.paper}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  if(status) status.textContent='PNG готов. Файл сохранён в загрузки браузера.';
}

/* v36 overrides: direct SVG export map, draggable in-map blocks, graticule labels, scale bar */
function ensureExportFlags(){
  if(typeof state.export.showGraticule !== 'boolean') state.export.showGraticule=true;
  if(typeof state.export.showScale !== 'boolean') state.export.showScale=true;
  if(typeof state.export.showAdmin !== 'boolean') state.export.showAdmin=true;
  if(typeof state.export.showHydro !== 'boolean') state.export.showHydro=true;
  if(typeof state.export.showRailways !== 'boolean') state.export.showRailways=true;
  if(typeof state.export.showPopulation !== 'boolean') state.export.showPopulation=true;
  if(typeof state.export.showLabels !== 'boolean') state.export.showLabels=true;
  if(!state.export.paper) state.export.paper='a4Landscape';
  if(!state.export.template) state.export.template='thesis';
  if(!state.export.projection) state.export.projection='lambert';
  if(!state.export.centralMeridian) state.export.centralMeridian=75;
  if(!state.export.labelMode) state.export.labelMode='balanced';
  if(!Number.isFinite(Number(state.export.minPopulation))) state.export.minPopulation=0;
  if(!Number.isFinite(Number(state.export.minArea))) state.export.minArea=0;
  if(!state.export.overlayPositions) state.export.overlayPositions={};
}
function ensureExportModal(){
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div');
  modal.id='exportMode'; modal.className='export-modal export-modal-v36'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div><section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle"><aside class="export-controls"><div class="export-controls-head"><div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div><button type="button" class="export-close" aria-label="Закрыть экспорт">×</button></div><label class="control-label" for="exportTitleInput">Название карты</label><input id="exportTitleInput" class="export-text-input" type="text"><label class="control-label" for="exportSubtitleInput">Подзаголовок</label><input id="exportSubtitleInput" class="export-text-input" type="text"><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select><label class="control-label" for="exportPaperSelect">Формат листа</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select><label class="control-label" for="exportTemplateSelect">Режим оформления</label><select id="exportTemplateSelect"><option value="thesis">Карта для диплома</option><option value="article">Карта для статьи</option><option value="presentation">Презентационный слайд</option></select><label class="control-label" for="exportProjectionSelect">Проекция экспортной карты</label><select id="exportProjectionSelect"><option value="lambert">Коническая Ламберта · 75°E</option><option value="mercator">Меркатор / экранная</option></select><div class="export-option-grid export-layer-grid"><label><input type="checkbox" id="exportFitScope" checked> Автоцентрирование по охвату</label><label><input type="checkbox" id="exportShowAdmin" checked> Полигоны АТЕ</label><label><input type="checkbox" id="exportShowHydro" checked> Гидрография</label><label><input type="checkbox" id="exportShowRailways" checked> Железные дороги</label><label><input type="checkbox" id="exportShowPopulation" checked> Круги населения</label><label><input type="checkbox" id="exportShowLabels" checked> Подписи АТЕ</label><label><input type="checkbox" id="exportShowLegend" checked> Легенда внутри карты</label><label><input type="checkbox" id="exportShowStats" checked> Сводка внутри карты</label><label><input type="checkbox" id="exportShowContext" checked> Контекст внутри карты</label><label><input type="checkbox" id="exportShowGraticule" checked> Градусная сетка</label><label><input type="checkbox" id="exportShowScale" checked> Масштабная линейка</label></div><div class="export-filter-controls"><label class="control-label" for="exportLabelModeSelect">Генерализация подписей</label><select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select><label class="control-label" for="exportMinPopRange">Фильтр АТЕ по населению</label><input id="exportMinPopRange" type="range" min="0" max="1000000" step="10000" value="0"><div id="exportMinPopLabel" class="mini-muted">без ограничения</div><label class="control-label" for="exportMinAreaRange">Фильтр АТЕ по площади</label><input id="exportMinAreaRange" type="range" min="0" max="500000" step="5000" value="0"><div id="exportMinAreaLabel" class="mini-muted">без ограничения</div></div><details id="exportContextDetails" class="export-context-box" open><summary>Контекст периода</summary><label class="control-label" for="exportContextMode">Режим текста</label><select id="exportContextMode"><option value="short">Краткий</option><option value="long">Развёрнутый</option></select><textarea id="exportContextText" class="export-context-text" rows="5"></textarea></details><div class="button-row export-buttons"><button id="exportFitNow" type="button">Подогнать карту</button><button id="refreshExportPreview" type="button">Обновить превью</button></div><button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button><div class="mini-muted">Легенду, сводку и контекст можно перетаскивать прямо внутри картографического поля. Итоговый PNG сохраняет их текущее положение.</div></aside><div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div></section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportSubtitleInput','input', e=>{ state.export.subtitle=e.target.value; renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(false); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; renderExportPreviewCard(); });
  bind('exportTemplateSelect','change', e=>{ state.export.template=e.target.value; renderExportPreviewCard(); });
  bind('exportProjectionSelect','change', e=>{ state.export.projection=e.target.value; renderExportPreviewCard(); });
  ['Admin','Hydro','Railways','Population','Labels'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportMinPopRange','input', e=>{ state.export.minPopulation=Number(e.target.value)||0; updateExportFilterLabels(); renderExportPreviewCard(); });
  bind('exportMinAreaRange','input', e=>{ state.export.minArea=Number(e.target.value)||0; updateExportFilterLabels(); renderExportPreviewCard(); });
  bind('exportFitScope','change', e=>{ state.export.fitScope=!!e.target.checked; });
  bind('exportShowLegend','change', e=>{ state.export.showLegend=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowStats','change', e=>{ state.export.showStats=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowContext','change', e=>{ state.export.showContext=!!e.target.checked; $('exportContextDetails').style.display=state.export.showContext?'block':'none'; renderExportPreviewCard(); });
  bind('exportShowGraticule','change', e=>{ state.export.showGraticule=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowScale','change', e=>{ state.export.showScale=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('exportFitNow','click', async ()=>{ await refreshExportPreview(true); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(resetTitle || !state.export.subtitle) state.export.subtitle=defaultExportSubtitle(features);
  syncExportContextText();
  const fields={title:'exportTitleInput', subtitle:'exportSubtitleInput', scope:'exportScopeSelect', fit:'exportFitScope', legend:'exportShowLegend', stats:'exportShowStats', context:'exportShowContext', graticule:'exportShowGraticule', scale:'exportShowScale', admin:'exportShowAdmin', hydro:'exportShowHydro', railways:'exportShowRailways', population:'exportShowPopulation', labels:'exportShowLabels', mode:'exportContextMode', paper:'exportPaperSelect', template:'exportTemplateSelect', projection:'exportProjectionSelect', labelMode:'exportLabelModeSelect', minPop:'exportMinPopRange', minArea:'exportMinAreaRange'};
  if($(fields.title)) $(fields.title).value=state.export.title;
  if($(fields.subtitle)) $(fields.subtitle).value=state.export.subtitle;
  if($(fields.scope)) $(fields.scope).value=state.export.scope;
  if($(fields.paper)) $(fields.paper).value=state.export.paper;
  if($(fields.template)) $(fields.template).value=state.export.template;
  if($(fields.projection)) $(fields.projection).value=state.export.projection;
  if($(fields.labelMode)) $(fields.labelMode).value=state.export.labelMode;
  if($(fields.minPop)) $(fields.minPop).value=String(state.export.minPopulation||0);
  if($(fields.minArea)) $(fields.minArea).value=String(state.export.minArea||0);
  if($(fields.fit)) $(fields.fit).checked=state.export.fitScope;
  if($(fields.legend)) $(fields.legend).checked=state.export.showLegend;
  if($(fields.stats)) $(fields.stats).checked=state.export.showStats;
  if($(fields.context)) $(fields.context).checked=state.export.showContext;
  if($(fields.graticule)) $(fields.graticule).checked=state.export.showGraticule;
  if($(fields.scale)) $(fields.scale).checked=state.export.showScale;
  if($(fields.admin)) $(fields.admin).checked=state.export.showAdmin;
  if($(fields.hydro)) $(fields.hydro).checked=state.export.showHydro;
  if($(fields.railways)) $(fields.railways).checked=state.export.showRailways;
  if($(fields.population)) $(fields.population).checked=state.export.showPopulation;
  if($(fields.labels)) $(fields.labels).checked=state.export.showLabels;
  if($(fields.mode)) $(fields.mode).value=state.export.contextMode;
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none';
  if($('exportContextText')) $('exportContextText').value=state.export.contextText;
  updateExportFilterLabels();
}
function updateExportFilterLabels(){
  const pop=$('exportMinPopLabel'); if(pop) pop.textContent=(Number(state.export.minPopulation)||0)>0 ? `показывать АТЕ с населением ≥ ${num(state.export.minPopulation)}` : 'без ограничения';
  const area=$('exportMinAreaLabel'); if(area) area.textContent=(Number(state.export.minArea)||0)>0 ? `показывать АТЕ с площадью ≥ ${num(state.export.minArea)} км²` : 'без ограничения';
}
async function openExportMode(){
  const modal=ensureExportModal();
  state.export.open=true; syncExportDefaults(true);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  await refreshExportPreview(false);
}
function closeExportMode(){
  const modal=$('exportMode'); if(!modal) return;
  state.export.open=false; modal.classList.remove('open'); modal.setAttribute('aria-hidden','true');
}
function renderExportPreviewCard(){
  ensureExportFlags();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const template=state.export.template || 'thesis';
  const paper=state.export.paper || 'a4Landscape';
  wrap.innerHTML=`<article class="export-layout export-paper-${paper} export-template-${template}"><header class="export-header"><div class="export-title-block"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p>${exportFilterStatusHtml()}</div><div class="export-header-meta"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div></header><section class="export-main export-main-full"><div class="export-map-frame export-map-frame-v36"><div id="exportSvgMap" class="export-svg-map"><div class="export-map-placeholder">Формируем карту…</div></div>${exportOverlayBlocksHtml(features)}</div></section><footer class="export-footer">${escapeHtml(exportSourceCaption())}</footer></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
}
function exportOverlayBlocksHtml(features){
  const blocks=[];
  if(state.export.showContext){
    blocks.push(exportDraggableBlock('context','Контекст периода', `<p>${escapeHtml(state.export.contextText || '')}</p>`));
  }
  if(state.export.showStats){
    blocks.push(exportDraggableBlock('stats','Общая информация', exportStatsHtml(features)));
  }
  if(state.export.showLegend){
    blocks.push(exportDraggableBlock('legend','Легенда', exportLegendHtml()));
  }
  return blocks.join('');
}
function exportDraggableBlock(key,title,body){
  const defaults={context:{left:18,top:18}, stats:{right:18,top:18}, legend:{right:18,bottom:18}};
  const pos=state.export.overlayPositions?.[key] || defaults[key] || {left:18,top:18};
  const parts=[];
  if(pos.left!=null) parts.push(`left:${Number(pos.left)||0}px`);
  if(pos.top!=null) parts.push(`top:${Number(pos.top)||0}px`);
  if(pos.right!=null) parts.push(`right:${Number(pos.right)||0}px`);
  if(pos.bottom!=null) parts.push(`bottom:${Number(pos.bottom)||0}px`);
  return `<section class="export-map-card export-map-card-${key}" data-export-widget="${key}" style="${parts.join(';')}"><div class="export-map-card-head"><span class="drag-grip">⋮⋮</span><h3>${escapeHtml(title)}</h3></div><div class="export-map-card-body">${body}</div></section>`;
}
async function refreshExportPreview(fitMainMap=false){
  if(!state.export.open) return;
  const status=$('exportPreviewStatus');
  if(status) status.textContent='Обновляем экспортный макет…';
  if(fitMainMap && state.export.fitScope) await applyExportScopeToMap();
  renderExportPreviewCard();
  if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
}
async function updateExportLiveMap(){
  const el=$('exportSvgMap'); if(!el) return;
  const status=$('exportPreviewStatus');
  try{
    if(status) status.textContent='Строим SVG-карту…';
    const svg=await buildExportSvgMap();
    el.innerHTML=svg;
    if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
  }catch(e){
    console.error('SVG export map error', e);
    el.innerHTML=`<div class="export-map-placeholder">Не удалось построить карту: ${escapeHtml(e.message||String(e))}</div>`;
    if(status) status.textContent='Ошибка построения карты.';
  }
}
function exportMapSize(){
  const paper=state.export.paper || 'a4Landscape';
  if(paper==='a4Portrait') return {w:1080,h:1320};
  if(paper==='screen') return {w:1680,h:880};
  return {w:1540,h:980};
}
async function buildExportSvgMap(){
  const {w,h}=exportMapSize();
  const features=exportScopeFeatures();
  const bbox=expandedGeoBBox(geoBBoxFromFeatures(features), 0.075);
  const projection=makeExportProjection(bbox, w, h, 48);
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)):[];
  const parts=[];
  parts.push(`<svg class="export-map-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="0" y="0" width="${w}" height="${h}" rx="18" ry="18"/></clipPath><filter id="labelShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-color="#ffffff" flood-opacity="0.95"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="${exportBasemapFill()}"/><g clip-path="url(#exportMapClip)">`);
  if(state.export.showGraticule) parts.push(await exportGraticuleSvg(projection,w,h,bbox));
  if(state.export.showHydro){
    parts.push(await exportHydroSvg(projection,bbox));
  }
  if(state.export.showAdmin) parts.push(exportAdminPolygonsSvg(features, projection, vals));
  if(state.export.showRailways) parts.push(await exportRailSvg(projection,bbox));
  if(state.export.showPopulation) parts.push(exportPopulationCirclesSvg(features, projection));
  if(state.export.showLabels && state.export.labelMode!=='none') parts.push(exportAdminLabelsSvg(features, projection, w, h));
  parts.push(`</g>`);
  if(state.export.showGraticule) parts.push(exportGraticuleLabelsSvg(projection,w,h,bbox));
  if(state.export.showScale) parts.push(exportScaleBarSvg(projection,w,h,bbox));
  parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.18)" stroke-width="1"/></svg>`);
  return parts.join('');
}
function exportBasemapFill(){
  if(state.basemapStyle==='matchaLatte') return '#eef3df';
  if(state.basemapStyle==='paper') return '#f3ead8';
  if(state.basemapStyle==='cold') return '#e8f1f4';
  if(state.basemapStyle==='clean') return '#f9faf7';
  if(state.basemapStyle==='darkOcean') return '#162432';
  return '#eaf2ed';
}
function geoBBoxFromFeatures(features){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  (features||[]).forEach(f=>walkCoords(f.geometry, ([x,y])=>{ if(Number.isFinite(x)&&Number.isFinite(y)){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);} }));
  if(!Number.isFinite(minX)) return [57.4,42.4,92.3,74.1];
  return [minX,minY,maxX,maxY];
}
function expandedGeoBBox(bbox, frac){
  const [minX,minY,maxX,maxY]=bbox; const dx=Math.max(.1,maxX-minX), dy=Math.max(.1,maxY-minY);
  return [minX-dx*frac, Math.max(-84,minY-dy*frac), maxX+dx*frac, Math.min(84,maxY+dy*frac)];
}
function walkCoords(geom, cb){
  if(!geom) return;
  const t=geom.type, c=geom.coordinates;
  if(t==='Point') cb(c);
  else if(t==='LineString' || t==='MultiPoint') (c||[]).forEach(cb);
  else if(t==='Polygon' || t==='MultiLineString') (c||[]).forEach(a=>a.forEach(cb));
  else if(t==='MultiPolygon') (c||[]).forEach(poly=>poly.forEach(r=>r.forEach(cb)));
  else if(t==='GeometryCollection') (geom.geometries||[]).forEach(g=>walkCoords(g,cb));
}
function mercY(lat){ const r=Math.max(-84,Math.min(84,lat))*Math.PI/180; return Math.log(Math.tan(Math.PI/4+r/2)); }
function lambertForwardFactory(options={}){
  const deg=Math.PI/180;
  const phi1=(options.phi1 ?? 48)*deg, phi2=(options.phi2 ?? 68)*deg;
  const lat0=(options.lat0 ?? 57)*deg, lon0=(options.lon0 ?? 75)*deg;
  const n=Math.log(Math.cos(phi1)/Math.cos(phi2))/Math.log(Math.tan(Math.PI/4+phi2/2)/Math.tan(Math.PI/4+phi1/2));
  const F=(Math.cos(phi1)*Math.pow(Math.tan(Math.PI/4+phi1/2), n))/n;
  const rho0=F/Math.pow(Math.tan(Math.PI/4+lat0/2), n);
  return (lon,lat)=>{
    const lam=lon*deg, phi=Math.max(-84,Math.min(84,lat))*deg;
    const rho=F/Math.pow(Math.tan(Math.PI/4+phi/2), n);
    const theta=n*(lam-lon0);
    return [rho*Math.sin(theta), rho0-rho*Math.cos(theta)];
  };
}
function makeExportProjection(bbox,w,h,pad=30){
  if(state.export.projection==='mercator') return makeMercatorExportProjection(bbox,w,h,pad);
  return makeLambertExportProjection(bbox,w,h,pad);
}
function makeMercatorExportProjection(bbox,w,h,pad=30){
  const [minLon,minLat,maxLon,maxLat]=bbox;
  const x0=minLon, x1=maxLon, y0=mercY(minLat), y1=mercY(maxLat);
  const sx=(w-pad*2)/(x1-x0||1), sy=(h-pad*2)/(y1-y0||1);
  const s=Math.min(sx,sy);
  const ox=(w-(x1-x0)*s)/2, oy=(h-(y1-y0)*s)/2;
  const fn=(lon,lat)=>({x:ox+(lon-x0)*s, y:h-(oy+(mercY(lat)-y0)*s)});
  fn.scale=s; fn.bbox=bbox; fn.w=w; fn.h=h; fn.pad=pad; fn.kind='mercator';
  return fn;
}
function makeLambertExportProjection(bbox,w,h,pad=30){
  const [minLon,minLat,maxLon,maxLat]=bbox;
  const centerLon=Number(state.export.centralMeridian)||75;
  const centerLat=(minLat+maxLat)/2;
  const p0=lambertForwardFactory({lon0:centerLon, lat0:centerLat, phi1:48, phi2:68});
  const sample=[];
  const steps=12;
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    sample.push([minLon+(maxLon-minLon)*t,minLat]);
    sample.push([minLon+(maxLon-minLon)*t,maxLat]);
    sample.push([minLon,minLat+(maxLat-minLat)*t]);
    sample.push([maxLon,minLat+(maxLat-minLat)*t]);
  }
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  sample.forEach(([lon,lat])=>{ const [x,y]=p0(lon,lat); minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); });
  const sx=(w-pad*2)/(maxX-minX||1), sy=(h-pad*2)/(maxY-minY||1);
  const s=Math.min(sx,sy);
  const ox=(w-(maxX-minX)*s)/2 - minX*s;
  const oy=(h-(maxY-minY)*s)/2 - minY*s;
  const fn=(lon,lat)=>{ const [x,y]=p0(lon,lat); return {x:ox+x*s, y:oy+y*s}; };
  fn.scale=s; fn.bbox=bbox; fn.w=w; fn.h=h; fn.pad=pad; fn.kind='lambert'; fn.centerLon=centerLon; fn.centerLat=centerLat; fn.raw=p0;
  return fn;
}
function geomToSvgPath(geom, project){
  if(!geom) return '';
  const linePath=line=>line.map((pt,i)=>{const p=project(pt[0],pt[1]); return `${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(' ');
  const polygonPath=poly=>poly.map(r=>linePath(r)+' Z').join(' ');
  if(geom.type==='LineString') return linePath(geom.coordinates||[]);
  if(geom.type==='MultiLineString') return (geom.coordinates||[]).map(linePath).join(' ');
  if(geom.type==='Polygon') return polygonPath(geom.coordinates||[]);
  if(geom.type==='MultiPolygon') return (geom.coordinates||[]).map(polygonPath).join(' ');
  if(geom.type==='GeometryCollection') return (geom.geometries||[]).map(g=>geomToSvgPath(g,project)).join(' ');
  return '';
}
function featureIntersectsBBox(f,bbox){
  const b=geoBBoxFromFeatures([f]);
  return !(b[2]<bbox[0] || b[0]>bbox[2] || b[3]<bbox[1] || b[1]>bbox[3]);
}
function exportAdminPolygonsSvg(features, project, vals){
  const cfg=regionStyleConfig();
  return `<g class="export-admin-polygons">`+(features||[]).map(f=>{
    const p=f.properties||{};
    const fill=(state.mode==='admin_parent'||state.mode==='admin_intermediate'||state.mode==='admin_superparent'||state.mode==='unit_type') ? catColor(p[state.mode] || p.admin_parent) : valueColor(Number(p[valField()]), vals);
    const path=geomToSvgPath(f.geometry, project); if(!path) return '';
    return `<path d="${path}" fill="${fill}" fill-opacity="${cfg.fillOpacity}" stroke="${cfg.line}" stroke-opacity="${cfg.opacity}" stroke-width="${cfg.weight}"/>`;
  }).join('')+`</g>`;
}
async function exportHydroSvg(project,bbox){
  try{
    const rivers=await loadJson(state.manifest.layers.hydro.rivers);
    const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
    const showReservoirs=Number(state.year)>=1959;
    const vars=styleVars();
    const riverPaths=(rivers.features||[]).filter(f=>featureIntersectsBBox(f,bbox)).slice(0,2500).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="${vars.river}" stroke-width="0.75" stroke-opacity="0.54"/>`).join('');
    const waterPaths=(waterRaw.features||[]).filter(f=>(showReservoirs || !isReservoirFeature(f) || isAlwaysVisibleWaterFeature(f)) && featureIntersectsBBox(f,bbox)).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.86" stroke="${vars.waterLine}" stroke-width="0.65" stroke-opacity="0.70"/>`).join('');
    return `<g class="export-hydro"><g>${riverPaths}</g><g>${waterPaths}</g></g>`;
  }catch(e){ console.warn('export hydro svg skipped',e); return ''; }
}
async function exportRailSvg(project,bbox){
  try{
    const rail=await loadJson(state.manifest.layers.railways.main);
    const vars=styleVars();
    return `<g class="export-railways">`+(rail.features||[]).filter(f=>{
      const p=f.properties||{}; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close);
      return o<=state.year && (c==null || c>state.year) && featureIntersectsBBox(f,bbox);
    }).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="${vars.railway}" stroke-width="1.25" stroke-opacity="0.72" stroke-linecap="round" stroke-linejoin="round"/>`).join('')+`</g>`;
  }catch(e){ console.warn('export rail svg skipped',e); return ''; }
}
function exportPopulationCirclesSvg(features, project){
  const vals=(features||[]).map(f=>Number(f.properties?.population)||0).filter(v=>v>0);
  const vars=styleVars();
  const items=(features||[]).map(f=>{
    const p=f.properties||{}; const pop=Number(p.population)||0; if(!pop) return '';
    const c=featureVisualCenter(f.geometry); if(!c) return '';
    const pp=project(c[0],c[1]); const r=populationSymbolSize(pop, vals);
    return `<circle cx="${pp.x.toFixed(1)}" cy="${pp.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${vars.circleFill}" fill-opacity="0.72" stroke="${vars.circleLine}" stroke-width="1.4"/>`;
  }).join('');
  return `<g class="export-pop-circles">${items}</g>`;
}
function featureVisualCenter(geom){
  const pts=[]; walkCoords(geom, pt=>pts.push(pt));
  if(!pts.length) return null;
  const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  return [(Math.min(...xs)+Math.max(...xs))/2, (Math.min(...ys)+Math.max(...ys))/2];
}
function exportAdminLabelsSvg(features, project, w, h){
  const sorted=[...(features||[])].map(f=>({f,p:f.properties||{},c:featureVisualCenter(f.geometry)})).filter(x=>x.c).sort((a,b)=>(Number(b.p.population)||0)-(Number(a.p.population)||0));
  const placed=[]; const labels=[];
  const labelMode=state.export.labelMode || 'balanced';
  const zThreshold=labelMode==='major'?16:labelMode==='dense'?9999:((features||[]).length>160?42:(features||[]).length>80?68:9999);
  sorted.forEach((it,idx)=>{
    if(idx>zThreshold && (Number(it.p.population)||0)<(sorted[0]?.p?.population||0)*(labelMode==='major'?0.16:0.06)) return;
    const name=cleanAdminLabelName(it.p.name || it.p.unit_name || it.p.admin_name || ''); if(!name) return;
    const pt=project(it.c[0],it.c[1]);
    const fs=idx<8?12:idx<24?10.5:9.2; const tw=Math.min(160, Math.max(42, name.length*fs*.54)); const th=fs+8;
    const box={left:pt.x-tw/2,right:pt.x+tw/2,top:pt.y-th/2,bottom:pt.y+th/2};
    if(box.left<6||box.right>w-6||box.top<6||box.bottom>h-6) return;
    if(placed.some(q=>!(box.right<q.left || box.left>q.right || box.bottom<q.top || box.top>q.bottom))) return;
    placed.push(box);
    labels.push(`<g class="export-admin-label" filter="url(#labelShadow)"><rect x="${box.left.toFixed(1)}" y="${box.top.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="6" fill="rgba(255,255,255,.82)" stroke="rgba(75,80,74,.18)"/><text x="${pt.x.toFixed(1)}" y="${(pt.y+fs*.35).toFixed(1)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${fs}" font-weight="800" fill="#27323d">${escapeHtml(name)}</text></g>`);
  });
  return `<g class="export-labels">${labels.join('')}</g>`;
}
async function exportGraticuleSvg(project,w,h,bbox){
  try{
    const gr=state.manifest?.layers?.graticules_10 ? await loadJson(state.manifest.layers.graticules_10) : null;
    if(gr?.features?.length){
      const paths=gr.features.filter(f=>featureIntersectsBBox(f,bbox)).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="rgba(60,80,90,.18)" stroke-width="0.65" stroke-dasharray="3 5"/>`).join('');
      return `<g class="export-graticule">${paths}</g>`;
    }
  }catch(e){ console.warn('external graticule skipped',e); }
  const [minLon,minLat,maxLon,maxLat]=bbox; const paths=[];
  for(let lon=Math.ceil(minLon/10)*10; lon<=maxLon; lon+=10){ const pts=[]; for(let lat=minLat; lat<=maxLat; lat+=(maxLat-minLat)/40){ const p=project(lon,lat); pts.push(`${pts.length?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`); } paths.push(`<path d="${pts.join(' ')}" fill="none" stroke="rgba(60,80,90,.18)" stroke-width="0.65" stroke-dasharray="3 5"/>`); }
  for(let lat=Math.ceil(minLat/10)*10; lat<=maxLat; lat+=10){ const pts=[]; for(let lon=minLon; lon<=maxLon; lon+=(maxLon-minLon)/40){ const p=project(lon,lat); pts.push(`${pts.length?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`); } paths.push(`<path d="${pts.join(' ')}" fill="none" stroke="rgba(60,80,90,.18)" stroke-width="0.65" stroke-dasharray="3 5"/>`); }
  return `<g class="export-graticule">${paths.join('')}</g>`;
}
function exportGraticuleLabelsSvg(project,w,h,bbox){
  const [minLon,minLat,maxLon,maxLat]=bbox; const labels=[];
  for(let lon=Math.ceil(minLon/10)*10; lon<=maxLon; lon+=10){
    const p=project(lon, minLat+(maxLat-minLat)*0.03);
    if(p.x>28 && p.x<w-28) labels.push(`<text class="export-degree-label" x="${p.x.toFixed(1)}" y="${h-10}" text-anchor="middle">${Math.abs(lon)}°${lon>=0?'E':'W'}</text>`);
  }
  for(let lat=Math.ceil(minLat/10)*10; lat<=maxLat; lat+=10){
    const p=project(minLon+(maxLon-minLon)*0.03, lat);
    if(p.y>22 && p.y<h-22) labels.push(`<text class="export-degree-label" x="10" y="${(p.y+4).toFixed(1)}" text-anchor="start">${Math.abs(lat)}°${lat>=0?'N':'S'}</text>`);
  }
  return `<g class="export-graticule-labels">${labels.join('')}</g>`;
}
function exportScaleBarSvg(project,w,h,bbox){
  const centerLat=(bbox[1]+bbox[3])/2, centerLon=(bbox[0]+bbox[2])/2;
  const p1=project(centerLon, centerLat), p2=project(centerLon+1, centerLat);
  const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.cos(centerLat*Math.PI/180);
  const kmPerPx=kmPerDeg/pxPerDeg;
  const targetPx=170; const targetKm=Math.max(1,kmPerPx*targetPx);
  const nice=[25,50,100,150,200,300,500,750,1000,1500,2000].filter(v=>v<=targetKm).pop() || 25;
  const px=nice/kmPerPx; const x=36, y=h-42;
  return `<g class="export-scale-bar"><line x1="${x}" y1="${y}" x2="${(x+px).toFixed(1)}" y2="${y}" stroke="#253241" stroke-width="3"/><line x1="${x}" y1="${y-6}" x2="${x}" y2="${y+6}" stroke="#253241" stroke-width="2"/><line x1="${(x+px).toFixed(1)}" y1="${y-6}" x2="${(x+px).toFixed(1)}" y2="${y+6}" stroke="#253241" stroke-width="2"/><text x="${(x+px/2).toFixed(1)}" y="${y-10}" text-anchor="middle" font-size="12" font-weight="800" fill="#253241">${nice} км</text></g>`;
}
function initExportOverlayDrag(){
  const frame=document.querySelector('.export-map-frame-v36'); if(!frame) return;
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    const head=card.querySelector('.export-map-card-head') || card;
    head.addEventListener('pointerdown', ev=>{
      ev.preventDefault(); card.setPointerCapture?.(ev.pointerId);
      const f=frame.getBoundingClientRect(); const r=card.getBoundingClientRect();
      const key=card.dataset.exportWidget; const dx=ev.clientX-r.left, dy=ev.clientY-r.top;
      const move=e=>{
        const maxX=f.width-r.width-8, maxY=f.height-r.height-8;
        const left=Math.max(8, Math.min(maxX, e.clientX-f.left-dx));
        const top=Math.max(8, Math.min(maxY, e.clientY-f.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px'; card.style.right='auto'; card.style.bottom='auto';
        state.export.overlayPositions[key]={left:Math.round(left), top:Math.round(top)};
      };
      const up=()=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    });
  });
}
async function downloadExportPng(){
  const node=$('exportPreviewCard');
  if(!node || typeof window.html2canvas!=='function'){
    const status=$('exportPreviewStatus'); if(status) status.textContent='Не загружена библиотека сохранения PNG. Проверьте подключение html2canvas.';
    return;
  }
  renderExportPreviewCard();
  await new Promise(r=>setTimeout(r,220));
  const status=$('exportPreviewStatus'); if(status) status.textContent='Сохраняем PNG…';
  const bg=getComputedStyle(node.querySelector('.export-layout')||node).backgroundColor || '#f7f5ef';
  const canvas=await window.html2canvas(node,{backgroundColor:bg, useCORS:true, logging:false, scale:2});
  const a=document.createElement('a');
  a.href=canvas.toDataURL('image/png');
  a.download=`west_siberia_${state.year}_${state.mode}_${state.export.template}_${state.export.paper}_v${APP_VERSION}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  if(status) status.textContent='PNG готов. Файл сохранён в загрузки браузера.';
}


/* v38 overrides: corrected Lambert orientation, larger export canvas, headless academic blocks, export pan/zoom, north ocean cap */
function ensureExportFlags(){
  if(typeof state.export.showGraticule !== 'boolean') state.export.showGraticule=true;
  if(typeof state.export.showScale !== 'boolean') state.export.showScale=true;
  if(typeof state.export.showAdmin !== 'boolean') state.export.showAdmin=true;
  if(typeof state.export.showHydro !== 'boolean') state.export.showHydro=true;
  if(typeof state.export.showRailways !== 'boolean') state.export.showRailways=true;
  if(typeof state.export.showPopulation !== 'boolean') state.export.showPopulation=true;
  if(typeof state.export.showLabels !== 'boolean') state.export.showLabels=true;
  if(!state.export.paper) state.export.paper='a4Landscape';
  if(!state.export.template) state.export.template='thesis';
  state.export.projection='lambert';
  if(!state.export.centralMeridian) state.export.centralMeridian=75;
  if(!state.export.labelMode) state.export.labelMode='balanced';
  if(!Number.isFinite(Number(state.export.minPopulation))) state.export.minPopulation=0;
  if(!Number.isFinite(Number(state.export.minArea))) state.export.minArea=0;
  if(!state.export.overlayPositions) state.export.overlayPositions={};
  if(!state.export.mapViewport || typeof state.export.mapViewport!=='object') state.export.mapViewport={x:0,y:0,zoom:1};
  if(!Number.isFinite(Number(state.export.mapViewport.x))) state.export.mapViewport.x=0;
  if(!Number.isFinite(Number(state.export.mapViewport.y))) state.export.mapViewport.y=0;
  if(!Number.isFinite(Number(state.export.mapViewport.zoom))) state.export.mapViewport.zoom=1;
}
function ensureExportModal(){
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div');
  modal.id='exportMode'; modal.className='export-modal export-modal-v36 export-modal-v38'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div><section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle"><aside class="export-controls"><div class="export-controls-head"><div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div><button type="button" class="export-close" aria-label="Закрыть экспорт">×</button></div><label class="control-label" for="exportTitleInput">Название карты</label><input id="exportTitleInput" class="export-text-input" type="text"><label class="control-label" for="exportSubtitleInput">Подзаголовок</label><input id="exportSubtitleInput" class="export-text-input" type="text"><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select><label class="control-label" for="exportPaperSelect">Формат листа</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select><label class="control-label" for="exportTemplateSelect">Режим оформления</label><select id="exportTemplateSelect"><option value="thesis">Карта для диплома</option><option value="article">Карта для статьи</option><option value="presentation">Презентационный слайд</option></select><div class="export-option-grid export-layer-grid"><label><input type="checkbox" id="exportFitScope" checked> Автоцентрирование по охвату</label><label><input type="checkbox" id="exportShowAdmin" checked> Административный слой</label><label><input type="checkbox" id="exportShowHydro" checked> Гидрография и океан</label><label><input type="checkbox" id="exportShowRailways" checked> Железные дороги</label><label><input type="checkbox" id="exportShowPopulation" checked> Символы населения</label><label><input type="checkbox" id="exportShowLabels" checked> Подписи АТЕ</label><label><input type="checkbox" id="exportShowLegend" checked> Условные обозначения</label><label><input type="checkbox" id="exportShowStats" checked> Общая информация</label><label><input type="checkbox" id="exportShowContext" checked> Контекст</label><label><input type="checkbox" id="exportShowGraticule" checked> Градусная сетка</label><label><input type="checkbox" id="exportShowScale" checked> Масштабная линейка</label></div><div class="export-filter-controls"><label class="control-label" for="exportLabelModeSelect">Генерализация подписей</label><select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select><label class="control-label" for="exportMinPopRange">Фильтр АТЕ по населению</label><input id="exportMinPopRange" type="range" min="0" max="1000000" step="10000" value="0"><div id="exportMinPopLabel" class="mini-muted">без ограничения</div><label class="control-label" for="exportMinAreaRange">Фильтр АТЕ по площади</label><input id="exportMinAreaRange" type="range" min="0" max="500000" step="5000" value="0"><div id="exportMinAreaLabel" class="mini-muted">без ограничения</div></div><details id="exportContextDetails" class="export-context-box" open><summary>Поясняющий текст</summary><label class="control-label" for="exportContextMode">Режим текста</label><select id="exportContextMode"><option value="short">Краткий</option><option value="long">Развёрнутый</option></select><textarea id="exportContextText" class="export-context-text" rows="5"></textarea></details><div class="button-row export-buttons"><button id="exportFitNow" type="button">Подогнать карту</button><button id="exportResetView" type="button">Сбросить вид</button><button id="refreshExportPreview" type="button">Обновить превью</button></div><button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button><div class="mini-muted">Внутри картографического поля можно двигать карту мышью и слегка масштабировать колёсиком. Легенду, сводку и контекст можно перетаскивать.</div></aside><div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div></section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportSubtitleInput','input', e=>{ state.export.subtitle=e.target.value; renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(false); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; renderExportPreviewCard(); });
  bind('exportTemplateSelect','change', e=>{ state.export.template=e.target.value; renderExportPreviewCard(); });
  ['Admin','Hydro','Railways','Population','Labels'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportMinPopRange','input', e=>{ state.export.minPopulation=Number(e.target.value)||0; updateExportFilterLabels(); renderExportPreviewCard(); });
  bind('exportMinAreaRange','input', e=>{ state.export.minArea=Number(e.target.value)||0; updateExportFilterLabels(); renderExportPreviewCard(); });
  bind('exportFitScope','change', e=>{ state.export.fitScope=!!e.target.checked; });
  bind('exportShowLegend','change', e=>{ state.export.showLegend=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowStats','change', e=>{ state.export.showStats=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowContext','change', e=>{ state.export.showContext=!!e.target.checked; $('exportContextDetails').style.display=state.export.showContext?'block':'none'; renderExportPreviewCard(); });
  bind('exportShowGraticule','change', e=>{ state.export.showGraticule=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowScale','change', e=>{ state.export.showScale=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('exportFitNow','click', async ()=>{ state.export.mapViewport={x:0,y:0,zoom:1}; await refreshExportPreview(true); });
  bind('exportResetView','click', ()=>{ state.export.mapViewport={x:0,y:0,zoom:1}; renderExportPreviewCard(); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(resetTitle || !state.export.subtitle) state.export.subtitle=defaultExportSubtitle(features);
  syncExportContextText();
  const fields={title:'exportTitleInput', subtitle:'exportSubtitleInput', scope:'exportScopeSelect', fit:'exportFitScope', legend:'exportShowLegend', stats:'exportShowStats', context:'exportShowContext', graticule:'exportShowGraticule', scale:'exportShowScale', admin:'exportShowAdmin', hydro:'exportShowHydro', railways:'exportShowRailways', population:'exportShowPopulation', labels:'exportShowLabels', mode:'exportContextMode', paper:'exportPaperSelect', template:'exportTemplateSelect', labelMode:'exportLabelModeSelect', minPop:'exportMinPopRange', minArea:'exportMinAreaRange'};
  if($(fields.title)) $(fields.title).value=state.export.title;
  if($(fields.subtitle)) $(fields.subtitle).value=state.export.subtitle;
  if($(fields.scope)) $(fields.scope).value=state.export.scope;
  if($(fields.fit)) $(fields.fit).checked=state.export.fitScope;
  if($(fields.legend)) $(fields.legend).checked=state.export.showLegend;
  if($(fields.stats)) $(fields.stats).checked=state.export.showStats;
  if($(fields.context)) $(fields.context).checked=state.export.showContext;
  if($(fields.mode)) $(fields.mode).value=state.export.contextMode;
  if($(fields.paper)) $(fields.paper).value=state.export.paper;
  if($(fields.template)) $(fields.template).value=state.export.template;
  if($(fields.labelMode)) $(fields.labelMode).value=state.export.labelMode;
  if($(fields.minPop)) $(fields.minPop).value=Number(state.export.minPopulation)||0;
  if($(fields.minArea)) $(fields.minArea).value=Number(state.export.minArea)||0;
  if($(fields.graticule)) $(fields.graticule).checked=state.export.showGraticule;
  if($(fields.scale)) $(fields.scale).checked=state.export.showScale;
  if($(fields.admin)) $(fields.admin).checked=state.export.showAdmin;
  if($(fields.hydro)) $(fields.hydro).checked=state.export.showHydro;
  if($(fields.railways)) $(fields.railways).checked=state.export.showRailways;
  if($(fields.population)) $(fields.population).checked=state.export.showPopulation;
  if($(fields.labels)) $(fields.labels).checked=state.export.showLabels;
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none';
  if($('exportContextText')) $('exportContextText').value=state.export.contextText;
  updateExportFilterLabels();
}
function renderExportPreviewCard(){
  ensureExportFlags();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const template=state.export.template || 'thesis';
  const paper=state.export.paper || 'a4Landscape';
  wrap.innerHTML=`<article class="export-layout export-layout-v38 export-paper-${paper} export-template-${template}"><header class="export-header export-header-v38"><div class="export-title-block"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p>${exportFilterStatusHtml()}</div><div class="export-header-meta"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div></header><section class="export-main export-main-full"><div class="export-map-frame export-map-frame-v36 export-map-frame-v38"><div id="exportSvgMap" class="export-svg-map"><div class="export-map-placeholder">Формируем карту…</div></div><div class="export-map-nav"><button type="button" data-export-nav="zoom-in">＋</button><button type="button" data-export-nav="zoom-out">－</button><button type="button" data-export-nav="reset">⌂</button></div>${exportOverlayBlocksHtml(features)}</div></section><footer class="export-footer">${escapeHtml(exportSourceCaption())}</footer></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
  initExportMapInteraction();
}
function exportOverlayBlocksHtml(features){
  const blocks=[];
  if(state.export.showContext){
    blocks.push(exportDraggableBlock('context','', `<div class="export-context-plain">${escapeHtml(state.export.contextText || '')}</div>`));
  }
  if(state.export.showStats){
    blocks.push(exportDraggableBlock('stats','', `<div class="export-stats-plain">${exportStatsHtml(features)}</div>`));
  }
  if(state.export.showLegend){
    blocks.push(exportDraggableBlock('legend','', `<div class="export-legend-plain">${exportLegendHtml()}</div>`));
  }
  return blocks.join('');
}
function exportDraggableBlock(key,title,body){
  const defaults={context:{left:24,top:22}, stats:{right:22,top:22}, legend:{right:22,bottom:22}};
  const pos=state.export.overlayPositions?.[key] || defaults[key] || {left:18,top:18};
  const parts=[];
  if(pos.left!=null) parts.push(`left:${Number(pos.left)||0}px`);
  if(pos.top!=null) parts.push(`top:${Number(pos.top)||0}px`);
  if(pos.right!=null) parts.push(`right:${Number(pos.right)||0}px`);
  if(pos.bottom!=null) parts.push(`bottom:${Number(pos.bottom)||0}px`);
  return `<section class="export-map-card export-map-card-${key}${title?'':' export-map-card-headless'}" data-export-widget="${key}" style="${parts.join(';')}">${title?`<div class="export-map-card-head"><span class="drag-grip">⋮⋮</span><h3>${escapeHtml(title)}</h3></div>`:''}<div class="export-map-card-body">${body}</div></section>`;
}
function exportMapSize(){
  const paper=state.export.paper || 'a4Landscape';
  if(paper==='a4Portrait') return {w:1260,h:1760};
  if(paper==='screen') return {w:1920,h:1080};
  return {w:1820,h:1280};
}
function exportExpandedGeoBBox(features){
  const bbox=geoBBoxFromFeatures(features);
  const [minX,minY,maxX,maxY]=bbox;
  const dx=Math.max(0.1,maxX-minX), dy=Math.max(0.1,maxY-minY);
  const out=[minX-dx*0.24, Math.max(-84,minY-dy*0.18), maxX+dx*0.24, Math.min(89,maxY+dy*0.34)];
  out[1]=Math.min(out[1], 42.0);
  out[3]=Math.max(out[3], 83.5);
  return out;
}
function exportViewportClamp(w,h,zoom,x,y){
  const z=Math.max(1, Math.min(2.4, Number(zoom)||1));
  const limX=Math.max(0, (w*(z-1))/2 + 80);
  const limY=Math.max(0, (h*(z-1))/2 + 80);
  return {zoom:z, x:Math.max(-limX, Math.min(limX, Number(x)||0)), y:Math.max(-limY, Math.min(limY, Number(y)||0))};
}
function exportMapBodyTransform(w,h){
  ensureExportFlags();
  const vp=exportViewportClamp(w,h,state.export.mapViewport.zoom,state.export.mapViewport.x,state.export.mapViewport.y);
  state.export.mapViewport=vp;
  const cx=w/2, cy=h/2;
  return `translate(${vp.x.toFixed(1)} ${vp.y.toFixed(1)}) translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${vp.zoom.toFixed(4)}) translate(${-cx.toFixed(1)} ${-cy.toFixed(1)})`;
}
async function buildExportSvgMap(){
  const {w,h}=exportMapSize();
  const features=exportScopeFeatures();
  const bbox=exportExpandedGeoBBox(features);
  const projection=makeExportProjection(bbox, w, h, 56);
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)) : [];
  const parts=[];
  const bodyTransform=exportMapBodyTransform(w,h);
  parts.push(`<svg class="export-map-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="0" y="0" width="${w}" height="${h}" rx="18" ry="18"/></clipPath><filter id="labelShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-color="#ffffff" flood-opacity="0.95"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="${exportBasemapFill()}"/><g clip-path="url(#exportMapClip)"><g class="export-map-body" transform="${bodyTransform}">`);
  if(state.export.showGraticule) parts.push(await exportGraticuleSvg(projection,w,h,bbox));
  if(state.export.showHydro) parts.push(await exportHydroSvg(projection,bbox));
  if(state.export.showAdmin) parts.push(exportAdminPolygonsSvg(features, projection, vals));
  if(state.export.showRailways) parts.push(await exportRailSvg(projection,bbox));
  if(state.export.showPopulation) parts.push(exportPopulationCirclesSvg(features, projection));
  if(state.export.showLabels && state.export.labelMode!=='none') parts.push(exportAdminLabelsSvg(features, projection, w, h));
  parts.push(`</g></g>`);
  if(state.export.showGraticule) parts.push(exportGraticuleLabelsSvg(projection,w,h,bbox));
  if(state.export.showScale) parts.push(exportScaleBarSvg(projection,w,h,bbox));
  parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.16)" stroke-width="1"/></svg>`);
  return parts.join('');
}
function makeExportProjection(bbox,w,h,pad=30){
  return makeLambertExportProjection(bbox,w,h,pad);
}
function makeLambertExportProjection(bbox,w,h,pad=30){
  const [minLon,minLat,maxLon,maxLat]=bbox;
  const centerLon=Number(state.export.centralMeridian)||75;
  const centerLat=Math.max(52, Math.min(72, (minLat+maxLat)/2));
  const p0=lambertForwardFactory({lon0:centerLon, lat0:centerLat, phi1:52, phi2:66});
  const sample=[];
  const steps=28;
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    sample.push([minLon+(maxLon-minLon)*t,minLat]);
    sample.push([minLon+(maxLon-minLon)*t,maxLat]);
    sample.push([minLon,minLat+(maxLat-minLat)*t]);
    sample.push([maxLon,minLat+(maxLat-minLat)*t]);
  }
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  sample.forEach(([lon,lat])=>{ const [x,y]=p0(lon,lat); minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y); });
  const sx=(w-pad*2)/(maxX-minX||1), sy=(h-pad*2)/(maxY-minY||1);
  const s=Math.min(sx,sy);
  const ox=(w-(maxX-minX)*s)/2 - minX*s;
  const oy=(h-(maxY-minY)*s)/2;
  const fn=(lon,lat)=>{ const [x,y]=p0(lon,lat); return {x:ox+x*s, y:oy+(maxY-y)*s}; };
  fn.scale=s; fn.bbox=bbox; fn.w=w; fn.h=h; fn.pad=pad; fn.kind='lambert'; fn.centerLon=centerLon; fn.centerLat=centerLat; fn.raw=p0;
  return fn;
}
function exportGraticuleStyle(){
  const bs=state.basemapStyle;
  if(bs==='matchaLatte') return {stroke:'rgba(106,128,96,.24)', dash:'4 7', label:'rgba(78,96,72,.52)'};
  if(bs==='paper') return {stroke:'rgba(116,107,88,.18)', dash:'4 7', label:'rgba(96,92,83,.48)'};
  if(bs==='cold') return {stroke:'rgba(68,100,119,.18)', dash:'4 7', label:'rgba(59,86,103,.48)'};
  if(bs==='darkOcean') return {stroke:'rgba(203,222,236,.20)', dash:'4 7', label:'rgba(213,231,242,.58)'};
  return {stroke:'rgba(79,98,106,.18)', dash:'4 7', label:'rgba(71,87,96,.50)'};
}
async function exportHydroSvg(project,bbox){
  try{
    const rivers=await loadJson(state.manifest.layers.hydro.rivers);
    const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
    const northCapPath=state.manifest?.layers?.north_ocean_cap ? state.manifest.layers.north_ocean_cap : 'data/reference/north_ocean_cap.geojson';
    let northCap=null;
    try{ northCap=await loadJson(northCapPath); }catch(_){ northCap=null; }
    const showReservoirs=Number(state.year)>=1959;
    const vars=styleVars();
    const capPaths=(northCap?.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.88" stroke="none"/>`).join('');
    const waterPaths=(waterRaw.features||[]).filter(f=>(showReservoirs || !isReservoirFeature(f) || isAlwaysVisibleWaterFeature(f)) && featureIntersectsBBox(f,bbox)).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.86" stroke="${vars.waterLine}" stroke-width="0.65" stroke-opacity="0.68"/>`).join('');
    const riverPaths=(rivers.features||[]).filter(f=>featureIntersectsBBox(f,bbox)).slice(0,3500).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="${vars.river}" stroke-width="0.78" stroke-opacity="0.62"/>`).join('');
    return `<g class="export-hydro"><g>${capPaths}${waterPaths}</g><g>${riverPaths}</g></g>`;
  }catch(e){ console.warn('export hydro svg skipped',e); return ''; }
}
function exportLabelWeight(p){
  const pop=Number(p.population)||0;
  const area=Number(p.area_km2)||0;
  return pop>0 ? pop : area*2;
}
function exportLabelPoint(feature){
  if(!feature) return null;
  const geom=feature.geometry;
  return featureVisualCenter(geom);
}
function exportAdminLabelsSvg(features, project, w, h){
  const sorted=[...(features||[])].map(f=>({f,p:f.properties||{},c:exportLabelPoint(f)})).filter(x=>x.c).sort((a,b)=>exportLabelWeight(b.p)-exportLabelWeight(a.p));
  const placed=[]; const labels=[];
  const labelMode=state.export.labelMode || 'balanced';
  const limit=labelMode==='major'?18:labelMode==='dense'?120:56;
  sorted.forEach((it,idx)=>{
    if(idx>=limit) return;
    const name=cleanAdminLabelName(it.p.name || it.p.unit_name || it.p.admin_name || ''); if(!name) return;
    const pt=project(it.c[0],it.c[1]);
    const major=idx<10;
    const fs=major?13:(idx<28?11.4:10);
    const tw=Math.min(178, Math.max(54, name.length*fs*0.56));
    const th=fs+9;
    const box={left:pt.x-tw/2,right:pt.x+tw/2,top:pt.y-th/2,bottom:pt.y+th/2};
    if(box.left<8||box.right>w-8||box.top<8||box.bottom>h-8) return;
    if(placed.some(q=>!(box.right<q.left || box.left>q.right || box.bottom<q.top || box.top>q.bottom))) return;
    placed.push(box);
    labels.push(`<g class="export-admin-label" filter="url(#labelShadow)"><rect x="${box.left.toFixed(1)}" y="${box.top.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="6" fill="rgba(255,255,255,.84)" stroke="rgba(75,80,74,.18)"/><text x="${pt.x.toFixed(1)}" y="${(pt.y+fs*.35).toFixed(1)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${fs}" font-weight="${major?800:700}" fill="#27323d">${escapeHtml(name)}</text></g>`);
  });
  return `<g class="export-labels">${labels.join('')}</g>`;
}
async function exportGraticuleSvg(project,w,h,bbox){
  const style=exportGraticuleStyle();
  try{
    const gr=state.manifest?.layers?.graticules_10 ? await loadJson(state.manifest.layers.graticules_10) : null;
    if(gr?.features?.length){
      const paths=gr.features.filter(f=>featureIntersectsBBox(f,bbox)).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="${style.stroke}" stroke-width="0.65" stroke-dasharray="${style.dash}"/>`).join('');
      return `<g class="export-graticule">${paths}</g>`;
    }
  }catch(e){ console.warn('external graticule skipped',e); }
  const [minLon,minLat,maxLon,maxLat]=bbox; const paths=[];
  for(let lon=Math.ceil(minLon/10)*10; lon<=maxLon; lon+=10){ const pts=[]; for(let lat=minLat; lat<=maxLat; lat+=(maxLat-minLat)/44){ const p=project(lon,lat); pts.push(`${pts.length?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`); } paths.push(`<path d="${pts.join(' ')}" fill="none" stroke="${style.stroke}" stroke-width="0.65" stroke-dasharray="${style.dash}"/>`); }
  for(let lat=Math.ceil(minLat/10)*10; lat<=maxLat; lat+=10){ const pts=[]; for(let lon=minLon; lon<=maxLon; lon+=(maxLon-minLon)/44){ const p=project(lon,lat); pts.push(`${pts.length?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`); } paths.push(`<path d="${pts.join(' ')}" fill="none" stroke="${style.stroke}" stroke-width="0.65" stroke-dasharray="${style.dash}"/>`); }
  return `<g class="export-graticule">${paths.join('')}</g>`;
}
function exportGraticuleLabelsSvg(project,w,h,bbox){
  const style=exportGraticuleStyle();
  const [minLon,minLat,maxLon,maxLat]=bbox; const labels=[];
  for(let lon=Math.ceil(minLon/10)*10; lon<=maxLon; lon+=10){
    const p=project(lon, minLat+(maxLat-minLat)*0.04);
    if(p.x>32 && p.x<w-32) labels.push(`<text class="export-degree-label" x="${p.x.toFixed(1)}" y="${h-12}" text-anchor="middle" fill="${style.label}">${Math.abs(lon)}°${lon>=0?'E':'W'}</text>`);
  }
  for(let lat=Math.ceil(minLat/10)*10; lat<=maxLat; lat+=10){
    const p=project(minLon+(maxLon-minLon)*0.04, lat);
    if(p.y>24 && p.y<h-24) labels.push(`<text class="export-degree-label" x="12" y="${(p.y+4).toFixed(1)}" text-anchor="start" fill="${style.label}">${Math.abs(lat)}°${lat>=0?'N':'S'}</text>`);
  }
  return `<g class="export-graticule-labels">${labels.join('')}</g>`;
}
function initExportOverlayDrag(){
  const frame=document.querySelector('.export-map-frame-v38'); if(!frame) return;
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    const head=card.querySelector('.export-map-card-head') || card;
    head.addEventListener('pointerdown', ev=>{
      if(ev.target.closest('.export-map-card-body') && !ev.target.closest('.export-map-card-head')) return;
      ev.preventDefault();
      const f=frame.getBoundingClientRect(); const r=card.getBoundingClientRect();
      const key=card.dataset.exportWidget; const dx=ev.clientX-r.left, dy=ev.clientY-r.top;
      const move=e=>{
        const maxX=f.width-r.width-8, maxY=f.height-r.height-8;
        const left=Math.max(8, Math.min(maxX, e.clientX-f.left-dx));
        const top=Math.max(8, Math.min(maxY, e.clientY-f.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px'; card.style.right='auto'; card.style.bottom='auto';
        state.export.overlayPositions[key]={left:Math.round(left), top:Math.round(top)};
      };
      const up=()=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    }, {passive:false});
  });
}
function initExportMapInteraction(){
  const frame=document.querySelector('.export-map-frame-v38');
  const box=$('exportSvgMap');
  if(!frame || !box || box.dataset.boundPanZoom==='1'){
    const nav=frame?.querySelector('.export-map-nav');
    if(nav && nav.dataset.boundNav!=='1'){
      nav.dataset.boundNav='1';
      nav.addEventListener('click', e=>{
        const btn=e.target.closest('button[data-export-nav]'); if(!btn) return;
        ensureExportFlags();
        const act=btn.dataset.exportNav;
        if(act==='zoom-in') state.export.mapViewport.zoom=Math.min(2.4,(Number(state.export.mapViewport.zoom)||1)+0.12);
        else if(act==='zoom-out') state.export.mapViewport.zoom=Math.max(1,(Number(state.export.mapViewport.zoom)||1)-0.12);
        else if(act==='reset') state.export.mapViewport={x:0,y:0,zoom:1};
        renderExportPreviewCard();
      });
    }
    return;
  }
  box.dataset.boundPanZoom='1';
  box.addEventListener('wheel', e=>{
    if(e.target.closest('.export-map-card')) return;
    e.preventDefault();
    ensureExportFlags();
    const dir=e.deltaY<0 ? 1 : -1;
    const next=(Number(state.export.mapViewport.zoom)||1) + dir*0.1;
    state.export.mapViewport=exportViewportClamp(exportMapSize().w, exportMapSize().h, next, state.export.mapViewport.x, state.export.mapViewport.y);
    renderExportPreviewCard();
  }, {passive:false});
  box.addEventListener('pointerdown', e=>{
    if(e.target.closest('.export-map-card') || e.target.closest('.export-map-nav')) return;
    ensureExportFlags();
    const startX=e.clientX, startY=e.clientY;
    const start={...state.export.mapViewport};
    box.style.cursor='grabbing';
    const move=ev=>{
      const nx=start.x + (ev.clientX-startX);
      const ny=start.y + (ev.clientY-startY);
      state.export.mapViewport=exportViewportClamp(exportMapSize().w, exportMapSize().h, start.zoom, nx, ny);
      renderExportPreviewCard();
    };
    const up=()=>{ box.style.cursor='grab'; document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); };
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',up);
  });
  box.style.cursor='grab';
  const nav=frame.querySelector('.export-map-nav');
  if(nav && nav.dataset.boundNav!=='1'){
    nav.dataset.boundNav='1';
    nav.addEventListener('click', e=>{
      const btn=e.target.closest('button[data-export-nav]'); if(!btn) return;
      ensureExportFlags();
      const act=btn.dataset.exportNav;
      if(act==='zoom-in') state.export.mapViewport.zoom=Math.min(2.4,(Number(state.export.mapViewport.zoom)||1)+0.12);
      else if(act==='zoom-out') state.export.mapViewport.zoom=Math.max(1,(Number(state.export.mapViewport.zoom)||1)-0.12);
      else if(act==='reset') state.export.mapViewport={x:0,y:0,zoom:1};
      renderExportPreviewCard();
    });
  }
}
function exportLegendHtml(){
  let html = $('legendBox')?.innerHTML || '';
  html = html.replace(/^\s*<b>Легенда<\/b>/i,'');
  return `<div class="export-legend-wrap">${html}</div>`;
}


/* v39 overrides: export map pan/zoom without rerender, unclipped hydrography, dynamic scale, uniform labels */
function ensureExportFlags(){
  if(typeof state.export.showGraticule !== 'boolean') state.export.showGraticule=true;
  if(typeof state.export.showScale !== 'boolean') state.export.showScale=true;
  if(typeof state.export.showAdmin !== 'boolean') state.export.showAdmin=true;
  if(typeof state.export.showHydro !== 'boolean') state.export.showHydro=true;
  if(typeof state.export.showRailways !== 'boolean') state.export.showRailways=true;
  if(typeof state.export.showPopulation !== 'boolean') state.export.showPopulation=true;
  if(typeof state.export.showLabels !== 'boolean') state.export.showLabels=true;
  if(!state.export.paper) state.export.paper='a4Landscape';
  if(!state.export.template) state.export.template='thesis';
  state.export.projection='lambert';
  if(!state.export.centralMeridian) state.export.centralMeridian=75;
  if(!state.export.labelMode) state.export.labelMode='balanced';
  if(!Number.isFinite(Number(state.export.minPopulation))) state.export.minPopulation=0;
  if(!Number.isFinite(Number(state.export.minArea))) state.export.minArea=0;
  if(!state.export.overlayPositions) state.export.overlayPositions={};
  if(!state.export.mapViewport || typeof state.export.mapViewport!=='object') state.export.mapViewport={x:0,y:0,zoom:1.28};
  if(!Number.isFinite(Number(state.export.mapViewport.x))) state.export.mapViewport.x=0;
  if(!Number.isFinite(Number(state.export.mapViewport.y))) state.export.mapViewport.y=0;
  if(!Number.isFinite(Number(state.export.mapViewport.zoom))) state.export.mapViewport.zoom=1.28;
  if(Number(state.export.mapViewport.zoom)<1.18) state.export.mapViewport.zoom=1.28;
}
function exportViewportClamp(w,h,zoom,x,y){
  const z=Math.max(1.18, Math.min(2.8, Number(zoom)||1.28));
  const limX=Math.max(30, (w*(z-1))/2 + 160);
  const limY=Math.max(30, (h*(z-1))/2 + 160);
  return {zoom:z, x:Math.max(-limX, Math.min(limX, Number(x)||0)), y:Math.max(-limY, Math.min(limY, Number(y)||0))};
}
function exportMapBodyTransform(w,h){
  ensureExportFlags();
  const vp=exportViewportClamp(w,h,state.export.mapViewport.zoom,state.export.mapViewport.x,state.export.mapViewport.y);
  state.export.mapViewport=vp;
  const cx=w/2, cy=h/2;
  return `translate(${vp.x.toFixed(1)} ${vp.y.toFixed(1)}) translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${vp.zoom.toFixed(4)}) translate(${-cx.toFixed(1)} ${-cy.toFixed(1)})`;
}
function exportExpandedGeoBBox(features){
  const bbox=geoBBoxFromFeatures(features);
  const [minX,minY,maxX,maxY]=bbox;
  const dx=Math.max(0.1,maxX-minX), dy=Math.max(0.1,maxY-minY);
  const out=[minX-dx*0.32, Math.max(-84,minY-dy*0.22), maxX+dx*0.32, Math.min(89,maxY+dy*0.42)];
  out[1]=Math.min(out[1], 42.0);
  out[3]=Math.max(out[3], 83.5);
  return out;
}
async function buildExportSvgMap(){
  const {w,h}=exportMapSize();
  const features=exportScopeFeatures();
  const bbox=exportExpandedGeoBBox(features);
  const projection=makeExportProjection(bbox, w, h, 56);
  const centerLat=(bbox[1]+bbox[3])/2, centerLon=(bbox[0]+bbox[2])/2;
  const p1=projection(centerLon, centerLat), p2=projection(centerLon+1, centerLat);
  const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.cos(centerLat*Math.PI/180);
  const kmPerPx=kmPerDeg/pxPerDeg;
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)) : [];
  const parts=[];
  const bodyTransform=exportMapBodyTransform(w,h);
  parts.push(`<svg class="export-map-svg" data-map-w="${w}" data-map-h="${h}" data-base-km-per-px="${kmPerPx}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="0" y="0" width="${w}" height="${h}" rx="18" ry="18"/></clipPath><filter id="labelShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="${exportBasemapFill()}"/><g clip-path="url(#exportMapClip)"><g id="exportMapBody" class="export-map-body" transform="${bodyTransform}">`);
  if(state.export.showGraticule) parts.push(await exportGraticuleSvg(projection,w,h,bbox));
  if(state.export.showHydro) parts.push(await exportHydroSvg(projection,bbox));
  if(state.export.showAdmin) parts.push(exportAdminPolygonsSvg(features, projection, vals));
  if(state.export.showRailways) parts.push(await exportRailSvg(projection,bbox));
  if(state.export.showPopulation) parts.push(exportPopulationCirclesSvg(features, projection));
  if(state.export.showLabels && state.export.labelMode!=='none') parts.push(exportAdminLabelsSvg(features, projection, w, h));
  if(state.export.showGraticule) parts.push(exportGraticuleLabelsSvg(projection,w,h,bbox));
  parts.push(`</g></g>`);
  if(state.export.showScale) parts.push(`<g id="exportScaleBar">${exportScaleBarSvgFromKmPerPx(kmPerPx/(Number(state.export.mapViewport?.zoom)||1.28), w, h)}</g>`);
  parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.16)" stroke-width="1"/></svg>`);
  return parts.join('');
}
async function exportHydroSvg(project,bbox){
  try{
    const rivers=await loadJson(state.manifest.layers.hydro.rivers);
    const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
    const northCapPath=state.manifest?.layers?.north_ocean_cap ? state.manifest.layers.north_ocean_cap : 'data/reference/north_ocean_cap.geojson';
    let northCap=null;
    try{ northCap=await loadJson(northCapPath); }catch(_){ northCap=null; }
    const showReservoirs=Number(state.year)>=1959;
    const vars=styleVars();
    const capPaths=(northCap?.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.88" stroke="none"/>`).join('');
    const waterPaths=(waterRaw.features||[]).filter(f=>(showReservoirs || !isReservoirFeature(f) || isAlwaysVisibleWaterFeature(f))).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.86" stroke="${vars.waterLine}" stroke-width="0.65" stroke-opacity="0.68"/>`).join('');
    const riverPaths=(rivers.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="${vars.river}" stroke-width="0.78" stroke-opacity="0.62"/>`).join('');
    return `<g class="export-hydro"><g>${capPaths}${waterPaths}</g><g>${riverPaths}</g></g>`;
  }catch(e){ console.warn('export hydro svg skipped',e); return ''; }
}
function exportScaleBarSvgFromKmPerPx(kmPerPx,w,h){
  const targetPx=190;
  const targetKm=Math.max(1,kmPerPx*targetPx);
  const nice=[10,25,50,75,100,150,200,300,500,750,1000,1500,2000,3000].filter(v=>v<=targetKm).pop() || 10;
  const px=Math.max(45,Math.min(360,nice/kmPerPx));
  const x=36, y=h-42;
  return `<line x1="${x}" y1="${y}" x2="${(x+px).toFixed(1)}" y2="${y}" stroke="#253241" stroke-width="3"/><line x1="${x}" y1="${y-6}" x2="${x}" y2="${y+6}" stroke="#253241" stroke-width="2"/><line x1="${(x+px).toFixed(1)}" y1="${y-6}" x2="${(x+px).toFixed(1)}" y2="${y+6}" stroke="#253241" stroke-width="2"/><text x="${(x+px/2).toFixed(1)}" y="${y-10}" text-anchor="middle" font-size="12" font-weight="800" fill="#253241">${nice} км</text>`;
}
function exportScaleBarSvg(project,w,h,bbox){
  const centerLat=(bbox[1]+bbox[3])/2, centerLon=(bbox[0]+bbox[2])/2;
  const p1=project(centerLon, centerLat), p2=project(centerLon+1, centerLat);
  const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.cos(centerLat*Math.PI/180);
  const z=Number(state.export.mapViewport?.zoom)||1.28;
  return `<g id="exportScaleBar">${exportScaleBarSvgFromKmPerPx((kmPerDeg/pxPerDeg)/z,w,h)}</g>`;
}
function exportUnitOrder(p){
  const unit=String(p?.unit_type||p?.type||'').toLowerCase();
  const name=String(p?.name||'').toLowerCase();
  const text=unit+' '+name;
  if(/губерни|област|край|республик/.test(text)) return 'upper';
  if(/округ/.test(text)) return 'district';
  if(/уезд/.test(text)) return 'uezd';
  if(/район/.test(text)) return 'raion';
  return 'default';
}
function exportLabelStyleForOrder(order){
  if(order==='upper') return {fs:12.2, fw:760, boxPad:9};
  if(order==='district') return {fs:11.4, fw:760, boxPad:8};
  if(order==='uezd') return {fs:10.9, fw:760, boxPad:8};
  if(order==='raion') return {fs:10.6, fw:760, boxPad:8};
  return {fs:10.8, fw:760, boxPad:8};
}
function exportAdminLabelsSvg(features, project, w, h){
  const sorted=[...(features||[])].map(f=>({f,p:f.properties||{},c:exportLabelPoint(f)})).filter(x=>x.c).sort((a,b)=>exportLabelWeight(b.p)-exportLabelWeight(a.p));
  const placed=[]; const labels=[];
  const labelMode=state.export.labelMode || 'balanced';
  const limit=labelMode==='major'?18:labelMode==='dense'?150:70;
  sorted.forEach((it,idx)=>{
    if(idx>=limit) return;
    const name=cleanAdminLabelName(it.p.name || it.p.unit_name || it.p.admin_name || ''); if(!name) return;
    const st=exportLabelStyleForOrder(exportUnitOrder(it.p));
    const pt=project(it.c[0],it.c[1]);
    const fs=st.fs, tw=Math.min(190, Math.max(58, name.length*fs*0.56)), th=fs+st.boxPad;
    const box={left:pt.x-tw/2,right:pt.x+tw/2,top:pt.y-th/2,bottom:pt.y+th/2};
    if(box.left<8||box.right>w-8||box.top<8||box.bottom>h-8) return;
    if(placed.some(q=>!(box.right<q.left || box.left>q.right || box.bottom<q.top || box.top>q.bottom))) return;
    placed.push(box);
    labels.push(`<g class="export-admin-label export-admin-label-${escapeHtml(exportUnitOrder(it.p))}" filter="url(#labelShadow)"><rect x="${box.left.toFixed(1)}" y="${box.top.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="6" fill="rgba(255,255,255,.84)" stroke="rgba(75,80,74,.18)"/><text x="${pt.x.toFixed(1)}" y="${(pt.y+fs*.35).toFixed(1)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${fs}" font-weight="${st.fw}" fill="#27323d">${escapeHtml(name)}</text></g>`);
  });
  return `<g class="export-labels">${labels.join('')}</g>`;
}
function applyExportViewportTransformOnly(){
  ensureExportFlags();
  const svg=$('exportSvgMap')?.querySelector('svg.export-map-svg');
  if(!svg) return;
  const w=Number(svg.dataset.mapW)||exportMapSize().w;
  const h=Number(svg.dataset.mapH)||exportMapSize().h;
  const vp=exportViewportClamp(w,h,state.export.mapViewport.zoom,state.export.mapViewport.x,state.export.mapViewport.y);
  state.export.mapViewport=vp;
  const body=svg.querySelector('#exportMapBody');
  if(body) body.setAttribute('transform', exportMapBodyTransform(w,h));
  const scale=svg.querySelector('#exportScaleBar');
  if(scale){
    const base=Number(svg.dataset.baseKmPerPx)||1;
    scale.innerHTML=exportScaleBarSvgFromKmPerPx(base/(Number(state.export.mapViewport.zoom)||1.28),w,h);
  }
}
function initExportMapInteraction(){
  const frame=document.querySelector('.export-map-frame-v38');
  const box=$('exportSvgMap');
  if(!frame || !box || box.dataset.boundPanZoomV39==='1'){
    const nav=frame?.querySelector('.export-map-nav');
    if(nav && nav.dataset.boundNavV39!=='1'){
      nav.dataset.boundNavV39='1';
      nav.addEventListener('click', e=>{
        const btn=e.target.closest('button[data-export-nav]'); if(!btn) return;
        ensureExportFlags();
        const act=btn.dataset.exportNav;
        if(act==='zoom-in') state.export.mapViewport.zoom=Math.min(2.8,(Number(state.export.mapViewport.zoom)||1.28)+0.14);
        else if(act==='zoom-out') state.export.mapViewport.zoom=Math.max(1.18,(Number(state.export.mapViewport.zoom)||1.28)-0.14);
        else if(act==='reset') state.export.mapViewport={x:0,y:0,zoom:1.28};
        applyExportViewportTransformOnly();
      });
    }
    return;
  }
  box.dataset.boundPanZoomV39='1';
  box.style.cursor='grab';
  box.addEventListener('wheel', e=>{
    if(e.target.closest('.export-map-card')) return;
    e.preventDefault();
    ensureExportFlags();
    const old=Number(state.export.mapViewport.zoom)||1.28;
    const next=old + (e.deltaY<0 ? 0.12 : -0.12);
    const {w,h}=exportMapSize();
    state.export.mapViewport=exportViewportClamp(w,h,next,state.export.mapViewport.x,state.export.mapViewport.y);
    applyExportViewportTransformOnly();
  }, {passive:false});
  box.addEventListener('pointerdown', e=>{
    if(e.target.closest('.export-map-card') || e.target.closest('.export-map-nav')) return;
    ensureExportFlags();
    const startX=e.clientX, startY=e.clientY;
    const start={...state.export.mapViewport};
    box.setPointerCapture?.(e.pointerId);
    box.style.cursor='grabbing';
    const move=ev=>{
      const {w,h}=exportMapSize();
      state.export.mapViewport=exportViewportClamp(w,h,start.zoom,start.x+(ev.clientX-startX),start.y+(ev.clientY-startY));
      applyExportViewportTransformOnly();
    };
    const up=()=>{ box.style.cursor='grab'; document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); };
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',up);
  }, {passive:false});
  const nav=frame.querySelector('.export-map-nav');
  if(nav && nav.dataset.boundNavV39!=='1'){
    nav.dataset.boundNavV39='1';
    nav.addEventListener('click', e=>{
      const btn=e.target.closest('button[data-export-nav]'); if(!btn) return;
      ensureExportFlags();
      const act=btn.dataset.exportNav;
      if(act==='zoom-in') state.export.mapViewport.zoom=Math.min(2.8,(Number(state.export.mapViewport.zoom)||1.28)+0.14);
      else if(act==='zoom-out') state.export.mapViewport.zoom=Math.max(1.18,(Number(state.export.mapViewport.zoom)||1.28)-0.14);
      else if(act==='reset') state.export.mapViewport={x:0,y:0,zoom:1.28};
      applyExportViewportTransformOnly();
    });
  }
}
function renderExportPreviewCard(){
  ensureExportFlags();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const template=state.export.template || 'thesis';
  const paper=state.export.paper || 'a4Landscape';
  wrap.innerHTML=`<article class="export-layout export-layout-v38 export-paper-${paper} export-template-${template}"><header class="export-header export-header-v38"><div class="export-title-block"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p>${exportFilterStatusHtml()}</div><div class="export-header-meta"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div></header><section class="export-main export-main-full"><div class="export-map-frame export-map-frame-v36 export-map-frame-v38"><div id="exportSvgMap" class="export-svg-map"><div class="export-map-placeholder">Формируем карту…</div></div><div class="export-map-nav"><button type="button" data-export-nav="zoom-in">＋</button><button type="button" data-export-nav="zoom-out">－</button><button type="button" data-export-nav="reset">⌂</button></div>${exportOverlayBlocksHtml(features)}</div></section><footer class="export-footer">${escapeHtml(exportSourceCaption())}</footer></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
  initExportMapInteraction();
}


/* v40 overrides: framed export extent, internal graticule labels controls, larger label boxes */
function ensureExportFlags(){
  if(typeof state.export.showGraticule !== 'boolean') state.export.showGraticule=true;
  if(typeof state.export.showGraticuleLabels !== 'boolean') state.export.showGraticuleLabels=true;
  if(!Number.isFinite(Number(state.export.graticuleLabelSize))) state.export.graticuleLabelSize=12;
  if(typeof state.export.showScale !== 'boolean') state.export.showScale=true;
  if(typeof state.export.showAdmin !== 'boolean') state.export.showAdmin=true;
  if(typeof state.export.showHydro !== 'boolean') state.export.showHydro=true;
  if(typeof state.export.showRailways !== 'boolean') state.export.showRailways=true;
  if(typeof state.export.showPopulation !== 'boolean') state.export.showPopulation=true;
  if(typeof state.export.showLabels !== 'boolean') state.export.showLabels=true;
  if(!state.export.paper) state.export.paper='a4Landscape';
  if(!state.export.template) state.export.template='thesis';
  state.export.projection='lambert';
  if(!state.export.centralMeridian) state.export.centralMeridian=75;
  if(!state.export.labelMode) state.export.labelMode='balanced';
  if(!Number.isFinite(Number(state.export.minPopulation))) state.export.minPopulation=0;
  if(!Number.isFinite(Number(state.export.minArea))) state.export.minArea=0;
  if(!state.export.overlayPositions) state.export.overlayPositions={};
  if(!state.export.mapViewport || typeof state.export.mapViewport!=='object') state.export.mapViewport={x:0,y:0,zoom:1.24};
  if(!Number.isFinite(Number(state.export.mapViewport.x))) state.export.mapViewport.x=0;
  if(!Number.isFinite(Number(state.export.mapViewport.y))) state.export.mapViewport.y=0;
  if(!Number.isFinite(Number(state.export.mapViewport.zoom))) state.export.mapViewport.zoom=1.24;
  if(Number(state.export.mapViewport.zoom)<1.12) state.export.mapViewport.zoom=1.24;
}
function ensureExportModal(){
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div');
  modal.id='exportMode'; modal.className='export-modal export-modal-v36'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div><section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle"><aside class="export-controls"><div class="export-controls-head"><div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div><button type="button" class="export-close" aria-label="Закрыть экспорт">×</button></div><label class="control-label" for="exportTitleInput">Название карты</label><input id="exportTitleInput" class="export-text-input" type="text"><label class="control-label" for="exportSubtitleInput">Подзаголовок</label><input id="exportSubtitleInput" class="export-text-input" type="text"><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select><label class="control-label" for="exportPaperSelect">Формат листа</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select><label class="control-label" for="exportTemplateSelect">Режим оформления</label><select id="exportTemplateSelect"><option value="thesis">Карта для диплома</option><option value="article">Карта для статьи</option><option value="presentation">Презентационный слайд</option></select><div class="export-option-grid export-layer-grid"><label><input type="checkbox" id="exportFitScope" checked> Автоцентрирование по охвату</label><label><input type="checkbox" id="exportShowAdmin" checked> Административный слой</label><label><input type="checkbox" id="exportShowHydro" checked> Гидрография и океан</label><label><input type="checkbox" id="exportShowRailways" checked> Железные дороги</label><label><input type="checkbox" id="exportShowPopulation" checked> Круги населения</label><label><input type="checkbox" id="exportShowLabels" checked> Подписи АТЕ</label><label><input type="checkbox" id="exportShowLegend" checked> Условные обозначения</label><label><input type="checkbox" id="exportShowStats" checked> Общая информация</label><label><input type="checkbox" id="exportShowContext" checked> Контекст</label><label><input type="checkbox" id="exportShowGraticule" checked> Градусная сетка</label><label><input type="checkbox" id="exportShowGraticuleLabels" checked> Подписи градусной сетки</label><label><input type="checkbox" id="exportShowScale" checked> Масштабная линейка</label></div><div class="export-filter-controls"><label class="control-label" for="exportLabelModeSelect">Генерализация подписей</label><select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select><label class="control-label" for="exportMinPopRange">Фильтр АТЕ по населению</label><input id="exportMinPopRange" type="range" min="0" max="1000000" step="10000" value="0"><div id="exportMinPopLabel" class="mini-muted">без ограничения</div><label class="control-label" for="exportMinAreaRange">Фильтр АТЕ по площади</label><input id="exportMinAreaRange" type="range" min="0" max="500000" step="5000" value="0"><div id="exportMinAreaLabel" class="mini-muted">без ограничения</div><label class="control-label" for="exportGraticuleLabelSizeRange">Размер подписей градусной сетки</label><input id="exportGraticuleLabelSizeRange" type="range" min="9" max="18" step="1" value="12"><div id="exportGraticuleLabelSizeLabel" class="mini-muted">12 px</div></div><details id="exportContextDetails" class="export-context-box" open><summary>Поясняющий текст</summary><label class="control-label" for="exportContextMode">Режим текста</label><select id="exportContextMode"><option value="short">Краткий</option><option value="long">Развёрнутый</option></select><textarea id="exportContextText" class="export-context-text" rows="5"></textarea></details><div class="button-row export-buttons"><button id="exportFitNow" type="button">Подогнать карту</button><button id="refreshExportPreview" type="button">Обновить превью</button></div><button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button><div class="mini-muted">Внутри рабочего поля можно двигать карту мышью и менять масштаб. Текстовые блоки и легенду можно перетаскивать вокруг картографического поля.</div></aside><div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div></section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportSubtitleInput','input', e=>{ state.export.subtitle=e.target.value; renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(false); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; renderExportPreviewCard(); });
  bind('exportTemplateSelect','change', e=>{ state.export.template=e.target.value; renderExportPreviewCard(); });
  ['Admin','Hydro','Railways','Population','Labels'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportMinPopRange','input', e=>{ state.export.minPopulation=Number(e.target.value)||0; updateExportFilterLabels(); renderExportPreviewCard(); });
  bind('exportMinAreaRange','input', e=>{ state.export.minArea=Number(e.target.value)||0; updateExportFilterLabels(); renderExportPreviewCard(); });
  bind('exportGraticuleLabelSizeRange','input', e=>{ state.export.graticuleLabelSize=Number(e.target.value)||12; if($('exportGraticuleLabelSizeLabel')) $('exportGraticuleLabelSizeLabel').textContent=`${state.export.graticuleLabelSize} px`; renderExportPreviewCard(); });
  bind('exportFitScope','change', e=>{ state.export.fitScope=!!e.target.checked; });
  bind('exportShowLegend','change', e=>{ state.export.showLegend=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowStats','change', e=>{ state.export.showStats=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowContext','change', e=>{ state.export.showContext=!!e.target.checked; if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none'; renderExportPreviewCard(); });
  bind('exportShowGraticule','change', e=>{ state.export.showGraticule=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowGraticuleLabels','change', e=>{ state.export.showGraticuleLabels=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportShowScale','change', e=>{ state.export.showScale=!!e.target.checked; renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('exportFitNow','click', async ()=>{ await refreshExportPreview(true); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(resetTitle || !state.export.subtitle) state.export.subtitle=defaultExportSubtitle(features);
  syncExportContextText();
  const fields={title:'exportTitleInput', subtitle:'exportSubtitleInput', scope:'exportScopeSelect', fit:'exportFitScope', legend:'exportShowLegend', stats:'exportShowStats', context:'exportShowContext', graticule:'exportShowGraticule', graticuleLabels:'exportShowGraticuleLabels', scale:'exportShowScale', admin:'exportShowAdmin', hydro:'exportShowHydro', railways:'exportShowRailways', population:'exportShowPopulation', labels:'exportShowLabels', mode:'exportContextMode', paper:'exportPaperSelect', template:'exportTemplateSelect', labelMode:'exportLabelModeSelect', minPop:'exportMinPopRange', minArea:'exportMinAreaRange', gratSize:'exportGraticuleLabelSizeRange'};
  if($(fields.title)) $(fields.title).value=state.export.title;
  if($(fields.subtitle)) $(fields.subtitle).value=state.export.subtitle;
  if($(fields.scope)) $(fields.scope).value=state.export.scope;
  if($(fields.paper)) $(fields.paper).value=state.export.paper;
  if($(fields.template)) $(fields.template).value=state.export.template;
  if($(fields.labelMode)) $(fields.labelMode).value=state.export.labelMode;
  if($(fields.minPop)) $(fields.minPop).value=String(state.export.minPopulation||0);
  if($(fields.minArea)) $(fields.minArea).value=String(state.export.minArea||0);
  if($(fields.gratSize)) $(fields.gratSize).value=String(state.export.graticuleLabelSize||12);
  if($('exportGraticuleLabelSizeLabel')) $('exportGraticuleLabelSizeLabel').textContent=`${state.export.graticuleLabelSize||12} px`;
  if($(fields.fit)) $(fields.fit).checked=state.export.fitScope;
  if($(fields.legend)) $(fields.legend).checked=state.export.showLegend;
  if($(fields.stats)) $(fields.stats).checked=state.export.showStats;
  if($(fields.context)) $(fields.context).checked=state.export.showContext;
  if($(fields.graticule)) $(fields.graticule).checked=state.export.showGraticule;
  if($(fields.graticuleLabels)) $(fields.graticuleLabels).checked=state.export.showGraticuleLabels;
  if($(fields.scale)) $(fields.scale).checked=state.export.showScale;
  if($(fields.admin)) $(fields.admin).checked=state.export.showAdmin;
  if($(fields.hydro)) $(fields.hydro).checked=state.export.showHydro;
  if($(fields.railways)) $(fields.railways).checked=state.export.showRailways;
  if($(fields.population)) $(fields.population).checked=state.export.showPopulation;
  if($(fields.labels)) $(fields.labels).checked=state.export.showLabels;
  if($(fields.mode)) $(fields.mode).value=state.export.contextMode;
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none';
  if($('exportContextText')) $('exportContextText').value=state.export.contextText;
  updateExportFilterLabels();
}
function exportMapSize(){
  const paper=state.export.paper || 'a4Landscape';
  if(paper==='a4Portrait') return {w:1480,h:2100};
  if(paper==='screen') return {w:2240,h:1280};
  return {w:2100,h:1480};
}
function exportMapFieldRect(w,h){
  const paper=state.export.paper || 'a4Landscape';
  if(paper==='a4Portrait') return {x:260,y:240,w:w-520,h:h-400};
  if(paper==='screen') return {x:360,y:180,w:w-720,h:h-300};
  return {x:350,y:170,w:w-700,h:h-280};
}
function exportExpandedGeoBBox(features){
  const bbox=geoBBoxFromFeatures(features);
  const [minX,minY,maxX,maxY]=bbox;
  const centerLat=(minY+maxY)/2;
  const latPad=Math.max(2, 100/111.32);
  const lonPad=Math.max(2, 100/(111.32*Math.max(0.25, Math.cos(centerLat*Math.PI/180))));
  return [Math.max(-180,minX-lonPad), Math.max(-84,minY-latPad), Math.min(180,maxX+lonPad), Math.min(89,maxY+latPad)];
}
function exportViewportClamp(w,h,zoom,x,y){
  const field=exportMapFieldRect(w,h);
  const z=Math.max(1.12, Math.min(2.75, Number(zoom)||1.24));
  const limX=Math.max(35, (field.w*(z-1))/2 + 150);
  const limY=Math.max(35, (field.h*(z-1))/2 + 150);
  return {zoom:z, x:Math.max(-limX, Math.min(limX, Number(x)||0)), y:Math.max(-limY, Math.min(limY, Number(y)||0))};
}
function exportMapBodyTransform(w,h){
  ensureExportFlags();
  const field=exportMapFieldRect(w,h);
  const vp=exportViewportClamp(w,h,state.export.mapViewport.zoom,state.export.mapViewport.x,state.export.mapViewport.y);
  state.export.mapViewport=vp;
  const cx=field.x+field.w/2, cy=field.y+field.h/2;
  return `translate(${vp.x.toFixed(1)} ${vp.y.toFixed(1)}) translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${vp.zoom.toFixed(4)}) translate(${-cx.toFixed(1)} ${-cy.toFixed(1)})`;
}
function exportOverlayBlocksHtml(features){
  const blocks=[];
  const titleHtml=`<div class="export-title-block"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p>${exportFilterStatusHtml()}</div><div class="export-header-meta"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div>`;
  blocks.push(exportDraggableBlock('title','', `<div class="export-title-card-inner">${titleHtml}</div>`));
  if(state.export.showContext){ blocks.push(exportDraggableBlock('context','', `<div class="export-context-plain">${escapeHtml(state.export.contextText || '')}</div>`)); }
  if(state.export.showStats){ blocks.push(exportDraggableBlock('stats','', `<div class="export-stats-plain">${exportStatsHtml(features)}</div>`)); }
  if(state.export.showLegend){ blocks.push(exportDraggableBlock('legend','', `<div class="export-legend-plain">${exportLegendHtml()}</div>`)); }
  return blocks.join('');
}
function exportDraggableBlock(key,title,body){
  const field=exportMapFieldRect(exportMapSize().w, exportMapSize().h);
  const defaults={title:{left:26,top:18}, context:{left:26,top:field.y+16}, stats:{right:22,top:field.y+16}, legend:{right:22,bottom:22}};
  const pos=state.export.overlayPositions?.[key] || defaults[key] || {left:18,top:18};
  const parts=[];
  if(pos.left!=null) parts.push(`left:${Number(pos.left)||0}px`);
  if(pos.top!=null) parts.push(`top:${Number(pos.top)||0}px`);
  if(pos.right!=null) parts.push(`right:${Number(pos.right)||0}px`);
  if(pos.bottom!=null) parts.push(`bottom:${Number(pos.bottom)||0}px`);
  return `<section class="export-map-card export-map-card-${key}${title?'':' export-map-card-headless'}" data-export-widget="${key}" style="${parts.join(';')}">${title?`<div class="export-map-card-head"><span class="drag-grip">⋮⋮</span><h3>${escapeHtml(title)}</h3></div>`:''}<div class="export-map-card-body">${body}</div></section>`;
}
function renderExportPreviewCard(){
  ensureExportFlags();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const template=state.export.template || 'thesis';
  const paper=state.export.paper || 'a4Landscape';
  wrap.innerHTML=`<article class="export-layout export-layout-v38 export-paper-${paper} export-template-${template}"><section class="export-main export-main-full"><div class="export-map-frame export-map-frame-v36 export-map-frame-v38"><div id="exportSvgMap" class="export-svg-map"><div class="export-map-placeholder">Формируем карту…</div></div><div class="export-map-nav"><button type="button" data-export-nav="zoom-in">＋</button><button type="button" data-export-nav="zoom-out">－</button><button type="button" data-export-nav="reset">⌂</button></div>${exportOverlayBlocksHtml(features)}</div></section><footer class="export-footer">${escapeHtml(exportSourceCaption())}</footer></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
  initExportMapInteraction();
}
function buildExportSvgMap(){
  const {w,h}=exportMapSize();
  const fieldRect=exportMapFieldRect(w,h);
  const features=exportScopeFeatures();
  const bbox=exportExpandedGeoBBox(features);
  const baseProjection=makeExportProjection(bbox, fieldRect.w, fieldRect.h, 0);
  const projection=(lon,lat)=>{ const p=baseProjection(lon,lat); return {x:p.x+fieldRect.x, y:p.y+fieldRect.y}; };
  const centerLat=(bbox[1]+bbox[3])/2, centerLon=(bbox[0]+bbox[2])/2;
  const p1=projection(centerLon, centerLat), p2=projection(centerLon+1, centerLat);
  const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.cos(centerLat*Math.PI/180);
  const kmPerPx=kmPerDeg/pxPerDeg;
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)) : [];
  const parts=[];
  const bodyTransform=exportMapBodyTransform(w,h);
  parts.push(`<svg class="export-map-svg" data-map-w="${w}" data-map-h="${h}" data-base-km-per-px="${kmPerPx}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" ry="10"/></clipPath><filter id="labelShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="#eef3ef"/><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" fill="${exportBasemapFill()}" stroke="rgba(111,123,98,.55)" stroke-width="1.2"/><g clip-path="url(#exportMapClip)"><g id="exportMapBody" class="export-map-body" transform="${bodyTransform}">`);
  if(state.export.showGraticule) parts.push(exportGraticuleSvg(projection,w,h,bbox,fieldRect));
  if(state.export.showHydro) parts.push(exportHydroSvg(projection,bbox));
  if(state.export.showAdmin) parts.push(exportAdminPolygonsSvg(features, projection, vals));
  if(state.export.showRailways) parts.push(exportRailSvg(projection,bbox));
  if(state.export.showPopulation) parts.push(exportPopulationCirclesSvg(features, projection));
  if(state.export.showLabels && state.export.labelMode!=='none') parts.push(exportAdminLabelsSvg(features, projection, w, h));
  parts.push(`</g></g>`);
  if(state.export.showGraticule && state.export.showGraticuleLabels) parts.push(exportGraticuleLabelsSvg(projection,w,h,bbox,fieldRect));
  if(state.export.showScale) parts.push(`<g id="exportScaleBar">${exportScaleBarSvgFromKmPerPx(kmPerPx/(Number(state.export.mapViewport?.zoom)||1.24), w, h, fieldRect)}</g>`);
  parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.16)" stroke-width="1"/></svg>`);
  return parts.join('');
}
function exportScaleBarSvgFromKmPerPx(kmPerPx,w,h,fieldRect){
  const targetPx=180;
  const targetKm=Math.max(1,kmPerPx*targetPx);
  const nice=[10,25,50,75,100,150,200,300,500,750,1000,1500,2000,3000].filter(v=>v<=targetKm).pop() || 10;
  const px=Math.max(45,Math.min(360,nice/kmPerPx));
  const field=fieldRect || exportMapFieldRect(w,h);
  const x=field.x+28, y=field.y+field.h-26;
  return `<line x1="${x}" y1="${y}" x2="${(x+px).toFixed(1)}" y2="${y}" stroke="#253241" stroke-width="3"/><line x1="${x}" y1="${y-6}" x2="${x}" y2="${y+6}" stroke="#253241" stroke-width="2"/><line x1="${(x+px).toFixed(1)}" y1="${y-6}" x2="${(x+px).toFixed(1)}" y2="${y+6}" stroke="#253241" stroke-width="2"/><text x="${(x+px/2).toFixed(1)}" y="${y-10}" text-anchor="middle" font-size="12" font-weight="800" fill="#253241">${nice} км</text>`;
}
function exportGraticuleSvg(project,w,h,bbox,fieldRect){
  const style=exportGraticuleStyle();
  const [minLon,minLat,maxLon,maxLat]=bbox; const paths=[];
  for(let lon=Math.ceil(minLon/10)*10; lon<=maxLon; lon+=10){ const pts=[]; for(let lat=minLat; lat<=maxLat; lat+=(maxLat-minLat)/44){ const p=project(lon,lat); pts.push(`${pts.length?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`); } paths.push(`<path d="${pts.join(' ')}" fill="none" stroke="${style.stroke}" stroke-width="0.65" stroke-dasharray="${style.dash}"/>`); }
  for(let lat=Math.ceil(minLat/10)*10; lat<=maxLat; lat+=10){ const pts=[]; for(let lon=minLon; lon<=maxLon; lon+=(maxLon-minLon)/44){ const p=project(lon,lat); pts.push(`${pts.length?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`); } paths.push(`<path d="${pts.join(' ')}" fill="none" stroke="${style.stroke}" stroke-width="0.65" stroke-dasharray="${style.dash}"/>`); }
  return `<g class="export-graticule">${paths.join('')}</g>`;
}
function exportGraticuleLabelsSvg(project,w,h,bbox,fieldRect){
  const style=exportGraticuleStyle();
  const [minLon,minLat,maxLon,maxLat]=bbox; const labels=[];
  const fs=Math.max(9, Math.min(18, Number(state.export.graticuleLabelSize)||12));
  const field=fieldRect || exportMapFieldRect(w,h);
  for(let lon=Math.ceil(minLon/10)*10; lon<=maxLon; lon+=10){
    const p=project(lon, minLat+(maxLat-minLat)*0.025);
    if(p.x>field.x+22 && p.x<field.x+field.w-22) labels.push(`<text class="export-degree-label" x="${p.x.toFixed(1)}" y="${(field.y+field.h-8).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${style.label}">${Math.abs(lon)}°${lon>=0?'E':'W'}</text>`);
  }
  for(let lat=Math.ceil(minLat/10)*10; lat<=maxLat; lat+=10){
    const p=project(minLon+(maxLon-minLon)*0.025, lat);
    if(p.y>field.y+20 && p.y<field.y+field.h-20) labels.push(`<text class="export-degree-label" x="${(field.x+10).toFixed(1)}" y="${(p.y+fs*0.3).toFixed(1)}" text-anchor="start" font-size="${fs}" fill="${style.label}">${Math.abs(lat)}°${lat>=0?'N':'S'}</text>`);
  }
  return `<g class="export-graticule-labels">${labels.join('')}</g>`;
}
function exportAdminLabelsSvg(features, project, w, h){
  const field=exportMapFieldRect(w,h);
  const sorted=[...(features||[])].map(f=>({f,p:f.properties||{},c:exportLabelPoint(f)})).filter(x=>x.c).sort((a,b)=>exportLabelWeight(b.p)-exportLabelWeight(a.p));
  const placed=[]; const labels=[];
  const labelMode=state.export.labelMode || 'balanced';
  const limit=labelMode==='major'?18:labelMode==='dense'?150:70;
  sorted.forEach((it,idx)=>{
    if(idx>=limit) return;
    const name=cleanAdminLabelName(it.p.name || it.p.unit_name || it.p.admin_name || ''); if(!name) return;
    const st=exportLabelStyleForOrder(exportUnitOrder(it.p));
    let fs=st.fs;
    if(name.length>24) fs*=0.94;
    if(name.length>32) fs*=0.88;
    const pt=project(it.c[0],it.c[1]);
    const tw=Math.min(250, Math.max(74, name.length*fs*0.67 + 18));
    const th=fs + st.boxPad + 6;
    const box={left:pt.x-tw/2,right:pt.x+tw/2,top:pt.y-th/2,bottom:pt.y+th/2};
    if(box.left<field.x+8||box.right>field.x+field.w-8||box.top<field.y+8||box.bottom>field.y+field.h-8) return;
    if(placed.some(q=>!(box.right<q.left || box.left>q.right || box.bottom<q.top || box.top>q.bottom))) return;
    placed.push(box);
    labels.push(`<g class="export-admin-label export-admin-label-${escapeHtml(exportUnitOrder(it.p))}" filter="url(#labelShadow)"><rect x="${box.left.toFixed(1)}" y="${box.top.toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="7" fill="rgba(255,255,255,.90)" stroke="rgba(75,80,74,.18)"/><text x="${pt.x.toFixed(1)}" y="${(pt.y+fs*.33).toFixed(1)}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${fs.toFixed(2)}" font-weight="${st.fw}" fill="#27323d">${escapeHtml(name)}</text></g>`);
  });
  return `<g class="export-labels">${labels.join('')}</g>`;
}
function applyExportViewportTransformOnly(){
  ensureExportFlags();
  const svg=$('exportSvgMap')?.querySelector('svg.export-map-svg');
  if(!svg) return;
  const w=Number(svg.dataset.mapW)||exportMapSize().w;
  const h=Number(svg.dataset.mapH)||exportMapSize().h;
  const vp=exportViewportClamp(w,h,state.export.mapViewport.zoom,state.export.mapViewport.x,state.export.mapViewport.y);
  state.export.mapViewport=vp;
  const body=svg.querySelector('#exportMapBody');
  if(body) body.setAttribute('transform', exportMapBodyTransform(w,h));
  const scale=svg.querySelector('#exportScaleBar');
  if(scale){
    const base=Number(svg.dataset.baseKmPerPx)||1;
    scale.innerHTML=exportScaleBarSvgFromKmPerPx(base/(Number(state.export.mapViewport.zoom)||1.24),w,h,exportMapFieldRect(w,h));
  }
}

/* v41 overrides: restore export composition, fixed cartographic field, draggable blocks, polygon-based inner extent */
function ensureExportFlags(){
  if(!state.export || typeof state.export!=='object') state.export={};
  if(typeof state.export.open !== 'boolean') state.export.open=false;
  if(!state.export.scope) state.export.scope='currentLayer';
  if(!state.export.paper) state.export.paper='a4Landscape';
  if(!state.export.template) state.export.template='thesis';
  if(!state.export.title) state.export.title=defaultExportTitle();
  if(!state.export.subtitle) state.export.subtitle='';
  if(typeof state.export.fitScope !== 'boolean') state.export.fitScope=true;
  if(typeof state.export.showLegend !== 'boolean') state.export.showLegend=true;
  if(typeof state.export.showStats !== 'boolean') state.export.showStats=true;
  if(typeof state.export.showContext !== 'boolean') state.export.showContext=true;
  if(typeof state.export.showGraticule !== 'boolean') state.export.showGraticule=true;
  if(typeof state.export.showGraticuleLabels !== 'boolean') state.export.showGraticuleLabels=true;
  if(typeof state.export.showScale !== 'boolean') state.export.showScale=true;
  if(typeof state.export.showAdmin !== 'boolean') state.export.showAdmin=true;
  if(typeof state.export.showHydro !== 'boolean') state.export.showHydro=true;
  if(typeof state.export.showRailways !== 'boolean') state.export.showRailways=true;
  if(typeof state.export.showPopulation !== 'boolean') state.export.showPopulation=true;
  if(typeof state.export.showLabels !== 'boolean') state.export.showLabels=true;
  if(!state.export.contextMode) state.export.contextMode='short';
  if(!state.export.contextText) syncExportContextText();
  if(!state.export.labelMode) state.export.labelMode='balanced';
  if(!Number.isFinite(Number(state.export.minPopulation))) state.export.minPopulation=0;
  if(!Number.isFinite(Number(state.export.minArea))) state.export.minArea=0;
  if(!Number.isFinite(Number(state.export.graticuleLabelSize))) state.export.graticuleLabelSize=12;
  if(!Number.isFinite(Number(state.export.canvasWidth))) state.export.canvasWidth = state.export.paper==='a4Portrait' ? 1240 : state.export.paper==='screen' ? 1760 : 1480;
  if(!Number.isFinite(Number(state.export.canvasHeight))) state.export.canvasHeight = state.export.paper==='a4Portrait' ? 1680 : state.export.paper==='screen' ? 1040 : 1040;
  if(!state.export.extentBuffer) state.export.extentBuffer={top:200,right:200,bottom:200,left:200};
  ['top','right','bottom','left'].forEach(k=>{ if(!Number.isFinite(Number(state.export.extentBuffer[k]))) state.export.extentBuffer[k]=200; });
  if(!state.export.overlayPositions || typeof state.export.overlayPositions!=='object') state.export.overlayPositions={};
}
function ensureExportModal(){
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div');
  modal.id='exportMode';
  modal.className='export-modal export-modal-v41';
  modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div>
  <section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle">
    <aside class="export-controls">
      <div class="export-controls-head">
        <div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div>
        <button type="button" class="export-close" aria-label="Закрыть экспорт">×</button>
      </div>
      <label class="control-label" for="exportTitleInput">Название карты</label>
      <input id="exportTitleInput" class="export-text-input" type="text">
      <label class="control-label" for="exportSubtitleInput">Подзаголовок</label>
      <input id="exportSubtitleInput" class="export-text-input" type="text">
      <div class="export-form-grid2">
        <div>
          <label class="control-label" for="exportScopeSelect">Охват карты</label>
          <select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select>
        </div>
        <div>
          <label class="control-label" for="exportPaperSelect">Формат листа</label>
          <select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select>
        </div>
      </div>
      <div class="export-form-grid2">
        <div>
          <label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label>
          <input id="exportCanvasWidth" class="export-text-input" type="number" min="900" step="20">
        </div>
        <div>
          <label class="control-label" for="exportCanvasHeight">Высота PNG, px</label>
          <input id="exportCanvasHeight" class="export-text-input" type="number" min="700" step="20">
        </div>
      </div>
      <div class="export-fieldset">
        <div class="export-fieldset-title">Границы картографического поля от выбранных полигонов, км</div>
        <div class="export-form-grid4">
          <div><label class="control-label" for="exportBufferTop">Север</label><input id="exportBufferTop" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferRight">Восток</label><input id="exportBufferRight" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferBottom">Юг</label><input id="exportBufferBottom" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferLeft">Запад</label><input id="exportBufferLeft" class="export-text-input" type="number" min="0" step="10"></div>
        </div>
      </div>
      <div class="export-option-grid export-layer-grid export-layer-grid-v41">
        <label><input type="checkbox" id="exportShowHydro"> Гидрография и океан</label>
        <label><input type="checkbox" id="exportShowAdmin"> Административный слой</label>
        <label><input type="checkbox" id="exportShowRailways"> Железные дороги</label>
        <label><input type="checkbox" id="exportShowPopulation"> Символы населения</label>
        <label><input type="checkbox" id="exportShowLabels"> Подписи АТЕ</label>
        <label><input type="checkbox" id="exportShowGraticule"> Градусная сетка</label>
        <label><input type="checkbox" id="exportShowGraticuleLabels"> Подписи сетки</label>
        <label><input type="checkbox" id="exportShowScale"> Масштабная линейка</label>
        <label><input type="checkbox" id="exportShowLegend"> Легенда</label>
        <label><input type="checkbox" id="exportShowStats"> Общая информация</label>
        <label><input type="checkbox" id="exportShowContext"> Контекст</label>
      </div>
      <div class="export-form-grid2">
        <div>
          <label class="control-label" for="exportLabelModeSelect">Генерализация подписей</label>
          <select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select>
        </div>
        <div>
          <label class="control-label" for="exportGraticuleLabelSizeInput">Размер подписей сетки, px</label>
          <input id="exportGraticuleLabelSizeInput" class="export-text-input" type="number" min="8" max="24" step="1">
        </div>
      </div>
      <details id="exportContextDetails" class="export-context-box" open>
        <summary>Контекст</summary>
        <label class="control-label" for="exportContextMode">Режим текста</label>
        <select id="exportContextMode"><option value="short">Краткий</option><option value="long">Развёрнутый</option></select>
        <textarea id="exportContextText" class="export-context-text" rows="5"></textarea>
      </details>
      <div class="button-row export-buttons">
        <button id="refreshExportPreview" type="button">Обновить превью</button>
      </div>
      <button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button>
      <div class="mini-muted">В превью карта фиксирована. Изменяемыми остаются границы картографического поля через отступы и положение текстовых блоков перетаскиванием.</div>
    </aside>
    <div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportSubtitleInput','input', e=>{ state.export.subtitle=e.target.value; renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(false); });
  bind('exportPaperSelect','change', e=>{
    state.export.paper=e.target.value;
    if(e.target.value==='a4Portrait'){ state.export.canvasWidth=1240; state.export.canvasHeight=1680; }
    else if(e.target.value==='screen'){ state.export.canvasWidth=1760; state.export.canvasHeight=1040; }
    else { state.export.canvasWidth=1480; state.export.canvasHeight=1040; }
    syncExportDefaults(false); renderExportPreviewCard();
  });
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(900, Number(e.target.value)||1480); renderExportPreviewCard(); });
  bind('exportCanvasHeight','input', e=>{ state.export.canvasHeight=Math.max(700, Number(e.target.value)||1040); renderExportPreviewCard(); });
  [['Top','top'],['Right','right'],['Bottom','bottom'],['Left','left']].forEach(([id,key])=>bind(`exportBuffer${id}`,'input', e=>{ state.export.extentBuffer[key]=Math.max(0, Number(e.target.value)||0); renderExportPreviewCard(); }));
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportGraticuleLabelSizeInput','input', e=>{ state.export.graticuleLabelSize=Math.max(8, Math.min(24, Number(e.target.value)||12)); renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(resetTitle || !state.export.subtitle) state.export.subtitle=defaultExportSubtitle(features);
  syncExportContextText();
  const setValue=(id,val)=>{ if($(id)) $(id).value=val; };
  const setChecked=(id,val)=>{ if($(id)) $(id).checked=!!val; };
  setValue('exportTitleInput', state.export.title);
  setValue('exportSubtitleInput', state.export.subtitle);
  setValue('exportScopeSelect', state.export.scope);
  setValue('exportPaperSelect', state.export.paper);
  setValue('exportCanvasWidth', state.export.canvasWidth);
  setValue('exportCanvasHeight', state.export.canvasHeight);
  setValue('exportBufferTop', state.export.extentBuffer.top);
  setValue('exportBufferRight', state.export.extentBuffer.right);
  setValue('exportBufferBottom', state.export.extentBuffer.bottom);
  setValue('exportBufferLeft', state.export.extentBuffer.left);
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>setChecked(`exportShow${name}`, state.export[`show${name}`]));
  setValue('exportLabelModeSelect', state.export.labelMode);
  setValue('exportGraticuleLabelSizeInput', state.export.graticuleLabelSize);
  setValue('exportContextMode', state.export.contextMode);
  if($('exportContextText')) $('exportContextText').value=state.export.contextText || '';
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext ? 'block' : 'none';
}
function exportMapSize(){
  ensureExportFlags();
  return {w: Math.max(900, Number(state.export.canvasWidth)||1480), h: Math.max(700, Number(state.export.canvasHeight)||1040)};
}
function exportMapFieldRect(w,h){
  const top=120;
  const side=Math.max(34, Math.round(w*0.035));
  const bottom=48;
  return {x:side, y:top, w:w-side*2, h:h-top-bottom};
}
function kmToLatDeg(km){ return km/111.32; }
function kmToLonDeg(km, lat){ return km/(111.32*Math.max(0.22, Math.cos((lat||55)*Math.PI/180))); }
function exportExpandedGeoBBox(features){
  const bbox=geoBBoxFromFeatures(features && features.length ? features : (state.rawGeoJSON?.features||[]));
  const [minX,minY,maxX,maxY]=bbox;
  const centerLat=(minY+maxY)/2;
  const b=state.export.extentBuffer || {top:200,right:200,bottom:200,left:200};
  const left=kmToLonDeg(Number(b.left)||200, centerLat);
  const right=kmToLonDeg(Number(b.right)||200, centerLat);
  const top=kmToLatDeg(Number(b.top)||200);
  const bottom=kmToLatDeg(Number(b.bottom)||200);
  return [Math.max(-180,minX-left), Math.max(-84,minY-bottom), Math.min(180,maxX+right), Math.min(89,maxY+top)];
}
function exportOuterFrameRect(w,h){ return {x:14,y:14,w:w-28,h:h-28}; }
function exportDraggableBlock(key, body, extraClass=''){
  const defaults={
    title:{left:10,top:10,width:Math.min(1200, exportMapSize().w-240)},
    context:{left:28,top:118,width:340},
    stats:{right:28,top:118,width:232},
    legend:{right:28,bottom:52,width:288}
  };
  const pos={...(defaults[key]||{}), ...(state.export.overlayPositions?.[key]||{})};
  const styles=[];
  ['left','right','top','bottom','width'].forEach(k=>{ if(pos[k]!=null) styles.push(`${k}:${Number(pos[k])}px`); });
  return `<section class="export-map-card export-map-card-${key} export-map-card-v41 ${extraClass}" data-export-widget="${key}" style="${styles.join(';')}"><div class="export-map-card-body">${body}</div></section>`;
}
function exportOverlayBlocksHtml(features){
  const titleHtml=`<div class="export-title-block-v41"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p></div><div class="export-header-meta-v41"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div>`;
  const blocks=[exportDraggableBlock('title', titleHtml, 'export-title-card-v41')];
  if(state.export.showContext) blocks.push(exportDraggableBlock('context', `<div class="export-context-plain-v41">${escapeHtml(state.export.contextText || '')}</div>`, 'export-context-card-v41'));
  if(state.export.showStats) blocks.push(exportDraggableBlock('stats', `<div class="export-stats-plain-v41">${exportStatsHtml(features)}</div>`, 'export-stats-card-v41'));
  if(state.export.showLegend) blocks.push(exportDraggableBlock('legend', `<div class="export-legend-plain-v41">${exportLegendHtml()}</div>`, 'export-legend-card-v41'));
  return blocks.join('');
}
function renderExportPreviewCard(){
  ensureExportFlags();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const {w,h}=exportMapSize();
  const features=exportScopeFeatures();
  const template=state.export.template || 'thesis';
  const paper=state.export.paper || 'a4Landscape';
  wrap.innerHTML=`<article class="export-layout export-layout-v41 export-paper-${paper} export-template-${template}" style="width:${w}px"><section class="export-main export-main-full"><div class="export-map-frame export-map-frame-v41" style="width:${w}px;height:${h}px"><div id="exportSvgMap" class="export-svg-map export-svg-map-v41"><div class="export-map-placeholder">Формируем карту…</div></div>${exportOverlayBlocksHtml(features)}</div></section><footer class="export-footer export-footer-v41">${escapeHtml(exportSourceCaption())}</footer></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
}
async function buildExportSvgMap(){
  const {w,h}=exportMapSize();
  const fieldRect=exportMapFieldRect(w,h);
  const outer=exportOuterFrameRect(w,h);
  const features=exportScopeFeatures();
  const bbox=exportExpandedGeoBBox(features);
  const baseProjection=makeExportProjection(bbox, fieldRect.w, fieldRect.h, 0);
  const projection=(lon,lat)=>{ const p=baseProjection(lon,lat); return {x:p.x+fieldRect.x, y:p.y+fieldRect.y}; };
  const centerLat=(bbox[1]+bbox[3])/2, centerLon=(bbox[0]+bbox[2])/2;
  const p1=projection(centerLon, centerLat), p2=projection(centerLon+1, centerLat);
  const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.cos(centerLat*Math.PI/180);
  const kmPerPx=kmPerDeg/pxPerDeg;
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)) : [];
  const parts=[];
  parts.push(`<svg class="export-map-svg export-map-svg-v41" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClipV41"><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" ry="10"/></clipPath><filter id="labelShadowV41" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs>`);
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#fbfaf5"/><rect x="${outer.x}" y="${outer.y}" width="${outer.w}" height="${outer.h}" rx="20" fill="#eff5ef" stroke="rgba(126,133,116,.32)" stroke-width="1.2"/>`);
  parts.push(`<rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="9" fill="${exportBasemapFill()}" stroke="rgba(128,128,120,.35)" stroke-width="1.05"/>`);
  parts.push(`<g clip-path="url(#exportMapClipV41)">`);
  if(state.export.showGraticule) parts.push(exportGraticuleSvg(projection,w,h,bbox,fieldRect));
  if(state.export.showHydro) parts.push(await exportHydroSvg(projection,bbox));
  if(state.export.showAdmin) parts.push(exportAdminPolygonsSvg(features, projection, vals));
  if(state.export.showRailways) parts.push(await exportRailSvg(projection,bbox));
  if(state.export.showPopulation) parts.push(exportPopulationCirclesSvg(features, projection));
  if(state.export.showLabels && state.export.labelMode!=='none') parts.push(exportAdminLabelsSvg(features, projection, w, h).replace(/labelShadow/g,'labelShadowV41'));
  parts.push(`</g>`);
  if(state.export.showGraticule && state.export.showGraticuleLabels) parts.push(exportGraticuleLabelsSvg(projection,w,h,bbox,fieldRect));
  if(state.export.showScale) parts.push(exportScaleBarSvgFromKmPerPx(kmPerPx, w, h, fieldRect));
  parts.push(`</svg>`);
  return parts.join('');
}
function exportGraticuleLabelsSvg(project,w,h,bbox,fieldRect){
  const style=exportGraticuleStyle();
  const [minLon,minLat,maxLon,maxLat]=bbox; const labels=[];
  const fs=Math.max(8, Math.min(24, Number(state.export.graticuleLabelSize)||12));
  const field=fieldRect || exportMapFieldRect(w,h);
  for(let lon=Math.ceil(minLon/10)*10; lon<=maxLon; lon+=10){
    const pTop=project(lon, maxLat-(maxLat-minLat)*0.03);
    const pBottom=project(lon, minLat+(maxLat-minLat)*0.03);
    if(pTop.x>field.x+26 && pTop.x<field.x+field.w-26){
      labels.push(`<text class="export-degree-label" x="${pTop.x.toFixed(1)}" y="${(field.y+fs+3).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${style.label}">${Math.abs(lon)}°</text>`);
      labels.push(`<text class="export-degree-label" x="${pBottom.x.toFixed(1)}" y="${(field.y+field.h-8).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${style.label}">${Math.abs(lon)}°</text>`);
    }
  }
  for(let lat=Math.ceil(minLat/10)*10; lat<=maxLat; lat+=10){
    const pLeft=project(minLon+(maxLon-minLon)*0.03, lat);
    const pRight=project(maxLon-(maxLon-minLon)*0.03, lat);
    if(pLeft.y>field.y+18 && pLeft.y<field.y+field.h-18){
      labels.push(`<text class="export-degree-label" x="${(field.x+8).toFixed(1)}" y="${(pLeft.y+fs*0.32).toFixed(1)}" text-anchor="start" font-size="${fs}" fill="${style.label}">${Math.abs(lat)}°</text>`);
      labels.push(`<text class="export-degree-label" x="${(field.x+field.w-8).toFixed(1)}" y="${(pRight.y+fs*0.32).toFixed(1)}" text-anchor="end" font-size="${fs}" fill="${style.label}">${Math.abs(lat)}°</text>`);
    }
  }
  return `<g class="export-graticule-labels">${labels.join('')}</g>`;
}
function initExportOverlayDrag(){
  const frame=document.querySelector('.export-map-frame-v41'); if(!frame) return;
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBound==='1') return;
    card.dataset.dragBound='1';
    card.addEventListener('pointerdown', ev=>{
      if(ev.target.closest('input,textarea,select,button,a')) return;
      ev.preventDefault();
      const f=frame.getBoundingClientRect(); const r=card.getBoundingClientRect();
      const key=card.dataset.exportWidget; const dx=ev.clientX-r.left, dy=ev.clientY-r.top;
      const move=e=>{
        const maxX=f.width-r.width-10, maxY=f.height-r.height-10;
        const left=Math.max(10, Math.min(maxX, e.clientX-f.left-dx));
        const top=Math.max(10, Math.min(maxY, e.clientY-f.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px'; card.style.right='auto'; card.style.bottom='auto';
        state.export.overlayPositions[key]={left:Math.round(left), top:Math.round(top), width: card.offsetWidth};
      };
      const up=()=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    }, {passive:false});
  });
}
function initExportMapInteraction(){ return; }

/* v42 overrides: page paddings, cartographic field sizing, compact thesis context */
function ensureExportFlags(){
  if(!state.export || typeof state.export!=='object') state.export={};
  if(typeof state.export.open !== 'boolean') state.export.open=false;
  if(!state.export.scope) state.export.scope='currentLayer';
  if(!state.export.paper) state.export.paper='a4Landscape';
  if(!state.export.template) state.export.template='thesis';
  if(!state.export.title) state.export.title=defaultExportTitle();
  if(!state.export.subtitle) state.export.subtitle='';
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k=>{
    if(typeof state.export[k] !== 'boolean') state.export[k]=true;
  });
  if(!state.export.contextMode) state.export.contextMode='auto';
  if(!state.export.contextText) syncExportContextText();
  if(!state.export.labelMode) state.export.labelMode='balanced';
  if(!Number.isFinite(Number(state.export.graticuleLabelSize))) state.export.graticuleLabelSize=12;
  if(!Number.isFinite(Number(state.export.canvasWidth))) state.export.canvasWidth = state.export.paper==='a4Portrait' ? 1240 : state.export.paper==='screen' ? 1760 : 1480;
  if(!Number.isFinite(Number(state.export.canvasHeight))) state.export.canvasHeight = state.export.paper==='a4Portrait' ? 1680 : state.export.paper==='screen' ? 1040 : 1040;
  if(!state.export.extentBuffer) state.export.extentBuffer={top:200,right:200,bottom:200,left:200};
  if(!state.export.pagePadding) state.export.pagePadding={top:16,right:16,bottom:16,left:16};
  if(!state.export.fieldPadding) state.export.fieldPadding={top:110,right:42,bottom:54,left:42};
  ['top','right','bottom','left'].forEach(k=>{
    if(!Number.isFinite(Number(state.export.extentBuffer[k]))) state.export.extentBuffer[k]=200;
    if(!Number.isFinite(Number(state.export.pagePadding[k]))) state.export.pagePadding[k]=16;
    if(!Number.isFinite(Number(state.export.fieldPadding[k]))) state.export.fieldPadding[k]=(k==='top'?110:(k==='bottom'?54:42));
  });
  if(!state.export.overlayPositions || typeof state.export.overlayPositions!=='object') state.export.overlayPositions={};
}
function exportContextAutoText(){
  const preset=exportContextPresets(state.year) || {};
  const source=(state.export.contextText && state.export.contextMode!=='auto') ? state.export.contextText : (preset.long || preset.short || '');
  const cleaned=String(source||'').replace(/\s+/g,' ').trim();
  if(!cleaned) return '';
  const sentences=cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
  let out='';
  for(const sent of sentences){
    const candidate=(out? out+' ' : '') + sent.trim();
    if(candidate.length>220 && out) break;
    out=candidate;
    if(out.length>=150 && /[.!?]$/.test(out)) break;
  }
  if(out.length>230) out=out.slice(0,227).replace(/[,:;\-–—]\s*$/,'').trim()+'…';
  return out || cleaned.slice(0,220);
}
function syncExportContextText(){
  ensureExportFlags();
  const preset=exportContextPresets(state.year);
  if(state.export.contextMode==='short') state.export.contextText=preset.short;
  else if(state.export.contextMode==='long') state.export.contextText=preset.long;
  else state.export.contextText=exportContextAutoText();
  if($('exportContextText')) $('exportContextText').value=state.export.contextText || '';
}
function ensureExportModal(){
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div');
  modal.id='exportMode';
  modal.className='export-modal export-modal-v42';
  modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div>
  <section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle">
    <aside class="export-controls">
      <div class="export-controls-head">
        <div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div>
        <button type="button" class="export-close" aria-label="Закрыть экспорт">×</button>
      </div>
      <label class="control-label" for="exportTitleInput">Название карты</label>
      <input id="exportTitleInput" class="export-text-input" type="text">
      <label class="control-label" for="exportSubtitleInput">Подзаголовок</label>
      <input id="exportSubtitleInput" class="export-text-input" type="text">
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select></div>
        <div><label class="control-label" for="exportPaperSelect">Формат листа</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select></div>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportTemplateSelect">Режим оформления</label><select id="exportTemplateSelect"><option value="thesis">Карта для диплома</option><option value="article">Карта для статьи</option><option value="presentation">Презентационный слайд</option></select></div>
        <div><label class="control-label" for="exportContextMode">Текст контекста</label><select id="exportContextMode"><option value="auto">Авто-компактный</option><option value="short">Краткий</option><option value="long">Развёрнутый</option></select></div>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="900" step="20"></div>
        <div><label class="control-label" for="exportCanvasHeight">Высота PNG, px</label><input id="exportCanvasHeight" class="export-text-input" type="number" min="700" step="20"></div>
      </div>
      <div class="export-fieldset"><div class="export-fieldset-title">Внешняя рамка / рабочее поле, px</div>
        <div class="export-form-grid4">
          <div><label class="control-label" for="exportPagePadTop">Сверху</label><input id="exportPagePadTop" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadRight">Справа</label><input id="exportPagePadRight" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadBottom">Снизу</label><input id="exportPagePadBottom" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadLeft">Слева</label><input id="exportPagePadLeft" class="export-text-input" type="number" min="0" step="2"></div>
        </div>
      </div>
      <div class="export-fieldset"><div class="export-fieldset-title">Размер и положение картографического поля, px</div>
        <div class="export-form-grid4">
          <div><label class="control-label" for="exportFieldPadTop">Верх</label><input id="exportFieldPadTop" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadRight">Право</label><input id="exportFieldPadRight" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadBottom">Низ</label><input id="exportFieldPadBottom" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadLeft">Лево</label><input id="exportFieldPadLeft" class="export-text-input" type="number" min="0" step="2"></div>
        </div>
      </div>
      <div class="export-fieldset"><div class="export-fieldset-title">Отступы экстента от выбранных административных полигонов, км</div>
        <div class="export-form-grid4">
          <div><label class="control-label" for="exportBufferTop">Север</label><input id="exportBufferTop" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferRight">Восток</label><input id="exportBufferRight" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferBottom">Юг</label><input id="exportBufferBottom" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferLeft">Запад</label><input id="exportBufferLeft" class="export-text-input" type="number" min="0" step="10"></div>
        </div>
      </div>
      <div class="export-option-grid export-layer-grid export-layer-grid-v42">
        <label><input type="checkbox" id="exportShowHydro"> Гидрография и океан</label>
        <label><input type="checkbox" id="exportShowAdmin"> Административный слой</label>
        <label><input type="checkbox" id="exportShowRailways"> Железные дороги</label>
        <label><input type="checkbox" id="exportShowPopulation"> Круги населения</label>
        <label><input type="checkbox" id="exportShowLabels"> Подписи АТЕ</label>
        <label><input type="checkbox" id="exportShowGraticule"> Градусная сетка</label>
        <label><input type="checkbox" id="exportShowGraticuleLabels"> Подписи сетки</label>
        <label><input type="checkbox" id="exportShowScale"> Масштабная линейка</label>
        <label><input type="checkbox" id="exportShowLegend"> Легенда</label>
        <label><input type="checkbox" id="exportShowStats"> Общая информация</label>
        <label><input type="checkbox" id="exportShowContext"> Контекст</label>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportLabelModeSelect">Генерализация подписей</label><select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select></div>
        <div><label class="control-label" for="exportGraticuleLabelSizeInput">Размер подписей сетки, px</label><input id="exportGraticuleLabelSizeInput" class="export-text-input" type="number" min="8" max="24" step="1"></div>
      </div>
      <details id="exportContextDetails" class="export-context-box" open>
        <summary>Контекст</summary>
        <textarea id="exportContextText" class="export-context-text" rows="5"></textarea>
      </details>
      <div class="button-row export-buttons"><button id="refreshExportPreview" type="button">Обновить превью</button></div>
      <button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button>
      <div class="mini-muted">Теперь отдельно регулируются: 1) внешняя рабочая рамка экспорта, 2) физические границы картографического поля, 3) географический буфер от выбранных административных полигонов.</div>
    </aside>
    <div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportSubtitleInput','input', e=>{ state.export.subtitle=e.target.value; renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(false); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; if(e.target.value==='a4Portrait'){ state.export.canvasWidth=1240; state.export.canvasHeight=1680; } else if(e.target.value==='screen'){ state.export.canvasWidth=1760; state.export.canvasHeight=1040; } else { state.export.canvasWidth=1480; state.export.canvasHeight=1040; } syncExportDefaults(false); renderExportPreviewCard(); });
  bind('exportTemplateSelect','change', e=>{ state.export.template=e.target.value; if(state.export.contextMode==='auto') syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(900, Number(e.target.value)||1480); renderExportPreviewCard(); });
  bind('exportCanvasHeight','input', e=>{ state.export.canvasHeight=Math.max(700, Number(e.target.value)||1040); renderExportPreviewCard(); });
  [['PagePadTop','pagePadding','top'],['PagePadRight','pagePadding','right'],['PagePadBottom','pagePadding','bottom'],['PagePadLeft','pagePadding','left'],['FieldPadTop','fieldPadding','top'],['FieldPadRight','fieldPadding','right'],['FieldPadBottom','fieldPadding','bottom'],['FieldPadLeft','fieldPadding','left'],['BufferTop','extentBuffer','top'],['BufferRight','extentBuffer','right'],['BufferBottom','extentBuffer','bottom'],['BufferLeft','extentBuffer','left']].forEach(([id,obj,key])=>bind(`export${id}`,'input', e=>{ state.export[obj][key]=Math.max(0, Number(e.target.value)||0); renderExportPreviewCard(); }));
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportGraticuleLabelSizeInput','input', e=>{ state.export.graticuleLabelSize=Math.max(8, Math.min(24, Number(e.target.value)||12)); renderExportPreviewCard(); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(resetTitle || !state.export.subtitle) state.export.subtitle=defaultExportSubtitle(features);
  if(state.export.contextMode==='auto' || resetTitle || !state.export.contextText) syncExportContextText();
  const V=(id,val)=>{ if($(id)) $(id).value=val; }, C=(id,val)=>{ if($(id)) $(id).checked=!!val; };
  V('exportTitleInput',state.export.title); V('exportSubtitleInput',state.export.subtitle); V('exportScopeSelect',state.export.scope); V('exportPaperSelect',state.export.paper); V('exportTemplateSelect',state.export.template); V('exportContextMode',state.export.contextMode); V('exportContextText',state.export.contextText||'');
  V('exportCanvasWidth',state.export.canvasWidth); V('exportCanvasHeight',state.export.canvasHeight);
  ['top','right','bottom','left'].forEach(k=>{ V('exportPagePad'+k.charAt(0).toUpperCase()+k.slice(1), state.export.pagePadding[k]); V('exportFieldPad'+k.charAt(0).toUpperCase()+k.slice(1), state.export.fieldPadding[k]); V('exportBuffer'+k.charAt(0).toUpperCase()+k.slice(1), state.export.extentBuffer[k]); });
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>C(`exportShow${name}`, state.export[`show${name}`]));
  V('exportLabelModeSelect', state.export.labelMode); V('exportGraticuleLabelSizeInput', state.export.graticuleLabelSize);
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext ? 'block' : 'none';
}
function exportMapSize(){ ensureExportFlags(); return {w: Math.max(900, Number(state.export.canvasWidth)||1480), h: Math.max(700, Number(state.export.canvasHeight)||1040)}; }
function exportOuterFrameRect(w,h){
  const p=state.export.pagePadding || {top:16,right:16,bottom:16,left:16};
  return {x:Number(p.left)||0, y:Number(p.top)||0, w:Math.max(200, w-(Number(p.left)||0)-(Number(p.right)||0)), h:Math.max(200, h-(Number(p.top)||0)-(Number(p.bottom)||0))};
}
function exportMapFieldRect(w,h){
  const outer=exportOuterFrameRect(w,h); const p=state.export.fieldPadding || {top:110,right:42,bottom:54,left:42};
  return {x:outer.x+(Number(p.left)||0), y:outer.y+(Number(p.top)||0), w:Math.max(220, outer.w-(Number(p.left)||0)-(Number(p.right)||0)), h:Math.max(220, outer.h-(Number(p.top)||0)-(Number(p.bottom)||0))};
}
function exportDraggableBlock(key, body, extraClass=''){
  const {w,h}=exportMapSize(); const outer=exportOuterFrameRect(w,h);
  const defaults={title:{left:outer.x+10,top:outer.y+8,width:Math.min(1200, outer.w-220)},context:{left:outer.x+28,top:outer.y+112,width:340},stats:{right:16,top:outer.y+112,width:232},legend:{right:16,bottom:22,width:290}};
  const pos={...(defaults[key]||{}), ...(state.export.overlayPositions?.[key]||{})};
  const styles=[]; ['left','right','top','bottom','width'].forEach(k=>{ if(pos[k]!=null) styles.push(`${k}:${Number(pos[k])}px`); });
  return `<section class="export-map-card export-map-card-${key} export-map-card-v42 ${extraClass}" data-export-widget="${key}" style="${styles.join(';')}"><div class="export-map-card-body">${body}</div></section>`;
}
function exportOverlayBlocksHtml(features){
  const contextText = state.export.contextMode==='auto' ? exportContextAutoText() : (state.export.contextText || '');
  const titleHtml=`<div class="export-title-block-v41"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p></div><div class="export-header-meta-v41"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div>`;
  const blocks=[exportDraggableBlock('title', titleHtml, 'export-title-card-v41')];
  if(state.export.showContext) blocks.push(exportDraggableBlock('context', `<div class="export-context-plain-v41">${escapeHtml(contextText)}</div>`, 'export-context-card-v41'));
  if(state.export.showStats) blocks.push(exportDraggableBlock('stats', `<div class="export-stats-plain-v41">${exportStatsHtml(features)}</div>`, 'export-stats-card-v41'));
  if(state.export.showLegend) blocks.push(exportDraggableBlock('legend', `<div class="export-legend-plain-v41">${exportLegendHtml()}</div>`, 'export-legend-card-v41'));
  return blocks.join('');
}
async function buildExportSvgMap(){
  const {w,h}=exportMapSize();
  const outer=exportOuterFrameRect(w,h);
  const fieldRect=exportMapFieldRect(w,h);
  const features=exportScopeFeatures();
  const bbox=exportExpandedGeoBBox(features);
  const baseProjection=makeExportProjection(bbox, fieldRect.w, fieldRect.h, 0);
  const projection=(lon,lat)=>{ const p=baseProjection(lon,lat); return {x:p.x+fieldRect.x, y:p.y+fieldRect.y}; };
  const centerLat=(bbox[1]+bbox[3])/2, centerLon=(bbox[0]+bbox[2])/2;
  const p1=projection(centerLon, centerLat), p2=projection(centerLon+1, centerLat);
  const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.cos(centerLat*Math.PI/180);
  const kmPerPx=kmPerDeg/pxPerDeg;
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)) : [];
  const parts=[];
  parts.push(`<svg class="export-map-svg export-map-svg-v42" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClipV42"><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" ry="10"/></clipPath><filter id="labelShadowV42" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs>`);
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#fbfaf5"/><rect x="${outer.x}" y="${outer.y}" width="${outer.w}" height="${outer.h}" rx="20" fill="#eff5ef" stroke="rgba(126,133,116,.32)" stroke-width="1.2"/><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="9" fill="${exportBasemapFill()}" stroke="rgba(128,128,120,.35)" stroke-width="1.05"/>`);
  parts.push(`<g clip-path="url(#exportMapClipV42)">`);
  if(state.export.showGraticule) parts.push(exportGraticuleSvg(projection,w,h,bbox,fieldRect));
  if(state.export.showHydro) parts.push(await exportHydroSvg(projection,bbox));
  if(state.export.showAdmin) parts.push(exportAdminPolygonsSvg(features, projection, vals));
  if(state.export.showRailways) parts.push(await exportRailSvg(projection,bbox));
  if(state.export.showPopulation) parts.push(exportPopulationCirclesSvg(features, projection));
  if(state.export.showLabels && state.export.labelMode!=='none') parts.push(exportAdminLabelsSvg(features, projection, w, h).replace(/labelShadow/g,'labelShadowV42'));
  parts.push(`</g>`);
  if(state.export.showGraticule && state.export.showGraticuleLabels) parts.push(exportGraticuleLabelsSvg(projection,w,h,bbox,fieldRect));
  if(state.export.showScale) parts.push(exportScaleBarSvgFromKmPerPx(kmPerPx, w, h, fieldRect));
  parts.push(`</svg>`);
  return parts.join('');
}

/* v43 overrides: export layout stabilization, draggable cartographic field, configurable info block, improved hydro hierarchy */
function riverStrokeWeightValue(f){
  const p=f?.properties||{};
  const raw=Number(p.strokeweig ?? p.strokeWeight ?? p.strokeweigh ?? p.weight ?? p.stroke_w ?? 0.45);
  return Number.isFinite(raw) ? raw : 0.45;
}
function riverNormalizedWeight(f, forExport=false){
  const v=riverStrokeWeightValue(f);
  const min=0.2, max=1.2;
  const t=Math.max(0, Math.min(1, (v-min)/(max-min)));
  return forExport ? (0.65 + Math.pow(t,0.86)*2.15) : (0.8 + Math.pow(t,0.86)*1.55);
}
function riverStyle(f){
  const s=styleVars();
  return {color:s.river, weight:riverNormalizedWeight(f,false), opacity:state.theme==='light'?0.78:0.82, lineCap:'round', lineJoin:'round'};
}
function ensureExportFlags(){
  if(!state.export || typeof state.export!=='object') state.export={};
  if(typeof state.export.open !== 'boolean') state.export.open=false;
  if(!state.export.scope) state.export.scope='currentLayer';
  if(!state.export.paper) state.export.paper='a4Landscape';
  if(!state.export.template) state.export.template='thesis';
  if(!state.export.title) state.export.title=defaultExportTitle();
  if(typeof state.export.subtitle !== 'string') state.export.subtitle='';
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k=>{ if(typeof state.export[k] !== 'boolean') state.export[k]=true; });
  if(!state.export.contextMode) state.export.contextMode='auto';
  if(!state.export.contextText) syncExportContextText();
  if(!state.export.labelMode) state.export.labelMode='balanced';
  if(!Number.isFinite(Number(state.export.graticuleLabelSize))) state.export.graticuleLabelSize=12;
  if(!Number.isFinite(Number(state.export.canvasWidth))) state.export.canvasWidth = state.export.paper==='a4Portrait' ? 1240 : state.export.paper==='screen' ? 1760 : 1480;
  if(!Number.isFinite(Number(state.export.canvasHeight))) state.export.canvasHeight = state.export.paper==='a4Portrait' ? 1680 : state.export.paper==='screen' ? 1040 : 1040;
  if(!state.export.extentBuffer) state.export.extentBuffer={top:200,right:200,bottom:200,left:200};
  if(!state.export.pagePadding) state.export.pagePadding={top:16,right:16,bottom:16,left:16};
  if(!state.export.fieldPadding) state.export.fieldPadding={top:110,right:42,bottom:54,left:42};
  ['top','right','bottom','left'].forEach(k=>{
    if(!Number.isFinite(Number(state.export.extentBuffer[k]))) state.export.extentBuffer[k]=200;
    if(!Number.isFinite(Number(state.export.pagePadding[k]))) state.export.pagePadding[k]=16;
    if(!Number.isFinite(Number(state.export.fieldPadding[k]))) state.export.fieldPadding[k]=(k==='top'?110:(k==='bottom'?54:42));
  });
  if(!state.export.overlayPositions || typeof state.export.overlayPositions!=='object') state.export.overlayPositions={};
  if(!Number.isFinite(Number(state.export.titleFontSize))) state.export.titleFontSize = state.export.template==='presentation' ? 56 : 44;
  if(!Number.isFinite(Number(state.export.panelWidth))) state.export.panelWidth = 300;
  if(!state.export.statsFields || typeof state.export.statsFields!=='object') state.export.statsFields={};
  const statDefaults={objects:true,population:true,area:true,density:true,urbanShare:true,urbanPopulation:false,ruralPopulation:false,avgArea:false,avgPopulation:false,avgDensity:false};
  Object.keys(statDefaults).forEach(k=>{ if(typeof state.export.statsFields[k] !== 'boolean') state.export.statsFields[k]=statDefaults[k]; });
}
function exportStatsItems(features){
  const totalPop=sum(features.map(f=>Number(f.properties?.population)||0));
  const totalArea=sum(features.map(f=>Number(f.properties?.area_km2)||0));
  const density=totalArea ? totalPop/totalArea : null;
  const urban=urbanBreakdown(features);
  const n=features.length || 0;
  return {
    objects:{label:'Объектов', value:num(n)},
    population:{label:'Население', value:num(totalPop)},
    area:{label:'Площадь, км²', value:num(totalArea)},
    density:{label:'Плотность, чел./км²', value:density!=null?num1(density):'—'},
    urbanShare:{label:'Доля городского населения', value:urban.available?pct(urban.urbanShare):'—'},
    urbanPopulation:{label:'Городское население', value:urban.available?num(urban.urbanTotal):'—'},
    ruralPopulation:{label:'Сельское население', value:urban.available?num(urban.ruralTotal):'—'},
    avgArea:{label:'Средняя площадь', value:n?num(Math.round(totalArea/n)):'—'},
    avgPopulation:{label:'Среднее население', value:n?num(Math.round(totalPop/n)):'—'},
    avgDensity:{label:'Средняя плотность', value:(n&&density!=null)?num1(density):'—'}
  };
}
function exportStatsHtml(features){
  ensureExportFlags();
  const items=exportStatsItems(features);
  const order=['objects','population','area','density','urbanShare','urbanPopulation','ruralPopulation','avgArea','avgPopulation','avgDensity'];
  const enabled=order.filter(k=>state.export.statsFields[k]);
  return `<div class="export-info-grid export-info-grid-v43">${enabled.map(k=>`<div class="export-info-card"><span>${items[k].label}</span><b>${items[k].value}</b></div>`).join('')}</div>`;
}
function exportLegendHtml(){
  const src=$('legendBox')?.innerHTML || '';
  const box=document.createElement('div');
  box.innerHTML=src;
  box.querySelectorAll('b,.legend-title,.legend-header').forEach(el=>{ if(/легенда/i.test(el.textContent||'')) el.remove(); });
  return `<div class="export-legend-wrap export-legend-wrap-v43">${box.innerHTML}</div>`;
}
function ensureExportModal(){
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div');
  modal.id='exportMode';
  modal.className='export-modal export-modal-v43';
  modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div>
  <section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle">
    <aside class="export-controls">
      <div class="export-controls-head">
        <div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div>
        <button type="button" class="export-close" aria-label="Закрыть экспорт">×</button>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportTitleInput">Название карты</label><input id="exportTitleInput" class="export-text-input" type="text"></div>
        <div><label class="control-label" for="exportTitleFontSize">Размер заголовка, px</label><input id="exportTitleFontSize" class="export-text-input" type="number" min="24" max="72" step="1"></div>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select></div>
        <div><label class="control-label" for="exportPaperSelect">Формат листа</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select></div>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportTemplateSelect">Режим оформления</label><select id="exportTemplateSelect"><option value="thesis">Карта для диплома</option><option value="article">Карта для статьи</option><option value="presentation">Презентационный слайд</option></select></div>
        <div><label class="control-label" for="exportContextMode">Текст контекста</label><select id="exportContextMode"><option value="auto">Авто-компактный</option><option value="short">Краткий</option><option value="long">Развёрнутый</option></select></div>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="900" step="20"></div>
        <div><label class="control-label" for="exportCanvasHeight">Высота PNG, px</label><input id="exportCanvasHeight" class="export-text-input" type="number" min="700" step="20"></div>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportPanelWidth">Ширина карточек легенды/контекста/сводки, px</label><input id="exportPanelWidth" class="export-text-input" type="number" min="220" max="420" step="2"></div>
        <div><label class="control-label" for="exportGraticuleLabelSizeInput">Размер подписей сетки, px</label><input id="exportGraticuleLabelSizeInput" class="export-text-input" type="number" min="8" max="24" step="1"></div>
      </div>
      <div class="export-fieldset"><div class="export-fieldset-title">Внешняя рамка / рабочее поле, px</div>
        <div class="export-form-grid4">
          <div><label class="control-label" for="exportPagePadTop">Сверху</label><input id="exportPagePadTop" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadRight">Справа</label><input id="exportPagePadRight" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadBottom">Снизу</label><input id="exportPagePadBottom" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadLeft">Слева</label><input id="exportPagePadLeft" class="export-text-input" type="number" min="0" step="2"></div>
        </div>
      </div>
      <div class="export-fieldset"><div class="export-fieldset-title">Картографическое поле, px (можно также перетаскивать рамку в превью)</div>
        <div class="export-form-grid4">
          <div><label class="control-label" for="exportFieldPadTop">Верх</label><input id="exportFieldPadTop" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadRight">Право</label><input id="exportFieldPadRight" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadBottom">Низ</label><input id="exportFieldPadBottom" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadLeft">Лево</label><input id="exportFieldPadLeft" class="export-text-input" type="number" min="0" step="2"></div>
        </div>
      </div>
      <div class="export-fieldset"><div class="export-fieldset-title">Буфер экстента от выбранных административных полигонов, км</div>
        <div class="export-form-grid4">
          <div><label class="control-label" for="exportBufferTop">Север</label><input id="exportBufferTop" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferRight">Восток</label><input id="exportBufferRight" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferBottom">Юг</label><input id="exportBufferBottom" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferLeft">Запад</label><input id="exportBufferLeft" class="export-text-input" type="number" min="0" step="10"></div>
        </div>
      </div>
      <div class="export-option-grid export-layer-grid export-layer-grid-v43">
        <label><input type="checkbox" id="exportShowHydro"> Гидрография и океан</label>
        <label><input type="checkbox" id="exportShowAdmin"> Административный слой</label>
        <label><input type="checkbox" id="exportShowRailways"> Железные дороги</label>
        <label><input type="checkbox" id="exportShowPopulation"> Круги населения</label>
        <label><input type="checkbox" id="exportShowLabels"> Подписи АТЕ</label>
        <label><input type="checkbox" id="exportShowGraticule"> Градусная сетка</label>
        <label><input type="checkbox" id="exportShowGraticuleLabels"> Подписи сетки</label>
        <label><input type="checkbox" id="exportShowScale"> Масштабная линейка</label>
        <label><input type="checkbox" id="exportShowLegend"> Легенда</label>
        <label><input type="checkbox" id="exportShowStats"> Общая информация</label>
        <label><input type="checkbox" id="exportShowContext"> Контекст</label>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportLabelModeSelect">Генерализация подписей</label><select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select></div>
        <div></div>
      </div>
      <details id="exportContextDetails" class="export-context-box" open><summary>Контекст</summary><textarea id="exportContextText" class="export-context-text" rows="5"></textarea></details>
      <details class="export-context-box" open><summary>Содержание блока информации</summary><div class="export-stats-fields" id="exportStatsFieldsBox"></div></details>
      <div class="button-row export-buttons"><button id="refreshExportPreview" type="button">Обновить превью</button></div>
      <button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button>
      <div class="mini-muted">Внешняя рамка задаёт итоговое поле PNG. Картографическое поле строится отдельно и может перетаскиваться внутри него в превью.</div>
    </aside>
    <div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportTitleFontSize','input', e=>{ state.export.titleFontSize=Math.max(24, Math.min(72, Number(e.target.value)||44)); renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(false); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; if(e.target.value==='a4Portrait'){ state.export.canvasWidth=1240; state.export.canvasHeight=1680; } else if(e.target.value==='screen'){ state.export.canvasWidth=1760; state.export.canvasHeight=1040; } else { state.export.canvasWidth=1480; state.export.canvasHeight=1040; } syncExportDefaults(false); renderExportPreviewCard(); });
  bind('exportTemplateSelect','change', e=>{ state.export.template=e.target.value; if(state.export.contextMode==='auto') syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(900, Number(e.target.value)||1480); renderExportPreviewCard(); });
  bind('exportCanvasHeight','input', e=>{ state.export.canvasHeight=Math.max(700, Number(e.target.value)||1040); renderExportPreviewCard(); });
  bind('exportPanelWidth','input', e=>{ state.export.panelWidth=Math.max(220, Math.min(420, Number(e.target.value)||300)); renderExportPreviewCard(); });
  [['PagePadTop','pagePadding','top'],['PagePadRight','pagePadding','right'],['PagePadBottom','pagePadding','bottom'],['PagePadLeft','pagePadding','left'],['FieldPadTop','fieldPadding','top'],['FieldPadRight','fieldPadding','right'],['FieldPadBottom','fieldPadding','bottom'],['FieldPadLeft','fieldPadding','left'],['BufferTop','extentBuffer','top'],['BufferRight','extentBuffer','right'],['BufferBottom','extentBuffer','bottom'],['BufferLeft','extentBuffer','left']].forEach(([id,obj,key])=>bind(`export${id}`,'input', e=>{ state.export[obj][key]=Math.max(0, Number(e.target.value)||0); renderExportPreviewCard(); }));
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; if(name==='Context' && $('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none'; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportGraticuleLabelSizeInput','input', e=>{ state.export.graticuleLabelSize=Math.max(8, Math.min(24, Number(e.target.value)||12)); renderExportPreviewCard(); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function renderExportStatsFieldsControls(){
  ensureExportFlags();
  const box=$('exportStatsFieldsBox'); if(!box) return;
  const labels={objects:'Объектов',population:'Население',area:'Площадь',density:'Плотность',urbanShare:'Доля городского населения',urbanPopulation:'Городское население',ruralPopulation:'Сельское население',avgArea:'Средняя площадь',avgPopulation:'Среднее население',avgDensity:'Средняя плотность'};
  box.innerHTML=Object.keys(labels).map(k=>`<label><input type="checkbox" data-stat-field="${k}" ${state.export.statsFields[k]?'checked':''}> ${labels[k]}</label>`).join('');
  box.querySelectorAll('input[data-stat-field]').forEach(inp=>inp.addEventListener('change', ()=>{ state.export.statsFields[inp.dataset.statField]=inp.checked; renderExportPreviewCard(); }));
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(state.export.contextMode==='auto' || resetTitle || !state.export.contextText) syncExportContextText();
  const V=(id,val)=>{ if($(id)) $(id).value=val; }, C=(id,val)=>{ if($(id)) $(id).checked=!!val; };
  V('exportTitleInput',state.export.title); V('exportTitleFontSize', state.export.titleFontSize); V('exportScopeSelect',state.export.scope); V('exportPaperSelect',state.export.paper); V('exportTemplateSelect',state.export.template); V('exportContextMode',state.export.contextMode); V('exportContextText',state.export.contextText||''); V('exportCanvasWidth',state.export.canvasWidth); V('exportCanvasHeight',state.export.canvasHeight); V('exportPanelWidth', state.export.panelWidth);
  ['top','right','bottom','left'].forEach(k=>{ V('exportPagePad'+k.charAt(0).toUpperCase()+k.slice(1), state.export.pagePadding[k]); V('exportFieldPad'+k.charAt(0).toUpperCase()+k.slice(1), state.export.fieldPadding[k]); V('exportBuffer'+k.charAt(0).toUpperCase()+k.slice(1), state.export.extentBuffer[k]); });
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>C(`exportShow${name}`, state.export[`show${name}`]));
  V('exportLabelModeSelect', state.export.labelMode); V('exportGraticuleLabelSizeInput', state.export.graticuleLabelSize);
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext ? 'block' : 'none';
  renderExportStatsFieldsControls();
}
function exportDraggableBlock(key, body, extraClass=''){
  const {w,h}=exportMapSize(); const outer=exportOuterFrameRect(w,h); const panelW=Number(state.export.panelWidth)||300;
  const defaults={title:{left:outer.x+8,top:outer.y+8,width:Math.max(520, outer.w-240)},context:{left:outer.x+18,top:outer.y+98,width:panelW},stats:{right:18,top:outer.y+98,width:panelW},legend:{right:18,top:outer.y+306,width:panelW}};
  const pos={...(defaults[key]||{}), ...(state.export.overlayPositions?.[key]||{})};
  const styles=[]; ['left','right','top','bottom','width'].forEach(k=>{ if(pos[k]!=null) styles.push(`${k}:${Number(pos[k])}px`); });
  return `<section class="export-map-card export-map-card-${key} export-map-card-v43 ${extraClass}" data-export-widget="${key}" style="${styles.join(';')}"><div class="export-map-card-body">${body}</div></section>`;
}
function exportOverlayBlocksHtml(features){
  const titleSize=Math.max(24, Math.min(72, Number(state.export.titleFontSize)||44));
  const contextText = state.export.contextMode==='auto' ? exportContextAutoText() : (state.export.contextText || '');
  const titleHtml=`<div class="export-title-block-v43"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><div class="export-title-row-v43"><h1 style="font-size:${titleSize}px">${escapeHtml(state.export.title || defaultExportTitle())}</h1><div class="export-header-meta-v43"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div></div></div>`;
  const blocks=[exportDraggableBlock('title', titleHtml, 'export-title-card-v43')];
  if(state.export.showContext) blocks.push(exportDraggableBlock('context', `<div class="export-context-plain-v43">${escapeHtml(contextText)}</div>`, 'export-context-card-v43'));
  if(state.export.showStats) blocks.push(exportDraggableBlock('stats', `<div class="export-stats-plain-v43">${exportStatsHtml(features)}</div>`, 'export-stats-card-v43'));
  if(state.export.showLegend) blocks.push(exportDraggableBlock('legend', `<div class="export-legend-plain-v43">${exportLegendHtml()}</div>`, 'export-legend-card-v43'));
  return blocks.join('');
}
function renderExportPreviewCard(){
  ensureExportFlags();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const {w,h}=exportMapSize();
  const field=exportMapFieldRect(w,h);
  wrap.innerHTML=`<article class="export-layout export-layout-v43" style="width:${w}px"><section class="export-main export-main-v43"><div class="export-map-frame export-map-frame-v43" style="width:${w}px;height:${h}px"><div id="exportSvgMap" class="export-svg-map"></div><div class="export-field-outline" style="left:${field.x}px;top:${field.y}px;width:${field.w}px;height:${field.h}px" title="Перетащите рамку картографического поля"></div>${exportOverlayBlocksHtml(features)}</div></section><footer class="export-footer export-footer-v43">${escapeHtml(exportSourceCaption())}</footer></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
}
async function refreshExportPreview(fitMainMap=false){
  if(!state.export.open) return;
  const status=$('exportPreviewStatus');
  if(status) status.textContent='Обновляем экспортный макет…';
  renderExportPreviewCard();
  if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
}
async function updateExportLiveMap(){
  const el=$('exportSvgMap'); if(!el) return;
  const status=$('exportPreviewStatus');
  try{ if(status) status.textContent='Строим SVG-карту…'; el.innerHTML=await buildExportSvgMap(); if(status) status.textContent='Превью обновлено. Можно сохранить PNG.'; }
  catch(e){ console.error('SVG export map error',e); el.innerHTML=`<div class="export-map-placeholder">Не удалось построить карту: ${escapeHtml(e.message||String(e))}</div>`; if(status) status.textContent='Ошибка построения карты.'; }
}
function initExportOverlayDrag(){
  const frame=document.querySelector('.export-map-frame-v43'); if(!frame) return;
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBound==='1') return;
    card.dataset.dragBound='1';
    card.addEventListener('pointerdown', ev=>{
      if(ev.target.closest('input,textarea,select,button,a')) return;
      ev.preventDefault();
      const f=frame.getBoundingClientRect(); const r=card.getBoundingClientRect(); const key=card.dataset.exportWidget; const dx=ev.clientX-r.left, dy=ev.clientY-r.top;
      const move=e=>{
        const maxX=f.width-r.width-8, maxY=f.height-r.height-8;
        const left=Math.max(8, Math.min(maxX, e.clientX-f.left-dx));
        const top=Math.max(8, Math.min(maxY, e.clientY-f.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px'; card.style.right='auto'; card.style.bottom='auto';
        state.export.overlayPositions[key]={left:Math.round(left), top:Math.round(top), width: card.offsetWidth};
      };
      const up=()=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    }, {passive:false});
  });
  const outline=frame.querySelector('.export-field-outline');
  if(outline && outline.dataset.dragBound!=='1'){
    outline.dataset.dragBound='1';
    outline.addEventListener('pointerdown', ev=>{
      ev.preventDefault();
      const f=frame.getBoundingClientRect(), r=outline.getBoundingClientRect();
      const outer=exportOuterFrameRect(frame.clientWidth, frame.clientHeight);
      const dx=ev.clientX-r.left, dy=ev.clientY-r.top;
      const ow=r.width, oh=r.height;
      const move=e=>{
        const left=Math.max(outer.x, Math.min(outer.x+outer.w-ow, e.clientX-f.left-dx));
        const top=Math.max(outer.y, Math.min(outer.y+outer.h-oh, e.clientY-f.top-dy));
        outline.style.left=left+'px'; outline.style.top=top+'px';
      };
      const up=()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
        const left=parseFloat(outline.style.left)||0, top=parseFloat(outline.style.top)||0;
        state.export.fieldPadding.left=Math.round(left-outer.x);
        state.export.fieldPadding.top=Math.round(top-outer.y);
        state.export.fieldPadding.right=Math.round(frame.clientWidth-outer.x-outer.w + (outer.x+outer.w-(left+ow)));
        state.export.fieldPadding.bottom=Math.round(frame.clientHeight-outer.y-outer.h + (outer.y+outer.h-(top+oh)));
        renderExportPreviewCard();
      };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    }, {passive:false});
  }
}
async function exportHydroSvg(project,bbox){
  try{
    const rivers=await loadJson(state.manifest.layers.hydro.rivers);
    const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
    const vars=styleVars();
    const showReservoirs = Number(state.year) >= 1959;
    let northCap=null; try{ northCap=await loadJson('data/hydro/north_cap.geojson'); }catch(e){}
    const capPaths=(northCap?.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.88" stroke="none"/>`).join('');
    const waterPaths=(waterRaw.features||[]).filter(f=>(showReservoirs || !isReservoirFeature(f) || isAlwaysVisibleWaterFeature(f))).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.90" stroke="${vars.waterLine}" stroke-width="0.72" stroke-opacity="0.72"/>`).join('');
    const riverPaths=(rivers.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="${vars.river}" stroke-width="${riverNormalizedWeight(f,true).toFixed(2)}" stroke-opacity="${(0.46 + Math.min(1, riverNormalizedWeight(f,true)/2.8)*0.36).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    return `<g class="export-hydro"><g>${capPaths}${waterPaths}</g><g>${riverPaths}</g></g>`;
  }catch(e){ console.warn('export hydro svg skipped',e); return ''; }
}
async function openExportMode(){
  const modal=ensureExportModal();
  state.export.open=true; syncExportDefaults(true);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  await refreshExportPreview(false);
}

/* v45 hotfix: export modal recursion fix + independent floating export launcher */
function syncExportContextText(){
  if(!state.export || typeof state.export !== 'object') state.export = {};
  if(!state.export.contextMode) state.export.contextMode = 'auto';
  const preset = exportContextPresets(state.year || '');
  if(state.export.contextMode === 'short'){
    state.export.contextText = preset.short || '';
  }else if(state.export.contextMode === 'long'){
    state.export.contextText = preset.long || preset.short || '';
  }else{
    const source = (preset.long || preset.short || '').replace(/\s+/g,' ').trim();
    const sentences = source.match(/[^.!?]+[.!?]?/g) || [source];
    let out = '';
    for(const sent of sentences){
      const candidate = (out ? out + ' ' : '') + sent.trim();
      if(candidate.length > 220 && out) break;
      out = candidate;
      if(out.length >= 150 && /[.!?]$/.test(out)) break;
    }
    state.export.contextText = (out || source).slice(0, 230).replace(/[,:;\-–—]\s*$/,'').trim();
  }
  const textarea = $('exportContextText');
  if(textarea) textarea.value = state.export.contextText || '';
}
function ensureExportFlags(){
  if(!state.export || typeof state.export !== 'object') state.export = {};
  if(typeof state.export.open !== 'boolean') state.export.open = false;
  if(!state.export.scope) state.export.scope = 'currentLayer';
  if(!state.export.paper) state.export.paper = 'a4Landscape';
  if(!state.export.template) state.export.template = 'thesis';
  if(!state.export.title) state.export.title = defaultExportTitle();
  if(typeof state.export.subtitle !== 'string') state.export.subtitle = '';
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k=>{
    if(typeof state.export[k] !== 'boolean') state.export[k] = true;
  });
  if(!state.export.contextMode) state.export.contextMode = 'auto';
  if(!state.export.contextText){
    const preset = exportContextPresets(state.year || '');
    state.export.contextText = state.export.contextMode === 'long' ? (preset.long || preset.short || '') : (preset.short || preset.long || '');
  }
  if(!state.export.labelMode) state.export.labelMode = 'balanced';
  if(!Number.isFinite(Number(state.export.graticuleLabelSize))) state.export.graticuleLabelSize = 12;
  if(!Number.isFinite(Number(state.export.canvasWidth))) state.export.canvasWidth = state.export.paper === 'a4Portrait' ? 1240 : state.export.paper === 'screen' ? 1760 : 1480;
  if(!Number.isFinite(Number(state.export.canvasHeight))) state.export.canvasHeight = state.export.paper === 'a4Portrait' ? 1680 : state.export.paper === 'screen' ? 1040 : 1040;
  if(!state.export.extentBuffer) state.export.extentBuffer = {top:200,right:200,bottom:200,left:200};
  if(!state.export.pagePadding) state.export.pagePadding = {top:16,right:16,bottom:16,left:16};
  if(!state.export.fieldPadding) state.export.fieldPadding = {top:110,right:42,bottom:54,left:42};
  ['top','right','bottom','left'].forEach(k=>{
    if(!Number.isFinite(Number(state.export.extentBuffer[k]))) state.export.extentBuffer[k] = 200;
    if(!Number.isFinite(Number(state.export.pagePadding[k]))) state.export.pagePadding[k] = 16;
    if(!Number.isFinite(Number(state.export.fieldPadding[k]))) state.export.fieldPadding[k] = (k==='top'?110:(k==='bottom'?54:42));
  });
  if(!state.export.overlayPositions || typeof state.export.overlayPositions !== 'object') state.export.overlayPositions = {};
  if(!Number.isFinite(Number(state.export.titleFontSize))) state.export.titleFontSize = state.export.template === 'presentation' ? 56 : 44;
  if(!Number.isFinite(Number(state.export.panelWidth))) state.export.panelWidth = 300;
  if(!state.export.statsFields || typeof state.export.statsFields !== 'object') state.export.statsFields = {};
  const statDefaults = {objects:true,population:true,area:true,density:true,urbanShare:true,urbanPopulation:false,ruralPopulation:false,avgArea:false,avgPopulation:false,avgDensity:false};
  Object.keys(statDefaults).forEach(k=>{ if(typeof state.export.statsFields[k] !== 'boolean') state.export.statsFields[k] = statDefaults[k]; });
}
function installExportLauncher(){
  if(document.getElementById('floatingExportLauncher')) return;
  const btn = document.createElement('button');
  btn.id = 'floatingExportLauncher';
  btn.className = 'floating-export-launcher';
  btn.type = 'button';
  btn.title = 'Режим экспорта карты';
  btn.setAttribute('aria-label','Открыть режим экспорта карты');
  btn.innerHTML = '<span class="floating-export-icon">⇩</span><span class="floating-export-text">Экспорт карты</span>';
  btn.addEventListener('click', async (e)=>{
    e.preventDefault();
    try{
      await openExportMode();
    }catch(err){
      console.error('Export mode failed to open', err);
      alert('Не удалось открыть режим экспорта карты: ' + (err?.message || err));
    }
  });
  document.body.appendChild(btn);
}
function ensureExportLauncherInstalled(){
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installExportLauncher, {once:true});
  else installExportLauncher();
}
ensureExportLauncherInstalled();

/* v47: export UX cleanup, fixed map-frame drag, thinner river hierarchy */
function riverNormalizedWeight(f, forExport=false){
  const v=riverStrokeWeightValue(f);
  const min=0.2, max=1.2;
  const t=Math.max(0, Math.min(1, (v-min)/(max-min)));
  const base = forExport ? (0.65 + Math.pow(t,0.86)*2.15) : (0.8 + Math.pow(t,0.86)*1.55);
  return base * 0.70;
}
function riverStyle(f){
  const s=styleVars();
  return {color:s.river, weight:riverNormalizedWeight(f,false), opacity:state.theme==='light'?0.74:0.78, lineCap:'round', lineJoin:'round'};
}
function exportApplyLayoutPreset(preset){
  ensureExportFlags();
  const p = preset || state.export.layoutPreset || 'balanced';
  state.export.layoutPreset = p;
  if(p==='mapLarge'){
    state.export.pagePadding={top:12,right:12,bottom:12,left:12};
    state.export.fieldPadding={top:92,right:28,bottom:44,left:28};
  }else if(p==='legendSpace'){
    state.export.pagePadding={top:16,right:16,bottom:16,left:16};
    state.export.fieldPadding={top:116,right:360,bottom:56,left:42};
  }else if(p==='article'){
    state.export.pagePadding={top:24,right:24,bottom:24,left:24};
    state.export.fieldPadding={top:92,right:315,bottom:60,left:42};
    state.export.titleFontSize=34;
  }else{
    state.export.pagePadding={top:16,right:16,bottom:16,left:16};
    state.export.fieldPadding={top:108,right:320,bottom:54,left:42};
  }
}
function exportSetUniformBuffer(km){
  ensureExportFlags();
  const v=Math.max(0, Number(km)||0);
  state.export.extentBuffer={top:v,right:v,bottom:v,left:v};
  state.export.bufferPreset=v;
}
function ensureExportFlags(){
  if(!state.export || typeof state.export !== 'object') state.export = {};
  if(typeof state.export.open !== 'boolean') state.export.open = false;
  if(!state.export.scope) state.export.scope = 'currentLayer';
  if(!state.export.paper) state.export.paper = 'a4Landscape';
  if(!state.export.template) state.export.template = 'thesis';
  if(!state.export.title) state.export.title = defaultExportTitle();
  if(typeof state.export.subtitle !== 'string') state.export.subtitle = '';
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k=>{
    if(typeof state.export[k] !== 'boolean') state.export[k] = true;
  });
  if(!state.export.contextMode) state.export.contextMode = 'auto';
  if(!state.export.contextText){
    const preset = exportContextPresets(state.year || '');
    state.export.contextText = preset.short || preset.long || '';
  }
  if(!state.export.labelMode) state.export.labelMode = 'balanced';
  if(!Number.isFinite(Number(state.export.graticuleLabelSize))) state.export.graticuleLabelSize = 12;
  if(!Number.isFinite(Number(state.export.canvasWidth))) state.export.canvasWidth = state.export.paper === 'a4Portrait' ? 1240 : state.export.paper === 'screen' ? 1760 : 1480;
  if(!Number.isFinite(Number(state.export.canvasHeight))) state.export.canvasHeight = state.export.paper === 'a4Portrait' ? 1680 : state.export.paper === 'screen' ? 1040 : 1040;
  if(!state.export.extentBuffer) state.export.extentBuffer = {top:200,right:200,bottom:200,left:200};
  if(!state.export.pagePadding) state.export.pagePadding = {top:16,right:16,bottom:16,left:16};
  if(!state.export.fieldPadding) state.export.fieldPadding = {top:108,right:320,bottom:54,left:42};
  ['top','right','bottom','left'].forEach(k=>{
    if(!Number.isFinite(Number(state.export.extentBuffer[k]))) state.export.extentBuffer[k] = 200;
    if(!Number.isFinite(Number(state.export.pagePadding[k]))) state.export.pagePadding[k] = 16;
    if(!Number.isFinite(Number(state.export.fieldPadding[k]))) state.export.fieldPadding[k] = (k==='top'?108:(k==='bottom'?54:(k==='right'?320:42)));
  });
  if(!state.export.overlayPositions || typeof state.export.overlayPositions !== 'object') state.export.overlayPositions = {};
  if(!Number.isFinite(Number(state.export.titleFontSize))) state.export.titleFontSize = state.export.template === 'presentation' ? 46 : 36;
  if(!Number.isFinite(Number(state.export.panelWidth))) state.export.panelWidth = 300;
  if(!state.export.statsFields || typeof state.export.statsFields !== 'object') state.export.statsFields = {};
  const statDefaults = {objects:true,population:true,area:true,density:true,urbanShare:true,urbanPopulation:false,ruralPopulation:false,avgArea:false,avgPopulation:false,avgDensity:false};
  Object.keys(statDefaults).forEach(k=>{ if(typeof state.export.statsFields[k] !== 'boolean') state.export.statsFields[k] = statDefaults[k]; });
  if(!state.export.layoutPreset) state.export.layoutPreset='balanced';
  if(!Number.isFinite(Number(state.export.bufferPreset))) state.export.bufferPreset=Number(state.export.extentBuffer.top)||200;
}
function ensureExportModal(){
  let old=$('exportMode');
  if(old && !old.classList.contains('export-modal-v47')) old.remove();
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div');
  modal.id='exportMode';
  modal.className='export-modal export-modal-v47';
  modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div>
  <section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle">
    <aside class="export-controls">
      <div class="export-controls-head">
        <div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div>
        <button type="button" class="export-close" aria-label="Закрыть экспорт">×</button>
      </div>
      <label class="control-label" for="exportTitleInput">Название карты</label>
      <input id="exportTitleInput" class="export-text-input" type="text">
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportTitleFontSize">Размер заголовка, px</label><input id="exportTitleFontSize" class="export-text-input" type="number" min="24" max="60" step="1"></div>
        <div><label class="control-label" for="exportPanelWidth">Ширина карточек, px</label><input id="exportPanelWidth" class="export-text-input" type="number" min="220" max="420" step="2"></div>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select></div>
        <div><label class="control-label" for="exportPaperSelect">Формат</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select></div>
      </div>
      <div class="export-form-grid2">
        <div><label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="900" step="20"></div>
        <div><label class="control-label" for="exportCanvasHeight">Высота PNG, px</label><input id="exportCanvasHeight" class="export-text-input" type="number" min="700" step="20"></div>
      </div>
      <div class="export-fieldset export-fieldset-simple"><div class="export-fieldset-title">Компоновка листа</div>
        <select id="exportLayoutPreset"><option value="balanced">Сбалансированно</option><option value="mapLarge">Карта крупнее</option><option value="legendSpace">Место справа под легенду</option><option value="article">Компактная статья</option></select>
        <div class="mini-muted">Рамку карты можно двигать мышью в превью. Размер при перетаскивании больше не меняется.</div>
      </div>
      <div class="export-fieldset export-fieldset-simple"><div class="export-fieldset-title">Буфер вокруг выбранных АТЕ</div>
        <div class="export-form-grid2"><input id="exportUniformBuffer" class="export-text-input" type="number" min="0" step="10"><button id="exportApplyBuffer" type="button">Применить, км</button></div>
      </div>
      <details class="export-context-box"><summary>Точные настройки рамок</summary>
        <div class="export-fieldset"><div class="export-fieldset-title">Внешняя рамка PNG, px</div><div class="export-form-grid4">
          <div><label class="control-label" for="exportPagePadTop">Верх</label><input id="exportPagePadTop" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadRight">Право</label><input id="exportPagePadRight" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadBottom">Низ</label><input id="exportPagePadBottom" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportPagePadLeft">Лево</label><input id="exportPagePadLeft" class="export-text-input" type="number" min="0" step="2"></div>
        </div></div>
        <div class="export-fieldset"><div class="export-fieldset-title">Поле карты внутри PNG, px</div><div class="export-form-grid4">
          <div><label class="control-label" for="exportFieldPadTop">Верх</label><input id="exportFieldPadTop" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadRight">Право</label><input id="exportFieldPadRight" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadBottom">Низ</label><input id="exportFieldPadBottom" class="export-text-input" type="number" min="0" step="2"></div>
          <div><label class="control-label" for="exportFieldPadLeft">Лево</label><input id="exportFieldPadLeft" class="export-text-input" type="number" min="0" step="2"></div>
        </div></div>
        <div class="export-fieldset"><div class="export-fieldset-title">Буфер экстента по сторонам, км</div><div class="export-form-grid4">
          <div><label class="control-label" for="exportBufferTop">Север</label><input id="exportBufferTop" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferRight">Восток</label><input id="exportBufferRight" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferBottom">Юг</label><input id="exportBufferBottom" class="export-text-input" type="number" min="0" step="10"></div>
          <div><label class="control-label" for="exportBufferLeft">Запад</label><input id="exportBufferLeft" class="export-text-input" type="number" min="0" step="10"></div>
        </div></div>
      </details>
      <div class="export-option-grid export-layer-grid export-layer-grid-v47">
        <label><input type="checkbox" id="exportShowHydro"> Гидрография и океан</label>
        <label><input type="checkbox" id="exportShowAdmin"> Административный слой</label>
        <label><input type="checkbox" id="exportShowRailways"> Железные дороги</label>
        <label><input type="checkbox" id="exportShowPopulation"> Круги населения</label>
        <label><input type="checkbox" id="exportShowLabels"> Подписи АТЕ</label>
        <label><input type="checkbox" id="exportShowGraticule"> Градусная сетка</label>
        <label><input type="checkbox" id="exportShowGraticuleLabels"> Подписи сетки</label>
        <label><input type="checkbox" id="exportShowScale"> Масштабная линейка</label>
        <label><input type="checkbox" id="exportShowLegend"> Легенда</label>
        <label><input type="checkbox" id="exportShowStats"> Общая информация</label>
        <label><input type="checkbox" id="exportShowContext"> Контекст</label>
      </div>
      <div class="export-form-grid2"><div><label class="control-label" for="exportLabelModeSelect">Подписи АТЕ</label><select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select></div><div><label class="control-label" for="exportGraticuleLabelSizeInput">Подписи сетки, px</label><input id="exportGraticuleLabelSizeInput" class="export-text-input" type="number" min="8" max="24" step="1"></div></div>
      <details id="exportContextDetails" class="export-context-box"><summary>Контекст</summary><label class="control-label" for="exportContextMode">Текст</label><select id="exportContextMode"><option value="auto">Авто-компактный</option><option value="short">Краткий</option><option value="long">Развёрнутый</option></select><textarea id="exportContextText" class="export-context-text" rows="4"></textarea></details>
      <details class="export-context-box"><summary>Содержание блока информации</summary><div class="export-stats-fields" id="exportStatsFieldsBox"></div></details>
      <div class="button-row export-buttons"><button id="refreshExportPreview" type="button">Обновить превью</button></div>
      <button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button>
    </aside>
    <div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id, event, fn)=>{ const el=$(id); if(el) el.addEventListener(event, fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportTitleFontSize','input', e=>{ state.export.titleFontSize=Math.max(24, Math.min(60, Number(e.target.value)||36)); renderExportPreviewCard(); });
  bind('exportPanelWidth','input', e=>{ state.export.panelWidth=Math.max(220, Math.min(420, Number(e.target.value)||300)); renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); refreshExportPreview(false); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; if(e.target.value==='a4Portrait'){ state.export.canvasWidth=1240; state.export.canvasHeight=1680; } else if(e.target.value==='screen'){ state.export.canvasWidth=1760; state.export.canvasHeight=1040; } else { state.export.canvasWidth=1480; state.export.canvasHeight=1040; } syncExportDefaults(false); renderExportPreviewCard(); });
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(900, Number(e.target.value)||1480); renderExportPreviewCard(); });
  bind('exportCanvasHeight','input', e=>{ state.export.canvasHeight=Math.max(700, Number(e.target.value)||1040); renderExportPreviewCard(); });
  bind('exportLayoutPreset','change', e=>{ exportApplyLayoutPreset(e.target.value); syncExportDefaults(false); renderExportPreviewCard(); });
  bind('exportUniformBuffer','input', e=>{ state.export.bufferPreset=Math.max(0, Number(e.target.value)||0); });
  bind('exportApplyBuffer','click', e=>{ e.preventDefault(); exportSetUniformBuffer($('exportUniformBuffer')?.value); syncExportDefaults(false); renderExportPreviewCard(); });
  [['PagePadTop','pagePadding','top'],['PagePadRight','pagePadding','right'],['PagePadBottom','pagePadding','bottom'],['PagePadLeft','pagePadding','left'],['FieldPadTop','fieldPadding','top'],['FieldPadRight','fieldPadding','right'],['FieldPadBottom','fieldPadding','bottom'],['FieldPadLeft','fieldPadding','left'],['BufferTop','extentBuffer','top'],['BufferRight','extentBuffer','right'],['BufferBottom','extentBuffer','bottom'],['BufferLeft','extentBuffer','left']].forEach(([id,obj,key])=>bind(`export${id}`,'input', e=>{ state.export[obj][key]=Math.max(0, Number(e.target.value)||0); renderExportPreviewCard(); }));
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; if(name==='Context' && $('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none'; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportGraticuleLabelSizeInput','input', e=>{ state.export.graticuleLabelSize=Math.max(8, Math.min(24, Number(e.target.value)||12)); renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(state.export.contextMode==='auto' || resetTitle || !state.export.contextText) syncExportContextText();
  const V=(id,val)=>{ if($(id)) $(id).value=val; }, C=(id,val)=>{ if($(id)) $(id).checked=!!val; };
  V('exportTitleInput',state.export.title); V('exportTitleFontSize', state.export.titleFontSize); V('exportPanelWidth', state.export.panelWidth); V('exportScopeSelect',state.export.scope); V('exportPaperSelect',state.export.paper); V('exportCanvasWidth',state.export.canvasWidth); V('exportCanvasHeight',state.export.canvasHeight); V('exportLayoutPreset',state.export.layoutPreset); V('exportUniformBuffer', state.export.bufferPreset); V('exportContextMode',state.export.contextMode); V('exportContextText',state.export.contextText||'');
  ['top','right','bottom','left'].forEach(k=>{ V('exportPagePad'+k.charAt(0).toUpperCase()+k.slice(1), state.export.pagePadding[k]); V('exportFieldPad'+k.charAt(0).toUpperCase()+k.slice(1), state.export.fieldPadding[k]); V('exportBuffer'+k.charAt(0).toUpperCase()+k.slice(1), state.export.extentBuffer[k]); });
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>C(`exportShow${name}`, state.export[`show${name}`]));
  V('exportLabelModeSelect', state.export.labelMode); V('exportGraticuleLabelSizeInput', state.export.graticuleLabelSize);
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext ? 'block' : 'none';
  renderExportStatsFieldsControls();
}
function exportOverlayBlocksHtml(features){
  const titleSize=Math.max(24, Math.min(60, Number(state.export.titleFontSize)||36));
  const contextText = state.export.contextMode==='auto' ? exportContextAutoText() : (state.export.contextText || '');
  const titleHtml=`<div class="export-title-block-v47"><div class="export-academic-kicker">${escapeHtml(exportTemplateName())} · ${escapeHtml(exportPaperName())}</div><h1 style="font-size:${titleSize}px">${escapeHtml(state.export.title || defaultExportTitle())}</h1></div>`;
  const blocks=[exportDraggableBlock('title', titleHtml, 'export-title-card-v47')];
  if(state.export.showContext) blocks.push(exportDraggableBlock('context', `<div class="export-context-plain-v43">${escapeHtml(contextText)}</div>`, 'export-context-card-v43'));
  if(state.export.showStats) blocks.push(exportDraggableBlock('stats', `<div class="export-stats-plain-v43">${exportStatsHtml(features)}</div>`, 'export-stats-card-v43'));
  if(state.export.showLegend) blocks.push(exportDraggableBlock('legend', `<div class="export-legend-plain-v43">${exportLegendHtml()}</div>`, 'export-legend-card-v43'));
  return blocks.join('');
}
function renderExportPreviewCard(){
  ensureExportFlags();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const {w,h}=exportMapSize();
  const field=exportMapFieldRect(w,h);
  wrap.innerHTML=`<article class="export-layout export-layout-v47" style="width:${w}px"><section class="export-main export-main-v43"><div class="export-map-frame export-map-frame-v47" style="width:${w}px;height:${h}px"><div id="exportSvgMap" class="export-svg-map"></div><div class="export-field-outline export-field-outline-v47" style="left:${field.x}px;top:${field.y}px;width:${field.w}px;height:${field.h}px" title="Перетащите рамку картографического поля"></div>${exportOverlayBlocksHtml(features)}</div></section><footer class="export-footer export-footer-v43">${escapeHtml(exportSourceCaption())}</footer></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
}
function initExportOverlayDrag(){
  const frame=document.querySelector('.export-map-frame-v47'); if(!frame) return;
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBound==='1') return;
    card.dataset.dragBound='1';
    card.addEventListener('pointerdown', ev=>{
      if(ev.target.closest('input,textarea,select,button,a')) return;
      ev.preventDefault();
      const f=frame.getBoundingClientRect(); const r=card.getBoundingClientRect(); const key=card.dataset.exportWidget; const dx=ev.clientX-r.left, dy=ev.clientY-r.top;
      const move=e=>{
        const maxX=f.width-r.width-8, maxY=f.height-r.height-8;
        const left=Math.max(8, Math.min(maxX, e.clientX-f.left-dx));
        const top=Math.max(8, Math.min(maxY, e.clientY-f.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px'; card.style.right='auto'; card.style.bottom='auto';
        state.export.overlayPositions[key]={left:Math.round(left), top:Math.round(top), width: card.offsetWidth};
      };
      const up=()=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    }, {passive:false});
  });
  const outline=frame.querySelector('.export-field-outline');
  if(outline && outline.dataset.dragBound!=='1'){
    outline.dataset.dragBound='1';
    outline.addEventListener('pointerdown', ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const f=frame.getBoundingClientRect(), r=outline.getBoundingClientRect();
      const outer=exportOuterFrameRect(frame.clientWidth, frame.clientHeight);
      const dx=ev.clientX-r.left, dy=ev.clientY-r.top;
      const fieldW=r.width, fieldH=r.height;
      const move=e=>{
        const left=Math.max(outer.x, Math.min(outer.x+outer.w-fieldW, e.clientX-f.left-dx));
        const top=Math.max(outer.y, Math.min(outer.y+outer.h-fieldH, e.clientY-f.top-dy));
        outline.style.left=left+'px'; outline.style.top=top+'px';
      };
      const up=()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
        const left=parseFloat(outline.style.left)||outer.x;
        const top=parseFloat(outline.style.top)||outer.y;
        state.export.fieldPadding.left=Math.round(left-outer.x);
        state.export.fieldPadding.top=Math.round(top-outer.y);
        state.export.fieldPadding.right=Math.round(outer.w - (left-outer.x) - fieldW);
        state.export.fieldPadding.bottom=Math.round(outer.h - (top-outer.y) - fieldH);
        syncExportDefaults(false);
        renderExportPreviewCard();
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    }, {passive:false});
  }
}
async function exportHydroSvg(project,bbox){
  try{
    const rivers=await loadJson(state.manifest.layers.hydro.rivers);
    const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
    const vars=styleVars();
    const showReservoirs = Number(state.year) >= 1959;
    let northCap=null; try{ northCap=await loadJson('data/hydro/north_cap.geojson'); }catch(e){}
    const capPaths=(northCap?.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.88" stroke="none"/>`).join('');
    const waterPaths=(waterRaw.features||[]).filter(f=>(showReservoirs || !isReservoirFeature(f) || isAlwaysVisibleWaterFeature(f))).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.90" stroke="${vars.waterLine}" stroke-width="0.72" stroke-opacity="0.72"/>`).join('');
    const riverPaths=(rivers.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="${vars.river}" stroke-width="${riverNormalizedWeight(f,true).toFixed(2)}" stroke-opacity="${(0.42 + Math.min(1, riverNormalizedWeight(f,true)/2.0)*0.32).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    return `<g class="export-hydro"><g>${capPaths}${waterPaths}</g><g>${riverPaths}</g></g>`;
  }catch(e){ console.warn('export hydro svg skipped',e); return ''; }
}
async function openExportMode(){
  const modal=ensureExportModal();
  state.export.open=true; syncExportDefaults(true);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  await refreshExportPreview(false);
}

/* v48: compact export launcher anchored to the right panel */
function positionFloatingExportLauncherV48(){
  const btn = document.getElementById('floatingExportLauncher');
  if(!btn) return;
  const panel = document.getElementById('rightPanel');
  const margin = 20;
  btn.classList.add('floating-export-launcher-v48');
  btn.innerHTML = '<span class="floating-export-icon">⇩</span><span class="floating-export-text">Экспорт карты</span>';
  if(panel){
    const r = panel.getBoundingClientRect();
    const targetLeft = Math.max(12, Math.min(window.innerWidth - btn.offsetWidth - 12, r.left + margin));
    const targetTop = Math.max(12, Math.min(window.innerHeight - btn.offsetHeight - 12, r.top + margin));
    btn.style.left = `${Math.round(targetLeft)}px`;
    btn.style.top = `${Math.round(targetTop)}px`;
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
    btn.style.transform = 'none';
  }else{
    btn.style.right = '18px';
    btn.style.top = '18px';
    btn.style.left = 'auto';
    btn.style.transform = 'none';
  }
}
function ensureCompactExportLauncherV48(){
  const ready = () => {
    let btn = document.getElementById('floatingExportLauncher');
    if(!btn){
      btn = document.createElement('button');
      btn.id = 'floatingExportLauncher';
      btn.type = 'button';
      btn.title = 'Режим экспорта карты';
      btn.setAttribute('aria-label','Открыть режим экспорта карты');
      btn.addEventListener('click', async (e)=>{
        e.preventDefault();
        try{ await openExportMode(); }
        catch(err){ console.error('Export mode failed to open', err); alert('Не удалось открыть режим экспорта карты: ' + (err?.message || err)); }
      });
      document.body.appendChild(btn);
    }
    btn.className = 'floating-export-launcher floating-export-launcher-v48';
    btn.title = 'Режим экспорта карты';
    btn.setAttribute('aria-label','Открыть режим экспорта карты');
    positionFloatingExportLauncherV48();
    window.addEventListener('resize', positionFloatingExportLauncherV48, {passive:true});
    const panel = document.getElementById('rightPanel');
    if(panel && window.MutationObserver){
      const mo = new MutationObserver(()=>requestAnimationFrame(positionFloatingExportLauncherV48));
      mo.observe(panel, {attributes:true, attributeFilter:['class','style']});
    }
    setTimeout(positionFloatingExportLauncherV48, 250);
    setTimeout(positionFloatingExportLauncherV48, 900);
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true});
  else ready();
}
ensureCompactExportLauncherV48();

/* v49: auto-fit export cartographic field by selected admin polygons */
function exportSelectionMetricAspect(features){
  const source = (features && features.length) ? features : (state.currentGeoJSON?.features || state.rawGeoJSON?.features || []);
  const bbox = geoBBoxFromFeatures(source);
  const [minLon,minLat,maxLon,maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const widthKm = Math.max(1, (maxLon - minLon) * 111.32 * Math.max(0.22, Math.cos(midLat * Math.PI / 180)));
  const heightKm = Math.max(1, (maxLat - minLat) * 111.32);
  return Math.max(0.18, Math.min(5.5, widthKm / heightKm));
}
function exportAutoFieldRect(w,h,features){
  const outer = exportOuterFrameRect(w,h);
  const topMin = 100;
  const bottomMin = 100;
  const sideMin = 28;
  const sideMax = 400;
  const maxW = Math.max(260, outer.w - sideMin * 2);
  const maxH = Math.max(260, outer.h - topMin - bottomMin);
  const aspect = exportSelectionMetricAspect(features);
  let fieldW = maxW;
  let fieldH = fieldW / aspect;
  if(fieldH > maxH){ fieldH = maxH; fieldW = fieldH * aspect; }
  const minWBySideLimit = Math.max(260, outer.w - sideMax * 2);
  if(fieldW < minWBySideLimit){
    fieldW = Math.min(maxW, minWBySideLimit);
    fieldH = Math.min(maxH, fieldW / aspect);
  }
  fieldW = Math.max(260, Math.min(maxW, fieldW));
  fieldH = Math.max(260, Math.min(maxH, fieldH));
  let x = outer.x + (outer.w - fieldW) / 2;
  let y = outer.y + topMin + (maxH - fieldH) / 2;
  const leftGap = x - outer.x;
  const rightGap = outer.x + outer.w - (x + fieldW);
  if(leftGap > sideMax || rightGap > sideMax){
    const correctedW = Math.min(maxW, Math.max(fieldW, outer.w - sideMax * 2));
    x = outer.x + (outer.w - correctedW) / 2;
    fieldW = correctedW;
  }
  return {x:Math.round(x), y:Math.round(y), w:Math.round(fieldW), h:Math.round(fieldH), aspect};
}
function exportMapFieldRect(w,h){
  ensureExportFlags();
  if(state.export.autoFitField !== false){
    return exportAutoFieldRect(w,h,exportScopeFeatures());
  }
  const outer=exportOuterFrameRect(w,h); const p=state.export.fieldPadding || {top:110,right:42,bottom:54,left:42};
  return {x:outer.x+(Number(p.left)||0), y:outer.y+(Number(p.top)||0), w:Math.max(220, outer.w-(Number(p.left)||0)-(Number(p.right)||0)), h:Math.max(220, outer.h-(Number(p.top)||0)-(Number(p.bottom)||0))};
}
function ensureExportFlags(){
  if(!state.export || typeof state.export !== 'object') state.export = {};
  if(typeof state.export.open !== 'boolean') state.export.open = false;
  if(!state.export.scope) state.export.scope = 'currentLayer';
  if(!state.export.paper) state.export.paper = 'a4Landscape';
  if(!state.export.template) state.export.template = 'thesis';
  if(!state.export.title) state.export.title = defaultExportTitle();
  if(typeof state.export.subtitle !== 'string') state.export.subtitle = '';
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k=>{ if(typeof state.export[k] !== 'boolean') state.export[k] = true; });
  if(!state.export.contextMode) state.export.contextMode = 'auto';
  if(!state.export.contextText){ const preset = exportContextPresets(state.year || ''); state.export.contextText = preset.short || preset.long || ''; }
  if(!state.export.labelMode) state.export.labelMode = 'balanced';
  if(!Number.isFinite(Number(state.export.graticuleLabelSize))) state.export.graticuleLabelSize = 12;
  if(!Number.isFinite(Number(state.export.canvasWidth))) state.export.canvasWidth = state.export.paper === 'a4Portrait' ? 1240 : state.export.paper === 'screen' ? 1760 : 1480;
  if(!Number.isFinite(Number(state.export.canvasHeight))) state.export.canvasHeight = state.export.paper === 'a4Portrait' ? 1680 : state.export.paper === 'screen' ? 1040 : 1040;
  if(!state.export.extentBuffer) state.export.extentBuffer = {top:200,right:200,bottom:200,left:200};
  if(!state.export.pagePadding) state.export.pagePadding = {top:16,right:16,bottom:16,left:16};
  if(!state.export.fieldPadding) state.export.fieldPadding = {top:108,right:320,bottom:54,left:42};
  ['top','right','bottom','left'].forEach(k=>{
    if(!Number.isFinite(Number(state.export.extentBuffer[k]))) state.export.extentBuffer[k] = 200;
    if(!Number.isFinite(Number(state.export.pagePadding[k]))) state.export.pagePadding[k] = 16;
    if(!Number.isFinite(Number(state.export.fieldPadding[k]))) state.export.fieldPadding[k] = (k==='top'?108:(k==='bottom'?54:(k==='right'?320:42)));
  });
  if(!state.export.overlayPositions || typeof state.export.overlayPositions !== 'object') state.export.overlayPositions = {};
  if(!Number.isFinite(Number(state.export.titleFontSize))) state.export.titleFontSize = state.export.template === 'presentation' ? 46 : 36;
  if(!Number.isFinite(Number(state.export.panelWidth))) state.export.panelWidth = 300;
  if(!state.export.statsFields || typeof state.export.statsFields !== 'object') state.export.statsFields = {};
  const statDefaults = {objects:true,population:true,area:true,density:true,urbanShare:true,urbanPopulation:false,ruralPopulation:false,avgArea:false,avgPopulation:false,avgDensity:false};
  Object.keys(statDefaults).forEach(k=>{ if(typeof state.export.statsFields[k] !== 'boolean') state.export.statsFields[k] = statDefaults[k]; });
  if(!state.export.layoutPreset) state.export.layoutPreset='balanced';
  if(!Number.isFinite(Number(state.export.bufferPreset))) state.export.bufferPreset=Number(state.export.extentBuffer.top)||200;
  if(typeof state.export.autoFitField !== 'boolean') state.export.autoFitField = true;
}
function exportFieldStatusText(){
  const {w,h}=exportMapSize();
  const outer=exportOuterFrameRect(w,h);
  const f=exportMapFieldRect(w,h);
  const left=Math.round(f.x-outer.x), right=Math.round(outer.x+outer.w-(f.x+f.w));
  const top=Math.round(f.y-outer.y), bottom=Math.round(outer.y+outer.h-(f.y+f.h));
  return `Автоподгонка поля: ${f.w}×${f.h}px; поля: верх ${top}, низ ${bottom}, лево ${left}, право ${right}px`;
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(state.export.contextMode==='auto' || resetTitle || !state.export.contextText) syncExportContextText();
  const V=(id,val)=>{ if($(id)) $(id).value=val; }, C=(id,val)=>{ if($(id)) $(id).checked=!!val; };
  V('exportTitleInput',state.export.title); V('exportTitleFontSize', state.export.titleFontSize); V('exportPanelWidth', state.export.panelWidth); V('exportScopeSelect',state.export.scope); V('exportPaperSelect',state.export.paper); V('exportTemplateSelect',state.export.template); V('exportContextMode',state.export.contextMode); V('exportContextText',state.export.contextText||'');
  V('exportCanvasWidth',state.export.canvasWidth); V('exportCanvasHeight',state.export.canvasHeight);
  ['top','right','bottom','left'].forEach(k=>{ V('exportPagePad'+k.charAt(0).toUpperCase()+k.slice(1), state.export.pagePadding[k]); V('exportFieldPad'+k.charAt(0).toUpperCase()+k.slice(1), state.export.fieldPadding[k]); V('exportBuffer'+k.charAt(0).toUpperCase()+k.slice(1), state.export.extentBuffer[k]); });
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>C(`exportShow${name}`, state.export[`show${name}`]));
  C('exportAutoFitField', state.export.autoFitField);
  V('exportLabelModeSelect', state.export.labelMode); V('exportGraticuleLabelSizeInput', state.export.graticuleLabelSize);
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext ? 'block' : 'none';
  const note=$('exportAutoFieldStatus'); if(note) note.textContent=exportFieldStatusText();
  renderExportStatsFieldsControls?.();
}
function ensureExportModal(){
  let old=$('exportMode');
  if(old && !old.classList.contains('export-modal-v49')) old.remove();
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div');
  modal.id='exportMode';
  modal.className='export-modal export-modal-v49';
  modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div>
  <section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle">
    <aside class="export-controls">
      <div class="export-controls-head"><div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div><button type="button" class="export-close" aria-label="Закрыть экспорт">×</button></div>
      <label class="control-label" for="exportTitleInput">Название карты</label><input id="exportTitleInput" class="export-text-input" type="text">
      <div class="export-form-grid2"><div><label class="control-label" for="exportTitleFontSize">Размер заголовка, px</label><input id="exportTitleFontSize" class="export-text-input" type="number" min="24" max="60" step="1"></div><div><label class="control-label" for="exportPanelWidth">Ширина карточек, px</label><input id="exportPanelWidth" class="export-text-input" type="number" min="220" max="420" step="2"></div></div>
      <div class="export-form-grid2"><div><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select></div><div><label class="control-label" for="exportPaperSelect">Формат листа</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select></div></div>
      <div class="export-form-grid2"><div><label class="control-label" for="exportTemplateSelect">Режим оформления</label><select id="exportTemplateSelect"><option value="thesis">Карта для диплома</option><option value="article">Карта для статьи</option><option value="presentation">Презентационный слайд</option></select></div><div><label class="control-label" for="exportContextMode">Текст контекста</label><select id="exportContextMode"><option value="auto">Авто-компактный</option><option value="short">Краткий</option><option value="long">Развёрнутый</option></select></div></div>
      <div class="export-form-grid2"><div><label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="900" step="20"></div><div><label class="control-label" for="exportCanvasHeight">Высота PNG, px</label><input id="exportCanvasHeight" class="export-text-input" type="number" min="700" step="20"></div></div>
      <div class="export-fieldset"><div class="export-fieldset-title">Автокомпоновка картографического поля</div><label class="export-checkline"><input type="checkbox" id="exportAutoFitField"> Автоматически подгонять поле по форме выбранного слоя / выборки</label><div id="exportAutoFieldStatus" class="mini-muted"></div><div class="mini-muted">Правило: верх/низ не меньше 100 px; боковые интервалы не больше 400 px.</div></div>
      <details class="export-context-box"><summary>Точные настройки рамок</summary><div class="export-fieldset"><div class="export-fieldset-title">Внешняя рамка / рабочее поле, px</div><div class="export-form-grid4">${['Top:Сверху','Right:Справа','Bottom:Снизу','Left:Слева'].map(x=>{const [id,l]=x.split(':');return `<div><label class="control-label" for="exportPagePad${id}">${l}</label><input id="exportPagePad${id}" class="export-text-input" type="number" min="0" step="2"></div>`}).join('')}</div></div><div class="export-fieldset"><div class="export-fieldset-title">Ручное картографическое поле, px</div><div class="export-form-grid4">${['Top:Верх','Right:Право','Bottom:Низ','Left:Лево'].map(x=>{const [id,l]=x.split(':');return `<div><label class="control-label" for="exportFieldPad${id}">${l}</label><input id="exportFieldPad${id}" class="export-text-input" type="number" min="0" step="2"></div>`}).join('')}</div></div></details>
      <div class="export-fieldset"><div class="export-fieldset-title">Буфер экстента от выбранных административных полигонов, км</div><div class="export-form-grid4">${['Top:Север','Right:Восток','Bottom:Юг','Left:Запад'].map(x=>{const [id,l]=x.split(':');return `<div><label class="control-label" for="exportBuffer${id}">${l}</label><input id="exportBuffer${id}" class="export-text-input" type="number" min="0" step="10"></div>`}).join('')}</div></div>
      <div class="export-option-grid export-layer-grid export-layer-grid-v49">${[['Hydro','Гидрография и океан'],['Admin','Административный слой'],['Railways','Железные дороги'],['Population','Круги населения'],['Labels','Подписи АТЕ'],['Graticule','Градусная сетка'],['GraticuleLabels','Подписи сетки'],['Scale','Масштабная линейка'],['Legend','Легенда'],['Stats','Общая информация'],['Context','Контекст']].map(([id,l])=>`<label><input type="checkbox" id="exportShow${id}"> ${l}</label>`).join('')}</div>
      <div class="export-form-grid2"><div><label class="control-label" for="exportLabelModeSelect">Генерализация подписей</label><select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select></div><div><label class="control-label" for="exportGraticuleLabelSizeInput">Размер подписей сетки, px</label><input id="exportGraticuleLabelSizeInput" class="export-text-input" type="number" min="8" max="24" step="1"></div></div>
      <details id="exportContextDetails" class="export-context-box" open><summary>Контекст</summary><textarea id="exportContextText" class="export-context-text" rows="5"></textarea></details>
      <details class="export-context-box"><summary>Содержание блока информации</summary><div class="export-stats-fields" id="exportStatsFieldsBox"></div></details>
      <div class="button-row export-buttons"><button id="refreshExportPreview" type="button">Обновить превью</button></div><button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button>
      <div class="mini-muted">Поле карты автоматически меняет пропорции под слой: вертикальная территория получает более узкое поле, горизонтальная — более низкое.</div>
    </aside><div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode);
  modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id,event,fn)=>{ const el=$(id); if(el) el.addEventListener(event,fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportTitleFontSize','input', e=>{ state.export.titleFontSize=Math.max(24, Math.min(60, Number(e.target.value)||36)); renderExportPreviewCard(); });
  bind('exportPanelWidth','input', e=>{ state.export.panelWidth=Math.max(220, Math.min(420, Number(e.target.value)||300)); renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); renderExportPreviewCard(); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; if(e.target.value==='a4Portrait'){ state.export.canvasWidth=1240; state.export.canvasHeight=1680; } else if(e.target.value==='screen'){ state.export.canvasWidth=1760; state.export.canvasHeight=1040; } else { state.export.canvasWidth=1480; state.export.canvasHeight=1040; } syncExportDefaults(false); renderExportPreviewCard(); });
  bind('exportTemplateSelect','change', e=>{ state.export.template=e.target.value; renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(900, Number(e.target.value)||1480); renderExportPreviewCard(); });
  bind('exportCanvasHeight','input', e=>{ state.export.canvasHeight=Math.max(700, Number(e.target.value)||1040); renderExportPreviewCard(); });
  bind('exportAutoFitField','change', e=>{ state.export.autoFitField=!!e.target.checked; renderExportPreviewCard(); syncExportDefaults(false); });
  [['PagePadTop','pagePadding','top'],['PagePadRight','pagePadding','right'],['PagePadBottom','pagePadding','bottom'],['PagePadLeft','pagePadding','left'],['FieldPadTop','fieldPadding','top'],['FieldPadRight','fieldPadding','right'],['FieldPadBottom','fieldPadding','bottom'],['FieldPadLeft','fieldPadding','left'],['BufferTop','extentBuffer','top'],['BufferRight','extentBuffer','right'],['BufferBottom','extentBuffer','bottom'],['BufferLeft','extentBuffer','left']].forEach(([id,obj,key])=>bind(`export${id}`,'input', e=>{ state.export[obj][key]=Math.max(0, Number(e.target.value)||0); renderExportPreviewCard(); }));
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; if(name==='Context' && $('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none'; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportGraticuleLabelSizeInput','input', e=>{ state.export.graticuleLabelSize=Math.max(8, Math.min(24, Number(e.target.value)||12)); renderExportPreviewCard(); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false));
  bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
async function openExportMode(){
  const modal=ensureExportModal();
  state.export.open=true; syncExportDefaults(true);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  await refreshExportPreview(false);
}
function positionFloatingExportLauncherV48(){
  const btn = document.getElementById('floatingExportLauncher'); if(!btn) return;
  const panel = document.getElementById('rightPanel'); const margin = 20;
  btn.classList.add('floating-export-launcher-v48');
  btn.innerHTML = '<span class="floating-export-icon">⇩</span><span class="floating-export-text">Экспорт карты</span>';
  if(panel){ const r=panel.getBoundingClientRect(); btn.style.left=`${Math.round(Math.max(12, Math.min(window.innerWidth-btn.offsetWidth-12, r.left+margin)))}px`; btn.style.top=`${Math.round(Math.max(12, Math.min(window.innerHeight-btn.offsetHeight-12, r.top+margin)))}px`; btn.style.right='auto'; btn.style.bottom='auto'; btn.style.transform='none'; }
}

/* v50: robust export constructor - separate outer/inner frames, auto-fit by selected admin polygons, fixed launcher position */
function v50Number(v, fallback){ const n=Number(v); return Number.isFinite(n) ? n : fallback; }
function ensureExportFlags(){
  if(!state.export || typeof state.export !== 'object') state.export = {};
  if(typeof state.export.open !== 'boolean') state.export.open=false;
  if(!state.export.scope) state.export.scope='currentLayer';
  if(!state.export.paper) state.export.paper='a4Landscape';
  if(!state.export.template) state.export.template='thesis';
  if(!state.export.title) state.export.title=defaultExportTitle();
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k=>{ if(typeof state.export[k] !== 'boolean') state.export[k]=true; });
  if(!state.export.contextMode) state.export.contextMode='auto';
  if(!state.export.contextText){ const p=exportContextPresets(state.year||''); state.export.contextText=p.short||p.long||''; }
  if(!state.export.labelMode) state.export.labelMode='balanced';
  if(!Number.isFinite(Number(state.export.graticuleLabelSize))) state.export.graticuleLabelSize=12;
  if(!Number.isFinite(Number(state.export.canvasWidth))) state.export.canvasWidth = state.export.paper==='a4Portrait' ? 1240 : state.export.paper==='screen' ? 1760 : 1480;
  if(!Number.isFinite(Number(state.export.canvasHeight))) state.export.canvasHeight = state.export.paper==='a4Portrait' ? 1680 : state.export.paper==='screen' ? 1040 : 1040;
  if(!Number.isFinite(Number(state.export.titleFontSize))) state.export.titleFontSize = 34;
  if(!Number.isFinite(Number(state.export.panelWidth))) state.export.panelWidth = 300;
  if(!state.export.extentBuffer) state.export.extentBuffer={top:200,right:200,bottom:200,left:200};
  ['top','right','bottom','left'].forEach(k=>{ if(!Number.isFinite(Number(state.export.extentBuffer[k]))) state.export.extentBuffer[k]=200; });
  if(typeof state.export.autoFitField !== 'boolean') state.export.autoFitField=true;
  if(!state.export.innerFrame || typeof state.export.innerFrame !== 'object') state.export.innerFrame={x:80,y:130,w:900,h:760};
  ['x','y','w','h'].forEach(k=>{ if(!Number.isFinite(Number(state.export.innerFrame[k]))) state.export.innerFrame[k]=({x:80,y:130,w:900,h:760})[k]; });
  if(!state.export.overlayPositions || typeof state.export.overlayPositions !== 'object') state.export.overlayPositions={};
  if(!state.export.statsFields || typeof state.export.statsFields !== 'object') state.export.statsFields={};
  const statDefaults={objects:true,population:true,area:true,density:true,urbanShare:true,urbanPopulation:false,ruralPopulation:false,avgArea:false,avgPopulation:false,avgDensity:false};
  Object.keys(statDefaults).forEach(k=>{ if(typeof state.export.statsFields[k] !== 'boolean') state.export.statsFields[k]=statDefaults[k]; });
}
function exportMapSize(){ ensureExportFlags(); return {w:Math.max(900, v50Number(state.export.canvasWidth,1480)), h:Math.max(700, v50Number(state.export.canvasHeight,1040))}; }
function exportOuterFrameRect(w,h){ return {x:0,y:0,w:Math.max(900,w),h:Math.max(700,h)}; }
function exportSelectionMetricAspect(features){
  const source=(features&&features.length)?features:(state.currentGeoJSON?.features||state.rawGeoJSON?.features||[]);
  const bbox=geoBBoxFromFeatures(source);
  const [minLon,minLat,maxLon,maxLat]=bbox;
  const midLat=(minLat+maxLat)/2;
  const widthKm=Math.max(1,(maxLon-minLon)*111.32*Math.max(0.22,Math.cos(midLat*Math.PI/180)));
  const heightKm=Math.max(1,(maxLat-minLat)*111.32);
  return Math.max(0.18,Math.min(5.5,widthKm/heightKm));
}
function exportAutoFieldRect(w,h,features){
  const outer=exportOuterFrameRect(w,h);
  const minTB=100, minSide=28, maxSide=400;
  const maxW=Math.max(260, outer.w-minSide*2);
  const maxH=Math.max(260, outer.h-minTB*2);
  const aspect=exportSelectionMetricAspect(features);
  let fw=maxW, fh=fw/aspect;
  if(fh>maxH){ fh=maxH; fw=fh*aspect; }
  // Do not leave excessive side voids when selected shape is very vertical.
  const minWByMaxSide=Math.max(260, outer.w-maxSide*2);
  if(fw<minWByMaxSide){ fw=Math.min(maxW,minWByMaxSide); fh=Math.min(maxH,fw/aspect); }
  // Keep at least 100 px top/bottom by construction, and center inside available belt.
  fw=Math.round(Math.max(260,Math.min(maxW,fw)));
  fh=Math.round(Math.max(260,Math.min(maxH,fh)));
  let x=Math.round(outer.x+(outer.w-fw)/2);
  let y=Math.round(outer.y+minTB+(maxH-fh)/2);
  return {x,y,w:fw,h:fh,aspect};
}
function exportMapFieldRect(w,h){
  ensureExportFlags();
  if(state.export.autoFitField!==false){
    const r=exportAutoFieldRect(w,h,exportScopeFeatures());
    state.export.innerFrame={x:r.x,y:r.y,w:r.w,h:r.h};
    return r;
  }
  const outer=exportOuterFrameRect(w,h);
  const f=state.export.innerFrame||{};
  let iw=Math.max(260,Math.min(outer.w, v50Number(f.w,900)));
  let ih=Math.max(260,Math.min(outer.h, v50Number(f.h,760)));
  let ix=Math.max(outer.x,Math.min(outer.x+outer.w-iw, v50Number(f.x,80)));
  let iy=Math.max(outer.y,Math.min(outer.y+outer.h-ih, v50Number(f.y,130)));
  state.export.innerFrame={x:Math.round(ix),y:Math.round(iy),w:Math.round(iw),h:Math.round(ih)};
  return state.export.innerFrame;
}
function exportFieldStatusText(){
  const {w,h}=exportMapSize(); const outer=exportOuterFrameRect(w,h); const f=exportMapFieldRect(w,h);
  const left=Math.round(f.x-outer.x), right=Math.round(outer.x+outer.w-(f.x+f.w));
  const top=Math.round(f.y-outer.y), bottom=Math.round(outer.y+outer.h-(f.y+f.h));
  return `Внешняя рамка: ${w}×${h}px. Внутренняя рамка: ${f.w}×${f.h}px, X ${f.x}, Y ${f.y}. Поля: верх ${top}, низ ${bottom}, лево ${left}, право ${right}px.`;
}
function ensureExportModal(){
  let old=$('exportMode'); if(old && !old.classList.contains('export-modal-v50')) old.remove();
  let modal=$('exportMode'); if(modal) return modal;
  ensureExportFlags();
  modal=document.createElement('div'); modal.id='exportMode'; modal.className='export-modal export-modal-v50'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="export-backdrop" data-close-export="1"></div>
  <section class="export-shell" role="dialog" aria-modal="true" aria-labelledby="exportModeTitle">
    <aside class="export-controls">
      <div class="export-controls-head"><div><div class="eyebrow">Экспорт карты · v${APP_VERSION}</div><h2 id="exportModeTitle">Экспорт для диплома</h2></div><button type="button" class="export-close" aria-label="Закрыть экспорт">×</button></div>
      <label class="control-label" for="exportTitleInput">Название карты</label><input id="exportTitleInput" class="export-text-input" type="text">
      <div class="export-form-grid2"><div><label class="control-label" for="exportTitleFontSize">Размер заголовка, px</label><input id="exportTitleFontSize" class="export-text-input" type="number" min="24" max="60" step="1"></div><div><label class="control-label" for="exportPanelWidth">Ширина карточек, px</label><input id="exportPanelWidth" class="export-text-input" type="number" min="220" max="420" step="2"></div></div>
      <div class="export-form-grid2"><div><label class="control-label" for="exportScopeSelect">Охват карты</label><select id="exportScopeSelect"><option value="currentLayer">Текущий слой / фильтры</option><option value="selection">Текущая выборка</option><option value="parents">Отмеченные верхнеуровневые АТЕ</option></select></div><div><label class="control-label" for="exportPaperSelect">Формат</label><select id="exportPaperSelect"><option value="a4Landscape">A4 horizontal</option><option value="a4Portrait">A4 vertical</option><option value="screen">Широкий экран</option></select></div></div>
      <div class="export-fieldset"><div class="export-fieldset-title">Внешняя рамка PNG</div><div class="export-form-grid2"><div><label class="control-label" for="exportCanvasWidth">Ширина внешней рамки, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="900" step="20"></div><div><label class="control-label" for="exportCanvasHeight">Высота внешней рамки, px</label><input id="exportCanvasHeight" class="export-text-input" type="number" min="700" step="20"></div></div></div>
      <div class="export-fieldset"><div class="export-fieldset-title">Внутренняя рамка карты</div><label class="export-checkline"><input type="checkbox" id="exportAutoFitField"> Автоматически подгонять по форме выбранного слоя / выборки</label><div class="export-form-grid4"><div><label class="control-label" for="exportInnerX">X</label><input id="exportInnerX" class="export-text-input" type="number" min="0" step="2"></div><div><label class="control-label" for="exportInnerY">Y</label><input id="exportInnerY" class="export-text-input" type="number" min="0" step="2"></div><div><label class="control-label" for="exportInnerWidth">Ширина</label><input id="exportInnerWidth" class="export-text-input" type="number" min="260" step="2"></div><div><label class="control-label" for="exportInnerHeight">Высота</label><input id="exportInnerHeight" class="export-text-input" type="number" min="260" step="2"></div></div><div id="exportAutoFieldStatus" class="mini-muted"></div><div class="mini-muted">Авто: верх/низ не меньше 100 px; боковые интервалы не больше 400 px. Ручной режим: рамку можно двигать и растягивать в превью.</div></div>
      <div class="export-fieldset"><div class="export-fieldset-title">Буфер экстента от выбранных административных полигонов, км</div><div class="export-form-grid4">${['Top:Север','Right:Восток','Bottom:Юг','Left:Запад'].map(x=>{const [id,l]=x.split(':');return `<div><label class="control-label" for="exportBuffer${id}">${l}</label><input id="exportBuffer${id}" class="export-text-input" type="number" min="0" step="10"></div>`}).join('')}</div></div>
      <div class="export-option-grid export-layer-grid export-layer-grid-v50">${[['Hydro','Гидрография и океан'],['Admin','Административный слой'],['Railways','Железные дороги'],['Population','Круги населения'],['Labels','Подписи АТЕ'],['Graticule','Градусная сетка'],['GraticuleLabels','Подписи сетки'],['Scale','Масштабная линейка'],['Legend','Легенда'],['Stats','Общая информация'],['Context','Контекст']].map(([id,l])=>`<label><input type="checkbox" id="exportShow${id}"> ${l}</label>`).join('')}</div>
      <div class="export-form-grid2"><div><label class="control-label" for="exportLabelModeSelect">Подписи АТЕ</label><select id="exportLabelModeSelect"><option value="none">Не показывать</option><option value="major">Только крупнейшие</option><option value="balanced">Сбалансированно</option><option value="dense">Плотнее</option></select></div><div><label class="control-label" for="exportGraticuleLabelSizeInput">Подписи сетки, px</label><input id="exportGraticuleLabelSizeInput" class="export-text-input" type="number" min="8" max="24" step="1"></div></div>
      <details id="exportContextDetails" class="export-context-box"><summary>Контекст</summary><label class="control-label" for="exportContextMode">Текст</label><select id="exportContextMode"><option value="auto">Авто-компактный</option><option value="short">Краткий</option><option value="long">Развёрнутый</option></select><textarea id="exportContextText" class="export-context-text" rows="4"></textarea></details>
      <details class="export-context-box"><summary>Содержание блока информации</summary><div class="export-stats-fields" id="exportStatsFieldsBox"></div></details>
      <div class="button-row export-buttons"><button id="refreshExportPreview" type="button">Обновить превью</button></div><button id="downloadExportPng" type="button" class="export-primary-btn">Сохранить PNG</button>
    </aside><div class="export-preview-area"><div id="exportPreviewStatus" class="export-preview-status">Подготовка превью…</div><div id="exportPreviewCard" class="export-preview-card"></div></div>
  </section>`;
  document.body.appendChild(modal);
  modal.querySelector('.export-close').addEventListener('click', closeExportMode); modal.querySelector('[data-close-export]').addEventListener('click', closeExportMode);
  const bind=(id,event,fn)=>{ const el=$(id); if(el) el.addEventListener(event,fn); };
  bind('exportTitleInput','input', e=>{ state.export.title=e.target.value; renderExportPreviewCard(); });
  bind('exportTitleFontSize','input', e=>{ state.export.titleFontSize=Math.max(24,Math.min(60,Number(e.target.value)||34)); renderExportPreviewCard(); });
  bind('exportPanelWidth','input', e=>{ state.export.panelWidth=Math.max(220,Math.min(420,Number(e.target.value)||300)); renderExportPreviewCard(); });
  bind('exportScopeSelect','change', e=>{ state.export.scope=e.target.value; syncExportDefaults(false); renderExportPreviewCard(); });
  bind('exportPaperSelect','change', e=>{ state.export.paper=e.target.value; if(e.target.value==='a4Portrait'){ state.export.canvasWidth=1240; state.export.canvasHeight=1680; } else if(e.target.value==='screen'){ state.export.canvasWidth=1760; state.export.canvasHeight=1040; } else { state.export.canvasWidth=1480; state.export.canvasHeight=1040; } syncExportDefaults(false); renderExportPreviewCard(); });
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(900,Number(e.target.value)||1480); clampInnerFrameToOuter(); renderExportPreviewCard(); });
  bind('exportCanvasHeight','input', e=>{ state.export.canvasHeight=Math.max(700,Number(e.target.value)||1040); clampInnerFrameToOuter(); renderExportPreviewCard(); });
  bind('exportAutoFitField','change', e=>{ state.export.autoFitField=!!e.target.checked; syncExportDefaults(false); renderExportPreviewCard(); });
  [['InnerX','x'],['InnerY','y'],['InnerWidth','w'],['InnerHeight','h']].forEach(([id,key])=>bind(`export${id}`,'input', e=>{ state.export.autoFitField=false; state.export.innerFrame[key]=Math.max(key==='w'||key==='h'?260:0,Number(e.target.value)||0); clampInnerFrameToOuter(); syncExportDefaults(false); renderExportPreviewCard(); }));
  [['BufferTop','top'],['BufferRight','right'],['BufferBottom','bottom'],['BufferLeft','left']].forEach(([id,key])=>bind(`export${id}`,'input', e=>{ state.export.extentBuffer[key]=Math.max(0,Number(e.target.value)||0); renderExportPreviewCard(); }));
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>bind(`exportShow${name}`,'change', e=>{ state.export[`show${name}`]=!!e.target.checked; renderExportPreviewCard(); }));
  bind('exportLabelModeSelect','change', e=>{ state.export.labelMode=e.target.value; state.export.showLabels=e.target.value!=='none'; if($('exportShowLabels')) $('exportShowLabels').checked=state.export.showLabels; renderExportPreviewCard(); });
  bind('exportGraticuleLabelSizeInput','input', e=>{ state.export.graticuleLabelSize=Math.max(8,Math.min(24,Number(e.target.value)||12)); renderExportPreviewCard(); });
  bind('exportContextMode','change', e=>{ state.export.contextMode=e.target.value; syncExportContextText(); renderExportPreviewCard(); });
  bind('exportContextText','input', e=>{ state.export.contextText=e.target.value; renderExportPreviewCard(); });
  bind('refreshExportPreview','click', ()=>refreshExportPreview(false)); bind('downloadExportPng','click', downloadExportPng);
  return modal;
}
function clampInnerFrameToOuter(){
  ensureExportFlags(); const {w,h}=exportMapSize(); const outer=exportOuterFrameRect(w,h); const f=state.export.innerFrame;
  f.w=Math.max(260,Math.min(outer.w,Number(f.w)||900)); f.h=Math.max(260,Math.min(outer.h,Number(f.h)||760));
  f.x=Math.max(outer.x,Math.min(outer.x+outer.w-f.w,Number(f.x)||0)); f.y=Math.max(outer.y,Math.min(outer.y+outer.h-f.h,Number(f.y)||0));
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags(); if(resetTitle||!state.export.title) state.export.title=defaultExportTitle(); if(state.export.contextMode==='auto'||resetTitle||!state.export.contextText) syncExportContextText();
  const f=exportMapFieldRect(...Object.values(exportMapSize())); const V=(id,val)=>{ if($(id)) $(id).value=val; }, C=(id,val)=>{ if($(id)) $(id).checked=!!val; };
  V('exportTitleInput',state.export.title); V('exportTitleFontSize',state.export.titleFontSize); V('exportPanelWidth',state.export.panelWidth); V('exportScopeSelect',state.export.scope); V('exportPaperSelect',state.export.paper); V('exportCanvasWidth',state.export.canvasWidth); V('exportCanvasHeight',state.export.canvasHeight);
  C('exportAutoFitField',state.export.autoFitField); V('exportInnerX',f.x); V('exportInnerY',f.y); V('exportInnerWidth',f.w); V('exportInnerHeight',f.h);
  ['top','right','bottom','left'].forEach(k=>V('exportBuffer'+k.charAt(0).toUpperCase()+k.slice(1),state.export.extentBuffer[k]));
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>C(`exportShow${name}`,state.export[`show${name}`]));
  V('exportLabelModeSelect',state.export.labelMode); V('exportGraticuleLabelSizeInput',state.export.graticuleLabelSize); V('exportContextMode',state.export.contextMode); V('exportContextText',state.export.contextText||'');
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none'; const note=$('exportAutoFieldStatus'); if(note) note.textContent=exportFieldStatusText(); renderExportStatsFieldsControls();
}
function exportDraggableBlock(key, body, extraClass=''){
  const {w,h}=exportMapSize(); const panelW=Number(state.export.panelWidth)||300;
  const defaults={title:{left:28,top:18,width:Math.min(1000,w-56)},context:{left:36,top:132,width:panelW},stats:{right:30,top:132,width:panelW},legend:{right:30,top:342,width:panelW}};
  const raw={...(defaults[key]||{}),...(state.export.overlayPositions?.[key]||{})};
  const approxH=key==='title'?90:key==='legend'?330:key==='stats'?220:110;
  let left=raw.left!=null?Number(raw.left):(w-(Number(raw.right)||0)-(Number(raw.width)||panelW));
  let top=raw.top!=null?Number(raw.top):(h-(Number(raw.bottom)||0)-approxH);
  const width=Number(raw.width)||panelW;
  left=Math.max(8,Math.min(w-width-8,left)); top=Math.max(8,Math.min(h-approxH-8,top));
  return `<section class="export-map-card export-map-card-${key} export-map-card-v50 ${extraClass}" data-export-widget="${key}" style="left:${Math.round(left)}px;top:${Math.round(top)}px;width:${Math.round(width)}px"><div class="export-map-card-body">${body}</div></section>`;
}
function exportOverlayBlocksHtml(features){
  const titleSize=Math.max(24,Math.min(60,Number(state.export.titleFontSize)||34)); const contextText=state.export.contextMode==='auto'?exportContextAutoText():(state.export.contextText||'');
  const titleHtml=`<div class="export-title-block-v50"><h1 style="font-size:${titleSize}px">${escapeHtml(state.export.title||defaultExportTitle())}</h1></div>`;
  const blocks=[exportDraggableBlock('title',titleHtml,'export-title-card-v50')];
  if(state.export.showContext) blocks.push(exportDraggableBlock('context',`<div class="export-context-plain-v43">${escapeHtml(contextText)}</div>`,'export-context-card-v43'));
  if(state.export.showStats) blocks.push(exportDraggableBlock('stats',`<div class="export-stats-plain-v43">${exportStatsHtml(features)}</div>`,'export-stats-card-v43'));
  if(state.export.showLegend) blocks.push(exportDraggableBlock('legend',`<div class="export-legend-plain-v43">${exportLegendHtml()}</div>`,'export-legend-card-v43'));
  return blocks.join('');
}
function renderExportPreviewCard(){
  ensureExportFlags(); const wrap=$('exportPreviewCard'); if(!wrap) return; const features=exportScopeFeatures(); const {w,h}=exportMapSize(); const field=exportMapFieldRect(w,h);
  wrap.innerHTML=`<article class="export-layout export-layout-v50" style="width:${w}px"><section class="export-main export-main-v43"><div class="export-map-frame export-map-frame-v50" style="width:${w}px;height:${h}px"><div id="exportSvgMap" class="export-svg-map"></div><div class="export-outer-outline-v50" title="Внешняя рамка PNG"><span class="export-resize-handle export-resize-se" data-frame="outer" data-dir="se"></span></div><div class="export-field-outline export-field-outline-v50" style="left:${field.x}px;top:${field.y}px;width:${field.w}px;height:${field.h}px" title="Внутренняя рамка карты: двигайте или растягивайте"><span class="export-resize-handle export-resize-se" data-frame="inner" data-dir="se"></span><span class="export-resize-handle export-resize-e" data-frame="inner" data-dir="e"></span><span class="export-resize-handle export-resize-s" data-frame="inner" data-dir="s"></span></div>${exportOverlayBlocksHtml(features)}</div></section></article>`;
  updateExportLiveMap(); initExportOverlayDrag(); syncExportDefaults(false);
}
function initExportOverlayDrag(){
  const frame=document.querySelector('.export-map-frame-v50'); if(!frame) return;
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBound==='1') return; card.dataset.dragBound='1';
    card.addEventListener('pointerdown',ev=>{ if(ev.target.closest('input,textarea,select,button,a')) return; ev.preventDefault(); const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect(); const key=card.dataset.exportWidget; const dx=ev.clientX-cr.left, dy=ev.clientY-cr.top; const move=e=>{ const left=Math.max(8,Math.min(fr.width-card.offsetWidth-8,e.clientX-fr.left-dx)); const top=Math.max(8,Math.min(fr.height-card.offsetHeight-8,e.clientY-fr.top-dy)); card.style.left=left+'px'; card.style.top=top+'px'; state.export.overlayPositions[key]={left:Math.round(left),top:Math.round(top),width:card.offsetWidth}; }; const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);}; document.addEventListener('pointermove',move); document.addEventListener('pointerup',up); },{passive:false});
  });
  const outline=frame.querySelector('.export-field-outline-v50');
  if(outline && outline.dataset.dragBound!=='1'){
    outline.dataset.dragBound='1';
    outline.addEventListener('pointerdown',ev=>{
      if(ev.target.classList.contains('export-resize-handle')) return; ev.preventDefault(); ev.stopPropagation(); state.export.autoFitField=false; const fr=frame.getBoundingClientRect(), or=outline.getBoundingClientRect(); const dx=ev.clientX-or.left, dy=ev.clientY-or.top; const fw=or.width, fh=or.height; const move=e=>{ const left=Math.max(0,Math.min(fr.width-fw,e.clientX-fr.left-dx)); const top=Math.max(0,Math.min(fr.height-fh,e.clientY-fr.top-dy)); outline.style.left=left+'px'; outline.style.top=top+'px'; }; const up=()=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); state.export.innerFrame={x:Math.round(parseFloat(outline.style.left)||0),y:Math.round(parseFloat(outline.style.top)||0),w:Math.round(fw),h:Math.round(fh)}; syncExportDefaults(false); renderExportPreviewCard(); }; document.addEventListener('pointermove',move); document.addEventListener('pointerup',up); },{passive:false});
  }
  frame.querySelectorAll('.export-resize-handle').forEach(handle=>{
    if(handle.dataset.bound==='1') return; handle.dataset.bound='1';
    handle.addEventListener('pointerdown',ev=>{ ev.preventDefault(); ev.stopPropagation(); const dir=handle.dataset.dir; const target=handle.dataset.frame; const startX=ev.clientX,startY=ev.clientY; const w0=Number(state.export.canvasWidth), h0=Number(state.export.canvasHeight); const f0={...exportMapFieldRect(w0,h0)}; const move=e=>{ const dx=e.clientX-startX, dy=e.clientY-startY; if(target==='outer'){ const minW=Math.max(900,(state.export.innerFrame?.x||0)+(state.export.innerFrame?.w||0)+20); const minH=Math.max(700,(state.export.innerFrame?.y||0)+(state.export.innerFrame?.h||0)+20); state.export.canvasWidth=Math.max(minW,w0+dx); state.export.canvasHeight=Math.max(minH,h0+dy); }else{ state.export.autoFitField=false; let nw=f0.w+(dir.includes('e')?dx:0); let nh=f0.h+(dir.includes('s')?dy:0); state.export.innerFrame={x:f0.x,y:f0.y,w:Math.max(260,Math.min(w0-f0.x,nw)),h:Math.max(260,Math.min(h0-f0.y,nh))}; } syncExportDefaults(false); renderExportPreviewCard(); }; const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);}; document.addEventListener('pointermove',move); document.addEventListener('pointerup',up); },{passive:false});
  });
}
async function exportHydroSvg(project,bbox){
  try{
    const rivers=await loadJson(state.manifest.layers.hydro.rivers);
    const waterRaw=await loadJson(state.manifest.layers.hydro.water || state.manifest.layers.hydro.lakes);
    const vars=styleVars(); const showReservoirs=Number(state.year)>=1959;
    let northCap=null; try{ northCap=await loadJson(state.manifest?.layers?.north_ocean_cap || 'data/reference/north_ocean_cap.geojson'); }catch(_){ }
    const capPaths=(northCap?.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.88" stroke="none"/>`).join('');
    const waterPaths=(waterRaw.features||[]).filter(f=>(showReservoirs || !isReservoirFeature(f) || isAlwaysVisibleWaterFeature(f))).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="${vars.waterFill}" fill-opacity="0.90" stroke="${vars.waterLine}" stroke-width="0.65" stroke-opacity="0.72"/>`).join('');
    const riverPaths=(rivers.features||[]).map(f=>`<path d="${geomToSvgPath(f.geometry,project)}" fill="none" stroke="${vars.river}" stroke-width="${riverNormalizedWeight(f,true).toFixed(2)}" stroke-opacity="0.62" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    return `<g class="export-hydro"><g>${capPaths}${waterPaths}</g><g>${riverPaths}</g></g>`;
  }catch(e){ console.warn('export hydro svg skipped',e); return ''; }
}
async function downloadExportPng(){
  const node=document.querySelector('.export-map-frame-v50') || $('exportPreviewCard'); const status=$('exportPreviewStatus');
  if(!node){ if(status) status.textContent='Не найден экспортный макет.'; return; }
  if(typeof window.html2canvas!=='function'){ if(status) status.textContent='Не загружена библиотека html2canvas.'; alert('Не загружена библиотека html2canvas. Проверь CDN или интернет-соединение.'); return; }
  try{ if(status) status.textContent='Сохраняем PNG…'; const canvas=await window.html2canvas(node,{backgroundColor:'#f7f5ef',useCORS:true,logging:false,scale:2}); const a=document.createElement('a'); a.href=canvas.toDataURL('image/png'); a.download=`west_siberia_export_${state.year}_${state.mode}_v${APP_VERSION}.png`; document.body.appendChild(a); a.click(); a.remove(); if(status) status.textContent='PNG сохранён в загрузки браузера.'; }
  catch(e){ console.error('PNG export failed',e); if(status) status.textContent='Ошибка сохранения PNG.'; alert('Не удалось сохранить PNG: '+(e?.message||e)); }
}
function positionFloatingExportLauncherV48(){
  const btn=document.getElementById('floatingExportLauncher'); if(!btn) return; const panel=document.getElementById('rightPanel'); const margin=20;
  btn.classList.add('floating-export-launcher-v48'); btn.innerHTML='<span class="floating-export-icon">⇩</span><span class="floating-export-text">Экспорт карты</span>';
  if(panel){ const r=panel.getBoundingClientRect(); const targetLeft=Math.max(8,Math.min(window.innerWidth-btn.offsetWidth-8,r.left-btn.offsetWidth-margin)); const targetTop=Math.max(8,Math.min(window.innerHeight-btn.offsetHeight-8,r.top)); btn.style.left=`${Math.round(targetLeft)}px`; btn.style.top=`${Math.round(targetTop)}px`; btn.style.right='auto'; btn.style.bottom='auto'; btn.style.transform='none'; }else{ btn.style.right='18px'; btn.style.top='18px'; btn.style.left='auto'; btn.style.transform='none'; }
}
setTimeout(positionFloatingExportLauncherV48,100); setTimeout(positionFloatingExportLauncherV48,700);


/* v51: export placement cleanup, selectable inner frame, title resize, parent filter controls, hierarchy groundwork */
const V51_1926_PARENT_GROUPS = {
  'Барабинский округ':'Сибирский край',
  'Барнаульский округ':'Сибирский край',
  'Бийский округ':'Сибирский край',
  'Ирбитский округ':'Уральская область',
  'Ишимский округ':'Уральская область',
  'Каменский округ':'Сибирский край',
  'Кузнецкий округ':'Сибирский край',
  'Курганский округ':'Уральская область',
  'Новосибирский округ':'Сибирский край',
  'Ойратская авт. область':'Сибирский край',
  'Омский округ':'Сибирский край',
  'Рубцовский округ':'Сибирский край',
  'Славгородский округ':'Сибирский край',
  'Тарский округ':'Сибирский край',
  'Томский округ':'Сибирский край',
  'Тюменский округ':'Уральская область',
  'Шадринский округ':'Уральская область'
};
function deriveAdminSuperparent(props){
  const explicit=String(props?.admin_superparent || props?.admin_group || props?.super_parent || '').trim();
  if(explicit) return explicit;
  const parent=String(props?.admin_parent || '').trim();
  const year=Number(props?.year || state.year || 0);
  if(year===1926 && parent) return V51_1926_PARENT_GROUPS[parent] || '';
  return '';
}
function enrichHierarchyProps(gj){
  if(!gj?.features) return gj;
  gj.features.forEach(f=>{
    if(!f.properties) f.properties={};
    if(!f.properties.admin_intermediate) f.properties.admin_intermediate = String(f.properties.admin_parent || '').trim() || '';
    if(!f.properties.admin_superparent) f.properties.admin_superparent = deriveAdminSuperparent(f.properties) || '';
  });
  return gj;
}
function syncVisibleParents(gj){
  gj = enrichHierarchyProps(gj);
  const parents=[...new Set((gj?.features||[]).map(parentNameFromFeature).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  state.parentCounts = new Map(parents.map(name=>[name,(gj?.features||[]).filter(f=>parentNameFromFeature(f)===name).length]));
  if(state.parentFilterYear !== state.year){
    state.visibleParents = new Set(parents);
    state.parentFilterYear = state.year;
  } else {
    const keep=new Set(parents.filter(name=>state.visibleParents.has(name)));
    state.visibleParents = keep.size ? keep : new Set(parents);
  }
  renderParentCheckboxes(parents);
  updateParentFilterToolbarState();
}
function renderParentCheckboxes(parents){
  const box=$('parentCheckboxes'); if(!box) return;
  box.innerHTML='';
  parents.forEach(name=>{
    const id=`parent_${name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g,'_')}`;
    const label=document.createElement('label'); label.className='parent-check';
    label.innerHTML=`<input type="checkbox" id="${id}" ${state.visibleParents.has(name)?'checked':''} data-parent-name="${escapeHtml(name)}"><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><b>${num(state.parentCounts.get(name)||0)}</b>`;
    const input=label.querySelector('input');
    input.addEventListener('change', ()=>{
      if(input.checked) state.visibleParents.add(name); else state.visibleParents.delete(name);
      updateParentFilterToolbarState();
      rerenderFilteredLayers();
    });
    box.appendChild(label);
  });
  updateParentFilterToolbarState();
}
function updateParentFilterToolbarState(){
  const total=(state.parentCounts && state.parentCounts.size) || 0;
  const visible=(state.visibleParents && state.visibleParents.size) || 0;
  const clearBtn=$('clearAllParentsBtn');
  const showBtn=$('showAllParentsBtn');
  if(clearBtn) clearBtn.disabled = total===0 || visible===0;
  if(showBtn) showBtn.disabled = total===0 || visible===total;
}
function bindParentFilterToolbar(){
  const showBtn=$('showAllParentsBtn'), clearBtn=$('clearAllParentsBtn');
  if(showBtn && showBtn.dataset.bound!=='1'){
    showBtn.dataset.bound='1';
    showBtn.addEventListener('click', ()=>setAllParentsVisible(true));
  }
  if(clearBtn && clearBtn.dataset.bound!=='1'){
    clearBtn.dataset.bound='1';
    clearBtn.addEventListener('click', ()=>setAllParentsVisible(false));
  }
  updateParentFilterToolbarState();
}
function showFeature(f){
  const p=f.properties||{}; const id=featureId(f); const selected=state.selectedIds.has(id); const sel=$('selectedFeatureSelect');
  if(sel && [...sel.options].some(o=>o.value===id)) sel.value=id;
  $('featureInfo').classList.remove('muted');
  const intermediate=String(p.admin_intermediate || '').trim();
  const superparent=String(p.admin_superparent || '').trim();
  $('featureInfo').innerHTML=`<span class="selection-badge ${selected?'on':''}">${selected?'в выборке':'не выбрано'}</span><div class="info-title">${p.name||'Без названия'}</div><div class="info-row"><span>Год</span><b>${p.year||state.year}</b></div><div class="info-row"><span>Тип</span><b>${p.unit_type||'—'}</b></div><div class="info-row"><span>Подчинение</span><b>${p.admin_parent||'—'}</b></div>${intermediate && intermediate!==String(p.admin_parent||'').trim()?`<div class="info-row"><span>Промежуточный уровень</span><b>${escapeHtml(intermediate)}</b></div>`:''}${superparent?`<div class="info-row"><span>Вышестоящая группа</span><b>${escapeHtml(superparent)}</b></div>`:''}<div class="info-row"><span>Центр</span><b>${p.center||'—'}</b></div><div class="info-row"><span>Население</span><b>${num(p.population)}</b></div><div class="info-row"><span>Городское</span><b>${num(p.urban_pop)}</b></div><div class="info-row"><span>Сельское</span><b>${num(p.rural_pop)}</b></div><div class="info-row"><span>Доля городского</span><b>${pct(p.urban_share)}</b></div><div class="info-row"><span>Площадь, км²</span><b>${num(p.area_km2)}</b></div><div class="info-row"><span>Плотность</span><b>${p.density==null?'—':Number(p.density).toFixed(2).replace('.',',')}</b></div><div class="info-row"><span>Исходный слой</span><b>${p.source_layer||'—'}</b></div>${objectAttributesHtml(f)}`;
}
function v51EnsureExportFlagsExtra(){
  ensureExportFlags.__base && ensureExportFlags.__base();
  if(!state.export.overlayPositions || typeof state.export.overlayPositions!=='object') state.export.overlayPositions={};
  if(typeof state.export.activeFrame !== 'string') state.export.activeFrame='';
  if(typeof state.export.selectedWidget !== 'string') state.export.selectedWidget='';
  if(!state.export.lastCanvasKey) state.export.lastCanvasKey='';
}
if(!ensureExportFlags.__base){ ensureExportFlags.__base = ensureExportFlags; }
ensureExportFlags = v51EnsureExportFlagsExtra;
function v51LegendApproxHeight(){
  const gj=state.currentGeoJSON||state.rawGeoJSON||{features:[]};
  let cats=0;
  if(state.mode==='admin_parent' || state.mode==='unit_type') cats=[...new Set((gj.features||[]).map(f=>f?.properties?.[state.mode]).filter(Boolean))].slice(0,24).length;
  let h=170 + cats*19;
  if(state.export?.showPopulation) h += 64;
  return Math.max(220, Math.min(h, Math.max(280, exportMapSize().h - 220)));
}
function v51DefaultOverlayPositions(w,h){
  ensureExportFlags();
  const gap=32;
  const sideW=Math.max(250, Math.min(Number(state.export.panelWidth)||300, Math.floor(w*0.29)));
  const titleWidth=Math.max(420, Math.min(w - sideW - gap*3, Number(state.export.overlayPositions?.title?.width)||Math.round(w*0.5)));
  const rightLeft=Math.max(gap, w - sideW - gap);
  const statsH=220;
  const legendH=v51LegendApproxHeight();
  const contextH=116;
  let statsTop=gap + 96;
  let legendTop=statsTop + statsH + 20;
  let contextTop=legendTop + legendH + 18;
  if(contextTop + contextH > h - gap){
    contextTop = h - contextH - gap;
    legendTop = Math.max(statsTop + statsH + 16, contextTop - legendH - 18);
  }
  return {
    title:{left:gap, top:gap, width:titleWidth},
    stats:{left:rightLeft, top:statsTop, width:sideW},
    legend:{left:rightLeft, top:legendTop, width:sideW},
    context:{left:rightLeft, top:contextTop, width:sideW}
  };
}
function v51ClampWidgetPosition(pos, key, w, h){
  const approxH = key==='title' ? 86 : key==='legend' ? v51LegendApproxHeight() : key==='stats' ? 220 : 116;
  const width = Math.max(240, Math.min(w-16, Number(pos.width)||280));
  const left = Math.max(8, Math.min(w-width-8, Number(pos.left)||0));
  const top = Math.max(8, Math.min(h-approxH-8, Number(pos.top)||0));
  return {left:Math.round(left), top:Math.round(top), width:Math.round(width)};
}
function v51NormalizeOverlayPositions(forceReset=false){
  ensureExportFlags();
  const {w,h}=exportMapSize();
  const key=`${w}x${h}`;
  const defs=v51DefaultOverlayPositions(w,h);
  if(forceReset || state.export.lastCanvasKey !== key){
    ['title','stats','legend','context'].forEach(k=>{ state.export.overlayPositions[k] = {...defs[k]}; });
    state.export.lastCanvasKey = key;
  }
  ['title','stats','legend','context'].forEach(k=>{
    const src={...(defs[k]||{}), ...(state.export.overlayPositions?.[k]||{})};
    state.export.overlayPositions[k] = v51ClampWidgetPosition(src,k,w,h);
  });
}
function syncExportDefaults(resetTitle=true){
  ensureExportFlags();
  const features=exportScopeFeatures();
  if(resetTitle || !state.export.title) state.export.title=defaultExportTitle();
  if(state.export.contextMode==='auto' || resetTitle || !state.export.contextText) syncExportContextText();
  v51NormalizeOverlayPositions(false);
  const f=exportMapFieldRect(...Object.values(exportMapSize()));
  const V=(id,val)=>{ if($(id)) $(id).value=val; }, C=(id,val)=>{ if($(id)) $(id).checked=!!val; };
  V('exportTitleInput',state.export.title); V('exportTitleFontSize',state.export.titleFontSize); V('exportPanelWidth',state.export.panelWidth); V('exportScopeSelect',state.export.scope); V('exportPaperSelect',state.export.paper); V('exportCanvasWidth',state.export.canvasWidth); V('exportCanvasHeight',state.export.canvasHeight);
  C('exportAutoFitField',state.export.autoFitField); V('exportInnerX',f.x); V('exportInnerY',f.y); V('exportInnerWidth',f.w); V('exportInnerHeight',f.h);
  ['top','right','bottom','left'].forEach(k=>V('exportBuffer'+k.charAt(0).toUpperCase()+k.slice(1),state.export.extentBuffer[k]));
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>C(`exportShow${name}`,state.export[`show${name}`]));
  V('exportLabelModeSelect',state.export.labelMode); V('exportGraticuleLabelSizeInput',state.export.graticuleLabelSize); V('exportContextMode',state.export.contextMode); V('exportContextText',state.export.contextText||'');
  if($('exportContextDetails')) $('exportContextDetails').style.display=state.export.showContext?'block':'none';
  const note=$('exportAutoFieldStatus'); if(note) note.textContent=exportFieldStatusText();
  renderExportStatsFieldsControls?.();
}
function exportDraggableBlock(key, body, extraClass=''){
  ensureExportFlags();
  v51NormalizeOverlayPositions(false);
  const {w,h}=exportMapSize();
  const defs=v51DefaultOverlayPositions(w,h);
  const raw={...(defs[key]||{}), ...(state.export.overlayPositions?.[key]||{})};
  const pos=v51ClampWidgetPosition(raw,key,w,h);
  state.export.overlayPositions[key]=pos;
  const selected=(state.export.selectedWidget===key)?' is-selected':'';
  const resizeHandle=key==='title' ? '<span class="export-card-resize-handle" data-widget-resize="title" title="Растянуть заголовок"></span>' : '';
  return `<section class="export-map-card export-map-card-${key} export-map-card-v50 ${extraClass}${selected}" data-export-widget="${key}" style="left:${pos.left}px;top:${pos.top}px;width:${pos.width}px">${resizeHandle}<div class="export-map-card-body">${body}</div></section>`;
}
function exportOverlayBlocksHtml(features){
  const titleSize=Math.max(24,Math.min(60,Number(state.export.titleFontSize)||34));
  const contextText=state.export.contextMode==='auto'?exportContextAutoText():(state.export.contextText||'');
  const titleHtml=`<div class="export-title-block-v50"><h1 style="font-size:${titleSize}px">${escapeHtml(state.export.title||defaultExportTitle())}</h1></div>`;
  const blocks=[exportDraggableBlock('title',titleHtml,'export-title-card-v50')];
  if(state.export.showStats) blocks.push(exportDraggableBlock('stats',`<div class="export-stats-plain-v43">${exportStatsHtml(features)}</div>`,'export-stats-card-v43'));
  if(state.export.showLegend) blocks.push(exportDraggableBlock('legend',`<div class="export-legend-plain-v43 export-legend-plain-v51">${exportLegendHtml()}</div>`,'export-legend-card-v43'));
  if(state.export.showContext) blocks.push(exportDraggableBlock('context',`<div class="export-context-plain-v43">${escapeHtml(contextText)}</div>`,'export-context-card-v43'));
  return blocks.join('');
}
function renderExportPreviewCard(){
  ensureExportFlags();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const {w,h}=exportMapSize();
  v51NormalizeOverlayPositions(false);
  const field=exportMapFieldRect(w,h);
  const innerSelected = state.export.activeFrame==='inner' ? ' is-selected' : '';
  wrap.innerHTML=`<article class="export-layout export-layout-v50 export-layout-v51" style="width:${w}px"><section class="export-main export-main-v43"><div class="export-map-frame export-map-frame-v50 export-map-frame-v51" style="width:${w}px;height:${h}px"><div id="exportSvgMap" class="export-svg-map"></div><div class="export-outer-outline-v50 export-outer-outline-v51" title="Внешняя рамка PNG"><span class="export-resize-handle export-resize-se" data-frame="outer" data-dir="se"></span></div><div class="export-field-outline export-field-outline-v50 export-field-outline-v51${innerSelected}" style="left:${field.x}px;top:${field.y}px;width:${field.w}px;height:${field.h}px" title="Внутренняя рамка карты"><span class="export-resize-handle export-resize-se" data-frame="inner" data-dir="se"></span><span class="export-resize-handle export-resize-e" data-frame="inner" data-dir="e"></span><span class="export-resize-handle export-resize-s" data-frame="inner" data-dir="s"></span></div>${exportOverlayBlocksHtml(features)}</div></section></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
  syncExportDefaults(false);
}
function v51SetActiveFrame(frameEl, name){
  document.querySelectorAll('.export-field-outline-v51').forEach(el=>el.classList.toggle('is-selected', name==='inner' && el===frameEl));
  state.export.activeFrame = name || '';
}
function v51SelectWidget(key){
  state.export.selectedWidget = key || '';
  document.querySelectorAll('.export-map-card-v50').forEach(el=>el.classList.toggle('is-selected', el.dataset.exportWidget===key));
}
function initExportOverlayDrag(){
  const frame=document.querySelector('.export-map-frame-v51') || document.querySelector('.export-map-frame-v50'); if(!frame) return;
  frame.addEventListener('pointerdown',ev=>{
    if(ev.target===frame || ev.target.classList.contains('export-svg-map')){ v51SetActiveFrame(null,''); v51SelectWidget(''); }
  }, {passive:true});
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBound==='1') return; card.dataset.dragBound='1';
    card.addEventListener('pointerdown',ev=>{
      if(ev.target.closest('.export-card-resize-handle')) return;
      if(ev.target.closest('input,textarea,select,button,a')) return;
      ev.preventDefault();
      v51SelectWidget(card.dataset.exportWidget||'');
      const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect();
      const key=card.dataset.exportWidget; const dx=ev.clientX-cr.left, dy=ev.clientY-cr.top;
      const move=e=>{
        const left=Math.max(8,Math.min(fr.width-card.offsetWidth-8,e.clientX-fr.left-dx));
        const top=Math.max(8,Math.min(fr.height-card.offsetHeight-8,e.clientY-fr.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px';
        state.export.overlayPositions[key]={left:Math.round(left),top:Math.round(top),width:card.offsetWidth};
      };
      const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);};
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    },{passive:false});
  });
  frame.querySelectorAll('.export-card-resize-handle').forEach(handle=>{
    if(handle.dataset.bound==='1') return; handle.dataset.bound='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const card=handle.closest('.export-map-card'); if(!card) return;
      const key=card.dataset.exportWidget||'title';
      v51SelectWidget(key);
      const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect();
      const startX=ev.clientX, startW=cr.width;
      const move=e=>{
        const nw=Math.max(320, Math.min(fr.width-(cr.left-fr.left)-8, startW + (e.clientX-startX)));
        card.style.width=nw+'px';
        const pos=state.export.overlayPositions[key] || {left:Math.round(cr.left-fr.left), top:Math.round(cr.top-fr.top), width:startW};
        pos.width=Math.round(nw); state.export.overlayPositions[key]=pos;
      };
      const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up); renderExportPreviewCard();};
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    },{passive:false});
  });
  const outline=frame.querySelector('.export-field-outline-v51') || frame.querySelector('.export-field-outline-v50');
  if(outline && outline.dataset.dragBound!=='1'){
    outline.dataset.dragBound='1';
    outline.addEventListener('pointerdown',ev=>{
      v51SetActiveFrame(outline,'inner');
      if(ev.target.classList.contains('export-resize-handle')) return;
      ev.preventDefault(); ev.stopPropagation(); state.export.autoFitField=false;
      const fr=frame.getBoundingClientRect(), or=outline.getBoundingClientRect();
      const dx=ev.clientX-or.left, dy=ev.clientY-or.top; const fw=or.width, fh=or.height;
      const move=e=>{ const left=Math.max(0,Math.min(fr.width-fw,e.clientX-fr.left-dx)); const top=Math.max(0,Math.min(fr.height-fh,e.clientY-fr.top-dy)); outline.style.left=left+'px'; outline.style.top=top+'px'; };
      const up=()=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); state.export.innerFrame={x:Math.round(parseFloat(outline.style.left)||0),y:Math.round(parseFloat(outline.style.top)||0),w:Math.round(fw),h:Math.round(fh)}; syncExportDefaults(false); renderExportPreviewCard(); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    },{passive:false});
  }
  frame.querySelectorAll('.export-resize-handle').forEach(handle=>{
    if(handle.dataset.bound==='1') return; handle.dataset.bound='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const dir=handle.dataset.dir; const target=handle.dataset.frame;
      if(target==='inner' && outline) v51SetActiveFrame(outline,'inner');
      const startX=ev.clientX,startY=ev.clientY; const w0=Number(state.export.canvasWidth), h0=Number(state.export.canvasHeight); const f0={...exportMapFieldRect(w0,h0)};
      const move=e=>{
        const dx=e.clientX-startX, dy=e.clientY-startY;
        if(target==='outer'){
          const minW=Math.max(900,(state.export.innerFrame?.x||0)+(state.export.innerFrame?.w||0)+20);
          const minH=Math.max(700,(state.export.innerFrame?.y||0)+(state.export.innerFrame?.h||0)+20);
          state.export.canvasWidth=Math.max(minW,w0+dx);
          state.export.canvasHeight=Math.max(minH,h0+dy);
        }else{
          state.export.autoFitField=false;
          let nw=f0.w+(dir.includes('e')?dx:0); let nh=f0.h+(dir.includes('s')?dy:0);
          state.export.innerFrame={x:f0.x,y:f0.y,w:Math.max(260,Math.min(w0-f0.x,nw)),h:Math.max(260,Math.min(h0-f0.y,nh))};
        }
        syncExportDefaults(false); renderExportPreviewCard();
      };
      const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);};
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    },{passive:false});
  });
}
function positionFloatingExportLauncherV48(){
  const btn=document.getElementById('floatingExportLauncher'); if(!btn) return;
  const panel=document.getElementById('rightPanel'); const gap=20;
  btn.classList.add('floating-export-launcher-v48');
  btn.innerHTML='<span class="floating-export-icon">⇩</span><span class="floating-export-text">Экспорт карты</span>';
  if(panel){
    const r=panel.getBoundingClientRect();
    const targetLeft=Math.max(8, Math.min(window.innerWidth-btn.offsetWidth-8, r.left - btn.offsetWidth - gap));
    const targetTop=Math.max(8, Math.min(window.innerHeight-btn.offsetHeight-8, r.top + gap));
    btn.style.left=`${Math.round(targetLeft)}px`; btn.style.top=`${Math.round(targetTop)}px`;
    btn.style.right='auto'; btn.style.bottom='auto'; btn.style.transform='none';
  }else{ btn.style.right='18px'; btn.style.top='18px'; btn.style.left='auto'; btn.style.transform='none'; }
}
(function initV51Patch(){
  const start=()=>{ bindParentFilterToolbar(); updateParentFilterToolbarState(); positionFloatingExportLauncherV48(); };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else setTimeout(start, 50);
  window.addEventListener('resize', ()=>{ positionFloatingExportLauncherV48(); if(state?.export?.open) v51NormalizeOverlayPositions(false); }, {passive:true});
})();


/* v52: added 1918/1923/1930 layers, categorical hierarchy modes and population-estimation metadata */
function exportContextPresets(year){
  const y=Number(year);
  const base={
    1897:{short:'Конец XIX века: дореволюционная система административно-территориального деления Западной Сибири.', long:'Конец XIX века: дореволюционная система административно-территориального деления Западной Сибири. На карте представлены губернии и области Степного края, внутри которых показаны уезды.'},
    1914:{short:'Позднеимперский этап: сеть губерний, областей и уездов накануне революционных преобразований.', long:'Позднеимперский этап: сеть губерний, областей и уездов накануне революционных преобразований. Для Западной Сибири это финальная версия имперской сетки АТЕ перед советской перекройкой пространства.'},
    1918:{short:'Революционно-переходный этап: ранняя перекройка губернской и уездной сетки после 1917 года.', long:'Революционно-переходный этап: карта фиксирует раннюю перекройку губернской и уездной сетки Западной Сибири после 1917 года. Население для этого слоя рассчитано оценочно методом ареально-временной интерполяции между слоями 1914 и 1926 годов.'},
    1923:{short:'Переход к раннесоветской губернской сетке накануне окружно-районной реформы.', long:'Переходный срез 1923 года показывает позднюю губернско-уездную конфигурацию перед переходом к окружно-районной системе. Население рассчитано оценочно по площадному соответствию со слоями 1914 и 1926 годов.'},
    1926:{short:'Раннесоветский переходный этап: окружно-районная система Сибирского края по материалам переписи 1926 года.', long:'Раннесоветский переходный этап: окружно-районная система Сибирского края по материалам переписи 1926 года.'},
    1930:{short:'Поздний окружной этап перед ликвидацией округов и укрупнением краевой/областной системы.', long:'Срез 1930 года отражает поздний окружной этап административной трансформации перед ликвидацией округов и последующей перестройкой областной сети. Население рассчитано оценочно методом ареально-временной интерполяции между слоями 1926 и 1939 годов.'},
    1939:{short:'Предвоенный советский этап: укрепление областной системы административно-территориального деления.', long:'Предвоенный советский этап: укрепление областной системы административно-территориального деления.'},
    1959:{short:'Послевоенный этап: административная система Западной Сибири по переписи 1959 года.', long:'Послевоенный этап: административная система Западной Сибири по переписи 1959 года.'},
    1970:{short:'Зрелый советский период: сеть районов и областей в условиях устойчивой административной структуры.', long:'Зрелый советский период: сеть районов и областей в условиях устойчивой административной структуры.'},
    1979:{short:'Позднесоветский этап: пространственная структура АТЕ Западной Сибири в конце 1970-х годов.', long:'Позднесоветский этап: пространственная структура АТЕ Западной Сибири в конце 1970-х годов.'},
    1989:{short:'Финальный советский этап: система АТЕ Западной Сибири по переписи 1989 года.', long:'Финальный советский этап: система АТЕ Западной Сибири по переписи 1989 года.'},
    2021:{short:'Современный этап: актуальная система административно-территориального деления и населения.', long:'Современный этап: актуальная система административно-территориального деления и населения.'}
  };
  return base[y] || {short:'Исторический срез административно-территориального деления Западной Сибири.', long:'Исторический срез административно-территориального деления Западной Сибири.'};
}
function defaultExportTitle(){
  const modeTitles={admin_parent:'Административно-территориальное деление', admin_intermediate:'Промежуточный уровень АТД', admin_superparent:'Вышестоящие административные группировки', population:'Население административных единиц', density:'Плотность населения', urban_share:'Доля городского населения', rail_length:'Длина железных дорог в пределах АТЕ', rail_density:'Плотность железных дорог', unit_type:'Типы административных единиц'};
  return `${modeTitles[state.mode] || 'Карта Западной Сибири'} (${state.year} г.)`;
}


/* v54: hotfix updateStats/updateGroupAnalytics after v53 urban split */
function urbanBreakdown(features){
  const total=sum(features.map(f=>Number(f.properties?.population)||0));
  const strictCity=sum(features.map(f=>Number(f.properties?.strict_city_pop)||0));
  const worker=sum(features.map(f=>Number(f.properties?.worker_settlement_pop)||0));
  const broader=sum(features.map(f=>Number(f.properties?.broader_urban_pop)||Number(f.properties?.urban_pop)||0));
  const urbanTotal=broader;
  const ruralTotal=Math.max(0,total-urbanTotal);
  const available=features.some(f=>hasFiniteNumber(f.properties?.urban_pop) || hasFiniteNumber(f.properties?.strict_city_pop) || hasFiniteNumber(f.properties?.worker_settlement_pop) || hasFiniteNumber(f.properties?.broader_urban_pop));
  return {available, urbanTotal, ruralTotal, urbanShare:total?urbanTotal/total:null, strictCityTotal:strictCity, workerSettlementTotal:worker, broaderUrbanTotal:broader};
}
function updateStats(features){
  const all=features.length===0; if(all) features=state.currentGeoJSON.features;
  const total=sum(features.map(f=>Number(f.properties.population)||0));
  const area=sum(features.map(f=>Number(f.properties.area_km2)||0));
  const density=area?total/area:null;
  const parts=urbanBreakdown(features);
  const urbanTotal=parts.urbanTotal; const ruralTotal=parts.ruralTotal; const urbanShare=parts.urbanShare;
  const rails=features.map(f=>Number(f.properties.rail_length_km)||0); const railD=features.map(f=>Number(f.properties.rail_density_km_1000)||0);
  const railwayCount=sum(features.map(f=>Number(f.properties.rail_segments_count)||0));
  const baseAte=features.filter(f=>(Number(f.properties.area_km2)||0)>=700);
  const avgArea=baseAte.length?sum(baseAte.map(f=>Number(f.properties.area_km2)||0))/baseAte.length:0;
  const avgPop=baseAte.length?sum(baseAte.map(f=>Number(f.properties.population)||0))/baseAte.length:0;
  const avgDensity=baseAte.length?sum(baseAte.map(f=>Number(f.properties.density)||0))/baseAte.length:0;
  const avgRail=baseAte.length?sum(baseAte.map(f=>Number(f.properties.rail_length_km)||0))/baseAte.length:0;
  const avgRailD=baseAte.length?sum(baseAte.map(f=>Number(f.properties.rail_density_km_1000)||0))/baseAte.length:0;
  const extraUrban=(parts.strictCityTotal||parts.workerSettlementTotal)?`<div class="metric-line"><span>собственно города</span><b>${num(parts.strictCityTotal)}</b></div><div class="metric-line"><span>рабочие посёлки / ПГТ</span><b>${num(parts.workerSettlementTotal)}</b></div>`:'';
  const html=`<div class="stats-scope ${all?'':'selected-scope'}">${all?'Показанный слой':'Выборка'} · ${state.year}</div><div class="stat-grid"><div class="stat"><div class="k">объектов</div><div class="v">${fmt.format(features.length)}</div></div><div class="stat"><div class="k">население</div><div class="v">${num(total)}</div></div><div class="stat"><div class="k">площадь, км²</div><div class="v">${num(area)}</div></div><div class="stat"><div class="k">плотность</div><div class="v">${density?density.toFixed(2).replace('.',','):'—'}</div><div class="sub">чел./км²</div></div></div><div class="analytics-block"><h3>Базовая статистика</h3><div class="metric-line"><span>городское / несельское население</span><b>${num(urbanTotal)}</b></div>${extraUrban}<div class="metric-line"><span>сельское / прочее население</span><b>${num(ruralTotal)}</b></div><div class="metric-line"><span>доля городского / несельского</span><b>${pct(urbanShare)}</b></div><div class="metric-line"><span>активных ЖД-сегментов</span><b>${num(railwayCount)}</b></div><div class="metric-line"><span>ЖД внутри АТЕ, км</span><b>${num(sum(rails))}</b></div></div><div class="analytics-block"><h3>Средние по АТЕ ≥ 700 км²</h3><div class="metric-line"><span>учтено АТЕ</span><b>${num(baseAte.length)}</b></div><div class="metric-line"><span>средняя площадь</span><b>${num(avgArea)} км²</b></div><div class="metric-line"><span>среднее население</span><b>${num(avgPop)}</b></div><div class="metric-line"><span>средняя плотность</span><b>${num1(avgDensity)}</b></div><div class="metric-line"><span>средняя длина ЖД</span><b>${num1(avgRail)} км</b></div><div class="metric-line"><span>средняя плотность ЖД</span><b>${num1(avgRailD)} км/1000 км²</b></div></div>`;
  const leftStats=$('statsBox'); if(leftStats) leftStats.innerHTML=html;
  const rightStats=$('rightStatsBox'); if(rightStats) rightStats.innerHTML=html;
  updateGroupAnalytics(features);
}
function showFeature(f){
  const p=f.properties||{}; const id=featureId(f); const selected=state.selectedIds.has(id); const sel=$('selectedFeatureSelect');
  if(sel && [...sel.options].some(o=>o.value===id)) sel.value=id;
  $('featureInfo').classList.remove('muted');
  const intermediate=String(p.admin_intermediate || '').trim(); const superparent=String(p.admin_superparent || '').trim();
  const urbanExtra=(hasFiniteNumber(p.strict_city_pop)||hasFiniteNumber(p.worker_settlement_pop)||hasFiniteNumber(p.broader_urban_pop))?`<div class="info-row"><span>Собственно города</span><b>${num(p.strict_city_pop)}</b></div><div class="info-row"><span>Рабочие посёлки / ПГТ</span><b>${num(p.worker_settlement_pop)}</b></div><div class="info-row"><span>Города + РП/ПГТ</span><b>${num(p.broader_urban_pop||p.urban_pop)}</b></div>`:'';
  const urbanMethod=p.urban_pop_method?`<div class="info-row"><span>Метод урбанизации</span><b>${escapeHtml(p.urban_pop_method)}</b></div>`:'';
  $('featureInfo').innerHTML=`<span class="selection-badge ${selected?'on':''}">${selected?'в выборке':'не выбрано'}</span><div class="info-title">${p.name||'Без названия'}</div><div class="info-row"><span>Год</span><b>${p.year||state.year}</b></div><div class="info-row"><span>Тип</span><b>${p.unit_type||'—'}</b></div><div class="info-row"><span>Подчинение</span><b>${p.admin_parent||'—'}</b></div>${intermediate && intermediate!==String(p.admin_parent||'').trim()?`<div class="info-row"><span>Промежуточный уровень</span><b>${escapeHtml(intermediate)}</b></div>`:''}${superparent?`<div class="info-row"><span>Вышестоящая группа</span><b>${escapeHtml(superparent)}</b></div>`:''}<div class="info-row"><span>Центр</span><b>${p.center||'—'}</b></div><div class="info-row"><span>Население</span><b>${num(p.population)}</b></div><div class="info-row"><span>Городское / несельское</span><b>${num(p.urban_pop)}</b></div>${urbanExtra}<div class="info-row"><span>Сельское / прочее</span><b>${num(p.rural_pop)}</b></div><div class="info-row"><span>Доля городского</span><b>${pct(p.urban_share)}</b></div><div class="info-row"><span>Площадь, км²</span><b>${num(p.area_km2)}</b></div><div class="info-row"><span>Плотность</span><b>${p.density==null?'—':Number(p.density).toFixed(2).replace('.',',')}</b></div>${urbanMethod}<div class="info-row"><span>Исходный слой</span><b>${p.source_layer||'—'}</b></div>${objectAttributesHtml(f)}`;
}


/* v55 hotfix: robust export state initialization after v51/v53 overrides */
function v55Finite(v, fallback){
  const n=Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function v55EnsureBox(obj, defaults){
  const out = (obj && typeof obj === 'object') ? obj : {};
  Object.keys(defaults).forEach(k=>{
    if(!Number.isFinite(Number(out[k]))) out[k] = defaults[k];
  });
  return out;
}
function ensureExportFlags(){
  if(!state.export || typeof state.export !== 'object') state.export = {};
  const ex = state.export;
  if(typeof ex.open !== 'boolean') ex.open = false;
  if(!ex.scope) ex.scope = 'currentLayer';
  if(!ex.paper) ex.paper = 'a4Landscape';
  if(!ex.template) ex.template = 'thesis';
  if(!ex.title) ex.title = (typeof defaultExportTitle === 'function' ? defaultExportTitle() : `Карта (${state.year || ''} г.)`);
  if(typeof ex.subtitle !== 'string') ex.subtitle = '';
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k=>{
    if(typeof ex[k] !== 'boolean') ex[k] = true;
  });
  if(!ex.contextMode) ex.contextMode = 'auto';
  if(!ex.contextText){
    const preset = (typeof exportContextPresets === 'function') ? exportContextPresets(state.year || '') : {short:''};
    ex.contextText = preset.short || preset.long || '';
  }
  if(!ex.labelMode) ex.labelMode = 'balanced';
  if(!Number.isFinite(Number(ex.graticuleLabelSize))) ex.graticuleLabelSize = 12;
  if(!Number.isFinite(Number(ex.canvasWidth))) ex.canvasWidth = ex.paper === 'a4Portrait' ? 1240 : ex.paper === 'screen' ? 1760 : 1480;
  if(!Number.isFinite(Number(ex.canvasHeight))) ex.canvasHeight = ex.paper === 'a4Portrait' ? 1680 : ex.paper === 'screen' ? 1040 : 1040;
  if(!Number.isFinite(Number(ex.titleFontSize))) ex.titleFontSize = 34;
  if(!Number.isFinite(Number(ex.panelWidth))) ex.panelWidth = 300;
  ex.extentBuffer = v55EnsureBox(ex.extentBuffer, {top:200,right:200,bottom:200,left:200});
  ex.pagePadding = v55EnsureBox(ex.pagePadding, {top:0,right:0,bottom:0,left:0});
  ex.fieldPadding = v55EnsureBox(ex.fieldPadding, {top:110,right:42,bottom:54,left:42});
  if(typeof ex.autoFitField !== 'boolean') ex.autoFitField = true;
  ex.innerFrame = v55EnsureBox(ex.innerFrame, {x:80,y:130,w:900,h:760});
  if(!ex.overlayPositions || typeof ex.overlayPositions !== 'object') ex.overlayPositions = {};
  if(typeof ex.activeFrame !== 'string') ex.activeFrame = '';
  if(typeof ex.selectedWidget !== 'string') ex.selectedWidget = '';
  if(!ex.statsFields || typeof ex.statsFields !== 'object') ex.statsFields = {};
  const statDefaults = {objects:true,population:true,area:true,density:true,urbanShare:true,urbanPopulation:false,ruralPopulation:false,avgArea:false,avgPopulation:false,avgDensity:false};
  Object.keys(statDefaults).forEach(k=>{ if(typeof ex.statsFields[k] !== 'boolean') ex.statsFields[k] = statDefaults[k]; });
  return ex;
}
function syncExportContextText(){
  const ex = ensureExportFlags();
  const preset = (typeof exportContextPresets === 'function') ? exportContextPresets(state.year || '') : {short:'', long:''};
  if(ex.contextMode === 'short') ex.contextText = preset.short || '';
  else if(ex.contextMode === 'long') ex.contextText = preset.long || preset.short || '';
  else {
    const source = String(preset.long || preset.short || '').replace(/\s+/g,' ').trim();
    const sentences = source.match(/[^.!?]+[.!?]?/g) || [source];
    let out = '';
    for(const sent of sentences){
      const candidate = (out ? out + ' ' : '') + sent.trim();
      if(candidate.length > 220 && out) break;
      out = candidate;
      if(out.length >= 150 && /[.!?]$/.test(out)) break;
    }
    ex.contextText = (out || source).slice(0, 230).replace(/[,:;\-–—]\s*$/,'').trim();
  }
  const t = $('exportContextText');
  if(t) t.value = ex.contextText || '';
}
function exportMapSize(){
  const ex = ensureExportFlags();
  return {w:Math.max(900, v55Finite(ex.canvasWidth,1480)), h:Math.max(700, v55Finite(ex.canvasHeight,1040))};
}
function exportOuterFrameRect(w,h){
  return {x:0, y:0, w:Math.max(900, v55Finite(w,1480)), h:Math.max(700, v55Finite(h,1040))};
}
function exportMapFieldRect(w,h){
  const ex = ensureExportFlags();
  w = Math.max(900, v55Finite(w,1480));
  h = Math.max(700, v55Finite(h,1040));
  if(ex.autoFitField !== false && typeof exportAutoFieldRect === 'function'){
    try{
      const r = exportAutoFieldRect(w,h, typeof exportScopeFeatures === 'function' ? exportScopeFeatures() : []);
      ex.innerFrame = {x:v55Finite(r.x,80), y:v55Finite(r.y,130), w:v55Finite(r.w,900), h:v55Finite(r.h,760)};
      return {...ex.innerFrame, aspect:r.aspect};
    }catch(err){ console.warn('exportAutoFieldRect failed, using manual inner frame', err); }
  }
  const outer = exportOuterFrameRect(w,h);
  let iw = Math.max(260, Math.min(outer.w, v55Finite(ex.innerFrame.w,900)));
  let ih = Math.max(260, Math.min(outer.h, v55Finite(ex.innerFrame.h,760)));
  let ix = Math.max(outer.x, Math.min(outer.x+outer.w-iw, v55Finite(ex.innerFrame.x,80)));
  let iy = Math.max(outer.y, Math.min(outer.y+outer.h-ih, v55Finite(ex.innerFrame.y,130)));
  ex.innerFrame = {x:Math.round(ix), y:Math.round(iy), w:Math.round(iw), h:Math.round(ih)};
  return ex.innerFrame;
}
function syncExportDefaults(resetTitle=true){
  const ex = ensureExportFlags();
  const features = (typeof exportScopeFeatures === 'function') ? exportScopeFeatures() : [];
  if(resetTitle || !ex.title) ex.title = (typeof defaultExportTitle === 'function') ? defaultExportTitle() : `Карта (${state.year || ''} г.)`;
  if(ex.contextMode === 'auto' || resetTitle || !ex.contextText) syncExportContextText();
  if(typeof v51NormalizeOverlayPositions === 'function'){
    try{ v51NormalizeOverlayPositions(false); }catch(err){ console.warn('overlay normalize skipped', err); }
  }
  const size = exportMapSize();
  const f = exportMapFieldRect(size.w, size.h);
  const V=(id,val)=>{ const el=$(id); if(el) el.value=val; };
  const C=(id,val)=>{ const el=$(id); if(el) el.checked=!!val; };
  V('exportTitleInput',ex.title); V('exportTitleFontSize',ex.titleFontSize); V('exportPanelWidth',ex.panelWidth);
  V('exportScopeSelect',ex.scope); V('exportPaperSelect',ex.paper); V('exportCanvasWidth',size.w); V('exportCanvasHeight',size.h);
  C('exportAutoFitField',ex.autoFitField); V('exportInnerX',f.x); V('exportInnerY',f.y); V('exportInnerWidth',f.w); V('exportInnerHeight',f.h);
  ['top','right','bottom','left'].forEach(k=>{
    V('exportBuffer'+k.charAt(0).toUpperCase()+k.slice(1), ex.extentBuffer[k]);
    V('exportPagePad'+k.charAt(0).toUpperCase()+k.slice(1), ex.pagePadding[k]);
    V('exportFieldPad'+k.charAt(0).toUpperCase()+k.slice(1), ex.fieldPadding[k]);
  });
  ['Hydro','Admin','Railways','Population','Labels','Legend','Stats','Context','Graticule','GraticuleLabels','Scale'].forEach(name=>C(`exportShow${name}`,ex[`show${name}`]));
  V('exportLabelModeSelect',ex.labelMode); V('exportGraticuleLabelSizeInput',ex.graticuleLabelSize); V('exportContextMode',ex.contextMode); V('exportContextText',ex.contextText||'');
  const details=$('exportContextDetails'); if(details) details.style.display=ex.showContext?'block':'none';
  const note=$('exportAutoFieldStatus'); if(note && typeof exportFieldStatusText === 'function') note.textContent=exportFieldStatusText();
  if(typeof renderExportStatsFieldsControls === 'function') renderExportStatsFieldsControls();
}
async function openExportMode(){
  const modal = ensureExportModal();
  ensureExportFlags();
  state.export.open = true;
  try{ syncExportDefaults(true); }
  catch(err){ console.error('export defaults failed', err); }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  try{ await refreshExportPreview(false); }
  catch(err){
    console.error('export preview failed', err);
    const status=$('exportPreviewStatus'); if(status) status.textContent='Ошибка построения превью экспорта: '+(err?.message||err);
  }
}
function updateCharts(features){
  if(typeof updateGroupAnalytics === 'function') return updateGroupAnalytics(features || []);
}

/* v56: спорные территории, исправление верхнеуровневого фильтра, ручные диапазоны и доля городского населения */
function v56MetricFields(){ return ['population','area_km2','density','urban_share']; }
function v56EnsureFilterState(){
  if(!state.filters) state.filters={};
  v56MetricFields().forEach(field=>{
    if(!state.filters[field]) state.filters[field]={minFraction:0,maxFraction:1,min:0,max:0,minThreshold:null,maxThreshold:null};
    const f=state.filters[field];
    if(!Number.isFinite(Number(f.minFraction))) f.minFraction=0;
    if(!Number.isFinite(Number(f.maxFraction))) f.maxFraction=1;
  });
}
function v56UrbanShareValue(feature){
  const p=feature?.properties||{};
  let v=Number(p.urban_share);
  if(Number.isFinite(v)) return v>1 ? v/100 : v;
  const pop=Number(p.population)||0;
  const urban=Number(p.broader_urban_pop ?? p.urban_pop ?? p.strict_city_pop ?? 0);
  return pop>0 ? urban/pop : 0;
}
function v56MetricValue(feature, field){
  if(field==='urban_share') return v56UrbanShareValue(feature);
  return Number(feature?.properties?.[field]);
}
function v56MetricLabel(field, value){
  if(value==null || !Number.isFinite(Number(value))) return '—';
  if(field==='urban_share') return `${(Number(value)*100).toFixed(1).replace('.',',')}%`;
  return field==='density' ? num1(value) : num(value);
}
function v56MetricInputValue(field, value){
  if(!Number.isFinite(Number(value))) return '';
  return field==='urban_share' ? (Number(value)*100).toFixed(1).replace(/\.0$/,'') : String(Math.round(Number(value)*100)/100);
}
function v56InputToMetricValue(field, raw){
  const n=Number(String(raw).replace(',','.'));
  if(!Number.isFinite(n)) return null;
  return field==='urban_share' ? n/100 : n;
}
function v56EnsureUrbanFilterCard(){
  const grid=document.querySelector('#metricFilters .metric-filter-grid');
  if(!grid || document.querySelector('[data-filter-field="urban_share"]')) return;
  const card=document.createElement('div');
  card.className='metric-filter-item';
  card.dataset.filterField='urban_share';
  card.innerHTML=`<label>Доля городского населения</label>
    <div class="dual-range" data-filter-field="urban_share">
      <div class="dual-range-track"><span id="filter_urban_share_fill"></span></div>
      <input id="filter_urban_share_minRange" class="dual-range-input min" type="range" min="0" max="100" step="1" value="0" aria-label="Минимальная доля городского населения">
      <input id="filter_urban_share_maxRange" class="dual-range-input max" type="range" min="0" max="100" step="1" value="100" aria-label="Максимальная доля городского населения">
    </div>
    <div class="filter-manual-row"><label>от <input id="filter_urban_share_minInput" type="number" step="0.1" min="0" max="100" inputmode="decimal"></label><label>до <input id="filter_urban_share_maxInput" type="number" step="0.1" min="0" max="100" inputmode="decimal"></label></div>
    <div class="filter-meta"><span id="filter_urban_share_rangeLabel">диапазон слоя</span><b id="filter_urban_share_summary">все</b></div>`;
  grid.appendChild(card);
}
function v56EnsureManualInputs(){
  v56EnsureUrbanFilterCard();
  const labels={population:['1','1'],area_km2:['1','1'],density:['0.1','0.1'],urban_share:['0.1','0.1']};
  v56MetricFields().forEach(field=>{
    const item=document.querySelector(`.metric-filter-item[data-filter-field="${field}"]`);
    if(!item || item.querySelector('.filter-manual-row')) return;
    const meta=item.querySelector('.filter-meta');
    const [step]=labels[field]||['1'];
    const row=document.createElement('div');
    row.className='filter-manual-row';
    row.innerHTML=`<label>от <input id="filter_${field}_minInput" type="number" step="${step}" inputmode="decimal"></label><label>до <input id="filter_${field}_maxInput" type="number" step="${step}" inputmode="decimal"></label>`;
    if(meta) item.insertBefore(row, meta); else item.appendChild(row);
  });
}
function normalizeFilterFractions(field){
  v56EnsureFilterState();
  const filter=state.filters[field];
  filter.minFraction=Math.max(0, Math.min(1, filter.minFraction ?? 0));
  filter.maxFraction=Math.max(0, Math.min(1, filter.maxFraction ?? 1));
  if(filter.minFraction > filter.maxFraction){ const t=filter.minFraction; filter.minFraction=filter.maxFraction; filter.maxFraction=t; }
  filter.minThreshold = metricThreshold(filter,'min');
  filter.maxThreshold = metricThreshold(filter,'max');
}
function metricValueLabel(field, value){ return v56MetricLabel(field,value); }
function updateDualRangeVisual(field){
  v56EnsureFilterState();
  const filter=state.filters[field];
  const minPct=Math.round((filter.minFraction||0)*100);
  const maxPct=Math.round((filter.maxFraction??1)*100);
  const fill=$(`filter_${field}_fill`), minRange=$(`filter_${field}_minRange`), maxRange=$(`filter_${field}_maxRange`);
  if(fill){ fill.style.left=`${minPct}%`; fill.style.width=`${Math.max(0,maxPct-minPct)}%`; }
  if(minRange) minRange.style.setProperty('--thumb-pos', `${minPct}%`);
  if(maxRange) maxRange.style.setProperty('--thumb-pos', `${maxPct}%`);
}
function updateMetricFilterControls(){
  v56EnsureFilterState();
  v56EnsureManualInputs();
  v56MetricFields().forEach(field=>{
    const filter=state.filters[field]; normalizeFilterFractions(field);
    const minRange=$(`filter_${field}_minRange`), maxRange=$(`filter_${field}_maxRange`);
    const minInput=$(`filter_${field}_minInput`), maxInput=$(`filter_${field}_maxInput`);
    const label=$(`filter_${field}_rangeLabel`), summary=$(`filter_${field}_summary`);
    const hasRange=filter.max>filter.min;
    if(minRange){ minRange.value=String(Math.round((filter.minFraction||0)*100)); minRange.disabled=!hasRange; }
    if(maxRange){ maxRange.value=String(Math.round((filter.maxFraction??1)*100)); maxRange.disabled=!hasRange; }
    updateDualRangeVisual(field);
    if(minInput){ minInput.disabled=!hasRange; minInput.value=hasRange ? v56MetricInputValue(field, filter.minThreshold) : ''; }
    if(maxInput){ maxInput.disabled=!hasRange; maxInput.value=hasRange ? v56MetricInputValue(field, filter.maxThreshold) : ''; }
    if(label){ label.textContent=!hasRange ? 'недостаточно данных' : `диапазон слоя: ${v56MetricLabel(field, filter.min)} — ${v56MetricLabel(field, filter.max)}`; }
    if(summary){
      const isFull=(filter.minFraction<=0.0001 && filter.maxFraction>=0.9999);
      summary.textContent=isFull || !hasRange ? 'все' : `${v56MetricLabel(field, filter.minThreshold)} — ${v56MetricLabel(field, filter.maxThreshold)}`;
    }
  });
}
function syncFilterRanges(features){
  v56EnsureFilterState();
  v56MetricFields().forEach(field=>{
    const vals=(features||[]).map(f=>v56MetricValue(f,field)).filter(v=>Number.isFinite(v));
    const filter=state.filters[field];
    filter.min=vals.length ? Math.min(...vals) : 0;
    filter.max=vals.length ? Math.max(...vals) : 0;
    normalizeFilterFractions(field);
  });
  updateMetricFilterControls();
}
function v56SetFilterByRange(field, kind, value, commit=false){
  v56EnsureFilterState();
  const filter=state.filters[field];
  const fraction=Math.max(0, Math.min(1, (Number(value)||0)/100));
  if(kind==='min') filter.minFraction=Math.min(fraction, filter.maxFraction ?? 1);
  else filter.maxFraction=Math.max(fraction, filter.minFraction ?? 0);
  syncFilterRanges(state.rawGeoJSON?.features||[]);
  if(commit) rerenderFilteredLayers();
}
function v56SetFilterByInput(field, kind, raw){
  v56EnsureFilterState();
  const filter=state.filters[field];
  const val=v56InputToMetricValue(field, raw);
  if(val==null || !(filter.max>filter.min)) return updateMetricFilterControls();
  const frac=Math.max(0, Math.min(1, (val-filter.min)/(filter.max-filter.min)));
  if(kind==='min') filter.minFraction=Math.min(frac, filter.maxFraction ?? 1);
  else filter.maxFraction=Math.max(frac, filter.minFraction ?? 0);
  syncFilterRanges(state.rawGeoJSON?.features||[]);
  rerenderFilteredLayers();
}
function v56BindFilterEvents(){
  v56EnsureFilterState(); v56EnsureManualInputs();
  v56MetricFields().forEach(field=>{
    const minR=$(`filter_${field}_minRange`), maxR=$(`filter_${field}_maxRange`), minI=$(`filter_${field}_minInput`), maxI=$(`filter_${field}_maxInput`);
    if(minR && minR.dataset.v56Bound!=='1'){ minR.dataset.v56Bound='1'; minR.addEventListener('input',e=>v56SetFilterByRange(field,'min',e.target.value,false)); minR.addEventListener('change',e=>v56SetFilterByRange(field,'min',e.target.value,true)); }
    if(maxR && maxR.dataset.v56Bound!=='1'){ maxR.dataset.v56Bound='1'; maxR.addEventListener('input',e=>v56SetFilterByRange(field,'max',e.target.value,false)); maxR.addEventListener('change',e=>v56SetFilterByRange(field,'max',e.target.value,true)); }
    if(minI && minI.dataset.v56Bound!=='1'){ minI.dataset.v56Bound='1'; minI.addEventListener('change',e=>v56SetFilterByInput(field,'min',e.target.value)); minI.addEventListener('keydown',e=>{ if(e.key==='Enter') v56SetFilterByInput(field,'min',e.target.value); }); }
    if(maxI && maxI.dataset.v56Bound!=='1'){ maxI.dataset.v56Bound='1'; maxI.addEventListener('change',e=>v56SetFilterByInput(field,'max',e.target.value)); maxI.addEventListener('keydown',e=>{ if(e.key==='Enter') v56SetFilterByInput(field,'max',e.target.value); }); }
  });
  const reset=$('resetMetricFilters');
  if(reset && reset.dataset.v56Bound!=='1'){
    reset.dataset.v56Bound='1';
    reset.addEventListener('click',()=>{
      v56MetricFields().forEach(field=>{ if(state.filters[field]) Object.assign(state.filters[field],{minFraction:0,maxFraction:1,minThreshold:null,maxThreshold:null}); });
      syncFilterRanges(state.rawGeoJSON?.features||[]);
      rerenderFilteredLayers();
    });
  }
}
function featurePassesFilters(f){
  const parent=parentNameFromFeature(f);
  const totalParents=state.parentCounts?.size || 0;
  if(totalParents){
    if(!parent) return false;
    if(state.visibleParents.size===0) return false;
    if(!state.visibleParents.has(parent)) return false;
  }
  return v56MetricFields().every(field=>{
    const filter=state.filters[field];
    if(!filter) return true;
    const isFull=(filter.minFraction<=0.0001 && filter.maxFraction>=0.9999);
    if(isFull) return true;
    const value=v56MetricValue(f,field); if(!Number.isFinite(value)) return false;
    if(filter.minThreshold!=null && value < filter.minThreshold) return false;
    if(filter.maxThreshold!=null && value > filter.maxThreshold) return false;
    return true;
  });
}
function syncVisibleParents(gj){
  gj = typeof enrichHierarchyProps==='function' ? enrichHierarchyProps(gj) : gj;
  const parents=[...new Set((gj?.features||[]).map(parentNameFromFeature).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  state.parentCounts = new Map(parents.map(name=>[name,(gj?.features||[]).filter(f=>parentNameFromFeature(f)===name).length]));
  if(state.parentFilterYear !== state.year){
    state.visibleParents = new Set(parents);
    state.parentFilterYear = state.year;
    state.parentsManuallyCleared=false;
  } else if(state.parentsManuallyCleared){
    state.visibleParents = new Set();
  } else {
    const keep=new Set(parents.filter(name=>state.visibleParents.has(name)));
    state.visibleParents = keep;
  }
  renderParentCheckboxes(parents);
  updateParentFilterToolbarState();
}
function setAllParentsVisible(flag){
  const parents=[...state.parentCounts.keys()];
  state.parentsManuallyCleared = !flag;
  state.visibleParents = flag ? new Set(parents) : new Set();
  renderParentCheckboxes(parents);
  updateParentFilterToolbarState();
  rerenderFilteredLayers();
}
function updateParentFilterToolbarState(){
  const total=(state.parentCounts && state.parentCounts.size) || 0;
  const visible=(state.visibleParents && state.visibleParents.size) || 0;
  const clearBtn=$('clearAllParentsBtn'), showBtn=$('showAllParentsBtn');
  if(clearBtn) clearBtn.disabled = total===0;
  if(showBtn) showBtn.disabled = total===0 || visible===total;
}
function renderParentCheckboxes(parents){
  const box=$('parentCheckboxes'); if(!box) return;
  box.innerHTML='';
  parents.forEach(name=>{
    const id=`parent_${name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g,'_')}`;
    const label=document.createElement('label'); label.className='parent-check';
    label.innerHTML=`<input type="checkbox" id="${id}" ${state.visibleParents.has(name)?'checked':''} data-parent-name="${escapeHtml(name)}"><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><b>${num(state.parentCounts.get(name)||0)}</b>`;
    const input=label.querySelector('input');
    input.addEventListener('change',()=>{
      if(input.checked){ state.parentsManuallyCleared=false; state.visibleParents.add(name); }
      else state.visibleParents.delete(name);
      if(state.visibleParents.size===0) state.parentsManuallyCleared=true;
      updateParentFilterToolbarState(); rerenderFilteredLayers();
    });
    box.appendChild(label);
  });
  updateParentFilterToolbarState();
}
function v56SelectionGuard(){
  const clearRect=()=>{ if(state.tool==='rectangle' && state.dragStart){ clearSelectionDrawing(false); state.dragStart=null; } };
  document.addEventListener('mouseup',()=>window.setTimeout(clearRect,0),{passive:true});
  document.addEventListener('pointerup',()=>window.setTimeout(clearRect,0),{passive:true});
  document.addEventListener('mousemove',ev=>{ if(state.tool==='rectangle' && state.dragStart && ev.buttons===0) clearRect(); },{passive:true});
  if(state.map && state.map.getContainer){
    const c=state.map.getContainer();
    if(c && c.dataset.v56SelectionGuard!=='1'){
      c.dataset.v56SelectionGuard='1';
      c.addEventListener('mouseleave',ev=>{ if(state.tool==='rectangle' && state.dragStart && ev.buttons===0) clearRect(); },{passive:true});
    }
  }
}
(function initV56Patch(){
  const boot=()=>{
    v56EnsureFilterState();
    v56EnsureManualInputs();
    v56BindFilterEvents();
    v56SelectionGuard();
    updateMetricFilterControls();
    updateParentFilterToolbarState();
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,80),{once:true}); else setTimeout(boot,80);
})();

/* v58: окончательный safe-override инициализации экспорта.
   Причина: старый v51-wrapper перехватывал ensureExportFlags и иногда возвращал undefined,
   из-за чего exportMapSize() падал на чтении canvasWidth. */
function ensureExportFlags(){
  if(!window.state && typeof state === 'undefined') return {};
  if(!state.export || typeof state.export !== 'object') state.export = {};
  const ex = state.export;
  const finite = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  const box = (obj, defaults) => {
    const out = (obj && typeof obj === 'object') ? obj : {};
    Object.keys(defaults).forEach(k=>{ if(!Number.isFinite(Number(out[k]))) out[k]=defaults[k]; });
    return out;
  };
  if(typeof ex.open !== 'boolean') ex.open = false;
  if(!ex.scope) ex.scope = 'currentLayer';
  if(!ex.paper) ex.paper = 'a4Landscape';
  if(!ex.template) ex.template = 'thesis';
  if(!ex.projection) ex.projection = 'lambert';
  if(!Number.isFinite(Number(ex.centralMeridian))) ex.centralMeridian = 75;
  if(typeof ex.title !== 'string' || !ex.title) {
    try { ex.title = (typeof defaultExportTitle === 'function') ? defaultExportTitle() : `Административно-территориальное деление (${state.year || ''} г.)`; }
    catch(_) { ex.title = `Административно-территориальное деление (${state.year || ''} г.)`; }
  }
  if(typeof ex.subtitle !== 'string') ex.subtitle = '';
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k=>{
    if(typeof ex[k] !== 'boolean') ex[k] = true;
  });
  if(!ex.contextMode) ex.contextMode = 'auto';
  if(typeof ex.contextText !== 'string') ex.contextText = '';
  if(!ex.labelMode) ex.labelMode = 'balanced';
  if(!Number.isFinite(Number(ex.minPopulation))) ex.minPopulation = 0;
  if(!Number.isFinite(Number(ex.minArea))) ex.minArea = 0;
  if(!Number.isFinite(Number(ex.graticuleLabelSize))) ex.graticuleLabelSize = 12;
  ex.canvasWidth = Math.max(900, finite(ex.canvasWidth, ex.paper === 'a4Portrait' ? 1240 : ex.paper === 'screen' ? 1760 : 1480));
  ex.canvasHeight = Math.max(700, finite(ex.canvasHeight, ex.paper === 'a4Portrait' ? 1680 : ex.paper === 'screen' ? 1040 : 1040));
  if(!Number.isFinite(Number(ex.titleFontSize))) ex.titleFontSize = 34;
  if(!Number.isFinite(Number(ex.panelWidth))) ex.panelWidth = 300;
  ex.extentBuffer = box(ex.extentBuffer, {top:200,right:200,bottom:200,left:200});
  ex.pagePadding = box(ex.pagePadding, {top:0,right:0,bottom:0,left:0});
  ex.fieldPadding = box(ex.fieldPadding, {top:110,right:42,bottom:54,left:42});
  if(typeof ex.autoFitField !== 'boolean') ex.autoFitField = true;
  ex.innerFrame = box(ex.innerFrame, {x:80,y:130,w:900,h:760});
  if(!ex.overlayPositions || typeof ex.overlayPositions !== 'object') ex.overlayPositions = {};
  ['title','stats','legend','context'].forEach(k=>{ if(!ex.overlayPositions[k] || typeof ex.overlayPositions[k] !== 'object') ex.overlayPositions[k] = {}; });
  if(typeof ex.activeFrame !== 'string') ex.activeFrame = '';
  if(typeof ex.selectedWidget !== 'string') ex.selectedWidget = '';
  if(typeof ex.lastCanvasKey !== 'string') ex.lastCanvasKey = '';
  if(!ex.statsFields || typeof ex.statsFields !== 'object') ex.statsFields = {};
  const statDefaults = {objects:true,population:true,area:true,density:true,urbanShare:true,urbanPopulation:false,ruralPopulation:false,avgArea:false,avgPopulation:false,avgDensity:false};
  Object.keys(statDefaults).forEach(k=>{ if(typeof ex.statsFields[k] !== 'boolean') ex.statsFields[k] = statDefaults[k]; });
  return ex;
}
function exportMapSize(){
  const ex = ensureExportFlags();
  const finite = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  return {w:Math.max(900, finite(ex.canvasWidth,1480)), h:Math.max(700, finite(ex.canvasHeight,1040))};
}
(function initV57Patch(){
  const boot=()=>{
    try{ ensureExportFlags(); }catch(e){ console.error('v58 export init failed', e); }
    const status=document.getElementById('exportPreviewStatus');
    if(status && /canvasWidth/.test(status.textContent||'')) status.textContent='Превью готово к обновлению.';
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();



/* v58 hotfix: runtime reassignment after old v51 wrapper.
   Важно: в v51 был оператор `ensureExportFlags = v51EnsureExportFlagsExtra;`.
   Function declarations ниже по файлу не перебивают такой runtime-assignment, поэтому нужен именно
   финальный оператор присваивания в самом конце файла. */
const safeExportFiniteV58 = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const safeExportBoxV58 = (obj, defaults) => {
  const out = (obj && typeof obj === 'object') ? obj : {};
  Object.keys(defaults).forEach(k => {
    if (!Number.isFinite(Number(out[k]))) out[k] = defaults[k];
  });
  return out;
};
ensureExportFlags = function ensureExportFlagsV58(){
  if (typeof state === 'undefined') return {
    canvasWidth: 1480,
    canvasHeight: 1040,
    extentBuffer: {top:200,right:200,bottom:200,left:200},
    pagePadding: {top:0,right:0,bottom:0,left:0},
    fieldPadding: {top:110,right:42,bottom:54,left:42},
    innerFrame: {x:80,y:130,w:900,h:760},
    overlayPositions: {},
    statsFields: {}
  };
  if (!state.export || typeof state.export !== 'object') state.export = {};
  const ex = state.export;
  if (typeof ex.open !== 'boolean') ex.open = false;
  if (!ex.scope) ex.scope = 'currentLayer';
  if (!ex.paper) ex.paper = 'a4Landscape';
  if (!ex.template) ex.template = 'thesis';
  if (!ex.projection) ex.projection = 'lambert';
  if (!Number.isFinite(Number(ex.centralMeridian))) ex.centralMeridian = 75;
  if (typeof ex.title !== 'string' || !ex.title) {
    try { ex.title = (typeof defaultExportTitle === 'function') ? defaultExportTitle() : `Административно-территориальное деление (${state.year || ''} г.)`; }
    catch(_) { ex.title = `Административно-территориальное деление (${state.year || ''} г.)`; }
  }
  if (typeof ex.subtitle !== 'string') ex.subtitle = '';
  ['showLegend','showStats','showContext','showGraticule','showGraticuleLabels','showScale','showAdmin','showHydro','showRailways','showPopulation','showLabels'].forEach(k => {
    if (typeof ex[k] !== 'boolean') ex[k] = true;
  });
  if (!ex.contextMode) ex.contextMode = 'auto';
  if (typeof ex.contextText !== 'string') ex.contextText = '';
  if (!ex.labelMode) ex.labelMode = 'balanced';
  if (!Number.isFinite(Number(ex.minPopulation))) ex.minPopulation = 0;
  if (!Number.isFinite(Number(ex.minArea))) ex.minArea = 0;
  if (!Number.isFinite(Number(ex.graticuleLabelSize))) ex.graticuleLabelSize = 12;
  ex.canvasWidth = Math.max(900, safeExportFiniteV58(ex.canvasWidth, ex.paper === 'a4Portrait' ? 1240 : ex.paper === 'screen' ? 1760 : 1480));
  ex.canvasHeight = Math.max(700, safeExportFiniteV58(ex.canvasHeight, ex.paper === 'a4Portrait' ? 1680 : ex.paper === 'screen' ? 1040 : 1040));
  if (!Number.isFinite(Number(ex.titleFontSize))) ex.titleFontSize = 34;
  if (!Number.isFinite(Number(ex.panelWidth))) ex.panelWidth = 300;
  if (!Number.isFinite(Number(ex.bufferPreset))) ex.bufferPreset = 200;
  ex.extentBuffer = safeExportBoxV58(ex.extentBuffer, {top:200,right:200,bottom:200,left:200});
  ex.pagePadding = safeExportBoxV58(ex.pagePadding, {top:0,right:0,bottom:0,left:0});
  ex.fieldPadding = safeExportBoxV58(ex.fieldPadding, {top:110,right:42,bottom:54,left:42});
  if (typeof ex.autoFitField !== 'boolean') ex.autoFitField = true;
  ex.innerFrame = safeExportBoxV58(ex.innerFrame, {x:80,y:130,w:900,h:760});
  if (!ex.overlayPositions || typeof ex.overlayPositions !== 'object') ex.overlayPositions = {};
  ['title','stats','legend','context'].forEach(k => {
    if (!ex.overlayPositions[k] || typeof ex.overlayPositions[k] !== 'object') ex.overlayPositions[k] = {};
  });
  if (typeof ex.activeFrame !== 'string') ex.activeFrame = '';
  if (typeof ex.selectedWidget !== 'string') ex.selectedWidget = '';
  if (typeof ex.lastCanvasKey !== 'string') ex.lastCanvasKey = '';
  if (!ex.statsFields || typeof ex.statsFields !== 'object') ex.statsFields = {};
  const statDefaults = {objects:true,population:true,area:true,density:true,urbanShare:true,urbanPopulation:false,ruralPopulation:false,avgArea:false,avgPopulation:false,avgDensity:false};
  Object.keys(statDefaults).forEach(k => { if (typeof ex.statsFields[k] !== 'boolean') ex.statsFields[k] = statDefaults[k]; });
  return ex;
};
exportMapSize = function exportMapSizeV58(){
  const ex = ensureExportFlags();
  return {
    w: Math.max(900, safeExportFiniteV58(ex && ex.canvasWidth, 1480)),
    h: Math.max(700, safeExportFiniteV58(ex && ex.canvasHeight, 1040))
  };
};
/* Принудительно прогреваем состояние после финального присваивания. */
try { ensureExportFlags(); } catch(e) { console.error('v58 export state init failed', e); }
