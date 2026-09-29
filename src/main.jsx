import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { applyTheme, THEME_KEY } from './app.js';
import './styles.css';

// 尽早应用主题，避免闪烁（默认浅色）
let theme = 'light';
try { theme = localStorage.getItem(THEME_KEY) || 'light'; } catch { /* ignore */ }
applyTheme(theme);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
