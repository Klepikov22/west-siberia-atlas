/* Pure GeoJSON polygon predicates. Coordinates are [longitude, latitude] in WGS84. */
(function(root, factory){
  const geometry=factory();
  if(typeof module==='object' && module.exports) module.exports=geometry;
  if(root) root.AtlasGeometry=geometry;
})(typeof globalThis!=='undefined' ? globalThis : this, function(){
  'use strict';

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
  function pointInRing(point, vs){
    const x=point[0], y=point[1]; let inside=false;
    for(let i=0,j=vs.length-1;i<vs.length;j=i++){
      const xi=vs[i][0], yi=vs[i][1], xj=vs[j][0], yj=vs[j][1];
      const intersect=((yi>y)!=(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi);
      if(intersect) inside=!inside;
    }
    return inside;
  }
  function getPolygonRings(geom){
    if(!geom) return [];
    if(geom.type==='Polygon') return geom.coordinates || [];
    if(geom.type==='MultiPolygon') return (geom.coordinates || []).flat();
    if(geom.type==='GeometryCollection') return (geom.geometries || []).flatMap(getPolygonRings);
    return [];
  }
  function pointInPolygonWithHoles(pt, rings){
    if(!rings.length || !pointInRing(pt, rings[0])) return false;
    for(let i=1;i<rings.length;i++){ if(pointInRing(pt, rings[i])) return false; }
    return true;
  }
  function pointInFeaturePolygon(pt, geom){
    if(geom.type==='Polygon') return pointInPolygonWithHoles(pt, geom.coordinates || []);
    if(geom.type==='MultiPolygon') return (geom.coordinates || []).some(poly=>pointInPolygonWithHoles(pt, poly));
    if(geom.type==='GeometryCollection') return (geom.geometries || []).some(g=>pointInFeaturePolygon(pt,g));
    return false;
  }
  function featureIntersectsRing(feature, selectionRing){
    const geom=feature?.geometry; if(!geom || !selectionRing?.length) return false;
    const featureRings=getPolygonRings(geom); if(!featureRings.length) return false;
    for(const ring of featureRings) for(const pt of ring) if(pointInRing(pt, selectionRing)) return true;
    for(const pt of selectionRing) if(pointInFeaturePolygon(pt, geom)) return true;
    for(const ring of featureRings) for(let i=1;i<ring.length;i++) for(let j=1;j<selectionRing.length;j++)
      if(segmentsIntersect(ring[i-1], ring[i], selectionRing[j-1], selectionRing[j])) return true;
    return false;
  }
  function featureWithinRing(feature, ring){
    const geom=feature?.geometry;
    const polygons=geom?.type==='Polygon' ? [geom.coordinates] : geom?.type==='MultiPolygon' ? geom.coordinates : [];
    if(!polygons.length) return false;
    return polygons.every(poly=>{
      const outer=poly?.[0] || [];
      const covered=pt=>pointInRing(pt,ring) || ring.slice(1).some((end,i)=>Math.abs(orient(ring[i],pt,end))<1e-12 && onSegment(ring[i],pt,end));
      if(!outer.length || !outer.every(covered)) return false;
      for(let i=1;i<outer.length;i++) for(let j=1;j<ring.length;j++)
        if(orient(outer[i-1],outer[i],ring[j-1])*orient(outer[i-1],outer[i],ring[j])<0 &&
           orient(ring[j-1],ring[j],outer[i-1])*orient(ring[j-1],ring[j],outer[i])<0) return false;
      return true;
    });
  }
  function featureMatchesSelection(feature, ring, criterion='intersects'){
    return criterion==='within' ? featureWithinRing(feature,ring) : featureIntersectsRing(feature,ring);
  }
  function boundsToLngLatRing(bounds){
    const sw=bounds.getSouthWest(), ne=bounds.getNorthEast();
    return [[sw.lng,sw.lat],[ne.lng,sw.lat],[ne.lng,ne.lat],[sw.lng,ne.lat],[sw.lng,sw.lat]];
  }
  return Object.freeze({featureMatchesSelection,featureIntersectsRing,featureWithinRing,pointInFeaturePolygon,boundsToLngLatRing});
});
