/* Population circles are DOM buttons above Leaflet's shared path renderer.
 * This module owns rendering, pointer events, keyboard access and its tooltip.
 * Data, sizing and selection policy are supplied by the atlas application. */
(function(root){
  'use strict';
  let sequence=0;
  const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
  const interactive=tool=>tool==='pan' || tool==='parent';

  function create(leaflet,config){
    const PopulationLayer=leaflet.Layer.extend({
      initialize(){
        this.__populationSymbols=true;
        this._symbols=(config.items||[]).filter(item=>
          Number.isFinite(item.radius) && item.radius>0 && item.latlng &&
          Number.isFinite(Number(item.latlng.lat)) && Number.isFinite(Number(item.latlng.lng))
        ).sort((a,b)=>b.radius-a.radius).map(item=>{
          const symbol={feature:item.feature,latlng:item.latlng,radius:item.radius,
            options:{...config.style},element:null};
          symbol.getRadius=()=>symbol.radius;
          symbol.setRadius=value=>{if(Number.isFinite(value) && value>0) symbol.radius=value;this._paint(symbol);return symbol;};
          symbol.setStyle=style=>{Object.assign(symbol.options,style);this._paint(symbol);return symbol;};
          symbol.getElement=()=>symbol.element;
          return symbol;
        });
        this._update=()=>this._schedule();
        this._hide=()=>this.hideHover();
        this._zoomStart=()=>{if(this._root)this._root.style.visibility='hidden';};
        this._zoomEnd=()=>{if(this._root)this._root.style.visibility='';this._schedule();};
        this._frame=0;
      },

      onAdd(map){
        const doc=map.getContainer().ownerDocument;
        this._root=doc.createElement('div');
        this._root.className='population-symbol-layer';
        this._root.setAttribute('aria-label','Символы населения');
        this._tooltip=doc.createElement('div');
        this._tooltip.className='population-symbol-tooltip';
        this._tooltip.id='population-symbol-tooltip-'+(++sequence);
        this._tooltip.setAttribute('role','tooltip');
        this._tooltip.hidden=true;
        map.getContainer().append(this._root,this._tooltip);
        for(const symbol of this._symbols) this._makeButton(symbol,doc);
        map.on('move zoom viewreset resize zoomend moveend',this._update);
        map.on('movestart zoomstart',this._hide);
        map.on('zoomstart',this._zoomStart);
        map.on('zoomend',this._zoomEnd);
        this.setTool();
        this._position();
      },

      onRemove(map){
        map.off('move zoom viewreset resize zoomend moveend',this._update);
        map.off('movestart zoomstart',this._hide);
        map.off('zoomstart',this._zoomStart);
        map.off('zoomend',this._zoomEnd);
        cancelAnimationFrame(this._frame);
        this._frame=0;
        this.hideHover();
        this._root?.remove();
        this._tooltip?.remove();
        this._root=null;
        this._tooltip=null;
        this._symbols.forEach(symbol=>{symbol.element=null;});
      },

      eachLayer(fn){this._symbols.forEach(fn);return this;},
      getLayers(){return this._symbols.slice();},
      hasLayer(symbol){return this._symbols.includes(symbol);},
      bringToFront(){return this;}, // DOM/CSS order is independent of SVG paths.
      syncSelection(){this._symbols.forEach(symbol=>this._paint(symbol));},

      setTool(){
        const enabled=interactive(config.getTool());
        this._symbols.forEach(symbol=>{
          if(!symbol.element) return;
          symbol.element.disabled=!enabled;
          symbol.element.style.pointerEvents=enabled?'auto':'none';
        });
        if(!enabled) this.hideHover();
      },

      _makeButton(symbol,doc){
        const button=doc.createElement('button');
        button.type='button';
        button.className='population-symbol';
        const p=symbol.feature.properties||{};
        button.dataset.unitId=String(p.unit_id||'');
        button.setAttribute('aria-label',`${p.name||'АТЕ'}: население ${number.format(Number(p.population))} чел., ${p.year||config.getYear()} год`);
        button.setAttribute('aria-describedby',this._tooltip.id);
        symbol.element=button;
        let origin=null,moved=false;
        button.addEventListener('pointerdown',event=>{
          origin={x:event.clientX,y:event.clientY};moved=false;
        });
        button.addEventListener('pointermove',event=>{
          if(origin && Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>4) moved=true;
          if(!moved) this._moveTooltip(event);
        });
        button.addEventListener('pointerup',event=>{
          if(origin && Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>4) moved=true;
          origin=null;
        });
        button.addEventListener('pointercancel',()=>{origin=null;moved=true;this.hideHover();});
        button.addEventListener('pointerenter',event=>{
          if(interactive(config.getTool())) this._showHover(symbol,event);
        });
        button.addEventListener('pointerleave',()=>{origin=null;this.hideHover();});
        button.addEventListener('focus',()=>{
          if(!interactive(config.getTool())) return;
          const rect=button.getBoundingClientRect();
          this._showHover(symbol,{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2});
        });
        button.addEventListener('blur',()=>this.hideHover());
        button.addEventListener('click',event=>{
          if(!interactive(config.getTool())) return;
          event.preventDefault();event.stopPropagation();
          if(event.detail!==0 && (moved || this._map?.dragging?.moved?.())) return;
          config.onSelect(symbol.feature,event);
          this.syncSelection();
        });
        // Native button activation already covers Enter and Space.
        button.addEventListener('dblclick',event=>{
          if(interactive(config.getTool())){event.preventDefault();event.stopPropagation();}
        });
        this._paint(symbol);
        this._root.appendChild(button);
      },

      _paint(symbol){
        const el=symbol.element;
        if(!el) return;
        const selected=!!config.isSelected(symbol.feature);
        const hovered=this._hovered===symbol;
        const radius=symbol.radius+(hovered?2:0);
        const style=symbol.options;
        el.style.width=el.style.height=(radius*2)+'px';
        el.style.backgroundColor=style.fillColor||'#f3bd66';
        el.style.borderColor=selected?'#163e73':style.color||'#684d2a';
        el.style.borderWidth=(hovered?3:selected?2.8:style.weight||1.65)+'px';
        el.style.opacity=hovered?'1':String(style.fillOpacity??.74);
        el.classList.toggle('is-hovered',hovered);
        el.classList.toggle('is-selected',selected);
        el.setAttribute('aria-pressed',String(selected));
      },

      _schedule(){
        if(this._frame) return;
        this._frame=requestAnimationFrame(()=>{this._frame=0;this._position();});
      },

      _position(){
        if(!this._map || !this._root) return;
        const size=this._map.getSize();
        for(const symbol of this._symbols){
          const point=this._map.latLngToContainerPoint(symbol.latlng);
          const radius=symbol.radius+3;
          const visible=point.x+radius>=0 && point.y+radius>=0 && point.x-radius<=size.x && point.y-radius<=size.y;
          symbol.element.hidden=!visible;
          symbol.element.style.transform=`translate(${point.x}px,${point.y}px) translate(-50%,-50%)`;
          if(!visible && this._hovered===symbol) this.hideHover();
        }
      },

      _showHover(symbol,event){
        this.hideHover();
        config.onHoverStart?.();
        this._hovered=symbol;
        this._paint(symbol);
        const p=symbol.feature.properties||{};
        const doc=this._tooltip.ownerDocument;
        const title=doc.createElement('b');title.textContent=p.name||'АТЕ без названия';
        const subtitle=doc.createElement('span');subtitle.textContent=[p.unit_type,p.admin_parent].filter(Boolean).join(' · ');
        const population=doc.createElement('div');population.textContent=`Население: ${number.format(Number(p.population))} чел.`;
        const year=doc.createElement('div');year.textContent=`Год: ${p.year||config.getYear()}`;
        this._tooltip.replaceChildren(title,subtitle,population,year);
        this._tooltip.hidden=false;
        this._moveTooltip(event);
      },

      _moveTooltip(event){
        if(!this._tooltip || this._tooltip.hidden || !Number.isFinite(event.clientX)) return;
        const rect=this._map.getContainer().getBoundingClientRect();
        const width=this._tooltip.offsetWidth||230,height=this._tooltip.offsetHeight||95;
        const x=event.clientX-rect.left,y=event.clientY-rect.top;
        const left=Math.max(8,Math.min(x+14,rect.width-width-8));
        const top=Math.max(8,y+height+20>rect.height?y-height-14:y+14);
        this._tooltip.style.transform=`translate(${left}px,${top}px)`;
      },

      hideHover(){
        const old=this._hovered;this._hovered=null;
        if(old) this._paint(old);
        if(this._tooltip) this._tooltip.hidden=true;
      }
    });
    return new PopulationLayer();
  }
  root.AtlasPopulationSymbols={create};
})(typeof window==='object'?window:globalThis);
