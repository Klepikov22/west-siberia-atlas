# v73

## Новые данные

Добавлены административные срезы:

- `1947` → `data/admin/admin_1947.geojson`
- `1964` → `data/admin/admin_1964.geojson`

Оба слоя подключены в `data/manifest.json` и добавлены на таймслайдер между соседними историческими срезами.

## Нормализация атрибутов

Слои приведены к основной структуре проекта:

- `unit_id`
- `year`
- `name`
- `unit_type`
- `admin_parent`
- `center`
- `population`
- `urban_pop`
- `rural_pop`
- `urban_share`
- `area_km2`
- `density`
- `source_layer`
- `raw_objectid`
- `rail_length_km`
- `rail_density_km_1000`
- `rail_segments_count`

Также сохранены диагностические поля модели населения:

- для 1947: `pop_model_method`, `pop_model_note`, `name_match_ratio`, `name_source`, `model_year`;
- для 1964: `pop_model_method`, `pop_model_note`, `p1959_est_total`, `p1970_est_total`.

## Проверка населения

Население было сверено с переданными диагностическими таблицами:

- `diagnostic_layers_summary.csv`
- `diagnostic_1947_by_region.csv`
- `diagnostic_1964_by_region.csv`
- `layer_1947_population_model_diagnostics.csv`
- `layer_1964_population_model_diagnostics.csv`

Итоги совпадают с диагностикой без расхождений:

| год | объектов | население | городское | сельское |
|---:|---:|---:|---:|---:|
| 1947 | 267 | 8 604 429 | 2 665 903 | 5 938 526 |
| 1964 | 163 | 12 038 892 | 6 609 324 | 5 429 568 |

Проверочные таблицы сохранены в `docs/`:

- `v73_layers_1947_1964_integration_summary.csv`
- `v73_diagnostic_1947_by_region_check.csv`
- `v73_diagnostic_1964_by_region_check.csv`

## Расчёты

Пересчитаны:

- плотность населения: `population / area_km2`;
- протяжённость действующих ЖД внутри каждой АТЕ;
- густота ЖД: `rail_length_km / area_km2 * 1000`;
- количество пересекающих АТЕ активных ЖД-сегментов.

ЖД-сегменты отбирались по `year_open <= год` и отсутствующему/более позднему `year_close`. Для преемственности с существующими слоями проекта длины рассчитаны в Web Mercator, как в старом расчёте v15.
