/* Keep the time axis continuous across the horizontal year carousel. */
(function(){
  'use strict';
  const track=document.getElementById('yearTimeline');
  if(!track) return;
  let frame=0;
  function update(){
    frame=0;
    const years=track.querySelectorAll('.timeline-year');
    if(years.length<2) return;
    const first=years[0], last=years[years.length-1];
    // offsetLeft is in scroll-content coordinates, not viewport coordinates.
    const left=first.offsetLeft+first.offsetWidth/2;
    const right=last.offsetLeft+last.offsetWidth/2;
    track.style.setProperty('--timeline-axis-left',`${left}px`);
    track.style.setProperty('--timeline-axis-width',`${Math.max(0,right-left)}px`);
  }
  function schedule(){
    if(frame) cancelAnimationFrame(frame);
    frame=requestAnimationFrame(update);
  }
  new MutationObserver(schedule).observe(track,{childList:true});
  if(typeof ResizeObserver==='function') new ResizeObserver(schedule).observe(track);
  window.addEventListener('resize',schedule,{passive:true});
  document.fonts?.ready?.then(schedule);
  schedule();
})();
