const fs = require('fs');
const path = require('path');
const ROOT='.';
const TOPO=path.join(ROOT,'data','topology');
const STAB=path.join(ROOT,'data','stability');
const DOCS=path.join(ROOT,'docs');
fs.mkdirSync(STAB,{recursive:true}); fs.mkdirSync(DOCS,{recursive:true});
const SEGMENT_KM=25;
const MIN_OUTPUT_YEARS=2;
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'data','manifest.json'),'utf8'));
const YEARS=(manifest.years||[]).map(Number).filter(y=>fs.existsSync(path.join(TOPO,`topology_${y}.geojson`)));
function distKm(a,b){
  const lat=(a[1]+b[1])*0.5*Math.PI/180;
  const dx=(b[0]-a[0])*111.320*Math.cos(lat);
  const dy=(b[1]-a[1])*110.574;
  return Math.sqrt(dx*dx+dy*dy);
}
function project(p){
  // Fixed equirectangular projection around 58N; exact distance still uses distKm().
  return [p[0]*111.320*Math.cos(58*Math.PI/180), p[1]*110.574];
}
function interp(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]; }
function lineLength(coords){ let s=0; for(let i=1;i<coords.length;i++) s+=distKm(coords[i-1],coords[i]); return s; }
function pointAt(coords, cum, d){
  if(d<=0) return coords[0].slice();
  const total=cum[cum.length-1]; if(d>=total) return coords[coords.length-1].slice();
  let lo=1; while(lo<cum.length && cum[lo]<d) lo++;
  const prev=cum[lo-1], segLen=cum[lo]-prev;
  const t=segLen>0 ? (d-prev)/segLen : 0;
  return interp(coords[lo-1],coords[lo],t);
}
function subline(coords, cum, d0, d1){
  const out=[pointAt(coords,cum,d0)];
  for(let i=1;i<coords.length-1;i++) if(cum[i]>d0 && cum[i]<d1) out.push(coords[i]);
  out.push(pointAt(coords,cum,d1));
  // Remove near duplicate vertices.
  return out.filter((p,i)=>i===0 || Math.abs(p[0]-out[i-1][0])>1e-9 || Math.abs(p[1]-out[i-1][1])>1e-9);
}
function flattenLine(geom){
  if(!geom) return [];
  if(geom.type==='LineString') return [geom.coordinates];
  if(geom.type==='MultiLineString') return geom.coordinates;
  return [];
}
function longestStreak(years){
  const set=new Set(years.map(Number)); let best=0, cur=0;
  for(const y of YEARS){ if(set.has(y)){ cur++; if(cur>best) best=cur; } else cur=0; }
  return best;
}
const pieces=[]; let sourceEdges=0, sourceKm=0;
for(const y of YEARS){
  const gj=JSON.parse(fs.readFileSync(path.join(TOPO,`topology_${y}.geojson`),'utf8'));
  (gj.features||[]).forEach((f, edgeIdx0)=>{
    const p=f.properties||{}; if(p.topology_excluded) return;
    for(const coordsRaw of flattenLine(f.geometry)){
      const coords=(coordsRaw||[]).filter(c=>Array.isArray(c)&&Number.isFinite(+c[0])&&Number.isFinite(+c[1])).map(c=>[+c[0],+c[1]]);
      if(coords.length<2) continue;
      const cum=[0]; for(let i=1;i<coords.length;i++) cum.push(cum[cum.length-1]+distKm(coords[i-1],coords[i]));
      const len=cum[cum.length-1]; if(!(len>0)) continue;
      sourceEdges++; sourceKm+=len;
      const n=Math.max(1, Math.ceil(len/SEGMENT_KM));
      for(let part=0; part<n; part++){
        const d0=len*part/n, d1=len*(part+1)/n;
        const segCoords=subline(coords,cum,d0,d1);
        if(segCoords.length<2) continue;
        const mid=pointAt(coords,cum,(d0+d1)/2);
        const pr=project(mid);
        const lat=mid[1]; const tol=lat>=59 ? 15 : 10;
        pieces.push({
          coords:segCoords, x:pr[0], y:pr[1], lon:mid[0], lat:mid[1], tol, year:y,
          edge_idx:edgeIdx0+1, part_idx:part+1, parts_total:n,
          source_name:p.source_name, target_name:p.target_name, source_parent:p.source_parent, target_parent:p.target_parent,
          relation:p.relation, length_km:lineLength(segCoords), zone:lat>=59?'севернее 59° с.ш.':'южнее 59° с.ш.'
        });
      }
    }
  });
}
const cellKm=10;
const grid=new Map();
function key(ix,iy){return `${ix},${iy}`}
for(let i=0;i<pieces.length;i++){
  const p=pieces[i]; const ix=Math.floor(p.x/cellKm), iy=Math.floor(p.y/cellKm); p.ix=ix; p.iy=iy;
  const k=key(ix,iy); if(!grid.has(k)) grid.set(k,[]); grid.get(k).push(i);
}
const features=[]; const byCount=new Map(), byZone=new Map(), byRefYear=new Map();
function inc(map,k){ map.set(k,(map.get(k)||0)+1); }
for(let i=0;i<pieces.length;i++){
  const p=pieces[i]; const radius=p.tol; const cells=Math.ceil(radius/cellKm)+1;
  const minByYear=new Map([[p.year,0]]);
  for(let dx=-cells; dx<=cells; dx++) for(let dy=-cells; dy<=cells; dy++){
    const arr=grid.get(key(p.ix+dx,p.iy+dy)); if(!arr) continue;
    for(const j of arr){ if(j===i) continue; const q=pieces[j]; if(q.year===p.year) continue;
      // Fast precheck in projected km, then more correct lat-dependent distance.
      const dd0=Math.hypot(p.x-q.x,p.y-q.y); if(dd0>radius*1.15) continue;
      const d=distKm([p.lon,p.lat],[q.lon,q.lat]); if(d<=radius){
        const old=minByYear.get(q.year); if(old===undefined || d<old) minByYear.set(q.year,d);
      }
    }
  }
  const yrs=[...minByYear.keys()].sort((a,b)=>a-b); const count=yrs.length;
  if(count<MIN_OUTPUT_YEARS) continue;
  const offsets=[...minByYear.values()]; const mean=offsets.reduce((a,b)=>a+b,0)/offsets.length; const max=Math.max(...offsets);
  const cls=count>=12?'очень высокая':count>=8?'высокая':count>=4?'средняя':'низкая';
  const props={
    stability_id:`bs93_${String(features.length+1).padStart(6,'0')}`,
    kind:'геометрическая устойчивость границ', method:'filtered_topology_edge_midpoint_segments_v93',
    reference_year:p.year, reference_edge_part:p.part_idx, reference_edge_parts_total:p.parts_total,
    source_name:p.source_name, target_name:p.target_name, source_parent:p.source_parent, target_parent:p.target_parent,
    relation:p.relation, segment_length_km:+p.length_km.toFixed(3), mid_lat:+p.lat.toFixed(6), mid_lon:+p.lon.toFixed(6),
    lat_zone:p.zone, tolerance_km:p.tol, years_count:count, years_total:YEARS.length, stability_share:+(count/YEARS.length).toFixed(4),
    years:yrs, year_from:yrs[0], year_to:yrs[yrs.length-1], time_span_years:yrs[yrs.length-1]-yrs[0], max_streak_slices:longestStreak(yrs),
    mean_offset_km:+mean.toFixed(3), max_offset_km:+max.toFixed(3), stability_class:cls,
    note:'Геометрическая устойчивость по близости середин сегментов: 15 км севернее/на 59° с.ш., 10 км южнее. Исходные рёбра очищены от спорных, неясных, слабоконтрольных, двоеданческих, передаваемых территорий, особых статусов и малых городов.'
  };
  features.push({type:'Feature', geometry:{type:'LineString', coordinates:p.coords.map(c=>[+c[0].toFixed(6),+c[1].toFixed(6)])}, properties:props});
  inc(byCount,count); inc(byZone,p.zone); inc(byRefYear,p.year);
}
function sortedObj(map, numeric=false){ const arr=[...map.entries()].sort((a,b)=>numeric?(+a[0]-+b[0]):String(a[0]).localeCompare(String(b[0]),'ru')); return Object.fromEntries(arr); }
const out={type:'FeatureCollection', name:'boundary_stability_v93', properties:{version:'v93',analysis:'geometric_boundary_stability',years:YEARS,years_total:YEARS.length,segment_km:SEGMENT_KM,minimum_output_years:MIN_OUTPUT_YEARS,tolerance_rule:'15 км для середины сегмента севернее/на 59° с.ш.; 10 км южнее 59° с.ш.',source:'filtered topology edges derived from admin polygons',source_edges:sourceEdges,source_length_km:+sourceKm.toFixed(3),source_pieces:pieces.length,features:features.length},features};
fs.writeFileSync(path.join(STAB,'boundary_stability_v93.geojson'), JSON.stringify(out));
const summary={version:'v93',source_edges:sourceEdges,source_length_km:+sourceKm.toFixed(3),source_pieces:pieces.length,output_features:features.length,years_total:YEARS.length,years:YEARS,by_stability_count:sortedObj(byCount,true),by_zone:sortedObj(byZone),by_reference_year:sortedObj(byRefYear,true)};
fs.writeFileSync(path.join(STAB,'boundary_stability_v93_summary.json'), JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(DOCS,'v93_boundary_stability_summary.csv'), ['metric,value',`source_edges,${summary.source_edges}`,`source_length_km,${summary.source_length_km}`,`source_pieces,${summary.source_pieces}`,`output_features,${summary.output_features}`,`years_total,${summary.years_total}`,'tolerance_rule,"15 km north of 59N; 10 km south of 59N"'].join('\n'));
fs.writeFileSync(path.join(DOCS,'v93_boundary_stability_by_count.csv'), ['years_count,segments',...Object.entries(summary.by_stability_count).map(([k,v])=>`${k},${v}`)].join('\n'));
console.log(JSON.stringify(summary,null,2));
