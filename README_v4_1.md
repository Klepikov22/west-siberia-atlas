# Western Siberia Atlas v4.1

Исправление совместимости: v4.1 не падает с ошибкой `Cannot read properties of null (reading appendChild)`, если GitHub Pages частично закэшировал старый `index.html` или если при загрузке были заменены не все файлы.

Рекомендуемый способ обновления: удалить/заменить в репозитории весь набор файлов из архива, включая `index.html`, `app.js`, `style.css` и папку `data`.
