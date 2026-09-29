import { useEffect, useRef, useState, useCallback } from 'react';

/* ---------- 主题 ---------- */
export const THEME_KEY = 'kpl-bp-theme';

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }, [theme]);
  return { theme, toggle };
}

/* ---------- Hash 路由 ---------- */
export function useHashRoute(defaultHash = '#/sim') {
  const [hash, setHash] = useState(() => window.location.hash || defaultHash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || defaultHash);
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) window.location.hash = defaultHash;
    return () => window.removeEventListener('hashchange', onChange);
  }, [defaultHash]);

  const navigate = useCallback((to) => { window.location.hash = to; }, []);
  return [hash, navigate];
}

/* ---------- Esc 关闭：后打开的界面优先消费按键 ---------- */
const escStack = [];

export function useEscape(handler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const entry = Symbol('esc');
    escStack.push(entry);
    const onKey = (e) => {
      if (e.key !== 'Escape' || escStack.length === 0) return;
      if (escStack[escStack.length - 1] !== entry) return; // 只响应最上层
      e.preventDefault();
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      const i = escStack.indexOf(entry);
      if (i !== -1) escStack.splice(i, 1);
      window.removeEventListener('keydown', onKey);
    };
  }, [active]);
}
