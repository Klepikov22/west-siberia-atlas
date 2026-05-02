const fmt = new Intl.NumberFormat('ru-RU');
const $ = (id) => document.getElementById(id);
const state = {manifest:null, year:null, mode:'admin_parent', layers:{}, cache:{}, map:null, colors:{}};
const palette = ['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#bc80bd','#ccebc5','#ffed6f','#d9d9d9'];
const ramp = ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#3182bd','#08519c'];
function valueColor(v, values){ if(v==null||Number.isNaN(v)) return '#3a3f4b'; const sorted=values.filter(x=>x!=null&&!Number.isNaN(x)).sort((a,b)=>a-b); if(!sorted.length) return '#808080'; const pos=sorted.findIndex(x=>x>=v); const q=pos<0?1:pos/(sorted.length-1||1); return ramp[Math.max(0, Math.min(ramp.length-1, Math.floor(q*(ramp.length-1))))]; }
function catColor(v){ if(!v) return '#666'; if(!state.colors[v]) state.colors[v]=palette[Object.keys(state.colors).length%palette.length]; return state.colors[v]; }
function num(v){ return v==null||Number.isNaN(Number(v)) ? '—' : fmt.format(Math.round(Number(v))); }
function pct(v){ return v==null||Number.isNaN(Number(v)) ? '—' : (Number(v)*100).toFixed(1).replace('.',',')+'%'; }
async function loadJson(path){ if(state.cache[path]) return state.cache[path]; const r=await fetch(path); const j=await r.json(); state.cache[path]=j; return j; }
async function init(){
  state.manifest = await loadJson('data/manifest.json');
  const yearSelect=$('yearSelect'); state.manifest.years.forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;yearSelect.appendChild(o)});
  state.year = state.manifest.years.includes(1914)?1914:state.manifest.years[0]; yearSelect.value=state.year;
  state.map = L.map('map', {zoomControl:true}).setView([57.5,75],4);
  L.control.scale({imperial:false}).addTo(state.map);
  bindUi(); await refreshAll();
}
function bindUi(){
  $('yearSelect').addEventListener('change', async e=>{state.year=Number(e.target.value); await refreshAll();});
  $('modeSelect').addEventListener('change', async e=>{state.mode=e.target.value; await refreshAdmin();});
  ['toggleRelief','toggleHydro','toggleCenters','toggleRailways','toggleCircles'].forEach(id=>$(id).addEventListener('change', refreshVisibility));
  $('resetView').addEventListener('click', ()=> state.map.fitBounds([[43.5,59],[74,91]]));
}
function clearLayer(name){ if(state.layers[name]){ state.map.removeLayer(state.layers[name]); state.layers[name]=null; }}
async function refreshAll(){ await refreshRelief(); await refreshHydro(); await refreshAdmin(); await refreshCenters(); await refreshRailways(); refreshVisibility(); }
async function refreshRelief(){ clearLayer('relief'); const b=await loadJson(state.manifest.layers.raster.relief_bounds); const [w,s,e,n]=b.bounds_4326; state.layers.relief=L.imageOverlay(state.manifest.layers.raster.relief_preview, [[s,w],[n,e]], {opacity:.28}); }
async function refreshHydro(){
  clearLayer('rivers'); clearLayer('lakes');
  const rivers=await loadJson(state.manifest.layers.hydro.rivers); const lakes=await loadJson(state.manifest.layers.hydro.lakes);
  state.layers.lakes=L.geoJSON(lakes,{style:{color:'#4ea5d9',weight:.7,fillColor:'#2b80b9',fillOpacity:.28}});
  state.layers.rivers=L.geoJSON(rivers,{style:f=>({color:'#56b4e9',weight: Math.max(.5, Number(f.properties.strokeweig||1.1)), opacity:.82})});
}
function adminStyle(feature, vals){ const p=feature.properties; let fill='#666'; if(state.mode==='admin_parent') fill=catColor(p.admin_parent); if(state.mode==='unit_type') fill=catColor(p.unit_type); if(state.mode==='population') fill=valueColor(Number(p.population), vals); if(state.mode==='density') fill=valueColor(Number(p.density), vals); if(state.mode==='urban_share') fill=valueColor(Number(p.urban_share), vals); return {color:'#e7d8ba',weight:1.15,opacity:.85,fillColor:fill,fillOpacity:.55}; }
async function refreshAdmin(){
  clearLayer('admin'); clearLayer('circles');
  const path=state.manifest.layers.admin[String(state.year)]; const gj=await loadJson(path);
  const valField = state.mode==='population'?'population':state.mode==='density'?'density':state.mode==='urban_share'?'urban_share':null;
  const vals = valField ? gj.features.map(f=>Number(f.properties[valField])).filter(v=>!Number.isNaN(v)) : [];
  const admin = L.geoJSON(gj,{style:f=>adminStyle(f,vals),onEachFeature:(f,l)=>{l.on('click',()=>showFeature(f)); l.bindTooltip(f.properties.name||'без названия',{sticky:true});}});
  state.layers.admin=admin;
  state.layers.circles=L.layerGroup();
  const maxPop=Math.max(...gj.features.map(f=>Number(f.properties.population)||0),1);
  admin.eachLayer(layer=>{ const p=layer.feature.properties; if(!p.population) return; const c=layer.getBounds().getCenter(); const r=4+Math.sqrt(Number(p.population)/maxPop)*28; const m=L.circleMarker(c,{radius:r, color:'#271f12', weight:1, fillColor:'#d9a441', fillOpacity:.55}); m.bindPopup(`<b>${p.name||'объект'}</b><br>Население: ${num(p.population)}`); state.layers.circles.addLayer(m); });
  updateStats(gj); updateLegend(gj, vals);
  if(!state._fitDone){ state.map.fitBounds(admin.getBounds()); state._fitDone=true; }
  refreshVisibility();
}
async function refreshCenters(){ clearLayer('centers'); const path=state.manifest.layers.centers[String(state.year)]; if(!path) return; const gj=await loadJson(path); state.layers.centers=L.geoJSON(gj,{pointToLayer:(f,latlng)=>L.circleMarker(latlng,{radius:4,color:'#111',weight:1.5,fillColor:'#f6d365',fillOpacity:.95}),onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`<b>${p.name||'центр'}</b><br>${p.unit_name||''}<br>${p.admin_parent||''}`)}}); refreshVisibility(); }
async function refreshRailways(){ clearLayer('railways'); const gj=await loadJson(state.manifest.layers.railways.main); const yr=state.year; const filtered={type:'FeatureCollection', features:gj.features.filter(f=>{const p=f.properties; const o=Number(p.year_open); const c=p.year_close==null?null:Number(p.year_close); return o<=yr && (c==null || c>yr);})}; state.layers.railways=L.geoJSON(filtered,{style:{color:'#1a1712',weight:3.5,opacity:.95},onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(`ЖД-сегмент<br>постр.: ${p.year_open||'—'}<br>упразд.: ${p.year_close||'—'}`)}}); refreshVisibility(); }
function refreshVisibility(){
  const order=[['relief','toggleRelief'],['lakes','toggleHydro'],['rivers','toggleHydro'],['admin',null],['circles','toggleCircles'],['railways','toggleRailways'],['centers','toggleCenters']];
  order.forEach(([layerName,toggle])=>{const layer=state.layers[layerName]; if(!layer) return; const show= toggle?$(toggle).checked:true; if(show && !state.map.hasLayer(layer)) layer.addTo(state.map); if(!show && state.map.hasLayer(layer)) state.map.removeLayer(layer);});
}
function updateStats(gj){ const pops=gj.features.map(f=>Number(f.properties.population)||0); const total=pops.reduce((a,b)=>a+b,0); const dens=gj.features.map(f=>Number(f.properties.density)).filter(v=>!Number.isNaN(v)); const avgD=dens.length?dens.reduce((a,b)=>a+b,0)/dens.length:null; const railwayCount=state.layers.railways?state.layers.railways.getLayers().length:0; $('statsBox').innerHTML=`<div class="stat-grid"><div class="stat"><div class="k">объектов</div><div class="v">${fmt.format(gj.features.length)}</div></div><div class="stat"><div class="k">население</div><div class="v">${num(total)}</div></div><div class="stat"><div class="k">ср. плотность</div><div class="v">${avgD?avgD.toFixed(2):'—'}</div></div><div class="stat"><div class="k">год</div><div class="v">${state.year}</div></div></div>`; }
function updateLegend(gj, vals){ const box=$('legendBox'); let html='<b>Легенда</b>'; if(state.mode==='admin_parent'||state.mode==='unit_type'){const field=state.mode; const cats=[...new Set(gj.features.map(f=>f.properties[field]).filter(Boolean))].slice(0,12); cats.forEach(c=>{html+=`<div class="legend-row"><span class="swatch" style="background:${catColor(c)}"></span>${c}</div>`});} else {ramp.forEach((c,i)=>{html+=`<div class="legend-row"><span class="swatch" style="background:${c}"></span>${i===0?'меньше':i===ramp.length-1?'больше':''}</div>`});} box.innerHTML=html; }
function showFeature(f){ const p=f.properties; $('featureInfo').classList.remove('muted'); $('featureInfo').innerHTML=`<div class="info-title">${p.name||'Без названия'}</div><div class="info-row"><span>Год</span><b>${p.year||state.year}</b></div><div class="info-row"><span>Тип</span><b>${p.unit_type||'—'}</b></div><div class="info-row"><span>Подчинение</span><b>${p.admin_parent||'—'}</b></div><div class="info-row"><span>Центр</span><b>${p.center||'—'}</b></div><div class="info-row"><span>Население</span><b>${num(p.population)}</b></div><div class="info-row"><span>Городское</span><b>${num(p.urban_pop)}</b></div><div class="info-row"><span>Сельское</span><b>${num(p.rural_pop)}</b></div><div class="info-row"><span>Доля городского</span><b>${pct(p.urban_share)}</b></div><div class="info-row"><span>Площадь, км²</span><b>${num(p.area_km2)}</b></div><div class="info-row"><span>Плотность</span><b>${p.density==null?'—':Number(p.density).toFixed(2).replace('.',',')}</b></div><div class="info-row"><span>Исходный слой</span><b>${p.source_layer||'—'}</b></div>`; }
init().catch(err=>{console.error(err); alert('Ошибка загрузки данных: '+err.message);});
