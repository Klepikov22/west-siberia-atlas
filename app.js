const APP_VERSION = '120';
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
  soft:['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#d9d9d9','#66c2a5','#fc8d62','#8da0cb','#e78ac3','#a6d854','#ffd92f','#e5c494','#b3b3b3'],
  paper:['#c7b37a','#9fb17b','#d6a66f','#a9b8b5','#c7967d','#b7a18a','#9da77f','#d8c590','#bfa080','#c8bca3','#b8a06a','#91ab76','#c98e65','#98aaa9','#ba8a74','#ad957e','#8f9a72','#d2bd84','#b09272','#b8af98'],
  thin:['#b6d7c9','#dce9b8','#c7c5df','#e6b7a9','#accbe1','#eac989','#bddaaa','#e4c3d2','#c8b6cf','#d5e4c9','#a9cfbf','#d5e2aa','#bab8d7','#ddb09f','#9ec3db','#dfc081','#b2d39d','#dbb8ca','#beacc7','#cadbbd'],
  ink:['#b8c7cf','#d8d4b2','#b3adc8','#c7a493','#9fb5c2','#c6aa78','#a9b28b','#c3a7ba','#a99db6','#c5c4ad','#9eb1bc','#c9c39f','#9f97bb','#b89180','#8fa8b7','#b69667','#99a37d','#b393ac','#968cab','#b6b39d'],
  vivid:['#2dd4bf','#facc15','#a78bfa','#fb7185','#38bdf8','#f59e0b','#84cc16','#f472b6','#c084fc','#22c55e','#14b8a6','#eab308','#8b5cf6','#ef4444','#0ea5e9','#f97316','#65a30d','#ec4899','#a855f7','#10b981'],
  contrast:['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02','#a6761d','#1f78b4','#b2df8a','#fb9a99','#33a02c','#ff7f00','#6a3d9a','#a6cee3','#b15928','#cab2d6','#ffff99','#8dd3c7','#bebada','#fb8072'],
  matchaLatte:['#b8d2a0','#efe4bd','#97b989','#d8cda3','#accbb4','#c9b07e','#e6d7b0','#88aa7d','#c4d7a1','#b2c7ad','#a6c28e','#e5d8aa','#87ad7a','#cfc391','#9dc0a8','#bfa36e','#dccd9e','#7d9c73','#bbcf95','#a7bc9f']
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
function isAnalyticsFeature(f){ return f?.properties?.include_in_analytics !== false; }
function isSelectableFeature(f){ return f?.properties?.include_in_selection !== false; }
const specialStatusStyleMap = {
  unstable_control:{color:'#9a6a36', fillOpacity:.12, dashArray:'7 6'},
  low_control_frontier:{color:'#9a6a36', fillOpacity:.10, dashArray:'3 7'},
  no_uezd_russian_siberia:{color:'#7f8e61', fillOpacity:.14, dashArray:'9 5'},
  disputed_affiliation:{color:'#9b8794', fillOpacity:.13, dashArray:'5 5'},
  disputed_berezov_mangazeya:{color:'#ad7f9a', fillOpacity:.13, dashArray:'4 5 1 5'},
  double_tax_volosts:{color:'#b18a3d', fillOpacity:.12, dashArray:'2 5'},
  qing_frontier:{color:'#7c79a8', fillOpacity:.10, dashArray:'10 4 2 4'},
  kazakh_steppe:{color:'#b89257', fillOpacity:.11, dashArray:'3 8'},
  mining_department:{color:'#a55e1a', fillOpacity:.15, dashArray:'12 4'},
  context_only:{color:'#8a8f92', fillOpacity:.07, dashArray:'2 6'},
  external_district_context:{color:'#728aa1', fillOpacity:.12, dashArray:'8 4'}
};
function specialStatusStyle(feature){
  const code=String(feature?.properties?.special_status_code || '').trim();
  if(!code || code==='normal') return null;
  return specialStatusStyleMap[code] || {color:'#8b8580', fillOpacity:.10, dashArray:'5 5'};
}
function specialStatusLabel(code){
  const labels={
    unstable_control:'зона неустойчивого контроля',
    low_control_frontier:'зона слабого контроля',
    no_uezd_russian_siberia:'в составе Российской Сибири без уезда',
    disputed_affiliation:'спорная / неясная принадлежность',
    disputed_berezov_mangazeya:'Берёзовско-Мангазейский спорный фрагмент',
    double_tax_volosts:'двоеданческие волости',
    qing_frontier:'пограничная зона Россия / Цин',
    kazakh_steppe:'степная территория вне регулярной уездной сети',
    mining_department:'горнозаводское ведомство',
    context_only:'контекстная территория',
    external_district_context:'внешний округ / степная периферия'
  };
  return labels[code] || code;
}
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
  const fp=f?.properties||{};
  if(fp.filter_exempt_metric_filters === true || fp.always_visible_in_filters === true) return true;
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
  on('modeSelect','change', async e=>{state.mode=e.target.value; state.colors={}; const seq=state.refreshSeq; await refreshAdmin(seq);});
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
  ['toggleHydro','toggleAdmin','toggleCenters','toggleRailways','toggleCircles','toggleTopologyEdgesMain','toggleTopologyCentroids'].forEach(id=>on(id,'change', refreshVisibility));
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
  ['rivers','water','admin','circles','centers','labels','centerLabels','railways','topologyGraph','topologyCentroids'].forEach(clearLayer);
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
  const special=specialStatusStyle(feature);
  if(special && !selected){
    return {color:special.color, weight:Math.max(1.15,(cfg.weight||1.05)+.25), opacity:.96, dashArray:special.dashArray||'5 5', lineJoin:'round', lineCap:'round', fillColor:fill, fillOpacity:special.fillOpacity};
  }
  return {color:selected?s.selectedLine:(cfg.line||s.adminLine), weight:selected?(cfg.selectedWeight||2.8):(cfg.weight||1.05), opacity:selected?1:(cfg.opacity??.92), dashArray:selected?null:(cfg.dashArray||null), lineJoin:'round', lineCap:'round', fillColor:fill, fillOpacity:selected?Math.min(.74,(cfg.fillOpacity??s.adminFillOpacity)+.14):(cfg.fillOpacity??s.adminFillOpacity)};
}
async function refreshAdmin(seq){
  clearLayer('admin'); clearLayer('circles'); state.adminLayerById.clear();
  const path=state.manifest.layers.admin[String(state.year)]; const raw=normalizeAdminStats(await loadJson(path));
  if(isStaleRefresh(seq)) return;
  state.rawGeoJSON=raw;
  syncVisibleParents(raw);
  syncFilterRanges((raw.features||[]).filter(isAnalyticsFeature));
  const gj=filteredGeoJSON(raw);
  state.currentGeoJSON=gj;
  const visibleIds=new Set(gj.features.map(featureId));
  state.selectedIds = new Set([...state.selectedIds].filter(id=>visibleIds.has(id)));
  const field=valField(); const vals=field?gj.features.filter(isAnalyticsFeature).map(f=>Number(f.properties[field])).filter(v=>!Number.isNaN(v)):[]; state._lastVals=vals;
  const admin=L.geoJSON(gj,{style:f=>adminStyle(f,vals), onEachFeature:(f,l)=>{
    const id=featureId(f); state.adminLayerById.set(id,l);
    l.on('click',()=>{ if(state.tool !== 'pan') return; if(isSelectableFeature(f)) toggleSelection(f); showFeature(f);});
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
  const vals=state.currentGeoJSON?.features?.filter(isAnalyticsFeature).map(f=>Number(f.properties?.population)||0).filter(v=>v>0) || [maxPop||1];
  return populationSymbolSize(pop, vals);
}
function buildPopulationBarMarker(latlng, f, height, s){
  const width=Math.max(8, Math.min(18, Math.round(height*.32)));
  const html=`<div class="population-bar-symbol" style="width:${width}px;height:${height}px;background:${s.barFill};border-color:${s.barLine};"></div>`;
  return L.marker(latlng,{interactive:true, icon:L.divIcon({className:'population-bar-icon', html, iconSize:[width+8,height+8], iconAnchor:[Math.round((width+8)/2), height+6]})});
}
function buildCircles(admin, gj){
  clearLayer('circles');
  const s=styleVars(); const vals=gj.features.filter(isAnalyticsFeature).map(f=>Number(f.properties.population)||0).filter(v=>v>0);
  const maxPop=Math.max(...vals,1); const minPop=Math.min(...vals, maxPop);
  state.maxPop=maxPop; state.minPop=minPop; state.layers.circles=L.layerGroup();
  admin.eachLayer(layer=>{
    const f=layer.feature; if(!isAnalyticsFeature(f)) return; const p=f.properties; const pop=Number(p.population)||0; if(!pop) return;
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
    m.on('mouseover',(e)=>showHoverLater({title:cleanCenterLabelName(p.name||'центр'), subtitle:p.host_name || p.unit_name || p.admin_parent || p.status || (city?'город':'центр'), population:pop, extra:p.point_layer_role==='city_point'?'городская точка':(city?'город / городской центр':'центр')}, e.originalEvent));
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

function toggleSelection(f){ if(!isSelectableFeature(f)) { showFeature(f); return; } const id=featureId(f); if(state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id); refreshSelectionStyles(); updateStatsAndSelection(); showFeature(f); }
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
function selectedFeatures(){ if(!state.currentGeoJSON) return []; const base=state.currentGeoJSON.features.filter(isAnalyticsFeature); if(!state.selectedIds.size) return base; return base.filter(f=>state.selectedIds.has(featureId(f))); }
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
  const modal=ensurePieLightbox(); modal.classList.remove('topology-trends-modal-v91'); const head=modal.querySelector('#chartLightboxTitle'); const body=modal.querySelector('#chartLightboxBody'); if(body) body.className='chart-lightbox-body';
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
  const rows=Object.entries(props).map(([k,v])=>`<div class="info-row attr-object-row"><span>${escapeHtml(k)}</span><b>${v===null||v===undefined||v===''?'—':escapeHtml(String(v))}</b></div>`).join('');
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
  info.innerHTML=`<span class="selection-badge on">центр</span><div class="info-title">${escapeHtml(p.name||'Центр')}</div><div class="info-row"><span>Единица / район</span><b>${escapeHtml(p.host_name||p.unit_name||'—')}</b></div><div class="info-row"><span>Подчинение</span><b>${escapeHtml(p.admin_parent||'—')}</b></div><div class="info-row"><span>Население точки</span><b>${num(pointPopulation(p))}</b></div><div class="info-row"><span>Источник показателя</span><b>${escapeHtml(p.center_pop_urban_source||'—')}</b></div>${objectAttributesHtml(f)}`;
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

init().then(()=>{ try{ v84RenderSpecialLayerControls(); }catch(e){ console.warn('v84 special controls init failed', e); } }).catch(err=>{console.error(err); alert('Ошибка загрузки данных: '+err.message);});

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
          <input id="exportCanvasWidth" class="export-text-input" type="number" min="500" step="20">
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
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(500, Number(e.target.value)||1480); renderExportPreviewCard(); });
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
  return {w: Math.max(500, Number(state.export.canvasWidth)||1480), h: Math.max(700, Number(state.export.canvasHeight)||1040)};
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
        <div><label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="500" step="20"></div>
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
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(500, Number(e.target.value)||1480); renderExportPreviewCard(); });
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
function exportMapSize(){ ensureExportFlags(); return {w: Math.max(500, Number(state.export.canvasWidth)||1480), h: Math.max(700, Number(state.export.canvasHeight)||1040)}; }
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
        <div><label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="500" step="20"></div>
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
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(500, Number(e.target.value)||1480); renderExportPreviewCard(); });
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
        <div><label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="500" step="20"></div>
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
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(500, Number(e.target.value)||1480); renderExportPreviewCard(); });
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
      <div class="export-form-grid2"><div><label class="control-label" for="exportCanvasWidth">Ширина PNG, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="500" step="20"></div><div><label class="control-label" for="exportCanvasHeight">Высота PNG, px</label><input id="exportCanvasHeight" class="export-text-input" type="number" min="700" step="20"></div></div>
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
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(500, Number(e.target.value)||1480); renderExportPreviewCard(); });
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
function exportMapSize(){ ensureExportFlags(); return {w:Math.max(500, v50Number(state.export.canvasWidth,1480)), h:Math.max(700, v50Number(state.export.canvasHeight,1040))}; }
function exportOuterFrameRect(w,h){ return {x:0,y:0,w:Math.max(500,w),h:Math.max(700,h)}; }
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
      <div class="export-fieldset"><div class="export-fieldset-title">Внешняя рамка PNG</div><div class="export-form-grid2"><div><label class="control-label" for="exportCanvasWidth">Ширина внешней рамки, px</label><input id="exportCanvasWidth" class="export-text-input" type="number" min="500" step="20"></div><div><label class="control-label" for="exportCanvasHeight">Высота внешней рамки, px</label><input id="exportCanvasHeight" class="export-text-input" type="number" min="700" step="20"></div></div></div>
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
  bind('exportCanvasWidth','input', e=>{ state.export.canvasWidth=Math.max(500,Number(e.target.value)||1480); clampInnerFrameToOuter(); renderExportPreviewCard(); });
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
    handle.addEventListener('pointerdown',ev=>{ ev.preventDefault(); ev.stopPropagation(); const dir=handle.dataset.dir; const target=handle.dataset.frame; const startX=ev.clientX,startY=ev.clientY; const w0=Number(state.export.canvasWidth), h0=Number(state.export.canvasHeight); const f0={...exportMapFieldRect(w0,h0)}; const move=e=>{ const dx=e.clientX-startX, dy=e.clientY-startY; if(target==='outer'){ const minW=Math.max(500,(state.export.innerFrame?.x||0)+(state.export.innerFrame?.w||0)+20); const minH=Math.max(700,(state.export.innerFrame?.y||0)+(state.export.innerFrame?.h||0)+20); state.export.canvasWidth=Math.max(minW,w0+dx); state.export.canvasHeight=Math.max(minH,h0+dy); }else{ state.export.autoFitField=false; let nw=f0.w+(dir.includes('e')?dx:0); let nh=f0.h+(dir.includes('s')?dy:0); state.export.innerFrame={x:f0.x,y:f0.y,w:Math.max(260,Math.min(w0-f0.x,nw)),h:Math.max(260,Math.min(h0-f0.y,nh))}; } syncExportDefaults(false); renderExportPreviewCard(); }; const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);}; document.addEventListener('pointermove',move); document.addEventListener('pointerup',up); },{passive:false});
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
  'Ойратская АО':'Сибирский край',
  'Омский округ':'Сибирский край',
  'Рубцовский округ':'Сибирский край',
  'Славгородский':'Сибирский край',
  'Славгородский округ':'Сибирский край',
  'Тарский округ':'Сибирский край',
  'Тобольский округ':'Уральская область',
  'Томский округ':'Сибирский край',
  'Тюменский округ':'Уральская область',
  'Шадринский округ':'Уральская область'
};
const V81_POST1939_GROUP_OVERRIDES = {
  'ХМАО':'Тюменская область',
  'Ханты-Мансийский автономный округ':'Тюменская область',
  'ЯНАО':'Тюменская область',
  'Ямало-Ненецкий автономный округ':'Тюменская область',
  'Горно-Алтайская автономная область':'Алтайский край',
  'Горно-Алтайская АО':'Алтайский край'
};
function deriveAdminSuperparent(props){
  const explicit=String(props?.admin_superparent || props?.admin_group || props?.super_parent || '').trim();
  if(explicit) return explicit;
  const parent=String(props?.admin_parent || '').trim();
  const intermediate=String(props?.admin_intermediate || '').trim();
  const key=intermediate || parent;
  const year=Number(props?.year || state.year || 0);
  if(year===1926 && key) return V51_1926_PARENT_GROUPS[key] || V51_1926_PARENT_GROUPS[parent] || '';
  if(year>=2021 && parent==='Республика Алтай') return parent;
  if(year>=1947 && parent) return V81_POST1939_GROUP_OVERRIDES[parent] || parent;
  return '';
}
function enrichHierarchyProps(gj){
  if(!gj?.features) return gj;
  gj.features.forEach(f=>{
    if(!f.properties) f.properties={};
    const year=Number(f.properties.year || state.year || 0);
    if(year===1926 && String(f.properties.admin_parent || '').trim()==='Славгородский') f.properties.admin_parent='Славгородский округ';
    if(!f.properties.admin_intermediate) f.properties.admin_intermediate = String(f.properties.admin_parent || '').trim() || '';
    if(year===1926 && String(f.properties.admin_intermediate || '').trim()==='Славгородский') f.properties.admin_intermediate='Славгородский округ';
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
          const minW=Math.max(500,(state.export.innerFrame?.x||0)+(state.export.innerFrame?.w||0)+20);
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
  return {w:Math.max(500, v55Finite(ex.canvasWidth,1480)), h:Math.max(700, v55Finite(ex.canvasHeight,1040))};
}
function exportOuterFrameRect(w,h){
  return {x:0, y:0, w:Math.max(500, v55Finite(w,1480)), h:Math.max(700, v55Finite(h,1040))};
}
function exportMapFieldRect(w,h){
  const ex = ensureExportFlags();
  w = Math.max(500, v55Finite(w,1480));
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
  const fp=f?.properties||{};
  if(fp.filter_exempt_metric_filters === true || fp.always_visible_in_filters === true) return true;
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
  ex.canvasWidth = Math.max(500, finite(ex.canvasWidth, ex.paper === 'a4Portrait' ? 1240 : ex.paper === 'screen' ? 1760 : 1480));
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
  return {w:Math.max(500, finite(ex.canvasWidth,1480)), h:Math.max(700, finite(ex.canvasHeight,1040))};
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
  ex.canvasWidth = Math.max(500, safeExportFiniteV58(ex.canvasWidth, ex.paper === 'a4Portrait' ? 1240 : ex.paper === 'screen' ? 1760 : 1480));
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
    w: Math.max(500, safeExportFiniteV58(ex && ex.canvasWidth, 1480)),
    h: Math.max(700, safeExportFiniteV58(ex && ex.canvasHeight, 1040))
  };
};
/* Принудительно прогреваем состояние после финального присваивания. */
try { ensureExportFlags(); } catch(e) { console.error('v58 export state init failed', e); }

/* v59: hide export resize affordances after mouse release and keep filter UI accessible */
function clearExportEditingAffordancesV59(){
  try{
    if(!state || !state.export) return;
    state.export.activeFrame='';
    state.export.selectedWidget='';
  }catch(_){ }
  document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50').forEach(el=>{
    el.classList.remove('is-selected');
    el.classList.add('export-resize-muted');
  });
  document.querySelectorAll('.export-map-card-v50').forEach(el=>{
    el.classList.remove('is-selected');
    el.classList.add('export-resize-muted');
  });
}
function activateExportInnerFrameV59(el){
  if(!el) return;
  try{ if(state?.export) state.export.activeFrame='inner'; }catch(_){ }
  el.classList.remove('export-resize-muted');
  document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50').forEach(node=>node.classList.toggle('is-selected', node===el));
}
function activateExportWidgetV59(card){
  if(!card) return;
  const key=card.dataset.exportWidget||'';
  try{ if(state?.export) state.export.selectedWidget=key; }catch(_){ }
  card.classList.remove('export-resize-muted');
  document.querySelectorAll('.export-map-card-v50').forEach(node=>node.classList.toggle('is-selected', node===card));
}
if(typeof v51SetActiveFrame === 'function'){
  v51SetActiveFrame = function v51SetActiveFrameV59(frameEl, name){
    document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50').forEach(el=>{
      const on = name==='inner' && el===frameEl;
      el.classList.toggle('is-selected', on);
      if(on) el.classList.remove('export-resize-muted');
    });
    if(state?.export) state.export.activeFrame = name || '';
  };
}
if(typeof v51SelectWidget === 'function'){
  v51SelectWidget = function v51SelectWidgetV59(key){
    if(state?.export) state.export.selectedWidget = key || '';
    document.querySelectorAll('.export-map-card-v50').forEach(el=>{
      const on = !!key && el.dataset.exportWidget===key;
      el.classList.toggle('is-selected', on);
      if(on) el.classList.remove('export-resize-muted');
    });
  };
}
initExportOverlayDrag = function initExportOverlayDragV59(){
  const frame=document.querySelector('.export-map-frame-v51') || document.querySelector('.export-map-frame-v50');
  if(!frame) return;
  if(frame.dataset.v59Bound!=='1'){
    frame.dataset.v59Bound='1';
    frame.addEventListener('pointerdown',ev=>{
      if(ev.target===frame || ev.target.classList.contains('export-svg-map')) clearExportEditingAffordancesV59();
    }, {passive:true});
  }
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBoundV59==='1') return;
    card.dataset.dragBoundV59='1';
    card.addEventListener('pointerdown',ev=>{
      if(ev.target.closest('.export-card-resize-handle')) return;
      if(ev.target.closest('input,textarea,select,button,a')) return;
      ev.preventDefault();
      activateExportWidgetV59(card);
      const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect();
      const key=card.dataset.exportWidget||'card';
      const dx=ev.clientX-cr.left, dy=ev.clientY-cr.top;
      let moved=false;
      const move=e=>{
        moved=true;
        const left=Math.max(8,Math.min(fr.width-card.offsetWidth-8,e.clientX-fr.left-dx));
        const top=Math.max(8,Math.min(fr.height-card.offsetHeight-8,e.clientY-fr.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px';
        ensureExportFlags();
        state.export.overlayPositions[key]={left:Math.round(left),top:Math.round(top),width:card.offsetWidth};
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        if(moved){
          card.classList.add('export-resize-muted');
          clearExportEditingAffordancesV59();
        }
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
  frame.querySelectorAll('.export-card-resize-handle').forEach(handle=>{
    if(handle.dataset.boundV59==='1') return;
    handle.dataset.boundV59='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const card=handle.closest('.export-map-card'); if(!card) return;
      const key=card.dataset.exportWidget||'title';
      activateExportWidgetV59(card);
      const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect();
      const startX=ev.clientX, startW=cr.width;
      const move=e=>{
        const nw=Math.max(320, Math.min(fr.width-(cr.left-fr.left)-8, startW + (e.clientX-startX)));
        card.style.width=nw+'px';
        ensureExportFlags();
        const pos=state.export.overlayPositions[key] || {left:Math.round(cr.left-fr.left), top:Math.round(cr.top-fr.top), width:startW};
        pos.width=Math.round(nw); state.export.overlayPositions[key]=pos;
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        card.classList.add('export-resize-muted');
        clearExportEditingAffordancesV59();
        renderExportPreviewCard();
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
  const outline=frame.querySelector('.export-field-outline-v51') || frame.querySelector('.export-field-outline-v50');
  if(outline && outline.dataset.dragBoundV59!=='1'){
    outline.dataset.dragBoundV59='1';
    outline.addEventListener('pointerdown',ev=>{
      activateExportInnerFrameV59(outline);
      if(ev.target.classList.contains('export-resize-handle')) return;
      ev.preventDefault(); ev.stopPropagation();
      ensureExportFlags();
      state.export.autoFitField=false;
      const fr=frame.getBoundingClientRect(), or=outline.getBoundingClientRect();
      const dx=ev.clientX-or.left, dy=ev.clientY-or.top; const fw=or.width, fh=or.height;
      let moved=false;
      const move=e=>{
        moved=true;
        const left=Math.max(0,Math.min(fr.width-fw,e.clientX-fr.left-dx));
        const top=Math.max(0,Math.min(fr.height-fh,e.clientY-fr.top-dy));
        outline.style.left=left+'px'; outline.style.top=top+'px';
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        state.export.innerFrame={x:Math.round(parseFloat(outline.style.left)||0),y:Math.round(parseFloat(outline.style.top)||0),w:Math.round(fw),h:Math.round(fh)};
        outline.classList.add('export-resize-muted');
        clearExportEditingAffordancesV59();
        if(moved) renderExportPreviewCard(); else syncExportDefaults(false);
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  }
  frame.querySelectorAll('.export-resize-handle').forEach(handle=>{
    if(handle.dataset.boundV59==='1') return;
    handle.dataset.boundV59='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      ensureExportFlags();
      const dir=handle.dataset.dir; const target=handle.dataset.frame;
      if(target==='inner' && outline) activateExportInnerFrameV59(outline);
      const startX=ev.clientX,startY=ev.clientY;
      const size0=exportMapSize();
      const w0=Number(size0.w), h0=Number(size0.h);
      const f0={...exportMapFieldRect(w0,h0)};
      const move=e=>{
        const dx=e.clientX-startX, dy=e.clientY-startY;
        if(target==='outer'){
          const minW=Math.max(500,(state.export.innerFrame?.x||0)+(state.export.innerFrame?.w||0)+20);
          const minH=Math.max(700,(state.export.innerFrame?.y||0)+(state.export.innerFrame?.h||0)+20);
          state.export.canvasWidth=Math.max(minW,w0+dx);
          state.export.canvasHeight=Math.max(minH,h0+dy);
        }else{
          state.export.autoFitField=false;
          const nw=f0.w+(dir.includes('e')?dx:0);
          const nh=f0.h+(dir.includes('s')?dy:0);
          state.export.innerFrame={x:f0.x,y:f0.y,w:Math.max(260,Math.min(w0-f0.x,nw)),h:Math.max(260,Math.min(h0-f0.y,nh))};
        }
        syncExportDefaults(false);
        renderExportPreviewCard();
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        if(outline) outline.classList.add('export-resize-muted');
        clearExportEditingAffordancesV59();
        renderExportPreviewCard();
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
};
(function initV59Patch(){
  const boot=()=>{
    try{
      document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50,.export-map-card-v50').forEach(el=>el.classList.add('export-resize-muted'));
      const mf=document.getElementById('metricFilters');
      if(mf){ mf.classList.add('metric-filters-scrollable-v59'); }
    }catch(e){ console.warn('v59 UI patch init failed', e); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();

/* v60: export frame edit mode by click; move only in normal mode; filter panel full scrolling */
function clearExportEditingAffordancesV60(){
  try{
    ensureExportFlags();
    state.export.activeFrame='';
    state.export.selectedWidget='';
  }catch(_){ }
  document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50').forEach(el=>{
    el.classList.remove('is-selected','is-editing');
    el.classList.add('export-resize-muted');
  });
  document.querySelectorAll('.export-map-card-v50').forEach(el=>{
    el.classList.remove('is-selected','is-editing');
    el.classList.add('export-resize-muted');
  });
}
function activateExportInnerFrameV60(el){
  if(!el) return;
  try{ ensureExportFlags(); state.export.activeFrame='inner'; }catch(_){ }
  document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50').forEach(node=>{
    const on=node===el;
    node.classList.toggle('is-selected', on);
    node.classList.toggle('is-editing', on);
    if(on) node.classList.remove('export-resize-muted'); else node.classList.add('export-resize-muted');
  });
  document.querySelectorAll('.export-map-card-v50').forEach(node=>node.classList.add('export-resize-muted'));
}
function activateExportWidgetV60(card){
  if(!card) return;
  const key=card.dataset.exportWidget||'';
  try{ ensureExportFlags(); state.export.selectedWidget=key; }catch(_){ }
  document.querySelectorAll('.export-map-card-v50').forEach(node=>{
    const on=node===card;
    node.classList.toggle('is-selected', on);
    node.classList.toggle('is-editing', on);
    if(on) node.classList.remove('export-resize-muted'); else node.classList.add('export-resize-muted');
  });
  document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50').forEach(node=>node.classList.add('export-resize-muted'));
}
function applyMetricFilterScrollV60(){
  const panel=document.getElementById('metricFilters');
  if(!panel) return;
  panel.classList.add('metric-filters-scrollable-v60');
  const grid=panel.querySelector('.metric-filter-grid');
  if(grid) grid.classList.add('metric-filter-grid-scroll-v60');
}
initExportOverlayDrag = function initExportOverlayDragV60(){
  const frame=document.querySelector('.export-map-frame-v51') || document.querySelector('.export-map-frame-v50');
  if(!frame) return;
  if(frame.dataset.v60OuterBound!=='1'){
    frame.dataset.v60OuterBound='1';
    frame.addEventListener('pointerdown',ev=>{
      if(!ev.target.closest('.export-field-outline-v51,.export-field-outline-v50,.export-map-card-v50,.export-resize-handle,.export-card-resize-handle')){
        clearExportEditingAffordancesV60();
      }
    }, {passive:true});
  }
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBoundV60==='1') return;
    card.dataset.dragBoundV60='1';
    card.addEventListener('pointerdown',ev=>{
      if(ev.target.closest('.export-card-resize-handle')) return;
      if(ev.target.closest('input,textarea,select,button,a')) return;
      ev.preventDefault(); ev.stopPropagation();
      activateExportWidgetV60(card);
      const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect();
      const key=card.dataset.exportWidget||'card';
      const dx=ev.clientX-cr.left, dy=ev.clientY-cr.top;
      let moved=false;
      const move=e=>{
        moved=true;
        const left=Math.max(8,Math.min(fr.width-card.offsetWidth-8,e.clientX-fr.left-dx));
        const top=Math.max(8,Math.min(fr.height-card.offsetHeight-8,e.clientY-fr.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px';
        ensureExportFlags();
        state.export.overlayPositions[key]={left:Math.round(left),top:Math.round(top),width:card.offsetWidth};
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        // Для заголовка и прочих карточек ручки скрываются сразу после отпускания.
        clearExportEditingAffordancesV60();
        if(moved) syncExportDefaults(false);
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
  frame.querySelectorAll('.export-card-resize-handle').forEach(handle=>{
    if(handle.dataset.boundV60==='1') return;
    handle.dataset.boundV60='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const card=handle.closest('.export-map-card'); if(!card) return;
      const key=card.dataset.exportWidget||'title';
      activateExportWidgetV60(card);
      const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect();
      const startX=ev.clientX, startW=cr.width;
      const move=e=>{
        const nw=Math.max(320, Math.min(fr.width-(cr.left-fr.left)-8, startW + (e.clientX-startX)));
        card.style.width=nw+'px';
        ensureExportFlags();
        const pos=state.export.overlayPositions[key] || {left:Math.round(cr.left-fr.left), top:Math.round(cr.top-fr.top), width:startW};
        pos.width=Math.round(nw); state.export.overlayPositions[key]=pos;
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        clearExportEditingAffordancesV60();
        renderExportPreviewCard();
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
  const outline=frame.querySelector('.export-field-outline-v51') || frame.querySelector('.export-field-outline-v50');
  if(outline && outline.dataset.dragBoundV60!=='1'){
    outline.dataset.dragBoundV60='1';
    outline.addEventListener('pointerdown',ev=>{
      const isHandle=!!ev.target.closest('.export-resize-handle');
      const isEditing=outline.classList.contains('is-editing') || (state?.export?.activeFrame==='inner');
      // В режиме редактирования внутренняя рамка НЕ двигается, работают только ручки.
      if(isEditing && !isHandle){ ev.preventDefault(); ev.stopPropagation(); activateExportInnerFrameV60(outline); return; }
      if(isHandle) return;
      ev.preventDefault(); ev.stopPropagation();
      ensureExportFlags();
      state.export.autoFitField=false;
      const fr=frame.getBoundingClientRect(), or=outline.getBoundingClientRect();
      const dx=ev.clientX-or.left, dy=ev.clientY-or.top; const fw=or.width, fh=or.height;
      let moved=false;
      const move=e=>{
        moved=true;
        const left=Math.max(0,Math.min(fr.width-fw,e.clientX-fr.left-dx));
        const top=Math.max(0,Math.min(fr.height-fh,e.clientY-fr.top-dy));
        outline.style.left=left+'px'; outline.style.top=top+'px';
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        if(moved){
          state.export.innerFrame={x:Math.round(parseFloat(outline.style.left)||0),y:Math.round(parseFloat(outline.style.top)||0),w:Math.round(fw),h:Math.round(fh)};
          clearExportEditingAffordancesV60();
          renderExportPreviewCard();
        }else{
          // Одиночный клик включает режим редактирования: показываем направляющие и запрещаем движение рамки.
          activateExportInnerFrameV60(outline);
        }
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  }
  frame.querySelectorAll('.export-resize-handle').forEach(handle=>{
    if(handle.dataset.boundV60==='1') return;
    handle.dataset.boundV60='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      ensureExportFlags();
      const dir=handle.dataset.dir; const target=handle.dataset.frame;
      if(target==='inner' && outline) activateExportInnerFrameV60(outline);
      const startX=ev.clientX,startY=ev.clientY;
      const size0=exportMapSize();
      const w0=Number(size0.w), h0=Number(size0.h);
      const f0={...exportMapFieldRect(w0,h0)};
      const move=e=>{
        const dx=e.clientX-startX, dy=e.clientY-startY;
        if(target==='outer'){
          const minW=Math.max(500,(state.export.innerFrame?.x||0)+(state.export.innerFrame?.w||0)+20);
          const minH=Math.max(700,(state.export.innerFrame?.y||0)+(state.export.innerFrame?.h||0)+20);
          state.export.canvasWidth=Math.max(minW,w0+dx);
          state.export.canvasHeight=Math.max(minH,h0+dy);
        }else{
          state.export.autoFitField=false;
          const nw=f0.w+(dir.includes('e')?dx:0);
          const nh=f0.h+(dir.includes('s')?dy:0);
          const next={x:f0.x,y:f0.y,w:Math.max(260,Math.min(w0-f0.x,nw)),h:Math.max(260,Math.min(h0-f0.y,nh))};
          state.export.innerFrame=next;
          if(outline){ outline.style.width=next.w+'px'; outline.style.height=next.h+'px'; }
        }
        syncExportDefaults(false);
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        if(target==='inner' && outline){
          // После растягивания остаёмся в режиме редактирования до клика вне поля.
          activateExportInnerFrameV60(outline);
          renderExportPreviewCard();
        }else{
          clearExportEditingAffordancesV60();
          renderExportPreviewCard();
        }
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
};
(function initV60Patch(){
  const boot=()=>{ applyMetricFilterScrollV60(); clearExportEditingAffordancesV60(); };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();


/* v61: final export interaction model + filter panel bottom padding/scrollbar
   - title editing behavior restored to v59 style: click/drag selects, resize handle is available while selected;
   - inner map frame: normal state = draggable; click = edit mode; edit mode = resize only; outside click = normal state;
   - filter panel gets a real scrollbar and a fixed 15 px bottom gap after the last filter block. */
function v61EnsureExportState(){
  try{ return ensureExportFlags(); }
  catch(_){
    if(!state.export) state.export={};
    return state.export;
  }
}
function v61ClearInnerFrameEdit(){
  const ex=v61EnsureExportState();
  ex.activeFrame='';
  document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50').forEach(el=>{
    el.classList.remove('is-selected','is-editing');
    el.classList.add('export-resize-muted');
  });
}
function v61ActivateInnerFrame(outline){
  if(!outline) return;
  const ex=v61EnsureExportState();
  ex.activeFrame='inner';
  document.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50').forEach(el=>{
    const on=el===outline;
    el.classList.toggle('is-selected',on);
    el.classList.toggle('is-editing',on);
    el.classList.toggle('export-resize-muted',!on);
  });
}
function v61ClearTitleEdit(){
  const ex=v61EnsureExportState();
  ex.selectedWidget='';
  document.querySelectorAll('.export-map-card-v50').forEach(el=>{
    el.classList.remove('is-selected','is-editing');
    el.classList.add('export-resize-muted');
  });
}
function v61ActivateTitleCard(card){
  if(!card) return;
  const ex=v61EnsureExportState();
  const key=card.dataset.exportWidget||'';
  ex.selectedWidget=key;
  document.querySelectorAll('.export-map-card-v50').forEach(el=>{
    const on=el===card;
    el.classList.toggle('is-selected',on);
    el.classList.toggle('is-editing',on);
    el.classList.toggle('export-resize-muted',!on);
  });
}
function v61ClearAllExportEditing(){
  v61ClearInnerFrameEdit();
  v61ClearTitleEdit();
}
function v61ApplyMetricFilterScroll(){
  const panel=document.getElementById('metricFilters');
  if(!panel) return;
  panel.classList.add('metric-filters-scrollable-v61');
  panel.style.overflowY='scroll';
  panel.style.overflowX='hidden';
  panel.style.boxSizing='border-box';
  panel.style.paddingBottom='15px';
  const rect=panel.getBoundingClientRect();
  const available=Math.max(300, window.innerHeight - Math.max(8, rect.top) - 12);
  panel.style.maxHeight=`${Math.min(720, available)}px`;
  const grid=panel.querySelector('.metric-filter-grid');
  if(grid){
    grid.classList.add('metric-filter-grid-scroll-v61');
    grid.style.maxHeight='none';
    grid.style.overflow='visible';
    grid.style.paddingBottom='15px';
  }
}
initExportOverlayDrag = function initExportOverlayDragV61(){
  const frame=document.querySelector('.export-map-frame-v51') || document.querySelector('.export-map-frame-v50');
  if(!frame) return;
  // click outside inner map frame turns edit mode off; cards are also reset unless clicked directly.
  if(!document.documentElement.dataset.v61ExportOutsideBound){
    document.documentElement.dataset.v61ExportOutsideBound='1';
    document.addEventListener('pointerdown',ev=>{
      const inExport=!!ev.target.closest('.export-map-frame-v51,.export-map-frame-v50');
      const inInner=!!ev.target.closest('.export-field-outline-v51,.export-field-outline-v50');
      const inCard=!!ev.target.closest('.export-map-card-v50');
      if(inExport && !inInner && !inCard) v61ClearAllExportEditing();
      if(!inExport && document.getElementById('exportMode')?.classList.contains('open')) v61ClearAllExportEditing();
    }, true);
  }
  // Title and other export cards: v59 behavior.
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBoundV61==='1') return;
    card.dataset.dragBoundV61='1';
    card.addEventListener('pointerdown',ev=>{
      if(ev.target.closest('.export-card-resize-handle')) return;
      if(ev.target.closest('input,textarea,select,button,a')) return;
      ev.preventDefault(); ev.stopPropagation();
      v61ClearInnerFrameEdit();
      v61ActivateTitleCard(card);
      const fr=frame.getBoundingClientRect();
      const cr=card.getBoundingClientRect();
      const key=card.dataset.exportWidget||'card';
      const dx=ev.clientX-cr.left;
      const dy=ev.clientY-cr.top;
      let moved=false;
      const move=e=>{
        moved=true;
        const left=Math.max(8,Math.min(fr.width-card.offsetWidth-8,e.clientX-fr.left-dx));
        const top=Math.max(8,Math.min(fr.height-card.offsetHeight-8,e.clientY-fr.top-dy));
        card.style.left=left+'px';
        card.style.top=top+'px';
        const ex=v61EnsureExportState();
        ex.overlayPositions[key]={left:Math.round(left),top:Math.round(top),width:card.offsetWidth};
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        // v59: after a click the resize handle remains available; after dragging it returns to normal.
        if(moved){ v61ClearTitleEdit(); syncExportDefaults(false); }
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
  frame.querySelectorAll('.export-card-resize-handle').forEach(handle=>{
    if(handle.dataset.boundV61==='1') return;
    handle.dataset.boundV61='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const card=handle.closest('.export-map-card'); if(!card) return;
      v61ClearInnerFrameEdit();
      v61ActivateTitleCard(card);
      const fr=frame.getBoundingClientRect();
      const cr=card.getBoundingClientRect();
      const key=card.dataset.exportWidget||'title';
      const startX=ev.clientX;
      const startW=cr.width;
      const move=e=>{
        const nw=Math.max(320,Math.min(fr.width-(cr.left-fr.left)-8,startW+(e.clientX-startX)));
        card.style.width=nw+'px';
        const ex=v61EnsureExportState();
        const pos=ex.overlayPositions[key] || {left:Math.round(cr.left-fr.left),top:Math.round(cr.top-fr.top),width:startW};
        pos.width=Math.round(nw);
        ex.overlayPositions[key]=pos;
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        v61ClearTitleEdit();
        renderExportPreviewCard();
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
  const outline=frame.querySelector('.export-field-outline-v51') || frame.querySelector('.export-field-outline-v50');
  if(outline && outline.dataset.dragBoundV61!=='1'){
    outline.dataset.dragBoundV61='1';
    outline.addEventListener('pointerdown',ev=>{
      const isHandle=!!ev.target.closest('.export-resize-handle');
      const isEditing=outline.classList.contains('is-editing') || v61EnsureExportState().activeFrame==='inner';
      if(isHandle) return; // handled by resize listeners below
      ev.preventDefault(); ev.stopPropagation();
      v61ClearTitleEdit();
      if(isEditing){
        // In edit mode the frame itself is not draggable.
        v61ActivateInnerFrame(outline);
        return;
      }
      const fr=frame.getBoundingClientRect();
      const or=outline.getBoundingClientRect();
      const dx=ev.clientX-or.left;
      const dy=ev.clientY-or.top;
      const fw=or.width;
      const fh=or.height;
      let moved=false;
      const move=e=>{
        moved=true;
        const left=Math.max(0,Math.min(fr.width-fw,e.clientX-fr.left-dx));
        const top=Math.max(0,Math.min(fr.height-fh,e.clientY-fr.top-dy));
        outline.style.left=left+'px';
        outline.style.top=top+'px';
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        const ex=v61EnsureExportState();
        ex.autoFitField=false;
        if(moved){
          ex.innerFrame={x:Math.round(parseFloat(outline.style.left)||0),y:Math.round(parseFloat(outline.style.top)||0),w:Math.round(fw),h:Math.round(fh)};
          v61ClearInnerFrameEdit();
          renderExportPreviewCard();
        }else{
          // Single click = edit mode with visible guides and resize handles.
          v61ActivateInnerFrame(outline);
        }
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  }
  frame.querySelectorAll('.export-resize-handle').forEach(handle=>{
    if(handle.dataset.boundV61==='1') return;
    handle.dataset.boundV61='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const target=handle.dataset.frame;
      const dir=handle.dataset.dir||'se';
      const ex=v61EnsureExportState();
      if(target==='inner' && outline && !(outline.classList.contains('is-editing') || ex.activeFrame==='inner')){
        // Handles are visually unavailable in normal mode, but guard anyway.
        return;
      }
      if(target==='inner' && outline) v61ActivateInnerFrame(outline);
      const startX=ev.clientX;
      const startY=ev.clientY;
      const size0=exportMapSize();
      const w0=Number(size0.w), h0=Number(size0.h);
      const f0={...exportMapFieldRect(w0,h0)};
      const move=e=>{
        const dx=e.clientX-startX;
        const dy=e.clientY-startY;
        const exNow=v61EnsureExportState();
        if(target==='outer'){
          const minW=Math.max(500,(exNow.innerFrame?.x||0)+(exNow.innerFrame?.w||0)+20);
          const minH=Math.max(700,(exNow.innerFrame?.y||0)+(exNow.innerFrame?.h||0)+20);
          exNow.canvasWidth=Math.max(minW,w0+dx);
          exNow.canvasHeight=Math.max(minH,h0+dy);
        }else{
          exNow.autoFitField=false;
          const nw=f0.w+(dir.includes('e')?dx:0);
          const nh=f0.h+(dir.includes('s')?dy:0);
          const next={x:f0.x,y:f0.y,w:Math.max(260,Math.min(w0-f0.x,nw)),h:Math.max(260,Math.min(h0-f0.y,nh))};
          exNow.innerFrame=next;
          if(outline){ outline.style.width=next.w+'px'; outline.style.height=next.h+'px'; }
        }
        syncExportDefaults(false);
      };
      const up=()=>{
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        if(target==='inner' && outline){
          // After resize, stay in edit mode until the user clicks outside the inner frame.
          v61ActivateInnerFrame(outline);
          renderExportPreviewCard();
        }else{
          v61ClearAllExportEditing();
          renderExportPreviewCard();
        }
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
    },{passive:false});
  });
};
(function initV61Patch(){
  const boot=()=>{
    v61ApplyMetricFilterScroll();
    v61ClearAllExportEditing();
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
  window.addEventListener('resize',v61ApplyMetricFilterScroll,{passive:true});
  window.addEventListener('pointerup',()=>setTimeout(v61ApplyMetricFilterScroll,0),{passive:true});
})();


/* v62: outer PNG frame edit mode follows the same click-to-edit model as the inner map frame */
function v62EnsureExportState(){
  try{
    const ex=ensureExportFlags();
    if(ex) return ex;
  }catch(_){ }
  if(!state.export) state.export={};
  return state.export;
}
function v62ClearOuterFrameEdit(){
  const ex=v62EnsureExportState();
  if(ex.activeFrame==='outer') ex.activeFrame='';
  document.querySelectorAll('.export-outer-outline-v50,.export-outer-outline-v51,.export-outer-outline-v62').forEach(el=>{
    el.classList.remove('is-selected','is-editing');
    el.classList.add('export-resize-muted');
  });
}
function v62ActivateOuterFrame(outer){
  if(!outer) return;
  const ex=v62EnsureExportState();
  ex.activeFrame='outer';
  if(typeof v61ClearInnerFrameEdit==='function') v61ClearInnerFrameEdit();
  if(typeof v61ClearTitleEdit==='function') v61ClearTitleEdit();
  document.querySelectorAll('.export-outer-outline-v50,.export-outer-outline-v51,.export-outer-outline-v62').forEach(el=>{
    const on=el===outer;
    el.classList.toggle('is-selected',on);
    el.classList.toggle('is-editing',on);
    el.classList.toggle('export-resize-muted',!on);
  });
}
function v62ClearAllExportEditing(){
  v62ClearOuterFrameEdit();
  if(typeof v61ClearInnerFrameEdit==='function') v61ClearInnerFrameEdit();
  if(typeof v61ClearTitleEdit==='function') v61ClearTitleEdit();
}
function v62OuterMinSize(){
  const ex=v62EnsureExportState();
  const inner=ex.innerFrame || {};
  const minW=Math.max(500, Number(inner.x||0)+Number(inner.w||0)+24);
  const minH=Math.max(700, Number(inner.y||0)+Number(inner.h||0)+24);
  return {minW,minH};
}
renderExportPreviewCard = function renderExportPreviewCardV62(){
  v62EnsureExportState();
  const wrap=$('exportPreviewCard'); if(!wrap) return;
  const features=exportScopeFeatures();
  const {w,h}=exportMapSize();
  if(typeof v51NormalizeOverlayPositions==='function') v51NormalizeOverlayPositions(false);
  const field=exportMapFieldRect(w,h);
  const ex=v62EnsureExportState();
  const innerSelected = ex.activeFrame==='inner' ? ' is-selected is-editing' : '';
  const outerSelected = ex.activeFrame==='outer' ? ' is-selected is-editing' : '';
  wrap.innerHTML=`<article class="export-layout export-layout-v50 export-layout-v51 export-layout-v62" style="width:${w}px"><section class="export-main export-main-v43"><div class="export-map-frame export-map-frame-v50 export-map-frame-v51 export-map-frame-v62" style="width:${w}px;height:${h}px"><div id="exportSvgMap" class="export-svg-map"></div><div class="export-outer-outline-v50 export-outer-outline-v51 export-outer-outline-v62${outerSelected}" title="Внешняя рамка PNG"><span class="export-resize-handle export-resize-se" data-frame="outer" data-dir="se"></span><span class="export-resize-handle export-resize-e" data-frame="outer" data-dir="e"></span><span class="export-resize-handle export-resize-s" data-frame="outer" data-dir="s"></span></div><div class="export-field-outline export-field-outline-v50 export-field-outline-v51${innerSelected}" style="left:${field.x}px;top:${field.y}px;width:${field.w}px;height:${field.h}px" title="Внутренняя рамка карты"><span class="export-resize-handle export-resize-se" data-frame="inner" data-dir="se"></span><span class="export-resize-handle export-resize-e" data-frame="inner" data-dir="e"></span><span class="export-resize-handle export-resize-s" data-frame="inner" data-dir="s"></span></div>${exportOverlayBlocksHtml(features)}</div></section></article>`;
  updateExportLiveMap();
  initExportOverlayDrag();
  syncExportDefaults(false);
};
initExportOverlayDrag = function initExportOverlayDragV62(){
  const frame=document.querySelector('.export-map-frame-v62') || document.querySelector('.export-map-frame-v51') || document.querySelector('.export-map-frame-v50');
  if(!frame) return;
  if(!document.documentElement.dataset.v62ExportOutsideBound){
    document.documentElement.dataset.v62ExportOutsideBound='1';
    document.addEventListener('pointerdown',ev=>{
      const modalOpen=document.getElementById('exportMode')?.classList.contains('open');
      if(!modalOpen) return;
      const inFrame=!!ev.target.closest('.export-map-frame-v62,.export-map-frame-v51,.export-map-frame-v50');
      const inInner=!!ev.target.closest('.export-field-outline-v51,.export-field-outline-v50');
      const inOuter=!!ev.target.closest('.export-outer-outline-v62,.export-outer-outline-v51,.export-outer-outline-v50');
      const inOuterHandle=!!ev.target.closest('.export-outer-outline-v62 .export-resize-handle,.export-outer-outline-v51 .export-resize-handle,.export-outer-outline-v50 .export-resize-handle');
      const inCard=!!ev.target.closest('.export-map-card-v50');
      const ex=v62EnsureExportState();
      if(ex.activeFrame==='outer' && (!inFrame || inInner || inCard || (!inOuter && !inOuterHandle))){
        v62ClearOuterFrameEdit();
      }
      if(ex.activeFrame==='inner' && (!inFrame || (!inInner && !inCard))){
        if(typeof v61ClearInnerFrameEdit==='function') v61ClearInnerFrameEdit();
      }
      if(!inFrame) v62ClearAllExportEditing();
    }, true);
  }
  const outer=frame.querySelector('.export-outer-outline-v62') || frame.querySelector('.export-outer-outline-v51') || frame.querySelector('.export-outer-outline-v50');
  const inner=frame.querySelector('.export-field-outline-v51') || frame.querySelector('.export-field-outline-v50');

  // Export cards/title: keep v59/v61 behavior, but binding namespace is v62 to avoid relying on older handlers.
  frame.querySelectorAll('.export-map-card').forEach(card=>{
    if(card.dataset.dragBoundV62==='1') return;
    card.dataset.dragBoundV62='1';
    card.addEventListener('pointerdown',ev=>{
      if(ev.target.closest('.export-card-resize-handle')) return;
      if(ev.target.closest('input,textarea,select,button,a')) return;
      ev.preventDefault(); ev.stopPropagation();
      v62ClearOuterFrameEdit();
      if(typeof v61ClearInnerFrameEdit==='function') v61ClearInnerFrameEdit();
      if(typeof v61ActivateTitleCard==='function') v61ActivateTitleCard(card);
      const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect();
      const key=card.dataset.exportWidget||'card';
      const dx=ev.clientX-cr.left, dy=ev.clientY-cr.top;
      let moved=false;
      const move=e=>{
        moved=true;
        const left=Math.max(8,Math.min(fr.width-card.offsetWidth-8,e.clientX-fr.left-dx));
        const top=Math.max(8,Math.min(fr.height-card.offsetHeight-8,e.clientY-fr.top-dy));
        card.style.left=left+'px'; card.style.top=top+'px';
        const ex=v62EnsureExportState();
        if(!ex.overlayPositions) ex.overlayPositions={};
        ex.overlayPositions[key]={left:Math.round(left),top:Math.round(top),width:card.offsetWidth};
      };
      const up=()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
        if(moved && typeof v61ClearTitleEdit==='function'){ v61ClearTitleEdit(); syncExportDefaults(false); }
      };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    },{passive:false});
  });
  frame.querySelectorAll('.export-card-resize-handle').forEach(handle=>{
    if(handle.dataset.boundV62==='1') return;
    handle.dataset.boundV62='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const card=handle.closest('.export-map-card'); if(!card) return;
      v62ClearOuterFrameEdit();
      if(typeof v61ClearInnerFrameEdit==='function') v61ClearInnerFrameEdit();
      if(typeof v61ActivateTitleCard==='function') v61ActivateTitleCard(card);
      const fr=frame.getBoundingClientRect(), cr=card.getBoundingClientRect();
      const key=card.dataset.exportWidget||'title';
      const startX=ev.clientX, startW=cr.width;
      const move=e=>{
        const nw=Math.max(320,Math.min(fr.width-(cr.left-fr.left)-8,startW+(e.clientX-startX)));
        card.style.width=nw+'px';
        const ex=v62EnsureExportState();
        if(!ex.overlayPositions) ex.overlayPositions={};
        const pos=ex.overlayPositions[key] || {left:Math.round(cr.left-fr.left),top:Math.round(cr.top-fr.top),width:startW};
        pos.width=Math.round(nw); ex.overlayPositions[key]=pos;
      };
      const up=()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
        if(typeof v61ClearTitleEdit==='function') v61ClearTitleEdit();
        renderExportPreviewCard();
      };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    },{passive:false});
  });

  // Inner frame: v61 model.
  if(inner && inner.dataset.dragBoundV62!=='1'){
    inner.dataset.dragBoundV62='1';
    inner.addEventListener('pointerdown',ev=>{
      const isHandle=!!ev.target.closest('.export-resize-handle');
      const isEditing=inner.classList.contains('is-editing') || v62EnsureExportState().activeFrame==='inner';
      if(isHandle) return;
      ev.preventDefault(); ev.stopPropagation();
      v62ClearOuterFrameEdit();
      if(typeof v61ClearTitleEdit==='function') v61ClearTitleEdit();
      if(isEditing){ if(typeof v61ActivateInnerFrame==='function') v61ActivateInnerFrame(inner); return; }
      const fr=frame.getBoundingClientRect(), ir=inner.getBoundingClientRect();
      const dx=ev.clientX-ir.left, dy=ev.clientY-ir.top, fw=ir.width, fh=ir.height;
      let moved=false;
      const move=e=>{
        moved=true;
        const left=Math.max(0,Math.min(fr.width-fw,e.clientX-fr.left-dx));
        const top=Math.max(0,Math.min(fr.height-fh,e.clientY-fr.top-dy));
        inner.style.left=left+'px'; inner.style.top=top+'px';
      };
      const up=()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
        const ex=v62EnsureExportState(); ex.autoFitField=false;
        if(moved){
          ex.innerFrame={x:Math.round(parseFloat(inner.style.left)||0),y:Math.round(parseFloat(inner.style.top)||0),w:Math.round(fw),h:Math.round(fh)};
          if(typeof v61ClearInnerFrameEdit==='function') v61ClearInnerFrameEdit();
          renderExportPreviewCard();
        }else{
          if(typeof v61ActivateInnerFrame==='function') v61ActivateInnerFrame(inner);
        }
      };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    },{passive:false});
  }

  // Outer frame: click = edit mode, edit mode = resize only, outside click = normal mode.
  frame.addEventListener('pointerdown',ev=>{
    if(ev.target.closest('.export-map-card-v50,.export-field-outline-v51,.export-field-outline-v50,.export-resize-handle,.export-card-resize-handle,input,textarea,select,button,a')) return;
    ev.preventDefault(); ev.stopPropagation();
    if(typeof v61ClearInnerFrameEdit==='function') v61ClearInnerFrameEdit();
    if(typeof v61ClearTitleEdit==='function') v61ClearTitleEdit();
    v62ActivateOuterFrame(outer);
  },{passive:false});

  frame.querySelectorAll('.export-resize-handle').forEach(handle=>{
    if(handle.dataset.boundV62==='1') return;
    handle.dataset.boundV62='1';
    handle.addEventListener('pointerdown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const target=handle.dataset.frame;
      const dir=handle.dataset.dir||'se';
      const ex=v62EnsureExportState();
      if(target==='outer'){
        if(!outer || !(outer.classList.contains('is-editing') || ex.activeFrame==='outer')) return;
        v62ActivateOuterFrame(outer);
      }
      if(target==='inner'){
        if(!inner || !(inner.classList.contains('is-editing') || ex.activeFrame==='inner')) return;
        if(typeof v61ActivateInnerFrame==='function') v61ActivateInnerFrame(inner);
      }
      const startX=ev.clientX, startY=ev.clientY;
      const size0=exportMapSize();
      const w0=Number(size0.w), h0=Number(size0.h);
      const f0={...exportMapFieldRect(w0,h0)};
      const move=e=>{
        const dx=e.clientX-startX, dy=e.clientY-startY;
        const exNow=v62EnsureExportState();
        if(target==='outer'){
          const {minW,minH}=v62OuterMinSize();
          const nextW=Math.max(minW, w0 + (dir.includes('e')?dx:0));
          const nextH=Math.max(minH, h0 + (dir.includes('s')?dy:0));
          exNow.canvasWidth=Math.round(nextW);
          exNow.canvasHeight=Math.round(nextH);
          frame.style.width=nextW+'px';
          frame.style.height=nextH+'px';
          const layout=frame.closest('.export-layout'); if(layout) layout.style.width=nextW+'px';
          if($('exportCanvasWidth')) $('exportCanvasWidth').value=Math.round(nextW);
          if($('exportCanvasHeight')) $('exportCanvasHeight').value=Math.round(nextH);
        }else{
          exNow.autoFitField=false;
          const nw=f0.w+(dir.includes('e')?dx:0);
          const nh=f0.h+(dir.includes('s')?dy:0);
          const next={x:f0.x,y:f0.y,w:Math.max(260,Math.min(w0-f0.x,nw)),h:Math.max(260,Math.min(h0-f0.y,nh))};
          exNow.innerFrame=next;
          if(inner){ inner.style.width=next.w+'px'; inner.style.height=next.h+'px'; }
          if($('exportInnerWidth')) $('exportInnerWidth').value=Math.round(next.w);
          if($('exportInnerHeight')) $('exportInnerHeight').value=Math.round(next.h);
        }
      };
      const up=()=>{
        document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
        if(target==='outer'){
          renderExportPreviewCard();
          setTimeout(()=>{ const o=document.querySelector('.export-outer-outline-v62,.export-outer-outline-v51,.export-outer-outline-v50'); v62ActivateOuterFrame(o); },0);
        }else{
          renderExportPreviewCard();
          setTimeout(()=>{ const i=document.querySelector('.export-field-outline-v51,.export-field-outline-v50'); if(i && typeof v61ActivateInnerFrame==='function') v61ActivateInnerFrame(i); },0);
        }
      };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up);
    },{passive:false});
  });
};
(function initV62Patch(){
  const boot=()=>{
    if(typeof v61ApplyMetricFilterScroll==='function') v61ApplyMetricFilterScroll();
    v62ClearAllExportEditing();
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();

/* v63: draggable scale bar + 10 px minimum map padding, km buffers only as additional manual padding */
const v63PriorEnsureExportFlags = ensureExportFlags;
ensureExportFlags = function ensureExportFlagsV63(){
  const ex = v63PriorEnsureExportFlags ? v63PriorEnsureExportFlags() : (state.export || (state.export = {}));
  if(!ex.scaleBarPosition || typeof ex.scaleBarPosition !== 'object') ex.scaleBarPosition = null;
  if(!Number.isFinite(Number(ex.minLayerPaddingPx))) ex.minLayerPaddingPx = 10;
  // Старые сборки по умолчанию раздували bbox на 200 км по всем сторонам.
  // В v63 это заменено на минимальный экранный отступ 10 px, а километры остаются только ручной добавкой.
  const b = ex.extentBuffer || {};
  const looksLikeOldDefault = ['top','right','bottom','left'].every(k => Math.abs((Number(b[k])||0) - 200) < 0.001);
  if(!ex.v63BufferDefaultApplied && looksLikeOldDefault){
    ex.extentBuffer = {top:0,right:0,bottom:0,left:0};
    ex.v63BufferDefaultApplied = true;
  }
  if(!ex.extentBuffer || typeof ex.extentBuffer !== 'object') ex.extentBuffer = {top:0,right:0,bottom:0,left:0};
  ['top','right','bottom','left'].forEach(k=>{ if(!Number.isFinite(Number(ex.extentBuffer[k]))) ex.extentBuffer[k]=0; });
  return ex;
};
const v63PriorMakeExportProjection = typeof makeExportProjection === 'function' ? makeExportProjection : null;
makeExportProjection = function makeExportProjectionV63(bbox,w,h,pad=0){
  const ex = ensureExportFlags();
  const effectivePad = Math.max(Number(ex.minLayerPaddingPx)||10, Number(pad)||0);
  if(v63PriorMakeExportProjection) return v63PriorMakeExportProjection(bbox,w,h,effectivePad);
  return makeLambertExportProjection(bbox,w,h,effectivePad);
};
exportExpandedGeoBBox = function exportExpandedGeoBBoxV63(features){
  const ex = ensureExportFlags();
  const source = features && features.length ? features : (state.rawGeoJSON?.features || []);
  const bbox = geoBBoxFromFeatures(source);
  const [minX,minY,maxX,maxY] = bbox;
  const centerLat = (minY + maxY) / 2;
  const b = ex.extentBuffer || {top:0,right:0,bottom:0,left:0};
  const left = kmToLonDeg(Math.max(0, Number(b.left)||0), centerLat);
  const right = kmToLonDeg(Math.max(0, Number(b.right)||0), centerLat);
  const top = kmToLatDeg(Math.max(0, Number(b.top)||0));
  const bottom = kmToLatDeg(Math.max(0, Number(b.bottom)||0));
  return [Math.max(-180,minX-left), Math.max(-84,minY-bottom), Math.min(180,maxX+right), Math.min(89,maxY+top)];
};
function v63ScaleDefaults(kmPerPx,w,h,fieldRect){
  const targetPx=180;
  const targetKm=Math.max(1,kmPerPx*targetPx);
  const nice=[10,25,50,75,100,150,200,300,500,750,1000,1500,2000,3000].filter(v=>v<=targetKm).pop() || 10;
  const px=Math.max(45,Math.min(360,nice/kmPerPx));
  const field=fieldRect || exportMapFieldRect(w,h);
  return {nice, px, x:field.x+28, y:field.y+field.h-26};
}
function v63ClampScalePosition(pos, px, w, h){
  const x=Math.max(18, Math.min(w - px - 18, Number(pos?.x)));
  const y=Math.max(42, Math.min(h - 18, Number(pos?.y)));
  return {x:Number.isFinite(x)?x:18, y:Number.isFinite(y)?y:h-28};
}
exportScaleBarSvgFromKmPerPx = function exportScaleBarSvgFromKmPerPxV63(kmPerPx,w,h,fieldRect){
  const ex=ensureExportFlags();
  const d=v63ScaleDefaults(kmPerPx,w,h,fieldRect);
  let pos = ex.scaleBarPosition && Number.isFinite(Number(ex.scaleBarPosition.x)) && Number.isFinite(Number(ex.scaleBarPosition.y))
    ? v63ClampScalePosition(ex.scaleBarPosition,d.px,w,h)
    : {x:d.x,y:d.y};
  ex.scaleBarPosition = pos;
  const dx=pos.x-d.x, dy=pos.y-d.y;
  const px=d.px, x=d.x, y=d.y;
  return `<g class="export-scale-bar-draggable-v63" data-scale-width="${px.toFixed(1)}" data-base-x="${x.toFixed(1)}" data-base-y="${y.toFixed(1)}" transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)})" style="cursor:move"><rect x="${(x-20).toFixed(1)}" y="${(y-38).toFixed(1)}" width="${(px+40).toFixed(1)}" height="58" fill="transparent" pointer-events="all"/><line x1="${x}" y1="${y}" x2="${(x+px).toFixed(1)}" y2="${y}" stroke="#253241" stroke-width="3" pointer-events="none"/><line x1="${x}" y1="${y-6}" x2="${x}" y2="${y+6}" stroke="#253241" stroke-width="2" pointer-events="none"/><line x1="${(x+px).toFixed(1)}" y1="${y-6}" x2="${(x+px).toFixed(1)}" y2="${y+6}" stroke="#253241" stroke-width="2" pointer-events="none"/><text x="${(x+px/2).toFixed(1)}" y="${y-10}" text-anchor="middle" font-size="12" font-weight="800" fill="#253241" pointer-events="none">${d.nice} км</text></g>`;
};
function v63SvgPoint(svg, evt){
  const pt=svg.createSVGPoint();
  pt.x=evt.clientX; pt.y=evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function initExportScaleBarDragV63(){
  const svg=document.querySelector('#exportSvgMap svg.export-map-svg');
  const g=document.querySelector('#exportScaleBar .export-scale-bar-draggable-v63');
  if(!svg || !g || g.dataset.v63Bound==='1') return;
  g.dataset.v63Bound='1';
  g.addEventListener('pointerdown', ev=>{
    ev.preventDefault(); ev.stopPropagation();
    const ex=ensureExportFlags();
    const size=exportMapSize();
    const px=Number(g.dataset.scaleWidth)||180;
    const baseX=Number(g.dataset.baseX)||28;
    const baseY=Number(g.dataset.baseY)||Math.max(42,size.h-28);
    const current=v63ClampScalePosition(ex.scaleBarPosition || {x:baseX,y:baseY}, px, size.w, size.h);
    const start=v63SvgPoint(svg, ev);
    const offset={x:start.x-current.x, y:start.y-current.y};
    g.classList.add('is-dragging');
    const move=e=>{
      const p=v63SvgPoint(svg,e);
      const next=v63ClampScalePosition({x:p.x-offset.x,y:p.y-offset.y}, px, size.w, size.h);
      ex.scaleBarPosition={x:Math.round(next.x),y:Math.round(next.y)};
      g.setAttribute('transform',`translate(${(next.x-baseX).toFixed(1)} ${(next.y-baseY).toFixed(1)})`);
    };
    const up=()=>{
      document.removeEventListener('pointermove',move);
      document.removeEventListener('pointerup',up);
      g.classList.remove('is-dragging');
      syncExportDefaults(false);
    };
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',up);
  },{passive:false});
}
const v63PriorUpdateExportLiveMap = updateExportLiveMap;
updateExportLiveMap = async function updateExportLiveMapV63(){
  const el=$('exportSvgMap'); if(!el) return;
  const status=$('exportPreviewStatus');
  try{
    if(status) status.textContent='Строим SVG-карту…';
    el.innerHTML=await buildExportSvgMap();
    initExportScaleBarDragV63();
    if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
  }catch(e){
    console.error('SVG export map error',e);
    el.innerHTML=`<div class="export-map-placeholder">Не удалось построить карту: ${escapeHtml(e.message||String(e))}</div>`;
    if(status) status.textContent='Ошибка построения карты.';
  }
};
(function initV63Patch(){
  const boot=()=>{ try{ ensureExportFlags(); initExportScaleBarDragV63(); }catch(e){ console.warn('v63 init skipped', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();


/* v64: precise layer-to-field fit, real draggable scale bar, compact 1080p UI */
function v64CollectRawProjectedBounds(features, rawProject){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  (features||[]).forEach(f=>{
    walkCoords(f.geometry, ([lon,lat])=>{
      if(!Number.isFinite(lon)||!Number.isFinite(lat)) return;
      const p=rawProject(lon,lat);
      const x=p[0], y=p[1];
      if(Number.isFinite(x)&&Number.isFinite(y)){
        minX=Math.min(minX,x); maxX=Math.max(maxX,x);
        minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      }
    });
  });
  return Number.isFinite(minX) ? {minX,minY,maxX,maxY} : null;
}
function v64ExpandRawBoundsByKm(bounds, rawProject, bbox, buffer){
  const b=buffer || {top:0,right:0,bottom:0,left:0};
  const [minLon,minLat,maxLon,maxLat]=bbox;
  const centerLon=(minLon+maxLon)/2, centerLat=(minLat+maxLat)/2;
  const c=rawProject(centerLon, centerLat);
  const west=rawProject(centerLon-kmToLonDeg(Math.max(0,Number(b.left)||0),centerLat), centerLat);
  const east=rawProject(centerLon+kmToLonDeg(Math.max(0,Number(b.right)||0),centerLat), centerLat);
  const south=rawProject(centerLon, centerLat-kmToLatDeg(Math.max(0,Number(b.bottom)||0)));
  const north=rawProject(centerLon, centerLat+kmToLatDeg(Math.max(0,Number(b.top)||0)));
  const dxW=Math.abs((west?.[0]??c[0])-c[0]);
  const dxE=Math.abs((east?.[0]??c[0])-c[0]);
  const dyS=Math.abs((south?.[1]??c[1])-c[1]);
  const dyN=Math.abs((north?.[1]??c[1])-c[1]);
  return {minX:bounds.minX-dxW, maxX:bounds.maxX+dxE, minY:bounds.minY-dyN, maxY:bounds.maxY+dyS};
}
function v64MakeFeatureFitProjection(features,bbox,w,h,pad=10){
  const ex=ensureExportFlags();
  const [minLon,minLat,maxLon,maxLat]=bbox;
  const centerLon=Number(ex.centralMeridian)||75;
  const centerLat=Math.max(52, Math.min(72, (minLat+maxLat)/2));
  const raw=lambertForwardFactory({lon0:centerLon, lat0:centerLat, phi1:52, phi2:66});
  let bounds=v64CollectRawProjectedBounds(features, raw);
  if(!bounds){
    bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    const steps=32;
    for(let i=0;i<=steps;i++){
      const t=i/steps;
      [[minLon+(maxLon-minLon)*t,minLat],[minLon+(maxLon-minLon)*t,maxLat],[minLon,minLat+(maxLat-minLat)*t],[maxLon,minLat+(maxLat-minLat)*t]].forEach(([lon,lat])=>{
        const [x,y]=raw(lon,lat); bounds.minX=Math.min(bounds.minX,x); bounds.maxX=Math.max(bounds.maxX,x); bounds.minY=Math.min(bounds.minY,y); bounds.maxY=Math.max(bounds.maxY,y);
      });
    }
  }
  bounds=v64ExpandRawBoundsByKm(bounds, raw, geoBBoxFromFeatures(features), ex.extentBuffer);
  const safePad=Math.max(10, Number(pad)||10);
  const bw=Math.max(1e-9,bounds.maxX-bounds.minX), bh=Math.max(1e-9,bounds.maxY-bounds.minY);
  const s=Math.min((w-safePad*2)/bw, (h-safePad*2)/bh);
  // Center the projected administrative extent inside the field. This removes the old asymmetric west/east dead area.
  const ox=(w-bw*s)/2 - bounds.minX*s;
  const oy=(h-bh*s)/2 - bounds.minY*s;
  const fn=(lon,lat)=>{ const [x,y]=raw(lon,lat); return {x:ox+x*s, y:oy+y*s}; };
  fn.scale=s; fn.bbox=bbox; fn.w=w; fn.h=h; fn.pad=safePad; fn.kind='lambert'; fn.centerLon=centerLon; fn.centerLat=centerLat; fn.raw=raw; fn.v64Bounds=bounds;
  return fn;
}
function v64ScaleBarSvg(kmPerPx,w,h,fieldRect){
  const ex=ensureExportFlags();
  const d=v63ScaleDefaults(kmPerPx,w,h,fieldRect);
  const px=d.px;
  let pos = ex.scaleBarPosition && Number.isFinite(Number(ex.scaleBarPosition.x)) && Number.isFinite(Number(ex.scaleBarPosition.y))
    ? v63ClampScalePosition(ex.scaleBarPosition,px,w,h)
    : {x:d.x,y:d.y};
  ex.scaleBarPosition=pos;
  return `<g class="export-scale-bar-draggable-v64 export-scale-bar-draggable-v63" data-scale-width="${px.toFixed(1)}" data-base-x="${pos.x.toFixed(1)}" data-base-y="${pos.y.toFixed(1)}" style="cursor:move;pointer-events:all"><rect x="${(pos.x-22).toFixed(1)}" y="${(pos.y-42).toFixed(1)}" width="${(px+44).toFixed(1)}" height="66" fill="transparent" pointer-events="all"/><line x1="${pos.x.toFixed(1)}" y1="${pos.y.toFixed(1)}" x2="${(pos.x+px).toFixed(1)}" y2="${pos.y.toFixed(1)}" stroke="#253241" stroke-width="3" pointer-events="none"/><line x1="${pos.x.toFixed(1)}" y1="${(pos.y-6).toFixed(1)}" x2="${pos.x.toFixed(1)}" y2="${(pos.y+6).toFixed(1)}" stroke="#253241" stroke-width="2" pointer-events="none"/><line x1="${(pos.x+px).toFixed(1)}" y1="${(pos.y-6).toFixed(1)}" x2="${(pos.x+px).toFixed(1)}" y2="${(pos.y+6).toFixed(1)}" stroke="#253241" stroke-width="2" pointer-events="none"/><text x="${(pos.x+px/2).toFixed(1)}" y="${(pos.y-10).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#253241" pointer-events="none">${d.nice} км</text></g>`;
}
exportScaleBarSvgFromKmPerPx = function exportScaleBarSvgFromKmPerPxV64(kmPerPx,w,h,fieldRect){
  return v64ScaleBarSvg(kmPerPx,w,h,fieldRect);
};
function initExportScaleBarDragV64(){
  const svg=document.querySelector('#exportSvgMap svg.export-map-svg');
  const g=document.querySelector('#exportScaleBar .export-scale-bar-draggable-v64, #exportScaleBar .export-scale-bar-draggable-v63');
  if(!svg || !g || g.dataset.v64Bound==='1') return;
  g.dataset.v64Bound='1';
  g.style.pointerEvents='all';
  g.addEventListener('pointerdown', ev=>{
    ev.preventDefault(); ev.stopPropagation();
    if(typeof v62ClearAllExportEditing==='function') v62ClearAllExportEditing();
    const ex=ensureExportFlags();
    const size=exportMapSize();
    const px=Number(g.dataset.scaleWidth)||180;
    const current=v63ClampScalePosition(ex.scaleBarPosition || {x:Number(g.dataset.baseX)||28,y:Number(g.dataset.baseY)||size.h-28}, px, size.w, size.h);
    const start=v63SvgPoint(svg, ev);
    const offset={x:start.x-current.x, y:start.y-current.y};
    g.classList.add('is-dragging');
    try{ g.setPointerCapture(ev.pointerId); }catch(_){ }
    const move=e=>{
      const p=v63SvgPoint(svg,e);
      const next=v63ClampScalePosition({x:p.x-offset.x,y:p.y-offset.y}, px, size.w, size.h);
      ex.scaleBarPosition={x:Math.round(next.x),y:Math.round(next.y)};
      const dx=next.x-current.x, dy=next.y-current.y;
      g.setAttribute('transform',`translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
    };
    const up=()=>{
      document.removeEventListener('pointermove',move);
      document.removeEventListener('pointerup',up);
      g.classList.remove('is-dragging');
      syncExportDefaults(false);
      // Rebuild once so the saved position becomes the new base coordinates, not a temporary transform.
      updateExportLiveMap();
    };
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',up);
  },{passive:false});
}
buildExportSvgMap = function buildExportSvgMapV64(){
  const {w,h}=exportMapSize();
  const fieldRect=exportMapFieldRect(w,h);
  const features=exportScopeFeatures();
  const bbox=exportExpandedGeoBBox(features);
  const baseProjection=v64MakeFeatureFitProjection(features,bbox,fieldRect.w,fieldRect.h,10);
  const projection=(lon,lat)=>{ const p=baseProjection(lon,lat); return {x:p.x+fieldRect.x, y:p.y+fieldRect.y}; };
  const centerLat=(bbox[1]+bbox[3])/2, centerLon=(bbox[0]+bbox[2])/2;
  const p1=projection(centerLon, centerLat), p2=projection(centerLon+1, centerLat);
  const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.cos(centerLat*Math.PI/180);
  const kmPerPx=kmPerDeg/pxPerDeg;
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)) : [];
  const bodyTransform=exportMapBodyTransform(w,h);
  const parts=[];
  parts.push(`<svg class="export-map-svg" data-map-w="${w}" data-map-h="${h}" data-base-km-per-px="${kmPerPx}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" ry="10"/></clipPath><filter id="labelShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="#eef3ef"/><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" fill="${exportBasemapFill()}" stroke="rgba(111,123,98,.55)" stroke-width="1.2"/><g clip-path="url(#exportMapClip)"><g id="exportMapBody" class="export-map-body" transform="${bodyTransform}">`);
  if(state.export.showGraticule) parts.push(exportGraticuleSvg(projection,w,h,bbox,fieldRect));
  if(state.export.showHydro) parts.push(exportHydroSvg(projection,bbox));
  if(state.export.showAdmin) parts.push(exportAdminPolygonsSvg(features, projection, vals));
  if(state.export.showRailways) parts.push(exportRailSvg(projection,bbox));
  if(state.export.showPopulation) parts.push(exportPopulationCirclesSvg(features, projection));
  if(state.export.showLabels && state.export.labelMode!=='none') parts.push(exportAdminLabelsSvg(features, projection, w, h));
  parts.push(`</g></g>`);
  if(state.export.showGraticule && state.export.showGraticuleLabels) parts.push(exportGraticuleLabelsSvg(projection,w,h,bbox,fieldRect));
  if(state.export.showScale) parts.push(`<g id="exportScaleBar">${v64ScaleBarSvg(kmPerPx/(Number(state.export.mapViewport?.zoom)||1.24),w,h,fieldRect)}</g>`);
  parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.16)" stroke-width="1"/></svg>`);
  return parts.join('');
};
const v64PriorUpdateExportLiveMap = updateExportLiveMap;
updateExportLiveMap = async function updateExportLiveMapV64(){
  const el=$('exportSvgMap'); if(!el) return;
  const status=$('exportPreviewStatus');
  try{
    if(status) status.textContent='Строим SVG-карту…';
    el.innerHTML=await buildExportSvgMap();
    initExportScaleBarDragV64();
    if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
  }catch(e){
    console.error('SVG export map error',e);
    el.innerHTML=`<div class="export-map-placeholder">Не удалось построить карту: ${escapeHtml(e.message||String(e))}</div>`;
    if(status) status.textContent='Ошибка построения карты.';
  }
};
const v64PriorApplyExportViewportTransformOnly = typeof applyExportViewportTransformOnly==='function' ? applyExportViewportTransformOnly : null;
applyExportViewportTransformOnly = function applyExportViewportTransformOnlyV64(){
  if(v64PriorApplyExportViewportTransformOnly) v64PriorApplyExportViewportTransformOnly();
  initExportScaleBarDragV64();
};
(function initV64Patch(){
  const boot=()=>{ try{ ensureExportFlags(); initExportScaleBarDragV64(); }catch(e){ console.warn('v64 init skipped',e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();

/* v65: export crash hotfix, field-centered viewport, reliable draggable scale bar, compact 1080p activation */
const v65PriorEnsureExportFlags = ensureExportFlags;
ensureExportFlags = function ensureExportFlagsV65(){
  const ex = v65PriorEnsureExportFlags ? v65PriorEnsureExportFlags() : (state.export || (state.export = {}));
  if(!ex.mapViewport || typeof ex.mapViewport !== 'object') ex.mapViewport = {x:0,y:0,zoom:1};
  if(!Number.isFinite(Number(ex.mapViewport.x))) ex.mapViewport.x = 0;
  if(!Number.isFinite(Number(ex.mapViewport.y))) ex.mapViewport.y = 0;
  if(!Number.isFinite(Number(ex.mapViewport.zoom))) ex.mapViewport.zoom = 1;
  ex.mapViewport.zoom = Math.max(1, Math.min(2.8, Number(ex.mapViewport.zoom)||1));
  if(!ex.scaleBarPosition || typeof ex.scaleBarPosition !== 'object') ex.scaleBarPosition = null;
  if(!ex.extentBuffer || typeof ex.extentBuffer !== 'object') ex.extentBuffer = {top:0,right:0,bottom:0,left:0};
  ['top','right','bottom','left'].forEach(k=>{ if(!Number.isFinite(Number(ex.extentBuffer[k]))) ex.extentBuffer[k]=0; });
  if(!Number.isFinite(Number(ex.minLayerPaddingPx))) ex.minLayerPaddingPx = 10;
  return ex;
};
const v65PriorExportMapBodyTransform = typeof exportMapBodyTransform === 'function' ? exportMapBodyTransform : null;
exportMapBodyTransform = function exportMapBodyTransformV65(w,h){
  const ex = ensureExportFlags();
  const field = (typeof exportMapFieldRect === 'function') ? exportMapFieldRect(w,h) : {x:0,y:0,w,h};
  const vp = exportViewportClamp(field.w, field.h, ex.mapViewport.zoom, ex.mapViewport.x, ex.mapViewport.y);
  ex.mapViewport = vp;
  // Важно: масштабируем вокруг центра внутренней рамки карты, а не вокруг всего PNG-листа.
  // Иначе при правой колонке легенды возникает визуальный перекос запад/восток.
  const cx = field.x + field.w/2;
  const cy = field.y + field.h/2;
  return `translate(${vp.x.toFixed(1)} ${vp.y.toFixed(1)}) translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${vp.zoom.toFixed(4)}) translate(${-cx.toFixed(1)} ${-cy.toFixed(1)})`;
};
function v65ResetManualViewportForAutoFit(){
  try{
    const ex = ensureExportFlags();
    if(ex.autoFitField !== false && ex.mapViewport && !ex.v65ViewportResetOnce){
      ex.mapViewport = {x:0,y:0,zoom:1};
      ex.v65ViewportResetOnce = true;
    }
  }catch(_){ }
}
function v65ScaleBarPointerPoint(svg, evt){
  if(typeof v63SvgPoint === 'function') return v63SvgPoint(svg, evt);
  const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function v65BindScaleBarDrag(){
  const svg = document.querySelector('#exportSvgMap svg.export-map-svg');
  if(!svg || svg.dataset.v65ScaleBound === '1') return;
  svg.dataset.v65ScaleBound = '1';
  svg.addEventListener('pointerdown', ev=>{
    const g = ev.target && ev.target.closest ? ev.target.closest('#exportScaleBar .export-scale-bar-draggable-v64, #exportScaleBar .export-scale-bar-draggable-v63') : null;
    if(!g || !svg.contains(g)) return;
    ev.preventDefault(); ev.stopPropagation();
    if(typeof v62ClearAllExportEditing === 'function') v62ClearAllExportEditing();
    const ex = ensureExportFlags();
    const size = exportMapSize();
    const px = Number(g.dataset.scaleWidth) || 180;
    const baseX = Number(g.dataset.baseX) || 28;
    const baseY = Number(g.dataset.baseY) || Math.max(42, size.h - 28);
    const current = v63ClampScalePosition(ex.scaleBarPosition || {x:baseX,y:baseY}, px, size.w, size.h);
    const start = v65ScaleBarPointerPoint(svg, ev);
    const offset = {x:start.x-current.x, y:start.y-current.y};
    g.classList.add('is-dragging');
    try{ svg.setPointerCapture(ev.pointerId); }catch(_){ }
    const move=e=>{
      const p = v65ScaleBarPointerPoint(svg,e);
      const next = v63ClampScalePosition({x:p.x-offset.x, y:p.y-offset.y}, px, size.w, size.h);
      ex.scaleBarPosition = {x:Math.round(next.x), y:Math.round(next.y)};
      g.setAttribute('transform',`translate(${(next.x-baseX).toFixed(1)} ${(next.y-baseY).toFixed(1)})`);
    };
    const up=()=>{
      document.removeEventListener('pointermove',move);
      document.removeEventListener('pointerup',up);
      g.classList.remove('is-dragging');
      syncExportDefaults(false);
      if(typeof updateExportLiveMap === 'function') updateExportLiveMap();
    };
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',up);
  },{passive:false});
}
const v65PriorBuildExportSvgMap = buildExportSvgMap;
buildExportSvgMap = function buildExportSvgMapV65(){
  v65ResetManualViewportForAutoFit();
  const ex = ensureExportFlags();
  try{
    const {w,h}=exportMapSize();
    const fieldRect=exportMapFieldRect(w,h);
    const features=exportScopeFeatures();
    const bbox=exportExpandedGeoBBox(features);
    const baseProjection=v64MakeFeatureFitProjection(features,bbox,fieldRect.w,fieldRect.h,Number(ex.minLayerPaddingPx)||10);
    const projection=(lon,lat)=>{ const p=baseProjection(lon,lat); return {x:p.x+fieldRect.x, y:p.y+fieldRect.y}; };
    const centerLat=(bbox[1]+bbox[3])/2, centerLon=(bbox[0]+bbox[2])/2;
    const p1=projection(centerLon, centerLat), p2=projection(centerLon+1, centerLat);
    const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
    const kmPerDeg=111.32*Math.cos(centerLat*Math.PI/180);
    const kmPerPx=kmPerDeg/pxPerDeg;
    const field=valField();
    const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)) : [];
    const bodyTransform=exportMapBodyTransform(w,h);
    const zoom=Number(ex.mapViewport && ex.mapViewport.zoom) || 1;
    const parts=[];
    parts.push(`<svg class="export-map-svg" data-map-w="${w}" data-map-h="${h}" data-base-km-per-px="${kmPerPx}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" ry="10"/></clipPath><filter id="labelShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="#eef3ef"/><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" fill="${exportBasemapFill()}" stroke="rgba(111,123,98,.55)" stroke-width="1.2"/><g clip-path="url(#exportMapClip)"><g id="exportMapBody" class="export-map-body" transform="${bodyTransform}">`);
    if(ex.showGraticule) parts.push(exportGraticuleSvg(projection,w,h,bbox,fieldRect));
    if(ex.showHydro) parts.push(exportHydroSvg(projection,bbox));
    if(ex.showAdmin) parts.push(exportAdminPolygonsSvg(features, projection, vals));
    if(ex.showRailways) parts.push(exportRailSvg(projection,bbox));
    if(ex.showPopulation) parts.push(exportPopulationCirclesSvg(features, projection));
    if(ex.showLabels && ex.labelMode!=='none') parts.push(exportAdminLabelsSvg(features, projection, w, h));
    parts.push(`</g></g>`);
    if(ex.showGraticule && ex.showGraticuleLabels) parts.push(exportGraticuleLabelsSvg(projection,w,h,bbox,fieldRect));
    if(ex.showScale) parts.push(`<g id="exportScaleBar">${v64ScaleBarSvg(kmPerPx/zoom,w,h,fieldRect)}</g>`);
    parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.16)" stroke-width="1"/></svg>`);
    return parts.join('');
  }catch(err){
    console.error('v65 buildExportSvgMap failed',err);
    throw err;
  }
};
const v65PriorUpdateExportLiveMap = updateExportLiveMap;
updateExportLiveMap = async function updateExportLiveMapV65(){
  const el=$('exportSvgMap'); if(!el) return;
  const status=$('exportPreviewStatus');
  try{
    ensureExportFlags();
    if(status) status.textContent='Строим SVG-карту…';
    el.innerHTML = await buildExportSvgMap();
    v65BindScaleBarDrag();
    if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
  }catch(e){
    console.error('SVG export map error v65',e);
    el.innerHTML=`<div class="export-map-placeholder">Не удалось построить карту: ${escapeHtml(e.message||String(e))}</div>`;
    if(status) status.textContent='Ошибка построения карты.';
  }
};
function v65UpdateCompactClass(){
  try{
    const compact = window.innerWidth <= 1920 || window.innerHeight <= 1100 || (window.devicePixelRatio >= 1.25 && window.innerWidth <= 2200);
    document.documentElement.classList.toggle('compact-1080-v65', compact);
    document.body.classList.toggle('compact-1080-v65', compact);
  }catch(_){ }
}
(function initV65Patch(){
  const boot=()=>{ try{ ensureExportFlags(); v65UpdateCompactClass(); v65BindScaleBarDrag(); }catch(e){ console.warn('v65 init skipped',e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
  window.addEventListener('resize',v65UpdateCompactClass,{passive:true});
})();

/* v66: Full HD widget ergonomics + north-up Lambert export with 10 px projected padding */
const v66PriorEnsureExportFlags = ensureExportFlags;
ensureExportFlags = function ensureExportFlagsV66(){
  const ex = v66PriorEnsureExportFlags ? v66PriorEnsureExportFlags() : (state.export || (state.export = {}));
  if(!ex.extentBuffer || typeof ex.extentBuffer !== 'object') ex.extentBuffer = {top:0,right:0,bottom:0,left:0};
  ['top','right','bottom','left'].forEach(k=>{ if(!Number.isFinite(Number(ex.extentBuffer[k]))) ex.extentBuffer[k]=0; });
  if(!Number.isFinite(Number(ex.minLayerPaddingPx))) ex.minLayerPaddingPx = 10;
  ex.minLayerPaddingPx = Math.max(10, Number(ex.minLayerPaddingPx)||10);
  if(!ex.mapViewport || typeof ex.mapViewport !== 'object') ex.mapViewport = {x:0,y:0,zoom:1};
  if(!Number.isFinite(Number(ex.mapViewport.x))) ex.mapViewport.x = 0;
  if(!Number.isFinite(Number(ex.mapViewport.y))) ex.mapViewport.y = 0;
  if(!Number.isFinite(Number(ex.mapViewport.zoom))) ex.mapViewport.zoom = 1;
  ex.mapViewport.zoom = Math.max(1, Math.min(2.8, Number(ex.mapViewport.zoom)||1));
  return ex;
};

function v66TimelineBottomGap(){
  const timeline = $('timelineBar');
  if(!timeline) return 10;
  const rect = timeline.getBoundingClientRect();
  const gap = Math.round(window.innerHeight - rect.bottom);
  return Math.max(8, Number.isFinite(gap) ? gap : 10);
}

function initDraggableWidget(panelId, handleId, dragStateKey){
  const panel=$(panelId); const handle=$(handleId) || panel?.querySelector('.drag-handle');
  if(!panel || !handle || panel.dataset.dragReady==='1') return;
  panel.dataset.dragReady='1';
  const bottomGap=()=>v66TimelineBottomGap();
  const clampLeft=(left, rect)=>clamp(left, 8, Math.max(8, window.innerWidth - rect.width - 8));
  const clampTop=(top, rect)=>clamp(top, 8, Math.max(8, window.innerHeight - rect.height - bottomGap()));
  const startDrag=(ev)=>{
    if(ev.target.closest('button,input,select,label,a')) return;
    const point=ev.touches?.[0] || ev;
    const rect=panel.getBoundingClientRect();
    state[dragStateKey]={active:true, dx:point.clientX-rect.left, dy:point.clientY-rect.top};
    panel.classList.add('is-dragging');
    panel.dataset.userDragged='1';
    panel.style.left=`${rect.left}px`;
    panel.style.top=`${rect.top}px`;
    panel.style.right='auto';
    panel.style.bottom='auto';
    panel.style.width=`${rect.width}px`;
    ev.preventDefault();
  };
  const moveDrag=(ev)=>{
    if(!state[dragStateKey]?.active) return;
    const point=ev.touches?.[0] || ev;
    const rect=panel.getBoundingClientRect();
    const left=clampLeft(point.clientX-state[dragStateKey].dx, rect);
    const top=clampTop(point.clientY-state[dragStateKey].dy, rect);
    panel.style.left=`${left}px`;
    panel.style.top=`${top}px`;
    panel.style.right='auto';
    panel.style.bottom='auto';
    panel.style.transform='none';
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
      panel.style.left=`${clampLeft(rect.left, rect)}px`;
      panel.style.top=`${clampTop(rect.top, rect)}px`;
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
  const bottom=v66TimelineBottomGap();
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
    requestAnimationFrame(()=>positionBottomWidgets(false));
  });
  apply();
}

function v66ExportSourceFeatures(features){
  const source = (features && features.length) ? features : (state.currentGeoJSON?.features || state.rawGeoJSON?.features || []);
  return source && source.length ? source : [];
}
function v66LambertRawProject(features, bbox){
  const ex=ensureExportFlags();
  const b = bbox || geoBBoxFromFeatures(v66ExportSourceFeatures(features));
  const centerLon = Number(ex.centralMeridian) || 75;
  const centerLat = Math.max(52, Math.min(72, (b[1]+b[3])/2));
  return lambertForwardFactory({lon0:centerLon, lat0:centerLat, phi1:52, phi2:66});
}
function v66CollectRawProjectedBounds(features, rawProject){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  v66ExportSourceFeatures(features).forEach(f=>{
    walkCoords(f.geometry, ([lon,lat])=>{
      if(!Number.isFinite(lon)||!Number.isFinite(lat)) return;
      const p=rawProject(lon,lat);
      const x=p?.[0], y=p?.[1];
      if(Number.isFinite(x)&&Number.isFinite(y)){
        minX=Math.min(minX,x); maxX=Math.max(maxX,x);
        minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      }
    });
  });
  return Number.isFinite(minX) ? {minX,minY,maxX,maxY} : null;
}
function v66FallbackRawBoundsFromBBox(bbox, rawProject){
  const [minLon,minLat,maxLon,maxLat]=bbox;
  const steps=36;
  const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    [[minLon+(maxLon-minLon)*t,minLat],[minLon+(maxLon-minLon)*t,maxLat],[minLon,minLat+(maxLat-minLat)*t],[maxLon,minLat+(maxLat-minLat)*t]].forEach(([lon,lat])=>{
      const [x,y]=rawProject(lon,lat);
      bounds.minX=Math.min(bounds.minX,x); bounds.maxX=Math.max(bounds.maxX,x);
      bounds.minY=Math.min(bounds.minY,y); bounds.maxY=Math.max(bounds.maxY,y);
    });
  }
  return bounds;
}
function v66BufferedRawBounds(features, bbox, rawProject){
  const ex=ensureExportFlags();
  const source=v66ExportSourceFeatures(features);
  const sourceBBox = bbox || geoBBoxFromFeatures(source);
  let bounds=v66CollectRawProjectedBounds(source, rawProject) || v66FallbackRawBoundsFromBBox(sourceBBox, rawProject);
  const [minLon,minLat,maxLon,maxLat]=sourceBBox;
  const centerLon=(minLon+maxLon)/2;
  const centerLat=(minLat+maxLat)/2;
  const c=rawProject(centerLon,centerLat);
  const b=ex.extentBuffer || {top:0,right:0,bottom:0,left:0};
  const west=rawProject(centerLon-kmToLonDeg(Math.max(0,Number(b.left)||0),centerLat),centerLat);
  const east=rawProject(centerLon+kmToLonDeg(Math.max(0,Number(b.right)||0),centerLat),centerLat);
  const south=rawProject(centerLon,centerLat-kmToLatDeg(Math.max(0,Number(b.bottom)||0)));
  const north=rawProject(centerLon,centerLat+kmToLatDeg(Math.max(0,Number(b.top)||0)));
  const dxW=Math.abs((west?.[0]??c[0])-c[0]);
  const dxE=Math.abs((east?.[0]??c[0])-c[0]);
  const dyS=Math.abs((south?.[1]??c[1])-c[1]);
  const dyN=Math.abs((north?.[1]??c[1])-c[1]);
  return {minX:bounds.minX-dxW, maxX:bounds.maxX+dxE, minY:bounds.minY-dyS, maxY:bounds.maxY+dyN};
}
function v66ProjectedAspect(features){
  const source=v66ExportSourceFeatures(features);
  const bbox=geoBBoxFromFeatures(source);
  const raw=v66LambertRawProject(source,bbox);
  const b=v66BufferedRawBounds(source,bbox,raw);
  const bw=Math.max(1e-9,b.maxX-b.minX);
  const bh=Math.max(1e-9,b.maxY-b.minY);
  return Math.max(0.18, Math.min(5.5, bw/bh));
}
exportSelectionMetricAspect = function exportSelectionMetricAspectV66(features){
  try{ return v66ProjectedAspect(features); }
  catch(err){ console.warn('v66 projected aspect fallback', err); return 1.2; }
};
exportAutoFieldRect = function exportAutoFieldRectV66(w,h,features){
  const outer = exportOuterFrameRect(w,h);
  const topMin = Math.max(82, Math.round(h*0.085));
  const bottomMin = Math.max(44, Math.round(h*0.045));
  const sideMin = Math.max(20, Math.round(w*0.018));
  const sideMax = Math.max(260, Math.round(w*0.23));
  const maxW = Math.max(260, outer.w - sideMin*2);
  const maxH = Math.max(260, outer.h - topMin - bottomMin);
  const aspect = exportSelectionMetricAspect(features);
  let fieldW=maxW;
  let fieldH=fieldW/aspect;
  if(fieldH>maxH){ fieldH=maxH; fieldW=fieldH*aspect; }
  const minWBySideLimit = Math.max(260, outer.w - sideMax*2);
  if(fieldW < minWBySideLimit){
    fieldW = Math.min(maxW, minWBySideLimit);
    fieldH = Math.min(maxH, fieldW/aspect);
  }
  fieldW=Math.max(260, Math.min(maxW, fieldW));
  fieldH=Math.max(260, Math.min(maxH, fieldH));
  const x=outer.x + (outer.w-fieldW)/2;
  const y=outer.y + topMin + (maxH-fieldH)/2;
  return {x:Math.round(x), y:Math.round(y), w:Math.round(fieldW), h:Math.round(fieldH), aspect};
};
function v66MakeFeatureFitProjection(features,bbox,w,h,pad=10){
  const source=v66ExportSourceFeatures(features);
  const sourceBBox=bbox || geoBBoxFromFeatures(source);
  const raw=v66LambertRawProject(source,sourceBBox);
  const bounds=v66BufferedRawBounds(source,sourceBBox,raw);
  const safePad=Math.max(10, Number(pad)||10);
  const bw=Math.max(1e-9,bounds.maxX-bounds.minX);
  const bh=Math.max(1e-9,bounds.maxY-bounds.minY);
  const s=Math.min((w-safePad*2)/bw, (h-safePad*2)/bh);
  const drawW=bw*s;
  const drawH=bh*s;
  const ox=(w-drawW)/2;
  const oy=(h-drawH)/2;
  const fn=(lon,lat)=>{
    const [x,y]=raw(lon,lat);
    return {x:ox+(x-bounds.minX)*s, y:oy+(bounds.maxY-y)*s};
  };
  fn.scale=s; fn.bbox=sourceBBox; fn.w=w; fn.h=h; fn.pad=safePad; fn.kind='lambert'; fn.raw=raw; fn.v66Bounds=bounds;
  return fn;
}
function v66GeoBBoxWithKmBuffer(features){
  const ex=ensureExportFlags();
  const source=v66ExportSourceFeatures(features);
  const bbox=geoBBoxFromFeatures(source);
  const [minX,minY,maxX,maxY]=bbox;
  const centerLat=(minY+maxY)/2;
  const b=ex.extentBuffer || {top:0,right:0,bottom:0,left:0};
  return [
    Math.max(-180, minX-kmToLonDeg(Math.max(0,Number(b.left)||0), centerLat)),
    Math.max(-84, minY-kmToLatDeg(Math.max(0,Number(b.bottom)||0))),
    Math.min(180, maxX+kmToLonDeg(Math.max(0,Number(b.right)||0), centerLat)),
    Math.min(89, maxY+kmToLatDeg(Math.max(0,Number(b.top)||0)))
  ];
}
buildExportSvgMap = async function buildExportSvgMapV66(){
  if(typeof v65ResetManualViewportForAutoFit === 'function') v65ResetManualViewportForAutoFit();
  const ex=ensureExportFlags();
  const {w,h}=exportMapSize();
  const fieldRect=exportMapFieldRect(w,h);
  const features=v66ExportSourceFeatures(exportScopeFeatures());
  const sourceBBox=geoBBoxFromFeatures(features);
  const gridBBox=v66GeoBBoxWithKmBuffer(features);
  const baseProjection=v66MakeFeatureFitProjection(features,sourceBBox,fieldRect.w,fieldRect.h,Number(ex.minLayerPaddingPx)||10);
  const projection=(lon,lat)=>{ const p=baseProjection(lon,lat); return {x:p.x+fieldRect.x, y:p.y+fieldRect.y}; };
  const centerLat=(sourceBBox[1]+sourceBBox[3])/2;
  const centerLon=(sourceBBox[0]+sourceBBox[2])/2;
  const p1=projection(centerLon,centerLat), p2=projection(centerLon+1,centerLat);
  const pxPerDeg=Math.max(1, Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.max(0.12, Math.cos(centerLat*Math.PI/180));
  const kmPerPx=kmPerDeg/pxPerDeg;
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>!Number.isNaN(v)) : [];
  const bodyTransform=exportMapBodyTransform(w,h);
  const zoom=Number(ex.mapViewport && ex.mapViewport.zoom) || 1;
  const parts=[];
  parts.push(`<svg class="export-map-svg export-map-svg-v66" data-map-w="${w}" data-map-h="${h}" data-base-km-per-px="${kmPerPx}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" ry="10"/></clipPath><filter id="labelShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="#eef3ef"/><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" fill="${exportBasemapFill()}" stroke="rgba(111,123,98,.55)" stroke-width="1.2"/><g clip-path="url(#exportMapClip)"><g id="exportMapBody" class="export-map-body" transform="${bodyTransform}">`);
  if(ex.showGraticule) parts.push(await exportGraticuleSvg(projection,w,h,gridBBox,fieldRect));
  if(ex.showHydro) parts.push(await exportHydroSvg(projection,gridBBox));
  if(ex.showAdmin) parts.push(exportAdminPolygonsSvg(features,projection,vals));
  if(ex.showRailways) parts.push(await exportRailSvg(projection,gridBBox));
  if(ex.showPopulation) parts.push(exportPopulationCirclesSvg(features,projection));
  if(ex.showLabels && ex.labelMode!=='none') parts.push(exportAdminLabelsSvg(features,projection,w,h));
  parts.push(`</g></g>`);
  if(ex.showGraticule && ex.showGraticuleLabels) parts.push(exportGraticuleLabelsSvg(projection,w,h,gridBBox,fieldRect));
  if(ex.showScale) parts.push(`<g id="exportScaleBar">${v64ScaleBarSvg(kmPerPx/zoom,w,h,fieldRect)}</g>`);
  parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.16)" stroke-width="1"/></svg>`);
  return parts.join('');
};

const v66PriorUpdateCompactClass = typeof v65UpdateCompactClass === 'function' ? v65UpdateCompactClass : null;
function v66UpdateCompactClass(){
  if(v66PriorUpdateCompactClass) v66PriorUpdateCompactClass();
  try{
    const compact = window.innerWidth <= 1920 || window.innerHeight <= 1100 || (window.devicePixelRatio >= 1.25 && window.innerWidth <= 2200);
    document.documentElement.classList.toggle('compact-1080-v66', compact);
    document.body.classList.toggle('compact-1080-v66', compact);
  }catch(_){ }
}
(function initV66Patch(){
  const boot=()=>{
    try{
      ensureExportFlags();
      v66UpdateCompactClass();
      positionBottomWidgets(false);
      if(typeof v65BindScaleBarDrag === 'function') v65BindScaleBarDrag();
    }catch(e){ console.warn('v66 init skipped', e); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
  window.addEventListener('resize',()=>{ v66UpdateCompactClass(); setTimeout(()=>positionBottomWidgets(false),80); },{passive:true});
})();

/* v67: export auto-fit recentering, independent zoom slider, scale-bar hit priority, classed choropleths, Full HD widget fixes */
function v67Clamp(n, min, max){
  const v = Number(n);
  if(!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function v67ExportZoomFactor(delta){
  return Math.pow(2, v67Clamp(delta, -1.5, 1.5));
}
function v67ExportZoomDeltaFromFactor(factor){
  const z = Math.max(0.1, Number(factor) || 1);
  return v67Clamp(Math.log2(z), -1.5, 1.5);
}
const v67PriorEnsureExportFlags = typeof ensureExportFlags === 'function' ? ensureExportFlags : null;
ensureExportFlags = function ensureExportFlagsV67(){
  const ex = v67PriorEnsureExportFlags ? v67PriorEnsureExportFlags() : (state.export || (state.export = {}));
  if(!ex.mapViewport || typeof ex.mapViewport !== 'object') ex.mapViewport = {x:0,y:0,zoom:1};
  if(!Number.isFinite(Number(ex.exportZoomDelta))){
    const priorZoom = Number(ex.mapViewport.zoom);
    ex.exportZoomDelta = Number.isFinite(priorZoom) ? v67ExportZoomDeltaFromFactor(priorZoom) : 0;
  }
  ex.exportZoomDelta = v67Clamp(ex.exportZoomDelta, -1.5, 1.5);
  if(ex.autoFitField !== false && !ex.manualMapViewport){
    ex.mapViewport.x = 0;
    ex.mapViewport.y = 0;
  }else{
    if(!Number.isFinite(Number(ex.mapViewport.x))) ex.mapViewport.x = 0;
    if(!Number.isFinite(Number(ex.mapViewport.y))) ex.mapViewport.y = 0;
  }
  ex.mapViewport.zoom = v67ExportZoomFactor(ex.exportZoomDelta);
  if(!Number.isFinite(Number(ex.minLayerPaddingPx))) ex.minLayerPaddingPx = 10;
  ex.minLayerPaddingPx = Math.max(10, Number(ex.minLayerPaddingPx) || 10);
  if(!ex.extentBuffer || typeof ex.extentBuffer !== 'object') ex.extentBuffer = {top:0,right:0,bottom:0,left:0};
  ['top','right','bottom','left'].forEach(k=>{ if(!Number.isFinite(Number(ex.extentBuffer[k]))) ex.extentBuffer[k] = 0; });
  return ex;
};

const v67PriorExportViewportClamp = typeof exportViewportClamp === 'function' ? exportViewportClamp : null;
exportViewportClamp = function exportViewportClampV67(w,h,zoom,x,y){
  const z = v67Clamp(zoom, v67ExportZoomFactor(-1.5), v67ExportZoomFactor(1.5));
  let limX = Math.max(24, (Math.max(1, z) - 1) * Math.max(1, w) / 2 + 80);
  let limY = Math.max(24, (Math.max(1, z) - 1) * Math.max(1, h) / 2 + 80);
  if(z < 1){
    // При отдалении карта становится меньше рамки; оставляем только небольшой ручной ход,
    // чтобы пользователь мог визуально сдвинуть композицию, но не потерять слой из рамки.
    limX = Math.max(24, Math.max(1, w) * (1 - z) / 2 + 36);
    limY = Math.max(24, Math.max(1, h) * (1 - z) / 2 + 36);
  }
  return {x:v67Clamp(x || 0, -limX, limX), y:v67Clamp(y || 0, -limY, limY), zoom:z};
};

exportMapBodyTransform = function exportMapBodyTransformV67(w,h){
  const ex = ensureExportFlags();
  const field = (typeof exportMapFieldRect === 'function') ? exportMapFieldRect(w,h) : {x:0,y:0,w,h};
  const baseZoom = v67ExportZoomFactor(ex.exportZoomDelta);
  const startX = (ex.autoFitField !== false && !ex.manualMapViewport) ? 0 : Number(ex.mapViewport?.x) || 0;
  const startY = (ex.autoFitField !== false && !ex.manualMapViewport) ? 0 : Number(ex.mapViewport?.y) || 0;
  const vp = exportViewportClamp(field.w, field.h, baseZoom, startX, startY);
  ex.mapViewport = vp;
  const cx = field.x + field.w/2;
  const cy = field.y + field.h/2;
  return `translate(${vp.x.toFixed(1)} ${vp.y.toFixed(1)}) translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${vp.zoom.toFixed(4)}) translate(${-cx.toFixed(1)} ${-cy.toFixed(1)})`;
};

function v67ResetExportViewportAndFit(){
  const ex = ensureExportFlags();
  ex.manualMapViewport = false;
  ex.mapViewport = {x:0, y:0, zoom:v67ExportZoomFactor(ex.exportZoomDelta)};
  ex.v65ViewportResetOnce = false;
}
function v67SyncExportZoomControls(){
  try{
    const ex = ensureExportFlags();
    const slider = $('exportMapZoomDelta');
    const label = $('exportMapZoomDeltaLabel');
    const value = v67Clamp(ex.exportZoomDelta, -1.5, 1.5);
    if(slider && Math.abs(Number(slider.value) - value) > 0.001) slider.value = value.toFixed(2);
    if(label){
      const pct = Math.round(v67ExportZoomFactor(value) * 100);
      const sign = value > 0 ? '+' : '';
      label.textContent = `${sign}${value.toFixed(2).replace('.',',')} · ${pct}%`;
    }
  }catch(_){ }
}

const v67PriorApplyExportViewportTransformOnly = typeof applyExportViewportTransformOnly === 'function' ? applyExportViewportTransformOnly : null;
applyExportViewportTransformOnly = function applyExportViewportTransformOnlyV67(){
  const ex = ensureExportFlags();
  const svg = document.querySelector('#exportSvgMap svg.export-map-svg');
  if(svg){
    const w = Number(svg.dataset.mapW) || Number(svg.getAttribute('viewBox')?.split(' ')[2]) || exportMapSize().w;
    const h = Number(svg.dataset.mapH) || Number(svg.getAttribute('viewBox')?.split(' ')[3]) || exportMapSize().h;
    const body = svg.querySelector('#exportMapBody');
    if(body) body.setAttribute('transform', exportMapBodyTransform(w,h));
    const scaleWrap = svg.querySelector('#exportScaleBar');
    const baseKm = Number(svg.dataset.baseKmPerPx);
    if(scaleWrap && Number.isFinite(baseKm) && typeof v64ScaleBarSvg === 'function'){
      scaleWrap.innerHTML = v64ScaleBarSvg(baseKm / (Number(ex.mapViewport?.zoom) || 1), w, h, exportMapFieldRect(w,h));
    }
  }else if(v67PriorApplyExportViewportTransformOnly){
    v67PriorApplyExportViewportTransformOnly();
  }
  v67SyncExportZoomControls();
  requestAnimationFrame(v67InstallScaleBarHitbox);
};

function v67InstallExportZoomControls(modal){
  if(!modal || modal.dataset.v67ZoomControls === '1'){
    v67SyncExportZoomControls();
    return;
  }
  const autoStatus = $('exportAutoFieldStatus');
  const anchor = autoStatus?.closest('.export-fieldset') || document.querySelector('#exportInnerWidth')?.closest('.export-fieldset') || document.querySelector('.export-controls .button-row');
  if(anchor){
    anchor.insertAdjacentHTML('afterend', `
      <div class="export-fieldset export-zoom-fieldset-v67">
        <div class="export-fieldset-title">Масштаб карты внутри рамки</div>
        <label class="control-label" for="exportMapZoomDelta">Дополнительный масштаб к автоохвату</label>
        <div class="export-zoom-row-v67"><input id="exportMapZoomDelta" type="range" min="-1.5" max="1.5" step="0.05" value="0"><b id="exportMapZoomDeltaLabel">0,00 · 100%</b></div>
        <div class="button-row export-fit-row-v67"><button id="exportFitScopeNow" type="button">Подогнать слой / выборку сейчас</button><button id="exportResetPanNow" type="button">Сбросить сдвиг</button></div>
        <div class="mini-muted">Автоподгонка центрирует экстент слоя/выборки и вписывает его в рамку с базовым зазором 10 px. Этот ползунок меняет только масштаб содержимого, не растягивая внутреннюю рамку.</div>
      </div>`);
  }
  modal.dataset.v67ZoomControls = '1';
  const slider = $('exportMapZoomDelta');
  if(slider){
    slider.addEventListener('input', e=>{
      const ex = ensureExportFlags();
      ex.exportZoomDelta = v67Clamp(e.target.value, -1.5, 1.5);
      ex.mapViewport.zoom = v67ExportZoomFactor(ex.exportZoomDelta);
      v67SyncExportZoomControls();
      applyExportViewportTransformOnly();
    });
    slider.addEventListener('change', ()=>applyExportViewportTransformOnly());
  }
  const fitBtn = $('exportFitScopeNow');
  if(fitBtn) fitBtn.addEventListener('click', ()=>{
    const ex = ensureExportFlags();
    ex.autoFitField = true;
    if($('exportAutoFitField')) $('exportAutoFitField').checked = true;
    v67ResetExportViewportAndFit();
    renderExportPreviewCard();
  });
  const resetPan = $('exportResetPanNow');
  if(resetPan) resetPan.addEventListener('click', ()=>{
    const ex = ensureExportFlags();
    ex.manualMapViewport = false;
    ex.mapViewport.x = 0;
    ex.mapViewport.y = 0;
    applyExportViewportTransformOnly();
  });
  const auto = $('exportAutoFitField');
  if(auto && auto.dataset.v67Bound !== '1'){
    auto.dataset.v67Bound = '1';
    auto.addEventListener('change', e=>{
      const ex = ensureExportFlags();
      ex.autoFitField = !!e.target.checked;
      if(ex.autoFitField) v67ResetExportViewportAndFit();
    }, true);
  }
  v67SyncExportZoomControls();
}

const v67PriorEnsureExportModal = typeof ensureExportModal === 'function' ? ensureExportModal : null;
ensureExportModal = function ensureExportModalV67(){
  const modal = v67PriorEnsureExportModal ? v67PriorEnsureExportModal() : null;
  v67InstallExportZoomControls(modal);
  return modal;
};

const v67PriorSyncExportDefaults = typeof syncExportDefaults === 'function' ? syncExportDefaults : null;
syncExportDefaults = function syncExportDefaultsV67(resetTitle){
  if(v67PriorSyncExportDefaults) v67PriorSyncExportDefaults(resetTitle);
  v67SyncExportZoomControls();
};

buildExportSvgMap = async function buildExportSvgMapV67(){
  const ex = ensureExportFlags();
  if(ex.autoFitField !== false && !ex.manualMapViewport){
    ex.mapViewport.x = 0;
    ex.mapViewport.y = 0;
  }
  ex.mapViewport.zoom = v67ExportZoomFactor(ex.exportZoomDelta);
  const {w,h} = exportMapSize();
  const fieldRect = exportMapFieldRect(w,h);
  const features = v66ExportSourceFeatures(exportScopeFeatures());
  const sourceBBox = geoBBoxFromFeatures(features);
  const gridBBox = (typeof v66GeoBBoxWithKmBuffer === 'function') ? v66GeoBBoxWithKmBuffer(features) : sourceBBox;
  const baseProjection = (typeof v66MakeFeatureFitProjection === 'function')
    ? v66MakeFeatureFitProjection(features, sourceBBox, fieldRect.w, fieldRect.h, Number(ex.minLayerPaddingPx) || 10)
    : makeExportProjection(sourceBBox, fieldRect.w, fieldRect.h, Number(ex.minLayerPaddingPx) || 10);
  const projection = (lon,lat)=>{ const p = baseProjection(lon,lat); return {x:p.x + fieldRect.x, y:p.y + fieldRect.y}; };
  const centerLat = (sourceBBox[1] + sourceBBox[3]) / 2;
  const centerLon = (sourceBBox[0] + sourceBBox[2]) / 2;
  const p1 = projection(centerLon, centerLat), p2 = projection(centerLon + 1, centerLat);
  const pxPerDeg = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
  const kmPerDeg = 111.32 * Math.max(0.12, Math.cos(centerLat * Math.PI / 180));
  const kmPerPx = kmPerDeg / pxPerDeg;
  const field = valField();
  const vals = field ? features.map(f=>Number(f.properties?.[field])).filter(v=>Number.isFinite(v)) : [];
  const bodyTransform = exportMapBodyTransform(w,h);
  const zoom = Number(ex.mapViewport?.zoom) || 1;
  const parts=[];
  parts.push(`<svg class="export-map-svg export-map-svg-v66 export-map-svg-v67" data-map-w="${w}" data-map-h="${h}" data-base-km-per-px="${kmPerPx}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" ry="10"/></clipPath><filter id="labelShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="#eef3ef"/><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" fill="${exportBasemapFill()}" stroke="rgba(111,123,98,.55)" stroke-width="1.2"/><g clip-path="url(#exportMapClip)"><g id="exportMapBody" class="export-map-body" transform="${bodyTransform}">`);
  if(ex.showGraticule) parts.push(await exportGraticuleSvg(projection,w,h,gridBBox,fieldRect));
  if(ex.showHydro) parts.push(await exportHydroSvg(projection,gridBBox));
  if(ex.showAdmin) parts.push(exportAdminPolygonsSvg(features,projection,vals));
  if(ex.showRailways) parts.push(await exportRailSvg(projection,gridBBox));
  if(ex.showPopulation) parts.push(exportPopulationCirclesSvg(features,projection));
  if(ex.showLabels && ex.labelMode !== 'none') parts.push(exportAdminLabelsSvg(features,projection,w,h));
  parts.push(`</g></g>`);
  if(ex.showGraticule && ex.showGraticuleLabels) parts.push(exportGraticuleLabelsSvg(projection,w,h,gridBBox,fieldRect));
  if(ex.showScale) parts.push(`<g id="exportScaleBar">${v64ScaleBarSvg(kmPerPx / zoom, w, h, fieldRect)}</g>`);
  parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.16)" stroke-width="1"/></svg>`);
  return parts.join('');
};

let v67ExportRenderSeq = 0;
updateExportLiveMap = async function updateExportLiveMapV67(){
  const el = $('exportSvgMap'); if(!el) return;
  const status = $('exportPreviewStatus');
  const seq = ++v67ExportRenderSeq;
  try{
    ensureExportFlags();
    if(status) status.textContent = 'Строим SVG-карту…';
    const svg = await buildExportSvgMap();
    if(seq !== v67ExportRenderSeq) return;
    el.innerHTML = svg;
    if(typeof v65BindScaleBarDrag === 'function') v65BindScaleBarDrag();
    requestAnimationFrame(v67InstallScaleBarHitbox);
    v67SyncExportZoomControls();
    if(status) status.textContent = 'Превью обновлено. Можно сохранить PNG.';
  }catch(e){
    console.error('SVG export map error v67', e);
    if(seq !== v67ExportRenderSeq) return;
    el.innerHTML = `<div class="export-map-placeholder">Не удалось построить карту: ${escapeHtml(e.message || String(e))}</div>`;
    if(status) status.textContent = 'Ошибка построения карты.';
  }
};

function v67InstallScaleBarHitbox(){
  const frame = document.querySelector('.export-map-frame-v62, .export-map-frame-v51, .export-map-frame-v50');
  if(!frame) return;
  frame.querySelectorAll('.export-scale-hitbox-v67').forEach(el=>el.remove());
  const group = frame.querySelector('#exportScaleBar .export-scale-bar-draggable-v64, #exportScaleBar .export-scale-bar-draggable-v63');
  if(!group) return;
  const ex = ensureExportFlags();
  const width = Number(group.dataset.scaleWidth) || 180;
  const baseX = Number(group.dataset.baseX) || 0;
  const baseY = Number(group.dataset.baseY) || 0;
  const pos = ex.scaleBarPosition && Number.isFinite(Number(ex.scaleBarPosition.x)) && Number.isFinite(Number(ex.scaleBarPosition.y))
    ? {x:Number(ex.scaleBarPosition.x), y:Number(ex.scaleBarPosition.y)}
    : {x:baseX, y:baseY};
  const hit = document.createElement('div');
  hit.className = 'export-scale-hitbox-v67';
  hit.title = 'Перетащить масштабную линейку';
  const apply = (p)=>{
    hit.style.left = `${Math.round(p.x - 24)}px`;
    hit.style.top = `${Math.round(p.y - 44)}px`;
    hit.style.width = `${Math.round(width + 48)}px`;
    hit.style.height = '74px';
    group.setAttribute('transform', `translate(${(p.x-baseX).toFixed(1)} ${(p.y-baseY).toFixed(1)})`);
  };
  apply(pos);
  hit.addEventListener('mouseenter', ()=>group.classList.add('is-hover-priority'));
  hit.addEventListener('mouseleave', ()=>group.classList.remove('is-hover-priority'));
  hit.addEventListener('pointerdown', ev=>{
    ev.preventDefault();
    ev.stopPropagation();
    if(typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    frame.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50,.export-outer-outline-v62').forEach(el=>el.classList.remove('is-editing'));
    hit.classList.add('is-dragging');
    group.classList.add('is-dragging','is-hover-priority');
    hit.setPointerCapture?.(ev.pointerId);
    const r = frame.getBoundingClientRect();
    const start = {x:pos.x, y:pos.y, clientX:ev.clientX, clientY:ev.clientY};
    const clampFn = (typeof v63ClampScalePosition === 'function') ? v63ClampScalePosition : function(p){
      return {x:v67Clamp(p.x, 48, r.width - width - 24), y:v67Clamp(p.y, 56, r.height - 24)};
    };
    const move = e=>{
      e.preventDefault();
      e.stopPropagation();
      const next = clampFn({x:start.x + (e.clientX - start.clientX), y:start.y + (e.clientY - start.clientY)}, r.width, r.height, width);
      ex.scaleBarPosition = {x:next.x, y:next.y};
      apply(next);
    };
    const up = e=>{
      e.preventDefault();
      e.stopPropagation();
      hit.classList.remove('is-dragging');
      group.classList.remove('is-dragging');
      hit.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }, true);
  frame.appendChild(hit);
}

const v67SequentialModes = new Set(['population','density','urban_share','rail_length','rail_density']);
const v67FixedModes = new Set(['density','urban_share','rail_density']);
const v67PriorValueColor = typeof valueColor === 'function' ? valueColor : null;
const v67PriorUpdateLegend = typeof updateLegend === 'function' ? updateLegend : null;
function v67MetricDisplayValue(v, mode=state.mode){
  const n = Number(v);
  if(!Number.isFinite(n)) return null;
  return mode === 'urban_share' ? n * 100 : n;
}
function v67ModeUnit(mode=state.mode){ return mode === 'urban_share' ? '%' : ''; }
function v67FixedBreaks(mode=state.mode){
  if(mode === 'density' || mode === 'rail_density'){
    return {thresholds:[0.1,1,2.5,5,10,20], labels:['до 0,1','0,1–1','1–2,5','2,5–5','5–10','10–20','более 20']};
  }
  if(mode === 'urban_share'){
    return {thresholds:[5,10,25,50,70,80], labels:['до 5%','5–10%','10–25%','25–50%','50–70%','70–80%','более 80%']};
  }
  return null;
}
function v67RoundBreak(raw, mode=state.mode){
  const n = Number(raw);
  if(!Number.isFinite(n)) return null;
  if(mode === 'urban_share') return Math.max(0, Math.min(100, Math.round(n / 5) * 5));
  const abs = Math.abs(n);
  let step = 5;
  if(abs < 1) step = 0.1;
  else if(abs < 5) step = 0.5;
  return Math.max(0, Math.round(n / step) * step);
}
function v67FmtBreak(v, mode=state.mode){
  const n = Number(v);
  if(!Number.isFinite(n)) return '—';
  const hasFrac = Math.abs(n - Math.round(n)) > 0.001;
  const s = (hasFrac ? n.toFixed(n < 1 ? 1 : 1) : String(Math.round(n))).replace('.',',');
  return s + v67ModeUnit(mode);
}
function v67ClassIndexByThresholds(displayValue, thresholds){
  if(!thresholds || !thresholds.length) return 0;
  for(let i=0;i<thresholds.length;i++) if(displayValue < thresholds[i] || Math.abs(displayValue - thresholds[i]) < 1e-9) return i;
  return thresholds.length;
}
function v67Quantile(values, q){
  const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if(lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function v67UniqueIncreasingBreaks(raw, mode=state.mode){
  const out=[];
  raw.forEach(v=>{
    const r = v67RoundBreak(v, mode);
    if(r === null) return;
    const last = out[out.length-1];
    if(last === undefined || r > last) out.push(r);
  });
  return out.slice(0,6);
}
function v67DynamicBreaks(values, mode=state.mode, method='quantile'){
  const displayVals = (values || []).map(v=>v67MetricDisplayValue(v, mode)).filter(v=>Number.isFinite(v));
  if(!displayVals.length) return null;
  const min = Math.min(...displayVals), max = Math.max(...displayVals);
  if(max <= min) return null;
  const k = Math.min(7, Math.max(3, Math.ceil(Math.sqrt(displayVals.length))));
  let thresholds=[];
  if(method === 'geometric'){
    const positives = displayVals.filter(v=>v>0).sort((a,b)=>a-b);
    const minPos = positives[0] || Math.max(0.1, max/1000);
    const maxPos = positives[positives.length-1] || max;
    const ratio = Math.pow(maxPos / minPos, 1 / k);
    for(let i=1;i<k;i++) thresholds.push(minPos * Math.pow(ratio, i));
  }else{
    for(let i=1;i<k;i++) thresholds.push(v67Quantile(displayVals, i/k));
  }
  thresholds = v67UniqueIncreasingBreaks(thresholds, mode).filter(v=>v > min && v < max);
  if(!thresholds.length) return null;
  const labels=[];
  for(let i=0;i<=thresholds.length;i++){
    if(i===0) labels.push(`до ${v67FmtBreak(thresholds[0], mode)}`);
    else if(i===thresholds.length) labels.push(`более ${v67FmtBreak(thresholds[i-1], mode)}`);
    else labels.push(`${v67FmtBreak(thresholds[i-1], mode)}–${v67FmtBreak(thresholds[i], mode)}`);
  }
  return {thresholds, labels};
}
function v67ScaleMode(){
  const saved = state.choroplethScale || storageGet('wsAtlasChoroplethScale') || '';
  if(saved && ['continuous','fixed','quantile','geometric'].includes(saved)) return saved;
  if(v67FixedModes.has(state.mode)) return 'fixed';
  return 'continuous';
}
function v67ClassDescriptor(values, mode=state.mode){
  const method = v67ScaleMode();
  if(method === 'fixed' && v67FixedModes.has(mode)) return {...v67FixedBreaks(mode), method:'fixed'};
  if(method === 'quantile' || method === 'geometric'){
    const dyn = v67DynamicBreaks(values, mode, method);
    if(dyn) return {...dyn, method};
  }
  return null;
}
function v67ColorFromClass(idx, count){
  const rr = activeValueRamp();
  if(!rr.length) return '#808080';
  if(count <= 1) return rr[rr.length-1];
  return rr[v67Clamp(Math.round(idx * (rr.length - 1) / (count - 1)), 0, rr.length - 1)];
}
valueColor = function valueColorV67(v, values){
  const display = v67MetricDisplayValue(v);
  if(display === null) return '#a7adb8';
  const desc = v67ClassDescriptor(values || [], state.mode);
  if(desc){
    const idx = v67ClassIndexByThresholds(display, desc.thresholds);
    return v67ColorFromClass(idx, desc.thresholds.length + 1);
  }
  return v67PriorValueColor ? v67PriorValueColor(v, values || []) : '#808080';
};
function v67ChoroplethTitle(){
  const opt = $('modeSelect')?.selectedOptions?.[0]?.textContent?.trim();
  return opt || 'Значение показателя';
}
updateLegend = function updateLegendV67(gj, vals){
  const box = $('legendBox'); if(!box || !gj) return;
  let html = '<b>Легенда</b>';
  if(state.mode==='admin_parent'||state.mode==='admin_intermediate'||state.mode==='admin_superparent'||state.mode==='unit_type'){
    const field = state.mode;
    const cats = [...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,14);
    cats.forEach(c=>{ html += `<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${escapeHtml(c)}</div>`; });
  }else{
    const desc = v67ClassDescriptor(vals || [], state.mode);
    html += `<div class="legend-subtitle-v67">${escapeHtml(v67ChoroplethTitle())}</div>`;
    if(desc){
      const count = desc.thresholds.length + 1;
      desc.labels.forEach((label,i)=>{
        html += `<div class="legend-row legend-row-class-v67"><span class="swatch" style="background:${v67ColorFromClass(i,count)}"></span><span>${escapeHtml(label)}</span></div>`;
      });
      const modeLabel = desc.method === 'fixed' ? 'фиксированные классы' : (desc.method === 'quantile' ? 'квантили, округлены' : 'геометрическая шкала, округлена');
      html += `<div class="mini-muted legend-scale-note-v67">${modeLabel}</div>`;
    }else{
      activeValueRamp().forEach((c,i,arr)=>{ html += `<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===arr.length-1?'больше':''}</div>`; });
    }
  }
  if(state.layers.hydro && $('hydroToggle')?.checked){ html += '<hr><div class="legend-row"><span class="line-sample water"></span>реки</div><div class="legend-row"><span class="swatch water-fill"></span>озёра и водохранилища</div>'; }
  if(state.layers.rail && $('railToggle')?.checked){ html += '<div class="legend-row"><span class="line-sample rail"></span>железные дороги</div>'; }
  const visibleFeatures = selectedFeatures();
  if($('centersToggle')?.checked && visibleFeatures.some(f=>(Number(f.properties.population)||0)>0)) html += '<hr><div class="legend-row"><span class="circle-sample"></span>круги населения</div>';
  box.innerHTML = html;
};

function v67InstallChoroplethScaleControl(){
  const modeSelect = $('modeSelect');
  if(!modeSelect || $('choroplethScaleSelect')) return;
  const label = document.createElement('label');
  label.className = 'control-label choropleth-scale-control-v67';
  label.htmlFor = 'choroplethScaleSelect';
  label.textContent = 'Шкала заливки';
  const select = document.createElement('select');
  select.id = 'choroplethScaleSelect';
  select.className = 'choropleth-scale-control-v67';
  select.innerHTML = `
    <option value="continuous">Непрерывная по рангу</option>
    <option value="fixed">Фиксированные классы</option>
    <option value="quantile">Квантили, округлённые</option>
    <option value="geometric">Геометрическая, округлённая</option>`;
  modeSelect.parentNode.insertBefore(label, modeSelect.nextSibling);
  modeSelect.parentNode.insertBefore(select, label.nextSibling);
  if(modeSelect.dataset.v67ChoroplethBound !== '1'){
    modeSelect.dataset.v67ChoroplethBound = '1';
    modeSelect.addEventListener('change', ()=>setTimeout(v67SyncChoroplethScaleControl, 0));
  }
  select.addEventListener('change', e=>{
    state.choroplethScale = e.target.value;
    storageSet('wsAtlasChoroplethScale', state.choroplethScale);
    v67SyncChoroplethScaleControl();
    if(typeof refreshVectorStyles === 'function') refreshVectorStyles();
    updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
  });
  v67SyncChoroplethScaleControl();
}
function v67SyncChoroplethScaleControl(){
  const select = $('choroplethScaleSelect');
  const controls = document.querySelectorAll('.choropleth-scale-control-v67');
  const show = v67SequentialModes.has(state.mode);
  controls.forEach(el=>{ el.style.display = show ? '' : 'none'; });
  if(!select) return;
  const fixedOpt = select.querySelector('option[value="fixed"]');
  if(fixedOpt) fixedOpt.disabled = !v67FixedModes.has(state.mode);
  let val = v67ScaleMode();
  if(val === 'fixed' && !v67FixedModes.has(state.mode)) val = 'continuous';
  select.value = val;
}
const v67PriorRefreshVectorStyles = typeof refreshVectorStyles === 'function' ? refreshVectorStyles : null;
refreshVectorStyles = function refreshVectorStylesV67(){
  v67SyncChoroplethScaleControl();
  if(v67PriorRefreshVectorStyles) return v67PriorRefreshVectorStyles();
};

function v67TimelineBottomGap(){
  const timeline = $('timelineBar');
  if(!timeline) return 10;
  const rect = timeline.getBoundingClientRect();
  const gap = Math.round(window.innerHeight - rect.bottom);
  return Math.max(8, Number.isFinite(gap) ? gap : 10);
}
function v67ClampWidgetToViewport(panel){
  if(!panel) return;
  const rect = panel.getBoundingClientRect();
  const bottomGap = v67TimelineBottomGap();
  const left = v67Clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8));
  const top = v67Clamp(rect.top, 8, Math.max(8, window.innerHeight - bottomGap - rect.height));
  if(panel.dataset.userDragged === '1'){
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
  }
}
function v67BindLooseBottomDrag(panelId, handleId, stateKey){
  const panel = $(panelId); const handle = $(handleId) || panel?.querySelector('.drag-handle');
  if(!panel || !handle || handle.dataset.v67LooseDrag === '1') return;
  handle.dataset.v67LooseDrag = '1';
  handle.style.touchAction = 'none';
  const start = ev=>{
    if(ev.target.closest('button,input,select,label,a')) return;
    ev.preventDefault(); ev.stopPropagation();
    if(typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    const rect = panel.getBoundingClientRect();
    const sx = ev.clientX, sy = ev.clientY;
    const st = {left:rect.left, top:rect.top, dx:sx - rect.left, dy:sy - rect.top, width:rect.width};
    state[stateKey] = {active:true, dx:st.dx, dy:st.dy};
    panel.classList.add('is-dragging');
    panel.dataset.userDragged = '1';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${rect.width}px`;
    panel.style.transform = 'none';
    handle.setPointerCapture?.(ev.pointerId);
    const move = e=>{
      e.preventDefault(); e.stopPropagation();
      const r = panel.getBoundingClientRect();
      const bottomGap = v67TimelineBottomGap();
      const left = v67Clamp(e.clientX - st.dx, 8, Math.max(8, window.innerWidth - r.width - 8));
      const top = v67Clamp(e.clientY - st.dy, 8, Math.max(8, window.innerHeight - bottomGap - r.height));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    };
    const up = e=>{
      e.preventDefault(); e.stopPropagation();
      panel.classList.remove('is-dragging');
      if(state[stateKey]) state[stateKey].active = false;
      handle.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      v67ClampWidgetToViewport(panel);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };
  handle.addEventListener('pointerdown', start, true);
}
const v67PriorPositionBottomWidgets = typeof positionBottomWidgets === 'function' ? positionBottomWidgets : null;
positionBottomWidgets = function positionBottomWidgetsV67(force=false){
  if(v67PriorPositionBottomWidgets) v67PriorPositionBottomWidgets(force);
  ['metricFilters','parentFilterBar'].forEach(id=>v67ClampWidgetToViewport($(id)));
};
function v67UpdateCompactClass(){
  if(typeof v66UpdateCompactClass === 'function') v66UpdateCompactClass();
  try{
    const compact = window.innerWidth <= 1920 || window.innerHeight <= 1100 || (window.devicePixelRatio >= 1.25 && window.innerWidth <= 2200);
    document.documentElement.classList.toggle('compact-1080-v67', compact);
    document.body.classList.toggle('compact-1080-v67', compact);
  }catch(_){ }
}

(function initV67Patch(){
  const boot = ()=>{
    try{
      ensureExportFlags();
      v67UpdateCompactClass();
      v67InstallChoroplethScaleControl();
      v67BindLooseBottomDrag('metricFilters','metricFiltersHandle','metricFilterDrag');
      v67BindLooseBottomDrag('parentFilterBar','parentFilterHandle','parentFilterDrag');
      positionBottomWidgets(false);
      v67SyncChoroplethScaleControl();
      requestAnimationFrame(()=>{ v67InstallScaleBarHitbox(); v67SyncExportZoomControls(); });
    }catch(e){ console.warn('v67 init skipped', e); }
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
  window.addEventListener('resize', ()=>{ v67UpdateCompactClass(); setTimeout(()=>positionBottomWidgets(false),80); }, {passive:true});
})();

/* v68: export performance cache/debounce, fixed scale-bar drag, clipped dynamic graticule labels, context dimming, rail-length class scales, Full HD drag clamp */
function v68Finite(v, fallback){ const n=Number(v); return Number.isFinite(n) ? n : fallback; }
function v68Clamp(n,min,max){ const v=Number(n); return Math.max(min, Math.min(max, Number.isFinite(v)?v:min)); }
const v68PriorEnsureExportFlags = typeof ensureExportFlags === 'function' ? ensureExportFlags : null;
ensureExportFlags = function ensureExportFlagsV68(){
  const ex = v68PriorEnsureExportFlags ? v68PriorEnsureExportFlags() : (state.export || (state.export = {}));
  if(!Number.isFinite(Number(ex.contextDimOpacity))) ex.contextDimOpacity = 0;
  ex.contextDimOpacity = v68Clamp(ex.contextDimOpacity, 0, 0.85);
  if(!ex._v68) ex._v68 = {};
  return ex;
};

function v68SyncContextDimControls(){
  const ex = ensureExportFlags();
  const slider = $('exportContextDimOpacity');
  const label = $('exportContextDimOpacityLabel');
  const value = v68Clamp(ex.contextDimOpacity,0,0.85);
  if(slider && Math.abs(Number(slider.value)-value)>0.001) slider.value = value.toFixed(2);
  if(label) label.textContent = `${Math.round(value*100)}%`;
}
function v68InstallContextDimControls(modal){
  if(!modal || modal.dataset.v68DimControls === '1'){
    v68SyncContextDimControls();
    return;
  }
  const anchor = document.querySelector('.export-zoom-fieldset-v67') || document.querySelector('#exportShowHydro')?.closest('.export-option-grid') || document.querySelector('.export-controls .button-row');
  if(anchor){
    anchor.insertAdjacentHTML('afterend', `
      <div class="export-fieldset export-dim-fieldset-v68">
        <div class="export-fieldset-title">Приглушение окружения вне слоя / выборки</div>
        <label class="control-label" for="exportContextDimOpacity">Непрозрачность приглушающего фона</label>
        <div class="export-dim-row-v68"><input id="exportContextDimOpacity" type="range" min="0" max="0.85" step="0.01" value="0"><b id="exportContextDimOpacityLabel">0%</b></div>
        <div class="mini-muted">0% — окружающая гидрография и дороги не приглушаются. Больше значение — сильнее гасится фон за пределами текущего слоя или выборки.</div>
      </div>`);
  }
  modal.dataset.v68DimControls = '1';
  const slider = $('exportContextDimOpacity');
  if(slider){
    slider.addEventListener('input', e=>{
      const ex = ensureExportFlags();
      ex.contextDimOpacity = v68Clamp(e.target.value,0,0.85);
      v68SyncContextDimControls();
      v68ScheduleExportPreviewUpdate(90);
    });
    slider.addEventListener('change', ()=>v68ScheduleExportPreviewUpdate(0));
  }
  v68SyncContextDimControls();
}
const v68PriorEnsureExportModal = typeof ensureExportModal === 'function' ? ensureExportModal : null;
ensureExportModal = function ensureExportModalV68(){
  const modal = v68PriorEnsureExportModal ? v68PriorEnsureExportModal() : null;
  v68InstallContextDimControls(modal);
  return modal;
};
const v68PriorSyncExportDefaults = typeof syncExportDefaults === 'function' ? syncExportDefaults : null;
syncExportDefaults = function syncExportDefaultsV68(resetTitle){
  if(v68PriorSyncExportDefaults) v68PriorSyncExportDefaults(resetTitle);
  v68SyncContextDimControls();
};

function v68GraticuleStep(bbox){
  const spanLon = Math.abs((bbox?.[2]||0) - (bbox?.[0]||0));
  const spanLat = Math.abs((bbox?.[3]||0) - (bbox?.[1]||0));
  const span = Math.max(spanLon, spanLat);
  if(span <= 10) return 1;
  if(span <= 22) return 2;
  if(span <= 46) return 5;
  return 10;
}
function v68FormatLon(lon){ return `${Math.abs(lon)}°${lon>=0?'E':'W'}`; }
function v68FormatLat(lat){ return `${Math.abs(lat)}°${lat>=0?'N':'S'}`; }
function exportGraticuleSvg(project,w,h,bbox,fieldRect){
  const style = exportGraticuleStyle();
  const [minLon,minLat,maxLon,maxLat] = bbox;
  const step = v68GraticuleStep(bbox);
  const paths = [];
  const lon0 = Math.ceil(minLon/step)*step;
  const lat0 = Math.ceil(minLat/step)*step;
  const latInc = Math.max(0.02,(maxLat-minLat)/72);
  const lonInc = Math.max(0.02,(maxLon-minLon)/72);
  for(let lon=lon0; lon<=maxLon+1e-9; lon+=step){
    const pts=[];
    for(let lat=minLat; lat<=maxLat+1e-9; lat+=latInc){
      const p=project(lon,lat); pts.push(`${pts.length?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    paths.push(`<path d="${pts.join(' ')}" fill="none" stroke="${style.stroke}" stroke-width="0.65" stroke-dasharray="${style.dash}"/>`);
  }
  for(let lat=lat0; lat<=maxLat+1e-9; lat+=step){
    const pts=[];
    for(let lon=minLon; lon<=maxLon+1e-9; lon+=lonInc){
      const p=project(lon,lat); pts.push(`${pts.length?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    paths.push(`<path d="${pts.join(' ')}" fill="none" stroke="${style.stroke}" stroke-width="0.65" stroke-dasharray="${style.dash}"/>`);
  }
  return `<g class="export-graticule export-graticule-v68">${paths.join('')}</g>`;
}
function exportGraticuleLabelsSvg(project,w,h,bbox,fieldRect){
  const style = exportGraticuleStyle();
  const [minLon,minLat,maxLon,maxLat] = bbox;
  const step = v68GraticuleStep(bbox);
  const field = fieldRect || exportMapFieldRect(w,h);
  const fs = Math.max(8, Math.min(18, Number(state.export?.graticuleLabelSize)||12));
  const labels=[];
  const lon0 = Math.ceil(minLon/step)*step;
  const lat0 = Math.ceil(minLat/step)*step;
  for(let lon=lon0; lon<=maxLon+1e-9; lon+=step){
    const p=project(lon, minLat + (maxLat-minLat)*0.035);
    const x=v68Clamp(p.x, field.x+24, field.x+field.w-24);
    if(p.x>=field.x+18 && p.x<=field.x+field.w-18){
      labels.push(`<text class="export-degree-label export-degree-label-v68" x="${x.toFixed(1)}" y="${(field.y+field.h-10).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${style.label}">${v68FormatLon(lon)}</text>`);
    }
  }
  for(let lat=lat0; lat<=maxLat+1e-9; lat+=step){
    const p=project(minLon + (maxLon-minLon)*0.035, lat);
    const y=v68Clamp(p.y, field.y+18, field.y+field.h-18);
    if(p.y>=field.y+18 && p.y<=field.y+field.h-18){
      labels.push(`<text class="export-degree-label export-degree-label-v68" x="${(field.x+10).toFixed(1)}" y="${(y+fs*0.32).toFixed(1)}" text-anchor="start" font-size="${fs}" fill="${style.label}">${v68FormatLat(lat)}</text>`);
    }
  }
  return `<g class="export-graticule-labels export-graticule-labels-v68" pointer-events="none">${labels.join('')}</g>`;
}

function v68FieldRectPath(field){
  return `M${field.x.toFixed(1)},${field.y.toFixed(1)}H${(field.x+field.w).toFixed(1)}V${(field.y+field.h).toFixed(1)}H${field.x.toFixed(1)}Z`;
}
function v68ContextDimSvg(features, projection, fieldRect){
  const ex = ensureExportFlags();
  const opacity = v68Clamp(ex.contextDimOpacity,0,0.85);
  if(opacity <= 0.001) return '';
  const source = (features && features.length) ? features : [];
  const layerPaths = source.map(f=>geomToSvgPath(f.geometry, projection)).filter(Boolean).join(' ');
  if(!layerPaths) return '';
  const fill = exportBasemapFill ? exportBasemapFill() : '#eef3ef';
  const d = `${v68FieldRectPath(fieldRect)} ${layerPaths}`;
  return `<g class="export-context-dim-v68" clip-path="url(#exportMapClip)" pointer-events="none"><path d="${d}" fill="${fill}" fill-opacity="${opacity.toFixed(2)}" fill-rule="evenodd" clip-rule="evenodd"/></g>`;
}

const v68FullSvgCache = new Map();
function v68ExportFeatureSignature(features){
  const arr = (features||[]).map(f=>{
    try{ return featureId(f) || f.properties?.unit_id || f.properties?.id || f.properties?.name || ''; }
    catch(_){ return f.properties?.unit_id || f.properties?.name || ''; }
  });
  return `${arr.length}:${arr.slice(0,850).join('|')}`;
}
function v68ExportMapCacheKey(){
  const ex=ensureExportFlags();
  const {w,h}=exportMapSize();
  const features = (typeof v66ExportSourceFeatures === 'function') ? v66ExportSourceFeatures(exportScopeFeatures()) : exportScopeFeatures();
  let bbox='';
  try{ bbox = geoBBoxFromFeatures(features).map(v=>Number(v).toFixed(5)).join(','); }catch(_){ bbox=''; }
  const f = exportMapFieldRect(w,h);
  const buf = ['top','right','bottom','left'].map(k=>Math.round(Number(ex.extentBuffer?.[k])||0)).join(',');
  const scale = ex.scaleBarPosition ? `${Math.round(Number(ex.scaleBarPosition.x)||0)},${Math.round(Number(ex.scaleBarPosition.y)||0)}` : 'auto';
  const flags = ['showHydro','showAdmin','showRailways','showPopulation','showLabels','showGraticule','showGraticuleLabels','showScale'].map(k=>ex[k]?'1':'0').join('');
  return [APP_VERSION,state.year,state.mode,ex.scope,flags,ex.labelMode,Math.round(Number(ex.graticuleLabelSize)||12),Number(ex.exportZoomDelta||0).toFixed(2),Number(ex.contextDimOpacity||0).toFixed(2),w,h,f.x,f.y,f.w,f.h,buf,scale,bbox,v68ExportFeatureSignature(features)].join('§');
}

buildExportSvgMap = async function buildExportSvgMapV68(){
  const ex = ensureExportFlags();
  if(ex.autoFitField !== false && !ex.manualMapViewport){
    ex.mapViewport.x = 0;
    ex.mapViewport.y = 0;
  }
  ex.mapViewport.zoom = (typeof v67ExportZoomFactor === 'function') ? v67ExportZoomFactor(ex.exportZoomDelta) : (Number(ex.mapViewport.zoom)||1);
  const {w,h} = exportMapSize();
  const fieldRect = exportMapFieldRect(w,h);
  const features = (typeof v66ExportSourceFeatures === 'function') ? v66ExportSourceFeatures(exportScopeFeatures()) : exportScopeFeatures();
  const sourceBBox = geoBBoxFromFeatures(features);
  const gridBBox = (typeof v66GeoBBoxWithKmBuffer === 'function') ? v66GeoBBoxWithKmBuffer(features) : sourceBBox;
  const baseProjection = (typeof v66MakeFeatureFitProjection === 'function')
    ? v66MakeFeatureFitProjection(features, sourceBBox, fieldRect.w, fieldRect.h, Number(ex.minLayerPaddingPx) || 10)
    : makeExportProjection(sourceBBox, fieldRect.w, fieldRect.h, Number(ex.minLayerPaddingPx) || 10);
  const projection = (lon,lat)=>{ const p=baseProjection(lon,lat); return {x:p.x+fieldRect.x, y:p.y+fieldRect.y}; };
  const centerLat = (sourceBBox[1]+sourceBBox[3])/2;
  const centerLon = (sourceBBox[0]+sourceBBox[2])/2;
  const p1=projection(centerLon,centerLat), p2=projection(centerLon+1,centerLat);
  const pxPerDeg=Math.max(1,Math.hypot(p2.x-p1.x,p2.y-p1.y));
  const kmPerDeg=111.32*Math.max(0.12,Math.cos(centerLat*Math.PI/180));
  const kmPerPx=kmPerDeg/pxPerDeg;
  const field=valField();
  const vals=field?features.map(f=>Number(f.properties?.[field])).filter(v=>Number.isFinite(v)):[];
  const bodyTransform=exportMapBodyTransform(w,h);
  const zoom=Number(ex.mapViewport?.zoom)||1;
  const parts=[];
  parts.push(`<svg class="export-map-svg export-map-svg-v66 export-map-svg-v67 export-map-svg-v68" data-map-w="${w}" data-map-h="${h}" data-base-km-per-px="${kmPerPx}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Карта"><defs><clipPath id="exportMapClip"><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" ry="10"/></clipPath><filter id="labelShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1" stdDeviation="1.25" flood-color="#ffffff" flood-opacity="0.94"/></filter></defs><rect width="${w}" height="${h}" rx="18" fill="#eef3ef"/><rect x="${fieldRect.x}" y="${fieldRect.y}" width="${fieldRect.w}" height="${fieldRect.h}" rx="10" fill="${exportBasemapFill()}" stroke="rgba(111,123,98,.55)" stroke-width="1.2"/><g clip-path="url(#exportMapClip)"><g id="exportMapBody" class="export-map-body" transform="${bodyTransform}">`);
  if(ex.showGraticule) parts.push(exportGraticuleSvg(projection,w,h,gridBBox,fieldRect));
  if(ex.showHydro) parts.push(await exportHydroSvg(projection,gridBBox));
  if(ex.showRailways) parts.push(await exportRailSvg(projection,gridBBox));
  parts.push(v68ContextDimSvg(features, projection, fieldRect));
  if(ex.showAdmin) parts.push(exportAdminPolygonsSvg(features,projection,vals));
  if(ex.showPopulation) parts.push(exportPopulationCirclesSvg(features,projection));
  if(ex.showLabels && ex.labelMode !== 'none') parts.push(exportAdminLabelsSvg(features,projection,w,h));
  parts.push(`</g></g>`);
  if(ex.showGraticule && ex.showGraticuleLabels){
    parts.push(`<g clip-path="url(#exportMapClip)">${exportGraticuleLabelsSvg(projection,w,h,gridBBox,fieldRect)}</g>`);
  }
  if(ex.showScale) parts.push(`<g id="exportScaleBar">${v64ScaleBarSvg(kmPerPx/zoom,w,h,fieldRect)}</g>`);
  parts.push(`<rect x="0.5" y="0.5" width="${w-1}" height="${h-1}" rx="18" fill="none" stroke="rgba(52,67,75,.16)" stroke-width="1"/></svg>`);
  return parts.join('');
};

let v68ExportRenderSeq = 0;
let v68ExportTimer = null;
let v68ExportPendingResolve = [];
function v68ScheduleExportPreviewUpdate(delay=90){
  if(!state.export?.open){ return Promise.resolve(); }
  clearTimeout(v68ExportTimer);
  return new Promise(resolve=>{
    v68ExportPendingResolve.push(resolve);
    v68ExportTimer=setTimeout(async()=>{
      const resolves=v68ExportPendingResolve.splice(0);
      try{ await updateExportLiveMap({immediate:true}); }
      finally{ resolves.forEach(fn=>{ try{ fn(); }catch(_){} }); }
    }, Math.max(0,delay));
  });
}
updateExportLiveMap = async function updateExportLiveMapV68(options={}){
  const el=$('exportSvgMap'); if(!el) return;
  if(!options.immediate){
    return v68ScheduleExportPreviewUpdate(90);
  }
  const status=$('exportPreviewStatus');
  const seq=++v68ExportRenderSeq;
  try{
    ensureExportFlags();
    if(status) status.textContent='Строим SVG-карту…';
    const key=v68ExportMapCacheKey();
    let svg=v68FullSvgCache.get(key);
    if(!svg){
      svg=await buildExportSvgMap();
      if(v68FullSvgCache.size>10){ const first=v68FullSvgCache.keys().next().value; v68FullSvgCache.delete(first); }
      v68FullSvgCache.set(key, svg);
    }
    if(seq !== v68ExportRenderSeq) return;
    el.innerHTML=svg;
    requestAnimationFrame(()=>{ v68InstallScaleBarHitbox(); v68SyncContextDimControls(); if(typeof v67SyncExportZoomControls==='function') v67SyncExportZoomControls(); });
    if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
  }catch(e){
    console.error('SVG export map error v68', e);
    if(seq !== v68ExportRenderSeq) return;
    el.innerHTML=`<div class="export-map-placeholder">Не удалось построить карту: ${escapeHtml(e.message||String(e))}</div>`;
    if(status) status.textContent='Ошибка построения карты.';
  }
};

function v68InstallScaleBarHitbox(){
  const frame=document.querySelector('.export-map-frame-v62, .export-map-frame-v51, .export-map-frame-v50');
  if(!frame) return;
  frame.querySelectorAll('.export-scale-hitbox-v67,.export-scale-hitbox-v68').forEach(el=>el.remove());
  const group=frame.querySelector('#exportScaleBar .export-scale-bar-draggable-v64, #exportScaleBar .export-scale-bar-draggable-v63');
  if(!group) return;
  const svg=frame.querySelector('#exportSvgMap svg.export-map-svg');
  const ex=ensureExportFlags();
  const width=Number(group.dataset.scaleWidth)||180;
  const baseX=Number(group.dataset.baseX)||0;
  const baseY=Number(group.dataset.baseY)||0;
  const fieldSize=exportMapSize();
  const pos=ex.scaleBarPosition && Number.isFinite(Number(ex.scaleBarPosition.x)) && Number.isFinite(Number(ex.scaleBarPosition.y))
    ? {x:Number(ex.scaleBarPosition.x), y:Number(ex.scaleBarPosition.y)}
    : {x:baseX, y:baseY};
  const hit=document.createElement('div');
  hit.className='export-scale-hitbox-v68';
  hit.title='Перетащить масштабную линейку';
  const frameRect=()=>frame.getBoundingClientRect();
  const scale=()=>{
    const r=frameRect();
    const sx=r.width/Math.max(1,fieldSize.w);
    const sy=r.height/Math.max(1,fieldSize.h);
    return {sx,sy};
  };
  const clampPos=p=>{
    if(typeof v63ClampScalePosition === 'function') return v63ClampScalePosition(p, width, fieldSize.w, fieldSize.h);
    return {x:v68Clamp(p.x,18,fieldSize.w-width-18), y:v68Clamp(p.y,42,fieldSize.h-18)};
  };
  const apply=p=>{
    const next=clampPos(p);
    const sc=scale();
    hit.style.left=`${Math.round((next.x-24)*sc.sx)}px`;
    hit.style.top=`${Math.round((next.y-44)*sc.sy)}px`;
    hit.style.width=`${Math.round((width+48)*sc.sx)}px`;
    hit.style.height=`${Math.round(74*sc.sy)}px`;
    group.setAttribute('transform',`translate(${(next.x-baseX).toFixed(1)} ${(next.y-baseY).toFixed(1)})`);
    return next;
  };
  let current=apply(pos);
  hit.addEventListener('mouseenter',()=>group.classList.add('is-hover-priority'));
  hit.addEventListener('mouseleave',()=>group.classList.remove('is-hover-priority'));
  hit.addEventListener('pointerdown',ev=>{
    ev.preventDefault(); ev.stopPropagation(); if(ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    frame.querySelectorAll('.export-field-outline-v51,.export-field-outline-v50,.export-outer-outline-v62').forEach(el=>el.classList.remove('is-editing'));
    hit.classList.add('is-dragging'); group.classList.add('is-dragging','is-hover-priority');
    hit.setPointerCapture?.(ev.pointerId);
    const sc0=scale();
    const start={x:current.x,y:current.y,clientX:ev.clientX,clientY:ev.clientY,sx:sc0.sx,sy:sc0.sy};
    const move=e=>{
      e.preventDefault(); e.stopPropagation();
      const next=clampPos({x:start.x+(e.clientX-start.clientX)/Math.max(0.001,start.sx), y:start.y+(e.clientY-start.clientY)/Math.max(0.001,start.sy)});
      ex.scaleBarPosition={x:Math.round(next.x), y:Math.round(next.y)};
      current=apply(next);
    };
    const up=e=>{
      e.preventDefault(); e.stopPropagation();
      hit.classList.remove('is-dragging'); group.classList.remove('is-dragging');
      hit.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener('pointermove',move,true);
      window.removeEventListener('pointerup',up,true);
      window.removeEventListener('pointercancel',up,true);
      v68FullSvgCache.clear();
    };
    window.addEventListener('pointermove',move,true);
    window.addEventListener('pointerup',up,true);
    window.addEventListener('pointercancel',up,true);
  }, true);
  frame.appendChild(hit);
}
v67InstallScaleBarHitbox = v68InstallScaleBarHitbox;

function v68RoundBreak(raw, mode=state.mode){
  const n=Number(raw);
  if(!Number.isFinite(n)) return null;
  if(mode==='rail_length') return Math.max(0, Math.round(n/10)*10);
  return (typeof v67RoundBreak === 'function') ? v67RoundBreak(raw, mode) : Math.round(n);
}
function v68FmtBreak(v, mode=state.mode){
  if(mode==='rail_length') return `${num(Math.round(Number(v)||0))} км`;
  return (typeof v67FmtBreak === 'function') ? v67FmtBreak(v, mode) : String(v);
}
function v68RailLengthLinearBreaks(values){
  const vals=(values||[]).map(v=>v67MetricDisplayValue(v,'rail_length')).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  if(!vals.length) return null;
  const max=vals[vals.length-1];
  if(max<=0) return null;
  const k=Math.min(7, Math.max(4, Math.ceil(Math.sqrt(vals.length))));
  const raw=[];
  for(let i=1;i<k;i++) raw.push(max*i/k);
  const thresholds=[];
  raw.forEach(v=>{ const r=v68RoundBreak(v,'rail_length'); if(r>0 && r<max && (!thresholds.length || r>thresholds[thresholds.length-1])) thresholds.push(r); });
  if(!thresholds.length) return null;
  const labels=[];
  for(let i=0;i<=thresholds.length;i++){
    if(i===0) labels.push(`до ${v68FmtBreak(thresholds[0],'rail_length')}`);
    else if(i===thresholds.length) labels.push(`более ${v68FmtBreak(thresholds[i-1],'rail_length')}`);
    else labels.push(`${v68FmtBreak(thresholds[i-1],'rail_length')}–${v68FmtBreak(thresholds[i],'rail_length')}`);
  }
  return {thresholds, labels, method:'linear'};
}
function v68RailLengthBreaks(values, method){
  const vals=(values||[]).map(v=>v67MetricDisplayValue(v,'rail_length')).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  if(!vals.length) return null;
  if(method==='continuous' || method==='linear') return v68RailLengthLinearBreaks(values);
  const max=vals[vals.length-1], min=vals[0];
  const k=Math.min(7, Math.max(4, Math.ceil(Math.sqrt(vals.length))));
  let raw=[];
  if(method==='geometric'){
    const ratio=Math.pow(max/Math.max(1,min),1/k);
    for(let i=1;i<k;i++) raw.push(Math.max(1,min)*Math.pow(ratio,i));
  }else{
    for(let i=1;i<k;i++) raw.push(v67Quantile(vals,i/k));
  }
  const thresholds=[];
  raw.forEach(v=>{ const r=v68RoundBreak(v,'rail_length'); if(r>0 && r<max && (!thresholds.length || r>thresholds[thresholds.length-1])) thresholds.push(r); });
  if(!thresholds.length) return v68RailLengthLinearBreaks(values);
  const labels=[];
  for(let i=0;i<=thresholds.length;i++){
    if(i===0) labels.push(`до ${v68FmtBreak(thresholds[0],'rail_length')}`);
    else if(i===thresholds.length) labels.push(`более ${v68FmtBreak(thresholds[i-1],'rail_length')}`);
    else labels.push(`${v68FmtBreak(thresholds[i-1],'rail_length')}–${v68FmtBreak(thresholds[i],'rail_length')}`);
  }
  return {thresholds, labels, method:method==='geometric'?'geometric':'quantile'};
}
const v68PriorClassDescriptor = typeof v67ClassDescriptor === 'function' ? v67ClassDescriptor : null;
v67ClassDescriptor = function v67ClassDescriptorV68(values, mode=state.mode){
  const method = (typeof v67ScaleMode === 'function') ? v67ScaleMode() : 'continuous';
  if(mode==='rail_length') return v68RailLengthBreaks(values, method);
  if(v68PriorClassDescriptor) return v68PriorClassDescriptor(values, mode);
  return null;
};
const v68PriorSyncChoroplethScaleControl = typeof v67SyncChoroplethScaleControl === 'function' ? v67SyncChoroplethScaleControl : null;
v67SyncChoroplethScaleControl = function v67SyncChoroplethScaleControlV68(){
  if(v68PriorSyncChoroplethScaleControl) v68PriorSyncChoroplethScaleControl();
  const select=$('choroplethScaleSelect');
  if(!select) return;
  const fixedOpt=select.querySelector('option[value="fixed"]');
  if(fixedOpt && state.mode==='rail_length') fixedOpt.disabled=true;
  const continuousOpt=select.querySelector('option[value="continuous"]');
  if(continuousOpt) continuousOpt.textContent = state.mode==='rail_length' ? 'Линейная, округление до 10 км' : 'Непрерывная по рангу';
};

function v68TimelineBottomGap(){
  const timeline=$('timelineBar');
  if(!timeline) return 8;
  const rect=timeline.getBoundingClientRect();
  const gap=Math.round(window.innerHeight-rect.bottom);
  return Math.max(6, Number.isFinite(gap)?gap:8);
}
v67TimelineBottomGap = v68TimelineBottomGap;
v66TimelineBottomGap = v68TimelineBottomGap;
function v68ClampWidgetToViewport(panel){
  if(!panel) return;
  const rect=panel.getBoundingClientRect();
  const bottomGap=v68TimelineBottomGap();
  const left=v68Clamp(rect.left,8,Math.max(8,window.innerWidth-rect.width-8));
  const top=v68Clamp(rect.top,8,Math.max(8,window.innerHeight-bottomGap-rect.height));
  panel.style.left=`${left}px`;
  panel.style.top=`${top}px`;
  panel.style.right='auto';
  panel.style.bottom='auto';
  panel.style.transform='none';
}
v67ClampWidgetToViewport = v68ClampWidgetToViewport;
const v68PriorPositionBottomWidgets = typeof positionBottomWidgets === 'function' ? positionBottomWidgets : null;
positionBottomWidgets = function positionBottomWidgetsV68(force=false){
  if(v68PriorPositionBottomWidgets) v68PriorPositionBottomWidgets(force);
  ['metricFilters','parentFilterBar'].forEach(id=>{
    const panel=$(id);
    if(panel && (force || panel.dataset.userDragged==='1')) v68ClampWidgetToViewport(panel);
  });
};

(function initV68Patch(){
  const boot=()=>{
    try{
      ensureExportFlags();
      v68SyncContextDimControls();
      if(typeof v67SyncChoroplethScaleControl==='function') v67SyncChoroplethScaleControl();
      requestAnimationFrame(()=>v68InstallScaleBarHitbox());
    }catch(e){ console.warn('v68 init skipped', e); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
  window.addEventListener('resize',()=>{ setTimeout(()=>{ ['metricFilters','parentFilterBar'].forEach(id=>{ const p=$(id); if(p?.dataset.userDragged==='1') v68ClampWidgetToViewport(p); }); v68InstallScaleBarHitbox(); },60); },{passive:true});
})();

/* v68b: expose compact class under current version too */
const v68PriorUpdateCompactClass = typeof v67UpdateCompactClass === 'function' ? v67UpdateCompactClass : null;
v67UpdateCompactClass = function v67UpdateCompactClassV68(){
  if(v68PriorUpdateCompactClass) v68PriorUpdateCompactClass();
  try{
    const compact = window.innerWidth <= 1920 || window.innerHeight <= 1100 || (window.devicePixelRatio >= 1.25 && window.innerWidth <= 2200);
    document.documentElement.classList.toggle('compact-1080-v68', compact);
    document.body.classList.toggle('compact-1080-v68', compact);
  }catch(_){ }
};
try{ v67UpdateCompactClass(); }catch(_){ }

/* v68c: correct legend note for rail-length linear classes */
updateLegend = function updateLegendV68(gj, vals){
  const box=$('legendBox'); if(!box || !gj) return;
  let html='<b>Легенда</b>';
  if(state.mode==='admin_parent'||state.mode==='admin_intermediate'||state.mode==='admin_superparent'||state.mode==='unit_type'){
    const field=state.mode;
    const cats=[...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,14);
    cats.forEach(c=>{ html += `<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${escapeHtml(c)}</div>`; });
  }else{
    const desc=(typeof v67ClassDescriptor==='function') ? v67ClassDescriptor(vals||[], state.mode) : null;
    html += `<div class="legend-subtitle-v67">${escapeHtml(v67ChoroplethTitle ? v67ChoroplethTitle() : 'Значение показателя')}</div>`;
    if(desc){
      const count=desc.thresholds.length+1;
      desc.labels.forEach((label,i)=>{
        html += `<div class="legend-row legend-row-class-v67"><span class="swatch" style="background:${v67ColorFromClass(i,count)}"></span><span>${escapeHtml(label)}</span></div>`;
      });
      const modeLabel = desc.method==='fixed' ? 'фиксированные классы'
        : desc.method==='linear' ? 'линейная шкала, округление до 10 км'
        : desc.method==='quantile' ? 'квантили, округлены'
        : 'геометрическая шкала, округлена';
      html += `<div class="mini-muted legend-scale-note-v67">${modeLabel}</div>`;
    }else{
      activeValueRamp().forEach((c,i,arr)=>{ html += `<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===arr.length-1?'больше':''}</div>`; });
    }
  }
  if(state.layers.hydro && $('hydroToggle')?.checked){ html += '<hr><div class="legend-row"><span class="line-sample water"></span>реки</div><div class="legend-row"><span class="swatch water-fill"></span>озёра и водохранилища</div>'; }
  if(state.layers.rail && $('railToggle')?.checked){ html += '<div class="legend-row"><span class="line-sample rail"></span>железные дороги</div>'; }
  const visibleFeatures=selectedFeatures();
  if($('centersToggle')?.checked && visibleFeatures.some(f=>(Number(f.properties.population)||0)>0)) html += '<hr><div class="legend-row"><span class="circle-sample"></span>круги населения</div>';
  box.innerHTML=html;
};

/* v69: export rail context margin, 50 km rail-length class rounding, faster export preview updates */
function v69Clamp(n,min,max){
  const v=Number(n);
  return Math.max(min, Math.min(max, Number.isFinite(v)?v:min));
}
function v69ExpandBBoxKm(bbox, km){
  if(!bbox || bbox.length<4) return bbox;
  const [minLon,minLat,maxLon,maxLat]=bbox.map(Number);
  const centerLat=(minLat+maxLat)/2;
  const safeKm=Math.max(0, Number(km)||0);
  const dx=kmToLonDeg(safeKm, centerLat);
  const dy=kmToLatDeg(safeKm);
  return [Math.max(-180,minLon-dx), Math.max(-84,minLat-dy), Math.min(180,maxLon+dx), Math.min(89,maxLat+dy)];
}
function v69RailContextBufferKm(bbox){
  if(!bbox || bbox.length<4) return 120;
  const [minLon,minLat,maxLon,maxLat]=bbox.map(Number);
  const centerLat=(minLat+maxLat)/2;
  const widthKm=Math.abs(maxLon-minLon)*111.32*Math.max(0.15, Math.cos(centerLat*Math.PI/180));
  const heightKm=Math.abs(maxLat-minLat)*111.32;
  // Небольшой служебный запас только для линейного контекста ЖД: он не меняет рамку карты,
  // но не даёт дорогам преждевременно обрываться у края отбираемого охвата.
  return v69Clamp(Math.max(85, Math.max(widthKm,heightKm)*0.035), 85, 260);
}
const v69RailFeatureCache = new Map();
function v69RailFeatureCacheKey(bbox){
  const b=(bbox||[]).map(v=>Math.round((Number(v)||0)*20)/20).join(',');
  return `${APP_VERSION}|${state.year}|${b}`;
}
async function v69ActiveRailFeaturesForBBox(bbox){
  const key=v69RailFeatureCacheKey(bbox);
  if(v69RailFeatureCache.has(key)) return v69RailFeatureCache.get(key);
  const rail=await loadJson(state.manifest.layers.railways.main);
  const features=(rail.features||[]).filter(f=>{
    const p=f.properties||{};
    const open=Number(p.year_open);
    const close=p.year_close==null ? null : Number(p.year_close);
    return open<=state.year && (close==null || close>state.year) && featureIntersectsBBox(f,bbox);
  });
  if(v69RailFeatureCache.size>24){
    const first=v69RailFeatureCache.keys().next().value;
    v69RailFeatureCache.delete(first);
  }
  v69RailFeatureCache.set(key,features);
  return features;
}
exportRailSvg = async function exportRailSvgV69(project,bbox){
  try{
    const vars=styleVars();
    const railBBox=v69ExpandBBoxKm(bbox, v69RailContextBufferKm(bbox));
    const features=await v69ActiveRailFeaturesForBBox(railBBox);
    const paths=features.map(f=>{
      const d=geomToSvgPath(f.geometry,project);
      return d ? `<path d="${d}" fill="none" stroke="${vars.railway}" stroke-width="1.32" stroke-opacity="0.76" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    }).join('');
    return `<g class="export-railways export-railways-v69">${paths}</g>`;
  }catch(e){ console.warn('export rail svg skipped v69', e); return ''; }
};

function v69RoundRailBreak50(raw){
  const n=Number(raw);
  if(!Number.isFinite(n) || n<=0) return 0;
  return Math.max(50, Math.round(n/50)*50);
}
const v69PriorV68RoundBreak = typeof v68RoundBreak === 'function' ? v68RoundBreak : null;
v68RoundBreak = function v68RoundBreakV69(raw, mode=state.mode){
  if(mode==='rail_length') return v69RoundRailBreak50(raw);
  return v69PriorV68RoundBreak ? v69PriorV68RoundBreak(raw,mode) : Math.round(Number(raw)||0);
};
function v69PatchRailLegendText(){
  if(state.mode!=='rail_length') return;
  const box=$('legendBox');
  if(!box) return;
  const note=box.querySelector('.legend-scale-note-v67');
  if(note) note.textContent=note.textContent.replace('10 км','50 км');
}
const v69PriorUpdateLegend = typeof updateLegend === 'function' ? updateLegend : null;
updateLegend = function updateLegendV69(gj, vals){
  if(v69PriorUpdateLegend) v69PriorUpdateLegend(gj, vals);
  v69PatchRailLegendText();
};
const v69PriorSyncChoroplethScaleControl = typeof v67SyncChoroplethScaleControl === 'function' ? v67SyncChoroplethScaleControl : null;
v67SyncChoroplethScaleControl = function v67SyncChoroplethScaleControlV69(){
  if(v69PriorSyncChoroplethScaleControl) v69PriorSyncChoroplethScaleControl();
  const select=$('choroplethScaleSelect');
  const continuousOpt=select?.querySelector('option[value="continuous"]');
  if(continuousOpt && state.mode==='rail_length') continuousOpt.textContent='Линейная, округление до 50 км';
  v69PatchRailLegendText();
};

function v69ExportMapCacheKey(){
  const ex=ensureExportFlags();
  const {w,h}=exportMapSize();
  const features=(typeof v66ExportSourceFeatures==='function') ? v66ExportSourceFeatures(exportScopeFeatures()) : exportScopeFeatures();
  let bbox='';
  try{ bbox=geoBBoxFromFeatures(features).map(v=>Number(v).toFixed(5)).join(','); }catch(_){ bbox=''; }
  const f=exportMapFieldRect(w,h);
  const buf=['top','right','bottom','left'].map(k=>Math.round(Number(ex.extentBuffer?.[k])||0)).join(',');
  const flags=['showHydro','showAdmin','showRailways','showPopulation','showLabels','showGraticule','showGraticuleLabels','showScale'].map(k=>ex[k]?'1':'0').join('');
  const dimEnabled = (Number(ex.contextDimOpacity)||0) > 0.001 ? 'D1' : 'D0';
  // Положение линейки и точная прозрачность приглушения применяются поверх SVG без полной пересборки.
  // Но сам факт наличия/отсутствия маски оставляем в ключе, чтобы она создавалась при первом включении.
  return [APP_VERSION,state.year,state.mode,state.basemapStyle,state.regionStyle,ex.scope,flags,dimEnabled,ex.labelMode,Math.round(Number(ex.graticuleLabelSize)||12),Number(ex.exportZoomDelta||0).toFixed(2),w,h,f.x,f.y,f.w,f.h,buf,bbox,v68ExportFeatureSignature(features)].join('§');
}
v68ExportMapCacheKey = v69ExportMapCacheKey;

function v69ApplyDynamicExportMapState(el, key){
  if(!el) return;
  const ex=ensureExportFlags();
  const svg=el.querySelector('svg.export-map-svg');
  if(svg){
    svg.dataset.v69CacheKey=key || '';
    svg.querySelectorAll('.export-context-dim-v68 path').forEach(path=>{
      path.setAttribute('fill-opacity', v68Clamp(ex.contextDimOpacity,0,0.85).toFixed(2));
    });
    const g=svg.querySelector('#exportScaleBar .export-scale-bar-draggable-v64, #exportScaleBar .export-scale-bar-draggable-v63');
    if(g && ex.scaleBarPosition && Number.isFinite(Number(ex.scaleBarPosition.x)) && Number.isFinite(Number(ex.scaleBarPosition.y))){
      const {w,h}=exportMapSize();
      const width=Number(g.dataset.scaleWidth)||180;
      const baseX=Number(g.dataset.baseX)||Number(ex.scaleBarPosition.x)||0;
      const baseY=Number(g.dataset.baseY)||Number(ex.scaleBarPosition.y)||0;
      const pos=typeof v63ClampScalePosition==='function' ? v63ClampScalePosition(ex.scaleBarPosition,width,w,h) : {x:Number(ex.scaleBarPosition.x)||baseX,y:Number(ex.scaleBarPosition.y)||baseY};
      g.setAttribute('transform',`translate(${(pos.x-baseX).toFixed(1)} ${(pos.y-baseY).toFixed(1)})`);
    }
  }
  v68SyncContextDimControls?.();
  requestAnimationFrame(()=>{
    try{ v68InstallScaleBarHitbox(); }catch(_){ }
    try{ if(typeof v67SyncExportZoomControls==='function') v67SyncExportZoomControls(); }catch(_){ }
  });
}

updateExportLiveMap = async function updateExportLiveMapV69(options={}){
  const el=$('exportSvgMap'); if(!el) return;
  if(!options.immediate){
    return v68ScheduleExportPreviewUpdate(70);
  }
  const status=$('exportPreviewStatus');
  const seq=++v68ExportRenderSeq;
  try{
    ensureExportFlags();
    const key=v68ExportMapCacheKey();
    if(el.dataset.v69CacheKey===key && el.querySelector('svg.export-map-svg')){
      v69ApplyDynamicExportMapState(el,key);
      if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
      return;
    }
    if(status) status.textContent='Строим SVG-карту…';
    let svg=v68FullSvgCache.get(key);
    if(!svg){
      svg=await buildExportSvgMap();
      if(v68FullSvgCache.size>8){
        const first=v68FullSvgCache.keys().next().value;
        v68FullSvgCache.delete(first);
      }
      v68FullSvgCache.set(key,svg);
    }
    if(seq!==v68ExportRenderSeq) return;
    el.innerHTML=svg;
    el.dataset.v69CacheKey=key;
    v69ApplyDynamicExportMapState(el,key);
    if(status) status.textContent='Превью обновлено. Можно сохранить PNG.';
  }catch(e){
    console.error('SVG export map error v69', e);
    if(seq!==v68ExportRenderSeq) return;
    el.innerHTML=`<div class="export-map-placeholder">Не удалось построить карту: ${escapeHtml(e.message||String(e))}</div>`;
    if(status) status.textContent='Ошибка построения карты.';
  }
};

function v69ExportPreviewShellSignature(features,w,h){
  const ex=ensureExportFlags();
  const featureSig=(typeof v68ExportFeatureSignature==='function') ? v68ExportFeatureSignature(features||[]) : String((features||[]).length);
  return [APP_VERSION,w,h,state.year,state.mode,ex.scope,featureSig,ex.showLegend?'L1':'L0',ex.showStats?'S1':'S0',ex.showContext?'C1':'C0',ex.title||'',ex.subtitle||'',ex.showContext?(ex.contextText||''):'',ex.template||'',ex.paper||''].join('§');
}
function v69RefreshExistingExportShell(w,h,field){
  const wrap=$('exportPreviewCard');
  const frame=wrap?.querySelector('.export-map-frame-v62,.export-map-frame-v51,.export-map-frame-v50');
  if(!wrap || !frame) return false;
  const article=wrap.querySelector('.export-layout-v62,.export-layout-v51,.export-layout-v50,.export-layout');
  if(article) article.style.width=`${w}px`;
  frame.style.width=`${w}px`;
  frame.style.height=`${h}px`;
  const inner=frame.querySelector('.export-field-outline-v51,.export-field-outline-v50');
  if(inner){
    inner.style.left=`${field.x}px`;
    inner.style.top=`${field.y}px`;
    inner.style.width=`${field.w}px`;
    inner.style.height=`${field.h}px`;
    const ex=ensureExportFlags();
    const active=ex.activeFrame==='inner';
    inner.classList.toggle('is-selected',active);
    inner.classList.toggle('is-editing',active);
  }
  const outer=frame.querySelector('.export-outer-outline-v62,.export-outer-outline-v51,.export-outer-outline-v50');
  if(outer){
    const ex=ensureExportFlags();
    const active=ex.activeFrame==='outer';
    outer.classList.toggle('is-selected',active);
    outer.classList.toggle('is-editing',active);
    outer.classList.toggle('export-resize-muted',!active);
  }
  return true;
}
const v69PriorRenderExportPreviewCard = typeof renderExportPreviewCard === 'function' ? renderExportPreviewCard : null;
renderExportPreviewCard = function renderExportPreviewCardV69(){
  const wrap=$('exportPreviewCard');
  if(!wrap || !v69PriorRenderExportPreviewCard){ return; }
  const features=exportScopeFeatures();
  const {w,h}=exportMapSize();
  const field=exportMapFieldRect(w,h);
  const sig=v69ExportPreviewShellSignature(features,w,h);
  const hasShell=!!wrap.querySelector('.export-map-frame-v62,.export-map-frame-v51,.export-map-frame-v50');
  if(hasShell && wrap.dataset.v69ShellSignature===sig && v69RefreshExistingExportShell(w,h,field)){
    updateExportLiveMap();
    initExportOverlayDrag?.();
    syncExportDefaults(false);
    return;
  }
  v69PriorRenderExportPreviewCard();
  wrap.dataset.v69ShellSignature=sig;
  v69RefreshExistingExportShell(w,h,field);
};

(function initV69Patch(){
  const boot=()=>{
    try{
      ensureExportFlags();
      if(typeof v67SyncChoroplethScaleControl==='function') v67SyncChoroplethScaleControl();
      v69PatchRailLegendText();
    }catch(e){ console.warn('v69 init skipped', e); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();

/* v69b: tiny SVG clip bleed for linework so railway strokes are not shaved at the map-frame edge */
const v69PriorBuildExportSvgMap = typeof buildExportSvgMap === 'function' ? buildExportSvgMap : null;
buildExportSvgMap = async function buildExportSvgMapV69(){
  let svg = v69PriorBuildExportSvgMap ? await v69PriorBuildExportSvgMap() : '';
  try{
    const {w,h}=exportMapSize();
    const field=exportMapFieldRect(w,h);
    const bleed=6;
    const softClip=`<clipPath id="exportMapClipSoft"><rect x="${(field.x-bleed).toFixed(1)}" y="${(field.y-bleed).toFixed(1)}" width="${(field.w+bleed*2).toFixed(1)}" height="${(field.h+bleed*2).toFixed(1)}" rx="12" ry="12"/></clipPath>`;
    svg=svg.replace('</clipPath><filter id="labelShadow"', `</clipPath>${softClip}<filter id="labelShadow"`);
    svg=svg.replace('<g clip-path="url(#exportMapClip)"><g id="exportMapBody"', '<g clip-path="url(#exportMapClipSoft)"><g id="exportMapBody"');
    const fieldBorder=`<rect x="${field.x+0.5}" y="${field.y+0.5}" width="${Math.max(0,field.w-1)}" height="${Math.max(0,field.h-1)}" rx="10" fill="none" stroke="rgba(111,123,98,.68)" stroke-width="1.25" pointer-events="none"/>`;
    svg=svg.replace('<rect x="0.5" y="0.5"', `${fieldBorder}<rect x="0.5" y="0.5"`);
  }catch(e){ console.warn('v69 SVG clip-bleed postprocess skipped', e); }
  return svg;
};


/* v70: strict clipping of export map layers to the inner cartographic frame.
   Railways still use a widened feature-selection bbox from v69, but the SVG output
   is clipped exactly by exportMapClip so no hydro/admin/rail/population layer can
   draw outside the inner frame. */
const v70PriorBuildExportSvgMap = typeof buildExportSvgMap === 'function' ? buildExportSvgMap : null;
buildExportSvgMap = async function buildExportSvgMapV70(){
  let svg = v70PriorBuildExportSvgMap ? await v70PriorBuildExportSvgMap() : '';
  try{
    // v69b enlarged the SVG clip by several pixels to avoid shaving line strokes.
    // Visually it allowed map content to leak beyond the inner frame. Keep the
    // v69 rail feature context, but restore the actual render clip to the frame.
    svg = svg.replace(/<clipPath id="exportMapClipSoft">[\s\S]*?<\/clipPath>/g, '');
    svg = svg.replace(/clip-path="url\(#exportMapClipSoft\)"/g, 'clip-path="url(#exportMapClip)"');
  }catch(e){ console.warn('v70 strict export clip postprocess skipped', e); }
  return svg;
};

/* v72: historical XIX-century admin layers + century filter and slideshow for the timeline */
/* v73: added 1947 and 1964 standardized admin layers with population diagnostics and rail metrics */
/* v76: cleaned late-layer duplicate fragments and same-name administrative component duplicates in 1970-2021 */
function v72SortedYears(){
  return (state.manifest?.years || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
}
function v72CenturyOfYear(y){
  y=Number(y);
  if(y>=1701 && y<=1800) return '18';
  if(y>=1801 && y<=1900) return '19';
  if(y>=1901 && y<=2000) return '20';
  if(y>=2001 && y<=2100) return '21';
  return 'other';
}
function v72TimelineScopeYears(){
  const years=v72SortedYears();
  const scope=state.timelineCentury || 'all';
  if(scope==='all') return years;
  if(scope==='18' || scope==='19' || scope==='20' || scope==='21') return years.filter(y=>v72CenturyOfYear(y)===scope);
  if(scope==='imperial') return years.filter(y=>y<=1914);
  if(scope==='soviet') return years.filter(y=>y>=1918 && y<=1989);
  return years;
}
function v72TimelineScopeLabel(){
  const scope=state.timelineCentury || 'all';
  const labels={all:'Все годы', '18':'XVIII век', '19':'XIX век', '20':'XX век', '21':'XXI век', imperial:'Имперский период', soviet:'Советский период'};
  return labels[scope] || labels.all;
}
async function v72SetYear(year, opts={}){
  const y=Number(year);
  if(!Number.isFinite(y) || !state.manifest?.years?.map(Number).includes(y)) return;
  if(!opts.keepSlideshow && !opts.fromSlideshow) v72StopTimelineSlideshow();
  if(state.year===y){ setYearLabels(); updateTimelineActive(); return; }
  state.year=y;
  state.colors={};
  setYearLabels();
  updateTimelineActive();
  state.selectedIds.clear();
  if(state.export && state.export.open){
    state.export.mapImage='';
    if(state.export.contextMode==='auto' || !state.export.contextText){
      try{ syncExportContextText?.(); }catch(_){ }
    }
  }
  await refreshAll();
}
function v72EnsureTimelineControls(){
  const bar=$('timelineBar');
  if(!bar) return;
  bar.classList.add('timeline-v72');
  const head=bar.querySelector('.timeline-head');
  if(!head) return;
  let left=head.querySelector('.timeline-main-label');
  if(!left){
    left=document.createElement('span');
    left.className='timeline-main-label';
    left.textContent='Год';
    const old=head.querySelector('span');
    if(old) old.replaceWith(left); else head.prepend(left);
  }
  let tools=head.querySelector('.timeline-tools-v72');
  if(!tools){
    tools=document.createElement('div');
    tools.className='timeline-tools-v72';
    tools.innerHTML=`<label class="timeline-century-label" for="timelineCenturySelect">Период</label><select id="timelineCenturySelect" class="timeline-century-select" aria-label="Период таймлайна"><option value="all">Все годы</option><option value="18">XVIII век</option><option value="19">XIX век</option><option value="20">XX век</option><option value="21">XXI век</option><option value="imperial">Имперский период</option><option value="soviet">Советский период</option></select><button id="timelinePlayButton" class="timeline-play-button" type="button" aria-pressed="false" title="Запустить слайд-шоу изменения сетки АТД">▶ Слайд-шоу</button>`;
    head.appendChild(tools);
    const sel=tools.querySelector('#timelineCenturySelect');
    const play=tools.querySelector('#timelinePlayButton');
    sel.addEventListener('change', async e=>{
      state.timelineCentury=e.target.value || 'all';
      v72StopTimelineSlideshow();
      const years=v72TimelineScopeYears();
      buildTimeline();
      if(years.length && !years.includes(Number(state.year))){
        const nearest=years.reduce((best,y)=>Math.abs(y-state.year)<Math.abs(best-state.year)?y:best, years[0]);
        await v72SetYear(nearest, {keepSlideshow:true});
      }else{
        updateTimelineActive();
      }
    });
    play.addEventListener('click', ()=>{
      if(state.timelinePlaying) v72StopTimelineSlideshow();
      else v72StartTimelineSlideshow();
    });
  }
  const sel=$('timelineCenturySelect');
  if(sel && sel.value !== (state.timelineCentury || 'all')) sel.value=state.timelineCentury || 'all';
  v72UpdateTimelinePlayButton();
}
function v72UpdateTimelinePlayButton(){
  const btn=$('timelinePlayButton');
  if(!btn) return;
  const on=!!state.timelinePlaying;
  btn.classList.toggle('is-playing', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.textContent=on ? 'Ⅱ Пауза' : '▶ Слайд-шоу';
  btn.title=on ? 'Остановить слайд-шоу' : 'Запустить слайд-шоу изменения сетки АТД';
}
function v72StopTimelineSlideshow(){
  state.timelinePlaying=false;
  if(state.timelineTimer){ clearTimeout(state.timelineTimer); state.timelineTimer=null; }
  v72UpdateTimelinePlayButton();
}
function v72StartTimelineSlideshow(){
  const years=v72TimelineScopeYears();
  if(years.length<2) return;
  state.timelinePlaying=true;
  v72UpdateTimelinePlayButton();
  const step=async ()=>{
    if(!state.timelinePlaying) return;
    const list=v72TimelineScopeYears();
    if(list.length<2){ v72StopTimelineSlideshow(); return; }
    const cur=Number(state.year);
    let idx=list.indexOf(cur);
    if(idx<0) idx=-1;
    const next=list[(idx+1)%list.length];
    try{ await v72SetYear(next, {fromSlideshow:true, keepSlideshow:true}); }
    catch(e){ console.warn('timeline slideshow step skipped', e); }
    if(state.timelinePlaying) state.timelineTimer=setTimeout(step, 1350);
  };
  state.timelineTimer=setTimeout(step, 250);
}
function buildTimeline(){
  const track=$('yearTimeline');
  if(!track) return;
  v72EnsureTimelineControls();
  const years=v72TimelineScopeYears();
  track.innerHTML='';
  track.dataset.scope=state.timelineCentury || 'all';
  years.forEach(y=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='timeline-year';
    btn.dataset.year=String(y);
    btn.title=`Показать слой АТД за ${y} год`;
    btn.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${y}</span>`;
    btn.addEventListener('click', ()=>v72SetYear(y));
    track.appendChild(btn);
  });
  if(!years.length){
    const empty=document.createElement('span');
    empty.className='timeline-empty-v72';
    empty.textContent='Нет слоёв для выбранного периода';
    track.appendChild(empty);
  }
  updateTimelineActive();
}
function updateTimelineActive(){
  document.querySelectorAll('.timeline-year').forEach(b=>b.classList.toggle('active', Number(b.dataset.year)===Number(state.year)));
  const active=document.querySelector('.timeline-year.active');
  if(active && active.scrollIntoView) active.scrollIntoView({block:'nearest', inline:'center', behavior:'smooth'});
}
const v72PriorSetYearLabels = typeof setYearLabels === 'function' ? setYearLabels : null;
setYearLabels = function setYearLabelsV72(){
  if(v72PriorSetYearLabels) v72PriorSetYearLabels();
  const bar=$('timelineBar');
  if(bar) bar.dataset.scopeLabel=v72TimelineScopeLabel();
};
const v72PriorExportContextPresets = typeof exportContextPresets === 'function' ? exportContextPresets : null;
exportContextPresets = function exportContextPresetsV72(year){
  const y=Number(year);
  const extra={
    1848:{short:'Середина XIX века: дореформенная окружная сетка Западной Сибири с губернским верхним уровнем.', long:'Срез 1848 года показывает дореформенную окружную сетку Западной Сибири до крупных преобразований второй половины XIX века. Для этого слоя подключены геометрии округов и верхнеуровневых губернских принадлежностей; население в исходном слое не задано.'},
    1855:{short:'Середина XIX века: расширенная сетка округов с включением степных областных структур.', long:'Срез 1855 года фиксирует более детальную конфигурацию округов и областных структур южной части Западной Сибири и сопредельной степной зоны. Население в исходном слое не задано, поэтому аналитика слоя опирается прежде всего на геометрию, площадь и административную принадлежность.'},
    1876:{short:'Позднеимперская перестройка до переписи 1897 года: округа и области второй половины XIX века.', long:'Срез 1876 года показывает административную сеть второй половины XIX века перед переходом к статистически более насыщенному слою 1897 года. Геометрии адаптированы к общей структуре атласа; демографические поля в исходном слое отсутствуют.'},
    1947:{short:'Послевоенный административный срез: районная сетка Западной Сибири с модельной оценкой населения.', long:'Срез 1947 года добавлен как послевоенное состояние районной сети. Население по АТЕ сверено с диагностической сводкой и распределено по городской/сельской компонентам; плотность населения, протяжённость железных дорог и густота ЖД рассчитаны в общей структуре проекта.'},
    1964:{short:'Середина 1960-х: укрупнённая районная сетка с модельной оценкой населения между переписями 1959 и 1970 гг.', long:'Срез 1964 года отражает административную сеть середины 1960-х. Население приведено по диагностической модели, согласованной с макроитогами; рассчитаны плотность населения, протяжённость действующих железных дорог и густота ЖД.'}
  };
  if(extra[y]) return extra[y];
  return v72PriorExportContextPresets ? v72PriorExportContextPresets(year) : {short:'Исторический срез административно-территориального деления Западной Сибири.', long:'Исторический срез административно-территориального деления Западной Сибири.'};
};
(function initV72Patch(){
  const boot=()=>{
    try{
      state.timelineCentury = state.timelineCentury || 'all';
      v72EnsureTimelineControls();
      buildTimeline();
      setYearLabels();
    }catch(e){ console.warn('v72 timeline init skipped', e); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,80),{once:true}); else setTimeout(boot,80);
})();

/* v77: fixed-width timeline carousel and no page scroll on late-year activation */
function v77EnsureTimelineCarousel(){
  const bar = $('timelineBar');
  const track = $('yearTimeline');
  if(!bar || !track) return;
  bar.classList.add('timeline-v77');
  if(track.parentElement && track.parentElement.classList.contains('timeline-carousel-v77')){
    v77UpdateTimelineCarouselButtons();
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'timeline-carousel-v77';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'timeline-carousel-btn-v77 timeline-carousel-prev-v77';
  prev.setAttribute('aria-label','Предыдущий год');
  prev.title = 'Предыдущий слой';
  prev.innerHTML = '‹';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'timeline-carousel-btn-v77 timeline-carousel-next-v77';
  next.setAttribute('aria-label','Следующий год');
  next.title = 'Следующий слой';
  next.innerHTML = '›';
  const parent = track.parentNode;
  parent.insertBefore(wrapper, track);
  wrapper.appendChild(prev);
  wrapper.appendChild(track);
  wrapper.appendChild(next);
  prev.addEventListener('click', ()=>v77StepTimelineYear(-1));
  next.addEventListener('click', ()=>v77StepTimelineYear(1));
  track.addEventListener('scroll', v77UpdateTimelineCarouselButtons, {passive:true});
  v77UpdateTimelineCarouselButtons();
}
function v77StepTimelineYear(direction){
  const years = v72TimelineScopeYears ? v72TimelineScopeYears() : (state.manifest?.years || []).map(Number).filter(Number.isFinite);
  if(!years.length) return;
  const cur = Number(state.year);
  let idx = years.indexOf(cur);
  if(idx < 0){
    idx = years.reduce((bestIdx,y,i)=>Math.abs(y-cur)<Math.abs(years[bestIdx]-cur)?i:bestIdx, 0);
  }
  const nextIdx = Math.max(0, Math.min(years.length-1, idx + (Number(direction) < 0 ? -1 : 1)));
  if(nextIdx !== idx || years[nextIdx] !== cur) v72SetYear(years[nextIdx]);
}
function v77ScrollTimelineToActive(opts={}){
  const track = $('yearTimeline');
  const active = track ? track.querySelector('.timeline-year.active') : null;
  if(!track || !active) return;
  const target = Math.max(0, active.offsetLeft - (track.clientWidth - active.offsetWidth)/2);
  const behavior = opts.instant ? 'auto' : 'smooth';
  try{ track.scrollTo({left:target, behavior}); }
  catch(_){ track.scrollLeft = target; }
  window.requestAnimationFrame(v77UpdateTimelineCarouselButtons);
}
function v77UpdateTimelineCarouselButtons(){
  const track = $('yearTimeline');
  const wrap = track?.parentElement?.classList?.contains('timeline-carousel-v77') ? track.parentElement : null;
  if(!track || !wrap) return;
  const max = Math.max(0, track.scrollWidth - track.clientWidth - 1);
  const left = track.scrollLeft || 0;
  const prev = wrap.querySelector('.timeline-carousel-prev-v77');
  const next = wrap.querySelector('.timeline-carousel-next-v77');
  if(prev) prev.disabled = left <= 1;
  if(next) next.disabled = left >= max;
  wrap.classList.toggle('has-left-overflow', left > 1);
  wrap.classList.toggle('has-right-overflow', left < max);
}
const v77PriorEnsureTimelineControls = typeof v72EnsureTimelineControls === 'function' ? v72EnsureTimelineControls : null;
v72EnsureTimelineControls = function v72EnsureTimelineControlsV77(){
  if(v77PriorEnsureTimelineControls) v77PriorEnsureTimelineControls();
  v77EnsureTimelineCarousel();
};
const v77PriorBuildTimeline = typeof buildTimeline === 'function' ? buildTimeline : null;
buildTimeline = function buildTimelineV77(){
  if(v77PriorBuildTimeline) v77PriorBuildTimeline();
  v77EnsureTimelineCarousel();
  v77ScrollTimelineToActive({instant:true});
};
updateTimelineActive = function updateTimelineActiveV77(){
  document.querySelectorAll('.timeline-year').forEach(b=>b.classList.toggle('active', Number(b.dataset.year)===Number(state.year)));
  v77EnsureTimelineCarousel();
  v77ScrollTimelineToActive();
};
(function initV77TimelinePatch(){
  const boot=()=>{
    try{
      v77EnsureTimelineCarousel();
      v77ScrollTimelineToActive({instant:true});
    }catch(e){ console.warn('v77 timeline carousel init skipped', e); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,120),{once:true}); else setTimeout(boot,120);
})();


/* v84: special overlays panel + latest early admin layers */
function v84EnsureSpecialState(){
  if(!state.specialOverlays) state.specialOverlays={active:{}, layers:{}, configs:{}, kolyvanYear:'all'};
  return state.specialOverlays;
}
function v84SpecialConfigEntries(){
  const so=v84EnsureSpecialState();
  const raw=state.manifest?.layers?.special_overlays || {};
  return Object.entries(raw).map(([key,cfg])=>{
    const c=typeof cfg==='string' ? {path:cfg,title:key,type:'polygon',years:[]} : {...cfg};
    c.key=key; c.path=c.path || c.url || c.href; c.title=c.title || key; c.type=c.type || 'polygon';
    so.configs[key]=c;
    return [key,c];
  });
}
function v84RenderSpecialLayerControls(){
  const box=$('specialLayerList');
  if(!box || !state.manifest) return;
  const entries=v84SpecialConfigEntries();
  if(!entries.length){ box.innerHTML='<div class="mini-muted">Специальных слоёв нет.</div>'; return; }
  box.innerHTML=entries.map(([key,c])=>{
    const years=Array.isArray(c.years)&&c.years.length ? ` <small>${c.years.join(' / ')}</small>` : '';
    const temporal=c.type==='temporal_polygon';
    return `<div class="special-layer-item" data-special-key="${escapeHtml(key)}">
      <label><input type="checkbox" data-special-toggle="${escapeHtml(key)}"> <span>${escapeHtml(c.title)}${years}</span></label>
      ${temporal?`<select class="special-layer-year-select" data-special-year="${escapeHtml(key)}"><option value="all">все срезы</option>${(c.years||[]).map(y=>`<option value="${y}">${y}</option>`).join('')}</select>`:''}
      <div class="mini-muted">${escapeHtml(c.note || 'Специальный оверлей, не входит в основную аналитику.')}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-special-toggle]').forEach(ch=>ch.addEventListener('change', e=>{
    const so=v84EnsureSpecialState();
    const key=e.target.dataset.specialToggle;
    so.active[key]=!!e.target.checked;
    v84RefreshSpecialOverlay(key);
  }));
  box.querySelectorAll('[data-special-year]').forEach(sel=>sel.addEventListener('change', e=>{
    const key=e.target.dataset.specialYear;
    if(key==='kolyvan_mining_department') v84EnsureSpecialState().kolyvanYear=e.target.value || 'all';
    v84RefreshSpecialOverlay(key);
  }));
}
function v84SpecialColor(key, year){
  if(key==='early_1680_boundaries') return '#7c5cc4';
  if(key==='ostrogs_17c') return '#8f4f00';
  if(key==='kolyvan_mining_department'){
    const pal={1735:'#8b5cf6',1745:'#d97706',1750:'#047857'};
    return pal[Number(year)] || '#6b7280';
  }
  return '#7a5c2e';
}
function v84SpecialDash(key, year){
  if(key==='kolyvan_mining_department'){
    const y=Number(year);
    if(y===1735) return '8 5';
    if(y===1745) return '3 5';
    if(y===1750) return null;
  }
  if(key==='early_1680_boundaries') return '6 4';
  return null;
}
async function v84LoadSpecialGeoJSON(key){
  const cfg=v84EnsureSpecialState().configs[key] || v84SpecialConfigEntries().find(([k])=>k===key)?.[1];
  if(!cfg?.path) return null;
  const gj=await loadJson(cfg.path);
  if(key==='kolyvan_mining_department'){
    const yy=v84EnsureSpecialState().kolyvanYear || 'all';
    if(yy!=='all') return {type:'FeatureCollection', features:(gj.features||[]).filter(f=>String(f.properties?.overlay_year||f.properties?.Year||'')===String(yy))};
  }
  return gj;
}
function v84SpecialPointToLayer(key, f, latlng){
  const color=v84SpecialColor(key, f.properties?.overlay_year);
  return L.circleMarker(latlng,{radius:5.5,color:'#4a2a00',weight:1.4,fillColor:color,fillOpacity:.92,opacity:.98});
}
function v84SpecialFeatureStyle(key, f){
  const year=f.properties?.overlay_year || f.properties?.Year;
  const color=v84SpecialColor(key, year);
  return {color, weight:key==='kolyvan_mining_department'?2.2:1.8, opacity:.95, fillColor:color, fillOpacity:key==='early_1680_boundaries'?.10:.14, dashArray:v84SpecialDash(key, year), lineJoin:'round', lineCap:'round'};
}
function v84BindSpecialPopup(key, f, layer){
  const p=f.properties||{};
  const title=p.name || p.Name || p.special_overlay_title || 'Специальный объект';
  const rows=[p.special_overlay_title, p.overlay_year?`срез: ${p.overlay_year}`:'', p.unit_type, p.special_status, p.atd_hierarchy].filter(Boolean).map(x=>escapeHtml(x));
  layer.bindPopup(`<b>${escapeHtml(title)}</b>${rows.map(r=>`<br>${r}`).join('')}<br><span style="color:#667">Не участвует в аналитике основных АТЕ</span>`);
}
async function v84RefreshSpecialOverlay(key){
  const so=v84EnsureSpecialState();
  if(so.layers[key]){ try{ state.map.removeLayer(so.layers[key]); }catch(_){ } so.layers[key]=null; }
  if(!so.active[key] || !state.map) return;
  const gj=await v84LoadSpecialGeoJSON(key);
  if(!gj) return;
  const layer=L.geoJSON(gj,{
    style:f=>v84SpecialFeatureStyle(key,f),
    pointToLayer:(f,latlng)=>v84SpecialPointToLayer(key,f,latlng),
    onEachFeature:(f,l)=>v84BindSpecialPopup(key,f,l)
  }).addTo(state.map);
  so.layers[key]=layer;
  layer.bringToFront && layer.bringToFront();
}
function v84RefreshAllSpecialOverlays(){
  const so=v84EnsureSpecialState();
  Object.keys(so.active||{}).forEach(key=>v84RefreshSpecialOverlay(key));
}
(function initV84SpecialOverlayPatch(){
  const priorInit = init;
  init = async function initV84(){
    await priorInit();
    v84RenderSpecialLayerControls();
  };
  const priorRefreshVisibility = refreshVisibility;
  refreshVisibility = function refreshVisibilityV84(){
    priorRefreshVisibility();
    v84RefreshAllSpecialOverlays();
  };
})();


/* v85: special reconstruction statuses — keep on map, exclude from analytics */
const v85PriorUpdateLegend = typeof updateLegend === 'function' ? updateLegend : null;
updateLegend = function updateLegendV85(gj, vals){
  if(v85PriorUpdateLegend) v85PriorUpdateLegend(gj, vals);
  const box=$('legendBox'); if(!box || !gj) return;
  const specials=[...new Set((gj.features||[]).map(f=>String(f.properties?.special_status_code||'')).filter(c=>c && c!=='normal'))];
  if(!specials.length) return;
  const section=document.createElement('div');
  section.className='legend-special-v85';
  section.innerHTML='<div class="legend-section">Особые зоны реконструкции</div>'+
    specials.slice(0,10).map(code=>{
      const st=specialStatusStyleMap[code] || {};
      return `<div class="legend-row special-status-row-v85"><span class="swatch special-hatch-v85" style="border-color:${st.color||'#8b8580'};background-color:rgba(160,150,135,.10)"></span>${escapeHtml(specialStatusLabel(code))}</div>`;
    }).join('')+
    '<div class="legend-scale-note-v67">Особые зоны показываются на карте, но не входят в статистику и выборку.</div>';
  box.appendChild(section);
};



/* v88: topology graph of ATE contiguity and centrality metrics */
const v88TopologyModes = new Set(['topo_degree','topo_degree_centrality','topo_betweenness','topo_closeness','topo_k_core','topo_external_degree']);
const v88TopologyMetricLabels = {
  topo_degree:'число соседей',
  topo_degree_centrality:'degree centrality',
  topo_betweenness:'betweenness centrality',
  topo_closeness:'closeness centrality',
  topo_k_core:'k-core',
  topo_external_degree:'межгубернские связи'
};
function v88IsTopologyMode(){ return v88TopologyModes.has(state.mode); }
function v88TopologyMetricField(){
  if(v88IsTopologyMode()) return state.mode;
  const sel=$('topologyMetricSelect');
  return (sel && v88TopologyModes.has(sel.value)) ? sel.value : 'topo_degree';
}
const v88PriorValField = valField;
valField = function valFieldV87(){
  if(v88IsTopologyMode()) return v88TopologyMetricField();
  return v88PriorValField();
};
const v88PriorAdminStyle = adminStyle;
adminStyle = function adminStyleV87(feature, vals){
  const base=v88PriorAdminStyle(feature, vals);
  if(v88IsTopologyMode()){
    const p=feature.properties||{}; const field=v88TopologyMetricField();
    base.fillColor = p.topology_excluded ? '#d7d1c8' : valueColor(Number(p[field]), vals||[]);
    base.fillOpacity = p.topology_excluded ? 0.16 : Math.max(base.fillOpacity||0.45, 0.56);
    if(p.topology_excluded){ base.dashArray='3 5'; base.color='#9b958c'; }
  }
  return base;
};
function v88TopoScaleValue(v, vals){
  const values=(vals||[]).filter(x=>Number.isFinite(Number(x))).map(Number).sort((a,b)=>a-b);
  const n=Number(v); if(!Number.isFinite(n) || !values.length) return 0;
  const min=values[0], max=values[values.length-1]; if(max===min) return .7;
  return Math.max(0, Math.min(1, (n-min)/(max-min)));
}
function v88TopologyRadius(v, vals){ return 4 + v88TopoScaleValue(v, vals)*13; }
function v88TopologyVisible(){ return $('toggleTopologyGraph')?.checked || v88IsTopologyMode(); }
async function v88RenderTopologyGraph(){
  clearLayer('topologyGraph');
  if(!state.map || !state.currentGeoJSON || !v88TopologyVisible()) return;
  const topoPath=state.manifest?.layers?.topology?.[String(state.year)];
  if(!topoPath) return;
  const field=v88TopologyMetricField();
  const features=(state.currentGeoJSON.features||[]);
  const visibleById=new Map(features.map(f=>[featureId(f),f]));
  const vals=features.filter(f=>!f.properties?.topology_excluded).map(f=>Number(f.properties?.[field])).filter(v=>Number.isFinite(v));
  const group=L.layerGroup();
  try{
    const edges=await loadJson(topoPath);
    const edgeFeatures=(edges.features||[]).filter(e=>visibleById.has(String(e.properties?.source_id)) && visibleById.has(String(e.properties?.target_id)));
    const edgeLayer=L.geoJSON({type:'FeatureCollection',features:edgeFeatures},{
      interactive:true,
      style:f=>{ const rel=f.properties?.relation; const km=Number(f.properties?.boundary_km)||1; return {color:rel==='same_parent'?'#6f777a':'#9b6b32', weight:Math.max(.7, Math.min(3.2, .55+Math.log1p(km)/2.8)), opacity:rel==='same_parent'?0.42:0.68, dashArray:rel==='same_parent'?null:'5 5', lineCap:'round', lineJoin:'round'}; },
      onEachFeature:(f,l)=>{ const p=f.properties||{}; l.on('mouseover',e=>showHoverLater({title:`${p.source_name} — ${p.target_name}`, subtitle:'ребро топологического графа', extra:`общая граница: ${num1(p.boundary_km)} км`, delay:250}, e.originalEvent)); l.on('mousemove',e=>moveHover(e.originalEvent)); l.on('mouseout',hideHover); }
    });
    group.addLayer(edgeLayer);
  }catch(e){ console.warn('topology edges skipped', e); }
  features.forEach(f=>{
    const p=f.properties||{}; if(p.topology_excluded) return;
    const layer=state.adminLayerById.get(featureId(f)); if(!layer || !layer.getBounds) return;
    const c=layer.getBounds().getCenter(); const val=Number(p[field]);
    const r=v88TopologyRadius(val, vals);
    const m=L.circleMarker(c,{radius:r, color:'#2f3540', weight:1.15, fillColor:valueColor(val, vals), fillOpacity:.88, opacity:.95, pane:'markerPane'});
    m.feature=f;
    m.on('mouseover',e=>showHoverLater({title:p.name||'АТЕ', subtitle:`топология: ${v88TopologyMetricLabels[field]||field}`, extra:`соседей: ${p.topo_degree ?? '—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'}`, delay:250}, e.originalEvent));
    m.on('mousemove',e=>moveHover(e.originalEvent));
    m.on('mouseout',hideHover);
    m.on('click',e=>{ L.DomEvent.stopPropagation(e); if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f); });
    group.addLayer(m);
  });
  state.layers.topologyGraph=group;
  if(v88TopologyVisible()) group.addTo(state.map);
}
const v88PriorRefreshAdmin = refreshAdmin;
refreshAdmin = async function refreshAdminV87(seq){
  await v88PriorRefreshAdmin(seq);
  if(isStaleRefresh(seq)) return;
  await v88RenderTopologyGraph();
};
const v88PriorRefreshVisibility = refreshVisibility;
refreshVisibility = function refreshVisibilityV87(){
  v88PriorRefreshVisibility();
  if(!state.map) return;
  const layer=state.layers.topologyGraph;
  if(layer){
    if(v88TopologyVisible()){ if(!state.map.hasLayer(layer)) layer.addTo(state.map); layer.bringToFront && layer.bringToFront(); }
    else if(state.map.hasLayer(layer)) state.map.removeLayer(layer);
  }
};
function v88BindTopologyControls(){
  const toggle=$('toggleTopologyGraph');
  if(toggle && !toggle.dataset.v88Bound){ toggle.dataset.v88Bound='1'; toggle.addEventListener('change', async()=>{ await v88RenderTopologyGraph(); refreshVisibility(); updateLegend(state.currentGeoJSON,state._lastVals||[]); }); }
  const metric=$('topologyMetricSelect');
  if(metric && !metric.dataset.v88Bound){ metric.dataset.v88Bound='1'; metric.addEventListener('change', async()=>{ state.topologyMetric=metric.value; await v88RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); }); }
}
const v88PriorInit = init;
init = async function initV87(){
  await v88PriorInit();
  v88BindTopologyControls();
};
function v88TopoNum(v){ const n=Number(v); if(!Number.isFinite(n)) return '—'; if(Math.abs(n)<1) return n.toFixed(3).replace('.',','); return n.toFixed(1).replace('.',','); }
function v88TopologyStatsBlock(features){
  if(!state.currentGeoJSON) return '';
  const source=(features && features.length) ? features : (state.currentGeoJSON.features||[]);
  const feats=source.filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  if(!feats.length) return '';
  const avg=(field)=>feats.reduce((a,f)=>a+(Number(f.properties?.[field])||0),0)/feats.length;
  const maxBy=(field)=>[...feats].sort((a,b)=>(Number(b.properties?.[field])||0)-(Number(a.properties?.[field])||0))[0];
  const topDeg=maxBy('topo_degree'); const topBet=maxBy('topo_betweenness'); const topCore=maxBy('topo_k_core');
  const graph=feats[0].properties||{};
  return `<div class="analytics-block topology-stats-v88"><h3>Топологическая связность АТД</h3>
    <div class="metric-line"><span>узлов / рёбер графа</span><b>${num(graph.topo_graph_nodes)} / ${num(graph.topo_graph_edges)}</b></div>
    <div class="metric-line"><span>компонент связности</span><b>${num(graph.topo_graph_components)}</b></div>
    <div class="metric-line"><span>плотность графа</span><b>${v88TopoNum(graph.topo_graph_density)}</b></div>
    <div class="metric-line"><span>средняя степень</span><b>${v88TopoNum(avg('topo_degree'))}</b></div>
    <div class="metric-line"><span>средний k-core</span><b>${v88TopoNum(avg('topo_k_core'))}</b></div>
    <div class="metric-line"><span>лидер по соседям</span><b>${escapeHtml(topDeg?.properties?.name||'—')} · ${num(topDeg?.properties?.topo_degree)}</b></div>
    <div class="metric-line"><span>главный посредник</span><b>${escapeHtml(topBet?.properties?.name||'—')} · ${v88TopoNum(topBet?.properties?.topo_betweenness)}</b></div>
    <div class="metric-line"><span>макс. ядро</span><b>${escapeHtml(topCore?.properties?.name||'—')} · k=${num(topCore?.properties?.topo_k_core)}</b></div>
  </div>`;
}
const v88PriorUpdateStats = updateStats;
updateStats = function updateStatsV87(features){
  v88PriorUpdateStats(features);
  const block=v88TopologyStatsBlock(features);
  if(!block) return;
  ['statsBox','rightStatsBox'].forEach(id=>{ const el=$(id); if(el && !el.querySelector('.topology-stats-v88')) el.insertAdjacentHTML('beforeend', block); });
};
const v88PriorUpdateLegend = updateLegend;
updateLegend = function updateLegendV87(gj, vals){
  v88PriorUpdateLegend(gj, vals);
  const box=$('legendBox'); if(!box || !gj) return;
  const hasTopo=(gj.features||[]).some(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  if(!hasTopo) return;
  const metric=v88TopologyMetricField();
  const checked=v88TopologyVisible();
  const div=document.createElement('div');
  div.className='legend-topology-v88';
  div.innerHTML=`<div class="legend-section">Топологический граф</div>
    <div class="legend-row"><span class="topology-node-swatch-v88"></span>узел АТЕ${checked?'':' · включается чекбоксом'}</div>
    <div class="legend-row"><span class="topology-edge-swatch-v88"></span>общая граница ≥ 1 км</div>
    <div class="legend-scale-note-v67">Метрика: ${escapeHtml(v88TopologyMetricLabels[metric]||metric)}. Спецзоны и малые города &lt; 50 км² исключены.</div>`;
  box.appendChild(div);
};
const v88PriorShowFeature = showFeature;
showFeature = function showFeatureV87(f){
  v88PriorShowFeature(f);
  const p=f?.properties||{}; const box=$('featureInfo');
  if(!box || p.topology_excluded) return;
  const html=`<div class="analytics-block topology-object-v88"><h3>Топология объекта</h3>
    <div class="info-row"><span>соседей</span><b>${num(p.topo_degree)}</b></div>
    <div class="info-row"><span>degree centrality</span><b>${v88TopoNum(p.topo_degree_centrality)}</b></div>
    <div class="info-row"><span>betweenness</span><b>${v88TopoNum(p.topo_betweenness)}</b></div>
    <div class="info-row"><span>closeness</span><b>${v88TopoNum(p.topo_closeness)}</b></div>
    <div class="info-row"><span>k-core</span><b>${num(p.topo_k_core)}</b></div>
    <div class="info-row"><span>связи внутри / вовне родителя</span><b>${num(p.topo_internal_degree)} / ${num(p.topo_external_degree)}</b></div>
  </div>`;
  box.insertAdjacentHTML('beforeend', html);
};


/* v88: stricter topology graph controls, node rendering, numeric legends and time-series modal */
try{ v88TopologyModes.add('topo_external_share'); }catch(_){ }
v88TopologyMetricLabels.topo_external_share = 'доля внешних связей';

function v88EnsureTopologyPanes(){
  if(!state.map) return;
  if(!state.map.getPane('topologyEdgePane')){
    const p=state.map.createPane('topologyEdgePane');
    p.style.zIndex=455; p.style.pointerEvents='auto';
  }
  if(!state.map.getPane('topologyNodePane')){
    const p=state.map.createPane('topologyNodePane');
    p.style.zIndex=670; p.style.pointerEvents='auto';
  }
}
v88TopologyVisible = function v88TopologyVisibleStrict(){ return !!$('toggleTopologyGraph')?.checked; };
v88TopologyMetricField = function v88TopologyMetricFieldStrict(){
  const sel=$('topologyMetricSelect');
  return (sel && (v88TopologyModes.has(sel.value) || sel.value==='topo_external_share')) ? sel.value : (v88IsTopologyMode()?state.mode:'topo_degree');
};
function v88FeatureCenterLatLng(f){
  const id=featureId(f);
  const layer=state.adminLayerById?.get(id);
  try{ if(layer && layer.getBounds){ const b=layer.getBounds(); if(b && b.isValid()) return b.getCenter(); } }catch(_){ }
  try{
    const tmp=L.geoJSON(f,{interactive:false});
    const b=tmp.getBounds();
    if(b && b.isValid()) return b.getCenter();
  }catch(_){ }
  const coords=[];
  const collect=a=>{ if(!Array.isArray(a)) return; if(typeof a[0]==='number' && typeof a[1]==='number') coords.push(a); else a.forEach(collect); };
  collect(f.geometry?.coordinates);
  if(coords.length){
    const sx=coords.reduce((s,c)=>s+c[0],0)/coords.length;
    const sy=coords.reduce((s,c)=>s+c[1],0)/coords.length;
    return L.latLng(sy,sx);
  }
  return null;
}
function v88TopoValueLabel(v, metric){
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  if(metric==='topo_degree' || metric==='topo_k_core' || metric==='topo_external_degree') return num(n);
  if(metric==='topo_external_share') return (n*100).toFixed(1).replace('.',',')+'%';
  if(Math.abs(n)<1) return n.toFixed(3).replace('.',',');
  return n.toFixed(2).replace('.',',');
}
function v88TopoLegendBins(vals, metric, bins=5){
  const values=(vals||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!values.length) return [];
  const min=values[0], max=values[values.length-1];
  if(min===max) return [{from:min,to:max,color:valueColor(min,values),label:v88TopoValueLabel(min,metric)}];
  const out=[];
  for(let i=0;i<bins;i++){
    const a=min+(max-min)*i/bins;
    const b=min+(max-min)*(i+1)/bins;
    const mid=(a+b)/2;
    out.push({from:a,to:b,color:valueColor(mid,values),label:`${v88TopoValueLabel(a,metric)}–${v88TopoValueLabel(b,metric)}`});
  }
  return out;
}
function v88EdgeRelationLabels(){
  const y=Number(state.year||0);
  if(y===1926 || y===1930) return {
    same_parent:'внутри одного округа', same_superparent:'между округами одного края / области', cross_parent:'между краем / областью'
  };
  if(y>=1939) return {
    same_parent:'внутри области / края / АО', same_superparent:'между АО и областью одной группы', cross_parent:'между областями / краями / АО'
  };
  if(y>=1897) return {
    same_parent:'внутри губернии / области', same_superparent:'между единицами одной макрогруппы', cross_parent:'между губерниями / областями'
  };
  return {
    same_parent:'внутри провинции / области / уезда', same_superparent:'между единицами одной губернии / наместничества', cross_parent:'между губерниями / областями / провинциями'
  };
}
function v88EdgeStyle(f){
  const rel=f.properties?.relation;
  const km=Number(f.properties?.boundary_km)||1;
  const base={weight:Math.max(1.05, Math.min(4.2, .8+Math.log1p(km)/2.55)), opacity:.78, lineCap:'round', lineJoin:'round', pane:'topologyEdgePane'};
  if(rel==='same_parent') return {...base, color:'#667579', opacity:.52, dashArray:null};
  if(rel==='same_superparent') return {...base, color:'#8b7a41', opacity:.72, dashArray:'7 5'};
  if(rel==='cross_parent') return {...base, color:'#a35f20', opacity:.86, dashArray:'3 6'};
  return {...base, color:'#7a7d85', opacity:.55, dashArray:'2 5'};
}
async function v88LoadTopologyEdgesForYear(year=state.year){
  const topoPath=state.manifest?.layers?.topology?.[String(year)];
  if(!topoPath) return {type:'FeatureCollection',features:[]};
  return await loadJson(topoPath);
}
v88RenderTopologyGraph = async function v88RenderTopologyGraphImproved(){
  clearLayer('topologyGraph');
  if(!state.map || !state.currentGeoJSON || !v88TopologyVisible()) return;
  v88EnsureTopologyPanes();
  const field=v88TopologyMetricField();
  const features=(state.currentGeoJSON.features||[]);
  const visibleById=new Map(features.map(f=>[String(featureId(f)),f]));
  const vals=features.filter(f=>!f.properties?.topology_excluded).map(f=>Number(f.properties?.[field])).filter(Number.isFinite);
  const group=L.layerGroup();
  try{
    const edges=await v88LoadTopologyEdgesForYear(state.year);
    const edgeFeatures=(edges.features||[]).filter(e=>visibleById.has(String(e.properties?.source_id)) && visibleById.has(String(e.properties?.target_id)));
    const counts=edgeFeatures.reduce((acc,e)=>{ const r=e.properties?.relation||'unknown'; acc[r]=(acc[r]||0)+1; return acc; },{});
    state.topologyEdgeStats={year:state.year, counts, total:edgeFeatures.length};
    const edgeLayer=L.geoJSON({type:'FeatureCollection',features:edgeFeatures},{
      interactive:true,
      pane:'topologyEdgePane',
      style:v88EdgeStyle,
      onEachFeature:(f,l)=>{ const p=f.properties||{}; l.on('mouseover',e=>showHoverLater({title:`${p.source_name} — ${p.target_name}`, subtitle:'ребро топологического графа', extra:`общая граница: ${num1(p.boundary_km)} км · ${escapeHtml(v88EdgeRelationLabels()[p.relation]||p.relation||'тип связи')}`, delay:250}, e.originalEvent)); l.on('mousemove',e=>moveHover(e.originalEvent)); l.on('mouseout',hideHover); }
    });
    group.addLayer(edgeLayer);
  }catch(e){ console.warn('topology edges skipped', e); state.topologyEdgeStats={year:state.year, counts:{}, total:0}; }
  features.forEach(f=>{
    const p=f.properties||{}; if(p.topology_excluded) return;
    const c=v88FeatureCenterLatLng(f); if(!c) return;
    const val=Number(p[field]);
    const r=v88TopologyRadius(val, vals);
    const m=L.circleMarker(c,{radius:r, color:'#1f2730', weight:1.45, fillColor:valueColor(val, vals), fillOpacity:.94, opacity:1, pane:'topologyNodePane', bubblingMouseEvents:false, interactive:true});
    m.feature=f;
    m.on('mouseover',e=>showHoverLater({title:p.name||'АТЕ', subtitle:`узел графа · ${v88TopologyMetricLabels[field]||field}`, extra:`значение: ${v88TopoValueLabel(val,field)} · соседей: ${p.topo_degree ?? '—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'}`, delay:250}, e.originalEvent));
    m.on('mousemove',e=>moveHover(e.originalEvent));
    m.on('mouseout',hideHover);
    m.on('click',e=>{ L.DomEvent.stopPropagation(e); if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f); });
    group.addLayer(m);
  });
  state.layers.topologyGraph=group;
  group.addTo(state.map);
  try{ group.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  if(!state._v88TopologyLegendRefreshing){
    state._v88TopologyLegendRefreshing=true;
    try{ updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(_){ }
    state._v88TopologyLegendRefreshing=false;
  }
};

function v88RefreshTopologyLegend(){ updateLegend(state.currentGeoJSON,state._lastVals||[]); }
function v88BindTopologyControlsImproved(){
  const btn=$('openTopologyTrends');
  if(btn && !btn.dataset.v88ImprovedBound){ btn.dataset.v88ImprovedBound='1'; btn.addEventListener('click', openTopologyTrendsModal); }
  const toggle=$('toggleTopologyGraph');
  if(toggle && !toggle.dataset.v88ImprovedBound){ toggle.dataset.v88ImprovedBound='1'; toggle.addEventListener('change', async()=>{ await v88RenderTopologyGraph(); refreshVisibility(); v88RefreshTopologyLegend(); }); }
  const metric=$('topologyMetricSelect');
  if(metric && !metric.dataset.v88ImprovedBound){ metric.dataset.v88ImprovedBound='1'; metric.addEventListener('change', async()=>{ state.topologyMetric=metric.value; await v88RenderTopologyGraph(); v88RefreshTopologyLegend(); }); }
}
var v88bPriorInit = init;
init = async function initV88Improved(){
  await v88bPriorInit();
  v88BindTopologyControlsImproved();
};
var v88bPriorRefreshVisibility = refreshVisibility;
refreshVisibility = function refreshVisibilityV88Improved(){
  v88bPriorRefreshVisibility();
  const layer=state.layers.topologyGraph;
  if(!state.map || !layer) return;
  if(v88TopologyVisible()){ if(!state.map.hasLayer(layer)) layer.addTo(state.map); try{ layer.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ } }
  else if(state.map.hasLayer(layer)) state.map.removeLayer(layer);
};
var v88bPriorUpdateLegend = updateLegend;
updateLegend = function updateLegendV88Improved(gj, vals){
  v88bPriorUpdateLegend(gj, vals);
  const box=$('legendBox'); if(!box || !gj) return;
  const metric=v88TopologyMetricField();
  const topoVals=(gj.features||[]).filter(f=>!f.properties?.topology_excluded).map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  const isTopoMode=v88IsTopologyMode();
  if(isTopoMode || v88TopologyVisible()){
    const bins=v88TopoLegendBins(topoVals, metric, 5);
    const section=document.createElement('div');
    section.className='legend-topology-metric-v88';
    section.innerHTML=`<div class="legend-section">Топология: ${escapeHtml(v88TopologyMetricLabels[metric]||metric)}</div>`+
      bins.map(b=>`<div class="legend-row legend-row-class-v67"><span class="swatch" style="background:${b.color}"></span><span>${escapeHtml(b.label)}</span></div>`).join('')+
      `<div class="mini-muted legend-scale-note-v67">Диапазон по включённым в граф АТЕ: ${v88TopoValueLabel(topoVals.length?Math.min(...topoVals):null, metric)} — ${v88TopoValueLabel(topoVals.length?Math.max(...topoVals):null, metric)}</div>`;
    box.appendChild(section);
  }
  if(v88TopologyVisible()){
    const labels=v88EdgeRelationLabels();
    const counts=(state.topologyEdgeStats && state.topologyEdgeStats.year===state.year) ? state.topologyEdgeStats.counts : {};
    const edgeRows=[['same_parent','topology-edge-same-v88'],['same_superparent','topology-edge-super-v88'],['cross_parent','topology-edge-cross-v88']]
      .map(([k,cls])=>`<div class="legend-row"><span class="${cls}"></span><span>${escapeHtml(labels[k])}</span><b>${num(counts[k]||0)}</b></div>`).join('');
    const div=document.createElement('div');
    div.className='legend-topology-edges-v88';
    div.innerHTML=`<div class="legend-section">Рёбра графа по типу связи</div>${edgeRows}<div class="legend-row"><span class="topology-node-swatch-v88"></span><span>узел АТЕ</span><b>${num((gj.features||[]).filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree))).length)}</b></div><div class="mini-muted legend-scale-note-v67">Порог общей границы: ≥ 1 км. Числа справа — количество рёбер/узлов в текущем слое.</div>`;
    box.appendChild(div);
  }
};

const v88TrendMetricLabels = {
  nodes:'узлы графа', edges:'рёбра графа', components:'компоненты связности', graph_density:'плотность графа', cyclomatic:'цикломатическое число', articulation_points:'точки сочленения',
  avg_degree:'средняя степень', avg_degree_centrality:'средняя degree centrality', avg_betweenness:'средняя betweenness', avg_closeness:'средняя closeness', avg_k_core:'средний k-core',
  avg_external_degree:'среднее число внешних связей', avg_external_share:'средняя доля внешних связей', same_parent_edges:'рёбра внутри родителя', same_superparent_edges:'рёбра внутри вышестоящей группы', cross_parent_edges:'межродительские рёбра'
};
function v88TrendMetricOptions(){ return Object.keys(v88TrendMetricLabels); }
async function v88LoadTopologyMetrics(){
  if(state._topologyMetricsByYear) return state._topologyMetricsByYear;
  const path=state.manifest?.layers?.topology_metrics || 'data/topology/topology_metrics_by_year.json';
  const data=await loadJson(path);
  state._topologyMetricsByYear=Array.isArray(data)?data:[];
  return state._topologyMetricsByYear;
}
function v88FormatTrendValue(v, key){
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  if(key.includes('share')) return (n*100).toFixed(1).replace('.',',')+'%';
  if(['graph_density','avg_betweenness','avg_closeness','avg_degree_centrality'].includes(key)) return n.toFixed(3).replace('.',',');
  if(Math.abs(n)<10 && !Number.isInteger(n)) return n.toFixed(2).replace('.',',');
  return num(n);
}
function ensureTopologyTrendsModal(){
  let modal=$('topologyTrendsModal'); if(modal) return modal;
  modal=document.createElement('div'); modal.id='topologyTrendsModal'; modal.className='chart-lightbox topology-trends-modal-v88'; modal.setAttribute('aria-hidden','true');
  modal.innerHTML=`<div class="chart-lightbox-scrim" data-close-topology-trends="1"></div><section class="chart-lightbox-card" role="dialog" aria-modal="true" aria-labelledby="topologyTrendsTitle"><button type="button" class="chart-lightbox-close" aria-label="Закрыть динамику топологии">×</button><div class="chart-lightbox-kicker">Топологическая связность · ${APP_VERSION}</div><h2 id="topologyTrendsTitle">Динамика метрик графа АТД</h2><div id="topologyTrendsBody" class="chart-lightbox-body topology-trends-body-v88">Загрузка…</div></section>`;
  document.body.appendChild(modal);
  modal.querySelector('.chart-lightbox-close').addEventListener('click', closeTopologyTrendsModal);
  modal.querySelector('[data-close-topology-trends]').addEventListener('click', closeTopologyTrendsModal);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeTopologyTrendsModal(); });
  return modal;
}
async function openTopologyTrendsModal(){
  const modal=ensureTopologyTrendsModal();
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  await renderTopologyTrendsControls();
}
function closeTopologyTrendsModal(){ const modal=$('topologyTrendsModal'); if(modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); } }
async function renderTopologyTrendsControls(){
  const body=$('topologyTrendsBody'); if(!body) return;
  const data=await v88LoadTopologyMetrics();
  const years=data.map(d=>Number(d.year)).filter(Number.isFinite);
  const selected=new Set(state._topologyTrendYears || years);
  const metric=state._topologyTrendMetric || 'avg_degree';
  body.innerHTML=`<div class="topology-trend-controls-v88"><label class="control-label" for="topologyTrendMetric">Метрика графа</label><select id="topologyTrendMetric">${v88TrendMetricOptions().map(k=>`<option value="${k}" ${k===metric?'selected':''}>${escapeHtml(v88TrendMetricLabels[k])}</option>`).join('')}</select><div class="topology-trend-buttons-v88"><button type="button" id="topologyTrendAll">Все годы</button><button type="button" id="topologyTrendClear">Снять все</button><button type="button" id="topologyTrendCore">Только опорные</button></div><div id="topologyTrendYears" class="topology-trend-years-v88">${years.map(y=>`<label><input type="checkbox" value="${y}" ${selected.has(y)?'checked':''}>${y}</label>`).join('')}</div></div><div id="topologyTrendChart" class="topology-trend-chart-v88"></div><div id="topologyTrendTable" class="topology-trend-table-v88"></div>`;
  const sync=()=>{ const ys=[...body.querySelectorAll('#topologyTrendYears input:checked')].map(i=>Number(i.value)); state._topologyTrendYears=ys; state._topologyTrendMetric=$('topologyTrendMetric')?.value || metric; renderTopologyTrendChart(); };
  $('topologyTrendMetric')?.addEventListener('change', sync);
  body.querySelectorAll('#topologyTrendYears input').forEach(i=>i.addEventListener('change', sync));
  $('topologyTrendAll')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYears input').forEach(i=>i.checked=true); sync(); });
  $('topologyTrendClear')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYears input').forEach(i=>i.checked=false); sync(); });
  $('topologyTrendCore')?.addEventListener('click',()=>{ const core=new Set([1700,1745,1783,1798,1821,1848,1876,1897,1914,1926,1939,1959,1970,1989,2021]); body.querySelectorAll('#topologyTrendYears input').forEach(i=>i.checked=core.has(Number(i.value))); sync(); });
  renderTopologyTrendChart();
}
async function renderTopologyTrendChart(){
  const chart=$('topologyTrendChart'), table=$('topologyTrendTable'); if(!chart || !table) return;
  const data=await v88LoadTopologyMetrics();
  const metric=state._topologyTrendMetric || $('topologyTrendMetric')?.value || 'avg_degree';
  const selectedYears=new Set((state._topologyTrendYears&&state._topologyTrendYears.length?state._topologyTrendYears:data.map(d=>Number(d.year))).map(Number));
  const rows=data.filter(d=>selectedYears.has(Number(d.year)) && Number.isFinite(Number(d[metric]))).sort((a,b)=>Number(a.year)-Number(b.year));
  if(rows.length<2){ chart.innerHTML='<div class="mini-muted">Выберите минимум два года для линии.</div>'; table.innerHTML=''; return; }
  const w=860,h=360,pad={l:72,r:26,t:24,b:48};
  const xs=rows.map(r=>Number(r.year)); const ys=rows.map(r=>Number(r[metric]));
  const xmin=Math.min(...xs), xmax=Math.max(...xs); let ymin=Math.min(...ys), ymax=Math.max(...ys); if(ymin===ymax){ ymin-=1; ymax+=1; }
  const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
  const yScale=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const pts=rows.map(r=>`${xScale(Number(r.year)).toFixed(1)},${yScale(Number(r[metric])).toFixed(1)}`).join(' ');
  const xTicks=rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.ceil(rows.length/8)===0).map(r=>Number(r.year));
  const yTicks=[0,.25,.5,.75,1].map(t=>ymin+(ymax-ymin)*t);
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88" role="img" aria-label="Динамика ${escapeHtml(v88TrendMetricLabels[metric]||metric)}">
    <rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>
    ${yTicks.map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScale(t)}" y2="${yScale(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScale(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(v88FormatTrendValue(t,metric))}</text>`).join('')}
    ${xTicks.map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-18}" text-anchor="middle" class="trend-label-v88">${t}</text>`).join('')}
    <polyline points="${pts}" fill="none" class="trend-line-v88"/>
    ${rows.map(r=>`<circle cx="${xScale(Number(r.year))}" cy="${yScale(Number(r[metric]))}" r="5.2" class="trend-point-v88"><title>${r.year}: ${v88FormatTrendValue(r[metric],metric)}</title></circle>`).join('')}
    <text x="${pad.l}" y="18" class="trend-title-v88">${escapeHtml(v88TrendMetricLabels[metric]||metric)}</text>
  </svg>`;
  table.innerHTML=`<div class="chart-legend-head topology-trend-head-v88"><span></span><span>год</span><span>значение</span><span>лидер / примечание</span></div>`+rows.map(r=>{
    const leader=metric.includes('betweenness') ? r.max_betweenness_name : metric.includes('closeness') ? r.max_closeness_name : metric.includes('k_core') ? r.max_k_core_name : r.max_degree_name;
    return `<div class="chart-legend-row topology-trend-row-v88"><span class="pie-dot"></span><span>${r.year}</span><b>${v88FormatTrendValue(r[metric],metric)}</b><em>${escapeHtml(leader||'—')}</em></div>`;
  }).join('');
}


/* v89: robust synchronized topology graph rendering, numeric legend, edge styles and graph statistics */
try{
  v88TopologyModes.add('topo_external_degree');
  v88TopologyModes.add('topo_external_share');
  v88TopologyModes.add('topo_bridge_incident_count');
  v88TopologyMetricLabels.topo_bridge_incident_count='мостовые связи узла';
}catch(_){ }

v88TrendMetricLabels.bridges='мосты графа';
function v89IsTopologyMode(){ return v88TopologyModes.has(state.mode); }
function v89TopologyMetricField(){
  if(v89IsTopologyMode()) return state.mode;
  const sel=$('topologyMetricSelect');
  return (sel && v88TopologyModes.has(sel.value)) ? sel.value : 'topo_degree';
}
v88TopologyMetricField = v89TopologyMetricField;
v88TopologyVisible = function v89TopologyVisible(){ return !!($('toggleTopologyGraph')?.checked || v89IsTopologyMode()); };

function v89EnsureTopologyPanes(){
  if(!state.map) return;
  if(!state.map.getPane('topologyEdgePane')){
    const p=state.map.createPane('topologyEdgePane');
    p.style.zIndex=690; p.style.pointerEvents='auto';
  }else{
    const p=state.map.getPane('topologyEdgePane'); p.style.zIndex=690; p.style.pointerEvents='auto';
  }
  if(!state.map.getPane('topologyNodePane')){
    const p=state.map.createPane('topologyNodePane');
    p.style.zIndex=740; p.style.pointerEvents='auto';
  }else{
    const p=state.map.getPane('topologyNodePane'); p.style.zIndex=740; p.style.pointerEvents='auto';
  }
}
function v89EdgeStyleMode(){ return $('topologyEdgeStyleSelect')?.value || 'relation'; }
function v89EdgeStyle(f){
  const km=Number(f.properties?.boundary_km)||1;
  const w=Math.max(1.8, Math.min(5.5, 1.2+Math.log1p(km)/2.05));
  const base={weight:w, opacity:.92, lineCap:'round', lineJoin:'round', pane:'topologyEdgePane', className:'topology-edge-path-v89'};
  if(v89EdgeStyleMode()==='uniform') return {...base, color:'#25313d', opacity:.76, dashArray:null};
  const rel=f.properties?.relation;
  if(rel==='same_parent') return {...base, color:'#195f9d', opacity:.75, dashArray:null};
  if(rel==='same_superparent') return {...base, color:'#7d55b2', opacity:.88, dashArray:'8 5'};
  if(rel==='cross_parent') return {...base, color:'#c05a16', opacity:.96, dashArray:'3 5'};
  return {...base, color:'#555b62', opacity:.65, dashArray:'4 6'};
}
function v89TopologyRadius(v, vals){
  const n=Number(v);
  const scaled=v88TopoScaleValue(Number.isFinite(n)?n:0, vals);
  return 5.5 + scaled*16.5;
}
function v89NodeStyle(val, vals, metric){
  return {
    radius:v89TopologyRadius(val, vals),
    color:'#0c1721',
    weight:1.9,
    fillColor:valueColor(Number.isFinite(Number(val))?Number(val):0, vals),
    fillOpacity:.96,
    opacity:1,
    pane:'topologyNodePane',
    bubblingMouseEvents:false,
    interactive:true,
    className:'topology-node-marker-v89'
  };
}
async function v89RenderTopologyGraph(){
  try{ clearLayer('topologyGraph'); }catch(_){ }
  state.topologyEdgeStats={year:state.year, counts:{}, total:0};
  if(!state.map || !state.currentGeoJSON || !v88TopologyVisible()) return;
  v89EnsureTopologyPanes();
  const field=v89TopologyMetricField();
  const features=(state.currentGeoJSON.features||[]);
  const visibleById=new Map(features.map(f=>[String(featureId(f)),f]));
  const topoFeatures=features.filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  const vals=topoFeatures.map(f=>Number(f.properties?.[field])).filter(Number.isFinite);
  const group=L.layerGroup();
  try{
    const edges=await v88LoadTopologyEdgesForYear(state.year);
    const edgeFeatures=(edges.features||[]).filter(e=>visibleById.has(String(e.properties?.source_id)) && visibleById.has(String(e.properties?.target_id)));
    const counts=edgeFeatures.reduce((acc,e)=>{ const r=e.properties?.relation||'unknown'; acc[r]=(acc[r]||0)+1; if(e.properties?.is_bridge) acc.bridges=(acc.bridges||0)+1; return acc; },{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0});
    state.topologyEdgeStats={year:state.year, counts, total:edgeFeatures.length};
    const edgeLayer=L.geoJSON({type:'FeatureCollection',features:edgeFeatures},{
      interactive:true,
      pane:'topologyEdgePane',
      style:v89EdgeStyle,
      onEachFeature:(f,l)=>{ const p=f.properties||{}; l.on('mouseover',e=>showHoverLater({title:`${p.source_name} — ${p.target_name}`, subtitle:'ребро топологического графа', extra:`общая граница: ${num1(p.boundary_km)} км · ${escapeHtml(v88EdgeRelationLabels()[p.relation]||p.relation||'тип связи')}${p.is_bridge?' · мост':''}`, delay:250}, e.originalEvent)); l.on('mousemove',e=>moveHover(e.originalEvent)); l.on('mouseout',hideHover); }
    });
    group.addLayer(edgeLayer);
  }catch(e){ console.warn('topology edges skipped', e); }
  topoFeatures.forEach(f=>{
    const p=f.properties||{};
    const c=v88FeatureCenterLatLng(f); if(!c) return;
    const val=Number(p[field]);
    const m=L.circleMarker(c, v89NodeStyle(val, vals, field));
    m.feature=f;
    m.on('mouseover',e=>showHoverLater({title:p.name||'АТЕ', subtitle:`узел графа · ${v88TopologyMetricLabels[field]||field}`, extra:`значение: ${v88TopoValueLabel(val,field)} · соседей: ${p.topo_degree ?? '—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'} · мостовых: ${p.topo_bridge_incident_count ?? 0}`, delay:250}, e.originalEvent));
    m.on('mousemove',e=>moveHover(e.originalEvent));
    m.on('mouseout',hideHover);
    m.on('click',e=>{ L.DomEvent.stopPropagation(e); if(state.tool !== 'pan') return; toggleSelection(f); showFeature(f); });
    group.addLayer(m);
  });
  state.layers.topologyGraph=group;
  group.addTo(state.map);
  try{ group.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  if(!state._v89TopologyLegendRefreshing){
    state._v89TopologyLegendRefreshing=true;
    try{ updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(_){ }
    state._v89TopologyLegendRefreshing=false;
  }
}
v88RenderTopologyGraph = v89RenderTopologyGraph;

function v89GraphStats(features){
  const source=(features && features.length) ? features : (state.currentGeoJSON?.features||[]);
  const feats=source.filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  if(!feats.length) return '';
  const avg=(field)=>feats.reduce((a,f)=>a+(Number(f.properties?.[field])||0),0)/feats.length;
  const maxBy=(field)=>[...feats].sort((a,b)=>(Number(b.properties?.[field])||0)-(Number(a.properties?.[field])||0))[0];
  const topDeg=maxBy('topo_degree'); const topBet=maxBy('topo_betweenness'); const topCore=maxBy('topo_k_core');
  const g=feats[0].properties||{};
  const art=Number.isFinite(Number(g.topo_graph_articulation_points)) ? Number(g.topo_graph_articulation_points) : feats.filter(f=>!!f.properties?.topo_articulation_point || !!f.properties?.topo_articulation_point_computed).length;
  const bridges=Number.isFinite(Number(g.topo_graph_bridges)) ? Number(g.topo_graph_bridges) : 0;
  return `<div class="analytics-block topology-stats-v88 topology-stats-v89"><h3>Топологическая связность АТД</h3>
    <div class="metric-line"><span>узлов / рёбер графа</span><b>${num(g.topo_graph_nodes)} / ${num(g.topo_graph_edges)}</b></div>
    <div class="metric-line"><span>компонент связности</span><b>${num(g.topo_graph_components)}</b></div>
    <div class="metric-line"><span>плотность графа</span><b>${v88TopoNum(g.topo_graph_density)}</b></div>
    <div class="metric-line"><span>цикломатическое число</span><b>${num(g.topo_graph_cyclomatic)}</b></div>
    <div class="metric-line"><span>мосты / точки сочленения</span><b>${num(bridges)} / ${num(art)}</b></div>
    <div class="metric-line"><span>средняя степень</span><b>${v88TopoNum(avg('topo_degree'))}</b></div>
    <div class="metric-line"><span>средний k-core</span><b>${v88TopoNum(avg('topo_k_core'))}</b></div>
    <div class="metric-line"><span>лидер по соседям</span><b>${escapeHtml(topDeg?.properties?.name||'—')} · ${num(topDeg?.properties?.topo_degree)}</b></div>
    <div class="metric-line"><span>главный посредник</span><b>${escapeHtml(topBet?.properties?.name||'—')} · ${v88TopoNum(topBet?.properties?.topo_betweenness)}</b></div>
    <div class="metric-line"><span>макс. ядро</span><b>${escapeHtml(topCore?.properties?.name||'—')} · k=${num(topCore?.properties?.topo_k_core)}</b></div>
  </div>`;
}
v88TopologyStatsBlock = v89GraphStats;

const v89PriorUpdateStats = updateStats;
updateStats = function updateStatsV89(features){
  v89PriorUpdateStats(features);
  const block=v89GraphStats(features);
  ['statsBox','rightStatsBox'].forEach(id=>{ const el=$(id); if(!el) return; el.querySelectorAll('.topology-stats-v88,.topology-stats-v89').forEach(x=>x.remove()); if(block) el.insertAdjacentHTML('beforeend', block); });
};

function v89BinCount(vals, bin, idx, total){
  return vals.filter(v=>idx===total-1 ? (v>=bin.from && v<=bin.to) : (v>=bin.from && v<bin.to)).length;
}
const v89PriorUpdateLegend = updateLegend;
updateLegend = function updateLegendV89(gj, vals){
  v89PriorUpdateLegend(gj, vals);
  const box=$('legendBox'); if(!box || !gj) return;
  box.querySelectorAll('.legend-topology-v88,.legend-topology-metric-v88,.legend-topology-edges-v88,.legend-topology-v89').forEach(x=>x.remove());
  const metric=v89TopologyMetricField();
  const topoVals=(gj.features||[]).filter(f=>!f.properties?.topology_excluded).map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  const showTopo=v89IsTopologyMode() || v88TopologyVisible();
  if(showTopo){
    const bins=v88TopoLegendBins(topoVals, metric, 5);
    const sec=document.createElement('div'); sec.className='legend-topology-v89 legend-topology-metric-v89';
    sec.innerHTML=`<div class="legend-section">Топология: ${escapeHtml(v88TopologyMetricLabels[metric]||metric)}</div>`+
      bins.map((b,i)=>`<div class="legend-row legend-row-class-v67"><span class="swatch" style="background:${b.color}"></span><span>${escapeHtml(b.label)}</span><b>${num(v89BinCount(topoVals,b,i,bins.length))}</b></div>`).join('')+
      `<div class="mini-muted legend-scale-note-v67">Диапазон: ${v88TopoValueLabel(topoVals.length?Math.min(...topoVals):null, metric)} — ${v88TopoValueLabel(topoVals.length?Math.max(...topoVals):null, metric)}. Число справа — объектов в классе.</div>`;
    box.appendChild(sec);
  }
  if(v88TopologyVisible()){
    const labels=v88EdgeRelationLabels();
    const counts=(state.topologyEdgeStats && state.topologyEdgeStats.year===state.year) ? state.topologyEdgeStats.counts : {};
    const nodeCount=(gj.features||[]).filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree))).length;
    const rows = v89EdgeStyleMode()==='uniform'
      ? `<div class="legend-row"><span class="topology-edge-uniform-v89"></span><span>рёбра графа, единый стиль</span><b>${num(state.topologyEdgeStats?.total||0)}</b></div>`
      : [['same_parent','topology-edge-same-v89'],['same_superparent','topology-edge-super-v89'],['cross_parent','topology-edge-cross-v89']].map(([k,cls])=>`<div class="legend-row"><span class="${cls}"></span><span>${escapeHtml(labels[k])}</span><b>${num(counts[k]||0)}</b></div>`).join('');
    const div=document.createElement('div'); div.className='legend-topology-v89 legend-topology-edges-v89';
    div.innerHTML=`<div class="legend-section">Рёбра и узлы графа</div>${rows}<div class="legend-row"><span class="topology-node-swatch-v89"></span><span>узлы АТЕ, размер/цвет = метрика</span><b>${num(nodeCount)}</b></div><div class="legend-row"><span class="topology-edge-bridge-v89"></span><span>мостовые рёбра</span><b>${num(counts.bridges||0)}</b></div><div class="mini-muted legend-scale-note-v67">Ребро = общая граница ≥ 1 км; спорные зоны, двоеданцы и малые города &lt; 50 км² исключены.</div>`;
    box.appendChild(div);
  }
};

function v89SyncTopologyUiFromMode(){
  const metric=$('topologyMetricSelect');
  if(metric && v89IsTopologyMode() && [...metric.options].some(o=>o.value===state.mode)) metric.value=state.mode;
}
function v89BindTopologyControls(){
  v89SyncTopologyUiFromMode();
  const toggle=$('toggleTopologyGraph');
  if(toggle && toggle.dataset.v89Bound!=='1'){
    toggle.dataset.v89Bound='1';
    toggle.addEventListener('change', async()=>{ await v89RenderTopologyGraph(); refreshVisibility(); updateLegend(state.currentGeoJSON,state._lastVals||[]); });
  }
  const metric=$('topologyMetricSelect');
  if(metric && metric.dataset.v89Bound!=='1'){
    metric.dataset.v89Bound='1';
    metric.addEventListener('change', async()=>{ state.topologyMetric=metric.value; await v89RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); });
  }
  const edgeStyle=$('topologyEdgeStyleSelect');
  if(edgeStyle && edgeStyle.dataset.v89Bound!=='1'){
    edgeStyle.dataset.v89Bound='1';
    edgeStyle.addEventListener('change', async()=>{ await v89RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); });
  }
  const mode=$('modeSelect');
  if(mode && mode.dataset.v89TopologyBound!=='1'){
    mode.dataset.v89TopologyBound='1';
    mode.addEventListener('change', async()=>{ setTimeout(async()=>{ v89SyncTopologyUiFromMode(); await v89RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); updateStatsAndSelection(); },0); });
  }
}
const v89PriorRefreshAdmin = refreshAdmin;
refreshAdmin = async function refreshAdminV89(seq){
  await v89PriorRefreshAdmin(seq);
  if(isStaleRefresh(seq)) return;
  v89SyncTopologyUiFromMode();
  await v89RenderTopologyGraph();
};
const v89PriorRefreshVisibility = refreshVisibility;
refreshVisibility = function refreshVisibilityV89(){
  v89PriorRefreshVisibility();
  const layer=state.layers.topologyGraph;
  if(!state.map || !layer) return;
  if(v88TopologyVisible()){ if(!state.map.hasLayer(layer)) layer.addTo(state.map); try{ layer.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ } }
  else if(state.map.hasLayer(layer)) state.map.removeLayer(layer);
};

(function v89BootTopology(){
  const boot=()=>{ try{ v89BindTopologyControls(); v89SyncTopologyUiFromMode(); v89RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(e){ console.warn('v89 topology boot failed', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,180),{once:true}); else setTimeout(boot,180);
})();


/* v90: explicit topology node layers, robust graph rendering, numeric legends and trend modal */
try{
  v88TopologyModes.add('topo_external_share');
  v88TopologyModes.add('topo_bridge_incident_count');
  v88TopologyMetricLabels.topo_external_share='доля внешних связей';
  v88TopologyMetricLabels.topo_bridge_incident_count='мостовые связи узла';
}catch(_){ }
function v90IsTopologyMode(){ return v88TopologyModes.has(state.mode); }
function v90TopologyMetricField(){
  if(v90IsTopologyMode()) return state.mode;
  const sel=$('topologyMetricSelect');
  return (sel && v88TopologyModes.has(sel.value)) ? sel.value : 'topo_degree';
}
function v90TopologyVisible(){ return !!($('toggleTopologyGraph')?.checked || v90IsTopologyMode()); }
v88TopologyVisible = v90TopologyVisible;
v88TopologyMetricField = v90TopologyMetricField;
const v90PreviousValField = valField;
valField = function valFieldV90(){ return v90IsTopologyMode() ? v90TopologyMetricField() : v90PreviousValField(); };

function v90EnsureMetricOptions(){
  const sel=$('topologyMetricSelect'); if(!sel) return;
  const options={
    topo_degree:'Degree: число соседей',
    topo_degree_centrality:'Degree centrality',
    topo_betweenness:'Betweenness: посредничество',
    topo_closeness:'Closeness: близость',
    topo_k_core:'K-core: ядро / периферия',
    topo_external_degree:'Межгрупповые связи',
    topo_external_share:'Доля внешних связей',
    topo_bridge_incident_count:'Мостовые связи узла'
  };
  Object.entries(options).forEach(([value,label])=>{
    if(![...sel.options].some(o=>o.value===value)){
      const opt=document.createElement('option'); opt.value=value; opt.textContent=label; sel.appendChild(opt);
    }
  });
}
function v90EnsureTopologyPanes(){
  if(!state.map) return;
  const specs=[['topologyEdgePane',760],['topologyNodePane',790]];
  specs.forEach(([name,z])=>{
    let p=state.map.getPane(name);
    if(!p) p=state.map.createPane(name);
    p.style.zIndex=String(z);
    p.style.pointerEvents='auto';
  });
}
function v90TopologyPath(kind, year=state.year){
  const y=String(year);
  const layers=state.manifest?.layers || {};
  if(kind==='nodes') return layers.topology_nodes?.[y] || `data/topology/topology_nodes_${y}.geojson`;
  return layers.topology_edges?.[y] || layers.topology?.[y] || `data/topology/topology_${y}.geojson`;
}
async function v90LoadTopologyNodes(year=state.year){
  const path=v90TopologyPath('nodes',year);
  if(!path) return {type:'FeatureCollection',features:[]};
  try{ return await loadJson(path); }catch(e){ console.warn('topology nodes skipped', e); return {type:'FeatureCollection',features:[]}; }
}
async function v90LoadTopologyEdges(year=state.year){
  const path=v90TopologyPath('edges',year);
  if(!path) return {type:'FeatureCollection',features:[]};
  try{ return await loadJson(path); }catch(e){ console.warn('topology edges skipped', e); return {type:'FeatureCollection',features:[]}; }
}
function v90MetricValueLabel(v, metric=v90TopologyMetricField()){
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  if(metric==='topo_external_share') return (n*100).toFixed(1).replace('.',',')+'%';
  if(['topo_degree','topo_k_core','topo_external_degree','topo_internal_degree','topo_bridge_incident_count'].includes(metric)) return fmt.format(Math.round(n));
  if(Math.abs(n)<1) return n.toFixed(3).replace('.',',');
  return n.toFixed(2).replace('.',',');
}
function v90MetricScaleValue(v, vals){
  const values=(vals||[]).filter(x=>Number.isFinite(Number(x))).map(Number).sort((a,b)=>a-b);
  const n=Number(v); if(!Number.isFinite(n) || !values.length) return .15;
  const min=values[0], max=values[values.length-1]; if(max===min) return .72;
  return Math.max(0,Math.min(1,(n-min)/(max-min)));
}
function v90NodeRadius(v, vals, metric){
  const s=v90MetricScaleValue(v, vals);
  if(metric==='topo_bridge_incident_count') return 6 + s*18;
  return 5.5 + s*16.5;
}
function v90NodeStyle(feature, vals, metric){
  const p=feature.properties||{};
  const val=Number(p[metric]);
  const bridge=Number(p.topo_bridge_incident_count)||0;
  return {
    radius:v90NodeRadius(val, vals, metric),
    color: bridge>0 ? '#111827' : '#17202b',
    weight: bridge>0 ? 2.6 : 1.8,
    fillColor:valueColor(Number.isFinite(val)?val:0, vals),
    fillOpacity:.96,
    opacity:1,
    pane:'topologyNodePane',
    bubblingMouseEvents:false,
    interactive:true,
    className:'topology-node-marker-v90'
  };
}
function v90EdgeStyleMode(){ return $('topologyEdgeStyleSelect')?.value || 'relation'; }
function v90EdgeStyle(feature){
  const p=feature.properties||{};
  const km=Number(p.boundary_km)||1;
  const w=Math.max(2.2, Math.min(6.5, 1.4+Math.log1p(km)/1.9));
  const base={weight:w, opacity:.94, lineCap:'round', lineJoin:'round', pane:'topologyEdgePane', className:'topology-edge-path-v90'};
  if(v90EdgeStyleMode()==='uniform') return {...base, color:p.is_bridge?'#111827':'#2d3744', opacity:p.is_bridge?.96:.78, dashArray:null};
  if(p.is_bridge) return {...base, color:'#111827', weight:w+1.1, opacity:.98, dashArray:null};
  if(p.relation==='same_parent') return {...base, color:'#1769aa', opacity:.82, dashArray:null};
  if(p.relation==='same_superparent') return {...base, color:'#7c4db2', opacity:.90, dashArray:'9 5'};
  if(p.relation==='cross_parent') return {...base, color:'#d85b12', opacity:.98, dashArray:'3 5'};
  return {...base, color:'#666f78', opacity:.72, dashArray:'4 6'};
}
function v90FindAdminFeatureByNode(nodeFeature){
  const id=String(nodeFeature.properties?.unit_id || nodeFeature.properties?.topology_node_id || '');
  return (state.currentGeoJSON?.features||[]).find(f=>String(featureId(f))===id || String(f.properties?.unit_id||'')===id) || null;
}
async function v90RenderTopologyGraph(){
  try{ clearLayer('topologyGraph'); }catch(_){ }
  state.topologyEdgeStats={year:state.year, counts:{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0}, total:0, nodes:0};
  if(!state.map || !state.currentGeoJSON || !v90TopologyVisible()) return;
  v90EnsureMetricOptions();
  v90EnsureTopologyPanes();
  const metric=v90TopologyMetricField();
  const nodes=await v90LoadTopologyNodes(state.year);
  const nodeFeatures=(nodes.features||[]).filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  const nodeIds=new Set(nodeFeatures.map(f=>String(f.properties?.unit_id || f.properties?.topology_node_id || '')));
  const vals=nodeFeatures.map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  const group=L.layerGroup();
  const edges=await v90LoadTopologyEdges(state.year);
  const edgeFeatures=(edges.features||[]).filter(e=>nodeIds.has(String(e.properties?.source_id)) && nodeIds.has(String(e.properties?.target_id)));
  const counts=edgeFeatures.reduce((acc,e)=>{
    const r=e.properties?.relation || 'unknown'; acc[r]=(acc[r]||0)+1; if(e.properties?.is_bridge) acc.bridges=(acc.bridges||0)+1; return acc;
  },{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0});
  state.topologyEdgeStats={year:state.year, counts, total:edgeFeatures.length, nodes:nodeFeatures.length};
  if(edgeFeatures.length){
    const edgeLayer=L.geoJSON({type:'FeatureCollection',features:edgeFeatures},{
      interactive:true,
      pane:'topologyEdgePane',
      style:v90EdgeStyle,
      onEachFeature:(f,l)=>{
        const p=f.properties||{};
        l.on('mouseover',e=>showHoverLater({title:`${p.source_name||'АТЕ'} — ${p.target_name||'АТЕ'}`, subtitle:'ребро топологического графа', extra:`общая граница: ${num1(p.boundary_km)} км · ${escapeHtml(v88EdgeRelationLabels()[p.relation]||p.relation||'тип связи')}${p.is_bridge?' · мостовое ребро':''}`, delay:180}, e.originalEvent));
        l.on('mousemove',e=>moveHover(e.originalEvent));
        l.on('mouseout',hideHover);
      }
    });
    group.addLayer(edgeLayer);
  }
  if(nodeFeatures.length){
    const nodeLayer=L.geoJSON({type:'FeatureCollection',features:nodeFeatures},{
      pane:'topologyNodePane',
      pointToLayer:(f,latlng)=>L.circleMarker(latlng,v90NodeStyle(f,vals,metric)),
      onEachFeature:(f,l)=>{
        const p=f.properties||{};
        l.on('mouseover',e=>showHoverLater({title:p.name||'АТЕ', subtitle:`узел графа · ${v88TopologyMetricLabels[metric]||metric}`, extra:`значение: ${v90MetricValueLabel(p[metric],metric)} · соседей: ${p.topo_degree ?? '—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'} · мостовых: ${p.topo_bridge_incident_count ?? 0}`, delay:180}, e.originalEvent));
        l.on('mousemove',e=>moveHover(e.originalEvent));
        l.on('mouseout',hideHover);
        l.on('click',e=>{ L.DomEvent.stopPropagation(e); const admin=v90FindAdminFeatureByNode(f); if(admin){ if(state.tool === 'pan') toggleSelection(admin); showFeature(admin); } });
      }
    });
    group.addLayer(nodeLayer);
  }
  state.layers.topologyGraph=group;
  group.addTo(state.map);
  try{ group.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  if(!state._v90TopologyLegendRefreshing){
    state._v90TopologyLegendRefreshing=true;
    try{ updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(_){ }
    state._v90TopologyLegendRefreshing=false;
  }
}
v88RenderTopologyGraph = v90RenderTopologyGraph;
v89RenderTopologyGraph = v90RenderTopologyGraph;

function v90TopologyMetricBins(vals, metric){
  const values=(vals||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!values.length) return [];
  const unique=[...new Set(values)];
  const intMetric=['topo_degree','topo_k_core','topo_external_degree','topo_bridge_incident_count'].includes(metric);
  const colors=activeValueRamp();
  if(intMetric && unique.length<=8){
    return unique.map((v,i)=>({from:v,to:v,color:valueColor(v,values),label:v90MetricValueLabel(v,metric),count:values.filter(x=>x===v).length}));
  }
  const min=values[0], max=values[values.length-1];
  if(min===max) return [{from:min,to:max,color:valueColor(min,values),label:v90MetricValueLabel(min,metric),count:values.length}];
  const bins=[]; const n=5;
  for(let i=0;i<n;i++){
    const a=min+(max-min)*i/n;
    const b=min+(max-min)*(i+1)/n;
    const mid=(a+b)/2;
    const count=values.filter(v=>i===n-1 ? (v>=a && v<=b) : (v>=a && v<b)).length;
    bins.push({from:a,to:b,color:valueColor(mid,values),label:`${v90MetricValueLabel(a,metric)}–${v90MetricValueLabel(b,metric)}`,count});
  }
  return bins;
}
function v90SpecialLegendRows(gj){
  const specials=[...new Set((gj.features||[]).map(f=>String(f.properties?.special_status_code||'')).filter(c=>c && c!=='normal'))];
  if(!specials.length) return '';
  return '<div class="legend-section">Особые зоны реконструкции</div>'+specials.slice(0,10).map(code=>{
    const st=specialStatusStyleMap?.[code] || {};
    return `<div class="legend-row special-status-row-v85"><span class="swatch special-hatch-v85" style="border-color:${st.color||'#8b8580'};background-color:rgba(160,150,135,.10)"></span><span>${escapeHtml(specialStatusLabel(code))}</span></div>`;
  }).join('')+'<div class="legend-scale-note-v67">Показываются на карте, но не входят в статистику, выборку и граф.</div>';
}
function v90BuildTopologyLegend(gj){
  const metric=v90TopologyMetricField();
  const vals=(gj.features||[]).filter(f=>!f.properties?.topology_excluded).map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  const bins=v90TopologyMetricBins(vals,metric);
  const labels=v88EdgeRelationLabels();
  const stats=(state.topologyEdgeStats && state.topologyEdgeStats.year===state.year) ? state.topologyEdgeStats : {counts:{},total:0,nodes:0};
  const counts=stats.counts||{};
  const edgeRows = v90EdgeStyleMode()==='uniform'
    ? `<div class="legend-row"><span class="topology-edge-uniform-v90"></span><span>рёбра графа, единый стиль</span><b>${num(stats.total||0)}</b></div>`
    : [['same_parent','topology-edge-same-v90'],['same_superparent','topology-edge-super-v90'],['cross_parent','topology-edge-cross-v90'],['unknown','topology-edge-unknown-v90']]
        .filter(([k])=>k!=='unknown' || (counts[k]||0)>0)
        .map(([k,cls])=>`<div class="legend-row"><span class="${cls}"></span><span>${escapeHtml(labels[k]||'прочие связи')}</span><b>${num(counts[k]||0)}</b></div>`).join('');
  const min=vals.length?Math.min(...vals):null, max=vals.length?Math.max(...vals):null;
  return `<b>Легенда</b>
    <div class="legend-section">Топология: ${escapeHtml(v88TopologyMetricLabels[metric]||metric)}</div>
    ${bins.map(b=>`<div class="legend-row legend-row-class-v67"><span class="swatch" style="background:${b.color}"></span><span>${escapeHtml(b.label)}</span><b>${num(b.count)}</b></div>`).join('')}
    <div class="mini-muted legend-scale-note-v67">Диапазон метрики: ${v90MetricValueLabel(min,metric)} — ${v90MetricValueLabel(max,metric)}. Число справа — количество АТЕ в классе.</div>
    <div class="legend-section">Рёбра и узлы графа</div>
    ${edgeRows}
    <div class="legend-row"><span class="topology-edge-bridge-v90"></span><span>мостовые рёбра</span><b>${num(counts.bridges||0)}</b></div>
    <div class="legend-row"><span class="topology-node-swatch-v90"></span><span>узлы АТЕ, цвет/размер = метрика</span><b>${num(stats.nodes||0)}</b></div>
    <div class="mini-muted legend-scale-note-v67">Ребро = общая граница ≥ 1 км. Спорные зоны, двоеданцы и малые города &lt; 50 км² исключены.</div>
    ${v90SpecialLegendRows(gj)}`;
}
const v90PriorUpdateLegend = updateLegend;
updateLegend = function updateLegendV90(gj, vals){
  if(v90IsTopologyMode() || v90TopologyVisible()){
    const box=$('legendBox'); if(!box || !gj){ return; }
    box.innerHTML=v90BuildTopologyLegend(gj);
    return;
  }
  v90PriorUpdateLegend(gj, vals);
};

function v90GraphStats(features){
  const source=(features && features.length) ? features : (state.currentGeoJSON?.features||[]);
  const feats=source.filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  if(!feats.length) return '';
  const avg=(field)=>feats.reduce((a,f)=>a+(Number(f.properties?.[field])||0),0)/feats.length;
  const maxBy=(field)=>[...feats].sort((a,b)=>(Number(b.properties?.[field])||0)-(Number(a.properties?.[field])||0))[0];
  const g=feats[0].properties||{};
  const topDeg=maxBy('topo_degree'), topBet=maxBy('topo_betweenness'), topCore=maxBy('topo_k_core');
  const art=Number.isFinite(Number(g.topo_graph_articulation_points)) ? Number(g.topo_graph_articulation_points) : feats.filter(f=>!!f.properties?.topo_articulation_point_computed || !!f.properties?.topo_articulation_point).length;
  const bridges=Number.isFinite(Number(g.topo_graph_bridges)) ? Number(g.topo_graph_bridges) : 0;
  return `<div class="analytics-block topology-stats-v90"><h3>Топологическая связность АТД</h3>
    <div class="metric-line"><span>узлов / рёбер графа</span><b>${num(g.topo_graph_nodes)} / ${num(g.topo_graph_edges)}</b></div>
    <div class="metric-line"><span>компонент связности</span><b>${num(g.topo_graph_components)}</b></div>
    <div class="metric-line"><span>плотность графа</span><b>${v88TopoNum(g.topo_graph_density)}</b></div>
    <div class="metric-line"><span>цикломатическое число</span><b>${num(g.topo_graph_cyclomatic)}</b></div>
    <div class="metric-line"><span>мосты / точки сочленения</span><b>${num(bridges)} / ${num(art)}</b></div>
    <div class="metric-line"><span>средняя степень</span><b>${v88TopoNum(avg('topo_degree'))}</b></div>
    <div class="metric-line"><span>средний k-core</span><b>${v88TopoNum(avg('topo_k_core'))}</b></div>
    <div class="metric-line"><span>лидер по соседям</span><b>${escapeHtml(topDeg?.properties?.name||'—')} · ${num(topDeg?.properties?.topo_degree)}</b></div>
    <div class="metric-line"><span>главный посредник</span><b>${escapeHtml(topBet?.properties?.name||'—')} · ${v88TopoNum(topBet?.properties?.topo_betweenness)}</b></div>
    <div class="metric-line"><span>макс. ядро</span><b>${escapeHtml(topCore?.properties?.name||'—')} · k=${num(topCore?.properties?.topo_k_core)}</b></div>
  </div>`;
}
v88TopologyStatsBlock = v90GraphStats;
v89GraphStats = v90GraphStats;
const v90PriorUpdateStats = updateStats;
updateStats = function updateStatsV90(features){
  v90PriorUpdateStats(features);
  const block=v90GraphStats(features);
  ['statsBox','rightStatsBox'].forEach(id=>{ const el=$(id); if(!el) return; el.querySelectorAll('.topology-stats-v88,.topology-stats-v89,.topology-stats-v90').forEach(x=>x.remove()); if(block) el.insertAdjacentHTML('beforeend', block); });
};

function v90FormatTrendValue(v,metric){
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  if(metric.includes('share') || metric.includes('density')) return n.toFixed(3).replace('.',',');
  if(['nodes','edges','components','cyclomatic','bridges','articulation_points','same_parent_edges','same_superparent_edges','cross_parent_edges'].includes(metric)) return num(n);
  return n.toFixed(2).replace('.',',');
}
const v90TrendLabels={
  nodes:'узлы', edges:'рёбра', components:'компоненты', graph_density:'плотность графа', cyclomatic:'цикломатическое число', bridges:'мосты', articulation_points:'точки сочленения', avg_degree:'средняя степень', avg_degree_centrality:'средняя degree centrality', avg_betweenness:'средняя betweenness', avg_closeness:'средняя closeness', avg_k_core:'средний k-core', avg_external_degree:'средние внешние связи', avg_external_share:'средняя доля внешних связей', same_parent_edges:'рёбра внутри родителя', same_superparent_edges:'межокружные/межобластные внутри группы', cross_parent_edges:'межгрупповые рёбра'
};
function v90TrendMetricOptions(){ return Object.keys(v90TrendLabels); }
async function v90LoadTopologyMetrics(){ return await loadJson(state.manifest?.layers?.topology_metrics || 'data/topology/topology_metrics_by_year.json'); }
async function v90OpenTopologyTrendsModal(){
  const modal=ensurePieLightbox();
  const title=modal.querySelector('#chartLightboxTitle'), body=modal.querySelector('#chartLightboxBody');
  title.textContent='Динамика топологической связности по годам';
  const data=await v90LoadTopologyMetrics();
  const years=data.map(d=>Number(d.year)).sort((a,b)=>a-b);
  const selected=new Set(state._topologyTrendYears?.length ? state._topologyTrendYears.map(Number) : years);
  const metric=state._topologyTrendMetric || 'avg_degree';
  body.innerHTML=`<div class="topology-trend-controls-v90"><label class="control-label" for="topologyTrendMetricV90">Метрика графа</label><select id="topologyTrendMetricV90">${v90TrendMetricOptions().map(k=>`<option value="${k}" ${k===metric?'selected':''}>${escapeHtml(v90TrendLabels[k])}</option>`).join('')}</select><div class="topology-trend-buttons-v88"><button type="button" id="topologyTrendAllV90">Все годы</button><button type="button" id="topologyTrendClearV90">Снять все</button><button type="button" id="topologyTrendCoreV90">Только опорные</button></div><div id="topologyTrendYearsV90" class="topology-trend-years-v88">${years.map(y=>`<label><input type="checkbox" value="${y}" ${selected.has(y)?'checked':''}>${y}</label>`).join('')}</div></div><div id="topologyTrendChartV90" class="topology-trend-chart-v88"></div><div id="topologyTrendTableV90" class="topology-trend-table-v88"></div>`;
  const sync=()=>{ state._topologyTrendMetric=$('topologyTrendMetricV90')?.value || metric; state._topologyTrendYears=[...body.querySelectorAll('#topologyTrendYearsV90 input:checked')].map(i=>Number(i.value)); v90RenderTopologyTrendChart(data); };
  $('topologyTrendMetricV90')?.addEventListener('change',sync);
  body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.addEventListener('change',sync));
  $('topologyTrendAllV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=true); sync(); });
  $('topologyTrendClearV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=false); sync(); });
  $('topologyTrendCoreV90')?.addEventListener('click',()=>{ const core=new Set([1700,1745,1783,1798,1821,1848,1876,1897,1914,1926,1939,1959,1970,1989,2021]); body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=core.has(Number(i.value))); sync(); });
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  v90RenderTopologyTrendChart(data);
}
function v90RenderTopologyTrendChart(data){
  const chart=$('topologyTrendChartV90'), table=$('topologyTrendTableV90'); if(!chart || !table) return;
  const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || 'avg_degree';
  const selectedYears=new Set((state._topologyTrendYears?.length ? state._topologyTrendYears : data.map(d=>Number(d.year))).map(Number));
  const rows=data.filter(d=>selectedYears.has(Number(d.year)) && Number.isFinite(Number(d[metric]))).sort((a,b)=>Number(a.year)-Number(b.year));
  if(rows.length<2){ chart.innerHTML='<div class="mini-muted">Выберите минимум два года для линии.</div>'; table.innerHTML=''; return; }
  const w=900,h=360,pad={l:76,r:28,t:28,b:48};
  const xs=rows.map(r=>Number(r.year)), ys=rows.map(r=>Number(r[metric]));
  const xmin=Math.min(...xs), xmax=Math.max(...xs); let ymin=Math.min(...ys), ymax=Math.max(...ys); if(ymin===ymax){ ymin-=1; ymax+=1; }
  const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
  const yScale=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const pts=rows.map(r=>`${xScale(Number(r.year)).toFixed(1)},${yScale(Number(r[metric])).toFixed(1)}`).join(' ');
  const xTicks=rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.ceil(rows.length/8)===0).map(r=>Number(r.year));
  const yTicks=[0,.25,.5,.75,1].map(t=>ymin+(ymax-ymin)*t);
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88 topology-trend-svg-v90" role="img" aria-label="Динамика ${escapeHtml(v90TrendLabels[metric]||metric)}"><rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>${yTicks.map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScale(t)}" y2="${yScale(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScale(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(v90FormatTrendValue(t,metric))}</text>`).join('')}${xTicks.map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-18}" text-anchor="middle" class="trend-label-v88">${t}</text>`).join('')}<polyline points="${pts}" fill="none" class="trend-line-v88"/>${rows.map(r=>`<circle cx="${xScale(Number(r.year))}" cy="${yScale(Number(r[metric]))}" r="5.5" class="trend-point-v88"><title>${r.year}: ${v90FormatTrendValue(r[metric],metric)}</title></circle>`).join('')}<text x="${pad.l}" y="20" class="trend-title-v88">${escapeHtml(v90TrendLabels[metric]||metric)}</text></svg>`;
  table.innerHTML='<div class="chart-legend-head topology-trend-head-v88"><span></span><span>год</span><span>значение</span><span>лидер / примечание</span></div>'+rows.map(r=>{
    const leader=metric.includes('betweenness') ? r.max_betweenness_name : metric.includes('closeness') ? r.max_closeness_name : metric.includes('k_core') ? r.max_k_core_name : r.max_degree_name;
    return `<div class="chart-legend-row topology-trend-row-v88"><span class="pie-dot"></span><span>${r.year}</span><b>${v90FormatTrendValue(r[metric],metric)}</b><em>${escapeHtml(leader||'—')}</em></div>`;
  }).join('');
}

function v90BindTopologyControls(){
  v90EnsureMetricOptions();
  const metric=$('topologyMetricSelect'); if(metric && v90IsTopologyMode()) metric.value=state.mode;
  const rerender=async()=>{ await v90RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); updateStatsAndSelection?.(); };
  const toggle=$('toggleTopologyGraph');
  if(toggle && toggle.dataset.v90Bound!=='1'){
    toggle.dataset.v90Bound='1'; toggle.addEventListener('change',e=>{ e.stopPropagation(); rerender(); }, true);
  }
  if(metric && metric.dataset.v90Bound!=='1'){
    metric.dataset.v90Bound='1'; metric.addEventListener('change',e=>{ state.topologyMetric=e.target.value; rerender(); }, true);
  }
  const edgeStyle=$('topologyEdgeStyleSelect');
  if(edgeStyle && edgeStyle.dataset.v90Bound!=='1'){
    edgeStyle.dataset.v90Bound='1'; edgeStyle.addEventListener('change',()=>rerender(), true);
  }
  const mode=$('modeSelect');
  if(mode && mode.dataset.v90TopologyBound!=='1'){
    mode.dataset.v90TopologyBound='1'; mode.addEventListener('change',()=>setTimeout(()=>{ const m=$('topologyMetricSelect'); if(m && v90IsTopologyMode()) m.value=state.mode; rerender(); },50), true);
  }
  const btn=$('openTopologyTrends');
  if(btn && btn.dataset.v90Bound!=='1'){
    btn.dataset.v90Bound='1'; btn.addEventListener('click',e=>{ e.preventDefault(); e.stopImmediatePropagation(); v90OpenTopologyTrendsModal(); }, true);
  }
}
const v90PriorRefreshAdmin = refreshAdmin;
refreshAdmin = async function refreshAdminV90(seq){
  await v90PriorRefreshAdmin(seq);
  if(isStaleRefresh(seq)) return;
  v90BindTopologyControls();
  if(v90IsTopologyMode()){ const m=$('topologyMetricSelect'); if(m) m.value=state.mode; }
  await v90RenderTopologyGraph();
};
const v90PriorRefreshVisibility = refreshVisibility;
refreshVisibility = function refreshVisibilityV90(){
  v90PriorRefreshVisibility();
  const layer=state.layers.topologyGraph;
  if(!state.map || !layer) return;
  if(v90TopologyVisible()){
    if(!state.map.hasLayer(layer)) layer.addTo(state.map);
    try{ layer.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  }else if(state.map.hasLayer(layer)) state.map.removeLayer(layer);
};
(function v90BootTopology(){
  const boot=()=>{ try{ v90BindTopologyControls(); v90RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(e){ console.warn('v90 topology boot failed', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,260),{once:true}); else setTimeout(boot,260);
})();


/* v91: fixed topology overlay visibility, edge-endpoint node alignment, cleaner legend and configurable topology trends */
try{
  v88TopologyModes.add('topo_external_degree');
  v88TopologyModes.add('topo_external_share');
  v88TopologyModes.add('topo_bridge_incident_count');
  v88TopologyMetricLabels.topo_degree='число соседей';
  v88TopologyMetricLabels.topo_degree_centrality='degree centrality';
  v88TopologyMetricLabels.topo_betweenness='посредничество';
  v88TopologyMetricLabels.topo_closeness='близость';
  v88TopologyMetricLabels.topo_k_core='ядро / периферия';
  v88TopologyMetricLabels.topo_external_degree='межгрупповые связи';
  v88TopologyMetricLabels.topo_external_share='доля межгрупповых связей';
  v88TopologyMetricLabels.topo_bridge_incident_count='мостовые связи узла';
}catch(_){ }
function v91IsTopologyMode(){ return v88TopologyModes.has(state.mode); }
function v90IsTopologyMode(){ return v91IsTopologyMode(); }
function v89IsTopologyMode(){ return v91IsTopologyMode(); }
function v88IsTopologyMode(){ return v91IsTopologyMode(); }
function v91TopologyMetricField(){
  if(v91IsTopologyMode()) return state.mode;
  const sel=$('topologyMetricSelect');
  return (sel && v88TopologyModes.has(sel.value)) ? sel.value : 'topo_degree';
}
function v90TopologyMetricField(){ return v91TopologyMetricField(); }
function v89TopologyMetricField(){ return v91TopologyMetricField(); }
function v88TopologyMetricField(){ return v91TopologyMetricField(); }
function v91TopologyVisible(){ return !!($('toggleTopologyGraph')?.checked || v91IsTopologyMode()); }
function v90TopologyVisible(){ return v91TopologyVisible(); }
function v89TopologyVisible(){ return v91TopologyVisible(); }
v88TopologyVisible = v91TopologyVisible;
function v91CleanTopologyMetricLabel(metric){ return String(v88TopologyMetricLabels?.[metric] || metric || '').replace(/^\s*Топология\s*:\s*/i,'').trim(); }
function v91EnsureTopologyPanes(){
  if(!state.map) return;
  const specs=[['topologyEdgePane',880,'auto'],['topologyNodePane',910,'auto']];
  specs.forEach(([name,z,pointerEvents])=>{
    let p=state.map.getPane(name);
    if(!p) p=state.map.createPane(name);
    p.style.zIndex=String(z);
    p.style.pointerEvents=pointerEvents;
  });
}
function v91NodeIdFromFeature(f){ return String(f?.properties?.unit_id || f?.properties?.topology_node_id || ''); }
function v91CurrentAdminPropsById(){
  const byId=new Map();
  (state.currentGeoJSON?.features||[]).forEach(f=>{
    const ids=[String(featureId(f)), String(f.properties?.unit_id||''), String(f.properties?.topology_node_id||'')].filter(Boolean);
    ids.forEach(id=>{ if(id && !byId.has(id)) byId.set(id, f.properties||{}); });
  });
  return byId;
}
function v91BuildNodeFeaturesFromEdges(nodes, edges){
  const nodeProps=new Map();
  const oldNodeGeom=new Map();
  (nodes.features||[]).forEach(f=>{
    const id=v91NodeIdFromFeature(f);
    if(!id) return;
    nodeProps.set(id, {...(f.properties||{})});
    if(f.geometry?.type==='Point' && Array.isArray(f.geometry.coordinates)) oldNodeGeom.set(id, f.geometry.coordinates);
  });
  const endpointById=new Map();
  const namesById=new Map();
  (edges.features||[]).forEach(e=>{
    const p=e.properties||{};
    const coords=e.geometry?.coordinates||[];
    if(!coords.length) return;
    const pairs=[['source_id','source_name',coords[0]],['target_id','target_name',coords[coords.length-1]]];
    pairs.forEach(([idKey,nameKey,coord])=>{
      const id=String(p[idKey]||'');
      if(!id || !Array.isArray(coord) || coord.length<2) return;
      if(!endpointById.has(id)) endpointById.set(id, [Number(coord[0]), Number(coord[1])]);
      if(p[nameKey] && !namesById.has(id)) namesById.set(id, p[nameKey]);
    });
  });
  const adminProps=v91CurrentAdminPropsById();
  const ids=new Set([...nodeProps.keys(), ...endpointById.keys()]);
  const features=[];
  ids.forEach(id=>{
    const coord=endpointById.get(id) || oldNodeGeom.get(id);
    if(!coord || !Number.isFinite(Number(coord[0])) || !Number.isFinite(Number(coord[1]))) return;
    const props={...(adminProps.get(id)||{}), ...(nodeProps.get(id)||{})};
    props.unit_id=props.unit_id || id;
    props.topology_node_id=props.topology_node_id || id;
    props.name=props.name || namesById.get(id) || id;
    props.node_lon=Number(coord[0]);
    props.node_lat=Number(coord[1]);
    props.topology_has_edges=endpointById.has(id);
    features.push({type:'Feature', properties:props, geometry:{type:'Point', coordinates:[Number(coord[0]), Number(coord[1])]}});
  });
  return {type:'FeatureCollection', features:features.sort((a,b)=>String(a.properties.name||a.properties.unit_id).localeCompare(String(b.properties.name||b.properties.unit_id),'ru'))};
}
function v91EdgeStyle(feature){
  const p=feature.properties||{};
  const km=Number(p.boundary_km)||1;
  const w=Math.max(1.8, Math.min(5.2, 1.2+Math.log1p(km)/2.05));
  const base={weight:w, opacity:.96, lineCap:'round', lineJoin:'round', pane:'topologyEdgePane', className:'topology-edge-path-v91 topology-edge-path-v90'};
  if(v90EdgeStyleMode()==='uniform') return {...base, color:p.is_bridge?'#111827':'#334155', opacity:p.is_bridge?.98:.86, dashArray:null};
  if(p.is_bridge) return {...base, color:'#111827', weight:w+1, opacity:.99, dashArray:null};
  if(p.relation==='same_parent') return {...base, color:'#1769aa', opacity:.88, dashArray:null};
  if(p.relation==='same_superparent') return {...base, color:'#7c4db2', opacity:.94, dashArray:'9 5'};
  if(p.relation==='cross_parent') return {...base, color:'#d85b12', opacity:.98, dashArray:'3 5'};
  return {...base, color:'#64748b', opacity:.82, dashArray:'4 6'};
}
function v91NodeStyle(feature, vals, metric){
  const p=feature.properties||{};
  const val=Number(p[metric]);
  const bridge=Number(p.topo_bridge_incident_count)||0;
  const hasEdges=p.topology_has_edges!==false;
  return {
    radius:v90NodeRadius(val, vals, metric),
    color: bridge>0 ? '#111827' : (hasEdges ? '#17202b' : '#596274'),
    weight: bridge>0 ? 2.8 : (hasEdges ? 1.9 : 1.5),
    fillColor:valueColor(Number.isFinite(val)?val:0, vals),
    fillOpacity:hasEdges ? .98 : .62,
    opacity:1,
    pane:'topologyNodePane',
    bubblingMouseEvents:false,
    interactive:true,
    className:'topology-node-marker-v91 topology-node-marker-v90'
  };
}
async function v91RenderTopologyGraph(){
  const token=(state._topologyRenderTokenV91||0)+1;
  state._topologyRenderTokenV91=token;
  try{ clearLayer('topologyGraph'); }catch(_){ }
  state._topologyNodeFeaturesV91=[];
  state.topologyEdgeStats={year:state.year, counts:{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0}, total:0, nodes:0};
  if(!state.map || !state.currentGeoJSON || !v91TopologyVisible()) return;
  v90EnsureMetricOptions();
  v91EnsureTopologyPanes();
  const metric=v91TopologyMetricField();
  const edges=await v90LoadTopologyEdges(state.year);
  const nodes=await v90LoadTopologyNodes(state.year);
  if(token!==state._topologyRenderTokenV91 || !v91TopologyVisible()) return;
  const nodeGJ=v91BuildNodeFeaturesFromEdges(nodes, edges);
  const nodeIds=new Set((nodeGJ.features||[]).map(v91NodeIdFromFeature).filter(Boolean));
  const edgeFeatures=(edges.features||[]).filter(e=>nodeIds.has(String(e.properties?.source_id||'')) && nodeIds.has(String(e.properties?.target_id||'')));
  const counts=edgeFeatures.reduce((acc,e)=>{
    const r=e.properties?.relation || 'unknown';
    acc[r]=(acc[r]||0)+1;
    if(e.properties?.is_bridge) acc.bridges=(acc.bridges||0)+1;
    return acc;
  },{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0});
  const nodeFeatures=(nodeGJ.features||[]).filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  const vals=nodeFeatures.map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  state._topologyNodeFeaturesV91=nodeFeatures;
  state.topologyEdgeStats={year:state.year, counts, total:edgeFeatures.length, nodes:nodeFeatures.length};
  const group=L.layerGroup();
  if(edgeFeatures.length){
    group.addLayer(L.geoJSON({type:'FeatureCollection',features:edgeFeatures},{
      interactive:true,
      pane:'topologyEdgePane',
      style:v91EdgeStyle,
      onEachFeature:(f,l)=>{
        const p=f.properties||{};
        l.on('mouseover',e=>showHoverLater({title:`${p.source_name||'АТЕ'} — ${p.target_name||'АТЕ'}`, subtitle:'ребро топологического графа', extra:`общая граница: ${num1(p.boundary_km)} км · ${escapeHtml(v88EdgeRelationLabels()[p.relation]||p.relation||'тип связи')}${p.is_bridge?' · мостовое ребро':''}`, delay:180}, e.originalEvent));
        l.on('mousemove',e=>moveHover(e.originalEvent));
        l.on('mouseout',hideHover);
      }
    }));
  }
  if(nodeFeatures.length){
    group.addLayer(L.geoJSON({type:'FeatureCollection',features:nodeFeatures},{
      pane:'topologyNodePane',
      pointToLayer:(f,latlng)=>L.circleMarker(latlng,v91NodeStyle(f,vals,metric)),
      onEachFeature:(f,l)=>{
        const p=f.properties||{};
        l.on('mouseover',e=>showHoverLater({title:p.name||'АТЕ', subtitle:`узел графа · ${v91CleanTopologyMetricLabel(metric)}`, extra:`значение: ${v90MetricValueLabel(p[metric],metric)} · соседей: ${p.topo_degree ?? '—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'} · мостовых: ${p.topo_bridge_incident_count ?? 0}`, delay:180}, e.originalEvent));
        l.on('mousemove',e=>moveHover(e.originalEvent));
        l.on('mouseout',hideHover);
        l.on('click',e=>{ L.DomEvent.stopPropagation(e); const admin=v90FindAdminFeatureByNode(f); if(admin){ if(state.tool === 'pan') toggleSelection(admin); showFeature(admin); } });
      }
    }));
  }
  if(token!==state._topologyRenderTokenV91 || !v91TopologyVisible()) return;
  state.layers.topologyGraph=group;
  group.addTo(state.map);
  try{ group.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  try{ updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(_){ }
}
v90RenderTopologyGraph = v91RenderTopologyGraph;
v89RenderTopologyGraph = v91RenderTopologyGraph;
v88RenderTopologyGraph = v91RenderTopologyGraph;
function v91BuildTopologyLegend(gj){
  const metric=v91TopologyMetricField();
  const source=(state._topologyNodeFeaturesV91&&state._topologyNodeFeaturesV91.length) ? state._topologyNodeFeaturesV91 : (gj.features||[]).filter(f=>!f.properties?.topology_excluded);
  const vals=source.map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  const bins=v90TopologyMetricBins(vals,metric);
  const labels=v88EdgeRelationLabels();
  const stats=(state.topologyEdgeStats && state.topologyEdgeStats.year===state.year) ? state.topologyEdgeStats : {counts:{},total:0,nodes:source.length};
  const counts=stats.counts||{};
  const edgeRows = v90EdgeStyleMode()==='uniform'
    ? `<div class="legend-row"><span class="topology-edge-uniform-v90"></span><span>рёбра графа, единый стиль</span><span class="legend-count-v91">${num(stats.total||0)}</span></div>`
    : [['same_parent','topology-edge-same-v90'],['same_superparent','topology-edge-super-v90'],['cross_parent','topology-edge-cross-v90'],['unknown','topology-edge-unknown-v90']]
        .filter(([k])=>k!=='unknown' || (counts[k]||0)>0)
        .map(([k,cls])=>`<div class="legend-row"><span class="${cls}"></span><span>${escapeHtml(labels[k]||'прочие связи')}</span><span class="legend-count-v91">${num(counts[k]||0)}</span></div>`).join('');
  const min=vals.length?Math.min(...vals):null, max=vals.length?Math.max(...vals):null;
  return `<div class="legend-title-v91">Легенда</div>
    <div class="legend-topology-v91">
      <div class="legend-section">Классы узлов · ${escapeHtml(v91CleanTopologyMetricLabel(metric))}</div>
      ${bins.map(b=>`<div class="legend-row legend-row-class-v67"><span class="swatch" style="background:${b.color}"></span><span>${escapeHtml(b.label)}</span><span class="legend-count-v91">${num(b.count)}</span></div>`).join('')}
      <div class="mini-muted legend-scale-note-v67">Диапазон метрики: ${v90MetricValueLabel(min,metric)} — ${v90MetricValueLabel(max,metric)}. Число справа — количество АТЕ в классе.</div>
      <div class="legend-section">Рёбра и узлы смежности</div>
      ${edgeRows}
      <div class="legend-row"><span class="topology-edge-bridge-v90"></span><span>мостовые рёбра</span><span class="legend-count-v91">${num(counts.bridges||0)}</span></div>
      <div class="legend-row"><span class="topology-node-swatch-v90"></span><span>узлы АТЕ, цвет/размер = метрика</span><span class="legend-count-v91">${num(stats.nodes||0)}</span></div>
      <div class="mini-muted legend-scale-note-v67">Ребро = общая граница ≥ 1 км. Спорные зоны, двоеданцы и малые города &lt; 50 км² исключены.</div>
    </div>
    ${v90SpecialLegendRows(gj)}`;
}
const v91PriorUpdateLegend = updateLegend;
updateLegend = function updateLegendV91(gj, vals){
  if(v91IsTopologyMode() || v91TopologyVisible()){
    const box=$('legendBox'); if(!box || !gj) return;
    box.innerHTML=v91BuildTopologyLegend(gj);
    return;
  }
  v91PriorUpdateLegend(gj, vals);
};
function v91TrendSettings(){
  return {
    scale: state._topologyTrendScale || 'linear',
    lineColor: state._topologyTrendLineColor || '#9a6a22',
    pointColor: state._topologyTrendPointColor || '#f2c14e',
    showLabels: state._topologyTrendShowLabels === true,
    labelSize: Number(state._topologyTrendLabelSize || 11)
  };
}
function v91SafeHexColor(v, fallback){ return /^#[0-9a-fA-F]{6}$/.test(String(v||'')) ? String(v) : fallback; }
async function v90OpenTopologyTrendsModal(){
  const modal=ensurePieLightbox();
  modal.classList.add('topology-trends-modal-v91');
  state.activePieField=null;
  const title=modal.querySelector('#chartLightboxTitle'), body=modal.querySelector('#chartLightboxBody');
  title.textContent='Динамика топологической связности по годам';
  const data=await v90LoadTopologyMetrics();
  const years=data.map(d=>Number(d.year)).sort((a,b)=>a-b);
  const selected=new Set(state._topologyTrendYears?.length ? state._topologyTrendYears.map(Number) : years);
  const metric=state._topologyTrendMetric || 'avg_degree';
  const cfg=v91TrendSettings();
  body.className='chart-lightbox-body topology-trends-body-v91';
  body.innerHTML=`<div class="topology-trend-layout-v91">
    <section class="topology-trend-controls-v91" aria-label="Параметры графика">
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendMetricV90">Метрика графа</label><select id="topologyTrendMetricV90">${v90TrendMetricOptions().map(k=>`<option value="${k}" ${k===metric?'selected':''}>${escapeHtml(v90TrendLabels[k])}</option>`).join('')}</select></div>
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendScaleV91">Шкала значений</label><select id="topologyTrendScaleV91"><option value="linear" ${cfg.scale==='linear'?'selected':''}>Линейная</option><option value="log" ${cfg.scale==='log'?'selected':''}>Логарифмическая log10</option></select></div>
      <div class="topology-trend-color-grid-v91"><label class="control-label" for="topologyTrendLineColorV91">Цвет линии</label><input id="topologyTrendLineColorV91" type="color" value="${v91SafeHexColor(cfg.lineColor,'#9a6a22')}"><label class="control-label" for="topologyTrendPointColorV91">Цвет точек</label><input id="topologyTrendPointColorV91" type="color" value="${v91SafeHexColor(cfg.pointColor,'#f2c14e')}"></div>
      <div class="topology-trend-label-grid-v91"><label class="compact-check"><input type="checkbox" id="topologyTrendShowLabelsV91" ${cfg.showLabels?'checked':''}> Подписывать значения над точками</label><label class="control-label" for="topologyTrendLabelSizeV91">Размер подписи: <span id="topologyTrendLabelSizeValueV91">${Number(cfg.labelSize)||11}</span> px</label><input id="topologyTrendLabelSizeV91" type="range" min="8" max="18" step="1" value="${Number(cfg.labelSize)||11}"></div>
      <div class="topology-trend-buttons-v88 topology-trend-buttons-v91"><button type="button" id="topologyTrendAllV90">Все годы</button><button type="button" id="topologyTrendClearV90">Снять все</button><button type="button" id="topologyTrendCoreV90">Только опорные</button></div>
      <div><div class="control-label topology-years-label-v91">Годы наблюдений</div><div id="topologyTrendYearsV90" class="topology-trend-years-v88 topology-trend-years-v91">${years.map(y=>`<label><input type="checkbox" value="${y}" ${selected.has(y)?'checked':''}>${y}</label>`).join('')}</div></div>
    </section>
    <section class="topology-trend-main-v91"><div id="topologyTrendChartV90" class="topology-trend-chart-v88 topology-trend-chart-v91"></div><div id="topologyTrendTableV90" class="topology-trend-table-v88 topology-trend-table-v91"></div></section>
  </div>`;
  const sync=()=>{
    state._topologyTrendMetric=$('topologyTrendMetricV90')?.value || metric;
    state._topologyTrendScale=$('topologyTrendScaleV91')?.value || 'linear';
    state._topologyTrendLineColor=v91SafeHexColor($('topologyTrendLineColorV91')?.value,'#9a6a22');
    state._topologyTrendPointColor=v91SafeHexColor($('topologyTrendPointColorV91')?.value,'#f2c14e');
    state._topologyTrendShowLabels=!!$('topologyTrendShowLabelsV91')?.checked;
    state._topologyTrendLabelSize=Number($('topologyTrendLabelSizeV91')?.value || 11);
    const labelSizeValue=$('topologyTrendLabelSizeValueV91'); if(labelSizeValue) labelSizeValue.textContent=String(state._topologyTrendLabelSize);
    state._topologyTrendYears=[...body.querySelectorAll('#topologyTrendYearsV90 input:checked')].map(i=>Number(i.value));
    v90RenderTopologyTrendChart(data);
  };
  ['topologyTrendMetricV90','topologyTrendScaleV91','topologyTrendLineColorV91','topologyTrendPointColorV91','topologyTrendShowLabelsV91','topologyTrendLabelSizeV91'].forEach(id=>$(id)?.addEventListener('input',sync));
  ['topologyTrendMetricV90','topologyTrendScaleV91'].forEach(id=>$(id)?.addEventListener('change',sync));
  body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.addEventListener('change',sync));
  $('topologyTrendAllV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=true); sync(); });
  $('topologyTrendClearV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=false); sync(); });
  $('topologyTrendCoreV90')?.addEventListener('click',()=>{ const core=new Set([1700,1745,1783,1798,1821,1848,1876,1897,1914,1926,1939,1959,1970,1989,2021]); body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=core.has(Number(i.value))); sync(); });
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  sync();
}
function v90RenderTopologyTrendChart(data){
  const chart=$('topologyTrendChartV90'), table=$('topologyTrendTableV90'); if(!chart || !table) return;
  const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || 'avg_degree';
  const cfg=v91TrendSettings();
  const lineColor=v91SafeHexColor(cfg.lineColor,'#9a6a22');
  const pointColor=v91SafeHexColor(cfg.pointColor,'#f2c14e');
  const selectedYears=new Set((state._topologyTrendYears?.length ? state._topologyTrendYears : data.map(d=>Number(d.year))).map(Number));
  const rows=data.filter(d=>selectedYears.has(Number(d.year)) && Number.isFinite(Number(d[metric]))).sort((a,b)=>Number(a.year)-Number(b.year));
  if(rows.length<2){ chart.innerHTML='<div class="mini-muted">Выберите минимум два года для линии.</div>'; table.innerHTML=''; return; }
  const w=940,h=390,pad={l:82,r:34,t:36,b:54};
  const xs=rows.map(r=>Number(r.year)), rawYs=rows.map(r=>Number(r[metric]));
  const xmin=Math.min(...xs), xmax=Math.max(...xs);
  const positives=rawYs.filter(y=>y>0);
  const useLog=cfg.scale==='log' && positives.length>0;
  const logFloor=useLog ? Math.min(...positives)/10 : null;
  const transformY=y=>useLog ? Math.log10(y>0 ? y : logFloor) : y;
  const inverseY=y=>useLog ? Math.pow(10,y) : y;
  const axisPlan=useLog ? v101NiceLogAxis(rawYs, logFloor) : v101NiceLinearAxis(rawYs, 5);
  const ys=rawYs.map(transformY);
  let ymin=axisPlan ? axisPlan.min : Math.min(...ys);
  let ymax=axisPlan ? axisPlan.max : Math.max(...ys);
  if(ymin===ymax){ ymin-=useLog?.5:1; ymax+=useLog?.5:1; }
  const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
  const yScaleRaw=y=>h-pad.b-(transformY(y)-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const yScaleTrans=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const pts=rows.map(r=>`${xScale(Number(r.year)).toFixed(1)},${yScaleRaw(Number(r[metric])).toFixed(1)}`).join(' ');
  const xTicks=rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.ceil(rows.length/9)===0).map(r=>Number(r.year));
  const yTicks=axisPlan?.ticks?.length ? axisPlan.ticks : [0,.25,.5,.75,1].map(t=>ymin+(ymax-ymin)*t);
  const labelsSvg=cfg.showLabels ? rows.map(r=>{
    const x=xScale(Number(r.year));
    const y=Math.max(pad.t+Number(cfg.labelSize||11), yScaleRaw(Number(r[metric]))-9);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="trend-point-label-v91" style="font-size:${Number(cfg.labelSize||11)}px">${escapeHtml(v90FormatTrendValue(r[metric],metric))}</text>`;
  }).join('') : '';
  const logNote=(cfg.scale==='log' && !positives.length) ? '<div class="topology-trend-note-v91">Для этой метрики нет положительных значений; показана линейная шкала.</div>' : (useLog && rawYs.some(y=>y<=0) ? '<div class="topology-trend-note-v91">Log10-шкала: нулевые значения прижаты к нижней границе, потому что логарифм нуля не определён.</div>' : '');
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88 topology-trend-svg-v90 topology-trend-svg-v91" role="img" aria-label="Динамика ${escapeHtml(v90TrendLabels[metric]||metric)}"><rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>${yTicks.map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScaleTrans(t)}" y2="${yScaleTrans(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScaleTrans(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(v90FormatTrendValue(inverseY(t),metric))}</text>`).join('')}${xTicks.map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-18}" text-anchor="middle" class="trend-label-v88">${t}</text>`).join('')}<polyline points="${pts}" fill="none" class="trend-line-v91" style="stroke:${lineColor}"/>${rows.map(r=>`<circle cx="${xScale(Number(r.year)).toFixed(1)}" cy="${yScaleRaw(Number(r[metric])).toFixed(1)}" r="5.8" class="trend-point-v91" style="fill:${pointColor}"><title>${r.year}: ${v90FormatTrendValue(r[metric],metric)}</title></circle>`).join('')}${labelsSvg}<text x="${pad.l}" y="22" class="trend-title-v88 trend-title-v91">${escapeHtml(v90TrendLabels[metric]||metric)} · ${useLog?'LOG10':'ЛИНЕЙНАЯ ШКАЛА'}</text></svg>${logNote}`;
  table.innerHTML='<div class="chart-legend-head topology-trend-head-v88 topology-trend-head-v91"><span></span><span>ГОД</span><span>ЗНАЧЕНИЕ</span><span>ЛИДЕР / ПРИМЕЧАНИЕ</span></div>'+rows.map(r=>{
    const leader=metric.includes('betweenness') ? r.max_betweenness_name : metric.includes('closeness') ? r.max_closeness_name : metric.includes('k_core') ? r.max_k_core_name : r.max_degree_name;
    return `<div class="chart-legend-row topology-trend-row-v88 topology-trend-row-v91"><span class="pie-dot" style="background:${pointColor}"></span><span>${r.year}</span><b>${v90FormatTrendValue(r[metric],metric)}</b><em>${escapeHtml(leader||'—')}</em></div>`;
  }).join('');
}
function v91BindTopologyControls(){
  v90EnsureMetricOptions();
  const metric=$('topologyMetricSelect'); if(metric && v91IsTopologyMode()) metric.value=state.mode;
  const rerender=async()=>{ await v91RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); updateStatsAndSelection?.(); };
  const toggle=$('toggleTopologyGraph');
  if(toggle && toggle.dataset.v91Bound!=='1'){
    toggle.dataset.v91Bound='1'; toggle.addEventListener('change',e=>{ e.stopPropagation(); rerender(); }, true);
  }
  if(metric && metric.dataset.v91Bound!=='1'){
    metric.dataset.v91Bound='1'; metric.addEventListener('change',e=>{ state.topologyMetric=e.target.value; rerender(); }, true);
  }
  const edgeStyle=$('topologyEdgeStyleSelect');
  if(edgeStyle && edgeStyle.dataset.v91Bound!=='1'){
    edgeStyle.dataset.v91Bound='1'; edgeStyle.addEventListener('change',()=>rerender(), true);
  }
  const btn=$('openTopologyTrends');
  if(btn && btn.dataset.v91Bound!=='1'){
    btn.dataset.v91Bound='1'; btn.addEventListener('click',e=>{ e.preventDefault(); e.stopImmediatePropagation(); v90OpenTopologyTrendsModal(); }, true);
  }
}
const v91PriorRefreshAdmin = refreshAdmin;
refreshAdmin = async function refreshAdminV91(seq){
  await v91PriorRefreshAdmin(seq);
  if(isStaleRefresh(seq)) return;
  v91BindTopologyControls();
  if(v91IsTopologyMode()){ const m=$('topologyMetricSelect'); if(m) m.value=state.mode; }
  await v91RenderTopologyGraph();
};
const v91PriorRefreshVisibility = refreshVisibility;
refreshVisibility = function refreshVisibilityV91(){
  v91PriorRefreshVisibility();
  const layer=state.layers.topologyGraph;
  if(!state.map || !layer) return;
  if(v91TopologyVisible()){
    if(!state.map.hasLayer(layer)) layer.addTo(state.map);
    try{ layer.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  }else if(state.map.hasLayer(layer)) state.map.removeLayer(layer);
};
(function v91BootTopology(){
  const boot=()=>{ try{ v91BindTopologyControls(); v91RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(e){ console.warn('v91 topology boot failed', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,320),{once:true}); else setTimeout(boot,320);
})();


/* v92: topology graph follows the visible admin layer, excludes uncertain/special objects, and uses spaced count labels */
function v92CurrentAllowedTopologyIds(){
  const ids=new Set();
  const selected=(state.selectedIds && state.selectedIds.size) ? state.selectedIds : null;
  (state.currentGeoJSON?.features||[]).forEach(f=>{
    const p=f.properties||{};
    if(p.topology_excluded) return;
    if(selected && !selected.has(featureId(f))) return;
    [featureId(f), p.unit_id, p.topology_node_id].map(x=>String(x||'')).filter(Boolean).forEach(id=>ids.add(id));
  });
  return ids;
}
function v92BuildNodeFeaturesFromEdges(nodes, edges, allowedIds){
  const nodeProps=new Map();
  const oldNodeGeom=new Map();
  (nodes.features||[]).forEach(f=>{
    const id=v91NodeIdFromFeature(f);
    if(!id || !allowedIds.has(id)) return;
    const p={...(f.properties||{})};
    if(p.topology_excluded) return;
    nodeProps.set(id,p);
    if(f.geometry?.type==='Point' && Array.isArray(f.geometry.coordinates)) oldNodeGeom.set(id,f.geometry.coordinates);
  });
  const endpointById=new Map();
  const namesById=new Map();
  (edges.features||[]).forEach(e=>{
    const p=e.properties||{};
    const coords=e.geometry?.coordinates||[];
    if(!coords.length) return;
    [['source_id','source_name',coords[0]],['target_id','target_name',coords[coords.length-1]]].forEach(([idKey,nameKey,coord])=>{
      const id=String(p[idKey]||'');
      if(!id || !allowedIds.has(id) || !Array.isArray(coord) || coord.length<2) return;
      if(!endpointById.has(id)) endpointById.set(id,[Number(coord[0]),Number(coord[1])]);
      if(p[nameKey] && !namesById.has(id)) namesById.set(id,p[nameKey]);
    });
  });
  const adminProps=v91CurrentAdminPropsById();
  const ids=new Set([...nodeProps.keys(), ...endpointById.keys()]);
  const features=[];
  ids.forEach(id=>{
    if(!allowedIds.has(id)) return;
    const coord=endpointById.get(id) || oldNodeGeom.get(id);
    if(!coord || !Number.isFinite(Number(coord[0])) || !Number.isFinite(Number(coord[1]))) return;
    const props={...(adminProps.get(id)||{}), ...(nodeProps.get(id)||{})};
    if(props.topology_excluded) return;
    props.unit_id=props.unit_id || id;
    props.topology_node_id=props.topology_node_id || id;
    props.name=props.name || namesById.get(id) || id;
    props.node_lon=Number(coord[0]);
    props.node_lat=Number(coord[1]);
    props.topology_has_edges=endpointById.has(id);
    features.push({type:'Feature', properties:props, geometry:{type:'Point', coordinates:[Number(coord[0]),Number(coord[1])]}});
  });
  return {type:'FeatureCollection', features:features.sort((a,b)=>String(a.properties.name||a.properties.unit_id).localeCompare(String(b.properties.name||b.properties.unit_id),'ru'))};
}
async function v92RenderTopologyGraph(){
  const token=(state._topologyRenderTokenV91||0)+1;
  state._topologyRenderTokenV91=token;
  try{ clearLayer('topologyGraph'); }catch(_){ }
  state._topologyNodeFeaturesV91=[];
  state._topologyNodeFeaturesV92=[];
  state.topologyEdgeStats={year:state.year, counts:{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0}, total:0, nodes:0};
  if(!state.map || !state.currentGeoJSON || !v91TopologyVisible()) return;
  v90EnsureMetricOptions();
  v91EnsureTopologyPanes();
  const metric=v91TopologyMetricField();
  const allowedIds=v92CurrentAllowedTopologyIds();
  const edgesRaw=await v90LoadTopologyEdges(state.year);
  const edgeFeaturesRaw=(edgesRaw.features||[]).filter(e=>allowedIds.has(String(e.properties?.source_id||'')) && allowedIds.has(String(e.properties?.target_id||'')));
  const edges={type:'FeatureCollection', features:edgeFeaturesRaw};
  const nodes=await v90LoadTopologyNodes(state.year);
  if(token!==state._topologyRenderTokenV91 || !v91TopologyVisible()) return;
  const nodeGJ=v92BuildNodeFeaturesFromEdges(nodes, edges, allowedIds);
  const nodeIds=new Set((nodeGJ.features||[]).map(v91NodeIdFromFeature).filter(Boolean));
  const edgeFeatures=edgeFeaturesRaw.filter(e=>nodeIds.has(String(e.properties?.source_id||'')) && nodeIds.has(String(e.properties?.target_id||'')));
  const counts=edgeFeatures.reduce((acc,e)=>{
    const r=e.properties?.relation || 'unknown';
    acc[r]=(acc[r]||0)+1;
    if(e.properties?.is_bridge) acc.bridges=(acc.bridges||0)+1;
    return acc;
  },{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0});
  const nodeFeatures=(nodeGJ.features||[]).filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  const vals=nodeFeatures.map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  state._topologyNodeFeaturesV91=nodeFeatures;
  state._topologyNodeFeaturesV92=nodeFeatures;
  state.topologyEdgeStats={year:state.year, counts, total:edgeFeatures.length, nodes:nodeFeatures.length};
  const group=L.layerGroup();
  if(edgeFeatures.length){
    group.addLayer(L.geoJSON({type:'FeatureCollection',features:edgeFeatures},{
      interactive:true,
      pane:'topologyEdgePane',
      style:v91EdgeStyle,
      onEachFeature:(f,l)=>{
        const p=f.properties||{};
        l.on('mouseover',e=>showHoverLater({title:`${p.source_name||'АТЕ'} — ${p.target_name||'АТЕ'}`, subtitle:'ребро топологического графа', extra:`общая граница: ${num1(p.boundary_km)} км · ${escapeHtml(v88EdgeRelationLabels()[p.relation]||p.relation||'тип связи')}${p.is_bridge?' · мостовое ребро':''}`, delay:180}, e.originalEvent));
        l.on('mousemove',e=>moveHover(e.originalEvent));
        l.on('mouseout',hideHover);
      }
    }));
  }
  if(nodeFeatures.length){
    group.addLayer(L.geoJSON({type:'FeatureCollection',features:nodeFeatures},{
      pane:'topologyNodePane',
      pointToLayer:(f,latlng)=>L.circleMarker(latlng,v91NodeStyle(f,vals,metric)),
      onEachFeature:(f,l)=>{
        const p=f.properties||{};
        l.on('mouseover',e=>showHoverLater({title:p.name||'АТЕ', subtitle:`узел графа · ${v91CleanTopologyMetricLabel(metric)}`, extra:`значение: ${v90MetricValueLabel(p[metric],metric)} · соседей: ${p.topo_degree ?? '—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'} · мостовых: ${p.topo_bridge_incident_count ?? 0}`, delay:180}, e.originalEvent));
        l.on('mousemove',e=>moveHover(e.originalEvent));
        l.on('mouseout',hideHover);
        l.on('click',e=>{ L.DomEvent.stopPropagation(e); const admin=v90FindAdminFeatureByNode(f); if(admin){ if(state.tool === 'pan') toggleSelection(admin); showFeature(admin); } });
      }
    }));
  }
  if(token!==state._topologyRenderTokenV91 || !v91TopologyVisible()) return;
  state.layers.topologyGraph=group;
  group.addTo(state.map);
  try{ group.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  try{ updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(_){ }
}
v91RenderTopologyGraph = v92RenderTopologyGraph;
v90RenderTopologyGraph = v92RenderTopologyGraph;
v89RenderTopologyGraph = v92RenderTopologyGraph;
v88RenderTopologyGraph = v92RenderTopologyGraph;
function v92LegendCountMarkup(count){
  return `<span class="legend-count-gap-v92" aria-hidden="true">•</span><span class="legend-count-v92">${num(count)} шт.</span>`;
}
function v92BuildTopologyLegend(gj){
  const metric=v91TopologyMetricField();
  const source=(state._topologyNodeFeaturesV92&&state._topologyNodeFeaturesV92.length) ? state._topologyNodeFeaturesV92 : (gj.features||[]).filter(f=>!f.properties?.topology_excluded);
  const vals=source.map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  const bins=v90TopologyMetricBins(vals,metric);
  const labels=v88EdgeRelationLabels();
  const stats=(state.topologyEdgeStats && state.topologyEdgeStats.year===state.year) ? state.topologyEdgeStats : {counts:{},total:0,nodes:source.length};
  const counts=stats.counts||{};
  const edgeRows = v90EdgeStyleMode()==='uniform'
    ? `<div class="legend-row legend-row-counted-v92"><span class="topology-edge-uniform-v90"></span><span>рёбра графа, единый стиль</span>${v92LegendCountMarkup(stats.total||0)}</div>`
    : [['same_parent','topology-edge-same-v90'],['same_superparent','topology-edge-super-v90'],['cross_parent','topology-edge-cross-v90'],['unknown','topology-edge-unknown-v90']]
        .filter(([k])=>k!=='unknown' || (counts[k]||0)>0)
        .map(([k,cls])=>`<div class="legend-row legend-row-counted-v92"><span class="${cls}"></span><span>${escapeHtml(labels[k]||'прочие связи')}</span>${v92LegendCountMarkup(counts[k]||0)}</div>`).join('');
  const min=vals.length?Math.min(...vals):null, max=vals.length?Math.max(...vals):null;
  return `<div class="legend-title-v91">Легенда</div>
    <div class="legend-topology-v91 legend-topology-v92">
      <div class="legend-section">Классы узлов · ${escapeHtml(v91CleanTopologyMetricLabel(metric))}</div>
      ${bins.map(b=>`<div class="legend-row legend-row-class-v67 legend-row-counted-v92"><span class="swatch" style="background:${b.color}"></span><span>${escapeHtml(b.label)}</span>${v92LegendCountMarkup(b.count)}</div>`).join('')}
      <div class="mini-muted legend-scale-note-v67">Диапазон метрики: ${v90MetricValueLabel(min,metric)} — ${v90MetricValueLabel(max,metric)}. Справа — количество АТЕ в классе, шт.</div>
      <div class="legend-section">Рёбра и узлы смежности</div>
      ${edgeRows}
      <div class="legend-row legend-row-counted-v92"><span class="topology-edge-bridge-v90"></span><span>мостовые рёбра</span>${v92LegendCountMarkup(counts.bridges||0)}</div>
      <div class="legend-row legend-row-counted-v92"><span class="topology-node-swatch-v90"></span><span>узлы АТЕ, цвет/размер = метрика</span>${v92LegendCountMarkup(stats.nodes||0)}</div>
      <div class="mini-muted legend-scale-note-v67">Ребро = общая граница ≥ 1 км. Спорные/двоеданческие/неясные территории, особые статусы и города &lt; 50 км² исключены. Граф следует текущим фильтрам основного слоя.</div>
    </div>
    ${v90SpecialLegendRows(gj)}`;
}
updateLegend = function updateLegendV92(gj, vals){
  if(v91IsTopologyMode() || v91TopologyVisible()){
    const box=$('legendBox'); if(!box || !gj) return;
    box.innerHTML=v92BuildTopologyLegend(gj);
    return;
  }
  v91PriorUpdateLegend(gj, vals);
};

const v92PriorUpdateStatsAndSelection = updateStatsAndSelection;
updateStatsAndSelection = function updateStatsAndSelectionV92(){
  v92PriorUpdateStatsAndSelection();
  if(!v91TopologyVisible()) return;
  clearTimeout(state._topologySelectionRenderTimerV92);
  state._topologySelectionRenderTimerV92=setTimeout(()=>{ try{ v92RenderTopologyGraph(); }catch(e){ console.warn('v92 topology selection refresh failed', e); } }, 30);
};
(function v92BootTopology(){
  const boot=()=>{ try{ v91BindTopologyControls(); v92RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(e){ console.warn('v92 topology boot failed', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,380),{once:true}); else setTimeout(boot,380);
})();

/* v94: visible topology graph from v94 edge/node data, separate edge/node toggles, and full multiyear metric trends */
function v93IsTopologyMode(){ return typeof v91IsTopologyMode==='function' ? v91IsTopologyMode() : (typeof v88TopologyModes!=='undefined' && v88TopologyModes.has(state.mode)); }
function v93TopologyMasterOn(){ return !!($('toggleTopologyGraph')?.checked || v93IsTopologyMode()); }
function v93TopologyEdgesOn(){ const el=$('toggleTopologyEdges'); return v93TopologyMasterOn() && (el ? !!el.checked : true); }
function v93TopologyNodesOn(){ const el=$('toggleTopologyNodes'); return v93TopologyMasterOn() && (el ? !!el.checked : true); }
function v93TopologyVisible(){ return v93TopologyMasterOn() && (v93TopologyEdgesOn() || v93TopologyNodesOn()); }
try{ v91TopologyVisible=v93TopologyVisible; v90TopologyVisible=v93TopologyVisible; v89TopologyVisible=v93TopologyVisible; v88TopologyVisible=v93TopologyVisible; }catch(_){ }
function v93CurrentAllowedTopologyIds(){
  const ids=new Set();
  const selected=(state.selectedIds && state.selectedIds.size) ? state.selectedIds : null;
  (state.currentGeoJSON?.features||[]).forEach(f=>{
    const p=f.properties||{};
    if(p.topology_excluded) return;
    if(selected && !selected.has(featureId(f))) return;
    [featureId(f), p.unit_id, p.topology_node_id].map(x=>String(x||'')).filter(Boolean).forEach(id=>ids.add(id));
  });
  return ids;
}
function v93AdminPropsById(){
  const byId=new Map();
  const selected=(state.selectedIds && state.selectedIds.size) ? state.selectedIds : null;
  (state.currentGeoJSON?.features||[]).forEach(f=>{
    const p=f.properties||{};
    if(p.topology_excluded) return;
    if(selected && !selected.has(featureId(f))) return;
    [featureId(f), p.unit_id, p.topology_node_id].map(x=>String(x||'')).filter(Boolean).forEach(id=>{ if(id && !byId.has(id)) byId.set(id,p); });
  });
  return byId;
}
function v93BuildNodeFeaturesFromEdges(nodes, edges, allowedIds){
  const nodeProps=new Map();
  const nodeGeom=new Map();
  (nodes.features||[]).forEach(f=>{
    const id=String(f?.properties?.unit_id || f?.properties?.topology_node_id || '');
    if(!id || !allowedIds.has(id)) return;
    const p={...(f.properties||{})};
    if(p.topology_excluded) return;
    nodeProps.set(id,p);
    if(f.geometry?.type==='Point' && Array.isArray(f.geometry.coordinates)) nodeGeom.set(id,[Number(f.geometry.coordinates[0]),Number(f.geometry.coordinates[1])]);
  });
  const endpointById=new Map();
  const namesById=new Map();
  (edges.features||[]).forEach(e=>{
    const p=e.properties||{};
    const coords=e.geometry?.coordinates||[];
    if(!coords.length) return;
    [['source_id','source_name',coords[0]],['target_id','target_name',coords[coords.length-1]]].forEach(([idKey,nameKey,coord])=>{
      const id=String(p[idKey]||'');
      if(!id || !allowedIds.has(id) || !Array.isArray(coord) || coord.length<2) return;
      if(!endpointById.has(id)) endpointById.set(id,[Number(coord[0]),Number(coord[1])]);
      if(p[nameKey] && !namesById.has(id)) namesById.set(id,p[nameKey]);
    });
  });
  const adminProps=v93AdminPropsById();
  const ids=new Set([...allowedIds].filter(id=>nodeProps.has(id) || endpointById.has(id) || nodeGeom.has(id)));
  const features=[];
  ids.forEach(id=>{
    const coord=endpointById.get(id) || nodeGeom.get(id);
    if(!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return;
    const props={...(adminProps.get(id)||{}), ...(nodeProps.get(id)||{})};
    if(props.topology_excluded) return;
    props.unit_id=props.unit_id || id;
    props.topology_node_id=props.topology_node_id || id;
    props.name=props.name || namesById.get(id) || id;
    props.node_lon=coord[0]; props.node_lat=coord[1]; props.topology_has_edges=endpointById.has(id);
    features.push({type:'Feature', properties:props, geometry:{type:'Point', coordinates:coord}});
  });
  return {type:'FeatureCollection', features:features.sort((a,b)=>String(a.properties.name||a.properties.unit_id).localeCompare(String(b.properties.name||b.properties.unit_id),'ru'))};
}
function v93EdgeRelationLabel(rel){ const labels=typeof v88EdgeRelationLabels==='function' ? v88EdgeRelationLabels() : {}; return labels[rel] || rel || 'тип связи'; }
function v93EdgeWeight(feature, extra=0){ const km=Number(feature?.properties?.boundary_km)||1; return Math.max(2.4, Math.min(7.2, 1.9+Math.log1p(km)/1.95)) + extra; }
function v93EdgeColor(p){
  if(p?.is_bridge) return '#111827';
  if(p?.relation==='same_parent') return '#0477bf';
  if(p?.relation==='same_superparent') return '#7c3fb4';
  if(p?.relation==='cross_parent') return '#e15400';
  return '#4b5563';
}
function v93EdgeDash(p){
  if(p?.is_bridge) return null;
  if(p?.relation==='same_superparent') return '10 5';
  if(p?.relation==='cross_parent') return '3 6';
  if(p?.relation==='unknown') return '4 6';
  return null;
}
function v93EdgeStyle(feature){
  const p=feature.properties||{};
  if(typeof v90EdgeStyleMode==='function' && v90EdgeStyleMode()==='uniform') return {color:p.is_bridge?'#111827':'#263241', weight:v93EdgeWeight(feature,0), opacity:p.is_bridge?.98:.88, dashArray:null, lineCap:'round', lineJoin:'round', className:'topology-edge-path-v93'};
  return {color:v93EdgeColor(p), weight:v93EdgeWeight(feature,0), opacity:p.is_bridge?.99:.92, dashArray:v93EdgeDash(p), lineCap:'round', lineJoin:'round', className:'topology-edge-path-v93'};
}
function v93EdgeHaloStyle(feature){ return {color:'#fff8e6', weight:v93EdgeWeight(feature,5.2), opacity:.86, dashArray:null, lineCap:'round', lineJoin:'round', interactive:false, className:'topology-edge-halo-v93'}; }
function v93NodeStyle(feature, vals, metric){
  const p=feature.properties||{};
  const val=Number(p[metric]);
  const bridge=Number(p.topo_bridge_incident_count)||0;
  const r=(typeof v90NodeRadius==='function' ? v90NodeRadius(val, vals, metric) : (5 + Math.min(10, Number(p.topo_degree)||0)));
  return {radius:Math.max(6, r), color:bridge>0?'#111827':'#fff8e6', weight:bridge>0?3.8:3.2, fillColor:valueColor(Number.isFinite(val)?val:0, vals), fillOpacity:.97, opacity:1, pane:'markerPane', bubblingMouseEvents:false, interactive:true, className:'topology-node-marker-v93'};
}
async function v93RenderTopologyGraph(){
  const token=(state._topologyRenderTokenV93||0)+1;
  state._topologyRenderTokenV93=token;
  try{ clearLayer('topologyGraph'); }catch(_){ }
  state._topologyNodeFeaturesV93=[];
  state._topologyNodeFeaturesV92=[];
  state._topologyNodeFeaturesV91=[];
  state.topologyEdgeStats={year:state.year, counts:{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0}, total:0, nodes:0};
  if(!state.map || !state.currentGeoJSON || !v93TopologyVisible()) return;
  if(typeof v90EnsureMetricOptions==='function') v90EnsureMetricOptions();
  const metric=typeof v91TopologyMetricField==='function' ? v91TopologyMetricField() : ($('topologyMetricSelect')?.value || 'topo_degree');
  const allowedIds=v93CurrentAllowedTopologyIds();
  if(!allowedIds.size) return;
  const edgesRaw=await v90LoadTopologyEdges(state.year);
  if(token!==state._topologyRenderTokenV93 || !v93TopologyVisible()) return;
  const edgeFeaturesRaw=(edgesRaw.features||[]).filter(e=>allowedIds.has(String(e.properties?.source_id||'')) && allowedIds.has(String(e.properties?.target_id||'')));
  const edges={type:'FeatureCollection', features:edgeFeaturesRaw};
  const nodes=await v90LoadTopologyNodes(state.year);
  if(token!==state._topologyRenderTokenV93 || !v93TopologyVisible()) return;
  const nodeGJ=v93BuildNodeFeaturesFromEdges(nodes, edges, allowedIds);
  const nodeIds=new Set((nodeGJ.features||[]).map(f=>String(f.properties?.unit_id || f.properties?.topology_node_id || '')).filter(Boolean));
  const edgeFeatures=edgeFeaturesRaw.filter(e=>nodeIds.has(String(e.properties?.source_id||'')) && nodeIds.has(String(e.properties?.target_id||'')));
  const counts=edgeFeatures.reduce((acc,e)=>{ const r=e.properties?.relation || 'unknown'; acc[r]=(acc[r]||0)+1; if(e.properties?.is_bridge) acc.bridges=(acc.bridges||0)+1; return acc; },{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0});
  const nodeFeatures=(nodeGJ.features||[]).filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  const vals=nodeFeatures.map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  state._topologyNodeFeaturesV93=nodeFeatures;
  state._topologyNodeFeaturesV92=nodeFeatures;
  state._topologyNodeFeaturesV91=nodeFeatures;
  state.topologyEdgeStats={year:state.year, counts, total:edgeFeatures.length, nodes:nodeFeatures.length};
  const group=L.layerGroup();
  if(v93TopologyEdgesOn() && edgeFeatures.length){
    const fc={type:'FeatureCollection',features:edgeFeatures};
    group.addLayer(L.geoJSON(fc,{interactive:false, style:v93EdgeHaloStyle}));
    group.addLayer(L.geoJSON(fc,{interactive:true, style:v93EdgeStyle, onEachFeature:(f,l)=>{
      const p=f.properties||{};
      l.on('mouseover',e=>showHoverLater({title:`${p.source_name||'АТЕ'} — ${p.target_name||'АТЕ'}`, subtitle:'ребро топологического графа', extra:`общая граница: ${num1(p.boundary_km)} км · ${escapeHtml(v93EdgeRelationLabel(p.relation))}${p.is_bridge?' · мостовое ребро':''}`, delay:160}, e.originalEvent));
      l.on('mousemove',e=>moveHover(e.originalEvent)); l.on('mouseout',hideHover);
    }}));
  }
  if(v93TopologyNodesOn() && nodeFeatures.length){
    group.addLayer(L.geoJSON({type:'FeatureCollection',features:nodeFeatures},{
      pointToLayer:(f,latlng)=>L.circleMarker(latlng,v93NodeStyle(f,vals,metric)),
      onEachFeature:(f,l)=>{
        const p=f.properties||{};
        l.on('mouseover',e=>showHoverLater({title:p.name||'АТЕ', subtitle:`узел графа · ${v91CleanTopologyMetricLabel(metric)}`, extra:`значение: ${typeof v90MetricValueLabel==='function'?v90MetricValueLabel(p[metric],metric):num1(p[metric])} · соседей: ${p.topo_degree ?? '—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'} · мостовых: ${p.topo_bridge_incident_count ?? 0}`, delay:160}, e.originalEvent));
        l.on('mousemove',e=>moveHover(e.originalEvent)); l.on('mouseout',hideHover);
        l.on('click',e=>{ L.DomEvent.stopPropagation(e); const admin=typeof v90FindAdminFeatureByNode==='function' ? v90FindAdminFeatureByNode(f) : null; if(admin){ if(state.tool === 'pan') toggleSelection(admin); showFeature(admin); } });
      }
    }));
  }
  if(token!==state._topologyRenderTokenV93 || !v93TopologyVisible()) return;
  state.layers.topologyGraph=group;
  group.addTo(state.map);
  try{ group.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  try{ updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(_){ }
}
try{ v92RenderTopologyGraph=v93RenderTopologyGraph; v91RenderTopologyGraph=v93RenderTopologyGraph; v90RenderTopologyGraph=v93RenderTopologyGraph; v89RenderTopologyGraph=v93RenderTopologyGraph; v88RenderTopologyGraph=v93RenderTopologyGraph; }catch(_){ }
function v93LegendCountMarkup(count){ return `<span class="legend-count-gap-v92" aria-hidden="true">•</span><span class="legend-count-v92">${num(count)} шт.</span>`; }
function v93BuildTopologyLegend(gj){
  const metric=typeof v91TopologyMetricField==='function' ? v91TopologyMetricField() : 'topo_degree';
  const source=(state._topologyNodeFeaturesV93&&state._topologyNodeFeaturesV93.length) ? state._topologyNodeFeaturesV93 : (gj.features||[]).filter(f=>!f.properties?.topology_excluded);
  const vals=source.map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  const bins=typeof v90TopologyMetricBins==='function' ? v90TopologyMetricBins(vals,metric) : [];
  const stats=(state.topologyEdgeStats && state.topologyEdgeStats.year===state.year) ? state.topologyEdgeStats : {counts:{},total:0,nodes:source.length};
  const counts=stats.counts||{};
  const labels=typeof v88EdgeRelationLabels==='function' ? v88EdgeRelationLabels() : {};
  const edgeRows=(typeof v90EdgeStyleMode==='function' && v90EdgeStyleMode()==='uniform')
    ? `<div class="legend-row legend-row-counted-v92"><span class="topology-edge-uniform-v90"></span><span>рёбра графа, единый стиль</span>${v93LegendCountMarkup(stats.total||0)}</div>`
    : [['same_parent','topology-edge-same-v90'],['same_superparent','topology-edge-super-v90'],['cross_parent','topology-edge-cross-v90'],['unknown','topology-edge-unknown-v90']]
      .filter(([k])=>k!=='unknown' || (counts[k]||0)>0)
      .map(([k,cls])=>`<div class="legend-row legend-row-counted-v92"><span class="${cls}"></span><span>${escapeHtml(labels[k]||'прочие связи')}</span>${v93LegendCountMarkup(counts[k]||0)}</div>`).join('');
  const min=vals.length?Math.min(...vals):null, max=vals.length?Math.max(...vals):null;
  const elementsNote=`${v93TopologyEdgesOn()?'рёбра включены':'рёбра скрыты'} · ${v93TopologyNodesOn()?'узлы включены':'узлы скрыты'}`;
  return `<div class="legend-title-v91">Легенда</div>
    <div class="legend-topology-v91 legend-topology-v92 legend-topology-v93">
      <div class="legend-section">Классы узлов · ${escapeHtml(v91CleanTopologyMetricLabel(metric))}</div>
      ${bins.map(b=>`<div class="legend-row legend-row-class-v67 legend-row-counted-v92"><span class="swatch" style="background:${b.color}"></span><span>${escapeHtml(b.label)}</span>${v93LegendCountMarkup(b.count)}</div>`).join('')}
      <div class="mini-muted legend-scale-note-v67">Диапазон метрики: ${typeof v90MetricValueLabel==='function'?v90MetricValueLabel(min,metric):num1(min)} — ${typeof v90MetricValueLabel==='function'?v90MetricValueLabel(max,metric):num1(max)}. ${escapeHtml(elementsNote)}.</div>
      <div class="legend-section">Рёбра и узлы смежности</div>
      ${edgeRows}
      <div class="legend-row legend-row-counted-v92"><span class="topology-edge-bridge-v90"></span><span>мостовые рёбра</span>${v93LegendCountMarkup(counts.bridges||0)}</div>
      <div class="legend-row legend-row-counted-v92"><span class="topology-node-swatch-v90"></span><span>узлы АТЕ, цвет/размер = метрика</span>${v93LegendCountMarkup(stats.nodes||0)}</div>
      <div class="mini-muted legend-scale-note-v67">Ребро = общая граница ≥ 1 км. Граф построен по данным v94 и отфильтрован по текущему административному слою/выборке.</div>
    </div>
    ${typeof v90SpecialLegendRows==='function' ? v90SpecialLegendRows(gj) : ''}`;
}
const v93PriorUpdateLegend = updateLegend;
updateLegend = function updateLegendV93(gj, vals){
  if((typeof v91IsTopologyMode==='function' && v91IsTopologyMode()) || v93TopologyMasterOn()){
    const box=$('legendBox'); if(!box || !gj) return;
    box.innerHTML=v93BuildTopologyLegend(gj);
    return;
  }
  v93PriorUpdateLegend(gj, vals);
};
function v93SyncTopologySubtogglesFromMaster(){
  const master=$('toggleTopologyGraph'), e=$('toggleTopologyEdges'), n=$('toggleTopologyNodes');
  if(master?.checked && e && n && !e.checked && !n.checked){ e.checked=true; n.checked=true; }
}
function v93BindTopologyControls(){
  if(typeof v90EnsureMetricOptions==='function') v90EnsureMetricOptions();
  const rerender=async()=>{ v93SyncTopologySubtogglesFromMaster(); await v93RenderTopologyGraph(); refreshVisibility(); updateLegend(state.currentGeoJSON,state._lastVals||[]); };
  ['toggleTopologyGraph','toggleTopologyEdges','toggleTopologyNodes','topologyMetricSelect','topologyEdgeStyleSelect'].forEach(id=>{
    const el=$(id); if(!el || el.dataset.v93Bound==='1') return;
    el.dataset.v93Bound='1'; el.addEventListener('change',()=>{ if(id==='topologyMetricSelect') state.topologyMetric=el.value; rerender(); }, true);
  });
  const mode=$('modeSelect');
  if(mode && mode.dataset.v93TopologyBound!=='1'){
    mode.dataset.v93TopologyBound='1'; mode.addEventListener('change',()=>setTimeout(()=>{ const m=$('topologyMetricSelect'); if(m && v93IsTopologyMode()) m.value=state.mode; rerender(); },40), true);
  }
  const btn=$('openTopologyTrends');
  if(btn && btn.dataset.v93Bound!=='1'){
    btn.dataset.v93Bound='1'; btn.textContent='Динамика метрик по годам'; btn.addEventListener('click',e=>{ e.preventDefault(); e.stopImmediatePropagation(); v93OpenMultiyearTrendsModal(); }, true);
  }
}
const v93PriorRefreshAdmin = refreshAdmin;
refreshAdmin = async function refreshAdminV93(seq){
  await v93PriorRefreshAdmin(seq);
  if(typeof isStaleRefresh==='function' && isStaleRefresh(seq)) return;
  v93BindTopologyControls();
  if(v93IsTopologyMode()){ const m=$('topologyMetricSelect'); if(m) m.value=state.mode; }
  await v93RenderTopologyGraph();
};
const v93PriorRefreshVisibility = refreshVisibility;
refreshVisibility = function refreshVisibilityV93(){
  v93PriorRefreshVisibility();
  const layer=state.layers.topologyGraph;
  if(!state.map || !layer) return;
  if(v93TopologyVisible()){
    if(!state.map.hasLayer(layer)) layer.addTo(state.map);
    try{ layer.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  }else if(state.map.hasLayer(layer)) state.map.removeLayer(layer);
};
const v93TrendGroups={
  admin:{label:'АТЕ и площадь', metrics:['ate_total_count','upper_ate_count','middle_ate_count','lower_ate_count','total_area_km2','avg_area_km2']},
  population:{label:'Население', metrics:['total_population','avg_population','population_density','urban_population','rural_population','urban_share']},
  rail:{label:'Железные дороги', metrics:['rail_length_km_total','rail_density_km_1000','rail_segments_count_sum']},
  adjacency:{label:'Соседство', metrics:['avg_adjacency']},
  topology:{label:'Граф и топология', metrics:['nodes','edges','components','graph_density','cyclomatic','bridges','articulation_points','avg_degree','avg_degree_centrality','avg_betweenness','avg_closeness','avg_k_core','avg_external_degree','avg_external_share','same_parent_edges','same_superparent_edges','cross_parent_edges']}
};
const v93TrendLabels={
  ate_total_count:'число объектов АТЕ на карте', upper_ate_count:'число АТЕ верхнего уровня', middle_ate_count:'число АТЕ среднего уровня', lower_ate_count:'число АТЕ нижнего уровня', total_area_km2:'суммарная площадь АТЕ, км²', avg_area_km2:'средняя площадь АТЕ, км²',
  total_population:'суммарное население', avg_population:'среднее население АТЕ', population_density:'плотность населения, чел./км²', urban_population:'городское / несельское население', rural_population:'сельское / прочее население', urban_share:'доля городского / несельского населения',
  rail_length_km_total:'суммарная длина ЖД, км', rail_density_km_1000:'плотность ЖД, км/1000 км²', rail_segments_count_sum:'число ЖД-сегментов в АТЕ', avg_adjacency:'среднее соседство АТЕ',
  nodes:'узлы графа', edges:'рёбра графа', components:'компоненты связности', graph_density:'плотность графа', cyclomatic:'цикломатическое число', bridges:'мосты графа', articulation_points:'точки сочленения', avg_degree:'средняя степень / число соседей', avg_degree_centrality:'средняя degree centrality', avg_betweenness:'средняя betweenness', avg_closeness:'средняя closeness', avg_k_core:'средний k-core', avg_external_degree:'средние внешние связи', avg_external_share:'средняя доля внешних связей', same_parent_edges:'рёбра внутри родителя', same_superparent_edges:'рёбра внутри вышестоящей группы', cross_parent_edges:'межродительские рёбра'
};
try{ Object.assign(v90TrendLabels, v93TrendLabels); }catch(_){ }
function v93MetricGroupFor(metric){ return Object.entries(v93TrendGroups).find(([,g])=>g.metrics.includes(metric))?.[0] || 'admin'; }
function v93TrendMetricOptions(group){ return (v93TrendGroups[group]?.metrics || v93TrendGroups.admin.metrics).filter(k=>v93TrendLabels[k]); }
async function v93LoadMultiyearMetrics(){
  if(state._multiyearMetricsV93) return state._multiyearMetricsV93;
  const path=state.manifest?.layers?.multiyear_metrics || 'data/topology/multiyear_metrics_by_year.json';
  const data=await loadJson(path);
  state._multiyearMetricsV93=Array.isArray(data)?data:[];
  return state._multiyearMetricsV93;
}
function v93FormatTrendValue(v, key){
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  if(key.includes('share')) return (n*100).toFixed(1).replace('.',',')+'%';
  if(['graph_density','avg_betweenness','avg_closeness','avg_degree_centrality'].includes(key)) return n.toFixed(3).replace('.',',');
  if(['population_density','rail_density_km_1000','avg_adjacency','avg_degree','avg_k_core','avg_external_degree'].includes(key)) return n.toFixed(2).replace('.',',');
  if(['total_area_km2','avg_area_km2','rail_length_km_total'].includes(key)) return n>=100 ? num(n) : n.toFixed(1).replace('.',',');
  if(key.includes('count') || ['nodes','edges','components','cyclomatic','bridges','articulation_points','rail_segments_count_sum'].includes(key)) return num(n);
  if(Math.abs(n)<10 && !Number.isInteger(n)) return n.toFixed(2).replace('.',',');
  return num(n);
}

/* v101/v102: rounded, publication-friendly Y-axis ticks for multiyear metrics. */
function v101CleanNumber(v){
  const n=Number(v);
  return Number.isFinite(n) ? Number(n.toPrecision(12)) : n;
}
function v101NiceRoundStep(step){
  const s=Math.abs(Number(step));
  if(!Number.isFinite(s) || s<=0) return 1;
  const pow=Math.floor(Math.log10(s));
  const base=s/Math.pow(10,pow);
  const niceBase=base<=1 ? 1 : (base<=2 ? 2 : (base<=5 ? 5 : 10));
  return niceBase*Math.pow(10,pow);
}
function v101NiceLinearAxis(values, targetTicks=5){
  const ys=(values||[]).map(Number).filter(Number.isFinite);
  if(!ys.length) return null;
  let lo=Math.min(...ys), hi=Math.max(...ys);
  if(lo===hi){
    const spread=v101NiceRoundStep(Math.max(Math.abs(lo),1)/2);
    lo-=spread; hi+=spread;
  }
  const target=Math.max(3, Math.min(7, Number(targetTicks)||5));
  let step=v101NiceRoundStep((hi-lo)/Math.max(1,target-1));
  let niceMin=Math.floor(lo/step)*step;
  let niceMax=Math.ceil(hi/step)*step;
  if(lo>=0 && niceMin<0) niceMin=0;
  let ticks=[];
  const rebuild=()=>{
    ticks=[];
    const guard=32;
    for(let i=0, v=niceMin; i<guard && v<=niceMax+step*0.5; i++, v+=step){
      ticks.push(v101CleanNumber(v));
    }
  };
  rebuild();
  while(ticks.length>7){
    step=v101NiceRoundStep(step*2.1);
    niceMin=Math.floor(lo/step)*step;
    niceMax=Math.ceil(hi/step)*step;
    if(lo>=0 && niceMin<0) niceMin=0;
    rebuild();
  }
  if(ticks.length<2){ ticks=[v101CleanNumber(niceMin), v101CleanNumber(niceMax)]; }
  return {min:v101CleanNumber(ticks[0]), max:v101CleanNumber(ticks[ticks.length-1]), ticks};
}
function v101NiceLogAxis(rawValues, logFloor){
  const vals=(rawValues||[]).map(Number).filter(Number.isFinite);
  const positives=vals.filter(v=>v>0);
  if(!positives.length) return null;
  const minPositive=Math.min(...positives);
  const minForAxis=vals.some(v=>v<=0) && Number.isFinite(Number(logFloor)) && Number(logFloor)>0 ? Math.min(minPositive, Number(logFloor)) : minPositive;
  const maxPositive=Math.max(...positives);
  let minExp=Math.floor(Math.log10(minForAxis));
  let maxExp=Math.ceil(Math.log10(maxPositive));
  if(!Number.isFinite(minExp) || !Number.isFinite(maxExp)) return null;
  if(minExp===maxExp){ minExp-=1; maxExp+=1; }
  const span=maxExp-minExp;
  const expStep=Math.max(1, Math.ceil(span/6));
  const ticks=[];
  for(let e=minExp; e<=maxExp; e+=expStep) ticks.push(e);
  if(ticks[ticks.length-1]!==maxExp) ticks.push(maxExp);
  return {min:minExp, max:maxExp, ticks};
}
function v101CompactAxisNumber(v){
  const n=Number(v);
  if(!Number.isFinite(n)) return '—';
  if(n===0) return '0';
  const abs=Math.abs(n);
  if(abs>=1000) return num(Math.round(n));
  if(Number.isInteger(n)) return String(n).replace('.',',');
  const decimals=abs>=100 ? 0 : (abs>=10 ? 1 : (abs>=1 ? 2 : Math.min(8, Math.max(2, Math.ceil(-Math.log10(abs))+1))));
  return n.toFixed(decimals).replace(/\.?0+$/,'').replace('.',',');
}
function v101FormatAxisTick(v, metric){
  const n=Number(v);
  if(!Number.isFinite(n)) return '—';
  if(String(metric||'').includes('share')) return v101CompactAxisNumber(n*100)+'%';
  return v101CompactAxisNumber(n);
}


/* v102: strict rounded ticks for the multiyear metrics chart.
   Linear axes use one significant digit steps: 1 / 2 / 5 × 10^n.
   Log axes use only powers of ten as major ticks. */
function v102NiceStepOneDigit(step){
  const s=Math.abs(Number(step));
  if(!Number.isFinite(s) || s<=0) return 1;
  const pow=Math.floor(Math.log10(s));
  const base=s/Math.pow(10,pow);
  const niceBase=base<=1 ? 1 : (base<=2 ? 2 : (base<=5 ? 5 : 10));
  return niceBase*Math.pow(10,pow);
}
function v102DecimalsForStep(step){
  const s=Math.abs(Number(step));
  if(!Number.isFinite(s) || s<=0 || s>=1) return 0;
  return Math.min(8, Math.max(0, -Math.floor(Math.log10(s))));
}
function v102CleanAxisNumber(v){
  const n=Number(v);
  if(!Number.isFinite(n)) return n;
  return Number(n.toPrecision(14));
}
function v102TrimFixedText(txt){
  const s=String(txt);
  return s.includes('.') ? s.replace(/\.?0+$/,'') : s;
}
function v102NiceLinearAxis(values, targetTicks=5){
  const ys=(values||[]).map(Number).filter(Number.isFinite);
  if(!ys.length) return null;
  let lo=Math.min(...ys), hi=Math.max(...ys);
  if(lo===hi){
    const spread=v102NiceStepOneDigit(Math.max(Math.abs(lo),1)/2);
    lo-=spread; hi+=spread;
  }
  const target=Math.max(3, Math.min(6, Number(targetTicks)||5));
  let step=v102NiceStepOneDigit((hi-lo)/Math.max(1,target-1));
  let niceMin=Math.floor(lo/step)*step;
  let niceMax=Math.ceil(hi/step)*step;
  if(lo>=0 && niceMin<0) niceMin=0;
  let ticks=[];
  const rebuild=()=>{
    ticks=[];
    const guard=64;
    for(let i=0, v=niceMin; i<guard && v<=niceMax+step*0.25; i++, v+=step){
      ticks.push(v102CleanAxisNumber(v));
    }
  };
  rebuild();
  while(ticks.length>7){
    step=v102NiceStepOneDigit(step*2.01);
    niceMin=Math.floor(lo/step)*step;
    niceMax=Math.ceil(hi/step)*step;
    if(lo>=0 && niceMin<0) niceMin=0;
    rebuild();
  }
  if(ticks.length<2){
    ticks=[v102CleanAxisNumber(niceMin), v102CleanAxisNumber(niceMax)];
  }
  return {min:v102CleanAxisNumber(ticks[0]), max:v102CleanAxisNumber(ticks[ticks.length-1]), ticks, step:v102CleanAxisNumber(step)};
}
function v102NiceLogAxis(rawValues, logFloor){
  const vals=(rawValues||[]).map(Number).filter(Number.isFinite);
  const positives=vals.filter(v=>v>0);
  if(!positives.length) return null;
  const minPositive=Math.min(...positives);
  const maxPositive=Math.max(...positives);
  const floorValue=vals.some(v=>v<=0) && Number.isFinite(Number(logFloor)) && Number(logFloor)>0 ? Number(logFloor) : minPositive;
  let minExp=Math.floor(Math.log10(Math.min(minPositive, floorValue)));
  let maxExp=Math.ceil(Math.log10(maxPositive));
  if(!Number.isFinite(minExp) || !Number.isFinite(maxExp)) return null;
  if(minExp===maxExp){ minExp-=1; maxExp+=1; }
  const span=maxExp-minExp;
  const expStep=Math.max(1, Math.ceil(span/6));
  const ticks=[];
  for(let e=minExp; e<=maxExp; e+=expStep) ticks.push(e);
  if(ticks[ticks.length-1]!==maxExp) ticks.push(maxExp);
  return {min:minExp, max:maxExp, ticks, step:expStep};
}
function v102FormatOneDigitValue(v, metric, step, isLogTick=false){
  const n=Number(v);
  if(!Number.isFinite(n)) return '—';
  const isShare=String(metric||'').includes('share');
  const value=isShare ? n*100 : n;
  const unit=isShare ? '%' : '';
  if(value===0) return '0'+unit;
  const abs=Math.abs(value);
  if(isLogTick){
    if(abs>=1) return num(Math.round(value))+unit;
    const decimals=Math.min(12, Math.max(1, Math.ceil(-Math.log10(abs))));
    return v102TrimFixedText(value.toFixed(decimals)).replace('.',',')+unit;
  }
  const scaledStep=isShare ? Math.abs(Number(step))*100 : Math.abs(Number(step));
  const decimals=v102DecimalsForStep(scaledStep || value);
  if(abs>=1000 && decimals===0) return num(Math.round(value))+unit;
  return v102TrimFixedText(value.toFixed(decimals)).replace('.',',')+unit;
}
function v102FormatAxisTick(t, metric, axisPlan, useLog){
  return v102FormatOneDigitValue(t, metric, axisPlan?.step, !!useLog);
}
function v93TrendLeader(row, metric){
  if(metric.includes('betweenness')) return row.max_betweenness_name || '—';
  if(metric.includes('closeness')) return row.max_closeness_name || '—';
  if(metric.includes('k_core')) return row.max_k_core_name || '—';
  if(metric==='nodes' || metric==='edges' || metric.includes('degree')) return row.max_degree_name || `аналитических АТЕ: ${num(row.analytics_features)}`;
  if(metric.startsWith('rail_')) return row.rail_length_km_total>0 ? `ЖД всего: ${v93FormatTrendValue(row.rail_length_km_total,'rail_length_km_total')} км` : 'ЖД нет / нет данных';
  if(metric.includes('population') || metric.includes('urban') || metric.includes('rural')) return row.total_population ? `население всего: ${v93FormatTrendValue(row.total_population,'total_population')}` : 'нет данных по населению';
  if(metric.includes('area')) return row.total_area_km2 ? `площадь всего: ${v93FormatTrendValue(row.total_area_km2,'total_area_km2')} км²` : 'нет данных по площади';
  return `аналитических АТЕ: ${num(row.analytics_features)}`;
}
function v93TrendSettings(){ return typeof v91TrendSettings==='function' ? v91TrendSettings() : {scale:'linear', lineColor:'#9a6a22', pointColor:'#f2c14e', showLabels:false, labelSize:11}; }
function v93SafeHexColor(v,fallback){ return typeof v91SafeHexColor==='function' ? v91SafeHexColor(v,fallback) : (/^#[0-9a-fA-F]{6}$/.test(String(v||'')) ? String(v) : fallback); }
async function v93OpenMultiyearTrendsModal(){
  const modal=ensurePieLightbox();
  modal.classList.add('topology-trends-modal-v91','multiyear-trends-modal-v93');
  state.activePieField=null;
  const title=modal.querySelector('#chartLightboxTitle'), body=modal.querySelector('#chartLightboxBody');
  if(title) title.textContent='Динамика метрик по годам';
  const data=await v93LoadMultiyearMetrics();
  const years=data.map(d=>Number(d.year)).filter(Number.isFinite).sort((a,b)=>a-b);
  let metric=state._topologyTrendMetric || 'ate_total_count';
  let group=state._topologyTrendGroup || v93MetricGroupFor(metric);
  if(!v93TrendMetricOptions(group).includes(metric)) metric=v93TrendMetricOptions(group)[0];
  const selected=new Set(state._topologyTrendYears?.length ? state._topologyTrendYears.map(Number) : years);
  const cfg=v93TrendSettings();
  body.className='chart-lightbox-body topology-trends-body-v91 multiyear-trends-body-v93';
  const metricSelectHtml=()=>v93TrendMetricOptions(group).map(k=>`<option value="${k}" ${k===metric?'selected':''}>${escapeHtml(v93TrendLabels[k])}</option>`).join('');
  body.innerHTML=`<div class="topology-trend-layout-v91 multiyear-trend-layout-v93">
    <section class="topology-trend-controls-v91" aria-label="Параметры графика">
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendGroupV93">Группа показателей</label><select id="topologyTrendGroupV93">${Object.entries(v93TrendGroups).map(([k,g])=>`<option value="${k}" ${k===group?'selected':''}>${escapeHtml(g.label)}</option>`).join('')}</select></div>
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendMetricV90">Метрика</label><select id="topologyTrendMetricV90">${metricSelectHtml()}</select></div>
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendScaleV91">Шкала значений</label><select id="topologyTrendScaleV91"><option value="linear" ${cfg.scale==='linear'?'selected':''}>Линейная</option><option value="log" ${cfg.scale==='log'?'selected':''}>Логарифмическая log10</option></select></div>
      <div class="topology-trend-color-grid-v91"><label class="control-label" for="topologyTrendLineColorV91">Цвет линии</label><input id="topologyTrendLineColorV91" type="color" value="${v93SafeHexColor(cfg.lineColor,'#9a6a22')}"><label class="control-label" for="topologyTrendPointColorV91">Цвет точек</label><input id="topologyTrendPointColorV91" type="color" value="${v93SafeHexColor(cfg.pointColor,'#f2c14e')}"></div>
      <div class="topology-trend-label-grid-v91"><label class="compact-check"><input type="checkbox" id="topologyTrendShowLabelsV91" ${cfg.showLabels?'checked':''}> Подписывать значения над точками</label><label class="control-label" for="topologyTrendLabelSizeV91">Размер подписи: <span id="topologyTrendLabelSizeValueV91">${Number(cfg.labelSize)||11}</span> px</label><input id="topologyTrendLabelSizeV91" type="range" min="8" max="18" step="1" value="${Number(cfg.labelSize)||11}"></div>
      <div class="topology-trend-buttons-v88 topology-trend-buttons-v91"><button type="button" id="topologyTrendAllV90">Все годы</button><button type="button" id="topologyTrendClearV90">Снять все</button><button type="button" id="topologyTrendCoreV90">Только опорные</button></div>
      <div><div class="control-label topology-years-label-v91">Годы наблюдений</div><div id="topologyTrendYearsV90" class="topology-trend-years-v88 topology-trend-years-v91">${years.map(y=>`<label><input type="checkbox" value="${y}" ${selected.has(y)?'checked':''}>${y}</label>`).join('')}</div></div>
      <div class="mini-muted">Сводные показатели рассчитаны по административным GeoJSON слоям. Население в динамике v103/v104 считается по всем аналитическим объектам слоя, включая малые городские полигоны; для 1926, 1930 и 2021 применены ручные исключения статистического охвата v104; графовые метрики — по отфильтрованным топологическим узлам/рёбрам v94.</div>
    </section>
    <section class="topology-trend-main-v91"><div id="topologyTrendChartV90" class="topology-trend-chart-v88 topology-trend-chart-v91"></div><div id="topologyTrendTableV90" class="topology-trend-table-v88 topology-trend-table-v91"></div></section>
  </div>`;
  const sync=()=>{
    group=$('topologyTrendGroupV93')?.value || group;
    const metricSelect=$('topologyTrendMetricV90');
    if(metricSelect && !v93TrendMetricOptions(group).includes(metricSelect.value)){
      metricSelect.innerHTML=v93TrendMetricOptions(group).map(k=>`<option value="${k}">${escapeHtml(v93TrendLabels[k])}</option>`).join('');
      metricSelect.value=v93TrendMetricOptions(group)[0];
    }
    state._topologyTrendGroup=group;
    state._topologyTrendMetric=metricSelect?.value || v93TrendMetricOptions(group)[0];
    state._topologyTrendScale=$('topologyTrendScaleV91')?.value || 'linear';
    state._topologyTrendLineColor=v93SafeHexColor($('topologyTrendLineColorV91')?.value,'#9a6a22');
    state._topologyTrendPointColor=v93SafeHexColor($('topologyTrendPointColorV91')?.value,'#f2c14e');
    state._topologyTrendShowLabels=!!$('topologyTrendShowLabelsV91')?.checked;
    state._topologyTrendLabelSize=Number($('topologyTrendLabelSizeV91')?.value || 11);
    const labelSizeValue=$('topologyTrendLabelSizeValueV91'); if(labelSizeValue) labelSizeValue.textContent=String(state._topologyTrendLabelSize);
    state._topologyTrendYears=[...body.querySelectorAll('#topologyTrendYearsV90 input:checked')].map(i=>Number(i.value));
    v93RenderMultiyearTrendChart(data);
  };
  $('topologyTrendGroupV93')?.addEventListener('change',()=>{ const ms=$('topologyTrendMetricV90'); const g=$('topologyTrendGroupV93')?.value || 'admin'; if(ms){ ms.innerHTML=v93TrendMetricOptions(g).map(k=>`<option value="${k}">${escapeHtml(v93TrendLabels[k])}</option>`).join(''); ms.value=v93TrendMetricOptions(g)[0]; } sync(); });
  ['topologyTrendMetricV90','topologyTrendScaleV91','topologyTrendLineColorV91','topologyTrendPointColorV91','topologyTrendShowLabelsV91','topologyTrendLabelSizeV91'].forEach(id=>$(id)?.addEventListener('input',sync));
  ['topologyTrendMetricV90','topologyTrendScaleV91'].forEach(id=>$(id)?.addEventListener('change',sync));
  body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.addEventListener('change',sync));
  $('topologyTrendAllV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=true); sync(); });
  $('topologyTrendClearV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=false); sync(); });
  $('topologyTrendCoreV90')?.addEventListener('click',()=>{ const core=new Set([1700,1745,1783,1798,1821,1848,1876,1897,1914,1926,1939,1959,1970,1989,2021]); body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=core.has(Number(i.value))); sync(); });
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  sync();
}
function v93RenderMultiyearTrendChart(data){
  const chart=$('topologyTrendChartV90'), table=$('topologyTrendTableV90'); if(!chart || !table) return;
  const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || 'ate_total_count';
  const cfg=v93TrendSettings();
  const lineColor=v93SafeHexColor(cfg.lineColor,'#9a6a22');
  const pointColor=v93SafeHexColor(cfg.pointColor,'#f2c14e');
  const selectedYears=new Set((state._topologyTrendYears?.length ? state._topologyTrendYears : data.map(d=>Number(d.year))).map(Number));
  const rows=data.filter(d=>selectedYears.has(Number(d.year)) && Number.isFinite(Number(d[metric]))).sort((a,b)=>Number(a.year)-Number(b.year));
  if(rows.length<2){ chart.innerHTML='<div class="mini-muted">Для этой метрики выберите минимум два года с числовыми данными.</div>'; table.innerHTML=''; return; }
  const w=940,h=390,pad={l:88,r:34,t:36,b:54};
  const xs=rows.map(r=>Number(r.year)), rawYs=rows.map(r=>Number(r[metric]));
  const xmin=Math.min(...xs), xmax=Math.max(...xs);
  const positives=rawYs.filter(y=>y>0);
  const useLog=cfg.scale==='log' && positives.length>0;
  const logFloor=useLog ? Math.min(...positives)/10 : null;
  const transformY=y=>useLog ? Math.log10(y>0 ? y : logFloor) : y;
  const inverseY=y=>useLog ? Math.pow(10,y) : y;
  const axisPlan=useLog ? v102NiceLogAxis(rawYs, logFloor) : v102NiceLinearAxis(rawYs, 5);
  const ys=rawYs.map(transformY);
  let ymin=axisPlan ? axisPlan.min : Math.min(...ys), ymax=axisPlan ? axisPlan.max : Math.max(...ys);
  if(ymin===ymax){ ymin-=useLog?.5:1; ymax+=useLog?.5:1; }
  const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
  const yScaleRaw=y=>h-pad.b-(transformY(y)-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const yScaleTrans=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const pts=rows.map(r=>`${xScale(Number(r.year)).toFixed(1)},${yScaleRaw(Number(r[metric])).toFixed(1)}`).join(' ');
  const xTicks=rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.ceil(rows.length/9)===0).map(r=>Number(r.year));
  const yTicks=axisPlan?.ticks?.length ? axisPlan.ticks : [0,.25,.5,.75,1].map(t=>ymin+(ymax-ymin)*t);
  const labelsSvg=cfg.showLabels ? rows.map(r=>{ const x=xScale(Number(r.year)); const y=Math.max(pad.t+Number(cfg.labelSize||11), yScaleRaw(Number(r[metric]))-9); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="trend-point-label-v91" style="font-size:${Number(cfg.labelSize||11)}px">${escapeHtml(v93FormatTrendValue(r[metric],metric))}</text>`; }).join('') : '';
  const logNote=(cfg.scale==='log' && !positives.length) ? '<div class="topology-trend-note-v91">Для этой метрики нет положительных значений; показана линейная шкала.</div>' : (useLog && rawYs.some(y=>y<=0) ? '<div class="topology-trend-note-v91">Log10-шкала: нулевые значения прижаты к нижней границе.</div>' : '');
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88 topology-trend-svg-v90 topology-trend-svg-v91" role="img" aria-label="Динамика ${escapeHtml(v93TrendLabels[metric]||metric)}"><rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>${yTicks.map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScaleTrans(t)}" y2="${yScaleTrans(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScaleTrans(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(v102FormatAxisTick(inverseY(t),metric,axisPlan,useLog))}</text>`).join('')}${xTicks.map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-18}" text-anchor="middle" class="trend-label-v88">${t}</text>`).join('')}<polyline points="${pts}" fill="none" class="trend-line-v91" style="stroke:${lineColor}"/>${rows.map(r=>`<circle cx="${xScale(Number(r.year)).toFixed(1)}" cy="${yScaleRaw(Number(r[metric])).toFixed(1)}" r="5.8" class="trend-point-v91" style="fill:${pointColor}"><title>${r.year}: ${v93FormatTrendValue(r[metric],metric)}</title></circle>`).join('')}${labelsSvg}<text x="${pad.l}" y="22" class="trend-title-v88 trend-title-v91">${escapeHtml(v93TrendLabels[metric]||metric)} · ${useLog?'LOG10':'ЛИНЕЙНАЯ ШКАЛА'}</text></svg>${logNote}`;
  table.innerHTML='<div class="chart-legend-head topology-trend-head-v88 topology-trend-head-v91"><span></span><span>ГОД</span><span>ЗНАЧЕНИЕ</span><span>ЛИДЕР / ПРИМЕЧАНИЕ</span></div>'+rows.map(r=>`<div class="chart-legend-row topology-trend-row-v88 topology-trend-row-v91"><span class="pie-dot" style="background:${pointColor}"></span><span>${r.year}</span><b>${v93FormatTrendValue(r[metric],metric)}</b><em>${escapeHtml(v93TrendLeader(r,metric))}</em></div>`).join('');
}
try{ v90OpenTopologyTrendsModal=v93OpenMultiyearTrendsModal; openTopologyTrendsModal=v93OpenMultiyearTrendsModal; }catch(_){ }
(function v93Boot(){
  const boot=()=>{ try{ v93BindTopologyControls(); v93RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(e){ console.warn('v93 boot failed', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,460),{once:true}); else setTimeout(boot,460);
})();


/* v95: topology nodes as independent HTML centroid markers.
   This bypasses the old SVG circleMarker node renderer: node positions are rebuilt
   from the currently visible administrative polygons and rendered as Leaflet DivIcon markers. */
function v95FeatureIds(feature){
  const p=feature?.properties||{};
  return [typeof featureId==='function' ? featureId(feature) : null, p.unit_id, p.topology_node_id]
    .map(x=>String(x||'')).filter(Boolean);
}
function v95FeatureMatchesId(feature, id){
  const s=String(id||'');
  return !!s && v95FeatureIds(feature).includes(s);
}
function v95RingCentroid(ring){
  if(!Array.isArray(ring) || ring.length<3) return null;
  let area=0, cx=0, cy=0;
  for(let i=0;i<ring.length-1;i++){
    const a=ring[i], b=ring[i+1];
    if(!Array.isArray(a) || !Array.isArray(b)) continue;
    const x0=Number(a[0]), y0=Number(a[1]), x1=Number(b[0]), y1=Number(b[1]);
    if(!Number.isFinite(x0)||!Number.isFinite(y0)||!Number.isFinite(x1)||!Number.isFinite(y1)) continue;
    const cross=x0*y1-x1*y0;
    area+=cross; cx+=(x0+x1)*cross; cy+=(y0+y1)*cross;
  }
  if(Math.abs(area)<1e-12) return null;
  area*=0.5;
  return {x:cx/(6*area), y:cy/(6*area), area};
}
function v95AverageCoordinate(feature){
  const pts=[];
  const walk=(obj)=>{
    if(!Array.isArray(obj)) return;
    if(obj.length>=2 && Number.isFinite(Number(obj[0])) && Number.isFinite(Number(obj[1]))){ pts.push([Number(obj[0]),Number(obj[1])]); return; }
    obj.forEach(walk);
  };
  walk(feature?.geometry?.coordinates);
  if(!pts.length) return null;
  const sx=pts.reduce((a,p)=>a+p[0],0), sy=pts.reduce((a,p)=>a+p[1],0);
  return [sx/pts.length, sy/pts.length];
}
function v95AdminCentroid(feature){
  const g=feature?.geometry;
  if(!g) return null;
  if(g.type==='Point' && Array.isArray(g.coordinates)){
    const x=Number(g.coordinates[0]), y=Number(g.coordinates[1]);
    return Number.isFinite(x)&&Number.isFinite(y) ? [x,y] : null;
  }
  const rings=[];
  if(g.type==='Polygon') rings.push(...(g.coordinates||[]).slice(0,1));
  if(g.type==='MultiPolygon') (g.coordinates||[]).forEach(poly=>{ if(Array.isArray(poly?.[0])) rings.push(poly[0]); });
  let sumArea=0, sx=0, sy=0;
  rings.forEach(r=>{
    const c=v95RingCentroid(r);
    if(!c) return;
    const w=Math.abs(c.area);
    sumArea+=w; sx+=c.x*w; sy+=c.y*w;
  });
  if(sumArea>1e-12) return [sx/sumArea, sy/sumArea];
  try{
    const id=typeof featureId==='function' ? featureId(feature) : null;
    const layer=id && state.adminLayerById ? state.adminLayerById.get(id) : null;
    const center=layer?.getBounds?.().getCenter?.();
    if(center && Number.isFinite(center.lng) && Number.isFinite(center.lat)) return [center.lng, center.lat];
  }catch(_){ }
  return v95AverageCoordinate(feature);
}
function v95AdminFeatureByIdMap(){
  const byId=new Map();
  const selected=(state.selectedIds && state.selectedIds.size) ? state.selectedIds : null;
  (state.currentGeoJSON?.features||[]).forEach(f=>{
    const p=f.properties||{};
    if(p.topology_excluded) return;
    if(selected && !selected.has(featureId(f))) return;
    const area=Number(p.area_km2);
    if(Number.isFinite(area) && area>0 && area<50) return;
    v95FeatureIds(f).forEach(id=>{ if(id && !byId.has(id)) byId.set(id, f); });
  });
  return byId;
}
function v95BuildCentroidNodes(nodes, edges, allowedIds){
  const adminById=v95AdminFeatureByIdMap();
  const nodeProps=new Map();
  const edgeNames=new Map();
  const incidentCounts=new Map();
  const ids=new Set();
  (nodes.features||[]).forEach(f=>{
    const id=String(f?.properties?.unit_id || f?.properties?.topology_node_id || '');
    if(!id || !allowedIds.has(id) || !adminById.has(id)) return;
    const p={...(f.properties||{})};
    if(p.topology_excluded) return;
    nodeProps.set(id,p); ids.add(id);
  });
  (edges.features||[]).forEach(e=>{
    const p=e.properties||{};
    [['source_id','source_name'],['target_id','target_name']].forEach(([idKey,nameKey])=>{
      const id=String(p[idKey]||'');
      if(!id || !allowedIds.has(id) || !adminById.has(id)) return;
      ids.add(id);
      incidentCounts.set(id,(incidentCounts.get(id)||0)+1);
      if(p[nameKey] && !edgeNames.has(id)) edgeNames.set(id,p[nameKey]);
    });
  });
  const features=[];
  ids.forEach(id=>{
    const admin=adminById.get(id);
    if(!admin) return;
    const coord=v95AdminCentroid(admin);
    if(!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return;
    const ap=admin.properties||{};
    const np=nodeProps.get(id)||{};
    const props={...ap, ...np};
    if(props.topology_excluded) return;
    props.unit_id=props.unit_id || id;
    props.topology_node_id=props.topology_node_id || id;
    props.name=props.name || ap.name || edgeNames.get(id) || id;
    if(!Number.isFinite(Number(props.topo_degree))) props.topo_degree=incidentCounts.get(id)||0;
    props.node_lon=coord[0]; props.node_lat=coord[1];
    props.topology_has_edges=(incidentCounts.get(id)||0)>0;
    props.topology_node_renderer='html_centroid_v95';
    props._admin_feature_id=typeof featureId==='function' ? featureId(admin) : id;
    features.push({type:'Feature', properties:props, geometry:{type:'Point', coordinates:coord}});
  });
  return {type:'FeatureCollection', features:features.sort((a,b)=>String(a.properties.name||a.properties.unit_id).localeCompare(String(b.properties.name||b.properties.unit_id),'ru'))};
}
function v95FindAdminFeatureForNode(nodeFeature){
  const p=nodeFeature?.properties||{};
  const direct=String(p._admin_feature_id||'');
  if(direct){
    const found=(state.currentGeoJSON?.features||[]).find(f=>String(featureId(f))===direct);
    if(found) return found;
  }
  const id=String(p.unit_id || p.topology_node_id || '');
  return (state.currentGeoJSON?.features||[]).find(f=>v95FeatureMatchesId(f,id)) || null;
}
function v95NodeRadius(feature, vals, metric){
  const p=feature.properties||{};
  const val=Number(p[metric]);
  const base=(typeof v90NodeRadius==='function') ? v90NodeRadius(val, vals, metric) : (6 + Math.min(14, Number(p.topo_degree)||0));
  return Math.max(13, Math.min(34, base*1.45));
}
function v95NodeFill(feature, vals, metric){
  const val=Number(feature?.properties?.[metric]);
  try{ return valueColor(Number.isFinite(val)?val:0, vals); }catch(_){ return '#f2c14e'; }
}
function v95NodeHtml(feature, vals, metric){
  const p=feature.properties||{};
  const size=v95NodeRadius(feature, vals, metric);
  const fill=v95NodeFill(feature, vals, metric);
  const bridge=(Number(p.topo_bridge_incident_count)||0)>0;
  const degree=Number.isFinite(Number(p.topo_degree)) ? Number(p.topo_degree) : '';
  const cls=bridge ? 'topology-node-dot-v95 bridge' : 'topology-node-dot-v95';
  return `<span class="${cls}" style="--node-size:${size}px;--node-fill:${fill};" data-degree="${degree}"></span>`;
}
function v95MakeNodeMarker(feature, vals, metric){
  const c=feature.geometry?.coordinates||[];
  const lat=Number(c[1]), lng=Number(c[0]);
  const size=v95NodeRadius(feature, vals, metric);
  const iconSize=Math.round(size+16);
  const marker=L.marker([lat,lng],{
    pane:'markerPane',
    interactive:true,
    keyboard:false,
    riseOnHover:true,
    zIndexOffset:2600,
    icon:L.divIcon({
      className:'topology-node-html-icon-v95',
      html:v95NodeHtml(feature, vals, metric),
      iconSize:[iconSize,iconSize],
      iconAnchor:[iconSize/2,iconSize/2]
    })
  });
  marker.feature=feature;
  const p=feature.properties||{};
  marker.on('mouseover',e=>showHoverLater({title:p.name||'АТЕ', subtitle:`узел графа · ${typeof v91CleanTopologyMetricLabel==='function'?v91CleanTopologyMetricLabel(metric):metric} · HTML-центроид`, extra:`значение: ${typeof v90MetricValueLabel==='function'?v90MetricValueLabel(p[metric],metric):num1(p[metric])} · соседей: ${p.topo_degree ?? '—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'} · мостовых: ${p.topo_bridge_incident_count ?? 0}`, delay:120}, e.originalEvent));
  marker.on('mousemove',e=>moveHover(e.originalEvent));
  marker.on('mouseout',hideHover);
  marker.on('click',e=>{ L.DomEvent.stopPropagation(e); const admin=v95FindAdminFeatureForNode(feature); if(admin){ if(state.tool==='pan') toggleSelection(admin); showFeature(admin); } });
  return marker;
}
async function v95RenderTopologyGraph(){
  const token=(state._topologyRenderTokenV95||0)+1;
  state._topologyRenderTokenV95=token;
  try{ clearLayer('topologyGraph'); }catch(_){ }
  state._topologyNodeFeaturesV95=[];
  state._topologyNodeFeaturesV93=[]; state._topologyNodeFeaturesV92=[]; state._topologyNodeFeaturesV91=[];
  state.topologyEdgeStats={year:state.year, counts:{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0}, total:0, nodes:0, renderer:'html_centroid_v95'};
  if(!state.map || !state.currentGeoJSON || !v93TopologyVisible()) return;
  if(typeof v90EnsureMetricOptions==='function') v90EnsureMetricOptions();
  const metric=typeof v91TopologyMetricField==='function' ? v91TopologyMetricField() : ($('topologyMetricSelect')?.value || 'topo_degree');
  const allowedIds=typeof v93CurrentAllowedTopologyIds==='function' ? v93CurrentAllowedTopologyIds() : new Set((state.currentGeoJSON.features||[]).flatMap(v95FeatureIds));
  if(!allowedIds.size) return;
  const edgesRaw=await v90LoadTopologyEdges(state.year);
  if(token!==state._topologyRenderTokenV95 || !v93TopologyVisible()) return;
  const edgeFeaturesRaw=(edgesRaw.features||[]).filter(e=>allowedIds.has(String(e.properties?.source_id||'')) && allowedIds.has(String(e.properties?.target_id||'')));
  const nodesRaw=await v90LoadTopologyNodes(state.year);
  if(token!==state._topologyRenderTokenV95 || !v93TopologyVisible()) return;
  const nodeGJ=v95BuildCentroidNodes(nodesRaw, {type:'FeatureCollection',features:edgeFeaturesRaw}, allowedIds);
  const nodeIds=new Set((nodeGJ.features||[]).map(f=>String(f.properties?.unit_id || f.properties?.topology_node_id || '')).filter(Boolean));
  const edgeFeatures=edgeFeaturesRaw.filter(e=>nodeIds.has(String(e.properties?.source_id||'')) && nodeIds.has(String(e.properties?.target_id||'')));
  const counts=edgeFeatures.reduce((acc,e)=>{ const r=e.properties?.relation || 'unknown'; acc[r]=(acc[r]||0)+1; if(e.properties?.is_bridge) acc.bridges=(acc.bridges||0)+1; return acc; },{same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0});
  const nodeFeatures=(nodeGJ.features||[]).filter(f=>!f.properties?.topology_excluded && Number.isFinite(Number(f.properties?.topo_degree)));
  const vals=nodeFeatures.map(f=>Number(f.properties?.[metric])).filter(Number.isFinite);
  state._topologyNodeFeaturesV95=nodeFeatures;
  state._topologyNodeFeaturesV93=nodeFeatures; state._topologyNodeFeaturesV92=nodeFeatures; state._topologyNodeFeaturesV91=nodeFeatures;
  state.topologyEdgeStats={year:state.year, counts, total:edgeFeatures.length, nodes:nodeFeatures.length, renderer:'html_centroid_v95'};
  const group=L.layerGroup();
  if(v93TopologyEdgesOn() && edgeFeatures.length){
    const fc={type:'FeatureCollection',features:edgeFeatures};
    group.addLayer(L.geoJSON(fc,{interactive:false, style:typeof v93EdgeHaloStyle==='function'?v93EdgeHaloStyle:undefined}));
    group.addLayer(L.geoJSON(fc,{interactive:true, style:typeof v93EdgeStyle==='function'?v93EdgeStyle:undefined, onEachFeature:(f,l)=>{
      const p=f.properties||{};
      l.on('mouseover',e=>showHoverLater({title:`${p.source_name||'АТЕ'} — ${p.target_name||'АТЕ'}`, subtitle:'ребро топологического графа', extra:`общая граница: ${num1(p.boundary_km)} км · ${escapeHtml(typeof v93EdgeRelationLabel==='function'?v93EdgeRelationLabel(p.relation):(p.relation||'тип связи'))}${p.is_bridge?' · мостовое ребро':''}`, delay:140}, e.originalEvent));
      l.on('mousemove',e=>moveHover(e.originalEvent)); l.on('mouseout',hideHover);
    }}));
  }
  if(v93TopologyNodesOn() && nodeFeatures.length){
    const nodeGroup=L.layerGroup();
    nodeFeatures.forEach(f=>nodeGroup.addLayer(v95MakeNodeMarker(f, vals, metric)));
    group.addLayer(nodeGroup);
  }
  if(token!==state._topologyRenderTokenV95 || !v93TopologyVisible()) return;
  state.layers.topologyGraph=group;
  group.addTo(state.map);
  try{ group.eachLayer(l=>l.bringToFront && l.bringToFront()); }catch(_){ }
  try{ updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(_){ }
}
try{ v93RenderTopologyGraph=v95RenderTopologyGraph; v92RenderTopologyGraph=v95RenderTopologyGraph; v91RenderTopologyGraph=v95RenderTopologyGraph; v90RenderTopologyGraph=v95RenderTopologyGraph; v89RenderTopologyGraph=v95RenderTopologyGraph; v88RenderTopologyGraph=v95RenderTopologyGraph; }catch(_){ }
const v95PriorBuildTopologyLegend = typeof v93BuildTopologyLegend==='function' ? v93BuildTopologyLegend : null;
if(v95PriorBuildTopologyLegend){
  v93BuildTopologyLegend = function v95BuildTopologyLegend(gj){
    const html=v95PriorBuildTopologyLegend(gj);
    return html.replace('Граф построен по данным v94 и отфильтрован по текущему административному слою/выборке.', 'Граф построен по данным v94; узлы отрисованы заново как HTML-центроиды текущих административных полигонов и отфильтрованы по текущему слою/выборке.');
  };
}
(function v95BootTopology(){
  const boot=()=>{ try{ if(typeof v93BindTopologyControls==='function') v93BindTopologyControls(); v95RenderTopologyGraph(); updateLegend(state.currentGeoJSON,state._lastVals||[]); }catch(e){ console.warn('v95 topology boot failed', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,520),{once:true}); else setTimeout(boot,520);
})();


/* v96: hard topology centroid layer as an ordinary map element.
   The old topology node renderer is bypassed: nodes are rebuilt from the current
   admin polygons and displayed in their own Leaflet layer, like population circles. */
function v96TopologyEdgesOn(){ return !!$('toggleTopologyEdgesMain')?.checked; }
function v96TopologyCentroidsOn(){ return !!$('toggleTopologyCentroids')?.checked; }
function v96TopologyAnythingOn(){ return v96TopologyEdgesOn() || v96TopologyCentroidsOn(); }
function v96SyncLegacyTopologyControls(){
  const master=$('toggleTopologyGraph'), edges=$('toggleTopologyEdges'), nodes=$('toggleTopologyNodes');
  if(master) master.checked=v96TopologyAnythingOn();
  if(edges) edges.checked=v96TopologyEdgesOn();
  if(nodes) nodes.checked=v96TopologyCentroidsOn();
}
function v96TopologyMetricField(){
  const el=$('topologyMetricSelect');
  return el?.value || state.topologyMetric || 'topo_degree';
}
function v96IsNormalTopologyFeature(f){
  const p=f?.properties||{};
  if(p.topology_excluded || p.adjacency_excluded) return false;
  if(p.include_in_analytics === false) return false;
  const area=Number(p.area_km2);
  if(Number.isFinite(area) && area < 50) return false;
  const code=String(p.special_status_code || '').trim();
  if(code && code !== 'normal') return false;
  const selected=(state.selectedIds && state.selectedIds.size) ? state.selectedIds : null;
  if(selected && !selected.has(featureId(f))) return false;
  return true;
}
function v96CentroidForAdminLayer(layer){
  try{
    const c=layer?.getBounds?.().getCenter?.();
    if(c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) return c;
  }catch(_){ }
  return null;
}
function v96NodeMetricValue(f, metric){
  const p=f?.properties||{};
  const n=Number(p[metric]);
  if(Number.isFinite(n)) return n;
  const d=Number(p.topo_degree);
  return Number.isFinite(d) ? d : 0;
}
function v96CentroidNodeRadius(f){
  const p=f?.properties||{};
  const degree=Number(p.topo_degree);
  const kcore=Number(p.topo_k_core);
  const d=Number.isFinite(degree) ? degree : 1;
  const k=Number.isFinite(kcore) ? kcore : 0;
  return Math.max(8, Math.min(18, 8 + d*0.85 + k*0.65));
}
function v96CentroidNodeColors(f, vals, metric){
  const p=f?.properties||{};
  const v=v96NodeMetricValue(f,metric);
  let fill='#f6c85f';
  try{ fill=valueColor(v, vals && vals.length ? vals : [0,1]); }catch(_){ }
  const bridge=(Number(p.topo_bridge_incident_count)||0)>0 || !!p.topo_bridge_endpoint;
  return {fill, line:bridge?'#111827':'#fff8e6', outer:bridge?'#111827':'#083344'};
}
function v96CentroidNodeStyle(f, vals, metric){
  const colors=v96CentroidNodeColors(f,vals,metric);
  const selected=state.selectedIds?.has(featureId(f));
  return {
    pane:'overlayPane',
    radius:v96CentroidNodeRadius(f),
    color:selected?'#ff2a8a':colors.line,
    weight:selected?5:3.2,
    fillColor:colors.fill,
    fillOpacity:.98,
    opacity:1,
    lineCap:'round',
    lineJoin:'round',
    interactive:true,
    bubblingMouseEvents:false,
    className:'topology-centroid-node-v96'
  };
}
function v96CentroidHaloStyle(f){
  const selected=state.selectedIds?.has(featureId(f));
  return {
    pane:'overlayPane',
    radius:v96CentroidNodeRadius(f)+6,
    color:selected?'#ff2a8a':'#111827',
    weight:selected?2.8:2.2,
    fillColor:'#fff8e6',
    fillOpacity:selected?.34:.28,
    opacity:selected?.92:.72,
    interactive:false,
    bubblingMouseEvents:false,
    className:'topology-centroid-halo-v96'
  };
}
function v96BuildTopologyCentroids(){
  v96SyncLegacyTopologyControls();
  try{ clearLayer('topologyCentroids'); }catch(_){ }
  state._topologyNodeFeaturesV96=[];
  if(!state.map || !state.layers.admin || !state.currentGeoJSON) return;
  const metric=v96TopologyMetricField();
  const candidates=(state.currentGeoJSON.features||[]).filter(v96IsNormalTopologyFeature);
  const vals=candidates.map(f=>v96NodeMetricValue(f,metric)).filter(Number.isFinite);
  const group=L.layerGroup();
  state.layers.admin.eachLayer(layer=>{
    const f=layer.feature;
    if(!v96IsNormalTopologyFeature(f)) return;
    const p=f.properties||{};
    const degree=Number(p.topo_degree);
    // Для слоёв без топологических атрибутов всё равно показываем центроид,
    // но для пересчитанных слоёв это именно узел графа.
    const c=v96CentroidForAdminLayer(layer);
    if(!c) return;
    const halo=L.circleMarker(c, v96CentroidHaloStyle(f));
    const node=L.circleMarker(c, v96CentroidNodeStyle(f, vals, metric));
    halo.feature=f; node.feature=f;
    const metricLabel=typeof v91CleanTopologyMetricLabel==='function' ? v91CleanTopologyMetricLabel(metric) : metric;
    const metricValue=typeof v90MetricValueLabel==='function' ? v90MetricValueLabel(v96NodeMetricValue(f,metric),metric) : num1(v96NodeMetricValue(f,metric));
    node.on('mouseover', e=>showHoverLater({
      title:p.name||'АТЕ',
      subtitle:'узел графа / центроид АТЕ',
      extra:`${escapeHtml(metricLabel)}: ${metricValue} · соседей: ${Number.isFinite(degree)?degree:'—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'}`,
      population:p.population,
      area:p.area_km2,
      density:p.density,
      delay:80
    }, e.originalEvent));
    node.on('mousemove', e=>moveHover(e.originalEvent));
    node.on('mouseout', hideHover);
    node.on('click', e=>{ L.DomEvent.stopPropagation(e); if(state.tool !== 'pan') return; if(isSelectableFeature(f)) toggleSelection(f); showFeature(f); });
    group.addLayer(halo);
    group.addLayer(node);
    state._topologyNodeFeaturesV96.push({type:'Feature', properties:{...p, topology_node_renderer:'ordinary_centroid_layer_v96'}, geometry:{type:'Point', coordinates:[c.lng,c.lat]}});
  });
  state.layers.topologyCentroids=group;
  state._topologyNodeFeaturesV95=state._topologyNodeFeaturesV96;
  state._topologyNodeFeaturesV93=state._topologyNodeFeaturesV96;
  state._topologyNodeFeaturesV92=state._topologyNodeFeaturesV96;
  state._topologyNodeFeaturesV91=state._topologyNodeFeaturesV96;
  const prev=state.topologyEdgeStats||{year:state.year, counts:{}, total:0};
  state.topologyEdgeStats={...prev, year:state.year, nodes:state._topologyNodeFeaturesV96.length, renderer:'ordinary_centroid_layer_v96'};
}
async function v96RenderTopologyGraph(){
  v96SyncLegacyTopologyControls();
  const token=(state._topologyRenderTokenV96||0)+1;
  state._topologyRenderTokenV96=token;
  try{ clearLayer('topologyGraph'); }catch(_){ }
  const emptyCounts={same_parent:0,same_superparent:0,cross_parent:0,unknown:0,bridges:0};
  state.topologyEdgeStats={year:state.year, counts:emptyCounts, total:0, nodes:state._topologyNodeFeaturesV96?.length||0, renderer:'ordinary_centroid_layer_v96'};
  if(!state.map || !state.currentGeoJSON || !v96TopologyEdgesOn()) return;
  const allowedIds=typeof v93CurrentAllowedTopologyIds==='function' ? v93CurrentAllowedTopologyIds() : new Set((state.currentGeoJSON.features||[]).filter(v96IsNormalTopologyFeature).map(f=>String(f.properties?.unit_id || featureId(f))));
  if(!allowedIds.size) return;
  let edgesRaw=null;
  try{ edgesRaw=await v90LoadTopologyEdges(state.year); }catch(e){ console.warn('v96 topology edges skipped', e); return; }
  if(token!==state._topologyRenderTokenV96 || !v96TopologyEdgesOn()) return;
  const edgeFeatures=(edgesRaw.features||[]).filter(e=>allowedIds.has(String(e.properties?.source_id||'')) && allowedIds.has(String(e.properties?.target_id||'')));
  const counts=edgeFeatures.reduce((acc,e)=>{ const r=e.properties?.relation || 'unknown'; acc[r]=(acc[r]||0)+1; if(e.properties?.is_bridge) acc.bridges=(acc.bridges||0)+1; return acc; },{...emptyCounts});
  state.topologyEdgeStats={year:state.year, counts, total:edgeFeatures.length, nodes:state._topologyNodeFeaturesV96?.length||0, renderer:'ordinary_centroid_layer_v96'};
  if(!edgeFeatures.length) return;
  const fc={type:'FeatureCollection', features:edgeFeatures};
  const group=L.layerGroup();
  group.addLayer(L.geoJSON(fc,{interactive:false, style:typeof v93EdgeHaloStyle==='function'?v93EdgeHaloStyle:(()=>({color:'#fff8e6',weight:8,opacity:.8}))}));
  group.addLayer(L.geoJSON(fc,{interactive:true, style:typeof v93EdgeStyle==='function'?v93EdgeStyle:(()=>({color:'#0477bf',weight:4,opacity:.9})), onEachFeature:(f,l)=>{
    const p=f.properties||{};
    l.on('mouseover',e=>showHoverLater({title:`${p.source_name||'АТЕ'} — ${p.target_name||'АТЕ'}`, subtitle:'ребро смежности', extra:`общая граница: ${num1(p.boundary_km)} км · ${escapeHtml(typeof v93EdgeRelationLabel==='function'?v93EdgeRelationLabel(p.relation):(p.relation||'тип связи'))}${p.is_bridge?' · мостовое ребро':''}`, delay:120}, e.originalEvent));
    l.on('mousemove',e=>moveHover(e.originalEvent));
    l.on('mouseout',hideHover);
  }}));
  if(token!==state._topologyRenderTokenV96 || !v96TopologyEdgesOn()) return;
  state.layers.topologyGraph=group;
}
function v96ApplyTopologyLayerVisibility(){
  v96SyncLegacyTopologyControls();
  if(!state.map) return;
  const edges=state.layers.topologyGraph;
  if(edges){
    if(v96TopologyEdgesOn()){ if(!state.map.hasLayer(edges)) edges.addTo(state.map); bringLayerGroupToFront(edges); }
    else if(state.map.hasLayer(edges)) state.map.removeLayer(edges);
  }
  const nodes=state.layers.topologyCentroids;
  if(nodes){
    if(v96TopologyCentroidsOn()){ if(!state.map.hasLayer(nodes)) nodes.addTo(state.map); bringLayerGroupToFront(nodes); }
    else if(state.map.hasLayer(nodes)) state.map.removeLayer(nodes);
  }
}
function v96BuildTopologyLegend(gj){
  v96SyncLegacyTopologyControls();
  const base=(typeof v93BuildTopologyLegend==='function') ? v93BuildTopologyLegend(gj) : '';
  const nodes=state._topologyNodeFeaturesV96?.length || 0;
  const edges=state.topologyEdgeStats?.total || 0;
  const note=`<div class="mini-muted legend-scale-note-v67 v96-node-note"><b>v96:</b> узлы выводятся отдельным обычным слоем карты, как круги населения: ${num(nodes)} JSON-точек узлов. Рёбра: ${num(edges)}. Старый SVG/HTML‑рендер узлов больше не используется.</div>`;
  return base ? `${base}${note}` : note;
}
const v96PriorUpdateLegend = updateLegend;
updateLegend = function updateLegendV96(gj, vals){
  if(v96TopologyAnythingOn()){
    const box=$('legendBox'); if(!box || !gj) return;
    box.innerHTML=v96BuildTopologyLegend(gj);
    return;
  }
  v96PriorUpdateLegend(gj, vals);
};
const v96PriorRefreshVisibility = refreshVisibility;
refreshVisibility = function refreshVisibilityV96(){
  v96PriorRefreshVisibility();
  v96ApplyTopologyLayerVisibility();
  if(v96TopologyAnythingOn()) updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
};
function v96RefreshTopologyOverlays(){
  v96BuildTopologyCentroids();
  v96RenderTopologyGraph().then(()=>{ v96ApplyTopologyLayerVisibility(); updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []); }).catch(e=>console.warn('v96 topology overlay refresh failed', e));
  v96ApplyTopologyLayerVisibility();
}
function v96BindTopologyOverlayControls(){
  const ids=['toggleTopologyEdgesMain','toggleTopologyCentroids','topologyMetricSelect'];
  ids.forEach(id=>{
    const el=$(id); if(!el || el.dataset.v96Bound==='1') return;
    el.dataset.v96Bound='1';
    el.addEventListener('change',()=>{ if(id==='topologyMetricSelect') state.topologyMetric=el.value; v96RefreshTopologyOverlays(); }, true);
  });
  const mode=$('modeSelect');
  if(mode && mode.dataset.v96TopologyBound!=='1'){
    mode.dataset.v96TopologyBound='1'; mode.addEventListener('change',()=>setTimeout(v96RefreshTopologyOverlays,60), true);
  }
}
const v96PriorRefreshAdmin = refreshAdmin;
refreshAdmin = async function refreshAdminV96(seq){
  await v96PriorRefreshAdmin(seq);
  if(typeof isStaleRefresh==='function' && isStaleRefresh(seq)) return;
  v96BindTopologyOverlayControls();
  v96RefreshTopologyOverlays();
};
const v96PriorUpdateStatsAndSelection = updateStatsAndSelection;
updateStatsAndSelection = function updateStatsAndSelectionV96(){
  v96PriorUpdateStatsAndSelection();
  clearTimeout(state._topologySelectionRenderTimerV96);
  state._topologySelectionRenderTimerV96=setTimeout(v96RefreshTopologyOverlays,45);
};
try{ v93RenderTopologyGraph=v96RenderTopologyGraph; v92RenderTopologyGraph=v96RenderTopologyGraph; v91RenderTopologyGraph=v96RenderTopologyGraph; v90RenderTopologyGraph=v96RenderTopologyGraph; v89RenderTopologyGraph=v96RenderTopologyGraph; v88RenderTopologyGraph=v96RenderTopologyGraph; }catch(_){ }
(function v96BootTopology(){
  const boot=()=>{ try{ v96BindTopologyOverlayControls(); v96RefreshTopologyOverlays(); }catch(e){ console.warn('v96 topology boot failed', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,700),{once:true}); else setTimeout(boot,700);
})();


/* v97: emergency-visible topology centroids as a plain DOM overlay.
   This intentionally bypasses Leaflet SVG/canvas/vector panes and L.circleMarker.
   Nodes are ordinary absolutely-positioned HTML buttons over the map container. */
function v97GetTopologyDomLayer(){
  if(!state.map) return null;
  const container=state.map.getContainer?.();
  if(!container) return null;
  let layer=state._topologyDomLayerV97 || container.querySelector('#topologyCentroidDomLayerV97');
  if(!layer){
    layer=document.createElement('div');
    layer.id='topologyCentroidDomLayerV97';
    layer.className='topology-dom-centroid-layer-v97';
    layer.setAttribute('aria-label','Узлы графа / JSON-точки АТЕ');
    container.appendChild(layer);
  }
  state._topologyDomLayerV97=layer;
  return layer;
}
function v97EnsureTopologyDomEvents(){
  if(!state.map || state._topologyDomEventsBoundV97) return;
  state._topologyDomEventsBoundV97=true;
  const schedule=()=>{
    cancelAnimationFrame(state._topologyDomPositionRafV97);
    state._topologyDomPositionRafV97=requestAnimationFrame(v97PositionTopologyDomNodes);
  };
  state.map.on('move zoom zoomend moveend viewreset resize', schedule);
  window.addEventListener('resize', schedule, {passive:true});
}
function v97PositionTopologyDomNodes(){
  const layer=state._topologyDomLayerV97;
  if(!layer || !state.map) return;
  const on=!!$('toggleTopologyCentroids')?.checked;
  layer.style.display=on?'block':'none';
  if(!on) return;
  (state._topologyDomNodesV97||[]).forEach(item=>{
    const pt=state.map.latLngToContainerPoint(item.latlng);
    item.el.style.transform=`translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%)`;
  });
}
function v97ClearTopologyDomNodes(){
  const layer=state._topologyDomLayerV97 || document.getElementById('topologyCentroidDomLayerV97');
  if(layer) layer.replaceChildren();
  state._topologyDomNodesV97=[];
}
function v97BuildDomNodeElement(f, latlng, vals, metric){
  const p=f?.properties||{};
  const r=Math.max(10, Math.min(22, (typeof v96CentroidNodeRadius==='function'?v96CentroidNodeRadius(f):10)+2));
  let colors={fill:'#f6c85f', line:'#fff8e6', outer:'#083344'};
  try{ colors=v96CentroidNodeColors(f, vals, metric); }catch(_){ }
  const id=featureId(f);
  const selected=state.selectedIds?.has(id);
  const degree=Number(p.topo_degree);
  const el=document.createElement('button');
  el.type='button';
  el.className='topology-dom-centroid-v97'+(selected?' selected':'')+(((Number(p.topo_bridge_incident_count)||0)>0 || p.topo_bridge_endpoint)?' bridge':'');
  el.dataset.featureId=id;
  el.style.width=`${r*2}px`;
  el.style.height=`${r*2}px`;
  el.style.background=colors.fill || '#f6c85f';
  el.style.borderColor=selected?'#ff2a8a':(colors.line || '#fff8e6');
  el.style.setProperty('--topology-node-outer', colors.outer || '#083344');
  el.title=`${p.name||'АТЕ'} — узел графа / центроид; соседей: ${Number.isFinite(degree)?degree:'—'}`;
  ['mousedown','mouseup','click','dblclick','touchstart','touchend','wheel'].forEach(type=>{
    el.addEventListener(type, ev=>ev.stopPropagation(), {passive:type==='wheel'?false:undefined});
  });
  el.addEventListener('mouseover', ev=>{
    const metricLabel=typeof v91CleanTopologyMetricLabel==='function' ? v91CleanTopologyMetricLabel(metric) : metric;
    const metricValue=typeof v90MetricValueLabel==='function' ? v90MetricValueLabel(v96NodeMetricValue(f,metric),metric) : num1(v96NodeMetricValue(f,metric));
    showHoverLater({
      title:p.name||'АТЕ',
      subtitle:'узел графа / центроид АТЕ · DOM-слой v97',
      extra:`${escapeHtml(metricLabel)}: ${metricValue} · соседей: ${Number.isFinite(degree)?degree:'—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'}`,
      population:p.population,
      area:p.area_km2,
      density:p.density,
      delay:60
    }, ev);
  });
  el.addEventListener('mousemove', ev=>moveHover(ev));
  el.addEventListener('mouseout', hideHover);
  el.addEventListener('click', ev=>{
    ev.preventDefault(); ev.stopPropagation();
    if(state.tool !== 'pan') return;
    if(isSelectableFeature(f)) toggleSelection(f);
    showFeature(f);
    setTimeout(v97BuildTopologyCentroids, 0);
  });
  return el;
}
function v97BuildTopologyCentroids(){
  v96SyncLegacyTopologyControls();
  try{ clearLayer('topologyCentroids'); state.layers.topologyCentroids=null; }catch(_){ }
  v97EnsureTopologyDomEvents();
  const layer=v97GetTopologyDomLayer();
  v97ClearTopologyDomNodes();
  state._topologyNodeFeaturesV96=[];
  if(!state.map || !state.layers.admin || !state.currentGeoJSON || !layer){
    if(layer) layer.style.display='none';
    return;
  }
  const metric=v96TopologyMetricField();
  const candidates=(state.currentGeoJSON.features||[]).filter(v96IsNormalTopologyFeature);
  const vals=candidates.map(f=>v96NodeMetricValue(f,metric)).filter(Number.isFinite);
  const nodes=[];
  const nodeFeatures=[];
  state.layers.admin.eachLayer(layerAdmin=>{
    const f=layerAdmin.feature;
    if(!v96IsNormalTopologyFeature(f)) return;
    const p=f.properties||{};
    const latlng=v96CentroidForAdminLayer(layerAdmin);
    if(!latlng) return;
    const el=v97BuildDomNodeElement(f, latlng, vals, metric);
    layer.appendChild(el);
    nodes.push({el, latlng, feature:f});
    nodeFeatures.push({type:'Feature', properties:{...p, topology_node_renderer:'plain_dom_overlay_v97'}, geometry:{type:'Point', coordinates:[latlng.lng,latlng.lat]}});
  });
  state._topologyDomNodesV97=nodes;
  state._topologyNodeFeaturesV96=nodeFeatures;
  state._topologyNodeFeaturesV95=nodeFeatures;
  state._topologyNodeFeaturesV93=nodeFeatures;
  state._topologyNodeFeaturesV92=nodeFeatures;
  state._topologyNodeFeaturesV91=nodeFeatures;
  const prev=state.topologyEdgeStats||{year:state.year, counts:{}, total:0};
  state.topologyEdgeStats={...prev, year:state.year, nodes:nodeFeatures.length, renderer:'plain_dom_overlay_v97'};
  v97PositionTopologyDomNodes();
}
function v97ApplyTopologyDomVisibility(){
  const layer=v97GetTopologyDomLayer();
  if(!layer) return;
  layer.style.display=$('toggleTopologyCentroids')?.checked?'block':'none';
  v97PositionTopologyDomNodes();
}
const v97PriorApplyTopologyLayerVisibility = v96ApplyTopologyLayerVisibility;
v96ApplyTopologyLayerVisibility = function v96ApplyTopologyLayerVisibilityV97(){
  try{ v97PriorApplyTopologyLayerVisibility(); }catch(_){ }
  v97ApplyTopologyDomVisibility();
};
v96BuildTopologyCentroids = v97BuildTopologyCentroids;
const v97PriorBuildTopologyLegend = v96BuildTopologyLegend;
v96BuildTopologyLegend = function v96BuildTopologyLegendV97(gj){
  const base=(typeof v93BuildTopologyLegend==='function') ? v93BuildTopologyLegend(gj) : (v97PriorBuildTopologyLegend ? v97PriorBuildTopologyLegend(gj) : '');
  const nodes=state._topologyNodeFeaturesV96?.length || state._topologyDomNodesV97?.length || 0;
  const edges=state.topologyEdgeStats?.total || 0;
  const note=`<div class="mini-muted legend-scale-note-v67 v96-node-note"><b>v97:</b> узлы выведены не через Leaflet SVG/canvas, а обычными HTML‑точками поверх карты: ${num(nodes)} JSON-точек узлов. Рёбра: ${num(edges)}.</div>`;
  return base ? `${base}${note}` : note;
};
(function v97BootTopologyDomLayer(){
  const boot=()=>{ try{ v96BuildTopologyCentroids(); v96ApplyTopologyLayerVisibility(); updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []); }catch(e){ console.warn('v97 topology DOM boot failed', e); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,900),{once:true}); else setTimeout(boot,900);
})();


/* v98: smaller DOM centroid nodes + export/topology-aware legend controls.
   Key change: legend is no longer copied blindly from the interactive panel.
   It is rebuilt from actually enabled layer toggles and from explicit export legend checkboxes. */
function v98Checked(id, fallback=false){
  const el=$(id);
  return el ? !!el.checked : !!fallback;
}
function v98ExportOrInteractiveLayerOn(key, exportMode=false){
  const ex=state.export || {};
  if(exportMode){
    if(key==='admin') return !!ex.showAdmin;
    if(key==='hydro') return !!ex.showHydro;
    if(key==='railways') return !!ex.showRailways;
    if(key==='population') return !!ex.showPopulation;
    if(key==='topologyEdges') return !!ex.showTopologyEdges;
    if(key==='topologyNodes') return !!ex.showTopologyNodes;
    return false;
  }
  if(key==='admin') return v98Checked('toggleAdmin', true);
  if(key==='hydro') return v98Checked('toggleHydro', true);
  if(key==='railways') return v98Checked('toggleRailways', true);
  if(key==='population') return v98Checked('toggleCircles', true);
  if(key==='centers') return v98Checked('toggleCenters', false);
  if(key==='topologyEdges') return v98Checked('toggleTopologyEdgesMain', false);
  if(key==='topologyNodes') return v98Checked('toggleTopologyCentroids', true);
  return false;
}
function v98DefaultLegendItems(){
  return {
    admin:v98ExportOrInteractiveLayerOn('admin',false),
    hydro:v98ExportOrInteractiveLayerOn('hydro',false),
    railways:v98ExportOrInteractiveLayerOn('railways',false),
    population:v98ExportOrInteractiveLayerOn('population',false),
    centers:v98ExportOrInteractiveLayerOn('centers',false),
    topologyEdges:v98ExportOrInteractiveLayerOn('topologyEdges',false),
    topologyNodes:v98ExportOrInteractiveLayerOn('topologyNodes',false)
  };
}
function v98SyncExportLayerDefaultsFromInteractive(forceLegend=true){
  if(!state.export || typeof state.export!=='object') state.export={};
  const ex=state.export;
  ex.showHydro=v98Checked('toggleHydro', true);
  ex.showAdmin=v98Checked('toggleAdmin', true);
  ex.showRailways=v98Checked('toggleRailways', true);
  ex.showPopulation=v98Checked('toggleCircles', true);
  ex.showTopologyEdges=v98Checked('toggleTopologyEdgesMain', false);
  ex.showTopologyNodes=v98Checked('toggleTopologyCentroids', true);
  if(forceLegend || !ex.legendItems || typeof ex.legendItems!=='object') ex.legendItems=v98DefaultLegendItems();
  if(ex.legendItems){
    ex.legendItems.admin=!!ex.showAdmin && v98Checked('toggleAdmin', true);
    ex.legendItems.hydro=!!ex.showHydro && v98Checked('toggleHydro', true);
    ex.legendItems.railways=!!ex.showRailways && v98Checked('toggleRailways', true);
    ex.legendItems.population=!!ex.showPopulation && v98Checked('toggleCircles', true);
    ex.legendItems.centers=false; // centers are not drawn in the SVG export map yet
    ex.legendItems.topologyEdges=!!ex.showTopologyEdges && v98Checked('toggleTopologyEdgesMain', false);
    ex.legendItems.topologyNodes=!!ex.showTopologyNodes && v98Checked('toggleTopologyCentroids', true);
  }
}
const v98PriorEnsureExportFlags = typeof ensureExportFlags==='function' ? ensureExportFlags : null;
ensureExportFlags = function ensureExportFlagsV98(){
  const ex=v98PriorEnsureExportFlags ? v98PriorEnsureExportFlags() : (state.export || (state.export={}));
  if(typeof ex.showTopologyEdges !== 'boolean') ex.showTopologyEdges=v98Checked('toggleTopologyEdgesMain', false);
  if(typeof ex.showTopologyNodes !== 'boolean') ex.showTopologyNodes=v98Checked('toggleTopologyCentroids', true);
  if(!ex.legendItems || typeof ex.legendItems!=='object') ex.legendItems=v98DefaultLegendItems();
  const defs=v98DefaultLegendItems();
  Object.keys(defs).forEach(k=>{ if(typeof ex.legendItems[k] !== 'boolean') ex.legendItems[k]=!!defs[k]; });
  if(typeof ex.legendRespectInteractive !== 'boolean') ex.legendRespectInteractive=true;
  return ex;
};

function v98FeatureValuesForMode(features){
  const field=typeof valField==='function' ? valField() : null;
  return field ? (features||[]).map(f=>Number(f.properties?.[field])).filter(v=>Number.isFinite(v)) : [];
}
function v98LegendAdminHtml(features, vals){
  let html='';
  const mode=state.mode;
  const categorical = mode==='admin_parent'||mode==='admin_intermediate'||mode==='admin_superparent'||mode==='unit_type';
  if(categorical){
    const cats=[...new Set((features||[]).map(f=>f.properties?.[mode]).filter(Boolean))].slice(0,14);
    if(cats.length){
      html += '<div class="legend-section">Административный слой</div>';
      cats.forEach(c=>{ html += `<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${escapeHtml(c)}</div>`; });
    }
  }else{
    const desc=(typeof v67ClassDescriptor==='function') ? v67ClassDescriptor(vals||[], mode) : null;
    html += `<div class="legend-section">${escapeHtml(typeof v67ChoroplethTitle==='function' ? v67ChoroplethTitle() : 'Значение показателя')}</div>`;
    if(desc){
      const count=desc.thresholds.length+1;
      desc.labels.forEach((label,i)=>{ html += `<div class="legend-row legend-row-class-v67"><span class="swatch" style="background:${v67ColorFromClass(i,count)}"></span><span>${escapeHtml(label)}</span></div>`; });
      const modeLabel = desc.method==='fixed' ? 'фиксированные классы'
        : desc.method==='linear' ? 'линейная шкала, округление до 10/50 км'
        : desc.method==='quantile' ? 'квантили, округлены'
        : 'геометрическая шкала, округлена';
      html += `<div class="mini-muted legend-scale-note-v67">${modeLabel}</div>`;
    }else{
      activeValueRamp().forEach((c,i,arr)=>{ html += `<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===arr.length-1?'больше':''}</div>`; });
    }
  }
  return html;
}
function v98LegendHydroHtml(){
  return '<div class="legend-section">Гидрография и океан</div><div class="legend-row"><span class="water-swatch swatch"></span>океан, озёра и водохранилища</div><div class="legend-row"><span class="river-swatch"></span>реки</div>';
}
function v98LegendRailHtml(){
  return '<div class="legend-section">Железные дороги</div><div class="legend-row"><span class="rail-swatch-v98"></span>железные дороги</div>';
}
function v98LegendPopulationHtml(features){
  const vals=(features||[]).map(f=>Number(f.properties?.population)||0).filter(v=>v>0);
  if(!vals.length) return '';
  const max=Math.max(...vals), mid=max/4;
  let html='<div class="legend-section">Символы населения</div>';
  [[max,'макс.'],[mid,'примерно 1/4 макс.']].forEach(([v,label])=>{
    const size=Math.max(8, typeof populationSymbolSize==='function' ? populationSymbolSize(v, vals) : 12);
    html += `<div class="legend-row"><span class="circle-swatch" style="width:${(size*1.15).toFixed(1)}px;height:${(size*1.15).toFixed(1)}px"></span>${label}: ${num(v)}</div>`;
  });
  const scaleName={sqrt:'квадратный корень',linear:'линейное',log:'логарифмическое',quantile:'квантильное'}[state.populationSymbol?.scale]||state.populationSymbol?.scale||'sqrt';
  html += `<div class="mini-muted">Нормирование: ${escapeHtml(scaleName)}.</div>`;
  return html;
}
function v98LegendCentersHtml(features){
  if(!(features||[]).length) return '';
  return '<div class="legend-section">Центры</div><div class="legend-row"><span class="center-circle-swatch" style="width:15px;height:15px"></span>административные центры</div>';
}
function v98TopologyLegendHtml(items, exportMode=false){
  let html='';
  if(items.topologyEdges && v98ExportOrInteractiveLayerOn('topologyEdges', exportMode)){
    html += '<div class="legend-section">Рёбра смежности</div>';
    html += '<div class="legend-row"><span class="topology-edge-same-v90"></span>внутри одного верхнего уровня</div>';
    html += '<div class="legend-row"><span class="topology-edge-super-v90"></span>внутри одного надуровня</div>';
    html += '<div class="legend-row"><span class="topology-edge-cross-v90"></span>между разными губерниями/областями</div>';
  }
  if(items.topologyNodes && v98ExportOrInteractiveLayerOn('topologyNodes', exportMode)){
    const nodes=state._topologyNodeFeaturesV96?.length || state._topologyDomNodesV97?.length || 0;
    html += '<div class="legend-section">Узлы графа</div>';
    html += `<div class="legend-row"><span class="topology-node-swatch-v98"></span>JSON-точки узлов${nodes?` · ${num(nodes)}`:''}</div>`;
  }
  return html;
}
function v98BuildLegendHtml(options={}){
  const exportMode=!!options.exportMode;
  const ex=ensureExportFlags();
  const items=exportMode ? (ex.legendItems||{}) : v98DefaultLegendItems();
  const features=options.features || (exportMode ? exportScopeFeatures() : (state.currentGeoJSON?.features||[]));
  const vals=options.vals || v98FeatureValuesForMode(features);
  let html=options.includeTitle===false ? '' : '<b>Легенда</b>';
  if(items.admin && v98ExportOrInteractiveLayerOn('admin', exportMode)) html += v98LegendAdminHtml(features, vals);
  if(items.hydro && v98ExportOrInteractiveLayerOn('hydro', exportMode)) html += v98LegendHydroHtml();
  if(items.railways && v98ExportOrInteractiveLayerOn('railways', exportMode)) html += v98LegendRailHtml();
  if(items.population && v98ExportOrInteractiveLayerOn('population', exportMode)) html += v98LegendPopulationHtml(features);
  if(!exportMode && items.centers && v98ExportOrInteractiveLayerOn('centers', false)) html += v98LegendCentersHtml(features);
  html += v98TopologyLegendHtml(items, exportMode);
  if(!html.replace(/<[^>]+>/g,'').trim()) html='<b>Легенда</b><div class="mini-muted">Нет включённых элементов для легенды.</div>';
  return html;
}
updateLegend = function updateLegendV98(gj, vals){
  const box=$('legendBox'); if(!box) return;
  const features=gj?.features || state.currentGeoJSON?.features || [];
  box.innerHTML=v98BuildLegendHtml({exportMode:false, features, vals:vals||v98FeatureValuesForMode(features)});
};
exportLegendHtml = function exportLegendHtmlV98(){
  return `<div class="export-legend-wrap export-legend-wrap-v98">${v98BuildLegendHtml({exportMode:true, includeTitle:false})}</div>`;
};

function v98LegendControlDefs(){
  return [
    ['admin','Административная заливка', 'admin'],
    ['hydro','Гидрография и океан', 'hydro'],
    ['railways','Железные дороги', 'railways'],
    ['population','Символы населения', 'population'],
    ['topologyEdges','Рёбра смежности', 'topologyEdges'],
    ['topologyNodes','Узлы графа / JSON-точки', 'topologyNodes']
  ];
}
function v98RenderExportLegendControls(){
  const box=$('exportLegendItemsBoxV98');
  if(!box) return;
  const ex=ensureExportFlags();
  box.innerHTML=v98LegendControlDefs().map(([key,label,layerKey])=>{
    const layerOn=v98ExportOrInteractiveLayerOn(layerKey, true);
    const disabled=layerOn ? '' : 'disabled';
    const muted=layerOn ? '' : ' <span class="mini-muted">(слой выключен в экспорте)</span>';
    return `<label class="export-legend-item-v98"><input type="checkbox" data-export-legend-item="${key}" ${ex.legendItems?.[key]?'checked':''} ${disabled}> ${escapeHtml(label)}${muted}</label>`;
  }).join('') + '<div class="mini-muted">По умолчанию легенда берёт только включённые слои интерактивной карты. Здесь можно дополнительно убрать лишние пункты из экспортного макета.</div>';
  box.querySelectorAll('input[data-export-legend-item]').forEach(input=>{
    if(input.dataset.boundV98==='1') return;
    input.dataset.boundV98='1';
    input.addEventListener('change', e=>{
      const key=e.target.dataset.exportLegendItem;
      ensureExportFlags().legendItems[key]=!!e.target.checked;
      try{ v68FullSvgCache?.clear?.(); }catch(_){ }
      renderExportPreviewCard();
    });
  });
}
function v98InstallExportLegendControls(modal){
  if(!modal || modal.dataset.v98LegendControls==='1') return;
  const grid=modal.querySelector('.export-layer-grid, .export-layer-grid-v50, .export-layer-grid-v49');
  if(grid){
    if(!$('exportShowTopologyEdges')) grid.insertAdjacentHTML('beforeend','<label><input type="checkbox" id="exportShowTopologyEdges"> Рёбра смежности</label>');
    if(!$('exportShowTopologyNodes')) grid.insertAdjacentHTML('beforeend','<label><input type="checkbox" id="exportShowTopologyNodes"> Узлы графа / JSON-точки</label>');
  }
  const anchor=$('exportStatsFieldsBox')?.closest('details') || $('exportContextDetails') || grid;
  if(anchor && !$('exportLegendDetailsV98')){
    anchor.insertAdjacentHTML('afterend', `<details id="exportLegendDetailsV98" class="export-context-box export-legend-details-v98" open><summary>Содержание легенды</summary><div class="button-row export-legend-buttons-v98"><button type="button" id="exportLegendResetFromMapV98">Взять из включённых слоёв карты</button><button type="button" id="exportLegendAllOffV98">Снять всё</button></div><div id="exportLegendItemsBoxV98" class="export-legend-items-v98"></div></details>`);
  }
  [['Admin','admin'],['Hydro','hydro'],['Railways','railways'],['Population','population'],['TopologyEdges','topologyEdges'],['TopologyNodes','topologyNodes']].forEach(([name,key])=>{
    const el=$(`exportShow${name}`);
    if(el && el.dataset.boundV98!=='1'){
      el.dataset.boundV98='1';
      el.addEventListener('change', e=>{
        const ex=ensureExportFlags();
        ex[`show${name}`]=!!e.target.checked;
        if(ex.legendItems) ex.legendItems[key]=!!e.target.checked;
        try{ v68FullSvgCache?.clear?.(); }catch(_){ }
        v98RenderExportLegendControls();
        renderExportPreviewCard();
      });
    }
  });
  $('exportLegendResetFromMapV98')?.addEventListener('click', ()=>{
    v98SyncExportLayerDefaultsFromInteractive(true);
    syncExportDefaults(false);
    try{ v68FullSvgCache?.clear?.(); }catch(_){ }
    renderExportPreviewCard();
  });
  $('exportLegendAllOffV98')?.addEventListener('click', ()=>{
    const ex=ensureExportFlags();
    Object.keys(ex.legendItems||{}).forEach(k=>ex.legendItems[k]=false);
    v98RenderExportLegendControls();
    renderExportPreviewCard();
  });
  modal.dataset.v98LegendControls='1';
  v98RenderExportLegendControls();
}
const v98PriorEnsureExportModal = typeof ensureExportModal==='function' ? ensureExportModal : null;
ensureExportModal = function ensureExportModalV98(){
  const modal=v98PriorEnsureExportModal ? v98PriorEnsureExportModal() : null;
  v98InstallExportLegendControls(modal);
  return modal;
};
const v98PriorSyncExportDefaults = typeof syncExportDefaults==='function' ? syncExportDefaults : null;
syncExportDefaults = function syncExportDefaultsV98(resetTitle){
  if(v98PriorSyncExportDefaults) v98PriorSyncExportDefaults(resetTitle);
  const ex=ensureExportFlags();
  const C=(id,val)=>{ const el=$(id); if(el) el.checked=!!val; };
  C('exportShowTopologyEdges', ex.showTopologyEdges);
  C('exportShowTopologyNodes', ex.showTopologyNodes);
  v98RenderExportLegendControls();
};
const v98PriorOpenExportMode = typeof openExportMode==='function' ? openExportMode : null;
openExportMode = async function openExportModeV98(){
  v98SyncExportLayerDefaultsFromInteractive(true);
  return v98PriorOpenExportMode ? await v98PriorOpenExportMode() : undefined;
};

/* Smaller DOM nodes: exactly about half the v97 diameter, with scaled stroke/halo. */
v97BuildDomNodeElement = function v97BuildDomNodeElementV98(f, latlng, vals, metric){
  const p=f?.properties||{};
  const base=(typeof v96CentroidNodeRadius==='function'?v96CentroidNodeRadius(f):10)+2;
  const r=Math.max(5, Math.min(11, base/2));
  let colors={fill:'#f6c85f', line:'#fff8e6', outer:'#083344'};
  try{ colors=v96CentroidNodeColors(f, vals, metric); }catch(_){ }
  const id=featureId(f);
  const selected=state.selectedIds?.has(id);
  const degree=Number(p.topo_degree);
  const el=document.createElement('button');
  el.type='button';
  el.className='topology-dom-centroid-v97 topology-dom-centroid-v98'+(selected?' selected':'')+(((Number(p.topo_bridge_incident_count)||0)>0 || p.topo_bridge_endpoint)?' bridge':'');
  el.dataset.featureId=id;
  el.style.width=`${(r*2).toFixed(1)}px`;
  el.style.height=`${(r*2).toFixed(1)}px`;
  el.style.background=colors.fill || '#f6c85f';
  el.style.borderColor=selected?'#ff2a8a':(colors.line || '#fff8e6');
  el.style.setProperty('--topology-node-outer', colors.outer || '#083344');
  el.title=`${p.name||'АТЕ'} — узел графа / центроид; соседей: ${Number.isFinite(degree)?degree:'—'}`;
  ['mousedown','mouseup','click','dblclick','touchstart','touchend','wheel'].forEach(type=>{
    el.addEventListener(type, ev=>ev.stopPropagation(), {passive:type==='wheel'?false:undefined});
  });
  el.addEventListener('mouseover', ev=>{
    const metricLabel=typeof v91CleanTopologyMetricLabel==='function' ? v91CleanTopologyMetricLabel(metric) : metric;
    const metricValue=typeof v90MetricValueLabel==='function' ? v90MetricValueLabel(v96NodeMetricValue(f,metric),metric) : num1(v96NodeMetricValue(f,metric));
    showHoverLater({title:p.name||'АТЕ', subtitle:'узел графа / центроид АТЕ · DOM-слой v98', extra:`${escapeHtml(metricLabel)}: ${metricValue} · соседей: ${Number.isFinite(degree)?degree:'—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'}`, population:p.population, area:p.area_km2, density:p.density, delay:60}, ev);
  });
  el.addEventListener('mousemove', ev=>moveHover(ev));
  el.addEventListener('mouseout', hideHover);
  el.addEventListener('click', ev=>{
    ev.preventDefault(); ev.stopPropagation();
    if(state.tool !== 'pan') return;
    if(isSelectableFeature(f)) toggleSelection(f);
    showFeature(f);
    setTimeout(v97BuildTopologyCentroids, 0);
  });
  return el;
};

/* Optional topology rendering in export SVG, so legend items can correspond to actual export layers. */
function v98ExportFeatureIds(feature){
  if(typeof v95FeatureIds==='function') return v95FeatureIds(feature);
  const p=feature?.properties||{};
  return [featureId(feature), p.unit_id, p.topology_node_id].map(x=>String(x||'')).filter(Boolean);
}
function v98ExportCentroid(feature){
  if(typeof v95AdminCentroid==='function'){
    const c=v95AdminCentroid(feature); if(c) return c;
  }
  const b=geoBBoxFromFeatures([feature]);
  return [(b[0]+b[2])/2, (b[1]+b[3])/2];
}
function v98BuildExportProjection(features){
  const ex=ensureExportFlags();
  const {w,h}=exportMapSize();
  const fieldRect=exportMapFieldRect(w,h);
  const sourceBBox=geoBBoxFromFeatures(features);
  const base=(typeof v66MakeFeatureFitProjection==='function')
    ? v66MakeFeatureFitProjection(features, sourceBBox, fieldRect.w, fieldRect.h, Number(ex.minLayerPaddingPx)||10)
    : makeExportProjection(sourceBBox, fieldRect.w, fieldRect.h, Number(ex.minLayerPaddingPx)||10);
  return (lon,lat)=>{ const p=base(lon,lat); return {x:p.x+fieldRect.x, y:p.y+fieldRect.y}; };
}
function v98RelationStroke(relation){
  if(relation==='same_parent') return {stroke:'#0477bf', dash:''};
  if(relation==='same_superparent') return {stroke:'#7c3fb4', dash:'10 7'};
  if(relation==='cross_parent') return {stroke:'#e15400', dash:'3 7'};
  return {stroke:'#4b5563', dash:'4 6'};
}
async function v98ExportTopologySvg(){
  const ex=ensureExportFlags();
  if(!ex.showTopologyEdges && !ex.showTopologyNodes) return '';
  const features=(typeof v66ExportSourceFeatures==='function') ? v66ExportSourceFeatures(exportScopeFeatures()) : exportScopeFeatures();
  if(!features?.length) return '';
  const project=v98BuildExportProjection(features);
  const byId=new Map();
  const nodeRows=[];
  features.forEach(f=>{
    if(!v96IsNormalTopologyFeature(f)) return;
    const c=v98ExportCentroid(f); if(!c) return;
    const pt=project(c[0],c[1]);
    const row={feature:f, coord:c, pt};
    nodeRows.push(row);
    v98ExportFeatureIds(f).forEach(id=>{ if(id && !byId.has(id)) byId.set(String(id), row); });
  });
  if(!nodeRows.length) return '';
  let edgeSvg='';
  if(ex.showTopologyEdges){
    let raw={features:[]};
    try{ raw=await v90LoadTopologyEdges(state.year); }catch(e){ console.warn('v98 export topology edges skipped', e); }
    const edges=(raw.features||[]).filter(e=>byId.has(String(e.properties?.source_id||'')) && byId.has(String(e.properties?.target_id||'')));
    edgeSvg=edges.map(e=>{
      const p=e.properties||{};
      const a=byId.get(String(p.source_id||'')), b=byId.get(String(p.target_id||''));
      if(!a||!b) return '';
      const st=v98RelationStroke(p.relation);
      const dash=st.dash ? ` stroke-dasharray="${st.dash}"` : '';
      return `<line x1="${a.pt.x.toFixed(1)}" y1="${a.pt.y.toFixed(1)}" x2="${b.pt.x.toFixed(1)}" y2="${b.pt.y.toFixed(1)}" stroke="#fff8e6" stroke-width="7.2" stroke-opacity="0.82" stroke-linecap="round"/><line x1="${a.pt.x.toFixed(1)}" y1="${a.pt.y.toFixed(1)}" x2="${b.pt.x.toFixed(1)}" y2="${b.pt.y.toFixed(1)}" stroke="${st.stroke}" stroke-width="3.2" stroke-opacity="0.96" stroke-linecap="round"${dash}/>`;
    }).join('');
  }
  let nodeSvg='';
  if(ex.showTopologyNodes){
    const metric=typeof v96TopologyMetricField==='function' ? v96TopologyMetricField() : 'topo_degree';
    const vals=nodeRows.map(r=>v96NodeMetricValue(r.feature,metric)).filter(Number.isFinite);
    nodeSvg=nodeRows.map(r=>{
      let colors={fill:'#f6c85f', outer:'#083344'};
      try{ colors=v96CentroidNodeColors(r.feature, vals, metric); }catch(_){ }
      const selected=state.selectedIds?.has(featureId(r.feature));
      const rad=selected?4.8:3.8;
      return `<circle cx="${r.pt.x.toFixed(1)}" cy="${r.pt.y.toFixed(1)}" r="${(rad+2.5).toFixed(1)}" fill="#fff8e6" fill-opacity="0.90" stroke="${selected?'#ff2a8a':'#083344'}" stroke-width="1.25"/><circle cx="${r.pt.x.toFixed(1)}" cy="${r.pt.y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${colors.fill||'#f6c85f'}" stroke="#fff8e6" stroke-width="1.4"/>`;
    }).join('');
  }
  return `<g class="export-topology-v98" pointer-events="none">${edgeSvg}${nodeSvg}</g>`;
}
const v98PriorBuildExportSvgMap = typeof buildExportSvgMap==='function' ? buildExportSvgMap : null;
buildExportSvgMap = async function buildExportSvgMapV98(){
  let svg=v98PriorBuildExportSvgMap ? await v98PriorBuildExportSvgMap() : '';
  try{
    const topo=await v98ExportTopologySvg();
    if(topo) svg=svg.replace('</g></g>', `${topo}</g></g>`);
  }catch(e){ console.warn('v98 export topology injection skipped', e); }
  return svg;
};
const v98PriorExportMapCacheKey = typeof v68ExportMapCacheKey==='function' ? v68ExportMapCacheKey : null;
v68ExportMapCacheKey = function v68ExportMapCacheKeyV98(){
  const base=v98PriorExportMapCacheKey ? v98PriorExportMapCacheKey() : String(Date.now());
  const ex=ensureExportFlags();
  const legend=Object.keys(ex.legendItems||{}).sort().map(k=>`${k}:${ex.legendItems[k]?'1':'0'}`).join(',');
  return `${base}§topology:${ex.showTopologyEdges?'E1':'E0'}${ex.showTopologyNodes?'N1':'N0'}§legend:${legend}`;
};
if(typeof v69ExportPreviewShellSignature==='function'){
  const v98PriorShellSignature = v69ExportPreviewShellSignature;
  v69ExportPreviewShellSignature = function v69ExportPreviewShellSignatureV98(features,w,h){
    const ex=ensureExportFlags();
    const legend=Object.keys(ex.legendItems||{}).sort().map(k=>`${k}:${ex.legendItems[k]?'1':'0'}`).join(',');
    return `${v98PriorShellSignature(features,w,h)}§${ex.showTopologyEdges?'E1':'E0'}${ex.showTopologyNodes?'N1':'N0'}§${legend}`;
  };
}
(function v98Boot(){
  const boot=()=>{
    try{
      v97BuildTopologyCentroids?.();
      updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
    }catch(e){ console.warn('v98 boot skipped', e); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,980),{once:true}); else setTimeout(boot,980);
})();


/* v99: topology nodes from topology_nodes_YYYY.geojson, not calculated polygon centroids.
   Reason: the JSON nodes are the canonical graph coordinates and coincide with edge endpoints.
   The DOM overlay remains, but positions come from data/topology/topology_nodes_*.geojson. */
function v99NodeIdsFromProps(p){
  return [p?.unit_id, p?.topology_node_id, p?.node_id, p?.id]
    .map(x=>String(x||'').trim())
    .filter(Boolean);
}
function v99IsNormalTopologyProps(p){
  if(!p) return false;
  if(p.topology_excluded || p.adjacency_excluded) return false;
  if(p.include_in_analytics === false) return false;
  const area=Number(p.area_km2);
  if(Number.isFinite(area) && area < 50) return false;
  const code=String(p.special_status_code || '').trim();
  if(code && code !== 'normal') return false;
  return true;
}
function v99CurrentAllowedAdminById(){
  const byId=new Map();
  const selected=(state.selectedIds && state.selectedIds.size) ? state.selectedIds : null;
  (state.currentGeoJSON?.features||[]).forEach(f=>{
    const p=f?.properties||{};
    if(!v99IsNormalTopologyProps(p)) return;
    const fid=featureId(f);
    if(selected && !selected.has(fid)) return;
    [fid, ...v99NodeIdsFromProps(p)].forEach(id=>{ if(id && !byId.has(String(id))) byId.set(String(id), f); });
  });
  return byId;
}
function v99NodeLatLng(nodeFeature){
  const p=nodeFeature?.properties||{};
  let lon=null, lat=null;
  const c=nodeFeature?.geometry?.coordinates;
  if(Array.isArray(c) && c.length>=2){ lon=Number(c[0]); lat=Number(c[1]); }
  if(!Number.isFinite(lon)) lon=Number(p.node_lon);
  if(!Number.isFinite(lat)) lat=Number(p.node_lat);
  if(!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return L.latLng(lat, lon);
}
function v99FeatureFromNodeAndAdmin(nodeFeature, adminFeature){
  const nodeProps=nodeFeature?.properties||{};
  const adminProps=adminFeature?.properties||{};
  return {
    ...(adminFeature||nodeFeature||{}),
    type:'Feature',
    properties:{...adminProps, ...nodeProps, topology_node_renderer:'json_topology_nodes_dom_v99'},
    geometry:adminFeature?.geometry || nodeFeature?.geometry || null
  };
}
async function v99BuildTopologyJsonNodes(){
  v96SyncLegacyTopologyControls();
  try{ clearLayer('topologyCentroids'); state.layers.topologyCentroids=null; }catch(_){ }
  v97EnsureTopologyDomEvents();
  const layer=v97GetTopologyDomLayer();
  v97ClearTopologyDomNodes();
  state._topologyNodeFeaturesV96=[];
  if(!state.map || !state.currentGeoJSON || !layer){
    if(layer) layer.style.display='none';
    return;
  }
  const token=(state._topologyNodeRenderTokenV99||0)+1;
  state._topologyNodeRenderTokenV99=token;
  const byId=v99CurrentAllowedAdminById();
  if(!byId.size){
    v97PositionTopologyDomNodes();
    const prev=state.topologyEdgeStats||{year:state.year, counts:{}, total:0};
    state.topologyEdgeStats={...prev, year:state.year, nodes:0, renderer:'json_topology_nodes_dom_v99'};
    return;
  }
  const metric=v96TopologyMetricField();
  let raw={type:'FeatureCollection',features:[]};
  try{ raw=await v90LoadTopologyNodes(state.year); }
  catch(e){ console.warn('v99 topology JSON nodes skipped', e); }
  if(token!==state._topologyNodeRenderTokenV99) return;
  const rows=[];
  (raw.features||[]).forEach(n=>{
    const np=n?.properties||{};
    if(!v99IsNormalTopologyProps(np)) return;
    const ids=v99NodeIdsFromProps(np);
    const admin=ids.map(id=>byId.get(String(id))).find(Boolean);
    if(!admin) return;
    const latlng=v99NodeLatLng(n);
    if(!latlng) return;
    rows.push({node:n, admin, feature:v99FeatureFromNodeAndAdmin(n, admin), latlng});
  });
  const vals=rows.map(r=>v96NodeMetricValue(r.feature,metric)).filter(Number.isFinite);
  const nodes=[];
  const nodeFeatures=[];
  rows.forEach(r=>{
    const el=v97BuildDomNodeElement(r.feature, r.latlng, vals, metric);
    layer.appendChild(el);
    nodes.push({el, latlng:r.latlng, feature:r.feature, nodeFeature:r.node});
    const p=r.feature.properties||{};
    nodeFeatures.push({
      type:'Feature',
      properties:{...p, topology_node_renderer:'json_topology_nodes_dom_v99'},
      geometry:{type:'Point', coordinates:[r.latlng.lng, r.latlng.lat]}
    });
  });
  state._topologyDomNodesV97=nodes;
  state._topologyNodeFeaturesV96=nodeFeatures;
  state._topologyNodeFeaturesV95=nodeFeatures;
  state._topologyNodeFeaturesV93=nodeFeatures;
  state._topologyNodeFeaturesV92=nodeFeatures;
  state._topologyNodeFeaturesV91=nodeFeatures;
  const prev=state.topologyEdgeStats||{year:state.year, counts:{}, total:0};
  state.topologyEdgeStats={...prev, year:state.year, nodes:nodeFeatures.length, renderer:'json_topology_nodes_dom_v99'};
  v97PositionTopologyDomNodes();
  try{ updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []); }catch(_){ }
}

/* Replace the v97/v98 DOM-node builder with the same visible DOM technique,
   but its label and click target now refer to the canonical JSON graph node. */
v97BuildDomNodeElement = function v97BuildDomNodeElementV99(f, latlng, vals, metric){
  const p=f?.properties||{};
  const base=(typeof v96CentroidNodeRadius==='function'?v96CentroidNodeRadius(f):10)+2;
  const r=Math.max(5, Math.min(11, base/2));
  let colors={fill:'#f6c85f', line:'#fff8e6', outer:'#083344'};
  try{ colors=v96CentroidNodeColors(f, vals, metric); }catch(_){ }
  const id=featureId(f);
  const selected=state.selectedIds?.has(id);
  const degree=Number(p.topo_degree);
  const el=document.createElement('button');
  el.type='button';
  el.className='topology-dom-centroid-v97 topology-dom-centroid-v98 topology-dom-node-v99'+(selected?' selected':'')+(((Number(p.topo_bridge_incident_count)||0)>0 || p.topo_bridge_endpoint)?' bridge':'');
  el.dataset.featureId=id;
  el.dataset.nodeRenderer='json_topology_nodes_dom_v99';
  el.style.width=`${(r*2).toFixed(1)}px`;
  el.style.height=`${(r*2).toFixed(1)}px`;
  el.style.background=colors.fill || '#f6c85f';
  el.style.borderColor=selected?'#ff2a8a':(colors.line || '#fff8e6');
  el.style.setProperty('--topology-node-outer', colors.outer || '#083344');
  el.title=`${p.name||'АТЕ'} — JSON-узел графа; соседей: ${Number.isFinite(degree)?degree:'—'}`;
  ['mousedown','mouseup','click','dblclick','touchstart','touchend','wheel'].forEach(type=>{
    el.addEventListener(type, ev=>ev.stopPropagation(), {passive:type==='wheel'?false:undefined});
  });
  el.addEventListener('mouseover', ev=>{
    const metricLabel=typeof v91CleanTopologyMetricLabel==='function' ? v91CleanTopologyMetricLabel(metric) : metric;
    const metricValue=typeof v90MetricValueLabel==='function' ? v90MetricValueLabel(v96NodeMetricValue(f,metric),metric) : num1(v96NodeMetricValue(f,metric));
    showHoverLater({
      title:p.name||'АТЕ',
      subtitle:'узел графа из topology_nodes JSON · DOM-слой v99',
      extra:`${escapeHtml(metricLabel)}: ${metricValue} · соседей: ${Number.isFinite(degree)?degree:'—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'}`,
      population:p.population,
      area:p.area_km2,
      density:p.density,
      delay:60
    }, ev);
  });
  el.addEventListener('mousemove', ev=>moveHover(ev));
  el.addEventListener('mouseout', hideHover);
  el.addEventListener('click', ev=>{
    ev.preventDefault(); ev.stopPropagation();
    if(state.tool !== 'pan') return;
    if(isSelectableFeature(f)) toggleSelection(f);
    showFeature(f);
    setTimeout(v99BuildTopologyJsonNodes, 0);
  });
  return el;
};

v96BuildTopologyCentroids = v99BuildTopologyJsonNodes;
v97BuildTopologyCentroids = v99BuildTopologyJsonNodes;

const v99PriorBuildTopologyLegend = v96BuildTopologyLegend;
v96BuildTopologyLegend = function v96BuildTopologyLegendV99(gj){
  const base=(typeof v93BuildTopologyLegend==='function') ? v93BuildTopologyLegend(gj) : (v99PriorBuildTopologyLegend ? v99PriorBuildTopologyLegend(gj) : '');
  const nodes=state._topologyNodeFeaturesV96?.length || state._topologyDomNodesV97?.length || 0;
  const edges=state.topologyEdgeStats?.total || 0;
  const note=`<div class="mini-muted legend-scale-note-v67 v96-node-note"><b>v99:</b> узлы берутся из <code>data/topology/topology_nodes_${state.year}.geojson</code>, то есть стоят в канонических координатах графа и совпадают с концами рёбер. Показано узлов: ${num(nodes)}. Рёбра: ${num(edges)}.</div>`;
  return base ? `${base}${note}` : note;
};

/* Export topology overlay also uses JSON node coordinates, not polygon bbox centroids. */
async function v99ExportTopologySvg(){
  const ex=ensureExportFlags();
  if(!ex.showTopologyEdges && !ex.showTopologyNodes) return '';
  const features=(typeof v66ExportSourceFeatures==='function') ? v66ExportSourceFeatures(exportScopeFeatures()) : exportScopeFeatures();
  if(!features?.length) return '';
  const project=v98BuildExportProjection(features);
  const byId=new Map();
  features.forEach(f=>{
    const p=f?.properties||{};
    if(!v99IsNormalTopologyProps(p)) return;
    [featureId(f), ...v99NodeIdsFromProps(p)].forEach(id=>{ if(id && !byId.has(String(id))) byId.set(String(id), f); });
  });
  if(!byId.size) return '';
  let rawNodes={type:'FeatureCollection',features:[]};
  try{ rawNodes=await v90LoadTopologyNodes(state.year); }catch(e){ console.warn('v99 export topology nodes skipped', e); }
  const nodeRows=[];
  const nodeById=new Map();
  (rawNodes.features||[]).forEach(n=>{
    const np=n?.properties||{};
    if(!v99IsNormalTopologyProps(np)) return;
    const ids=v99NodeIdsFromProps(np);
    const admin=ids.map(id=>byId.get(String(id))).find(Boolean);
    if(!admin) return;
    const latlng=v99NodeLatLng(n); if(!latlng) return;
    const pt=project(latlng.lng, latlng.lat);
    const feature=v99FeatureFromNodeAndAdmin(n, admin);
    const row={feature, node:n, pt, coord:[latlng.lng, latlng.lat]};
    nodeRows.push(row);
    ids.forEach(id=>{ if(id && !nodeById.has(String(id))) nodeById.set(String(id), row); });
  });
  if(!nodeRows.length) return '';
  let edgeSvg='';
  if(ex.showTopologyEdges){
    let raw={features:[]};
    try{ raw=await v90LoadTopologyEdges(state.year); }catch(e){ console.warn('v99 export topology edges skipped', e); }
    const edges=(raw.features||[]).filter(e=>nodeById.has(String(e.properties?.source_id||'')) && nodeById.has(String(e.properties?.target_id||'')));
    edgeSvg=edges.map(e=>{
      const p=e.properties||{};
      const a=nodeById.get(String(p.source_id||'')), b=nodeById.get(String(p.target_id||''));
      if(!a||!b) return '';
      const st=v98RelationStroke(p.relation);
      const dash=st.dash ? ` stroke-dasharray="${st.dash}"` : '';
      return `<line x1="${a.pt.x.toFixed(1)}" y1="${a.pt.y.toFixed(1)}" x2="${b.pt.x.toFixed(1)}" y2="${b.pt.y.toFixed(1)}" stroke="#fff8e6" stroke-width="7.2" stroke-opacity="0.82" stroke-linecap="round"/><line x1="${a.pt.x.toFixed(1)}" y1="${a.pt.y.toFixed(1)}" x2="${b.pt.x.toFixed(1)}" y2="${b.pt.y.toFixed(1)}" stroke="${st.stroke}" stroke-width="3.2" stroke-opacity="0.96" stroke-linecap="round"${dash}/>`;
    }).join('');
  }
  let nodeSvg='';
  if(ex.showTopologyNodes){
    const metric=typeof v96TopologyMetricField==='function' ? v96TopologyMetricField() : 'topo_degree';
    const vals=nodeRows.map(r=>v96NodeMetricValue(r.feature,metric)).filter(Number.isFinite);
    nodeSvg=nodeRows.map(r=>{
      let colors={fill:'#f6c85f', outer:'#083344'};
      try{ colors=v96CentroidNodeColors(r.feature, vals, metric); }catch(_){ }
      const selected=state.selectedIds?.has(featureId(r.feature));
      const rad=selected?4.8:3.8;
      return `<circle cx="${r.pt.x.toFixed(1)}" cy="${r.pt.y.toFixed(1)}" r="${(rad+2.5).toFixed(1)}" fill="#fff8e6" fill-opacity="0.90" stroke="${selected?'#ff2a8a':'#083344'}" stroke-width="1.25"/><circle cx="${r.pt.x.toFixed(1)}" cy="${r.pt.y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${colors.fill||'#f6c85f'}" stroke="#fff8e6" stroke-width="1.4"/>`;
    }).join('');
  }
  return `<g class="export-topology-v99" pointer-events="none">${edgeSvg}${nodeSvg}</g>`;
}
v98ExportTopologySvg = v99ExportTopologySvg;

(function v99BootJsonTopologyNodes(){
  const boot=()=>{
    try{
      v99BuildTopologyJsonNodes();
      v96ApplyTopologyLayerVisibility();
      updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
    }catch(e){ console.warn('v99 topology JSON-node boot failed', e); }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1040),{once:true}); else setTimeout(boot,1040);
})();

/* v100: DOM graph nodes below interface, JSON-node metric sizing, richer legend, and extra multiyear metrics. */
function v100SetTopologyDomLayerZ(layer){
  if(!layer) return layer;
  layer.classList.add('topology-dom-centroid-layer-v100');
  layer.style.zIndex='820';
  layer.style.pointerEvents='none';
  return layer;
}
const v100PriorGetTopologyDomLayer = typeof v97GetTopologyDomLayer==='function' ? v97GetTopologyDomLayer : null;
if(v100PriorGetTopologyDomLayer){
  v97GetTopologyDomLayer = function v97GetTopologyDomLayerV100(){
    return v100SetTopologyDomLayerZ(v100PriorGetTopologyDomLayer());
  };
}
function v100TopologyMetricField(){
  return (typeof v96TopologyMetricField==='function' ? v96TopologyMetricField() : ($('topologyMetricSelect')?.value || state.topologyMetric || 'topo_degree')) || 'topo_degree';
}
function v100NodeMetricRadius(f, vals, metric){
  const v=typeof v96NodeMetricValue==='function' ? v96NodeMetricValue(f, metric) : Number(f?.properties?.[metric]);
  let raw=null;
  try{ raw = typeof v90NodeRadius==='function' ? v90NodeRadius(v, vals || [], metric) : null; }catch(_){ raw=null; }
  if(!Number.isFinite(raw)){
    const d=Number(f?.properties?.topo_degree);
    raw=8+(Number.isFinite(d)?Math.min(10,d):1);
  }
  const selected=state.selectedIds?.has(featureId(f));
  return Math.max(4.5, Math.min(10.5, raw*0.58 + (selected?1.2:0)));
}
function v100MetricCssToken(metric){ return String(metric||'metric').replace(/[^a-zA-Z0-9_-]+/g,'_'); }
function v100BuildDomNodeElement(f, latlng, vals, metric){
  const p=f?.properties||{};
  const r=v100NodeMetricRadius(f, vals, metric);
  let colors={fill:'#f6c85f', line:'#fff8e6', outer:'#083344'};
  try{ colors=v96CentroidNodeColors(f, vals, metric); }catch(_){ }
  const id=featureId(f);
  const selected=state.selectedIds?.has(id);
  const degree=Number(p.topo_degree);
  const value=typeof v96NodeMetricValue==='function' ? v96NodeMetricValue(f,metric) : Number(p[metric]);
  const el=document.createElement('button');
  el.type='button';
  el.className='topology-dom-centroid-v97 topology-dom-centroid-v98 topology-dom-node-v99 topology-dom-node-v100 metric-'+v100MetricCssToken(metric)+(selected?' selected':'')+(((Number(p.topo_bridge_incident_count)||0)>0 || p.topo_bridge_endpoint)?' bridge':'');
  el.dataset.featureId=id;
  el.dataset.nodeRenderer='json_topology_nodes_dom_v100';
  el.dataset.nodeMetric=metric;
  if(Number.isFinite(value)) el.dataset.nodeMetricValue=String(value);
  el.style.width=`${(r*2).toFixed(1)}px`;
  el.style.height=`${(r*2).toFixed(1)}px`;
  el.style.background=colors.fill || '#f6c85f';
  el.style.borderColor=selected?'#ff2a8a':(colors.line || '#fff8e6');
  el.style.setProperty('--topology-node-outer', colors.outer || '#083344');
  el.title=`${p.name||'АТЕ'} — JSON-узел графа; ${typeof v91CleanTopologyMetricLabel==='function'?v91CleanTopologyMetricLabel(metric):metric}: ${Number.isFinite(value) ? (typeof v90MetricValueLabel==='function'?v90MetricValueLabel(value,metric):num1(value)) : '—'}; соседей: ${Number.isFinite(degree)?degree:'—'}`;
  ['mousedown','mouseup','click','dblclick','touchstart','touchend','wheel'].forEach(type=>{
    el.addEventListener(type, ev=>ev.stopPropagation(), {passive:type==='wheel'?false:undefined});
  });
  el.addEventListener('mouseover', ev=>{
    const metricLabel=typeof v91CleanTopologyMetricLabel==='function' ? v91CleanTopologyMetricLabel(metric) : metric;
    const metricValue=typeof v90MetricValueLabel==='function' ? v90MetricValueLabel(value,metric) : num1(value);
    showHoverLater({
      title:p.name||'АТЕ',
      subtitle:'узел графа из topology_nodes JSON · DOM-слой v100',
      extra:`${escapeHtml(metricLabel)}: ${metricValue} · соседей: ${Number.isFinite(degree)?degree:'—'} · k-core: ${p.topo_k_core ?? '—'} · внешних связей: ${p.topo_external_degree ?? '—'}`,
      population:p.population,
      area:p.area_km2,
      density:p.density,
      delay:60
    }, ev);
  });
  el.addEventListener('mousemove', ev=>moveHover(ev));
  el.addEventListener('mouseout', hideHover);
  el.addEventListener('click', ev=>{
    ev.preventDefault(); ev.stopPropagation();
    if(state.tool !== 'pan') return;
    if(isSelectableFeature(f)) toggleSelection(f);
    showFeature(f);
    setTimeout(()=>{ try{ v99BuildTopologyJsonNodes(); }catch(_){ } }, 0);
  });
  return el;
}
if(typeof v97BuildDomNodeElement==='function') v97BuildDomNodeElement = v100BuildDomNodeElement;
function v100TopologyStats(){
  const stats=(state.topologyEdgeStats && state.topologyEdgeStats.year===state.year) ? state.topologyEdgeStats : {counts:{},total:0,nodes:0};
  const nodeFeatures=(state._topologyNodeFeaturesV96&&state._topologyNodeFeaturesV96.length) ? state._topologyNodeFeaturesV96 : (state._topologyDomNodesV97||[]).map(d=>d.feature).filter(Boolean);
  return {stats, nodeFeatures};
}
function v100LegendCountMarkup(count){
  const n=Number(count)||0;
  return `<span class="legend-count-gap-v92" aria-hidden="true">•</span><span class="legend-count-v92">${num(n)} шт.</span>`;
}
function v100EdgeRelationRows(counts, stats){
  const labels=typeof v88EdgeRelationLabels==='function' ? v88EdgeRelationLabels() : {};
  if(typeof v90EdgeStyleMode==='function' && v90EdgeStyleMode()==='uniform'){
    return `<div class="legend-row legend-row-counted-v92"><span class="topology-edge-uniform-v90"></span><span>рёбра графа, единый стиль</span>${v100LegendCountMarkup(stats.total||0)}</div>`;
  }
  return [['same_parent','topology-edge-same-v90'],['same_superparent','topology-edge-super-v90'],['cross_parent','topology-edge-cross-v90'],['unknown','topology-edge-unknown-v90']]
    .filter(([k])=>k!=='unknown' || (counts[k]||0)>0)
    .map(([k,cls])=>`<div class="legend-row legend-row-counted-v92"><span class="${cls}"></span><span>${escapeHtml(labels[k]||'прочие связи')}</span>${v100LegendCountMarkup(counts[k]||0)}</div>`).join('');
}
function v100NodeClassRows(nodeFeatures, metric){
  const vals=(nodeFeatures||[]).map(f=>typeof v96NodeMetricValue==='function' ? v96NodeMetricValue(f,metric) : Number(f?.properties?.[metric])).filter(Number.isFinite);
  const bins=typeof v90TopologyMetricBins==='function' ? v90TopologyMetricBins(vals,metric) : [];
  if(!bins.length) return '<div class="mini-muted legend-scale-note-v67">Нет числовых значений выбранной метрики узлов.</div>';
  return bins.map(b=>`<div class="legend-row legend-row-counted-v92"><span class="topology-node-class-swatch-v100" style="background:${b.color}"></span><span>${escapeHtml(b.label)}</span>${v100LegendCountMarkup(b.count)}</div>`).join('');
}
function v100TopologyLegendHtml(items={}, exportMode=false){
  const edgesOn=!!items.topologyEdges && v98ExportOrInteractiveLayerOn?.('topologyEdges', exportMode);
  const nodesOn=!!items.topologyNodes && v98ExportOrInteractiveLayerOn?.('topologyNodes', exportMode);
  const {stats,nodeFeatures}=v100TopologyStats();
  const counts=stats.counts||{};
  const metric=v100TopologyMetricField();
  const metricLabel=typeof v91CleanTopologyMetricLabel==='function' ? v91CleanTopologyMetricLabel(metric) : metric;
  const parts=[];
  if(edgesOn){
    const showClasses=items.topologyEdgeClasses !== false;
    const showBridges=items.topologyBridgeEdges !== false;
    parts.push('<div class="legend-section">Рёбра смежности</div>');
    if(showClasses) parts.push(v100EdgeRelationRows(counts, stats));
    else parts.push(`<div class="legend-row legend-row-counted-v92"><span class="topology-edge-uniform-v90"></span><span>рёбра смежности</span>${v100LegendCountMarkup(stats.total||0)}</div>`);
    if(showBridges) parts.push(`<div class="legend-row legend-row-counted-v92"><span class="topology-edge-bridge-v90"></span><span>мостовые рёбра</span>${v100LegendCountMarkup(counts.bridges||0)}</div>`);
  }
  if(nodesOn){
    const bridgeNodes=(nodeFeatures||[]).filter(f=>(Number(f?.properties?.topo_bridge_incident_count)||0)>0 || !!f?.properties?.topo_bridge_endpoint).length;
    const showClasses=items.topologyNodeClasses !== false;
    const showBridgeNodes=items.topologyBridgeNodes !== false;
    parts.push(`<div class="legend-section">Узлы графа · ${escapeHtml(metricLabel)}</div>`);
    if(showClasses) parts.push(v100NodeClassRows(nodeFeatures, metric));
    if(items.topologyNodeBase !== false) parts.push(`<div class="legend-row legend-row-counted-v92"><span class="topology-node-swatch-v98"></span><span>JSON-точки узлов; цвет/размер = выбранная метрика</span>${v100LegendCountMarkup(stats.nodes || nodeFeatures.length || 0)}</div>`);
    if(showBridgeNodes && bridgeNodes>0) parts.push(`<div class="legend-row legend-row-counted-v92"><span class="topology-node-bridge-swatch-v100"></span><span>узлы при мостовых рёбрах</span>${v100LegendCountMarkup(bridgeNodes)}</div>`);
  }
  if(parts.length){
    parts.push('<div class="mini-muted legend-scale-note-v67">v100: рёбра следуют выбранному стилю рёбер, узлы — метрике из списка «Метрика узлов». Спорные, двоеданческие, слабоконтрольные и малые (&lt;50 км²) единицы не учитываются.</div>');
  }
  return parts.length ? `<div class="legend-topology-v91 legend-topology-v92 legend-topology-v93 legend-topology-v100">${parts.join('')}</div>` : '';
}
if(typeof v98TopologyLegendHtml==='function') v98TopologyLegendHtml = v100TopologyLegendHtml;
const v100PriorDefaultLegendItems = typeof v98DefaultLegendItems==='function' ? v98DefaultLegendItems : null;
if(v100PriorDefaultLegendItems){
  v98DefaultLegendItems = function v98DefaultLegendItemsV100(){
    const o=v100PriorDefaultLegendItems() || {};
    o.topologyEdgeClasses = !!o.topologyEdges;
    o.topologyBridgeEdges = !!o.topologyEdges;
    o.topologyNodeClasses = !!o.topologyNodes;
    o.topologyNodeBase = !!o.topologyNodes;
    o.topologyBridgeNodes = !!o.topologyNodes;
    return o;
  };
}
const v100PriorSyncExportLayerDefaultsFromInteractive = typeof v98SyncExportLayerDefaultsFromInteractive==='function' ? v98SyncExportLayerDefaultsFromInteractive : null;
if(v100PriorSyncExportLayerDefaultsFromInteractive){
  v98SyncExportLayerDefaultsFromInteractive = function v98SyncExportLayerDefaultsFromInteractiveV100(forceLegend=true){
    v100PriorSyncExportLayerDefaultsFromInteractive(forceLegend);
    const ex=ensureExportFlags();
    if(!ex.legendItems || typeof ex.legendItems!=='object') ex.legendItems={};
    if(forceLegend || typeof ex.legendItems.topologyEdgeClasses!=='boolean') ex.legendItems.topologyEdgeClasses=!!ex.legendItems.topologyEdges;
    if(forceLegend || typeof ex.legendItems.topologyBridgeEdges!=='boolean') ex.legendItems.topologyBridgeEdges=!!ex.legendItems.topologyEdges;
    if(forceLegend || typeof ex.legendItems.topologyNodeClasses!=='boolean') ex.legendItems.topologyNodeClasses=!!ex.legendItems.topologyNodes;
    if(forceLegend || typeof ex.legendItems.topologyNodeBase!=='boolean') ex.legendItems.topologyNodeBase=!!ex.legendItems.topologyNodes;
    if(forceLegend || typeof ex.legendItems.topologyBridgeNodes!=='boolean') ex.legendItems.topologyBridgeNodes=!!ex.legendItems.topologyNodes;
  };
}
const v100PriorEnsureExportFlags = typeof ensureExportFlags==='function' ? ensureExportFlags : null;
if(v100PriorEnsureExportFlags){
  ensureExportFlags = function ensureExportFlagsV100(){
    const ex=v100PriorEnsureExportFlags();
    if(!ex.legendItems || typeof ex.legendItems!=='object') ex.legendItems={};
    if(typeof ex.legendItems.topologyEdgeClasses!=='boolean') ex.legendItems.topologyEdgeClasses=!!ex.legendItems.topologyEdges;
    if(typeof ex.legendItems.topologyBridgeEdges!=='boolean') ex.legendItems.topologyBridgeEdges=!!ex.legendItems.topologyEdges;
    if(typeof ex.legendItems.topologyNodeClasses!=='boolean') ex.legendItems.topologyNodeClasses=!!ex.legendItems.topologyNodes;
    if(typeof ex.legendItems.topologyNodeBase!=='boolean') ex.legendItems.topologyNodeBase=!!ex.legendItems.topologyNodes;
    if(typeof ex.legendItems.topologyBridgeNodes!=='boolean') ex.legendItems.topologyBridgeNodes=!!ex.legendItems.topologyNodes;
    return ex;
  };
}
const v100PriorLegendControlDefs = typeof v98LegendControlDefs==='function' ? v98LegendControlDefs : null;
if(v100PriorLegendControlDefs){
  v98LegendControlDefs = function v98LegendControlDefsV100(){
    const base=v100PriorLegendControlDefs().filter(d=>!['topologyEdgeClasses','topologyBridgeEdges','topologyNodeClasses','topologyNodeBase','topologyBridgeNodes'].includes(d[0]));
    const out=[];
    base.forEach(d=>{
      out.push(d);
      if(d[0]==='topologyEdges'){
        out.push(['topologyEdgeClasses','Классы рёбер по типу связи / единый стиль','topologyEdges']);
        out.push(['topologyBridgeEdges','Мостовые рёбра','topologyEdges']);
      }
      if(d[0]==='topologyNodes'){
        out.push(['topologyNodeClasses','Классы узлов по выбранной метрике','topologyNodes']);
        out.push(['topologyNodeBase','Общий символ JSON-узлов','topologyNodes']);
        out.push(['topologyBridgeNodes','Узлы при мостовых рёбрах','topologyNodes']);
      }
    });
    return out;
  };
}
const v100PriorBuildLegendHtml = typeof v98BuildLegendHtml==='function' ? v98BuildLegendHtml : null;
if(v100PriorBuildLegendHtml){
  v98BuildLegendHtml = function v98BuildLegendHtmlV100(options={}){
    const html=v100PriorBuildLegendHtml(options);
    return String(html||'').replace('export-legend-wrap-v98','export-legend-wrap-v98 export-legend-wrap-v100');
  };
}
exportLegendHtml = function exportLegendHtmlV100(){
  return `<div class="export-legend-wrap export-legend-wrap-v98 export-legend-wrap-v100">${v98BuildLegendHtml({exportMode:true, includeTitle:false})}</div>`;
};
function v100ExportRelationStroke(p){
  const rel=typeof p==='string' ? p : p?.relation;
  const bridge=typeof p==='object' && !!p?.is_bridge;
  if(typeof v90EdgeStyleMode==='function' && v90EdgeStyleMode()==='uniform') return {stroke:bridge?'#111827':'#263241', dash:''};
  if(rel==='same_parent') return {stroke:'#0477bf', dash:''};
  if(rel==='same_superparent') return {stroke:'#7c3fb4', dash:'10 7'};
  if(rel==='cross_parent') return {stroke:'#e15400', dash:'3 7'};
  return {stroke:'#4b5563', dash:'4 6'};
}
async function v100ExportTopologySvg(){
  const ex=ensureExportFlags();
  if(!ex.showTopologyEdges && !ex.showTopologyNodes) return '';
  const features=(typeof v66ExportSourceFeatures==='function') ? v66ExportSourceFeatures(exportScopeFeatures()) : exportScopeFeatures();
  if(!features?.length) return '';
  const project=v98BuildExportProjection(features);
  const byId=new Map();
  features.forEach(f=>{
    const p=f?.properties||{};
    if(typeof v99IsNormalTopologyProps==='function' ? !v99IsNormalTopologyProps(p) : !v96IsNormalTopologyFeature(f)) return;
    [featureId(f), ...(typeof v99NodeIdsFromProps==='function'?v99NodeIdsFromProps(p):[]), p.unit_id, p.topology_node_id].map(x=>String(x||'')).filter(Boolean).forEach(id=>{ if(!byId.has(id)) byId.set(id,f); });
  });
  if(!byId.size) return '';
  let rawNodes={type:'FeatureCollection',features:[]};
  try{ rawNodes=await v90LoadTopologyNodes(state.year); }catch(e){ console.warn('v100 export topology nodes skipped', e); }
  const nodeRows=[];
  const nodeById=new Map();
  (rawNodes.features||[]).forEach(n=>{
    const np=n?.properties||{};
    if(typeof v99IsNormalTopologyProps==='function' && !v99IsNormalTopologyProps(np)) return;
    const ids=typeof v99NodeIdsFromProps==='function' ? v99NodeIdsFromProps(np) : [np.unit_id,np.topology_node_id,np.id].map(x=>String(x||'')).filter(Boolean);
    const admin=ids.map(id=>byId.get(String(id))).find(Boolean);
    if(!admin) return;
    const latlng=typeof v99NodeLatLng==='function' ? v99NodeLatLng(n) : null;
    if(!latlng) return;
    const pt=project(latlng.lng, latlng.lat);
    const feature=typeof v99FeatureFromNodeAndAdmin==='function' ? v99FeatureFromNodeAndAdmin(n, admin) : n;
    const row={feature,node:n,pt,coord:[latlng.lng,latlng.lat]};
    nodeRows.push(row);
    ids.forEach(id=>{ if(id && !nodeById.has(String(id))) nodeById.set(String(id), row); });
  });
  if(!nodeRows.length) return '';
  let edgeSvg='';
  if(ex.showTopologyEdges){
    let raw={features:[]};
    try{ raw=await v90LoadTopologyEdges(state.year); }catch(e){ console.warn('v100 export topology edges skipped', e); }
    const edges=(raw.features||[]).filter(e=>nodeById.has(String(e.properties?.source_id||'')) && nodeById.has(String(e.properties?.target_id||'')));
    edgeSvg=edges.map(e=>{
      const p=e.properties||{};
      const a=nodeById.get(String(p.source_id||'')), b=nodeById.get(String(p.target_id||''));
      if(!a||!b) return '';
      const st=v100ExportRelationStroke(p);
      const dash=st.dash ? ` stroke-dasharray="${st.dash}"` : '';
      const mainW=p.is_bridge?3.8:3.2;
      return `<line x1="${a.pt.x.toFixed(1)}" y1="${a.pt.y.toFixed(1)}" x2="${b.pt.x.toFixed(1)}" y2="${b.pt.y.toFixed(1)}" stroke="#fff8e6" stroke-width="7.2" stroke-opacity="0.82" stroke-linecap="round"/><line x1="${a.pt.x.toFixed(1)}" y1="${a.pt.y.toFixed(1)}" x2="${b.pt.x.toFixed(1)}" y2="${b.pt.y.toFixed(1)}" stroke="${st.stroke}" stroke-width="${mainW}" stroke-opacity="0.96" stroke-linecap="round"${dash}/>`;
    }).join('');
  }
  let nodeSvg='';
  if(ex.showTopologyNodes){
    const metric=v100TopologyMetricField();
    const vals=nodeRows.map(r=>typeof v96NodeMetricValue==='function' ? v96NodeMetricValue(r.feature,metric) : Number(r.feature?.properties?.[metric])).filter(Number.isFinite);
    nodeSvg=nodeRows.map(r=>{
      let colors={fill:'#f6c85f', outer:'#083344'};
      try{ colors=v96CentroidNodeColors(r.feature, vals, metric); }catch(_){ }
      const selected=state.selectedIds?.has(featureId(r.feature));
      const rad=v100NodeMetricRadius(r.feature, vals, metric)*0.62;
      const rr=Math.max(2.9, Math.min(6.6, rad));
      const bridge=((Number(r.feature?.properties?.topo_bridge_incident_count)||0)>0 || r.feature?.properties?.topo_bridge_endpoint);
      return `<circle cx="${r.pt.x.toFixed(1)}" cy="${r.pt.y.toFixed(1)}" r="${(rr+2.2).toFixed(1)}" fill="#fff8e6" fill-opacity="0.90" stroke="${selected?'#ff2a8a':(bridge?'#111827':'#083344')}" stroke-width="1.15"/><circle cx="${r.pt.x.toFixed(1)}" cy="${r.pt.y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${colors.fill||'#f6c85f'}" stroke="#fff8e6" stroke-width="1.25"/>`;
    }).join('');
  }
  return `<g class="export-topology-v100" pointer-events="none">${edgeSvg}${nodeSvg}</g>`;
}
if(typeof v98ExportTopologySvg==='function') v98ExportTopologySvg = v100ExportTopologySvg;
function v100BindTopologyStyleControls(){
  const refresh=()=>{
    try{ v96RefreshTopologyOverlays?.(); }catch(e){ console.warn('v100 topology style refresh failed', e); }
    try{ updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []); }catch(_){ }
    try{ v68FullSvgCache?.clear?.(); }catch(_){ }
    try{ if(state.export?.open) renderExportPreviewCard(); }catch(_){ }
  };
  ['topologyEdgeStyleSelect','topologyMetricSelect','toggleTopologyEdgesMain','toggleTopologyCentroids'].forEach(id=>{
    const el=$(id);
    if(!el || el.dataset.v100TopologyStyleBound==='1') return;
    el.dataset.v100TopologyStyleBound='1';
    el.addEventListener('change', refresh, true);
    el.addEventListener('input', refresh, true);
  });
}
/* Derive requested hierarchy metrics in memory too, so older cached JSON rows still work. */
function v100NormalizeMultiyearRow(row){
  if(!row || typeof row!=='object') return row;
  const lower=Number(row.lower_ate_count);
  const upper=Number(row.upper_ate_count);
  const middle=Number(row.middle_ate_count);
  const totalArea=Number(row.total_area_km2);
  if(typeof row.avg_lower_units_per_upper_ate!=='number' && Number.isFinite(lower) && Number.isFinite(upper) && upper>0) row.avg_lower_units_per_upper_ate=Number((lower/upper).toFixed(6));
  if(typeof row.avg_area_upper_ate_km2!=='number' && Number.isFinite(totalArea) && Number.isFinite(upper) && upper>0) row.avg_area_upper_ate_km2=Number((totalArea/upper).toFixed(3));
  if(typeof row.avg_area_middle_ate_km2!=='number' && Number.isFinite(totalArea) && Number.isFinite(middle) && middle>0) row.avg_area_middle_ate_km2=Number((totalArea/middle).toFixed(3));
  return row;
}
const v100PriorLoadMultiyearMetrics = typeof v93LoadMultiyearMetrics==='function' ? v93LoadMultiyearMetrics : null;
if(v100PriorLoadMultiyearMetrics){
  v93LoadMultiyearMetrics = async function v93LoadMultiyearMetricsV100(){
    const rows=await v100PriorLoadMultiyearMetrics();
    return (rows||[]).map(v100NormalizeMultiyearRow);
  };
}
if(typeof v93TrendGroups==='object'){
  const admin=v93TrendGroups.admin || {label:'АТЕ и площадь', metrics:[]};
  const add=['avg_lower_units_per_upper_ate','avg_lower_units_per_parent_ate','avg_area_upper_ate_km2','avg_area_middle_ate_km2'];
  add.forEach(k=>{ if(!admin.metrics.includes(k)) admin.metrics.push(k); });
  v93TrendGroups.admin=admin;
}
if(typeof v93TrendLabels==='object'){
  Object.assign(v93TrendLabels, {
    avg_lower_units_per_upper_ate:'среднее число нижних АТЕ на единицу верхнего уровня',
    avg_lower_units_per_parent_ate:'среднее число нижних АТЕ на прямой родительский уровень',
    avg_area_upper_ate_km2:'средняя площадь АТЕ верхнего уровня, км²',
    avg_area_middle_ate_km2:'средняя площадь АТЕ среднего уровня, км²'
  });
}
const v100PriorFormatTrendValue = typeof v93FormatTrendValue==='function' ? v93FormatTrendValue : null;
if(v100PriorFormatTrendValue){
  v93FormatTrendValue = function v93FormatTrendValueV100(v,key){
    if(['avg_lower_units_per_upper_ate','avg_lower_units_per_parent_ate'].includes(key)){
      const n=Number(v); return Number.isFinite(n) ? n.toFixed(2).replace('.',',') : '—';
    }
    if(['avg_area_upper_ate_km2','avg_area_middle_ate_km2'].includes(key)){
      const n=Number(v); return Number.isFinite(n) ? (n>=100 ? num(n) : n.toFixed(1).replace('.',',')) : '—';
    }
    return v100PriorFormatTrendValue(v,key);
  };
}
const v100PriorTrendLeader = typeof v93TrendLeader==='function' ? v93TrendLeader : null;
if(v100PriorTrendLeader){
  v93TrendLeader = function v93TrendLeaderV100(row,metric){
    if(metric==='avg_lower_units_per_upper_ate') return `нижних АТЕ: ${num(row.lower_ate_count||0)}; верхних: ${num(row.upper_ate_count||0)}`;
    if(metric==='avg_lower_units_per_parent_ate') return `нижних АТЕ: ${num(row.lower_ate_count||0)}; родительских групп: ${num(row.parent_ate_count||row.middle_ate_count||row.upper_ate_count||0)}`;
    if(metric==='avg_area_upper_ate_km2') return `верхних АТЕ: ${num(row.upper_ate_count||0)}`;
    if(metric==='avg_area_middle_ate_km2') return `средних АТЕ: ${num(row.middle_ate_count||0)}`;
    return v100PriorTrendLeader(row,metric);
  };
}
(function v100Boot(){
  const boot=()=>{
    try{ v100BindTopologyStyleControls(); }catch(e){ console.warn('v100 bind skipped', e); }
    try{ v100SetTopologyDomLayerZ(state._topologyDomLayerV97 || document.getElementById('topologyCentroidDomLayerV97')); }catch(_){ }
    try{ updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []); }catch(_){ }
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1180),{once:true}); else setTimeout(boot,1180);
})();

/* v105: area-dispersion metrics by hierarchy level and upper/national context.
   Adds indicators for testing whether areas of same-level ATE become less dispersed
   as the territorial system matures. */
const v105AreaDispersionMetrics = [
  'area_cv_upper_ate','area_cv_middle_ate','area_cv_lower_ate',
  'area_gini_upper_ate','area_gini_middle_ate','area_gini_lower_ate',
  'area_p90_p10_ratio_upper_ate','area_p90_p10_ratio_middle_ate','area_p90_p10_ratio_lower_ate',
  'area_q75_q25_ratio_upper_ate','area_q75_q25_ratio_middle_ate','area_q75_q25_ratio_lower_ate',
  'area_range_ratio_upper_ate','area_range_ratio_middle_ate','area_range_ratio_lower_ate',
  'area_stddev_upper_ate_km2','area_stddev_middle_ate_km2','area_stddev_lower_ate_km2',
  'area_mean_upper_ate_km2','area_mean_middle_ate_km2','area_mean_lower_ate_km2',
  'area_median_upper_ate_km2','area_median_middle_ate_km2','area_median_lower_ate_km2',
  'area_min_upper_ate_km2','area_min_middle_ate_km2','area_min_lower_ate_km2',
  'area_max_upper_ate_km2','area_max_middle_ate_km2','area_max_lower_ate_km2',
  'area_cv_lower_within_upper_mean','area_cv_lower_within_upper_max',
  'area_gini_lower_within_upper_mean','area_gini_lower_within_upper_max',
  'area_p90_p10_lower_within_upper_mean','area_p90_p10_lower_within_upper_max'
];
const v105AreaDispersionMetricSet = new Set(v105AreaDispersionMetrics);
function v105IsAreaDispersionMetric(metric){ return v105AreaDispersionMetricSet.has(String(metric||'')); }
function v105InstallAreaDispersionMetrics(){
  if(typeof v93TrendGroups==='object'){
    v93TrendGroups.area_dispersion={label:'Разброс площадей', metrics:v105AreaDispersionMetrics.slice()};
  }
  if(typeof v93TrendLabels==='object'){
    Object.assign(v93TrendLabels, {
      area_cv_upper_ate:'CV площадей АТЕ верхнего уровня',
      area_cv_middle_ate:'CV площадей АТЕ среднего уровня',
      area_cv_lower_ate:'CV площадей АТЕ нижнего уровня',
      area_gini_upper_ate:'Gini площадей АТЕ верхнего уровня',
      area_gini_middle_ate:'Gini площадей АТЕ среднего уровня',
      area_gini_lower_ate:'Gini площадей АТЕ нижнего уровня',
      area_p90_p10_ratio_upper_ate:'p90/p10 площадей верхнего уровня',
      area_p90_p10_ratio_middle_ate:'p90/p10 площадей среднего уровня',
      area_p90_p10_ratio_lower_ate:'p90/p10 площадей нижнего уровня',
      area_q75_q25_ratio_upper_ate:'q75/q25 площадей верхнего уровня',
      area_q75_q25_ratio_middle_ate:'q75/q25 площадей среднего уровня',
      area_q75_q25_ratio_lower_ate:'q75/q25 площадей нижнего уровня',
      area_range_ratio_upper_ate:'max/min площадей верхнего уровня',
      area_range_ratio_middle_ate:'max/min площадей среднего уровня',
      area_range_ratio_lower_ate:'max/min площадей нижнего уровня',
      area_stddev_upper_ate_km2:'σ площадей верхнего уровня, км²',
      area_stddev_middle_ate_km2:'σ площадей среднего уровня, км²',
      area_stddev_lower_ate_km2:'σ площадей нижнего уровня, км²',
      area_mean_upper_ate_km2:'средняя площадь верхнего уровня, км²',
      area_mean_middle_ate_km2:'средняя площадь среднего уровня, км²',
      area_mean_lower_ate_km2:'средняя площадь нижнего уровня, км²',
      area_median_upper_ate_km2:'медианная площадь верхнего уровня, км²',
      area_median_middle_ate_km2:'медианная площадь среднего уровня, км²',
      area_median_lower_ate_km2:'медианная площадь нижнего уровня, км²',
      area_min_upper_ate_km2:'минимальная площадь верхнего уровня, км²',
      area_min_middle_ate_km2:'минимальная площадь среднего уровня, км²',
      area_min_lower_ate_km2:'минимальная площадь нижнего уровня, км²',
      area_max_upper_ate_km2:'максимальная площадь верхнего уровня, км²',
      area_max_middle_ate_km2:'максимальная площадь среднего уровня, км²',
      area_max_lower_ate_km2:'максимальная площадь нижнего уровня, км²',
      area_cv_lower_within_upper_mean:'средний CV нижних АТЕ внутри верхних контекстов',
      area_cv_lower_within_upper_max:'максимальный CV нижних АТЕ внутри верхних контекстов',
      area_gini_lower_within_upper_mean:'средний Gini нижних АТЕ внутри верхних контекстов',
      area_gini_lower_within_upper_max:'максимальный Gini нижних АТЕ внутри верхних контекстов',
      area_p90_p10_lower_within_upper_mean:'средний p90/p10 нижних АТЕ внутри верхних контекстов',
      area_p90_p10_lower_within_upper_max:'максимальный p90/p10 нижних АТЕ внутри верхних контекстов'
    });
  }
  try{ Object.assign(v90TrendLabels, v93TrendLabels); }catch(_){ }
}
v105InstallAreaDispersionMetrics();
function v105TrendContexts(data){
  const set=new Set();
  (data||[]).forEach(row=>{
    (row.area_dispersion_contexts||[]).forEach(c=>{ const name=String(c.context||c.context_key||'').trim(); if(name) set.add(name); });
  });
  return Array.from(set).sort((a,b)=>a.localeCompare(b,'ru'));
}
function v105ContextRecord(row, context){
  const name=String(context||'all');
  if(!name || name==='all') return null;
  return (row?.area_dispersion_contexts||[]).find(c=>String(c.context||c.context_key||'')===name) || null;
}
function v105TrendValue(row, metric, context){
  const rec=v105ContextRecord(row, context);
  const src=rec || row;
  const n=Number(src?.[metric]);
  return Number.isFinite(n) ? n : NaN;
}
function v105FormatAreaTrendValue(v, key){
  const n=Number(v); if(!Number.isFinite(n)) return '—';
  const k=String(key||'');
  if(k.includes('_cv_') || k.includes('_gini_')) return n.toFixed(3).replace('.',',');
  if(k.includes('_ratio_') || k.includes('p90_p10') || k.includes('q75_q25') || k.includes('range_ratio')) return n.toFixed(2).replace('.',',')+'×';
  if(k.includes('_km2')) return n>=100 ? num(n) : n.toFixed(1).replace('.',',');
  return Math.abs(n)<10 && !Number.isInteger(n) ? n.toFixed(2).replace('.',',') : num(n);
}
const v105PriorFormatTrendValue = typeof v93FormatTrendValue==='function' ? v93FormatTrendValue : null;
if(v105PriorFormatTrendValue){
  v93FormatTrendValue = function v93FormatTrendValueV105(v,key){
    if(v105IsAreaDispersionMetric(key)) return v105FormatAreaTrendValue(v,key);
    return v105PriorFormatTrendValue(v,key);
  };
}
function v105AreaTrendLeader(row, metric, context){
  const rec=v105ContextRecord(row, context);
  if(rec){
    const n=metric.includes('middle') ? rec.area_count_middle_ate : rec.area_count_lower_ate;
    return `${rec.context || context} · n=${num(n || 0)}`;
  }
  if(metric.includes('upper')) return `верхний уровень · n=${num(row.area_count_upper_ate || row.upper_ate_count || 0)}`;
  if(metric.includes('middle')) return `средний уровень · n=${num(row.area_count_middle_ate || row.middle_ate_count || 0)}`;
  if(metric.includes('lower')) return `нижний уровень · n=${num(row.area_count_lower_ate || row.lower_ate_count || 0)}`;
  if(metric.includes('within_upper')) return `контекстов: ${num(row.area_context_count_v105 || 0)}`;
  return 'без спец/спорных/слабоконтрольных и <50 км²';
}
const v105PriorTrendLeader = typeof v93TrendLeader==='function' ? v93TrendLeader : null;
if(v105PriorTrendLeader){
  v93TrendLeader = function v93TrendLeaderV105(row,metric){
    const ctx=state._topologyTrendContextV105 || 'all';
    if(v105IsAreaDispersionMetric(metric)) return v105AreaTrendLeader(row,metric,ctx);
    return v105PriorTrendLeader(row,metric);
  };
}
function v105ContextSelectorHtml(data, current){
  const contexts=v105TrendContexts(data);
  const options=['<option value="all">Весь статистический охват</option>'].concat(contexts.map(c=>`<option value="${escapeHtml(c)}" ${c===current?'selected':''}>${escapeHtml(c)}</option>`));
  return `<div class="topology-trend-control-v91 topology-trend-context-v105"><label class="control-label" for="topologyTrendContextV105">Национальный / верхний контекст</label><select id="topologyTrendContextV105">${options.join('')}</select><div class="mini-muted">Для группы «Разброс площадей» можно смотреть весь слой или отдельный верхний контекст.</div></div>`;
}
async function v105OpenMultiyearTrendsModal(){
  const data=await v93LoadMultiyearMetrics();
  if(!data.length){ alert('Нет данных динамики метрик.'); return; }
  v105InstallAreaDispersionMetrics();
  let modal=$('topologyTrendsModal') || $('chartLightbox');
  if(!modal){ modal=document.createElement('div'); modal.id='topologyTrendsModal'; document.body.appendChild(modal); }
  modal.className='chart-lightbox topology-trends-modal-v88 topology-trends-modal-v91 multiyear-trends-modal-v93 multiyear-trends-modal-v105';
  modal.setAttribute('aria-hidden','true');
  const group=state._topologyTrendGroup || v93MetricGroupFor(state._topologyTrendMetric || 'area_cv_lower_ate') || 'area_dispersion';
  let metric=state._topologyTrendMetric || v93TrendMetricOptions(group)[0];
  if(!v93TrendMetricOptions(group).includes(metric)) metric=v93TrendMetricOptions(group)[0];
  state._topologyTrendMetric=metric;
  state._topologyTrendGroup=group;
  state._topologyTrendContextV105=state._topologyTrendContextV105 || 'all';
  const cfg=v93TrendSettings();
  modal.innerHTML=`<div class="chart-lightbox-scrim" data-close-topology-trends="1"></div><section class="chart-lightbox-card" role="dialog" aria-modal="true" aria-labelledby="topologyTrendsTitle"><button type="button" class="chart-lightbox-close" aria-label="Закрыть динамику метрик">×</button><div class="chart-lightbox-kicker">Мультивременная аналитика · ${APP_VERSION}</div><h2 id="topologyTrendsTitle">Динамика метрик по годам</h2><div id="topologyTrendsBody" class="chart-lightbox-body topology-trends-body-v91 multiyear-trends-body-v93 multiyear-trends-body-v105"></div></section>`;
  modal.querySelector('.chart-lightbox-close')?.addEventListener('click',()=>{ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); });
  modal.querySelector('[data-close-topology-trends]')?.addEventListener('click',()=>{ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); });
  const body=$('topologyTrendsBody');
  const years=data.map(d=>Number(d.year)).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!state._topologyTrendYears?.length) state._topologyTrendYears=years.slice();
  const metricSelectHtml=()=>v93TrendMetricOptions(state._topologyTrendGroup || group).map(k=>`<option value="${k}" ${k===state._topologyTrendMetric?'selected':''}>${escapeHtml(v93TrendLabels[k])}</option>`).join('');
  body.innerHTML=`<div class="topology-trend-layout-v91 multiyear-trend-layout-v93">
    <aside class="topology-trend-controls-v91">
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendGroupV93">Группа показателей</label><select id="topologyTrendGroupV93">${Object.entries(v93TrendGroups).map(([k,g])=>`<option value="${k}" ${k===state._topologyTrendGroup?'selected':''}>${escapeHtml(g.label)}</option>`).join('')}</select></div>
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendMetricV90">Метрика</label><select id="topologyTrendMetricV90">${metricSelectHtml()}</select></div>
      ${v105ContextSelectorHtml(data,state._topologyTrendContextV105)}
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendScaleV91">Шкала значений</label><select id="topologyTrendScaleV91"><option value="linear" ${cfg.scale==='linear'?'selected':''}>Линейная</option><option value="log" ${cfg.scale==='log'?'selected':''}>Логарифмическая log10</option></select></div>
      <div class="topology-trend-control-v91 color-control-v91"><label class="control-label" for="topologyTrendLineColorV91">Цвет линии</label><input id="topologyTrendLineColorV91" type="color" value="${escapeHtml(v93SafeHexColor(cfg.lineColor,'#9a6a22'))}"></div>
      <div class="topology-trend-control-v91 color-control-v91"><label class="control-label" for="topologyTrendPointColorV91">Цвет точек</label><input id="topologyTrendPointColorV91" type="color" value="${escapeHtml(v93SafeHexColor(cfg.pointColor,'#f2c14e'))}"></div>
      <label class="topology-trend-check-v91"><input id="topologyTrendShowLabelsV91" type="checkbox" ${cfg.showLabels?'checked':''}> Подписывать значения над точками</label>
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendLabelSizeV91">Размер подписи: <span id="topologyTrendLabelSizeValueV91">${Number(cfg.labelSize||11)}</span> px</label><input id="topologyTrendLabelSizeV91" type="range" min="8" max="18" step="1" value="${Number(cfg.labelSize||11)}"></div>
      <button type="button" id="topologyTrendAllV90">Все годы</button><button type="button" id="topologyTrendClearV90">Снять все</button><button type="button" id="topologyTrendCoreV90">Только опорные</button>
      <div class="topology-trend-years-v90" id="topologyTrendYearsV90">${years.map(y=>`<label><input type="checkbox" value="${y}" ${state._topologyTrendYears.includes(y)?'checked':''}> ${y}</label>`).join('')}</div>
      <div class="mini-muted">Разброс площадей считается без спорных, двоеданческих, слабоконтрольных, неясных и малых (&lt;50 км²) полигонов. Исключения v104 для 1926/1930/2021 сохранены.</div>
    </aside>
    <main class="topology-trend-main-v91"><div id="topologyTrendChartV90" class="topology-trend-chart-v91"></div><div id="topologyTrendTableV90" class="topology-trend-table-v91"></div></main>
  </div>`;
  const sync=()=>{
    const groupSel=$('topologyTrendGroupV93');
    const metricSelect=$('topologyTrendMetricV90');
    const contextSelect=$('topologyTrendContextV105');
    state._topologyTrendGroup=groupSel?.value || 'area_dispersion';
    if(metricSelect && !v93TrendMetricOptions(state._topologyTrendGroup).includes(metricSelect.value)){
      metricSelect.innerHTML=v93TrendMetricOptions(state._topologyTrendGroup).map(k=>`<option value="${k}">${escapeHtml(v93TrendLabels[k])}</option>`).join('');
      metricSelect.value=v93TrendMetricOptions(state._topologyTrendGroup)[0];
    }
    state._topologyTrendMetric=metricSelect?.value || v93TrendMetricOptions(state._topologyTrendGroup)[0];
    state._topologyTrendContextV105=contextSelect?.value || 'all';
    if(contextSelect){
      const areaMetric=v105IsAreaDispersionMetric(state._topologyTrendMetric);
      contextSelect.disabled=!areaMetric;
      contextSelect.closest('.topology-trend-context-v105')?.classList.toggle('disabled',!areaMetric);
      if(!areaMetric){ state._topologyTrendContextV105='all'; contextSelect.value='all'; }
    }
    state._topologyTrendScale=$('topologyTrendScaleV91')?.value || 'linear';
    state._topologyTrendLineColor=$('topologyTrendLineColorV91')?.value || '#9a6a22';
    state._topologyTrendPointColor=$('topologyTrendPointColorV91')?.value || '#f2c14e';
    state._topologyTrendShowLabels=!!$('topologyTrendShowLabelsV91')?.checked;
    state._topologyTrendLabelSize=Number($('topologyTrendLabelSizeV91')?.value || 11);
    const labelSizeValue=$('topologyTrendLabelSizeValueV91'); if(labelSizeValue) labelSizeValue.textContent=String(state._topologyTrendLabelSize);
    state._topologyTrendYears=[...body.querySelectorAll('#topologyTrendYearsV90 input:checked')].map(i=>Number(i.value));
    v105RenderMultiyearTrendChart(data);
  };
  $('topologyTrendGroupV93')?.addEventListener('change',()=>{ const ms=$('topologyTrendMetricV90'); const g=$('topologyTrendGroupV93')?.value || 'area_dispersion'; if(ms){ ms.innerHTML=v93TrendMetricOptions(g).map(k=>`<option value="${k}">${escapeHtml(v93TrendLabels[k])}</option>`).join(''); ms.value=v93TrendMetricOptions(g)[0]; } sync(); });
  ['topologyTrendMetricV90','topologyTrendScaleV91','topologyTrendContextV105'].forEach(id=>$(id)?.addEventListener('change',sync));
  ['topologyTrendLineColorV91','topologyTrendPointColorV91','topologyTrendShowLabelsV91','topologyTrendLabelSizeV91'].forEach(id=>$(id)?.addEventListener('input',sync));
  body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.addEventListener('change',sync));
  $('topologyTrendAllV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=true); sync(); });
  $('topologyTrendClearV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=false); sync(); });
  $('topologyTrendCoreV90')?.addEventListener('click',()=>{ const core=new Set([1700,1745,1783,1798,1821,1848,1876,1897,1914,1926,1939,1959,1970,1989,2021]); body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=core.has(Number(i.value))); sync(); });
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  sync();
}
function v105RenderMultiyearTrendChart(data){
  const chart=$('topologyTrendChartV90'), table=$('topologyTrendTableV90'); if(!chart || !table) return;
  const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || 'area_cv_lower_ate';
  const context=v105IsAreaDispersionMetric(metric) ? (state._topologyTrendContextV105 || 'all') : 'all';
  const cfg=v93TrendSettings();
  const lineColor=v93SafeHexColor(cfg.lineColor,'#9a6a22');
  const pointColor=v93SafeHexColor(cfg.pointColor,'#f2c14e');
  const selectedYears=new Set((state._topologyTrendYears?.length ? state._topologyTrendYears : data.map(d=>Number(d.year))).map(Number));
  const rows=data.map(d=>({row:d, year:Number(d.year), value:v105TrendValue(d,metric,context)})).filter(d=>selectedYears.has(d.year) && Number.isFinite(d.value)).sort((a,b)=>a.year-b.year);
  if(rows.length<2){ chart.innerHTML='<div class="mini-muted">Для этой метрики/контекста выберите минимум два года с числовыми данными.</div>'; table.innerHTML=''; return; }
  const w=940,h=390,pad={l:88,r:34,t:36,b:54};
  const xs=rows.map(r=>r.year), rawYs=rows.map(r=>r.value);
  const xmin=Math.min(...xs), xmax=Math.max(...xs);
  const positives=rawYs.filter(y=>y>0);
  const useLog=cfg.scale==='log' && positives.length>0;
  const logFloor=useLog ? Math.min(...positives)/10 : null;
  const transformY=y=>useLog ? Math.log10(y>0 ? y : logFloor) : y;
  const inverseY=y=>useLog ? Math.pow(10,y) : y;
  const axisPlan=useLog ? v102NiceLogAxis(rawYs, logFloor) : v102NiceLinearAxis(rawYs, 5);
  const ys=rawYs.map(transformY);
  let ymin=axisPlan ? axisPlan.min : Math.min(...ys), ymax=axisPlan ? axisPlan.max : Math.max(...ys);
  if(ymin===ymax){ ymin-=useLog?.5:1; ymax+=useLog?.5:1; }
  const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
  const yScaleRaw=y=>h-pad.b-(transformY(y)-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const yScaleTrans=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const pts=rows.map(r=>`${xScale(r.year).toFixed(1)},${yScaleRaw(r.value).toFixed(1)}`).join(' ');
  const xTicks=rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.ceil(rows.length/9)===0).map(r=>r.year);
  const yTicks=axisPlan?.ticks?.length ? axisPlan.ticks : [0,.25,.5,.75,1].map(t=>ymin+(ymax-ymin)*t);
  const valueLabel=(v)=> v105IsAreaDispersionMetric(metric) ? v105FormatAreaTrendValue(v,metric) : v93FormatTrendValue(v,metric);
  const axisLabel=(t)=> v105IsAreaDispersionMetric(metric) ? v105FormatAreaTrendValue(inverseY(t),metric).replace('×','') : v102FormatAxisTick(inverseY(t),metric,axisPlan,useLog);
  const labelsSvg=cfg.showLabels ? rows.map(r=>{ const x=xScale(r.year); const y=Math.max(pad.t+Number(cfg.labelSize||11), yScaleRaw(r.value)-9); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="trend-point-label-v91" style="font-size:${Number(cfg.labelSize||11)}px">${escapeHtml(valueLabel(r.value))}</text>`; }).join('') : '';
  const contextSuffix=context && context!=='all' ? ` · ${context}` : '';
  const logNote=(cfg.scale==='log' && !positives.length) ? '<div class="topology-trend-note-v91">Для этой метрики нет положительных значений; показана линейная шкала.</div>' : (useLog && rawYs.some(y=>y<=0) ? '<div class="topology-trend-note-v91">Log10-шкала: нулевые значения прижаты к нижней границе.</div>' : '');
  const methodNote=v105IsAreaDispersionMetric(metric) ? '<div class="topology-trend-note-v91">Показатели разброса: CV = σ/среднее; Gini и отношения квантилей показывают неоднородность площадей единиц одного уровня. Чем ниже значение, тем ровнее сетка.</div>' : '';
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88 topology-trend-svg-v90 topology-trend-svg-v91 topology-trend-svg-v105" role="img" aria-label="Динамика ${escapeHtml(v93TrendLabels[metric]||metric)}"><rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>${yTicks.map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScaleTrans(t)}" y2="${yScaleTrans(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScaleTrans(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(axisLabel(t))}</text>`).join('')}${xTicks.map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-18}" text-anchor="middle" class="trend-label-v88">${t}</text>`).join('')}<polyline points="${pts}" fill="none" class="trend-line-v91" style="stroke:${lineColor}"/>${rows.map(r=>`<circle cx="${xScale(r.year).toFixed(1)}" cy="${yScaleRaw(r.value).toFixed(1)}" r="5.8" class="trend-point-v91" style="fill:${pointColor}"><title>${r.year}: ${valueLabel(r.value)}${contextSuffix}</title></circle>`).join('')}${labelsSvg}<text x="${pad.l}" y="22" class="trend-title-v88 trend-title-v91">${escapeHtml(v93TrendLabels[metric]||metric)}${escapeHtml(contextSuffix)} · ${useLog?'LOG10':'ЛИНЕЙНАЯ ШКАЛА'}</text></svg>${logNote}${methodNote}`;
  table.innerHTML='<div class="chart-legend-head topology-trend-head-v88 topology-trend-head-v91"><span></span><span>ГОД</span><span>ЗНАЧЕНИЕ</span><span>УРОВЕНЬ / КОНТЕКСТ</span></div>'+rows.map(r=>`<div class="chart-legend-row topology-trend-row-v88 topology-trend-row-v91"><span class="pie-dot" style="background:${pointColor}"></span><span>${r.year}</span><b>${valueLabel(r.value)}</b><em>${escapeHtml(v105IsAreaDispersionMetric(metric)?v105AreaTrendLeader(r.row,metric,context):v93TrendLeader(r.row,metric))}</em></div>`).join('');
}
try{ v93OpenMultiyearTrendsModal=v105OpenMultiyearTrendsModal; v90OpenTopologyTrendsModal=v105OpenMultiyearTrendsModal; openTopologyTrendsModal=v105OpenMultiyearTrendsModal; }catch(_){ }

/* v106: explanatory layer for multiyear metric window.
   Audience target: geographers who need cartometric meaning without diving into formulas. */
function v106AreaLevelName(metric){
  const m=String(metric||'');
  if(m.includes('within_upper')) return 'нижний уровень внутри верхних контекстов';
  if(m.includes('_upper_')) return 'верхний уровень';
  if(m.includes('_middle_')) return 'средний уровень';
  if(m.includes('_lower_')) return 'нижний уровень';
  return 'выбранный уровень';
}
function v106MetricKind(metric){
  const m=String(metric||'');
  if(m.includes('_cv_') || m.includes('area_cv_')) return 'cv';
  if(m.includes('_gini_') || m.includes('area_gini_')) return 'gini';
  if(m.includes('p90_p10')) return 'p90p10';
  if(m.includes('q75_q25')) return 'q75q25';
  if(m.includes('range_ratio')) return 'maxmin';
  if(m.includes('stddev')) return 'stddev';
  if(m.includes('median')) return 'median';
  if(m.includes('mean')) return 'mean';
  if(m.includes('_min_')) return 'min';
  if(m.includes('_max_')) return 'max';
  return 'other';
}
function v106MetricKindTitle(kind){
  return ({
    cv:'CV / коэффициент вариации',
    gini:'Gini / индекс неравномерности',
    p90p10:'p90/p10 / крупные к мелким',
    q75q25:'q75/q25 / центральный разброс',
    maxmin:'max/min / крайний размах',
    stddev:'σ / стандартное отклонение',
    mean:'средняя площадь',
    median:'медианная площадь',
    min:'минимальная площадь',
    max:'максимальная площадь',
    other:'показатель площади'
  })[kind] || 'показатель площади';
}
function v106MetricPlainText(metric){
  const kind=v106MetricKind(metric);
  const level=v106AreaLevelName(metric);
  const map={
    cv:`Показывает, насколько площади АТЕ ${level} разбросаны относительно их среднего размера. Это главный удобный показатель для сравнения разных лет: он безразмерный, поэтому подходит и для ранних огромных округов, и для поздних районов.`,
    gini:`Показывает неравномерность площадей АТЕ ${level}. 0 означает почти одинаковые площади; чем выше значение, тем сильнее система состоит из очень крупных и очень мелких единиц одновременно.`,
    p90p10:`Сравнивает «крупные, но не самые крайние» АТЕ ${level} с «мелкими, но не самыми крайними». Например, 8× значит, что верхняя крупная группа примерно в 8 раз больше нижней мелкой группы.`,
    q75q25:`Показывает разброс основной массы АТЕ ${level}, без самых крайних выбросов. Полезно, когда один гигантский северный округ ломает всю картину.`,
    maxmin:`Сравнивает самый большой и самый маленький объект ${level}. Это наглядно, но очень чувствительно к единичным выбросам и ошибкам реконструкции.`,
    stddev:`Показывает абсолютный разброс площадей АТЕ ${level} в км². Хорошо показывает масштаб неодинаковости, но хуже подходит для сравнения разных эпох с разным средним размером единиц.`,
    mean:`Средний размер АТЕ ${level}. Это не показатель разброса, а базовый ориентир: насколько крупной стала типичная единица на этом уровне.`,
    median:`Площадь «серединной» АТЕ ${level}: половина единиц меньше, половина больше. Медиана устойчивее к огромным северным территориям, чем среднее.`,
    min:`Размер самой малой АТЕ ${level} после очистки от спорных/слабоконтрольных территорий и объектов меньше 50 км².`,
    max:`Размер самой крупной АТЕ ${level}. Помогает видеть северные и окраинные гиганты, но не должен один заменять показатели разброса.`
  };
  if(String(metric||'').includes('within_upper')){
    return `Считает разброс площадей нижних АТЕ не по всему атласу сразу, а внутри каждой верхнеуровневой единицы, затем берёт среднее или максимум по этим верхним контекстам. Это нужно, чтобы сравнивать не только «всю Западную Сибирь», но и внутреннюю упорядоченность губерний, областей или краёв.`;
  }
  return map[kind] || `Показывает пространственный параметр АТЕ для выбранного уровня.`;
}
function v106HowToReadText(metric){
  const kind=v106MetricKind(metric);
  if(['cv','gini','p90p10','q75q25','maxmin','stddev'].includes(kind)){
    return 'Если линия снижается, площади единиц выбранного уровня становятся более похожими друг на друга: сетка АТД выравнивается. Если линия растёт, система становится более контрастной: рядом существуют очень крупные и очень мелкие единицы.';
  }
  if(['mean','median'].includes(kind)) return 'Эти показатели показывают не разброс, а типичный размер единицы. Их лучше читать вместе с CV или Gini: средний размер может уменьшаться, но разброс при этом тоже может как снижаться, так и расти.';
  return 'Это вспомогательный показатель. Для проверки гипотезы о «созревании» системы лучше сопоставлять его с CV, Gini и отношениями p90/p10 или q75/q25.';
}
function v106HypothesisText(rows, metric){
  const kind=v106MetricKind(metric);
  if(!rows || rows.length<2) return 'Для вывода выберите не менее двух лет.';
  const first=rows[0], last=rows[rows.length-1];
  const fv=Number(first.value), lv=Number(last.value);
  if(!Number.isFinite(fv)||!Number.isFinite(lv)) return 'По выбранным годам нет устойчивого числового ряда.';
  const pct=fv!==0 ? ((lv-fv)/Math.abs(fv))*100 : NaN;
  const direction=lv<fv ? 'снизился' : (lv>fv ? 'вырос' : 'почти не изменился');
  const valFmt=(v)=> v105IsAreaDispersionMetric(metric) ? v105FormatAreaTrendValue(v,metric) : v93FormatTrendValue(v,metric);
  if(['cv','gini','p90p10','q75q25','maxmin','stddev'].includes(kind)){
    const verdict=lv<fv ? 'это поддерживает гипотезу о выравнивании/созревании территориальной сетки' : (lv>fv ? 'это не поддерживает простую версию гипотезы: разброс вырос, нужен разбор по контекстам и конкретным реформам' : 'это даёт нейтральный результат: заметного изменения разброса нет');
    return `С ${first.year} по ${last.year} показатель ${direction}: ${valFmt(fv)} → ${valFmt(lv)}${Number.isFinite(pct)?` (${pct>0?'+':''}${pct.toFixed(1).replace('.',',')}%)`:''}. По этой метрике ${verdict}.`;
  }
  return `С ${first.year} по ${last.year}: ${valFmt(fv)} → ${valFmt(lv)}. Это описывает размер единиц, но само по себе не доказывает выравнивание; для проверки гипотезы включи CV, Gini или p90/p10.`;
}
function v106MetricHelpHtml(metric, rows, context){
  if(!v105IsAreaDispersionMetric(metric)){
    return `<section class="trend-help-card-v106"><h3>Как читать этот график</h3><p>Это общий статистический показатель по годам. Для задачи о «созревании» территориальной системы переключи группу на <b>«Разброс площадей»</b>: там есть отдельные метрики для верхнего, среднего и нижнего уровней АТЕ.</p></section>`;
  }
  const kind=v106MetricKind(metric);
  const level=v106AreaLevelName(metric);
  const contextText=(context && context!=='all') ? `Сейчас выбран не весь атлас, а контекст: <b>${escapeHtml(context)}</b>. То есть график читает ${level} внутри этого верхнего административного/национального контура.` : `Сейчас выбран <b>весь статистический охват</b>: показатель считается по всем подходящим АТЕ этого года.`;
  return `<section class="trend-help-card-v106" id="topologyTrendExplainV106">
    <div class="trend-help-title-v106"><span>Пояснение</span><b>${escapeHtml(v106MetricKindTitle(kind))}</b></div>
    <p>${escapeHtml(v106MetricPlainText(metric))}</p>
    <p>${escapeHtml(v106HowToReadText(metric))}</p>
    <p>${contextText}</p>
    <div class="trend-hypothesis-v106"><b>Проверка гипотезы:</b> ${escapeHtml(v106HypothesisText(rows,metric))}</div>
  </section>`;
}
function v106GeneralHelpHtml(){
  return `<details class="trend-window-help-v106" open>
    <summary>Что здесь проверяется?</summary>
    <p><b>Идея простая:</b> зрелая административная система обычно стремится к более сопоставимым по размеру единицам одного уровня. Если разброс площадей районов, округов или губерний со временем падает, это аргумент в пользу «созревания» сетки АТД.</p>
    <p><b>Уровни:</b> верхний — губернии/области/края; средний — округа или промежуточные единицы, если они есть; нижний — уезды, районы и другие базовые единицы слоя.</p>
    <p><b>Контекст:</b> «весь охват» сравнивает всю Западную Сибирь, а отдельный верхний контекст позволяет смотреть, как устроена сетка внутри конкретной губернии/области/края.</p>
  </details>`;
}
function v106ShortMethodNote(){
  return `<div class="trend-method-strip-v106"><b>Очистка ряда:</b> спорные, двоеданческие, слабоконтрольные, неясные территории и полигоны меньше 50 км² не участвуют в расчётах разброса. Исключения v104 для 1926/1930/2021 сохранены.</div>`;
}
async function v106OpenMultiyearTrendsModal(){
  const data=await v93LoadMultiyearMetrics();
  if(!data.length){ alert('Нет данных динамики метрик.'); return; }
  v105InstallAreaDispersionMetrics();
  let modal=$('topologyTrendsModal') || $('chartLightbox');
  if(!modal){ modal=document.createElement('div'); modal.id='topologyTrendsModal'; document.body.appendChild(modal); }
  modal.className='chart-lightbox topology-trends-modal-v88 topology-trends-modal-v91 multiyear-trends-modal-v93 multiyear-trends-modal-v105 multiyear-trends-modal-v106';
  modal.setAttribute('aria-hidden','true');
  const group=state._topologyTrendGroup || v93MetricGroupFor(state._topologyTrendMetric || 'area_cv_lower_ate') || 'area_dispersion';
  let metric=state._topologyTrendMetric || v93TrendMetricOptions(group)[0];
  if(!v93TrendMetricOptions(group).includes(metric)) metric=v93TrendMetricOptions(group)[0];
  state._topologyTrendMetric=metric;
  state._topologyTrendGroup=group;
  state._topologyTrendContextV105=state._topologyTrendContextV105 || 'all';
  const cfg=v93TrendSettings();
  modal.innerHTML=`<div class="chart-lightbox-scrim" data-close-topology-trends="1"></div><section class="chart-lightbox-card" role="dialog" aria-modal="true" aria-labelledby="topologyTrendsTitle"><button type="button" class="chart-lightbox-close" aria-label="Закрыть динамику метрик">×</button><div class="chart-lightbox-kicker">Мультивременная аналитика · ${APP_VERSION}</div><h2 id="topologyTrendsTitle">Динамика метрик по годам</h2><div id="topologyTrendsBody" class="chart-lightbox-body topology-trends-body-v91 multiyear-trends-body-v93 multiyear-trends-body-v105 multiyear-trends-body-v106"></div></section>`;
  modal.querySelector('.chart-lightbox-close')?.addEventListener('click',()=>{ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); });
  modal.querySelector('[data-close-topology-trends]')?.addEventListener('click',()=>{ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); });
  const body=$('topologyTrendsBody');
  const years=data.map(d=>Number(d.year)).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!state._topologyTrendYears?.length) state._topologyTrendYears=years.slice();
  const metricSelectHtml=()=>v93TrendMetricOptions(state._topologyTrendGroup || group).map(k=>`<option value="${k}" ${k===state._topologyTrendMetric?'selected':''}>${escapeHtml(v93TrendLabels[k])}</option>`).join('');
  body.innerHTML=`<div class="topology-trend-layout-v91 topology-trend-layout-v106 multiyear-trend-layout-v93">
    <aside class="topology-trend-controls-v91 topology-trend-controls-v106">
      ${v106GeneralHelpHtml()}
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendGroupV93">Группа показателей</label><select id="topologyTrendGroupV93">${Object.entries(v93TrendGroups).map(([k,g])=>`<option value="${k}" ${k===state._topologyTrendGroup?'selected':''}>${escapeHtml(g.label)}</option>`).join('')}</select></div>
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendMetricV90">Метрика</label><select id="topologyTrendMetricV90">${metricSelectHtml()}</select></div>
      ${v105ContextSelectorHtml(data,state._topologyTrendContextV105)}
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendScaleV91">Шкала значений</label><select id="topologyTrendScaleV91"><option value="linear" ${cfg.scale==='linear'?'selected':''}>Линейная</option><option value="log" ${cfg.scale==='log'?'selected':''}>Логарифмическая log10</option></select><div class="mini-muted">Линейная шкала лучше для обычного чтения. Log10 полезна, если значения различаются на порядки.</div></div>
      <div class="topology-trend-control-v91 color-control-v91"><label class="control-label" for="topologyTrendLineColorV91">Цвет линии</label><input id="topologyTrendLineColorV91" type="color" value="${escapeHtml(v93SafeHexColor(cfg.lineColor,'#9a6a22'))}"></div>
      <div class="topology-trend-control-v91 color-control-v91"><label class="control-label" for="topologyTrendPointColorV91">Цвет точек</label><input id="topologyTrendPointColorV91" type="color" value="${escapeHtml(v93SafeHexColor(cfg.pointColor,'#f2c14e'))}"></div>
      <label class="topology-trend-check-v91"><input id="topologyTrendShowLabelsV91" type="checkbox" ${cfg.showLabels?'checked':''}> Подписывать значения над точками</label>
      <div class="topology-trend-control-v91"><label class="control-label" for="topologyTrendLabelSizeV91">Размер подписи: <span id="topologyTrendLabelSizeValueV91">${Number(cfg.labelSize||11)}</span> px</label><input id="topologyTrendLabelSizeV91" type="range" min="8" max="18" step="1" value="${Number(cfg.labelSize||11)}"></div>
      <div class="trend-buttons-v106"><button type="button" id="topologyTrendAllV90">Все годы</button><button type="button" id="topologyTrendClearV90">Снять все</button><button type="button" id="topologyTrendCoreV90">Только опорные</button></div>
      <div class="topology-trend-years-v90 topology-trend-years-v106" id="topologyTrendYearsV90">${years.map(y=>`<label><input type="checkbox" value="${y}" ${state._topologyTrendYears.includes(y)?'checked':''}> ${y}</label>`).join('')}</div>
      ${v106ShortMethodNote()}
    </aside>
    <main class="topology-trend-main-v91 topology-trend-main-v106"><div id="topologyTrendChartV90" class="topology-trend-chart-v91"></div><div id="topologyTrendExplainSlotV106"></div><div id="topologyTrendTableV90" class="topology-trend-table-v91"></div></main>
  </div>`;
  const sync=()=>{
    const groupSel=$('topologyTrendGroupV93');
    const metricSelect=$('topologyTrendMetricV90');
    const contextSelect=$('topologyTrendContextV105');
    state._topologyTrendGroup=groupSel?.value || 'area_dispersion';
    if(metricSelect && !v93TrendMetricOptions(state._topologyTrendGroup).includes(metricSelect.value)){
      metricSelect.innerHTML=v93TrendMetricOptions(state._topologyTrendGroup).map(k=>`<option value="${k}">${escapeHtml(v93TrendLabels[k])}</option>`).join('');
      metricSelect.value=v93TrendMetricOptions(state._topologyTrendGroup)[0];
    }
    state._topologyTrendMetric=metricSelect?.value || v93TrendMetricOptions(state._topologyTrendGroup)[0];
    state._topologyTrendContextV105=contextSelect?.value || 'all';
    if(contextSelect){
      const areaMetric=v105IsAreaDispersionMetric(state._topologyTrendMetric);
      contextSelect.disabled=!areaMetric;
      contextSelect.closest('.topology-trend-context-v105')?.classList.toggle('disabled',!areaMetric);
      if(!areaMetric){ state._topologyTrendContextV105='all'; contextSelect.value='all'; }
    }
    state._topologyTrendScale=$('topologyTrendScaleV91')?.value || 'linear';
    state._topologyTrendLineColor=$('topologyTrendLineColorV91')?.value || '#9a6a22';
    state._topologyTrendPointColor=$('topologyTrendPointColorV91')?.value || '#f2c14e';
    state._topologyTrendShowLabels=!!$('topologyTrendShowLabelsV91')?.checked;
    state._topologyTrendLabelSize=Number($('topologyTrendLabelSizeV91')?.value || 11);
    const labelSizeValue=$('topologyTrendLabelSizeValueV91'); if(labelSizeValue) labelSizeValue.textContent=String(state._topologyTrendLabelSize);
    state._topologyTrendYears=[...body.querySelectorAll('#topologyTrendYearsV90 input:checked')].map(i=>Number(i.value));
    v106RenderMultiyearTrendChart(data);
  };
  $('topologyTrendGroupV93')?.addEventListener('change',()=>{ const ms=$('topologyTrendMetricV90'); const g=$('topologyTrendGroupV93')?.value || 'area_dispersion'; if(ms){ ms.innerHTML=v93TrendMetricOptions(g).map(k=>`<option value="${k}">${escapeHtml(v93TrendLabels[k])}</option>`).join(''); ms.value=v93TrendMetricOptions(g)[0]; } sync(); });
  ['topologyTrendMetricV90','topologyTrendScaleV91','topologyTrendContextV105'].forEach(id=>$(id)?.addEventListener('change',sync));
  ['topologyTrendLineColorV91','topologyTrendPointColorV91','topologyTrendShowLabelsV91','topologyTrendLabelSizeV91'].forEach(id=>$(id)?.addEventListener('input',sync));
  body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.addEventListener('change',sync));
  $('topologyTrendAllV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=true); sync(); });
  $('topologyTrendClearV90')?.addEventListener('click',()=>{ body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=false); sync(); });
  $('topologyTrendCoreV90')?.addEventListener('click',()=>{ const core=new Set([1700,1745,1783,1798,1821,1848,1876,1897,1914,1926,1939,1959,1970,1989,2021]); body.querySelectorAll('#topologyTrendYearsV90 input').forEach(i=>i.checked=core.has(Number(i.value))); sync(); });
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  sync();
}
function v106RenderMultiyearTrendChart(data){
  const chart=$('topologyTrendChartV90'), table=$('topologyTrendTableV90'), help=$('topologyTrendExplainSlotV106'); if(!chart || !table) return;
  const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || 'area_cv_lower_ate';
  const context=v105IsAreaDispersionMetric(metric) ? (state._topologyTrendContextV105 || 'all') : 'all';
  const cfg=v93TrendSettings();
  const lineColor=v93SafeHexColor(cfg.lineColor,'#9a6a22');
  const pointColor=v93SafeHexColor(cfg.pointColor,'#f2c14e');
  const selectedYears=new Set((state._topologyTrendYears?.length ? state._topologyTrendYears : data.map(d=>Number(d.year))).map(Number));
  const rows=data.map(d=>({row:d, year:Number(d.year), value:v105TrendValue(d,metric,context)})).filter(d=>selectedYears.has(d.year) && Number.isFinite(d.value)).sort((a,b)=>a.year-b.year);
  if(rows.length<2){ chart.innerHTML='<div class="mini-muted">Для этой метрики/контекста выберите минимум два года с числовыми данными.</div>'; table.innerHTML=''; if(help) help.innerHTML=v106MetricHelpHtml(metric,rows,context); return; }
  const w=940,h=390,pad={l:88,r:34,t:36,b:54};
  const xs=rows.map(r=>r.year), rawYs=rows.map(r=>r.value);
  const xmin=Math.min(...xs), xmax=Math.max(...xs);
  const positives=rawYs.filter(y=>y>0);
  const useLog=cfg.scale==='log' && positives.length>0;
  const logFloor=useLog ? Math.min(...positives)/10 : null;
  const transformY=y=>useLog ? Math.log10(y>0 ? y : logFloor) : y;
  const inverseY=y=>useLog ? Math.pow(10,y) : y;
  const axisPlan=useLog ? v102NiceLogAxis(rawYs, logFloor) : v102NiceLinearAxis(rawYs, 5);
  const ys=rawYs.map(transformY);
  let ymin=axisPlan ? axisPlan.min : Math.min(...ys), ymax=axisPlan ? axisPlan.max : Math.max(...ys);
  if(ymin===ymax){ ymin-=useLog ? .5 : 1; ymax+=useLog ? .5 : 1; }
  const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
  const yScaleRaw=y=>h-pad.b-(transformY(y)-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const yScaleTrans=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
  const pts=rows.map(r=>`${xScale(r.year).toFixed(1)},${yScaleRaw(r.value).toFixed(1)}`).join(' ');
  const xTicks=rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.ceil(rows.length/9)===0).map(r=>r.year);
  const yTicks=axisPlan?.ticks?.length ? axisPlan.ticks : [0,.25,.5,.75,1].map(t=>ymin+(ymax-ymin)*t);
  const valueLabel=(v)=> v105IsAreaDispersionMetric(metric) ? v105FormatAreaTrendValue(v,metric) : v93FormatTrendValue(v,metric);
  const axisLabel=(t)=> v105IsAreaDispersionMetric(metric) ? v105FormatAreaTrendValue(inverseY(t),metric).replace('×','') : v102FormatAxisTick(inverseY(t),metric,axisPlan,useLog);
  const labelsSvg=cfg.showLabels ? rows.map(r=>{ const x=xScale(r.year); const y=Math.max(pad.t+Number(cfg.labelSize||11), yScaleRaw(r.value)-9); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="trend-point-label-v91" style="font-size:${Number(cfg.labelSize||11)}px">${escapeHtml(valueLabel(r.value))}</text>`; }).join('') : '';
  const contextSuffix=context && context!=='all' ? ` · ${context}` : '';
  const logNote=(cfg.scale==='log' && !positives.length) ? '<div class="topology-trend-note-v91">Для этой метрики нет положительных значений; показана линейная шкала.</div>' : (useLog && rawYs.some(y=>y<=0) ? '<div class="topology-trend-note-v91">Log10-шкала: нулевые значения прижаты к нижней границе.</div>' : '');
  chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88 topology-trend-svg-v90 topology-trend-svg-v91 topology-trend-svg-v105 topology-trend-svg-v106" role="img" aria-label="Динамика ${escapeHtml(v93TrendLabels[metric]||metric)}"><rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>${yTicks.map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScaleTrans(t)}" y2="${yScaleTrans(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScaleTrans(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(axisLabel(t))}</text>`).join('')}${xTicks.map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-18}" text-anchor="middle" class="trend-label-v88">${t}</text>`).join('')}<polyline points="${pts}" fill="none" class="trend-line-v91" style="stroke:${lineColor}"/>${rows.map(r=>`<circle cx="${xScale(r.year).toFixed(1)}" cy="${yScaleRaw(r.value).toFixed(1)}" r="5.8" class="trend-point-v91" style="fill:${pointColor}"><title>${r.year}: ${valueLabel(r.value)}${contextSuffix}</title></circle>`).join('')}${labelsSvg}<text x="${pad.l}" y="22" class="trend-title-v88 trend-title-v91">${escapeHtml(v93TrendLabels[metric]||metric)}${escapeHtml(contextSuffix)} · ${useLog?'LOG10':'ЛИНЕЙНАЯ ШКАЛА'}</text></svg>${logNote}`;
  if(help) help.innerHTML=v106MetricHelpHtml(metric,rows,context);
  table.innerHTML='<div class="chart-legend-head topology-trend-head-v88 topology-trend-head-v91"><span></span><span>ГОД</span><span>ЗНАЧЕНИЕ</span><span>УРОВЕНЬ / КОНТЕКСТ</span></div>'+rows.map(r=>`<div class="chart-legend-row topology-trend-row-v88 topology-trend-row-v91"><span class="pie-dot" style="background:${pointColor}"></span><span>${r.year}</span><b>${valueLabel(r.value)}</b><em>${escapeHtml(v105IsAreaDispersionMetric(metric)?v105AreaTrendLeader(r.row,metric,context):v93TrendLeader(r.row,metric))}</em></div>`).join('');
}
try{ v93OpenMultiyearTrendsModal=v106OpenMultiyearTrendsModal; v90OpenTopologyTrendsModal=v106OpenMultiyearTrendsModal; openTopologyTrendsModal=v106OpenMultiyearTrendsModal; }catch(_){ }

/* v108: population ↔ ATE-count correlation plots for the multiyear statistics window. */
(function v108InstallPopulationCorrelationPlots(){
  const metricDefs={
    corr_population_lower_ate_count:{label:'корреляция: население ↔ нижние АТЕ', yKey:'lower_ate_count', yLabel:'число АТЕ нижнего уровня'},
    corr_population_upper_ate_count:{label:'корреляция: население ↔ верхние АТЕ', yKey:'upper_ate_count', yLabel:'число АТЕ верхнего уровня'}
  };
  function isMetric(metric){ return Object.prototype.hasOwnProperty.call(metricDefs, String(metric||'')); }
  function install(){
    if(typeof v93TrendGroups==='object'){
      v93TrendGroups.population = v93TrendGroups.population || {label:'Население', metrics:[]};
      Object.keys(metricDefs).forEach(k=>{ if(!v93TrendGroups.population.metrics.includes(k)) v93TrendGroups.population.metrics.push(k); });
    }
    if(typeof v93TrendLabels==='object'){
      Object.entries(metricDefs).forEach(([k,d])=>{ v93TrendLabels[k]=d.label; });
    }
    try{ Object.assign(v90TrendLabels, v93TrendLabels); }catch(_){ }
  }
  function finite(v){ const n=Number(v); return Number.isFinite(n) ? n : NaN; }
  function fmtPop(v){ return Number.isFinite(Number(v)) ? num(Math.round(Number(v))) : '—'; }
  function fmtCount(v){ return Number.isFinite(Number(v)) ? num(Number(v)) : '—'; }
  function pearson(rows){
    const n=rows.length;
    if(n<2) return NaN;
    const mx=rows.reduce((s,r)=>s+r.x,0)/n, my=rows.reduce((s,r)=>s+r.y,0)/n;
    let nume=0, dx=0, dy=0;
    rows.forEach(r=>{ const a=r.x-mx, b=r.y-my; nume+=a*b; dx+=a*a; dy+=b*b; });
    return dx>0 && dy>0 ? nume/Math.sqrt(dx*dy) : NaN;
  }
  function regression(rows){
    const n=rows.length;
    if(n<2) return null;
    const mx=rows.reduce((s,r)=>s+r.x,0)/n, my=rows.reduce((s,r)=>s+r.y,0)/n;
    let nume=0, den=0;
    rows.forEach(r=>{ nume+=(r.x-mx)*(r.y-my); den+=(r.x-mx)*(r.x-mx); });
    if(!den) return null;
    const slope=nume/den;
    return {slope, intercept:my-slope*mx};
  }
  function niceAxis(vals, target){ return (typeof v102NiceLinearAxis==='function' ? v102NiceLinearAxis(vals, target||5) : null) || {min:Math.min(...vals), max:Math.max(...vals), ticks:[Math.min(...vals), Math.max(...vals)]}; }
  function tickLabel(v, key){
    const n=Number(v);
    if(!Number.isFinite(n)) return '—';
    if(key==='total_population') return n>=1000 ? num(Math.round(n)) : String(Math.round(n));
    return Number.isInteger(n) ? num(n) : n.toFixed(1).replace('.',',');
  }
  function verdict(r){
    if(!Number.isFinite(r)) return 'Недостаточно данных для устойчивого коэффициента.';
    const a=Math.abs(r);
    const strength=a>=0.8 ? 'сильная' : (a>=0.55 ? 'заметная' : (a>=0.3 ? 'умеренная' : 'слабая'));
    const dir=r>=0 ? 'положительная' : 'отрицательная';
    return `${strength} ${dir} связь: r = ${r.toFixed(3).replace('.',',')}, R² = ${(r*r).toFixed(3).replace('.',',')}. Это показывает сопряжённость рядов, но не доказывает прямую причинность реформ.`;
  }
  function render(data){
    const chart=$('topologyTrendChartV90'), table=$('topologyTrendTableV90'), help=$('topologyTrendExplainSlotV106');
    if(!chart || !table) return;
    const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || 'corr_population_lower_ate_count';
    const def=metricDefs[metric] || metricDefs.corr_population_lower_ate_count;
    const cfg=v93TrendSettings();
    const pointColor=v93SafeHexColor(cfg.pointColor,'#f2c14e');
    const lineColor=v93SafeHexColor(cfg.lineColor,'#9a6a22');
    const selectedYears=new Set((state._topologyTrendYears?.length ? state._topologyTrendYears : (data||[]).map(d=>Number(d.year))).map(Number));
    const rows=(data||[]).map(d=>({row:d, year:Number(d.year), x:finite(d.total_population), y:finite(d[def.yKey])}))
      .filter(r=>selectedYears.has(r.year) && Number.isFinite(r.x) && Number.isFinite(r.y) && r.x>=0 && r.y>=0)
      .sort((a,b)=>a.year-b.year);
    if(rows.length<2){
      chart.innerHTML='<div class="mini-muted">Для корреляционного графика выберите минимум два года с населением и числом АТЕ.</div>';
      table.innerHTML='';
      if(help) help.innerHTML='<section class="trend-help-card-v106"><h3>Корреляция населения и числа АТЕ</h3><p>Нужно минимум два года с числовыми данными. Для содержательной проверки лучше оставить несколько сопоставимых временных срезов.</p></section>';
      return;
    }
    const w=940,h=390,pad={l:106,r:42,t:38,b:76};
    const xAxis=niceAxis(rows.map(r=>r.x),5), yAxis=niceAxis(rows.map(r=>r.y),5);
    let xmin=Number(xAxis.min), xmax=Number(xAxis.max), ymin=Number(yAxis.min), ymax=Number(yAxis.max);
    if(xmin===xmax){ xmin-=1; xmax+=1; }
    if(ymin===ymax){ ymin-=1; ymax+=1; }
    const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
    const yScale=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
    const r=pearson(rows), reg=regression(rows);
    let regSvg='';
    if(reg){
      const x1=xmin, x2=xmax, y1=reg.intercept+reg.slope*x1, y2=reg.intercept+reg.slope*x2;
      regSvg=`<line x1="${xScale(x1).toFixed(1)}" y1="${yScale(y1).toFixed(1)}" x2="${xScale(x2).toFixed(1)}" y2="${yScale(y2).toFixed(1)}" class="trend-line-v91 trend-correlation-fit-v108" style="stroke:${lineColor};stroke-dasharray:8 6;opacity:.78"/>`;
    }
    const labelsSvg=cfg.showLabels ? rows.map(row=>`<text x="${xScale(row.x).toFixed(1)}" y="${Math.max(pad.t+Number(cfg.labelSize||11), yScale(row.y)-9).toFixed(1)}" text-anchor="middle" class="trend-point-label-v91" style="font-size:${Number(cfg.labelSize||11)}px">${row.year}</text>`).join('') : '';
    chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88 topology-trend-svg-v90 topology-trend-svg-v91 topology-trend-svg-v108" role="img" aria-label="${escapeHtml(def.label)}"><rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>${(yAxis.ticks||[]).map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScale(t)}" y2="${yScale(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScale(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(tickLabel(t,def.yKey))}</text>`).join('')}${(xAxis.ticks||[]).map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-38}" text-anchor="middle" class="trend-label-v88">${escapeHtml(tickLabel(t,'total_population'))}</text>`).join('')}${regSvg}${rows.map(row=>`<circle cx="${xScale(row.x).toFixed(1)}" cy="${yScale(row.y).toFixed(1)}" r="6.2" class="trend-point-v91" style="fill:${pointColor}"><title>${row.year}: население ${fmtPop(row.x)}; ${def.yLabel} — ${fmtCount(row.y)}</title></circle>`).join('')}${labelsSvg}<text x="${pad.l}" y="22" class="trend-title-v88 trend-title-v91">${escapeHtml(def.label)} · КОРРЕЛЯЦИОННОЕ ПОЛЕ</text><text x="${pad.l+(w-pad.l-pad.r)/2}" y="${h-10}" text-anchor="middle" class="trend-label-v88">население</text><text x="20" y="${pad.t+(h-pad.t-pad.b)/2}" transform="rotate(-90 20 ${pad.t+(h-pad.t-pad.b)/2})" text-anchor="middle" class="trend-label-v88">${escapeHtml(def.yLabel)}</text></svg><div class="topology-trend-note-v91">${escapeHtml(verdict(r))}</div>`;
    if(help) help.innerHTML=`<section class="trend-help-card-v106 trend-help-card-v108"><h3>Как читать корреляционный график</h3><p>Каждая точка — отдельный год. По оси X отложено население статистического охвата, по оси Y — ${escapeHtml(def.yLabel)}. Пунктирная линия показывает общий линейный тренд.</p><p><b>Смысл для главы:</b> график помогает проверить, сопровождался ли демографический рост усложнением административной сетки. Положительная связь ожидаема, но сама по себе не доказывает, что население напрямую «создало» новые АТЕ: реформы, транспорт, хозяйственное освоение и политические решения тоже влияли на ряд.</p></section>`;
    table.innerHTML='<div class="chart-legend-head topology-trend-head-v88 topology-trend-head-v91"><span></span><span>ГОД</span><span>НАСЕЛЕНИЕ</span><span>'+escapeHtml(def.yLabel.toUpperCase())+'</span></div>'+rows.map(row=>`<div class="chart-legend-row topology-trend-row-v88 topology-trend-row-v91"><span class="pie-dot" style="background:${pointColor}"></span><span>${row.year}</span><b>${fmtPop(row.x)}</b><em>${fmtCount(row.y)}</em></div>`).join('');
  }
  install();
  const prior = typeof v106RenderMultiyearTrendChart==='function' ? v106RenderMultiyearTrendChart : null;
  if(prior){
    v106RenderMultiyearTrendChart = function v106RenderMultiyearTrendChartV108(data){
      const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || '';
      if(isMetric(metric)) return render(data);
      return prior(data);
    };
  }
  const priorLeader = typeof v93TrendLeader==='function' ? v93TrendLeader : null;
  if(priorLeader){
    v93TrendLeader = function v93TrendLeaderV108(row, metric){
      if(isMetric(metric)) return 'корреляционное поле: население × число АТЕ';
      return priorLeader(row, metric);
    };
  }
})();


/* v116: visible city/center labels + multiyear metric tables panel. */
(function v116InstallCenterPointLabelsAndMetricTables(){
  const CENTER_LABEL_TOGGLE_ID = 'toggleCenterPointLabels';
  const TABLE_BUTTON_ID = 'openMetricTables';

  function v116CleanCenterName(name){
    try{ return cleanCenterLabelName(name); }catch(_){ return String(name||'').trim(); }
  }
  function v116ShortPopulation(v){
    const n=Number(v);
    if(!Number.isFinite(n) || n<=0) return '';
    if(n>=1000000) return (n/1000000).toFixed(n>=10000000?0:1).replace('.',',')+' млн';
    if(n>=1000) return (n/1000).toFixed(n>=100000?0:1).replace('.',',')+' тыс.';
    return num(Math.round(n));
  }
  function v116CenterMatchesCurrentLayer(f){
    const p=f?.properties||{};
    const visible=(state.currentGeoJSON?.features||[]);
    if(!visible.length) return true;
    const visibleNames=new Set(visible.map(x=>String(x.properties?.name||'').trim().toLowerCase()).filter(Boolean));
    const visibleParents=new Set(visible.map(x=>String(x.properties?.admin_parent||'').trim()).filter(Boolean));
    const visibleUnitIds=new Set(visible.map(x=>String(x.properties?.unit_id||'')).filter(Boolean));
    const unitId=String(p.unit_id||'');
    const unitName=String(p.unit_name||p.host_name||p.name||'').trim().toLowerCase();
    const parent=String(p.admin_parent||'').trim();
    const hasMatchMeta = unitId || unitName || parent;
    if(!hasMatchMeta) return true;
    if(unitId && visibleUnitIds.has(unitId)) return true;
    if(unitName && visibleNames.has(unitName)) return true;
    if(parent && visibleParents.has(parent)) return true;
    return false;
  }
  function v116FilteredCenterFeatures(){
    const gj=state.rawCentersGeoJSON;
    if(!gj?.features?.length) return [];
    return gj.features.filter(f=>f.geometry?.type==='Point' && v116CenterMatchesCurrentLayer(f));
  }
  function v116ClearCenterPointLabels(){
    const old=state.layers.centerLabels;
    if(old && state.map?.hasLayer(old)) state.map.removeLayer(old);
    state.layers.centerLabels=L.layerGroup();
    state.centerLabelItems=[];
  }
  function v116LabelClassForCenter(p, pop){
    const cls=['center-point-label-v116'];
    let city=false;
    try{ city=isCityCenter(p); }catch(_){ city=false; }
    if(city) cls.push('city');
    if(Number(pop)>=largeCityThreshold(Number(p?.year||state.year))) cls.push('large');
    return cls.join(' ');
  }
  function v116BuildCenterPointLabels(){
    if(!state.map) return;
    v116ClearCenterPointLabels();
    const features=v116FilteredCenterFeatures();
    if(!features.length) return;
    const entries=features.map(f=>{
      const p=f.properties||{};
      const coords=f.geometry?.coordinates||[];
      const pop=pointPopulation(p);
      const name=v116CleanCenterName(p.name||p.center||p.unit_name||'центр');
      return {f,p,pop,name,latlng:L.latLng(Number(coords[1]),Number(coords[0])),priority:labelPriority(p)};
    }).filter(x=>x.name && Number.isFinite(x.latlng.lat) && Number.isFinite(x.latlng.lng))
      .sort((a,b)=>(b.priority||0)-(a.priority||0));
    const group=L.layerGroup();
    entries.forEach((it,idx)=>{
      const popText=v116ShortPopulation(it.pop);
      const html=`<span class="center-point-label-name-v116">${escapeHtml(it.name)}</span>${popText?`<span class="center-point-label-pop-v116">${escapeHtml(popText)}</span>`:''}`;
      const marker=L.marker(it.latlng,{
        interactive:false,
        keyboard:false,
        zIndexOffset:1180 + Math.max(0, 999-idx),
        icon:L.divIcon({className:v116LabelClassForCenter(it.p,it.pop), html, iconSize:null, iconAnchor:[0,0]})
      });
      group.addLayer(marker);
      state.centerLabelItems.push({marker, feature:it.f, latlng:it.latlng, priority:it.priority});
    });
    state.layers.centerLabels=group;
  }

  function v116CenterLabelsEnabled(){
    return $('toggleCenters')?.checked !== false && $(CENTER_LABEL_TOGGLE_ID)?.checked === true;
  }

  const priorRefreshCenters = typeof refreshCenters === 'function' ? refreshCenters : null;
  if(priorRefreshCenters && !priorRefreshCenters._v116Wrapped){
    const wrapped = async function refreshCentersV116(seq){
      await priorRefreshCenters(seq);
      if(isStaleRefresh(seq)) return;
      v116BuildCenterPointLabels();
      refreshVisibility();
    };
    wrapped._v116Wrapped = true;
    refreshCenters = wrapped;
  }

  const priorRefreshVisibility = typeof refreshVisibility === 'function' ? refreshVisibility : null;
  if(priorRefreshVisibility && !priorRefreshVisibility._v116Wrapped){
    const wrapped = function refreshVisibilityV116(){
      priorRefreshVisibility();
      const layer=state.layers.centerLabels;
      if(layer && state.map){
        const should=v116CenterLabelsEnabled();
        if(should && !state.map.hasLayer(layer)) layer.addTo(state.map);
        if(!should && state.map.hasLayer(layer)) state.map.removeLayer(layer);
        if(should) bringLayerGroupToFront(layer);
      }
    };
    wrapped._v116Wrapped = true;
    refreshVisibility = wrapped;
  }

  updateCenterLabels = function updateCenterLabelsV116(){
    if(!state.map) return;
    const layer=state.layers.centerLabels;
    if(layer && v116CenterLabelsEnabled()) bringLayerGroupToFront(layer);
  };
  clearCenterLabels = function clearCenterLabelsV116(){ v116ClearCenterPointLabels(); };

  function v116BindCenterLabelToggle(){
    const cb=$(CENTER_LABEL_TOGGLE_ID);
    if(!cb || cb.dataset.v116Bound==='1') return;
    cb.dataset.v116Bound='1';
    cb.addEventListener('change', ()=>{
      if(!state.layers.centerLabels || !state.centerLabelItems?.length) v116BuildCenterPointLabels();
      refreshVisibility();
      updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
    });
  }

  const metricTableGroupsV116 = {
    ate_area:{label:'АТЕ и площади', metrics:['ate_total_count','upper_ate_count','middle_ate_count','lower_ate_count','district_like_units_count','district_without_urban_pop_count','urban_rank_units_count','total_area_km2','avg_area_km2','area_mean_upper_ate_km2','area_mean_middle_ate_km2','area_mean_lower_ate_km2']},
    population:{label:'Население', metrics:['total_population','avg_population','population_density','urban_population','rural_population','urban_share']},
    rail:{label:'Железные дороги', metrics:['rail_length_km_total','rail_density_km_1000','rail_segments_count_sum']},
    adjacency:{label:'Соседство', metrics:['avg_adjacency','same_parent_edges','cross_parent_edges','same_superparent_edges','other_edges']},
    topology:{label:'Граф и топология', metrics:['nodes','edges','components','graph_density','cyclomatic','avg_degree','avg_betweenness','avg_closeness','avg_k_core','bridges','articulation_points_computed','avg_external_degree','avg_external_share']},
    dispersion:{label:'Разброс площадей', metrics:['area_cv_upper_ate','area_gini_upper_ate','area_p90_p10_ratio_upper_ate','area_cv_middle_ate','area_gini_middle_ate','area_p90_p10_ratio_middle_ate','area_cv_lower_ate','area_gini_lower_ate','area_p90_p10_ratio_lower_ate','area_q75_q25_ratio_lower_ate','area_range_ratio_lower_ate','area_cv_lower_within_upper_mean','area_gini_lower_within_upper_mean']}
  };
  const metricLabelsV116 = {
    ate_total_count:'АТЕ всего', upper_ate_count:'АТЕ верхнего уровня', middle_ate_count:'АТЕ среднего уровня', lower_ate_count:'АТЕ нижнего уровня',
    district_like_units_count:'Районы / уезды / муниципальные районы и округа', district_without_urban_pop_count:'Районов / уездов без городского населения', urban_rank_units_count:'Городов районного ранга',
    total_area_km2:'Площадь всего, км²', avg_area_km2:'Средняя площадь АТЕ, км²', area_mean_upper_ate_km2:'Средняя площадь верхнего уровня, км²', area_mean_middle_ate_km2:'Средняя площадь среднего уровня, км²', area_mean_lower_ate_km2:'Средняя площадь нижнего уровня, км²',
    total_population:'Население всего', avg_population:'Среднее население АТЕ', population_density:'Плотность населения', urban_population:'Городское население', rural_population:'Сельское население', urban_share:'Доля городского населения',
    rail_length_km_total:'Длина ЖД, км', rail_density_km_1000:'Плотность ЖД, км/1000 км²', rail_segments_count_sum:'ЖД-сегментов',
    avg_adjacency:'Среднее соседство', same_parent_edges:'Рёбра внутри одного верхнего контура', cross_parent_edges:'Рёбра между верхними контурами', same_superparent_edges:'Рёбра внутри вышестоящего контура', other_edges:'Прочие рёбра',
    nodes:'Узлы графа', edges:'Рёбра графа', components:'Компоненты связности', graph_density:'Плотность графа', cyclomatic:'Цикломатическое число', avg_degree:'Средняя степень узла', avg_betweenness:'Среднее посредничество', avg_closeness:'Средняя близость', avg_k_core:'Средний k-core', bridges:'Мосты', articulation_points_computed:'Точки сочленения', avg_external_degree:'Среднее число внешних связей', avg_external_share:'Средняя доля внешних связей',
    area_cv_upper_ate:'CV площадей верхнего уровня', area_gini_upper_ate:'Gini площадей верхнего уровня', area_p90_p10_ratio_upper_ate:'p90/p10 верхнего уровня',
    area_cv_middle_ate:'CV площадей среднего уровня', area_gini_middle_ate:'Gini площадей среднего уровня', area_p90_p10_ratio_middle_ate:'p90/p10 среднего уровня',
    area_cv_lower_ate:'CV площадей нижнего уровня', area_gini_lower_ate:'Gini площадей нижнего уровня', area_p90_p10_ratio_lower_ate:'p90/p10 нижнего уровня', area_q75_q25_ratio_lower_ate:'q75/q25 нижнего уровня', area_range_ratio_lower_ate:'max/min нижнего уровня', area_cv_lower_within_upper_mean:'Средний CV нижних АТЕ внутри верхних контуров', area_gini_lower_within_upper_mean:'Средний Gini нижних АТЕ внутри верхних контуров'
  };
  const metricRecommendedV116 = {
    ate_area:['upper_ate_count','middle_ate_count','lower_ate_count','district_without_urban_pop_count','urban_rank_units_count','avg_area_km2','area_mean_lower_ate_km2'],
    population:['total_population','population_density','urban_population','urban_share'],
    rail:['rail_length_km_total','rail_density_km_1000'],
    adjacency:['avg_adjacency','same_parent_edges','cross_parent_edges'],
    topology:['nodes','edges','components','avg_degree','bridges','articulation_points_computed'],
    dispersion:['area_cv_lower_ate','area_gini_lower_ate','area_p90_p10_ratio_lower_ate','area_cv_lower_within_upper_mean']
  };
  let metricTableDataV116=null;
  let metricRegionDataV118=null;
  async function v118LoadRegionMetricRows(){
    if(metricRegionDataV118) return metricRegionDataV118;
    const path=state.manifest?.layers?.multiyear_metrics_by_2021_region || 'data/topology/multiyear_metrics_by_2021_region.json';
    try{ metricRegionDataV118=await loadJson(path); }catch(e){ console.warn('v118 region metric rows unavailable', e); metricRegionDataV118=[]; }
    return metricRegionDataV118;
  }
  function v118RegionNames(){
    return [...new Set((metricRegionDataV118||[]).map(r=>String(r.region_2021||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  }
  const v118AdditiveMetrics=new Set(['ate_total_count','upper_ate_count','middle_ate_count','lower_ate_count','district_like_units_count','district_without_urban_pop_count','urban_rank_units_count','total_area_km2','total_population','urban_population','rural_population','rail_length_km_total','rail_segments_count_sum','nodes','edges']);
  const v118WeightedMetrics={avg_adjacency:'nodes',avg_degree:'nodes',avg_betweenness:'nodes',avg_closeness:'nodes',avg_k_core:'nodes'};
  function v118CurrentRegionConfig(){
    const mode=$('metricTableRegionModeV118')?.value || 'all';
    const selected=[...document.querySelectorAll('#metricTableRegionChecksV118 input[type="checkbox"]:checked')].map(x=>x.value);
    return {mode, selected:new Set(selected)};
  }
  function v118AggregateRegionRowsForYear(year, sourceRows){
    const out={year:Number(year), metric_scope_v118:'2021_region_selection'};
    for(const k of v118AdditiveMetrics) out[k]=0;
    const weighted={};
    for(const [metric,weight] of Object.entries(v118WeightedMetrics)) weighted[metric]={sum:0,w:0,weight};
    for(const r of sourceRows){
      for(const k of v118AdditiveMetrics){ const n=Number(r[k]); if(Number.isFinite(n)) out[k]+=n; }
      for(const [metric,obj] of Object.entries(weighted)){
        const v=Number(r[metric]); const w=Number(r[obj.weight]);
        if(Number.isFinite(v) && Number.isFinite(w) && w>0){ obj.sum+=v*w; obj.w+=w; }
      }
    }
    out.avg_area_km2 = out.ate_total_count ? out.total_area_km2/out.ate_total_count : null;
    out.avg_population = out.ate_total_count ? out.total_population/out.ate_total_count : null;
    out.population_density = out.total_area_km2 ? out.total_population/out.total_area_km2 : null;
    out.urban_share = out.total_population ? out.urban_population/out.total_population : null;
    out.rail_density_km_1000 = out.total_area_km2 ? out.rail_length_km_total/out.total_area_km2*1000 : null;
    for(const [metric,obj] of Object.entries(weighted)) out[metric]=obj.w?obj.sum/obj.w:null;
    for(const [k,v] of Object.entries(out)){ if(typeof v==='number' && Number.isFinite(v)) out[k]=Math.round(v*1000000)/1000000; }
    return out;
  }
  function v118ScopedTableRows(baseRows){
    const cfg=v118CurrentRegionConfig();
    if(cfg.mode==='all' || !metricRegionDataV118?.length) return baseRows||[];
    const regions=v118RegionNames();
    const chosen = cfg.mode==='exclude' ? new Set(regions.filter(r=>!cfg.selected.has(r))) : cfg.selected;
    if(!chosen.size) return [];
    const byYear=new Map();
    for(const r of metricRegionDataV118){
      const reg=String(r.region_2021||'');
      if(!chosen.has(reg)) continue;
      const y=Number(r.year);
      if(!Number.isFinite(y)) continue;
      if(!byYear.has(y)) byYear.set(y,[]);
      byYear.get(y).push(r);
    }
    return [...byYear.entries()].sort((a,b)=>a[0]-b[0]).map(([year,rs])=>v118AggregateRegionRowsForYear(year,rs));
  }
  function v118RenderRegionControls(rows){
    const box=$('metricTableRegionChecksV118');
    if(!box) return;
    const regs=v118RegionNames();
    box.innerHTML=regs.map(r=>`<label class="metric-table-region-v118"><input type="checkbox" value="${escapeHtml(r)}"><span>${escapeHtml(r)}</span></label>`).join('');
    box.querySelectorAll('input').forEach(i=>i.addEventListener('change',()=>{ v116RenderMetricCheckboxes(rows); v116RenderMetricTable(rows); }));
  }
  function v118SelectedScopeLabel(){
    const cfg=v118CurrentRegionConfig();
    if(cfg.mode==='all') return 'весь статистический охват';
    const regs=v118RegionNames();
    const selected=[...cfg.selected];
    if(cfg.mode==='exclude') return selected.length ? 'все регионы 2021, кроме: '+selected.join(', ') : 'все регионы 2021';
    return selected.length ? selected.join(', ') : 'нет выбранных регионов';
  }
  async function v116LoadMetricRows(){
    if(metricTableDataV116) return metricTableDataV116;
    const path=state.manifest?.layers?.multiyear_metrics || 'data/topology/multiyear_metrics_by_year.json';
    metricTableDataV116=await loadJson(path);
    return metricTableDataV116;
  }
  function v116AllYears(rows){ return (rows||[]).map(r=>Number(r.year)).filter(Number.isFinite).sort((a,b)=>a-b); }
  function v116DefaultYears(rows){
    const years=v116AllYears(rows);
    const anchors=[1783,1809,1821,1838,1848,1897,1918,1926,1930,1939,1947,1959,1970,1979,1989,2021];
    const set=new Set(years);
    return anchors.filter(y=>set.has(y));
  }
  function v116FormatMetricValue(key, value){
    if(value==null || value==='' || Number.isNaN(Number(value))) return '—';
    const n=Number(value);
    if(key.includes('share')) return (n*100).toFixed(1).replace('.',',')+'%';
    if(key.includes('density') || key.includes('avg_') || key.includes('mean') || key.includes('cv') || key.includes('gini') || key.includes('ratio') || key==='graph_density' || key.includes('betweenness') || key.includes('closeness') || key.includes('degree')){
      if(Math.abs(n)>=100) return num(Math.round(n));
      return n.toFixed(Math.abs(n)<10?3:1).replace('.',',').replace(/,?0+$/,'');
    }
    return num(Math.round(n));
  }
  function v116CsvEscape(v){
    const s=String(v??'');
    return /[";\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  }
  function v116CurrentTableConfig(){
    const years=[...document.querySelectorAll('#metricTableYearsV116 input[type="checkbox"]:checked')].map(x=>Number(x.value)).filter(Number.isFinite);
    const metrics=[...document.querySelectorAll('#metricTableMetricsV116 input[type="checkbox"]:checked')].map(x=>x.value);
    const orientation=$('metricTableOrientationV116')?.value || 'years_rows';
    const group=$('metricTableGroupV116')?.value || 'population';
    return {years,metrics,orientation,group};
  }
  function v116RenderMetricCheckboxes(rows){
    const group=$('metricTableGroupV116')?.value || 'population';
    const box=$('metricTableMetricsV116'); if(!box) return;
    const scoped=v118ScopedTableRows(rows);
    const available=new Set(Object.keys((scoped||[])[0]||{}));
    const metrics=(metricTableGroupsV116[group]?.metrics||[]).filter(k=>available.has(k));
    const rec=new Set(metricRecommendedV116[group]||metrics.slice(0,5));
    box.innerHTML=metrics.map(k=>`<label class="metric-table-check-v116"><input type="checkbox" value="${escapeHtml(k)}" ${rec.has(k)?'checked':''}><span>${escapeHtml(metricLabelsV116[k]||k)}</span></label>`).join('');
    box.querySelectorAll('input').forEach(inp=>inp.addEventListener('change',()=>v116RenderMetricTable(rows)));
  }
  function v116RenderYearCheckboxes(rows){
    const box=$('metricTableYearsV116'); if(!box) return;
    const years=v116AllYears(rows); const defaults=new Set(v116DefaultYears(rows));
    box.innerHTML=years.map(y=>`<label class="metric-table-year-v116"><input type="checkbox" value="${y}" ${defaults.has(y)?'checked':''}><span>${y}</span></label>`).join('');
    box.querySelectorAll('input').forEach(inp=>inp.addEventListener('change',()=>v116RenderMetricTable(rows)));
  }
  function v116TableMatrix(rows){
    rows=v118ScopedTableRows(rows);
    const cfg=v116CurrentTableConfig();
    const byYear=new Map((rows||[]).map(r=>[Number(r.year),r]));
    const years=cfg.years.length?cfg.years:v116AllYears(rows);
    const metrics=cfg.metrics.length?cfg.metrics:((metricTableGroupsV116[cfg.group]?.metrics||[]));
    if(cfg.orientation==='metrics_rows'){
      const header=['метрика',...years.map(String)];
      const body=metrics.map(k=>[metricLabelsV116[k]||k,...years.map(y=>v116FormatMetricValue(k, byYear.get(y)?.[k]))]);
      return {header, body};
    }
    const header=['год',...metrics.map(k=>metricLabelsV116[k]||k)];
    const body=years.map(y=>[String(y),...metrics.map(k=>v116FormatMetricValue(k, byYear.get(y)?.[k]))]);
    return {header, body};
  }
  function v116RenderMetricTable(rows){
    const slot=$('metricTableResultV116'); if(!slot) return;
    const {header,body}=v116TableMatrix(rows);
    if(!body.length){ slot.innerHTML='<div class="mini-muted">Выберите хотя бы один год и одну метрику.</div>'; return; }
    slot.innerHTML=`<div class="mini-muted metric-table-scope-note-v118">Охват таблицы: <b>${escapeHtml(v118SelectedScopeLabel())}</b></div><div class="metric-table-scroll-v116"><table class="metric-table-v116"><thead><tr>${header.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  async function v116OpenMetricTablesModal(){
    let modal=$('metricTablesModalV116');
    if(!modal){
      modal=document.createElement('div'); modal.id='metricTablesModalV116'; modal.className='chart-lightbox metric-tables-modal-v116'; modal.setAttribute('aria-hidden','true');
      modal.innerHTML=`<div class="chart-lightbox-scrim" data-close-metric-tables-v116="1"></div><section class="chart-lightbox-card metric-tables-card-v116" role="dialog" aria-modal="true" aria-labelledby="metricTablesTitleV116"><button type="button" class="chart-lightbox-close" aria-label="Закрыть таблицы">×</button><div class="chart-lightbox-kicker">Мультивременная аналитика · ${APP_VERSION}</div><h2 id="metricTablesTitleV116">Таблицы метрик по годам</h2><div id="metricTablesBodyV116" class="chart-lightbox-body metric-tables-body-v116">Загрузка…</div></section>`;
      modal.addEventListener('click', e=>{ if(e.target.matches('[data-close-metric-tables-v116], .chart-lightbox-close')) v116CloseMetricTablesModal(); });
      document.body.appendChild(modal);
    }
    modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
    const body=$('metricTablesBodyV116');
    const rows=await v116LoadMetricRows();
    await v118LoadRegionMetricRows();
    body.innerHTML=`<aside class="metric-table-controls-v116"><label class="control-label" for="metricTableGroupV116">Компонент анализа</label><select id="metricTableGroupV116">${Object.entries(metricTableGroupsV116).map(([k,g])=>`<option value="${k}">${escapeHtml(g.label)}</option>`).join('')}</select><label class="control-label" for="metricTableRegionModeV118">Охват пересчёта</label><select id="metricTableRegionModeV118"><option value="all">Весь статистический охват</option><option value="include">Только выбранные регионы 2021</option><option value="exclude">Все, кроме выбранных регионов 2021</option></select><div class="button-row metric-table-button-row-v116"><button type="button" id="metricTableRegionsAllV118">Все регионы</button><button type="button" id="metricTableRegionsNoneV118">Снять регионы</button></div><div id="metricTableRegionChecksV118" class="metric-table-regions-v118"></div><div class="mini-muted metric-table-region-note-v118">Для регионального охвата суммарные значения пересчитываются по наложению исторических АТЕ на контуры регионов 2021 г.; графовые показатели здесь являются диагностикой узловой подвыборки, а не полной перестройкой графа.</div><label class="control-label" for="metricTableOrientationV116">Структура таблицы</label><select id="metricTableOrientationV116"><option value="years_rows">Годы строками, метрики столбцами</option><option value="metrics_rows">Метрики строками, годы столбцами</option></select><div class="button-row metric-table-button-row-v116"><button type="button" id="metricTableYearsAllV116">Все годы</button><button type="button" id="metricTableYearsNoneV116">Снять годы</button><button type="button" id="metricTableYearsAnchorsV116">Опорные годы</button></div><div id="metricTableYearsV116" class="metric-table-years-v116"></div><div class="button-row metric-table-button-row-v116"><button type="button" id="metricTableMetricsAllV116">Все метрики</button><button type="button" id="metricTableMetricsNoneV116">Снять метрики</button><button type="button" id="metricTableMetricsRecommendedV116">Рекомендуемые</button></div><div id="metricTableMetricsV116" class="metric-table-metrics-v116"></div><div class="button-row metric-table-button-row-v116"><button type="button" id="metricTableCopyV116">Копировать TSV</button><button type="button" id="metricTableDownloadV116">Скачать CSV</button></div></aside><main class="metric-table-main-v116"><div class="mini-muted metric-table-note-v116">Таблица строится из ряда <code>multiyear_metrics_by_year.json</code>. Для регионального режима используется дополнительный слой пересчёта по контурам регионов 2021 г.; можно смотреть весь охват, выбранные регионы или весь ряд без выбранных регионов.</div><div id="metricTableResultV116"></div></main>`;
    v116RenderYearCheckboxes(rows); v118RenderRegionControls(rows); v116RenderMetricCheckboxes(rows); v116RenderMetricTable(rows);
    const rerender=()=>v116RenderMetricTable(rows);
    $('metricTableRegionModeV118')?.addEventListener('change',()=>{ v116RenderMetricCheckboxes(rows); v116RenderMetricTable(rows); });
    $('metricTableRegionsAllV118')?.addEventListener('click',()=>{ document.querySelectorAll('#metricTableRegionChecksV118 input').forEach(i=>i.checked=true); v116RenderMetricCheckboxes(rows); v116RenderMetricTable(rows); });
    $('metricTableRegionsNoneV118')?.addEventListener('click',()=>{ document.querySelectorAll('#metricTableRegionChecksV118 input').forEach(i=>i.checked=false); v116RenderMetricCheckboxes(rows); v116RenderMetricTable(rows); });
    $('metricTableGroupV116')?.addEventListener('change',()=>{ v116RenderMetricCheckboxes(rows); v116RenderMetricTable(rows); });
    $('metricTableOrientationV116')?.addEventListener('change',rerender);
    $('metricTableYearsAllV116')?.addEventListener('click',()=>{ document.querySelectorAll('#metricTableYearsV116 input').forEach(i=>i.checked=true); rerender(); });
    $('metricTableYearsNoneV116')?.addEventListener('click',()=>{ document.querySelectorAll('#metricTableYearsV116 input').forEach(i=>i.checked=false); rerender(); });
    $('metricTableYearsAnchorsV116')?.addEventListener('click',()=>{ const a=new Set(v116DefaultYears(rows)); document.querySelectorAll('#metricTableYearsV116 input').forEach(i=>i.checked=a.has(Number(i.value))); rerender(); });
    $('metricTableMetricsAllV116')?.addEventListener('click',()=>{ document.querySelectorAll('#metricTableMetricsV116 input').forEach(i=>i.checked=true); rerender(); });
    $('metricTableMetricsNoneV116')?.addEventListener('click',()=>{ document.querySelectorAll('#metricTableMetricsV116 input').forEach(i=>i.checked=false); rerender(); });
    $('metricTableMetricsRecommendedV116')?.addEventListener('click',()=>{ const rec=new Set(metricRecommendedV116[$('metricTableGroupV116')?.value||'population']||[]); document.querySelectorAll('#metricTableMetricsV116 input').forEach(i=>i.checked=rec.has(i.value)); rerender(); });
    $('metricTableCopyV116')?.addEventListener('click',async()=>{ const {header,body}=v116TableMatrix(rows); const tsv=[header,...body].map(r=>r.join('\t')).join('\n'); try{ await navigator.clipboard.writeText(tsv); $('metricTableCopyV116').textContent='Скопировано'; setTimeout(()=>{$('metricTableCopyV116').textContent='Копировать TSV';},1200); }catch(_){ alert('Не удалось скопировать автоматически.'); } });
    $('metricTableDownloadV116')?.addEventListener('click',()=>{ const {header,body}=v116TableMatrix(rows); const csv=[header,...body].map(r=>r.map(v116CsvEscape).join(';')).join('\n'); const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`west_siberia_metrics_${($('metricTableGroupV116')?.value||'table')}_v${APP_VERSION}.csv`; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},500); });
  }
  function v116CloseMetricTablesModal(){ const modal=$('metricTablesModalV116'); if(modal){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); } }
  function v116BindMetricTablesButton(){
    const btn=$(TABLE_BUTTON_ID);
    if(!btn || btn.dataset.v116Bound==='1') return;
    btn.dataset.v116Bound='1';
    btn.addEventListener('click',()=>v116OpenMetricTablesModal().catch(e=>{ console.error(e); alert('Не удалось открыть таблицы: '+(e.message||e)); }));
  }
  function v116Boot(){
    v116BindCenterLabelToggle();
    v116BindMetricTablesButton();
    const toggleCenters=$('toggleCenters');
    if(toggleCenters && toggleCenters.dataset.v116LabelBound!=='1'){
      toggleCenters.dataset.v116LabelBound='1';
      toggleCenters.addEventListener('change',()=>{ if(!state.layers.centerLabels || !state.centerLabelItems?.length) v116BuildCenterPointLabels(); refreshVisibility(); });
    }
    if(state.rawCentersGeoJSON) v116BuildCenterPointLabels();
    refreshVisibility?.();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(v116Boot,1300),{once:true}); else setTimeout(v116Boot,1300);
})();


/* v117: explicit administrative unit type filter + normalized city/gorsovet labels */
(function initV117UnitTypeFilter(){
  const STATE={year:null, available:[], visible:new Set(), all:true, initialized:false};
  const TYPE_GROUPS={
    territorial:/район|уезд|округ|волость|провинция|область|край|губерния|наместничество/i,
    urban:/город|горсовет|центр округа|городской округ|республиканского подчинения|зато/i
  };
  function normType(v){ return String(v || 'тип не указан').trim() || 'тип не указан'; }
  function groupForType(v){
    const t=normType(v);
    if(TYPE_GROUPS.urban.test(t)) return 'urban';
    if(TYPE_GROUPS.territorial.test(t)) return 'territorial';
    return 'other';
  }
  function ensureCard(){
    const grid=document.querySelector('#metricFilters .metric-filter-grid');
    if(!grid) return null;
    let card=document.getElementById('unitTypeFilterCardV117');
    if(card) return card;
    card=document.createElement('div');
    card.id='unitTypeFilterCardV117';
    card.className='metric-filter-item unit-type-filter-v117';
    card.dataset.filterField='unit_type_v117';
    card.innerHTML=`<label>Тип АТЕ</label>
      <div class="unit-type-filter-actions-v117">
        <button type="button" id="unitTypeAllV117">Все</button>
        <button type="button" id="unitTypeTerritorialV117">Районы / уезды / округа</button>
        <button type="button" id="unitTypeUrbanV117">Города / горсоветы</button>
      </div>
      <div id="unitTypeChecksV117" class="unit-type-checks-v117"></div>
      <div class="filter-meta"><span>категориальный фильтр</span><b id="unitTypeSummaryV117">все</b></div>`;
    grid.appendChild(card);
    const all=document.getElementById('unitTypeAllV117');
    const terr=document.getElementById('unitTypeTerritorialV117');
    const urb=document.getElementById('unitTypeUrbanV117');
    all?.addEventListener('click',()=>{ STATE.all=true; STATE.visible=new Set(STATE.available); renderChecks(); rerenderFilteredLayers?.(); });
    terr?.addEventListener('click',()=>{ STATE.all=false; STATE.visible=new Set(STATE.available.filter(t=>groupForType(t)==='territorial')); renderChecks(); rerenderFilteredLayers?.(); });
    urb?.addEventListener('click',()=>{ STATE.all=false; STATE.visible=new Set(STATE.available.filter(t=>groupForType(t)==='urban')); renderChecks(); rerenderFilteredLayers?.(); });
    return card;
  }
  function renderChecks(){
    ensureCard();
    const box=document.getElementById('unitTypeChecksV117'); if(!box) return;
    box.innerHTML=STATE.available.map(t=>{
      const safe=escapeHtml(t);
      const checked=STATE.all || STATE.visible.has(t);
      return `<label class="unit-type-check-v117"><input type="checkbox" value="${safe}" ${checked?'checked':''}><span>${safe}</span></label>`;
    }).join('');
    box.querySelectorAll('input').forEach(inp=>{
      inp.addEventListener('change',()=>{
        const values=[...box.querySelectorAll('input')];
        STATE.all=values.every(i=>i.checked);
        STATE.visible=new Set(values.filter(i=>i.checked).map(i=>i.value));
        updateSummary();
        rerenderFilteredLayers?.();
      });
    });
    updateSummary();
  }
  function updateSummary(){
    const b=document.getElementById('unitTypeSummaryV117'); if(!b) return;
    if(STATE.all || STATE.visible.size===STATE.available.length) b.textContent='все';
    else if(!STATE.visible.size) b.textContent='ничего';
    else b.textContent=`${STATE.visible.size} из ${STATE.available.length}`;
  }
  function sync(features){
    ensureCard();
    const year=state.year;
    const types=[...new Set((features||[]).map(f=>normType(f?.properties?.unit_type)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const changed=year!==STATE.year || types.join('§')!==STATE.available.join('§');
    if(changed){
      STATE.year=year;
      STATE.available=types;
      STATE.visible=new Set(types);
      STATE.all=true;
      renderChecks();
    }else{
      updateSummary();
    }
  }
  const oldSync=syncFilterRanges;
  syncFilterRanges=function syncFilterRangesV117(features){
    const result=oldSync.apply(this,arguments);
    try{ sync(features || state.rawGeoJSON?.features || []); }catch(e){ console.warn('v117 unit type filter sync failed',e); }
    return result;
  };
  const oldPass=featurePassesFilters;
  featurePassesFilters=function featurePassesFiltersV117(f){
    if(!oldPass.apply(this,arguments)) return false;
    if(!STATE.available.length || STATE.all) return true;
    return STATE.visible.has(normType(f?.properties?.unit_type));
  };
  const oldReset=document.getElementById('resetMetricFilters');
  function bindReset(){
    const reset=document.getElementById('resetMetricFilters');
    if(!reset || reset.dataset.v117UnitTypeReset==='1') return;
    reset.dataset.v117UnitTypeReset='1';
    reset.addEventListener('click',()=>{ STATE.all=true; STATE.visible=new Set(STATE.available); renderChecks(); }, true);
  }
  function boot(){
    ensureCard(); bindReset();
    sync(state.rawGeoJSON?.features || []);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1500),{once:true}); else setTimeout(boot,1500);
})();


/* v120: optional dashed trend/correlation fit lines with visible r/R² values in multiyear charts. */
(function v120InstallTrendFitControls(){
  const TOGGLE_ID='topologyTrendShowFitV120';
  const INFO_ID='topologyTrendFitInfoV120';
  function finite(v){ const n=Number(v); return Number.isFinite(n) ? n : NaN; }
  function pearson(rows){
    const n=rows.length;
    if(n<2) return NaN;
    const mx=rows.reduce((s,r)=>s+r.x,0)/n, my=rows.reduce((s,r)=>s+r.y,0)/n;
    let nume=0, dx=0, dy=0;
    rows.forEach(r=>{ const a=r.x-mx, b=r.y-my; nume+=a*b; dx+=a*a; dy+=b*b; });
    return dx>0 && dy>0 ? nume/Math.sqrt(dx*dy) : NaN;
  }
  function regression(rows){
    const n=rows.length;
    if(n<2) return null;
    const mx=rows.reduce((s,r)=>s+r.x,0)/n, my=rows.reduce((s,r)=>s+r.y,0)/n;
    let nume=0, den=0;
    rows.forEach(r=>{ nume+=(r.x-mx)*(r.y-my); den+=(r.x-mx)*(r.x-mx); });
    if(!den) return null;
    const slope=nume/den;
    return {slope, intercept:my-slope*mx};
  }
  function fmtR(v){ return Number.isFinite(v) ? v.toFixed(3).replace('.',',') : '—'; }
  function fmtR2(v){ return Number.isFinite(v) ? (v*v).toFixed(3).replace('.',',') : '—'; }
  function fmtPop(v){ return Number.isFinite(Number(v)) ? num(Math.round(Number(v))) : '—'; }
  function fmtCount(v){ return Number.isFinite(Number(v)) ? num(Number(v)) : '—'; }
  function trendEnabled(){
    const el=$(TOGGLE_ID);
    if(el) return !!el.checked;
    return state._topologyTrendShowFitV120 !== false;
  }
  function trendSet(v){ state._topologyTrendShowFitV120 = !!v; }
  function isCorrMetric(metric){ return ['corr_population_lower_ate_count','corr_population_upper_ate_count'].includes(String(metric||'')); }
  function corrDef(metric){
    return metric==='corr_population_upper_ate_count'
      ? {label:'корреляция: население ↔ верхние АТЕ', yKey:'upper_ate_count', yLabel:'число АТЕ верхнего уровня'}
      : {label:'корреляция: население ↔ нижние АТЕ', yKey:'lower_ate_count', yLabel:'число АТЕ нижнего уровня'};
  }
  function niceAxis(vals, target){ return (typeof v102NiceLinearAxis==='function' ? v102NiceLinearAxis(vals, target||5) : null) || {min:Math.min(...vals), max:Math.max(...vals), ticks:[Math.min(...vals), Math.max(...vals)]}; }
  function tickLabel(v, key){
    const n=Number(v);
    if(!Number.isFinite(n)) return '—';
    if(key==='total_population') return n>=1000 ? num(Math.round(n)) : String(Math.round(n));
    return Number.isInteger(n) ? num(n) : n.toFixed(1).replace('.',',');
  }
  function fitText(r, mode){
    if(!Number.isFinite(r)) return 'Недостаточно данных для расчёта корреляции.';
    const a=Math.abs(r);
    const strength=a>=0.8 ? 'сильная' : (a>=0.55 ? 'заметная' : (a>=0.3 ? 'умеренная' : 'слабая'));
    const dir=r>=0 ? 'положительная' : 'отрицательная';
    const prefix=mode==='time-log' ? 'Пунктир: линейный тренд по log10(значения).' : (mode==='time' ? 'Пунктир: линейный тренд по годам.' : 'Пунктир: линейная аппроксимация корреляционного поля.');
    return `${prefix} ${strength} ${dir} связь: r = ${fmtR(r)}, R² = ${fmtR2(r)}.`;
  }
  function insertControls(){
    const side=document.querySelector('.topology-trend-controls-v106') || document.querySelector('.topology-trend-controls-v91');
    if(!side || $(TOGGLE_ID)) return;
    const holder=document.createElement('div');
    holder.className='topology-trend-control-v91 trend-fit-control-v120';
    holder.innerHTML=`<label class="topology-trend-check-v91 trend-fit-check-v120"><input id="${TOGGLE_ID}" type="checkbox" ${trendEnabled()?'checked':''}> Пунктирный тренд / корреляция</label><div class="mini-muted" id="${INFO_ID}">Показывает линейный тренд и значение r/R² для выбранных лет.</div>`;
    const years=side.querySelector('#topologyTrendYearsV90');
    if(years && years.parentElement) side.insertBefore(holder, years.parentElement);
    else side.appendChild(holder);
    $(TOGGLE_ID)?.addEventListener('change',async e=>{ trendSet(e.target.checked); const data=await v93LoadMultiyearMetrics(); v106RenderMultiyearTrendChart(data); });
  }
  async function openWithControls(){
    if(typeof priorOpen==='function') await priorOpen();
    insertControls();
    try{ const data=await v93LoadMultiyearMetrics(); v106RenderMultiyearTrendChart(data); }catch(_){ }
  }
  function renderCorrelation(data){
    const chart=$('topologyTrendChartV90'), table=$('topologyTrendTableV90'), help=$('topologyTrendExplainSlotV106');
    if(!chart || !table) return;
    const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || 'corr_population_lower_ate_count';
    const def=corrDef(metric);
    const cfg=v93TrendSettings();
    const pointColor=v93SafeHexColor(cfg.pointColor,'#f2c14e');
    const lineColor=v93SafeHexColor(cfg.lineColor,'#9a6a22');
    const selectedYears=new Set((state._topologyTrendYears?.length ? state._topologyTrendYears : (data||[]).map(d=>Number(d.year))).map(Number));
    const rows=(data||[]).map(d=>({row:d, year:Number(d.year), x:finite(d.total_population), y:finite(d[def.yKey])}))
      .filter(r=>selectedYears.has(r.year) && Number.isFinite(r.x) && Number.isFinite(r.y) && r.x>=0 && r.y>=0)
      .sort((a,b)=>a.year-b.year);
    if(rows.length<2){
      chart.innerHTML='<div class="mini-muted">Для корреляционного графика выберите минимум два года с населением и числом АТЕ.</div>';
      table.innerHTML='';
      if(help) help.innerHTML='<section class="trend-help-card-v106"><h3>Корреляция населения и числа АТЕ</h3><p>Нужно минимум два года с числовыми данными. Для содержательной проверки лучше оставить несколько сопоставимых временных срезов.</p></section>';
      return;
    }
    const w=940,h=390,pad={l:106,r:42,t:38,b:76};
    const xAxis=niceAxis(rows.map(r=>r.x),5), yAxis=niceAxis(rows.map(r=>r.y),5);
    let xmin=Number(xAxis.min), xmax=Number(xAxis.max), ymin=Number(yAxis.min), ymax=Number(yAxis.max);
    if(xmin===xmax){ xmin-=1; xmax+=1; }
    if(ymin===ymax){ ymin-=1; ymax+=1; }
    const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
    const yScale=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
    const r=pearson(rows), reg=regression(rows);
    const showFit=trendEnabled();
    let regSvg='';
    if(showFit && reg){
      const x1=xmin, x2=xmax, y1=reg.intercept+reg.slope*x1, y2=reg.intercept+reg.slope*x2;
      regSvg=`<g clip-path="url(#trendClipV120)"><line x1="${xScale(x1).toFixed(1)}" y1="${yScale(y1).toFixed(1)}" x2="${xScale(x2).toFixed(1)}" y2="${yScale(y2).toFixed(1)}" class="trend-fit-line-v120" style="stroke:${lineColor}"/></g><text x="${w-pad.r}" y="24" text-anchor="end" class="trend-fit-label-v120">r = ${fmtR(r)} · R² = ${fmtR2(r)}</text>`;
    }
    const labelsSvg=cfg.showLabels ? rows.map(row=>`<text x="${xScale(row.x).toFixed(1)}" y="${Math.max(pad.t+Number(cfg.labelSize||11), yScale(row.y)-9).toFixed(1)}" text-anchor="middle" class="trend-point-label-v91" style="font-size:${Number(cfg.labelSize||11)}px">${row.year}</text>`).join('') : '';
    const note=showFit ? fitText(r,'corr') : 'Пунктирная линия тренда отключена. Точки всё равно показывают соотношение населения и числа АТЕ по выбранным годам.';
    chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88 topology-trend-svg-v90 topology-trend-svg-v91 topology-trend-svg-v108 topology-trend-svg-v120" role="img" aria-label="${escapeHtml(def.label)}"><defs><clipPath id="trendClipV120"><rect x="${pad.l}" y="${pad.t}" width="${w-pad.l-pad.r}" height="${h-pad.t-pad.b}"/></clipPath></defs><rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>${(yAxis.ticks||[]).map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScale(t)}" y2="${yScale(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScale(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(tickLabel(t,def.yKey))}</text>`).join('')}${(xAxis.ticks||[]).map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-38}" text-anchor="middle" class="trend-label-v88">${escapeHtml(tickLabel(t,'total_population'))}</text>`).join('')}${regSvg}${rows.map(row=>`<circle cx="${xScale(row.x).toFixed(1)}" cy="${yScale(row.y).toFixed(1)}" r="6.2" class="trend-point-v91" style="fill:${pointColor}"><title>${row.year}: население ${fmtPop(row.x)}; ${def.yLabel} — ${fmtCount(row.y)}</title></circle>`).join('')}${labelsSvg}<text x="${pad.l}" y="22" class="trend-title-v88 trend-title-v91">${escapeHtml(def.label)} · КОРРЕЛЯЦИОННОЕ ПОЛЕ</text><text x="${pad.l+(w-pad.l-pad.r)/2}" y="${h-10}" text-anchor="middle" class="trend-label-v88">население</text><text x="20" y="${pad.t+(h-pad.t-pad.b)/2}" transform="rotate(-90 20 ${pad.t+(h-pad.t-pad.b)/2})" text-anchor="middle" class="trend-label-v88">${escapeHtml(def.yLabel)}</text></svg><div class="topology-trend-note-v91 trend-fit-note-v120">${escapeHtml(note)}</div>`;
    if(help) help.innerHTML=`<section class="trend-help-card-v106 trend-help-card-v108"><h3>Как читать корреляционный график</h3><p>Каждая точка — отдельный год. По оси X отложено население статистического охвата, по оси Y — ${escapeHtml(def.yLabel)}. Пунктирная линия показывает общий линейный тренд и прямо подписывает коэффициенты <b>r</b> и <b>R²</b>.</p><p><b>Смысл для главы:</b> график помогает проверить, сопровождался ли демографический рост усложнением административной сетки. Положительная связь ожидаема, но сама по себе не доказывает, что население напрямую «создало» новые АТЕ.</p></section>`;
    table.innerHTML='<div class="chart-legend-head topology-trend-head-v88 topology-trend-head-v91"><span></span><span>ГОД</span><span>НАСЕЛЕНИЕ</span><span>'+escapeHtml(def.yLabel.toUpperCase())+'</span></div>'+rows.map(row=>`<div class="chart-legend-row topology-trend-row-v88 topology-trend-row-v91"><span class="pie-dot" style="background:${pointColor}"></span><span>${row.year}</span><b>${fmtPop(row.x)}</b><em>${fmtCount(row.y)}</em></div>`).join('');
  }
  function renderTimeSeries(data){
    const chart=$('topologyTrendChartV90'), table=$('topologyTrendTableV90'), help=$('topologyTrendExplainSlotV106'); if(!chart || !table) return;
    const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || 'area_cv_lower_ate';
    const context=v105IsAreaDispersionMetric(metric) ? (state._topologyTrendContextV105 || 'all') : 'all';
    const cfg=v93TrendSettings();
    const lineColor=v93SafeHexColor(cfg.lineColor,'#9a6a22');
    const pointColor=v93SafeHexColor(cfg.pointColor,'#f2c14e');
    const selectedYears=new Set((state._topologyTrendYears?.length ? state._topologyTrendYears : data.map(d=>Number(d.year))).map(Number));
    const rows=data.map(d=>({row:d, year:Number(d.year), value:v105TrendValue(d,metric,context)})).filter(d=>selectedYears.has(d.year) && Number.isFinite(d.value)).sort((a,b)=>a.year-b.year);
    if(rows.length<2){ chart.innerHTML='<div class="mini-muted">Для этой метрики/контекста выберите минимум два года с числовыми данными.</div>'; table.innerHTML=''; if(help) help.innerHTML=v106MetricHelpHtml(metric,rows,context); return; }
    const w=940,h=390,pad={l:88,r:34,t:36,b:54};
    const xs=rows.map(r=>r.year), rawYs=rows.map(r=>r.value);
    const xmin=Math.min(...xs), xmax=Math.max(...xs);
    const positives=rawYs.filter(y=>y>0);
    const useLog=cfg.scale==='log' && positives.length>0;
    const logFloor=useLog ? Math.min(...positives)/10 : null;
    const transformY=y=>useLog ? Math.log10(y>0 ? y : logFloor) : y;
    const inverseY=y=>useLog ? Math.pow(10,y) : y;
    const axisPlan=useLog ? v102NiceLogAxis(rawYs, logFloor) : v102NiceLinearAxis(rawYs, 5);
    const ys=rawYs.map(transformY);
    let ymin=axisPlan ? axisPlan.min : Math.min(...ys), ymax=axisPlan ? axisPlan.max : Math.max(...ys);
    if(ymin===ymax){ ymin-=useLog ? .5 : 1; ymax+=useLog ? .5 : 1; }
    const xScale=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(w-pad.l-pad.r);
    const yScaleRaw=y=>h-pad.b-(transformY(y)-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
    const yScaleTrans=y=>h-pad.b-(y-ymin)/(ymax-ymin||1)*(h-pad.t-pad.b);
    const pts=rows.map(r=>`${xScale(r.year).toFixed(1)},${yScaleRaw(r.value).toFixed(1)}`).join(' ');
    const xTicks=rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.ceil(rows.length/9)===0).map(r=>r.year);
    const yTicks=axisPlan?.ticks?.length ? axisPlan.ticks : [0,.25,.5,.75,1].map(t=>ymin+(ymax-ymin)*t);
    const valueLabel=(v)=> v105IsAreaDispersionMetric(metric) ? v105FormatAreaTrendValue(v,metric) : v93FormatTrendValue(v,metric);
    const axisLabel=(t)=> v105IsAreaDispersionMetric(metric) ? v105FormatAreaTrendValue(inverseY(t),metric).replace('×','') : v102FormatAxisTick(inverseY(t),metric,axisPlan,useLog);
    const labelsSvg=cfg.showLabels ? rows.map(r=>{ const x=xScale(r.year); const y=Math.max(pad.t+Number(cfg.labelSize||11), yScaleRaw(r.value)-9); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="trend-point-label-v91" style="font-size:${Number(cfg.labelSize||11)}px">${escapeHtml(valueLabel(r.value))}</text>`; }).join('') : '';
    const contextSuffix=context && context!=='all' ? ` · ${context}` : '';
    const fitRows=rows.map(r=>({x:r.year, y:transformY(r.value)})).filter(r=>Number.isFinite(r.x)&&Number.isFinite(r.y));
    const rFit=pearson(fitRows), reg=regression(fitRows);
    const showFit=trendEnabled();
    const fitMode=useLog ? 'time-log' : 'time';
    let fitSvg='';
    if(showFit && reg){
      const fy1=reg.intercept+reg.slope*xmin, fy2=reg.intercept+reg.slope*xmax;
      fitSvg=`<g clip-path="url(#trendClipV120)"><line x1="${xScale(xmin).toFixed(1)}" y1="${yScaleTrans(fy1).toFixed(1)}" x2="${xScale(xmax).toFixed(1)}" y2="${yScaleTrans(fy2).toFixed(1)}" class="trend-fit-line-v120" style="stroke:${lineColor}"/></g><text x="${w-pad.r}" y="24" text-anchor="end" class="trend-fit-label-v120">r = ${fmtR(rFit)} · R² = ${fmtR2(rFit)}</text>`;
    }
    const fitNote=showFit ? `<div class="topology-trend-note-v91 trend-fit-note-v120">${escapeHtml(fitText(rFit,fitMode))}</div>` : '<div class="topology-trend-note-v91 trend-fit-note-v120">Пунктирная линия тренда отключена.</div>';
    const logNote=(cfg.scale==='log' && !positives.length) ? '<div class="topology-trend-note-v91">Для этой метрики нет положительных значений; показана линейная шкала.</div>' : (useLog && rawYs.some(y=>y<=0) ? '<div class="topology-trend-note-v91">Log10-шкала: нулевые значения прижаты к нижней границе.</div>' : '');
    chart.innerHTML=`<svg viewBox="0 0 ${w} ${h}" class="topology-trend-svg-v88 topology-trend-svg-v90 topology-trend-svg-v91 topology-trend-svg-v105 topology-trend-svg-v106 topology-trend-svg-v120" role="img" aria-label="Динамика ${escapeHtml(v93TrendLabels[metric]||metric)}"><defs><clipPath id="trendClipV120"><rect x="${pad.l}" y="${pad.t}" width="${w-pad.l-pad.r}" height="${h-pad.t-pad.b}"/></clipPath></defs><rect x="0" y="0" width="${w}" height="${h}" rx="18" class="trend-bg-v88"/>${yTicks.map(t=>`<line x1="${pad.l}" x2="${w-pad.r}" y1="${yScaleTrans(t)}" y2="${yScaleTrans(t)}" class="trend-grid-v88"/><text x="${pad.l-10}" y="${yScaleTrans(t)+4}" text-anchor="end" class="trend-label-v88">${escapeHtml(axisLabel(t))}</text>`).join('')}${xTicks.map(t=>`<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${pad.t}" y2="${h-pad.b}" class="trend-grid-x-v88"/><text x="${xScale(t)}" y="${h-18}" text-anchor="middle" class="trend-label-v88">${t}</text>`).join('')}<polyline points="${pts}" fill="none" class="trend-line-v91" style="stroke:${lineColor}"/>${fitSvg}${rows.map(r=>`<circle cx="${xScale(r.year).toFixed(1)}" cy="${yScaleRaw(r.value).toFixed(1)}" r="5.8" class="trend-point-v91" style="fill:${pointColor}"><title>${r.year}: ${valueLabel(r.value)}${contextSuffix}</title></circle>`).join('')}${labelsSvg}<text x="${pad.l}" y="22" class="trend-title-v88 trend-title-v91">${escapeHtml(v93TrendLabels[metric]||metric)}${escapeHtml(contextSuffix)} · ${useLog?'LOG10':'ЛИНЕЙНАЯ ШКАЛА'}</text></svg>${fitNote}${logNote}`;
    if(help) help.innerHTML=v106MetricHelpHtml(metric,rows,context);
    table.innerHTML='<div class="chart-legend-head topology-trend-head-v88 topology-trend-head-v91"><span></span><span>ГОД</span><span>ЗНАЧЕНИЕ</span><span>УРОВЕНЬ / КОНТЕКСТ</span></div>'+rows.map(r=>`<div class="chart-legend-row topology-trend-row-v88 topology-trend-row-v91"><span class="pie-dot" style="background:${pointColor}"></span><span>${r.year}</span><b>${valueLabel(r.value)}</b><em>${escapeHtml(v105IsAreaDispersionMetric(metric)?v105AreaTrendLeader(r.row,metric,context):v93TrendLeader(r.row,metric))}</em></div>`).join('');
  }
  const priorOpen=typeof v106OpenMultiyearTrendsModal==='function' ? v106OpenMultiyearTrendsModal : (typeof openTopologyTrendsModal==='function' ? openTopologyTrendsModal : null);
  const renderFinal=function v106RenderMultiyearTrendChartV120(data){
    insertControls();
    const metric=state._topologyTrendMetric || $('topologyTrendMetricV90')?.value || '';
    if(isCorrMetric(metric)) return renderCorrelation(data);
    return renderTimeSeries(data||[]);
  };
  try{ v106RenderMultiyearTrendChart=renderFinal; }catch(_){ window.v106RenderMultiyearTrendChart=renderFinal; }
  try{ v93OpenMultiyearTrendsModal=openWithControls; v90OpenTopologyTrendsModal=openWithControls; openTopologyTrendsModal=openWithControls; }catch(_){ }
})();
