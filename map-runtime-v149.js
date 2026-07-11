/*
 * v149 — consolidated cartographic runtime.
 *
 * This file deliberately owns four fragile subsystems that had accumulated
 * many independent patches in app.js:
 *   1) layer visibility and drawing order;
 *   2) polygon / point hover and click interaction;
 *   3) selection visual state;
 *   4) live map labels.
 *
 * Labels are rendered in one plain DOM overlay attached to the Leaflet map
 * container. They no longer depend on Leaflet Tooltip, DivIcon, marker panes,
 * polygon visibility or layer re-add order.
 */
(function installAtlasRuntimeV149(){
  'use strict';

  const VERSION='149';
  const STORAGE='wsAtlasRuntimeV149';
  const byId=(id)=>document.getElementById(id);
  const isChecked=(id,fallback=false)=>{
    const el=byId(id);
    return el ? !!el.checked : fallback;
  };
  const finite=(v)=>Number.isFinite(Number(v)) ? Number(v) : null;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const safeText=(v)=>String(v == null ? '' : v).trim();

  class AtlasRuntimeV149 {
    constructor(){
      this.map=null;
      this.mapContainer=null;
      this.labelRoot=null;
      this.adminLabelLayer=null;
      this.centerLabelLayer=null;
      this.hoverCard=null;
      this.healthNode=null;
      this.adminItems=[];
      this.centerItems=[];
      this.hoveredAdminId=null;
      this.hoveredPointLayer=null;
      this.renderFrame=0;
      this.visibilityFrame=0;
      this.bound=false;
      this.boundControls=false;
      this.lastCounts={admin:0,centers:0};
      this.visibilityBusy=false;
      this.handlers={};
      this.selectionBound=false;
      this.selectionPane=null;
    }

    install(){
      window.__WS_ATLAS_RUNTIME_V149__=this;
      document.documentElement.dataset.runtimeVersion=VERSION;
      this.patchLegacyFunctions();
      this.bindWhenReady();
    }

    bindWhenReady(){
      const tryBind=()=>{
        if(typeof state!=='object' || !state || !state.map){
          window.setTimeout(tryBind,80);
          return;
        }
        this.attachMap(state.map);
        this.rebuildAll();
      };
      tryBind();
    }

    attachMap(map){
      if(this.map===map && this.bound) return;
      this.map=map;
      this.mapContainer=map.getContainer();
      this.createDomLayers();
      this.bindMapEvents();
      this.bindControls();
      this.bound=true;
      this.scheduleVisibility();
      this.scheduleLabels();
    }

    createDomLayers(){
      if(!this.mapContainer) return;
      let root=byId('atlasLabelOverlayV149');
      if(!root){
        root=document.createElement('div');
        root.id='atlasLabelOverlayV149';
        root.className='atlas-label-overlay-v149';
        root.setAttribute('aria-hidden','true');
        root.innerHTML='<div class="atlas-admin-label-layer-v149"></div><div class="atlas-center-label-layer-v149"></div>';
        this.mapContainer.appendChild(root);
      }
      this.labelRoot=root;
      this.adminLabelLayer=root.querySelector('.atlas-admin-label-layer-v149');
      this.centerLabelLayer=root.querySelector('.atlas-center-label-layer-v149');

      let hover=byId('atlasFeatureHoverV149');
      if(!hover){
        hover=document.createElement('div');
        hover.id='atlasFeatureHoverV149';
        hover.className='atlas-feature-hover-v149';
        hover.hidden=true;
        hover.setAttribute('role','status');
        hover.setAttribute('aria-live','polite');
        this.mapContainer.appendChild(hover);
      }
      this.hoverCard=hover;

      const settings=byId('labelSettingsPanel');
      if(settings && !byId('labelEngineHealthV149')){
        const health=document.createElement('div');
        health.id='labelEngineHealthV149';
        health.className='label-engine-health-v149';
        health.innerHTML='<span></span><b>Рендерер v149</b><small>инициализация…</small>';
        settings.prepend(health);
      }
      this.healthNode=byId('labelEngineHealthV149');
    }

    bindMapEvents(){
      if(!this.map || this.map.__runtimeV149Bound) return;
      this.map.__runtimeV149Bound=true;
      const redraw=()=>this.scheduleLabels();
      this.map.on('move zoom resize moveend zoomend viewreset',redraw);
      this.map.on('movestart zoomstart',()=>this.hideHover());
      this.map.on('click',()=>this.hideHover());
      window.addEventListener('resize',redraw,{passive:true});
    }

    bindControls(){
      if(this.boundControls) return;
      this.boundControls=true;
      const host=byId('layerToggleList') || document;
      host.addEventListener('change',(event)=>{
        const target=event.target;
        if(!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
        if(target.id && (target.id.startsWith('toggle') || target.id==='labelDensitySelect')){
          this.persistSettings();
          this.scheduleVisibility();
          this.scheduleLabels();
        }
      });
      const size=byId('labelBaseSizeRange');
      if(size){
        size.addEventListener('input',()=>{
          const out=byId('labelBaseSizeValue');
          if(out) out.textContent=Number(size.value).toFixed(1);
          this.persistSettings();
          this.scheduleLabels();
        });
      }
      this.restoreSettings();
    }

    persistSettings(){
      const payload={
        density:byId('labelDensitySelect')?.value || 'balanced',
        size:Number(byId('labelBaseSizeRange')?.value || 11),
        admin:isChecked('toggleAdminLabels',true),
        centers:isChecked('toggleCenterPointLabels',false),
        values:isChecked('toggleLabelValues',true)
      };
      try{ localStorage.setItem(STORAGE,JSON.stringify(payload)); }catch(_){ }
    }

    restoreSettings(){
      let saved=null;
      try{ saved=JSON.parse(localStorage.getItem(STORAGE)||'null'); }catch(_){ }
      if(!saved) return;
      const density=byId('labelDensitySelect');
      const size=byId('labelBaseSizeRange');
      if(density && ['sparse','balanced','dense','maximum'].includes(saved.density)) density.value=saved.density;
      if(size && finite(saved.size)!=null){
        size.value=String(clamp(Number(saved.size),9,16));
        const out=byId('labelBaseSizeValue');
        if(out) out.textContent=Number(size.value).toFixed(1);
      }
    }

    patchLegacyFunctions(){
      const runtime=this;

      // The old marker/tooltip label builder is replaced completely.
      buildLabels=function buildLabelsV149(admin,gj){
        try{ clearLayer('labels'); }catch(_){ }
        if(state?.layers) state.layers.labels=null;
        state.labelItems=[];
        if(!admin) return null;
        admin.eachLayer((layer)=>{
          const feature=layer?.feature;
          if(!feature?.properties) return;
          const p=feature.properties;
          let label='';
          try{ label=cleanAdminLabelName(p.name || p.unit_name || p.admin_name || p.unit_id); }
          catch(_){ label=safeText(p.name || p.unit_name || p.admin_name || p.unit_id); }
          if(!label) return;
          let latlng=null;
          try{ latlng=adminLabelLatLng(layer); }catch(_){ }
          if(!latlng){
            try{ latlng=layer.getBounds().getCenter(); }catch(_){ return; }
          }
          let priority=0;
          try{ priority=Number(adminLabelPriority(feature))||0; }
          catch(_){ priority=(Number(p.population)||0)+(Number(p.area_km2)||0)*10; }
          state.labelItems.push({
            latlng, feature, layer, label,
            priority,
            pop:Number(p.population)||0,
            area:Number(p.area_km2)||0,
            renderer:'dom-overlay-v149'
          });
        });
        state.labelItems.sort((a,b)=>(b.priority||0)-(a.priority||0));
        runtime.adminItems=state.labelItems;
        runtime.scheduleLabels();
        return null;
      };

      updateLabelsVisibility=function updateLabelsVisibilityV149(){ runtime.scheduleLabels(); };
      updateCenterLabels=function updateCenterLabelsV149(){ runtime.scheduleLabels(); };

      const previousRefreshAdmin=typeof refreshAdmin==='function' ? refreshAdmin : null;
      if(previousRefreshAdmin){
        refreshAdmin=async function refreshAdminV149(seq){
          const result=await previousRefreshAdmin.apply(this,arguments);
          if(typeof isStaleRefresh==='function' && isStaleRefresh(seq)) return result;
          runtime.rebuildAdminItems();
          runtime.bindAdminInteractions();
          runtime.bindCircleInteractions();
          runtime.scheduleVisibility();
          runtime.scheduleLabels();
          return result;
        };
      }

      const previousRefreshCenters=typeof refreshCenters==='function' ? refreshCenters : null;
      if(previousRefreshCenters){
        refreshCenters=async function refreshCentersV149(seq){
          const result=await previousRefreshCenters.apply(this,arguments);
          if(typeof isStaleRefresh==='function' && isStaleRefresh(seq)) return result;
          runtime.rebuildCenterItems();
          runtime.bindCenterInteractions();
          runtime.scheduleVisibility();
          runtime.scheduleLabels();
          return result;
        };
      }

      refreshVisibility=function refreshVisibilityV149(){
        runtime.applyVisibility();
      };

      refreshSelectionStyles=function refreshSelectionStylesV149(){
        runtime.applyAdminVisualStates();
      };
      refreshSelectionStylesFor=function refreshSelectionStylesForV149(id){
        runtime.applyAdminVisualState(id);
      };

      const previousRefreshVectorStyles=typeof refreshVectorStyles==='function' ? refreshVectorStyles : null;
      if(previousRefreshVectorStyles){
        refreshVectorStyles=function refreshVectorStylesV149(){
          const result=previousRefreshVectorStyles.apply(this,arguments);
          runtime.applyAdminVisualStates();
          runtime.scheduleVisibility();
          runtime.scheduleLabels();
          return result;
        };
      }

      bindSelectionHandlers=function bindSelectionHandlersV149(){
        runtime.bindSelectionEngine();
      };
      addPolygonPoint=function addPolygonPointV149(latlng){ runtime.addPolygonVertex(latlng); };
      finishPolygonSelection=function finishPolygonSelectionV149(event){ runtime.finishPolygon(event||{}); };
      clearSelectionDrawing=function clearSelectionDrawingV149(removePoints=true){ runtime.clearSelectionSketch(removePoints); };

      const previousSetTool=typeof setTool==='function' ? setTool : null;
      if(previousSetTool){
        setTool=function setToolV149(tool){
          runtime.hideHover();
          const result=previousSetTool.apply(this,arguments);
          document.documentElement.dataset.mapTool=String(state?.tool || tool || 'pan');
          return result;
        };
      }

      const previousBindUi=typeof bindUi==='function' ? bindUi : null;
      if(previousBindUi){
        bindUi=function bindUiV149(){
          const result=previousBindUi.apply(this,arguments);
          runtime.bindControls();
          runtime.createDomLayers();
          return result;
        };
      }
    }

    bindSelectionEngine(){
      if(this.selectionBound || !state?.map) return;
      this.selectionBound=true;
      const map=state.map;
      const container=map.getContainer();
      try{
        if(!map.getPane('selectionPaneV149')){
          this.selectionPane=map.createPane('selectionPaneV149');
          this.selectionPane.style.zIndex='645';
          this.selectionPane.style.pointerEvents='none';
        }else this.selectionPane=map.getPane('selectionPaneV149');
      }catch(_){ }

      map.on('mousedown',(event)=>{
        const original=event.originalEvent;
        if(original?.button===1){
          try{ startMiddlePan(event); }catch(_){ }
          return;
        }
        if(state.tool!=='rectangle' || (original && original.button!==0)) return;
        this.hideHover();
        this.clearSelectionSketch(false);
        state.dragStart=event.latlng;
        try{ L.DomEvent.preventDefault(original); }catch(_){ }
        container.classList.add('selection-drawing-v149');
      });

      map.on('mousemove',(event)=>{
        if(state.tool!=='rectangle' || !state.dragStart) return;
        const bounds=L.latLngBounds(state.dragStart,event.latlng);
        if(!state.dragRect){
          state.dragRect=L.rectangle(bounds,{
            pane:'selectionPaneV149',
            color:'#173d70',weight:1.8,dashArray:'6 4',
            fillColor:'#4a85bc',fillOpacity:.13,interactive:false
          }).addTo(map);
        }else state.dragRect.setBounds(bounds);
      });

      map.on('mouseup',(event)=>{
        if(state.tool!=='rectangle' || !state.dragStart) return;
        const start=state.dragStart;
        const bounds=L.latLngBounds(start,event.latlng);
        state.dragStart=null;
        container.classList.remove('selection-drawing-v149');
        const p1=map.latLngToContainerPoint(start);
        const p2=map.latLngToContainerPoint(event.latlng);
        const meaningful=Math.abs(p2.x-p1.x)>=4 && Math.abs(p2.y-p1.y)>=4;
        if(meaningful){
          try{ applySpatialSelectionByBounds(bounds,event.originalEvent||{}); }catch(error){ console.warn('v149 rectangle selection failed',error); }
        }
        this.clearSelectionSketch(false);
        this.flashSelectionCount();
      });

      map.on('click',(event)=>{
        if(state.tool!=='polygon') return;
        const original=event.originalEvent;
        if(original?.button!=null && original.button!==0) return;
        this.hideHover();
        this.addPolygonVertex(event.latlng);
      });

      map.on('dblclick',(event)=>{
        if(state.tool!=='polygon') return;
        try{ L.DomEvent.preventDefault(event.originalEvent); }catch(_){ }
        this.finishPolygon(event.originalEvent||{});
      });

      map.on('contextmenu',(event)=>{
        if(state.tool!=='polygon') return;
        try{ L.DomEvent.preventDefault(event.originalEvent); }catch(_){ }
        this.finishPolygon(event.originalEvent||{});
      });

      container.addEventListener('auxclick',(event)=>{
        if(event.button===1){ event.preventDefault(); event.stopPropagation(); }
      });
      container.addEventListener('contextmenu',(event)=>{
        if(state.tool==='polygon') event.preventDefault();
      });
      document.addEventListener('keydown',(event)=>{
        if(state.tool==='polygon' && event.key==='Enter'){
          event.preventDefault();
          this.finishPolygon(event);
        }else if(state.tool==='polygon' && (event.key==='Backspace' || event.key==='Delete')){
          if(!state.polygonPoints?.length) return;
          event.preventDefault();
          state.polygonPoints.pop();
          this.redrawPolygonSketch();
        }else if((state.tool==='polygon' || state.tool==='rectangle') && event.key==='Escape'){
          event.preventDefault();
          this.clearSelectionSketch(true);
        }
      });
    }

    addPolygonVertex(latlng){
      if(!state.polygonPoints) state.polygonPoints=[];
      state.polygonPoints.push(latlng);
      this.redrawPolygonSketch();
    }

    redrawPolygonSketch(){
      if(!this.map) return;
      if(state.polygonLine){ try{ this.map.removeLayer(state.polygonLine); }catch(_){ } state.polygonLine=null; }
      if(state.polygonMarkers){ try{ this.map.removeLayer(state.polygonMarkers); }catch(_){ } state.polygonMarkers=null; }
      const points=state.polygonPoints || [];
      if(!points.length) return;
      state.polygonMarkers=L.layerGroup().addTo(this.map);
      points.forEach((latlng,index)=>{
        L.circleMarker(latlng,{
          pane:'selectionPaneV149',radius:index===0?4.8:4,
          color:'#173d70',weight:1.5,fillColor:'#ffffff',fillOpacity:1,interactive:false
        }).addTo(state.polygonMarkers);
      });
      state.polygonLine=L.polyline(points,{
        pane:'selectionPaneV149',color:'#173d70',weight:2,dashArray:'6 4',interactive:false
      }).addTo(this.map);
      const help=byId('selectionToolHelp');
      if(help) help.dataset.vertexCount=String(points.length);
    }

    finishPolygon(event={}){
      const points=state.polygonPoints || [];
      if(state.tool!=='polygon' || points.length<3) return;
      try{ applySpatialSelectionByPolygon(points,event); }
      catch(error){ console.warn('v149 polygon selection failed',error); }
      this.clearSelectionSketch(true);
      this.flashSelectionCount();
    }

    clearSelectionSketch(removePoints=true){
      if(state?.dragRect){ try{ this.map?.removeLayer(state.dragRect); }catch(_){ } state.dragRect=null; }
      state.dragStart=null;
      if(state?.polygonLine){ try{ this.map?.removeLayer(state.polygonLine); }catch(_){ } state.polygonLine=null; }
      if(state?.polygonMarkers){ try{ this.map?.removeLayer(state.polygonMarkers); }catch(_){ } state.polygonMarkers=null; }
      if(removePoints) state.polygonPoints=[];
      this.mapContainer?.classList.remove('selection-drawing-v149');
      const help=byId('selectionToolHelp');
      if(help) delete help.dataset.vertexCount;
    }

    flashSelectionCount(){
      const count=state?.selectedIds?.size || 0;
      const box=byId('selectionBox');
      if(!box) return;
      box.classList.add('selection-flash-v149');
      box.dataset.selectionCount=String(count);
      window.setTimeout(()=>box.classList.remove('selection-flash-v149'),480);
    }

    rebuildAll(){
      this.rebuildAdminItems();
      this.rebuildCenterItems();
      this.bindAdminInteractions();
      this.bindCenterInteractions();
      this.bindCircleInteractions();
      this.scheduleVisibility();
      this.scheduleLabels();
    }

    rebuildAdminItems(){
      const items=[];
      const byIdMap=state?.adminLayerById;
      if(byIdMap?.forEach){
        byIdMap.forEach((layer)=>{
          const feature=layer?.feature;
          const p=feature?.properties || {};
          let label='';
          try{ label=cleanAdminLabelName(p.name || p.unit_name || p.admin_name || p.unit_id); }
          catch(_){ label=safeText(p.name || p.unit_name || p.admin_name || p.unit_id); }
          if(!label) return;
          let latlng=null;
          try{ latlng=adminLabelLatLng(layer); }catch(_){ }
          if(!latlng){ try{ latlng=layer.getBounds().getCenter(); }catch(_){ return; } }
          let priority=0;
          try{ priority=Number(adminLabelPriority(feature))||0; }
          catch(_){ priority=(Number(p.population)||0)+(Number(p.area_km2)||0)*10; }
          items.push({
            latlng,feature,layer,label,priority,
            pop:Number(p.population)||0,
            area:Number(p.area_km2)||0,
            renderer:'dom-overlay-v149'
          });
        });
      }
      items.sort((a,b)=>(b.priority||0)-(a.priority||0));
      this.adminItems=items;
      state.labelItems=items;
      this.updateHealth();
    }

    centerMatchesCurrentLayer(feature){
      const p=feature?.properties || {};
      const visible=state?.currentGeoJSON?.features || [];
      if(!visible.length) return true;
      const ids=new Set(visible.map(f=>safeText(f.properties?.unit_id)).filter(Boolean));
      const names=new Set(visible.map(f=>safeText(f.properties?.name).toLocaleLowerCase('ru')).filter(Boolean));
      const parents=new Set(visible.map(f=>safeText(f.properties?.admin_parent)).filter(Boolean));
      const id=safeText(p.unit_id);
      const name=safeText(p.unit_name || p.host_name || p.name).toLocaleLowerCase('ru');
      const parent=safeText(p.admin_parent);
      if(id && ids.has(id)) return true;
      if(name && names.has(name)) return true;
      if(parent && parents.has(parent)) return true;
      return !(id || name || parent);
    }

    rebuildCenterItems(){
      const items=[];
      const features=state?.rawCentersGeoJSON?.features || [];
      for(const feature of features){
        if(feature?.geometry?.type!=='Point' || !this.centerMatchesCurrentLayer(feature)) continue;
        const coords=feature.geometry.coordinates || [];
        if(!Number.isFinite(Number(coords[0])) || !Number.isFinite(Number(coords[1]))) continue;
        const p=feature.properties || {};
        let label='';
        try{ label=cleanCenterLabelName(p.name || p.center || p.unit_name || 'центр'); }
        catch(_){ label=safeText(p.name || p.center || p.unit_name || 'центр'); }
        if(!label) continue;
        let pop=0;
        try{ pop=Number(pointPopulation(p))||0; }catch(_){ pop=Number(p.population)||0; }
        let priority=pop;
        try{ priority=Number(labelPriority(p))||pop; }catch(_){ }
        items.push({
          latlng:L.latLng(Number(coords[1]),Number(coords[0])),
          feature,label,pop,priority,
          city:(()=>{ try{return !!isCityCenter(p);}catch(_){return false;} })()
        });
      }
      items.sort((a,b)=>(b.priority||0)-(a.priority||0));
      this.centerItems=items;
      state.centerLabelItems=items;
      this.updateHealth();
    }

    layerRules(){
      const adminOn=isChecked('toggleAdmin',true);
      const parentMode=['admin_parent','admin_superparent'].includes(String(state?.mode||''));
      return [
        ['rivers',isChecked('toggleHydro',true)],
        ['hydro',isChecked('toggleHydro',true)],
        ['water',isChecked('toggleHydro',true)],
        ['adminL1Underlay',adminOn && parentMode],
        ['admin',adminOn],
        ['adminL1Outline',adminOn && isChecked('toggleAdminL1Outline',true)],
        ['railways',isChecked('toggleRailways',true)],
        ['rail',isChecked('toggleRailways',true)],
        ['naturalBoundarySegments',isChecked('toggleNaturalBoundarySegments',false)],
        ['boundaryMemorySegments',isChecked('toggleBoundaryMemorySegments',false)],
        ['topologyGraph',isChecked('toggleTopologyEdgesMain',false)],
        ['circles',isChecked('toggleCircles',false)],
        ['centers',isChecked('toggleCenters',false)],
        ['topologyCentroids',isChecked('toggleTopologyCentroids',false)],
        ['advancedConnectivityEdges',isChecked('toggleAdvancedConnectivityEdges',false)],
        ['advancedConnectivityNodes',isChecked('toggleAdvancedConnectivityNodes',false)]
      ];
    }

    isLeafletLayer(layer){
      return !!layer && typeof layer.addTo==='function' && !layer.__domLayer && !layer.__domSvgLayer;
    }

    setLeafletVisibility(layer,show){
      if(!this.map || !this.isLeafletLayer(layer)) return;
      try{
        const active=this.map.hasLayer(layer);
        if(show && !active) layer.addTo(this.map);
        if(!show && active) this.map.removeLayer(layer);
      }catch(error){
        console.warn('v149 visibility sync failed',error);
      }
    }

    setDomVisibility(layer,show){
      if(!layer) return;
      const node=layer instanceof HTMLElement || layer instanceof SVGElement
        ? layer
        : layer._container || layer.container || layer.element || null;
      if(node?.style) node.style.display=show?'':'none';
    }

    applyVisibility(){
      if(this.visibilityBusy || !this.map) return;
      this.visibilityBusy=true;
      try{
        // Legacy Leaflet label layers are never used by v149.
        this.setLeafletVisibility(state?.layers?.labels,false);
        this.setLeafletVisibility(state?.layers?.centerLabels,false);
        for(const [name,show] of this.layerRules()){
          const layer=state?.layers?.[name];
          if(this.isLeafletLayer(layer)) this.setLeafletVisibility(layer,show);
          else this.setDomVisibility(layer,show);
        }

        // Some advanced-connectivity patches stored DOM nodes outside state.layers.
        this.setDomVisibility(state?._advancedConnectivityEdgeSvgLayerV133,isChecked('toggleAdvancedConnectivityEdges',false));
        this.setDomVisibility(state?._advancedConnectivityNodeDomLayerV132,isChecked('toggleAdvancedConnectivityNodes',false));
        this.setDomVisibility(byId('advancedConnectivityEdgeSvgLayerV133'),isChecked('toggleAdvancedConnectivityEdges',false));

        // Deterministic cartographic order. Labels are a separate DOM overlay.
        const order=['adminL1Underlay','rivers','hydro','water','admin','adminL1Outline','railways','rail','naturalBoundarySegments','boundaryMemorySegments','topologyGraph','circles','centers','topologyCentroids'];
        for(const name of order){
          const layer=state?.layers?.[name];
          try{
            if(name==='adminL1Underlay' || name==='rivers' || name==='hydro') layer?.bringToBack?.();
            else if(typeof bringLayerGroupToFront==='function') bringLayerGroupToFront(layer);
            else layer?.bringToFront?.();
          }catch(_){ }
        }
      }finally{
        this.visibilityBusy=false;
      }
      this.updateLayerStatus();
      this.scheduleLabels();
    }

    scheduleVisibility(){
      cancelAnimationFrame(this.visibilityFrame);
      this.visibilityFrame=requestAnimationFrame(()=>{
        this.visibilityFrame=0;
        this.applyVisibility();
      });
    }

    updateLayerStatus(){
      const inputs=[...document.querySelectorAll('#layerToggleList input[type="checkbox"]')];
      const active=inputs.filter(el=>el.checked).length;
      const top=byId('mapLayerStatus');
      if(top){
        top.innerHTML='<i></i>'+active+' слоёв активно';
        top.classList.add('ready');
      }
      const manager=byId('layerManagerStatus');
      if(manager) manager.textContent='Включено '+active+' из '+inputs.length;
      document.querySelectorAll('.layer-group').forEach(group=>{
        const arr=[...group.querySelectorAll('input[type="checkbox"]')];
        const count=group.querySelector('[data-layer-group-count]');
        if(count) count.textContent=arr.filter(el=>el.checked).length+'/'+arr.length;
      });
    }

    scheduleLabels(){
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame=requestAnimationFrame(()=>{
        this.renderFrame=0;
        this.renderLabels();
      });
    }

    densityBudget(){
      const size=this.map?.getSize?.() || {x:1200,y:800};
      const density=byId('labelDensitySelect')?.value || 'balanced';
      const cellArea={sparse:36000,balanced:23500,dense:14500,maximum:8500}[density] || 23500;
      const viewportArea=Math.max(1,size.x*size.y);
      return clamp(Math.round(viewportArea/cellArea),12,420);
    }

    labelValue(properties){
      if(!isChecked('toggleLabelValues',true)) return '';
      const p=properties || {};
      const mode=String(state?.mode||'');
      const rules={
        population:[['population'],' чел.'],
        density:[['density','population_density'],' чел./км²'],
        urban_share:[['urban_share'],'%'],
        rail_length:[['rail_length','rail_length_km','rail_km'],' км ЖД'],
        rail_density:[['rail_density','rail_density_km_1000'],' км/1000 км²'],
        nb_river_pct:[['nb_river_pct'],'% речных'],
        nb_watershed_pct:[['nb_watershed_pct'],'% водоразд.'],
        nb_lake_pct:[['nb_lake_pct'],'% водных'],
        nb_coast_pct:[['nb_coast_pct'],'% береговых'],
        nb_inherited_pct:[['nb_inherited_pct'],'% унаслед.'],
        nb_unexplained_pct:[['nb_unexplained_pct'],'% неясных'],
        topo_degree:[['topo_degree','degree'],' соседей'],
        topo_betweenness:[['topo_betweenness'],''],
        topo_closeness:[['topo_closeness'],''],
        topo_k_core:[['topo_k_core'],' k-core'],
        topo_external_degree:[['topo_external_degree'],' внеш.'],
        topo_external_share:[['topo_external_share'],'% внеш.'],
        topo_bridge_incident_count:[['topo_bridge_incident_count'],' мост.'],
        district_age:[['district_age','district_age_years'],' лет']
      };
      const rule=rules[mode];
      if(!rule) return '';
      let value=null;
      for(const key of rule[0]){
        if(finite(p[key])!=null){ value=Number(p[key]); break; }
      }
      if(value==null) return '';
      if(mode==='urban_share' || mode.endsWith('_pct') || mode==='topo_external_share'){
        if(Math.abs(value)<=1.0001) value*=100;
      }
      return this.compactNumber(value)+rule[1];
    }

    compactNumber(value){
      const n=Number(value);
      if(!Number.isFinite(n)) return '';
      if(Math.abs(n)>=1e6) return (n/1e6).toFixed(Math.abs(n)>=1e7?0:1).replace('.',',')+' млн';
      if(Math.abs(n)>=1e3) return (n/1e3).toFixed(Math.abs(n)>=1e5?0:1).replace('.',',')+' тыс.';
      return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n);
    }

    intersects(a,b,padding=0){
      return !(a.right+padding<b.left || a.left-padding>b.right || a.bottom+padding<b.top || a.top-padding>b.bottom);
    }

    reservedRects(){
      const result=[];
      if(!this.mapContainer) return result;
      const mapRect=this.mapContainer.getBoundingClientRect();
      const selectors=['#mapTopbar','#timelineBar','#metricFilters','#parentFilterBar','.leaflet-control-container'];
      for(const selector of selectors){
        document.querySelectorAll(selector).forEach(node=>{
          if(!(node instanceof HTMLElement) || node.offsetParent===null) return;
          const r=node.getBoundingClientRect();
          if(r.width<2 || r.height<2) return;
          result.push({left:r.left-mapRect.left,right:r.right-mapRect.left,top:r.top-mapRect.top,bottom:r.bottom-mapRect.top});
        });
      }
      return result;
    }

    makeAdminLabel(item,fontSize,major){
      const el=document.createElement('div');
      el.className='atlas-admin-label-v149'+(major?' is-major':'');
      el.style.fontSize=fontSize+'px';
      const name=document.createElement('span');
      name.className='atlas-admin-label-name-v149';
      name.textContent=item.label;
      el.appendChild(name);
      const value=this.labelValue(item.feature?.properties);
      if(value){
        const val=document.createElement('span');
        val.className='atlas-admin-label-value-v149';
        val.textContent=value;
        el.appendChild(val);
      }
      return el;
    }

    makeCenterLabel(item,fontSize){
      const el=document.createElement('div');
      el.className='atlas-center-label-v149'+(item.city?' is-city':'');
      el.style.fontSize=fontSize+'px';
      const dot=document.createElement('i');
      dot.setAttribute('aria-hidden','true');
      const text=document.createElement('span');
      text.textContent=item.label;
      el.append(dot,text);
      return el;
    }

    renderLabels(){
      if(!this.map || !this.adminLabelLayer || !this.centerLabelLayer) return;
      this.adminLabelLayer.replaceChildren();
      this.centerLabelLayer.replaceChildren();

      const mapSize=this.map.getSize();
      const bounds=this.map.getBounds();
      const zoom=this.map.getZoom();
      const density=byId('labelDensitySelect')?.value || 'balanced';
      const baseSize=Number(byId('labelBaseSizeRange')?.value || 11);
      const adminEnabled=isChecked('toggleAdminLabels',true);
      const centersEnabled=isChecked('toggleCenterPointLabels',false);
      const budget=this.densityBudget();
      const placed=this.reservedRects();
      let adminShown=0;
      let centerShown=0;

      if(adminEnabled){
        const candidates=this.adminItems.filter(item=>bounds.contains(item.latlng));
        const privilegedCount=Math.max(6,Math.round(budget*.18));
        for(let rank=0;rank<candidates.length && adminShown<budget;rank++){
          const item=candidates[rank];
          const point=this.map.latLngToContainerPoint(item.latlng);
          if(point.x<24 || point.y<44 || point.x>mapSize.x-24 || point.y>mapSize.y-34) continue;

          const privileged=rank<privilegedCount;
          if(!privileged && item.layer?.getBounds){
            try{
              const b=item.layer.getBounds();
              const nw=this.map.latLngToContainerPoint(b.getNorthWest());
              const se=this.map.latLngToContainerPoint(b.getSouthEast());
              if(Math.abs(se.x-nw.x)<28 || Math.abs(se.y-nw.y)<15) continue;
            }catch(_){ }
          }

          const font=clamp(baseSize+(zoom-5)*.42+(privileged?.55:0),9,17);
          const el=this.makeAdminLabel(item,font,privileged);
          el.style.left=point.x+'px';
          el.style.top=point.y+'px';
          this.adminLabelLayer.appendChild(el);
          const width=el.offsetWidth;
          const height=el.offsetHeight;
          const rect={left:point.x-width/2,right:point.x+width/2,top:point.y-height/2,bottom:point.y+height/2};
          const overlap=rank>1 && placed.some(other=>this.intersects(rect,other,privileged?6:4));
          if(overlap){ el.remove(); continue; }
          placed.push(rect);
          adminShown++;
        }
      }

      if(centersEnabled){
        const multiplier=density==='maximum'?1:density==='dense'?.78:density==='sparse'?.36:.58;
        const centerBudget=clamp(Math.round(budget*multiplier),6,280);
        const candidates=this.centerItems.filter(item=>bounds.contains(item.latlng));
        for(let rank=0;rank<candidates.length && centerShown<centerBudget;rank++){
          const item=candidates[rank];
          const point=this.map.latLngToContainerPoint(item.latlng);
          if(point.x<18 || point.y<42 || point.x>mapSize.x-92 || point.y>mapSize.y-26) continue;
          const font=clamp(baseSize-1+(zoom-5)*.26+(rank<8?.35:0),8.5,14.5);
          const el=this.makeCenterLabel(item,font);
          el.style.left=(point.x+7)+'px';
          el.style.top=point.y+'px';
          this.centerLabelLayer.appendChild(el);
          const width=el.offsetWidth;
          const height=el.offsetHeight;
          const rect={left:point.x+7,right:point.x+7+width,top:point.y-height/2,bottom:point.y+height/2};
          const overlap=rank>3 && placed.some(other=>this.intersects(rect,other,3));
          if(overlap){ el.remove(); continue; }
          placed.push(rect);
          centerShown++;
        }
      }

      this.lastCounts={admin:adminShown,centers:centerShown};
      const status=byId('labelStatus');
      if(status){
        if(!adminEnabled && !centersEnabled) status.textContent='выключены';
        else{
          const parts=[];
          if(adminEnabled) parts.push(adminShown+' АТЕ');
          if(centersEnabled) parts.push(centerShown+' точек');
          status.textContent=parts.join(' · ');
        }
      }
      this.updateHealth();
    }

    updateHealth(){
      if(!this.healthNode) this.healthNode=byId('labelEngineHealthV149');
      const node=this.healthNode;
      if(!node) return;
      const dot=node.querySelector('span');
      const small=node.querySelector('small');
      const ready=!!this.map && this.adminItems.length>0;
      node.classList.toggle('is-ready',ready);
      node.classList.toggle('is-warning',!!this.map && !this.adminItems.length);
      if(dot) dot.title=ready?'Рендерер работает':'Нет кандидатов подписей';
      if(small){
        small.textContent=ready
          ? this.adminItems.length+' АТЕ · '+this.centerItems.length+' точек · показано '+this.lastCounts.admin+'/'+this.lastCounts.centers
          : 'ожидание административного слоя';
      }
    }

    bindAdminInteractions(){
      const map=state?.adminLayerById;
      if(!map?.forEach) return;
      map.forEach((layer,id)=>{
        if(!layer?.on) return;
        layer.off('mouseover mousemove mouseout click');
        layer.on('mouseover',(event)=>this.onAdminEnter(id,layer,event));
        layer.on('mousemove',(event)=>this.onPointerMove(event?.originalEvent));
        layer.on('mouseout',()=>this.onAdminLeave(id));
        layer.on('click',(event)=>this.onAdminClick(layer,event));
        requestAnimationFrame(()=>this.enableAdminKeyboard(layer));
      });
      this.applyAdminVisualStates();
    }

    enableAdminKeyboard(layer){
      const el=layer?.getElement?.();
      if(!el || el.dataset.runtimeV149Keyboard==='1') return;
      el.dataset.runtimeV149Keyboard='1';
      el.setAttribute('tabindex','0');
      el.setAttribute('role','button');
      el.addEventListener('focus',(event)=>{
        const id=featureId(layer.feature);
        this.onAdminEnter(id,layer,{originalEvent:event});
      });
      el.addEventListener('blur',()=>this.onAdminLeave(featureId(layer.feature)));
      el.addEventListener('keydown',(event)=>{
        if(event.key==='Enter' || event.key===' '){
          event.preventDefault();
          this.onAdminClick(layer,{originalEvent:event});
        }
      });
    }

    onAdminEnter(id,layer,event){
      if(state?.tool!=='pan') return;
      this.hoveredAdminId=id;
      this.applyAdminVisualState(id);
      const p=layer.feature?.properties || {};
      this.showHover({
        title:p.name || p.unit_name || 'Административная единица',
        subtitle:[p.unit_type,p.admin_parent].filter(Boolean).join(' · '),
        rows:[
          ['Население',finite(p.population)!=null?fmt.format(Number(p.population)):'—'],
          ['Площадь',finite(p.area_km2)!=null?fmt.format(Math.round(Number(p.area_km2)))+' км²':'—'],
          ['Плотность',finite(p.density)!=null?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(p.density))+' чел./км²':'—']
        ]
      },event?.originalEvent);
    }

    onAdminLeave(id){
      if(this.hoveredAdminId===id) this.hoveredAdminId=null;
      this.applyAdminVisualState(id);
      this.hideHover();
    }

    onAdminClick(layer,event){
      if(state?.tool!=='pan') return;
      try{ L.DomEvent.stopPropagation(event?.originalEvent || event); }catch(_){ }
      const feature=layer?.feature;
      if(!feature) return;
      try{
        if(typeof isSelectableFeature!=='function' || isSelectableFeature(feature)) toggleSelection(feature);
        else showFeature(feature);
      }catch(_){
        try{ showFeature(feature); }catch(__){ }
      }
      this.applyAdminVisualStates();
      this.scheduleLabels();
    }

    applyAdminVisualStates(){
      const map=state?.adminLayerById;
      if(!map?.forEach) return;
      map.forEach((_,id)=>this.applyAdminVisualState(id));
    }

    applyAdminVisualState(id){
      const layer=state?.adminLayerById?.get?.(id);
      if(!layer?.setStyle || !layer.feature) return;
      let style={};
      try{ style=adminStyle(layer.feature,state?._lastVals||[]); }catch(_){ }
      if(this.hoveredAdminId===id && !state?.selectedIds?.has?.(id)){
        const cfg=(()=>{ try{return regionStyleConfig();}catch(_){return {weight:1};} })();
        style={
          ...style,
          color:state?.theme==='dark'?'#ffffff':'#112f57',
          weight:Math.max(2.15,Number(cfg.weight||1)+1.05),
          opacity:1,
          fillOpacity:Math.min(.86,Number(style.fillOpacity||.65)+.08)
        };
      }
      try{ layer.setStyle(style); }catch(_){ }
      try{ if(this.hoveredAdminId===id || state?.selectedIds?.has?.(id)) layer.bringToFront(); }catch(_){ }
    }

    bindCenterInteractions(){
      const group=state?.layers?.centers;
      if(!group?.eachLayer) return;
      group.eachLayer((layer)=>{
        if(!layer?.on || !layer.feature) return;
        layer.off('mouseover mousemove mouseout click');
        layer.on('mouseover',(event)=>this.onPointEnter(layer,event,'center'));
        layer.on('mousemove',(event)=>this.onPointerMove(event?.originalEvent));
        layer.on('mouseout',()=>this.onPointLeave(layer));
        layer.on('click',(event)=>{
          try{ L.DomEvent.stopPropagation(event?.originalEvent || event); }catch(_){ }
          try{ showCenterFeature(layer.feature,layer); }catch(_){ }
        });
      });
    }

    bindCircleInteractions(){
      const group=state?.layers?.circles;
      if(!group?.eachLayer) return;
      group.eachLayer((layer)=>{
        if(!layer?.on || !layer.feature) return;
        layer.off('mouseover mousemove mouseout click');
        layer.on('mouseover',(event)=>this.onPointEnter(layer,event,'circle'));
        layer.on('mousemove',(event)=>this.onPointerMove(event?.originalEvent));
        layer.on('mouseout',()=>this.onPointLeave(layer));
        layer.on('click',(event)=>{
          try{ L.DomEvent.stopPropagation(event?.originalEvent || event); }catch(_){ }
          if(state?.tool!=='pan') return;
          try{ toggleSelection(layer.feature); showFeature(layer.feature); }catch(_){ }
          this.applyAdminVisualStates();
        });
      });
    }

    onPointEnter(layer,event,kind){
      const p=layer.feature?.properties || {};
      this.hoveredPointLayer=layer;
      try{
        const radius=layer.getRadius?.();
        if(layer.__runtimeV149BaseRadius==null) layer.__runtimeV149BaseRadius=radius;
        if(!layer.__runtimeV149BaseStyle){
          layer.__runtimeV149BaseStyle={
            color:layer.options?.color, weight:layer.options?.weight, opacity:layer.options?.opacity,
            fillColor:layer.options?.fillColor, fillOpacity:layer.options?.fillOpacity
          };
        }
        if(radius!=null) layer.setRadius(radius+1.8);
        layer.setStyle?.({weight:2.4,opacity:1,fillOpacity:.98});
      }catch(_){ }
      let pop=finite(p.population);
      if(pop==null){ try{ pop=Number(pointPopulation(p))||null; }catch(_){ } }
      this.showHover({
        title:p.name || p.center || p.unit_name || (kind==='circle'?'Население АТЕ':'Центр'),
        subtitle:p.host_name || p.unit_name || p.admin_parent || p.status || (kind==='circle'?'круг населения':'город / центр'),
        rows:[['Население',pop!=null?fmt.format(Math.round(pop)):'—']]
      },event?.originalEvent);
    }

    onPointLeave(layer){
      if(this.hoveredPointLayer===layer) this.hoveredPointLayer=null;
      try{
        if(layer.__runtimeV149BaseRadius!=null) layer.setRadius(layer.__runtimeV149BaseRadius);
        if(layer.__runtimeV149BaseStyle) layer.setStyle?.(layer.__runtimeV149BaseStyle);
      }catch(_){ }
      this.hideHover();
    }

    showHover(content,event){
      if(!this.hoverCard || !this.mapContainer) return;
      this.hoverCard.replaceChildren();
      const title=document.createElement('b');
      title.textContent=safeText(content.title) || 'Объект';
      this.hoverCard.appendChild(title);
      if(content.subtitle){
        const subtitle=document.createElement('span');
        subtitle.className='atlas-feature-hover-subtitle-v149';
        subtitle.textContent=safeText(content.subtitle);
        this.hoverCard.appendChild(subtitle);
      }
      const rows=(content.rows||[]).filter(row=>row && row[1]!=='' && row[1]!=null);
      if(rows.length){
        const grid=document.createElement('div');
        grid.className='atlas-feature-hover-grid-v149';
        for(const [key,value] of rows){
          const k=document.createElement('small'); k.textContent=key;
          const v=document.createElement('strong'); v.textContent=String(value);
          grid.append(k,v);
        }
        this.hoverCard.appendChild(grid);
      }
      this.hoverCard.hidden=false;
      this.onPointerMove(event);
    }

    onPointerMove(event){
      if(!event || !this.hoverCard || this.hoverCard.hidden || !this.mapContainer) return;
      const mapRect=this.mapContainer.getBoundingClientRect();
      let x=Number(event.clientX)-mapRect.left+14;
      let y=Number(event.clientY)-mapRect.top+14;
      const width=this.hoverCard.offsetWidth || 220;
      const height=this.hoverCard.offsetHeight || 90;
      if(x+width>mapRect.width-10) x=Number(event.clientX)-mapRect.left-width-14;
      if(y+height>mapRect.height-10) y=Number(event.clientY)-mapRect.top-height-14;
      this.hoverCard.style.transform='translate3d('+Math.max(8,x)+'px,'+Math.max(8,y)+'px,0)';
    }

    hideHover(){
      if(this.hoverCard) this.hoverCard.hidden=true;
    }
  }

  const runtime=new AtlasRuntimeV149();
  runtime.install();
})();
