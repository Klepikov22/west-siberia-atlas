/*
 * Отрисовка эскиза выборки (рамка и полигон).
 *
 * Эскиз рисуется в собственном SVG-слое поверх карты, в пикселях контейнера.
 * Поэтому он не зависит от панелей Leaflet, z-index слоёв АТЕ и подписей
 * и всегда следует за курсором. Логика выбора объектов здесь не находится:
 * модуль только рисует.
 *
 *   const sketch = AtlasSketch.create(map);
 *   sketch.rect(pointA, pointB);              // точки контейнера L.Point
 *   sketch.polygon(points, cursorPoint);      // вершины + «резиновая» линия
 *   sketch.clear();
 */
(function(){
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };

  function create(map) {
    const container = map.getContainer();
    const svg = el('svg', { class: 'selection-sketch', 'aria-hidden': 'true' });
    const fill = el('path', { class: 'sketch-fill' });
    const line = el('path', { class: 'sketch-line' });
    const dots = el('g', { class: 'sketch-dots' });
    svg.append(fill, line, dots);
    container.appendChild(svg);

    const clear = () => {
      fill.removeAttribute('d');
      line.removeAttribute('d');
      dots.replaceChildren();
    };
    const path = (pts, close) =>
      pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + (close ? 'Z' : '');

    return {
      clear,
      rect(a, b) {
        dots.replaceChildren();
        const pts = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
        fill.setAttribute('d', path(pts, true));
        line.setAttribute('d', path(pts, true));
      },
      polygon(points, cursor) {
        dots.replaceChildren();
        if (!points.length) return clear();
        const outline = cursor ? points.concat([cursor]) : points;
        line.setAttribute('d', path(outline, false));
        if (outline.length >= 3) fill.setAttribute('d', path(outline, true)); else fill.removeAttribute('d');
        points.forEach((p, i) => dots.appendChild(
          el('circle', { cx: p.x, cy: p.y, r: i === 0 ? 6 : 4, class: i === 0 ? 'sketch-dot first' : 'sketch-dot' })
        ));
      }
    };
  }

  window.AtlasSketch = { create };
})();
