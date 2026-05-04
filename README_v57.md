# v57

Hotfix режима экспорта: исправлена ошибка построения превью `Cannot read properties of undefined (reading canvasWidth)`. Причина была в конфликте старого v51-wrapper и v55 hotfix для `ensureExportFlags`: функция могла вернуть `undefined`, а `exportMapSize()` затем обращался к `canvasWidth`. В v57 добавлен финальный безопасный override `ensureExportFlags()` и `exportMapSize()`, который всегда возвращает нормализованный `state.export`.
