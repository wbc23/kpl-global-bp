import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useEscape } from '../app.js';
import { DEFAULT_PLAYERS, LANE_BADGES } from '../data/constants.js';
import { PINYIN } from '../components/TeamPicker.jsx';

/** 大名单管理：每赛季（赛事）确定参赛战队并为各队登记选手，录入比赛时点选首发 */
export default function RosterPage() {
  const [meta, setMeta] = useState(null);
  const [eventId, setEventId] = useState('');
  const [rosters, setRosters] = useState([]);
  const [eventTeamIds, setEventTeamIds] = useState(null); // 参赛队 id 数组；null=未设置（显示全部战队）
  const [teamSetup, setTeamSetup] = useState(false);
  const [editing, setEditing] = useState(null); // {teamId, roster?}
  const [error, setError] = useState('');
  // 当前赛事的实时引用 + 递增请求序号：reload 与 eventId effect 共用，
  // 响应必须"仍是最新请求且属于当前赛事"才回写（拦 A→B→A 及并发中的旧结果）
  const eventIdRef = useRef(eventId);
  useEffect(() => { eventIdRef.current = eventId; }, [eventId]);
  const reqSeqRef = useRef(0);
  const [eventReady, setEventReady] = useState(false);
  const [eventLoadErr, setEventLoadErr] = useState('');

  const fetchEventData = (id) => {
    const seq = ++reqSeqRef.current;
    const ok = () => eventIdRef.current === id && seq === reqSeqRef.current;
    setEventReady(false);
    setEventLoadErr('');
    let doneR = false, doneT = false;
    const mark = () => { if (doneR && doneT) setEventReady(true); };
    api.rosters(id)
      .then((r) => { if (ok()) { setRosters(r); doneR = true; mark(); } })
      .catch(() => { if (ok()) setEventLoadErr('大名单加载失败'); });
    api.eventTeams(id)
      .then((ids) => { if (ok()) { setEventTeamIds(ids.length ? ids : null); doneT = true; mark(); } })
      .catch(() => { if (ok()) setEventLoadErr('参赛战队加载失败'); });
  };

  const reload = async (evId) => {
    try {
      const useId = evId ?? eventId;
      if (useId) {
        // 名单编辑器的保存完成回调可能带着旧赛事（A）调用 reload：仅当目标仍属当前
        // 赛事才发起事件数据刷新——否则 fetchEventData(A) 会先递增请求序号、把当前
        // 赛事（B）的在途加载作废，随后 A 的响应又被赛事校验拒收，B 永远停在未就绪（N03）
        if (eventIdRef.current === useId) fetchEventData(useId);
      } else setRosters([]);
      const m = await api.meta();
      if (m) setMeta(m);
      setError('');
    } catch (e) {
      setError(`数据服务不可达：${e.message}`);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 默认选中"当前赛事"（最近有录入的赛事；无录入时回退最新创建的），其次第一个赛事
  useEffect(() => {
    if (!eventId && meta?.events?.length) {
      setEventId(String(meta.currentEventId ?? meta.events[0].id));
    }
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!eventId) { setRosters([]); setEventTeamIds(null); setEventReady(false); return; }
    setEditing(null);
    // 切换瞬间先清空并置未就绪：加载窗口/失败时「参赛战队」「登记」按钮禁用——
    // 不把"尚未知晓"当成"未设置参赛队/未登记"开放编辑
    setRosters([]);
    setEventTeamIds(null);
    fetchEventData(eventId);
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rosterByTeam = useMemo(() => new Map(rosters.map((r) => [r.teamId, r])), [rosters]);
  // 参赛队（未设置时回退全部战队）；已登记分母随之。meta 未加载完为 null，先回退空数组
  const shownTeams = useMemo(() => (
    !meta ? [] : (eventTeamIds ? meta.teams.filter((t) => eventTeamIds.includes(t.id)) : meta.teams)
  ), [meta, eventTeamIds]);
  // 分子与分母同口径：只统计当前展示的（参赛）战队中已登记名单的数量——
  // 减少参赛队后历史名单保留时，不会出现"已登记 18/12 支"的分子大于分母
  const registered = shownTeams.filter((t) => rosterByTeam.has(t.id)).length;

  // 快捷新建赛事（与录入表单同款）：赛季开始先在此建赛事并登记名单，再去录入比赛
  const promptAddEvent = async () => {
    const input = window.prompt('输入新赛事名称，如：2026KPL夏季赛');
    if (!input) return;
    try {
      const r = await api.addEvent(input.trim());
      await reload();
      setEventId(String(r.id));
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>大名单</h2>
        {meta && (
          <div className="filter-inline">
            <span className="filter-label">赛事</span>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {meta.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={promptAddEvent}>＋新建赛事</button>
            <button
              className="btn btn-blue btn-sm"
              disabled={!eventId || !eventReady}
              title={eventReady ? '确定本赛事的参赛战队（新队加入/老队退出在此调整），然后逐队登记名单' : '本赛事数据加载中/加载失败，稍候或重试'}
              onClick={() => setTeamSetup(true)}
            >
              参赛战队
            </button>
            <span className="sample-meta">已登记 {registered}/{shownTeams.length} 支战队</span>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {eventLoadErr && eventId && (
        <div className="error-banner">
          {eventLoadErr}：
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 10 }} onClick={() => fetchEventData(eventId)}>重试</button>
        </div>
      )}

      {meta && (!meta.events.length
        ? <div className="panel empty-hint">还没有赛事。点上方「＋新建赛事」创建一个（如 2026KPL夏季赛），然后点「参赛战队」确定参赛队伍，再逐队登记名单。</div>
        : <div className="panel empty-hint">
            {eventTeamIds
              ? <>本赛事已确定 <b>{shownTeams.length}</b> 支参赛战队（点「参赛战队」可增减调整）。 </>
              : <>未设置参赛战队，当前显示全部战队（点「参赛战队」可先确定参赛队伍再登记）。 </>}
            前 5 位默认按位置顺序（对抗路 / 打野 / 中路 / 发育路 / 游走），之后为替补。
            比赛录入时可直接点选首发，避免缺人、漏人或打错名字。
          </div>
      )}

      {teamSetup && eventId && (
        <ParticipatingTeamsDialog
          meta={meta}
          eventId={Number(eventId)}
          initialTeamIds={eventTeamIds || meta.teams.map((t) => t.id)}
          onClose={() => setTeamSetup(false)}
          onSaved={(ids) => { setTeamSetup(false); setEventTeamIds(ids.length ? ids : null); reload(); }}
        />
      )}

      {editing && (
        <RosterEditor
          key={editing.teamId}
          meta={meta}
          eventId={Number(eventId)}
          teamId={editing.teamId}
          initial={editing.roster}
          onDone={() => { setEditing(null); reload(); }}
        />
      )}

      {meta && meta.events.length > 0 && (
        <div className="panel table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>战队</th><th>状态</th><th>名单</th><th>操作</th></tr>
            </thead>
            <tbody>
              {shownTeams.map((t) => {
                const r = rosterByTeam.get(t.id);
                return (
                  <tr key={t.id}>
                    <td className="t t-blue">{t.name}</td>
                    <td>
                      {r
                        ? <span className="tag-done">已登记 {r.players.length} 人</span>
                        : <span className="tag-todo">未登记</span>}
                    </td>
                    <td>
                      {r ? (
                        <span className="roster-cells">
                          {r.players.map((p, i) => (
                            <span className={`roster-cell ${i >= 5 ? 'sub' : ''}`} key={i}
                              title={i < 5 ? `位置${i + 1}（${DEFAULT_PLAYERS[i]}）` : '替补'}>
                              {p}
                            </span>
                          ))}
                        </span>
                      ) : <span className="dim">—</span>}
                    </td>
                    <td className="op-cell">
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={!eventReady}
                        title={eventReady ? undefined : '本赛事名单数据加载中/失败，稍候或重试'}
                        onClick={() => setEditing({ teamId: t.id, roster: rosterByTeam.get(t.id) })}
                      >
                        {r ? '编辑' : '登记'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================= 参赛战队设置（整体替换：新队加入/老队退出都在这里改） ================= */
function ParticipatingTeamsDialog({ meta, eventId, initialTeamIds, onClose, onSaved }) {
  useEscape(onClose);
  const ev = meta.events.find((e) => e.id === eventId);
  // 本地战队副本：新建战队后直接 append，无需整页刷新
  const [teams, setTeams] = useState(() => [...meta.teams]);
  const [selected, setSelected] = useState(() => new Set(initialTeamIds));
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newShort, setNewShort] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  if (!ev) return null;

  const query = q.trim().toLowerCase();
  const list = query
    ? teams.filter((t) => `${t.name} ${t.short || ''} ${PINYIN[t.name] || ''}`.toLowerCase().includes(query))
    : teams;

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // 全选/清空只作用于当前搜索结果（未搜索时即全体战队）
  const setAll = (on) => {
    const ids = list.map((t) => t.id);
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const addTeam = async () => {
    const name = newName.trim();
    if (!name) return setErr('战队名称不能为空');
    try {
      const r = await api.addTeam(name, newShort.trim());
      setTeams((prev) => [...prev, { id: r.id, name, short: newShort.trim() }]);
      setSelected((prev) => new Set(prev).add(r.id)); // 新建即选中
      setAddOpen(false); setNewName(''); setNewShort(''); setErr('');
    } catch (e) { setErr(e.message); }
  };

  const save = async () => {
    if (!selected.size) return setErr('至少选择 1 支参赛战队');
    setSaving(true); setErr('');
    try {
      // 直接用选中集合：不经本地 teams 过滤——重开弹窗时 initialTeamIds 可能含本地列表缺
      // 失的战队（如弹窗内新建后父页未刷新），过滤会把它从参赛名单中静默剔除
      const ids = [...selected];
      await api.saveEventTeams(eventId, ids);
      onSaved(ids);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-wide modal-scroll" onClick={(e) => e.stopPropagation()}>
        <div className="replay-head">
          <h3>{ev.name} · 参赛战队</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>关闭</button>
        </div>
        <div className="roster-edit-hint">
          点卡片选择 / 取消参赛战队，保存后本页列表与录入选队只显示这些战队
        </div>
        <div className="teamsetup-bar">
          <input
            className="teamsetup-search" value={q}
            placeholder="搜索战队（名称 / 简称 / 拼音）"
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="teamsetup-count">已选 <b>{selected.size}</b>/{teams.length}</span>
          <button className="btn btn-ghost btn-sm" disabled={!list.length} onClick={() => setAll(true)}>全选</button>
          <button className="btn btn-ghost btn-sm" disabled={!selected.size} onClick={() => setAll(false)}>清空</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(!addOpen)}>
            {addOpen ? '收起新建' : '＋ 新建战队'}
          </button>
        </div>
        {addOpen && (
          <div className="teamsetup-addform">
            <input style={{ width: 150 }} value={newName} maxLength={12} placeholder="名称，如：镇江VS"
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTeam(); }} />
            <input style={{ width: 96 }} value={newShort} maxLength={8} placeholder="简称，如：VS"
              onChange={(e) => setNewShort(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTeam(); }} />
            <button className="btn btn-blue btn-sm" onClick={addTeam}>创建并加入</button>
            <span className="dim" style={{ fontSize: 12 }}>创建后自动选中；改名/删除在「基础数据」页</span>
          </div>
        )}
        <div className="teamsetup-grid">
          {list.map((t) => {
            const on = selected.has(t.id);
            return (
              <button
                type="button" key={t.id}
                className={`team-card ${on ? 'on' : ''}`}
                title={t.short && t.short !== t.name ? `${t.name}（${t.short}）` : t.name}
                onClick={() => toggle(t.id)}
              >
                <span className={`tc-check ${on ? '' : 'off'}`}>✓</span>
                <span className="tc-name">{t.name}</span>
              </button>
            );
          })}
          {!list.length && <div className="pool-empty">无匹配战队</div>}
        </div>
        {err && <div className="error-banner">{err}</div>}
        <div className="overlay-actions">
          <button className="btn btn-gold" disabled={saving || !selected.size} onClick={save}>
            {saving ? '保存中…' : `保存参赛战队（${selected.size} 支）`}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

/* ================= 单队名单编辑 ================= */
function RosterEditor({ meta, eventId, teamId, initial, onDone }) {
  const [rows, setRows] = useState(() => {
    const names = initial?.players?.length ? initial.players : [''];
    return names.slice();
  });
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [err, setErr] = useState('');
  // 新登记时：预填该队在其他赛事登记过的名单（来源按"最近有比赛的赛事"优先，无比赛按创建较晚），
  // 拉取完成前用户已动手输入则不覆盖，仅在提示条里提供手动带入
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [prefilledFrom, setPrefilledFrom] = useState('');
  useEffect(() => {
    if (initial) return;
    let alive = true;
    (async () => {
      try {
        const others = meta.events.filter((e) => e.id !== eventId);
        if (!others.length) return;
        const [allSeries, ...rosterLists] = await Promise.all([
          api.series(),
          ...others.map((e) => api.rosters(e.id)),
        ]);
        const latestByEvent = new Map();
        for (const s of allSeries) {
          const cur = latestByEvent.get(s.eventId);
          if (!cur || s.date > cur) latestByEvent.set(s.eventId, s.date);
        }
        const cands = others
          .map((e, i) => {
            const r = rosterLists[i].find((x) => x.teamId === teamId);
            return r ? { eventId: e.id, eventName: e.name, players: r.players, latest: latestByEvent.get(e.id) ?? '' } : null;
          })
          .filter(Boolean)
          .sort((a, b) => (b.latest || '').localeCompare(a.latest || '') || b.eventId - a.eventId);
        if (!alive || !cands.length) return;
        setSources(cands);
        setSourceId(String(cands[0].eventId));
        setRows((cur) => (cur.every((v) => !v.trim()) ? cands[0].players.slice() : cur));
        setPrefilledFrom(cands[0].eventName);
      } catch { /* 预填拉取失败不影响正常手输 */ }
    })();
    return () => { alive = false; };
  }, [initial, meta, eventId, teamId]);

  const applySource = () => {
    const s = sources.find((x) => String(x.eventId) === sourceId);
    if (s) { setRows(s.players.slice()); setPrefilledFrom(s.eventName); }
  };
  const team = meta.teams.find((t) => t.id === teamId);
  const ev = meta.events.find((e) => e.id === eventId);
  if (!team || !ev) return null;

  const setRow = (i, v) => { const n = [...rows]; n[i] = v; setRows(n); };
  const delRow = (i) => setRows(rows.length <= 1 ? [''] : rows.filter((_, j) => j !== i));
  const posLabel = (i) => (i < 5 ? `位置${i + 1} · ${DEFAULT_PLAYERS[i]}` : `替补${i - 4}`);

  const applyBatch = () => {
    const names = batchText.split(/[\n,，、;；]+/).map((x) => x.trim()).filter(Boolean);
    if (names.length) setRows(names);
    setBatchOpen(false);
    setBatchText('');
  };

  const save = async () => {
    const names = rows.map((x) => x.trim()).filter(Boolean);
    if (names.length === 0) return setErr('至少填写 1 名选手');
    if (new Set(names).size !== names.length) return setErr('名单内存在重复选手');
    try {
      await api.saveRoster({ eventId, teamId, players: names });
      onDone();
    } catch (e) { setErr(e.message); }
  };

  const remove = async () => {
    if (!window.confirm(`删除 ${team.name} 在 ${ev.name} 的大名单？`)) return;
    try {
      if (initial?.id) await api.deleteRoster(initial.id);
      onDone();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="panel form-panel">
      <div className="section-head">
        <span className="panel-title">{ev.name} · {team.name} 大名单{initial ? '' : '（新登记）'}</span>
        {initial && <button className="btn btn-ghost btn-sm danger" onClick={remove}>删除名单</button>}
      </div>

      {!initial && sources.length > 0 && (
        <div className="setup-row">
          {prefilledFrom
            ? <span className="tag-done">已预填自「{prefilledFrom}」，核对转会/位置变动后保存</span>
            : <span className="dim" style={{ fontSize: 12 }}>该队在其他赛事登记过名单，可带入后修改</span>}
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => <option key={s.eventId} value={s.eventId}>{s.eventName}（{s.players.length} 人）</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={applySource}>填入</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setRows(['']); setPrefilledFrom(''); }}>清空</button>
        </div>
      )}

      <div className="setup-row">
        <button className="btn btn-ghost btn-sm" onClick={() => setBatchOpen(!batchOpen)}>
          {batchOpen ? '收起批量粘贴' : '批量粘贴（每行一个选手名）'}
        </button>
        <span className="dim" style={{ fontSize: 12 }}>前 5 位为首发位置，之后为替补</span>
      </div>
      {batchOpen && (
        <div className="setup-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <textarea className="sync-textarea" rows={5} value={batchText}
            onChange={(e) => setBatchText(e.target.value)} placeholder={'一诺\n明夏\n长生\n小北\n大乔\n替补甲'} />
          <button className="btn btn-blue btn-sm" style={{ alignSelf: 'flex-start' }} onClick={applyBatch}>应用到名单</button>
        </div>
      )}

      <div className="roster-edit-grid">
        {rows.map((v, i) => (
          <div className="setup-player" key={i}>
            {i < 5
              ? <span className={`lane-badge ${LANE_BADGES[i].cls}`} title={posLabel(i)}>{LANE_BADGES[i].text}</span>
              : <span className="setup-player-no" title={posLabel(i)}>{i + 1}</span>}
            <input
              value={v} maxLength={12} list="roster-player-names"
              placeholder={posLabel(i)}
              onChange={(e) => setRow(i, e.target.value)}
            />
            <span className="dim pos-label">{posLabel(i)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => delRow(i)} title="删除该行">✕</button>
          </div>
        ))}
      </div>
      <datalist id="roster-player-names">
        {meta.players.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>

      <div className="setup-row">
        <button className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, ''])}>＋ 加一人</button>
      </div>
      {err && <div className="error-banner">{err}</div>}
      <div className="overlay-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-gold" onClick={save}>保存名单</button>
        <button className="btn btn-ghost" onClick={onDone}>取消</button>
      </div>
    </div>
  );
}
