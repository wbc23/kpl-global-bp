import React, { useMemo } from 'react';
import { useHashRoute, useTheme } from './app.js';
import heroesData from './data/heroes.json';
import SimulatorPage from './pages/SimulatorPage.jsx';
import RecordPage from './pages/RecordPage.jsx';
import RosterPage from './pages/RosterPage.jsx';
import AnalysisPage from './pages/AnalysisPage.jsx';
import ManagePage from './pages/ManagePage.jsx';

const NAV_ITEMS = [
  { hash: '#/sim', label: '模拟推演' },
  { hash: '#/record', label: '比赛录入' },
  { hash: '#/roster', label: '大名单' },
  { hash: '#/analysis', label: '数据分析' },
  { hash: '#/manage', label: '基础数据' },
];

export default function App() {
  const [hash, navigate] = useHashRoute();
  const { theme, toggle } = useTheme();
  const heroesById = useMemo(() => Object.fromEntries(heroesData.map((h) => [h.id, h])), []);

  const page = (() => {
    switch (hash) {
      case '#/record': return <RecordPage heroesById={heroesById} />;
      case '#/roster': return <RosterPage />;
      case '#/analysis': return <AnalysisPage heroesById={heroesById} />;
      case '#/manage': return <ManagePage />;
      default: return <SimulatorPage heroesById={heroesById} />;
    }
  })();

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo" onClick={() => navigate('#/sim')} role="button" tabIndex={0}>
          <span className="logo-main">KPL BP 数据平台</span>
          <span className="logo-sub">全局BP模拟 · 比赛录入 · 数据分析</span>
        </div>
        <nav className="main-nav">
          {NAV_ITEMS.map((n) => (
            <button
              key={n.hash}
              className={`nav-link ${hash === n.hash ? 'on' : ''}`}
              onClick={() => navigate(n.hash)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {window.location.port === '9101' && (
            <span className="test-badge" title="测试环境：独立数据库与构建，不影响 9100 生产数据">测试环境</span>
          )}
          <button className="btn btn-ghost theme-toggle" onClick={toggle} title="切换深色/浅色主题">
            {theme === 'dark' ? '☀️ 浅色' : '🌙 深色'}
          </button>
        </div>
      </header>

      {page}

      <footer className="footer">
        英雄数据与头像来自王者荣耀官网（pvp.qq.com / game.gtimg.cn），仅供学习与数据整理，非官方工具。
      </footer>
    </div>
  );
}
