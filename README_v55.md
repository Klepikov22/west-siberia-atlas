# Версия 55

Hotfix режима экспорта после v53/v54.

Исправлено:
- ошибка открытия экспорта `Cannot read properties of undefined (reading 'top')`;
- конфликт переопределения `ensureExportFlags` после v51/v53;
- добавлена жёсткая инициализация `state.export.extentBuffer`, `pagePadding`, `fieldPadding`, `innerFrame`, `overlayPositions`;
- добавлен безопасный алиас `updateCharts(features) -> updateGroupAnalytics(features)`;
- обновлены версии в шапке, `index.html`, `manifest.json` и cache-busting до v55.
