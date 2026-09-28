// Ставит выбранную тему до отрисовки страницы — без вспышки светлой темы
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* приватный режим */ }
