# v87 — топологический граф связности АТЕ

## Метод

Для каждого административного слоя построен граф смежности ATE:

- узел = административная единица слоя;
- ребро = общая граница двух единиц не менее 1 км;
- точечные касания не учитываются;
- спорные зоны, территории неясного / слабого контроля, двоеданческие и контекстные зоны исключаются;
- города / горсоветы площадью менее 50 км² исключаются, если нет явного признака областного / краевого / республиканского подчинения.

## Расчитанные поля в GeoJSON

- `topo_degree`
- `topo_degree_centrality`
- `topo_betweenness`
- `topo_closeness`
- `topo_k_core`
- `topo_component_id`
- `topo_component_size`
- `topo_internal_degree`
- `topo_external_degree`
- `topo_external_share`
- `topo_super_internal_degree`
- `topo_super_external_degree`
- `topo_boundary_km_total`
- `topo_boundary_km_avg`
- `topo_articulation_point`
- `topology_excluded`
- `topology_exclusion_reason`

## Новые данные

- `data/topology/topology_<year>.geojson` — ребра графа по каждому году.
- `docs/v87_topology_graph_summary.csv` — сводка по графам.
- `docs/v87_topology_graph_edges.csv` — таблица ребер.
- `docs/v87_topology_graph_excluded_features.csv` — исключенные объекты.

## Интерфейс

Добавлены режимы карты:

- топология: число соседей;
- топология: посредничество;
- топология: близость;
- топология: ядро / периферия.

Также добавлен блок “Топологический граф” с переключением отображения ребер и узлов поверх карты.
