const APP_VERSION = '33';
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
  export:{open:false, scope:'currentLayer', showLegend:true, showStats:true, showContext:true, fitScope:true, contextMode:'short', title:'', subtitle:'', contextText:'', mapImage:''},
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
  if(['circle','bar'].includes(savedSymbolType)) state.populationSymbol.type=savedSymbolType;
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
  const symbolTypeSelect = $('populationSymbolType');
  if(symbolTypeSelect && symbolTypeSelect.value !== state.populationSymbol.type) symbolTypeSelect.value = state.populationSymbol.type;
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
    storageSet('wsAtlasPopulationSymbolType', state.populationSymbol.type);
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
    const type=state.populationSymbol.type==='bar'?'столбцы':'круги';
    const scale={sqrt:'квадратный корень',linear:'линейное',log:'логарифмическое',quantile:'квантильное'}[state.populationSymbol.scale] || state.populationSymbol.scale;
    hint.textContent=`${type}: ${scale} нормирование, размер ${Math.round(state.populationSymbol.minSize)}–${Math.round(state.populationSymbol.maxSize)} px.`;
  }
}
function persistPopulationSymbolSettings(){
  storageSet('wsAtlasPopulationSymbolType', state.populationSymbol.type);
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
function addCenterLabel(latlng, text, priority=0, meta={}){
  const group=ensureCenterLabelLayer();
  if(!group || !text) return;
  const cls=['center-map-label'];
  if(meta.city) cls.push('city-label');
  if(meta.large) cls.push('large-city-label');
  const marker=L.marker(latlng, {
    opacity:0,
    interactive:false,
    keyboard:false,
    zIndexOffset:1000,
    icon:L.divIcon({className:'center-label-anchor', html:'', iconSize:[1,1], iconAnchor:[0,0]})
  });
  marker.bindTooltip(escapeHtml(cleanCenterLabelName(text)), {
    permanent:true,
    direction:'top',
    offset:[0,-10],
    opacity:1,
    className:cls.join(' '),
    interactive:false
  });
  group.addLayer(marker);
  state.centerLabelItems.push({latlng, marker, priority, city:!!meta.city, large:!!meta.large, pop:meta.pop||0});
}
function updateCenterLabels(){
  if(!state.map || !state.centerLabelItems) return;
  const show=$('toggleCenters')?.checked !== false;
  const z=state.map.getZoom();
  const size=state.map.getSize();
  const placed=[];
  const items=[...state.centerLabelItems].sort((a,b)=>(b.priority||0)-(a.priority||0));
  for(const item of items){
    const tooltip=item.marker?.getTooltip?.();
    const el=tooltip?.getElement?.();
    if(!el) continue;
    const pnt=state.map.latLngToContainerPoint(item.latlng);
    const inside=pnt.x>38 && pnt.x<size.x-38 && pnt.y>38 && pnt.y<size.y-38;
    let zoomOk = item.city ? z>=3.45 : z>=5.15;
    if(!item.city && state.centerLabelItems.length<80) zoomOk = z>=4.45;
    let ok=show && inside && zoomOk;
    el.style.display=ok?'block':'none';
    if(ok){
      const r=el.getBoundingClientRect();
      const pad=item.large?7:5;
      const rr={left:r.left-pad,right:r.right+pad,top:r.top-pad,bottom:r.bottom+pad};
      if(placed.some(q=>!(rr.right<q.left || rr.left>q.right || rr.bottom<q.top || rr.top>q.bottom))){
        el.style.display='none';
      } else placed.push(rr);
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
  on('populationSymbolType','change', e=>{ state.populationSymbol.type=['circle','bar'].includes(e.target.value)?e.target.value:'circle'; updatePopulationSymbolControls(); persistPopulationSymbolSettings(); rebuildPopulationSymbols(); });
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
  state.layers.admin=admin; buildCircles(admin, gj);
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
    const m=state.populationSymbol.type==='bar'
      ? buildPopulationBarMarker(c, f, size, s)
      : L.circleMarker(c,{radius:size, color:s.circleLine, weight:1.65, fillColor:s.circleFill, fillOpacity:.74, opacity:.98});
    m.feature=f;
    m.on('mouseover',(e)=>showHoverLater({title:p.name||'объект', subtitle:state.populationSymbol.type==='bar'?'столбец населения':'круг населения', population:pop, density:p.density}, e.originalEvent));
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

async function refreshCenters(seq){
  clearLayer('centers'); clearLayer('labels'); clearCenterLabels(); state.maxCenterPop=0;
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
  const labelSeen=new Set();
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
async function refreshRailways(seq){
  clearLayer('railways'); const gj=await loadJson(state.manifest.layers.railways.main);
  if(isStaleRefresh(seq)) return;
  const yr=state.year;
  const filtered={type:'FeatureCollection', features:gj.features.filter(f=>{const p=f.properties; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close); return o<=yr && (c==null || c>yr);})};
  const s=styleVars(); state.layers.railways=L.geoJSON(filtered,{style:{color:s.railway,weight:1.65,opacity:.88},onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`ЖД-сегмент<br>постр.: ${p.year_open||'—'}<br>упразд.: ${p.year_close||'—'}`)}});
}

function refreshVisibility(){
  const vis={hydro:$('toggleHydro')?.checked, admin:$('toggleAdmin')?.checked, centers:$('toggleCenters')?.checked, railways:$('toggleRailways')?.checked, circles:$('toggleCircles')?.checked};
  const entries=[['rivers',vis.hydro],['water',vis.hydro],['admin',vis.admin],['railways',vis.railways],['circles',vis.circles],['centers',vis.centers],['centerLabels',vis.centers]];
  // Пересобираем порядок слоёв каждый раз. Это грубее, но надёжнее для GitHub/Leaflet и не даёт воде съедать АТД.
  entries.forEach(([name])=>{ const l=state.layers[name]; if(l && state.map.hasLayer(l)) state.map.removeLayer(l); });
  entries.forEach(([name,show])=>{ const l=state.layers[name]; if(l && show) l.addTo(state.map); });
  // Финальная страховка порядка.
  if(state.layers.rivers?.bringToBack) state.layers.rivers.bringToBack();
  if(state.layers.water?.bringToFront) state.layers.water.bringToFront();
  if(state.layers.admin?.bringToFront) state.layers.admin.bringToFront();
  if(state.layers.railways?.bringToFront) state.layers.railways.bringToFront();
  bringLayerGroupToFront(state.layers.circles); bringLayerGroupToFront(state.layers.centers); bringLayerGroupToFront(state.layers.centerLabels);
  updateLabelsVisibility(); updateCenterLabels(); updateLegend(state.currentGeoJSON || {features:[]}, state._lastVals || []);
}
function bringLayerGroupToFront(layer){ if(!layer) return; if(layer.bringToFront) layer.bringToFront(); if(layer.eachLayer) layer.eachLayer(l=>{ if(l.bringToFront) l.bringToFront(); }); }
function refreshVectorStyles(){
  const s=styleVars();
  if(state.layers.rivers) state.layers.rivers.setStyle(riverStyle);
  if(state.layers.water) state.layers.water.setStyle(waterStyle);
  if(state.layers.railways) state.layers.railways.setStyle({color:s.railway,weight:1.65,opacity:.88});
  if(state.layers.admin) refreshSelectionStyles();
  if(state.layers.circles){
    if(state.populationSymbol.type==='bar') rebuildPopulationSymbols();
    else state.layers.circles.eachLayer(m=>m.setStyle && m.setStyle({color:s.circleLine, fillColor:s.circleFill, fillOpacity:.74, opacity:.98}));
  }
  if(state.layers.centers) state.layers.centers.eachLayer(m=>m.setStyle && m.setStyle({color:'#3a2607', fillColor:'#f6c85f', fillOpacity:.82, opacity:.98}));
  refreshVisibility();
}

function toggleSelection(f){ const id=featureId(f); if(state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id); refreshSelectionStyles(); updateStatsAndSelection(); showFeature(f); }
function refreshSelectionStyles(){ if(!state.layers.admin) return; state.layers.admin.eachLayer(l=>l.setStyle(adminStyle(l.feature,state._lastVals))); }
function refreshSelectionStylesFor(id){ const l=state.adminLayerById.get(id); if(l) l.setStyle(adminStyle(l.feature,state._lastVals)); }

function exportScopeFeatures(scope=state.export.scope){
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
  const modeTitles={admin_parent:'Административно-территориальное деление', population:'Население административных единиц', density:'Плотность населения', urban_share:'Доля городского населения', rail_length:'Длина железных дорог в пределах АТЕ', rail_density:'Плотность железных дорог', unit_type:'Типы административных единиц'};
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
}
function syncExportContextText(){
  const preset=exportContextPresets(state.year);
  state.export.contextText = state.export.contextMode==='long' ? preset.long : preset.short;
  if($('exportContextText')) $('exportContextText').value=state.export.contextText;
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
  wrap.innerHTML=`<article class="export-layout"><header class="export-header"><div class="export-title-block"><h1>${escapeHtml(state.export.title || defaultExportTitle())}</h1><p>${escapeHtml(state.export.subtitle || defaultExportSubtitle(features))}</p></div><div class="export-header-meta"><span>Год</span><b>${state.year}</b><span>Режим</span><b>${escapeHtml($('modeSelect')?.selectedOptions?.[0]?.textContent || state.mode)}</b></div></header>${state.export.showContext?`<section class="export-context"><h3>Контекст</h3><p>${escapeHtml(state.export.contextText || '')}</p></section>`:''}<section class="export-main"><div class="export-map-frame">${previewImg}</div><aside class="export-side">${state.export.showStats?`<section class="export-side-block"><h3>Общая информация</h3>${exportStatsHtml(features)}</section>`:''}${state.export.showLegend?`<section class="export-side-block"><h3>Легенда</h3>${exportLegendHtml()}</section>`:''}</aside></section><footer class="export-footer">Источник: интерактивный веб‑атлас дипломного исследования «Пространственная трансформация системы АТЕ Западной Сибири в XVIII–XX веках». Подготовлено в режиме экспорта v${APP_VERSION}.</footer></article>`;
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
  if(state.mode==='admin_parent'||state.mode==='unit_type'){ const field=state.mode; const cats=[...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,14); cats.forEach(c=>{html+=`<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${c}</div>`}); }
  else { activeValueRamp().forEach((c,i,arr)=>{html+=`<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===arr.length-1?'больше':''}</div>`}); }
  html+=`<div class="legend-section">Гидрография</div><div class="legend-row"><span class="swatch water-swatch"></span>океан, озёра и водохранилища</div><div class="legend-row"><span class="river-swatch"></span>реки</div>`;
  if($('toggleCircles')?.checked){ const max=state.maxPop||0; const mid=max/4; const vals=state.currentGeoJSON?.features?.map(f=>Number(f.properties?.population)||0).filter(v=>v>0)||[]; const sectionTitle=state.populationSymbol.type==='bar'?'Столбцы населения':'Круги населения'; html+=`<div class="legend-section">${sectionTitle}</div>`; [[max,'макс.'],[mid,'примерно 1/4 макс.']].forEach(([v,label])=>{ const size=Math.max(8, populationSymbolSize(v, vals)); if(state.populationSymbol.type==='bar'){ const h=Math.max(10,size); const w=Math.max(8, Math.min(18, Math.round(h*.32))); html+=`<div class="legend-row"><span class="bar-swatch" style="width:${w}px;height:${h}px"></span>${label}: ${num(v)}</div>`; } else { html+=`<div class="legend-row"><span class="circle-swatch" style="width:${size*1.25}px;height:${size*1.25}px"></span>${label}: ${num(v)}</div>`; } }); const scaleName={sqrt:'квадратный корень',linear:'линейное',log:'логарифмическое',quantile:'квантильное'}[state.populationSymbol.scale]||state.populationSymbol.scale; html+=`<div class="mini-muted">Нормирование: ${scaleName}. Диапазон размера: ${Math.round(state.populationSymbol.minSize)}–${Math.round(state.populationSymbol.maxSize)} px.</div>`; }
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
