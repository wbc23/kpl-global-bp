import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

/** 基础数据管理：战队 / 选手 / 赛事 */
export default function ManagePage() {
  const [meta, setMeta] = useState(null);
  const [seriesList, setSeriesList] = useState([]);
  const [error, setError] = useState('');

  const reload = async () => {
    try {
      const [m, s] = await Promise.all([api.meta(), api.series()]);
      setMeta(m); setSeriesList(s); setError('');
    } catch (e) {
      setError(`数据服务不可达：${e.message}（请先运行 npm run dev 或 npm start）`);
    }
  };
  useEffect(() => { reload(); }, []);

  if (!meta && !error) return <div className="panel empty-hint">加载基础数据…</div>;

  const seriesCountOfTeam = (teamId) =>
    seriesList.filter((s) => s.team1.id === teamId || s.team2.id === teamId).length;
  const seriesCountOfEvent = (eventId) =>
    seriesList.filter((s) => s.eventId === eventId).length;

  const guard = async (fn) => {
    try { await fn(); await reload(); } catch (e) { alert(e.message); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>基础数据</h2>
        <button className="btn btn-ghost btn-sm" onClick={reload}>刷新</button>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {meta && (
        <>
          <div className="two-col">
            {/* 战队 */}
            <div className="panel section">
              <div className="section-head"><span className="panel-title">战队（{meta.teams.length}）</span></div>
              <AddRow
                placeholder="新增战队：名称,简称（如 成都AG超玩会,AG）"
                onAdd={(text) => {
                  const [n, s] = text.split(/[，,]/).map((x) => x.trim());
                  return guard(() => api.addTeam(n, s || ''));
                }}
              />
              <div className="manage-list">
                {meta.teams.map((t) => (
                  <div className="manage-row" key={t.id}>
                    <span className="manage-name">{t.name}</span>
                    <span className="manage-sub">{t.short}</span>
                    <span className="manage-count">{seriesCountOfTeam(t.id)} 场</span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const input = window.prompt('修改战队（名称,简称）：', `${t.name},${t.short || ''}`);
                        if (!input) return;
                        const [n, s] = input.split(/[，,]/).map((x) => x.trim());
                        if (!n) return alert('名称不能为空');
                        guard(() => api.updateTeam(t.id, n, s || ''));
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className="btn btn-ghost btn-sm danger"
                      onClick={() => { if (window.confirm(`删除战队「${t.name}」？`)) guard(() => api.deleteTeam(t.id)); }}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 赛事 */}
            <div className="panel section">
              <div className="section-head"><span className="panel-title">赛事（{meta.events.length}）</span></div>
              <AddRow
                placeholder="新增赛事（如 2026 KPL春季赛）"
                onAdd={(text) => guard(() => api.addEvent(text))}
              />
              <div className="manage-list">
                {meta.events.map((e) => (
                  <div className="manage-row" key={e.id}>
                    <span className="manage-name">{e.name}</span>
                    <span className="manage-count">{seriesCountOfEvent(e.id)} 场</span>
                    <button
                      className="btn btn-ghost btn-sm danger"
                      onClick={() => { if (window.confirm(`删除赛事「${e.name}」？`)) guard(() => api.deleteEvent(e.id)); }}
                    >
                      删除
                    </button>
                  </div>
                ))}
                {meta.events.length === 0 && <div className="empty-hint">暂无赛事，可在录入页或此处添加</div>}
              </div>
            </div>
          </div>

          {/* 选手 */}
          <div className="panel section">
            <div className="section-head"><span className="panel-title">选手库（{meta.players.length}，录入阵容时自动补充）</span></div>
            <AddRow
              placeholder="新增选手昵称"
              onAdd={(text) => guard(() => api.addPlayer(text))}
            />
            <div className="chip-list">
              {meta.players.map((p) => (
                <span className="stat-chip" key={p.id}>
                  {p.name}
                  <button
                    className="chip-del"
                    title="删除"
                    onClick={() => { if (window.confirm(`删除选手「${p.name}」？`)) guard(() => api.deletePlayer(p.id)); }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {meta.players.length === 0 && <div className="empty-hint">暂无选手</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AddRow({ placeholder, onAdd }) {
  const [text, setText] = useState('');
  const submit = async () => {
    const v = text.trim();
    if (!v) return;
    await onAdd(v);
    setText('');
  };
  return (
    <div className="add-row">
      <input
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button className="btn btn-gold btn-sm" onClick={submit}>添加</button>
    </div>
  );
}
