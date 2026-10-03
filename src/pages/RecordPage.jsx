import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { api } from '../api.js';
import { useEscape } from '../app.js';
import { DEFAULT_PLAYERS, LANE_BADGES, SIDE } from '../data/constants.js';
import { getFlow, winsNeeded } from '../bp/rules.js';
import { createRecording, createEditRecording, createContinueRecording, recordingReducer, toViewState, teamWins, curRosterOf, rosterLockConflicts } from '../record/recording.js';
import { blueFlipConflicts, editSaveConflicts } from '../record/checks.js';
import { saveDraft, clearDraft, loadDrafts, hasDraftProgress } from '../record/recording.js';
import DraftCenter from '../components/DraftCenter.jsx';
import HeroAvatar from '../components/HeroAvatar.jsx';
import TeamPicker from '../components/TeamPicker.jsx';

const STAGE_PRESETS = ['常规赛', '季后赛'];
// 新建录入的记忆键：上次使用的赛事/赛段/日期/赛制
const PREFS_KEY = 'kpl-bp-record-prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** 两个阵容是否一致（用于判断该局是否单独换过人） */
function sameRoster(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 录入会话/草稿 → 服务端 games 载荷（仅已完成局；与系列赛阵容相同的逐局阵容不冗余存储） */
function gamesPayload(rec) {
  const { meta } = rec;
  return rec.games.map((g, i) => ({
    gameNo: i + 1, blind: g.blind, blue1: g.blueFirst, winner: g.winner, draft: g.actions,
    roster1: sameRoster(g.roster1, meta.roster1) ? null : g.roster1,
    roster2: sameRoster(g.roster2, meta.roster2) ? null : g.roster2,
  }));
}

/** 保存系列赛：继续录入的会话走尾部追加（只写会话建立后新录的局，库内旧局保持
 *  服务端版本——期间通过回放做的修正不会被草稿副本覆盖，局数不符时服务端 409），
 *  新会话走新建；返回系列赛 id */
async function saveSeriesToDb(meta, games) {
  if (meta.continueSeriesId) {
    if (Number.isInteger(meta.baseGames)) {
      const newGames = games.slice(meta.baseGames);
      if (newGames.length > 0) {
        await api.updateSeriesGames(meta.continueSeriesId, { games: newGames, fromGameNo: meta.baseGames + 1 });
      }
      return meta.continueSeriesId;
    }
    // 旧版草稿无 baseGames：整体替换（保持旧行为）
    await api.updateSeriesGames(meta.continueSeriesId, { games });
    return meta.continueSeriesId;
  }
  const r = await api.saveSeries({
    eventId: meta.eventId, stage: meta.stage, date: meta.date, bo: meta.bo,
    team1Id: meta.team1.id, team2Id: meta.team2.id,
    roster1: meta.roster1, roster2: meta.roster2,
    note: meta.note || '',
    scheduleId: meta.scheduleId || undefined,
    games,
  });
  return r.id;
}

export default function RecordPage({ heroesById }) {
  const [view, setView] = useState('list'); // list | form | recording
  const [replay, setReplay] = useState(null); // 回放的系列赛对象
  const [editing, setEditing] = useState(null); // 编辑元数据的系列赛
  const [meta, setMeta] = useState(null);
  const [seriesList, setSeriesList] = useState(null);
  const [recording, recDispatch] = useReducer(recordingReducer, null);
  // 未完成的录入草稿（localStorage 多槽位，可同时进行多场录入）
  const [drafts, setDrafts] = useState(() => loadDrafts());
  // 单局 BP 编辑会话（独立 reducer，不与录入草稿互相覆盖）
  const [editGame, setEditGame] = useState(null); // { series, game }
  const [editRec, editDispatch] = useReducer(recordingReducer, null);
  const [error, setError] = useState('');
  // 列表赛事筛选：默认"当前赛事"（最近有录入的赛事，服务端 meta.currentEventId）；'all'=全部
  const [listEventId, setListEventId] = useState('');
  useEffect(() => {
    if (!listEventId && meta) {
      setListEventId(meta.currentEventId != null ? String(meta.currentEventId) : 'all');
    }
  }, [meta, listEventId]);
  const filteredSeries = useMemo(() => (
    !seriesList ? [] : (listEventId === 'all' ? seriesList : seriesList.filter((s) => String(s.eventId) === listEventId))
  ), [seriesList, listEventId]);
  // 从赛程页跳转带来的预填（一次性读取）
  const [prefill] = useState(() => {
    try {
      const raw = sessionStorage.getItem('kpl-bp-prefill');
      if (raw) { sessionStorage.removeItem('kpl-bp-prefill'); return JSON.parse(raw); }
    } catch { /* ignore */ }
    return null;
  });

  const reload = async () => {
    try {
      const [m, s] = await Promise.all([api.meta(), api.series()]);
      setMeta(m); setSeriesList(s); setError('');
    } catch (e) {
      setError(`数据服务不可达：${e.message}（请先运行 npm run dev 或 npm start）`);
    }
  };

  useEffect(() => { reload(); }, []);
  useEffect(() => { if (prefill) setView('form'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 录入过程草稿自动保存（多槽位，按会话 ID 定位）；入库成功后清除本会话槽位
  useEffect(() => {
    if (!recording) return;
    if (recording.phase === 'saved') clearDraft(recording.meta.sessionId);
    else if (hasDraftProgress(recording)) saveDraft(recording);
    else clearDraft(recording.meta.sessionId);
  }, [recording]);

  // 退出录入会话（保存完成或确认放弃）：清掉会话与草稿
  const exitSession = () => {
    if (recording) clearDraft(recording.meta.sessionId);
    recDispatch({ type: '@@RESET', recording: null });
    setDrafts(loadDrafts());
    setView('list');
    reload();
  };

  // 暂存并返回列表：草稿保留（不写数据库），之后可从列表「继续录入」
  const parkSession = () => {
    recDispatch({ type: '@@RESET', recording: null });
    setDrafts(loadDrafts());
    setView('list');
  };

  // 录入会话/草稿 → 服务端 games 载荷见模块级 gamesPayload；保存见 saveSeriesToDb
  const saveDraftToDb = async (d) => {
    if (!window.confirm(`将草稿中已录的 ${d.games.length} 局保存到数据库？\n未完成的本局不会保存，之后可在列表用「继续录入」补录。`)) return;
    try {
      await saveSeriesToDb(d.meta, gamesPayload(d));
      clearDraft(d.meta.sessionId);
      setDrafts(loadDrafts());
      reload();
    } catch (e) { alert(`保存失败：${e.message}`); }
  };

  const discardDraft = (d) => {
    if (!window.confirm(`确定放弃 ${d.meta.date} ${d.meta.team1.name} vs ${d.meta.team2.name} 的录入草稿？已录内容将丢失。`)) return;
    clearDraft(d.meta.sessionId);
    setDrafts(loadDrafts());
  };

  if (editGame && editRec) {
    return (
      <RecordEditSession
        rec={editRec}
        dispatch={editDispatch}
        heroesById={heroesById}
        series={editGame.series}
        game={editGame.game}
        onExit={() => { setEditGame(null); reload(); }}
      />
    );
  }

  if (view === 'recording' && recording) {
    return (
      <RecordSession
        rec={recording}
        dispatch={recDispatch}
        heroesById={heroesById}
        onExit={exitSession}
        onPark={parkSession}
      />
    );
  }

  if (view === 'form') {
    return (
      <RecordForm
        meta={meta}
        prefill={prefill}
        seriesList={seriesList}
        onCancel={() => setView('list')}
        onMetaChanged={reload}
        onStart={(rec) => {
          // 多草稿槽位：开新录入不影响已暂存的其他草稿
          recDispatch({ type: '@@RESET', recording: rec });
          setView('recording');
        }}
      />
    );
  }

  const t1Wins = (s) => s.games.filter((g) => (g.winner === 'blue' ? g.blue1 : !g.blue1)).length;

  return (
    <div className="page">
      <div className="page-head">
        <h2>比赛录入</h2>
        <button className="btn btn-gold" onClick={() => setView('form')}>＋ 新建系列赛录入</button>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {drafts.map((d) => (
        <DraftBanner
          key={d.meta.sessionId}
          draft={d}
          onResume={() => { recDispatch({ type: '@@RESET', recording: d }); setView('recording'); }}
          onSave={() => saveDraftToDb(d)}
          onDiscard={() => discardDraft(d)}
        />
      ))}

      {seriesList && seriesList.length === 0 && !error && (
        <div className="panel empty-hint">
          还没有录入数据。点击右上角“新建系列赛录入”，按真实 BP 顺序点一遍即可完成一局的记录
          （Ban 顺序、选人楼层、选手-英雄对应关系都会自动保存）。
        </div>
      )}

      {seriesList && seriesList.length > 0 && (
        <div className="panel table-wrap">
          <div className="filter-inline" style={{ marginBottom: 10 }}>
            <span className="filter-label">赛事</span>
            <select value={listEventId} onChange={(e) => setListEventId(e.target.value)}>
              <option value="all">全部赛事（{seriesList.length} 场）</option>
              {meta?.events?.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.name}（{seriesList.filter((s) => s.eventId === e.id).length} 场）
                </option>
              ))}
            </select>
            <span className="dim" style={{ fontSize: 12 }}>默认显示当前赛事（最近有录入的赛事）</span>
          </div>
          {filteredSeries.length === 0 ? (
            <div className="empty-hint">该赛事暂无已录系列赛</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>日期</th><th>赛事</th><th>赛段</th><th>对阵</th><th>比分</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredSeries.map((s) => {
                const t1 = t1Wins(s);
                // 胜场未达标的系列赛（如误标胜者后比分 2:1 但 BO5 未结束）可继续补录
                const maxWin = Math.floor(s.bo / 2) + 1;
                const canContinue = s.games.length < s.bo && t1 < maxWin && (s.games.length - t1) < maxWin;
                return (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td>{s.event}</td>
                    <td>{s.stage}</td>
                    <td className="vs-cell">
                      <span className="t t-blue">{s.team1.name}</span>
                      <span className="vs-x">vs</span>
                      <span className="t t-red">{s.team2.name}</span>
                      {s.note && <div className="series-note" title={s.note}>📝 {s.note}</div>}
                    </td>
                    <td className="score-cell">
                      {/* 达到胜场数（maxWin）才金色突出，领先但未夺标不亮 */}
                      <span className={`score-win ${t1 >= maxWin ? 'on' : ''}`}>{t1}</span>
                      <span className="score-sep"> : </span>
                      <span className={`score-win ${(s.games.length - t1) >= maxWin ? 'on' : ''}`}>{s.games.length - t1}</span>
                      <span className="dim" style={{ fontSize: 11 }}> BO{s.bo}</span>
                    </td>
                    <td className="op-cell">
                      {canContinue && (
                        (() => {
                          // 该系列赛已有暂存草稿时，行上的「继续录入」直接恢复草稿（含未录完的局），
                          // 不再从数据库状态新建会话，避免同一系列出现两份草稿
                          const parked = drafts.find((d) => d.meta.continueSeriesId === s.id);
                          return (
                            <button
                              className="btn btn-blue btn-sm"
                              title={parked
                                ? '该系列赛有未完成的录入草稿，将从中断处继续（含未录完的局）'
                                : '在该系列赛上补录后续小局'}
                              onClick={() => {
                                recDispatch({ type: '@@RESET', recording: parked || createContinueRecording(s) });
                                setView('recording');
                              }}
                            >
                              继续录入
                            </button>
                          );
                        })()
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setReplay(s)}>回放</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>编辑</button>
                      <button
                        className="btn btn-ghost btn-sm danger"
                        onClick={async () => {
                          if (!window.confirm(`确定删除 ${s.date} ${s.team1.name} vs ${s.team2.name} 的整场系列赛？`)) return;
                          try { await api.deleteSeries(s.id); reload(); } catch (e) { alert(e.message); }
                        }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {replay && (
        <ReplayModal
          series={replay}
          heroesById={heroesById}
          onClose={() => setReplay(null)}
          onChanged={reload}
          onEdit={(g) => {
            editDispatch({ type: '@@RESET', recording: createEditRecording(replay, g) });
            setEditGame({ series: replay, game: g });
            setReplay(null);
          }}
        />
      )}
      {editing && (
        <SeriesEditModal
          meta={meta}
          series={editing}
          onDone={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

/* ================= 系列赛元数据编辑（不可改战队与选手：换人走回放「编辑BP→更换选手」） ================= */
function SeriesEditModal({ meta, series, onDone }) {
  useEscape(onDone);
  const [eventId, setEventId] = useState(series.eventId);
  const [stage, setStage] = useState(series.stage);
  const [date, setDate] = useState(series.date);
  const [note, setNote] = useState(series.note || '');
  const [err, setErr] = useState('');

  if (!meta) return null;
  const save = async () => {
    try {
      await api.updateSeries(series.id, { eventId: Number(eventId), stage, date, note });
      onDone();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal-mask" onClick={onDone}>
      <div className="modal modal-replay" onClick={(e) => e.stopPropagation()}>
        <div className="replay-head">
          <h3>编辑系列赛信息</h3>
          <button className="btn btn-ghost btn-sm" onClick={onDone}>关闭</button>
        </div>
        <div className="edit-teams-line">
          <span className="t t-blue">{series.team1.name}</span>
          <span className="vs-x">vs</span>
          <span className="t t-red">{series.team2.name}</span>
          <span className="dim" style={{ fontSize: 11 }}>（对阵与选手不可在此修改；换人请用回放里的「编辑BP → 更换选手」）</span>
        </div>
        <div className="setup-row">
          <span className="setup-label">赛事</span>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {meta.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <span className="setup-label">赛段</span>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGE_PRESETS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <span className="setup-label">日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="setup-row">
          <span className="setup-label">备注</span>
          <input style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
        </div>
        {err && <div className="error-banner">{err}</div>}
        <div className="overlay-actions">
          <button className="btn btn-gold" onClick={save}>保存</button>
          <button className="btn btn-ghost" onClick={onDone}>取消</button>
        </div>
        <div className="empty-hint">
          BP 内容如需修改：在列表点「回放」打开对应局，点该局「编辑BP」即可修改 BP、更换选手或改判胜者；
          比分未达标的系列赛还可在列表「继续录入」补录后续局。
        </div>
      </div>
    </div>
  );
}

/* ================= 新建录入表单 ================= */
// 本地日期 YYYY-MM-DD（勿用 toISOString——那是 UTC，北京时间 0-8 点会取到昨天）
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function RecordForm({ meta, prefill, seriesList, onCancel, onStart, onMetaChanged }) {
  // 默认带上一次录入的赛事/赛段/日期/赛制，减少重复选择；
  // 赛事优先取"当前赛事"（最近有录入的），避免新赛季开赛后仍停在旧赛事
  const [prefs] = useState(loadPrefs);
  const [eventId, setEventId] = useState(
    prefill?.eventId
    || (meta?.currentEventId != null ? String(meta.currentEventId) : '')
    || prefs.eventId
    || ''
  );
  const [stage, setStage] = useState(prefill?.stage || prefs.stage || '常规赛');
  const [date, setDate] = useState(prefill?.date || prefs.date || todayLocal());
  const [bo, setBo] = useState(prefill?.bo || prefs.bo || 7);
  const [note, setNote] = useState(prefill?.note || '');
  const [team1Id, setTeam1Id] = useState(prefill?.team1Id || '');
  const [team2Id, setTeam2Id] = useState(prefill?.team2Id || '');
  const [roster1, setRoster1] = useState([...(prefill?.roster1 || ['', '', '', '', ''])]);
  const [roster2, setRoster2] = useState([...(prefill?.roster2 || ['', '', '', '', ''])]);
  const [err, setErr] = useState('');
  // 当前赛事下各战队的大名单（点选首发用）
  const [rosters, setRosters] = useState([]);
  // 本赛事的参赛战队（null=未设置，视为全部战队）
  const [eventTeamIds, setEventTeamIds] = useState(null);
  // 大名单点选状态：当前聚焦的位置框（覆盖目标）与操作提示
  const [activeSlot, setActiveSlot] = useState(null); // {which, i}
  const [pickHint, setPickHint] = useState(null); // { which: 1|2, text } 操作提示（只显示在对应战队一侧）
  useEffect(() => {
    if (!eventId) { setRosters([]); setEventTeamIds(null); return; }
    api.rosters(Number(eventId)).then(setRosters).catch(() => setRosters([]));
    api.eventTeams(Number(eventId)).then((ids) => setEventTeamIds(ids.length ? ids : null)).catch(() => setEventTeamIds(null));
  }, [eventId]);
  // 切到有参赛名单的赛事后，已选战队若不在名单中则清掉（与 pickTeam 清残留同口径，避免旧赛事带过来的选择漏过校验）
  useEffect(() => {
    const stale = (id) => id && eventTeamIds && !eventTeamIds.includes(Number(id));
    if (stale(team1Id)) { setTeam1Id(''); setRoster1(Array.from({ length: 5 }, () => '')); }
    if (stale(team2Id)) { setTeam2Id(''); setRoster2(Array.from({ length: 5 }, () => '')); }
  }, [eventTeamIds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta) return <div className="panel empty-hint">加载基础数据…</div>;

  // 录入前置条件：本赛事所有参赛战队（未设置参赛战队时=全部战队）都登记了大名单才可录入
  const rosterMissing = useMemo(() => {
    if (!eventId) return [];
    const required = eventTeamIds ? meta.teams.filter((t) => eventTeamIds.includes(t.id)) : meta.teams;
    const has = new Set(rosters.map((r) => r.teamId));
    return required.filter((t) => !has.has(t.id));
  }, [meta, eventId, eventTeamIds, rosters]);
  const missingNames = rosterMissing.slice(0, 3).map((t) => t.name).join('、') + (rosterMissing.length > 3 ? ` 等 ${rosterMissing.length} 支` : '');
  // 选队下拉只列本赛事参赛战队（未设置参赛战队时=全部战队）
  const pickableTeams = eventTeamIds ? meta.teams.filter((t) => eventTeamIds.includes(t.id)) : meta.teams;

  const promptAdd = async () => {
    const input = window.prompt('输入新赛事名称，如：2026KPL夏季赛');
    if (!input) return;
    try {
      await api.addEvent(input.trim());
      await onMetaChanged();
    } catch (e) { alert(e.message); }
  };

  const rosterInputs = (which) => {
    const roster = which === 1 ? roster1 : roster2;
    const setter = which === 1 ? setRoster1 : setRoster2;
    const bigList = bigRoster(which);
    return roster.map((v, i) => (
      <div className="setup-player" key={i}>
        <span className={`lane-badge ${LANE_BADGES[i].cls}`} title={LANE_BADGES[i].full}>{LANE_BADGES[i].text}</span>
        <input
          value={v}
          maxLength={12}
          list="player-names"
          placeholder={DEFAULT_PLAYERS[i]}
          className={activeSlot?.which === which && activeSlot.i === i ? 'slot-active' : ''}
          onFocus={() => setActiveSlot({ which, i })}
          onChange={(e) => { const next = [...roster]; next[i] = e.target.value; setter(next); }}
        />
        {bigList && (
          <select
            className="slot-select"
            value=""
            title="从大名单中直接替换该位置"
            onChange={(e) => { const n = e.target.value; if (!n) return; const next = [...roster]; next[i] = n; setter(next); setPickHint({ which, text: `位置 ${i + 1} 已选为 ${n}` }); }}
          >
            <option value="">替换…</option>
            {bigList.map((p) => {
              const usedElsewhere = roster.some((x, idx) => idx !== i && x.trim() === p);
              return <option key={p} value={p} disabled={usedElsewhere}>{usedElsewhere ? `${p}（已入选）` : p}</option>;
            })}
          </select>
        )}
      </div>
    ));
  };

  const bigRoster = (which) => {
    const teamId = which === 1 ? team1Id : team2Id;
    if (!teamId) return null;
    return rosters.find((r) => r.teamId === Number(teamId))?.players || null;
  };
  const fillStarters = (which, list) => {
    const next = Array.from({ length: 5 }, (_, i) => list[i] ?? '');
    (which === 1 ? setRoster1 : setRoster2)(next);
  };
  // 选定战队后自动填入该队最近一场的首发（无历史则清空，避免残留上一队选手）
  const pickTeam = (which, id) => {
    (which === 1 ? setTeam1Id : setTeam2Id)(id);
    const setter = which === 1 ? setRoster1 : setRoster2;
    const L = lastLineup(id);
    if (L) {
      setter([...L.roster]);
      setPickHint({ which, text: `已自动填入 ${L.date} 那场的首发，可继续手动调整` });
    } else {
      setter(Array.from({ length: 5 }, () => ''));
      setPickHint(null);
    }
  };
  const pickPlayer = (which, name) => {
    const raw = which === 1 ? roster1 : roster2;
    const setter = which === 1 ? setRoster1 : setRoster2;
    const names = raw.map((x) => x.trim());
    const usedIdx = names.indexOf(name);
    if (usedIdx !== -1) {
      // 点已选中的选手 = 移出该位置
      const next = [...raw]; next[usedIdx] = '';
      setter(next);
      setPickHint({ which, text: `已移出 ${name}（位置 ${usedIdx + 1} 现为空）` });
      return;
    }
    // 先点过某个位置框（高亮）时，直接覆盖该位置
    if (activeSlot && activeSlot.which === which) {
      const next = [...raw]; next[activeSlot.i] = name;
      setter(next);
      setPickHint({ which, text: `位置 ${activeSlot.i + 1} 已覆盖为 ${name}` });
      return;
    }
    const empty = names.findIndex((x) => !x);
    if (empty !== -1) {
      const next = [...raw]; next[empty] = name;
      setter(next);
      setPickHint(null);
      return;
    }
    setPickHint({ which, text: '五个位置已满：先点击要替换的位置框（高亮），再点选手名即可覆盖' });
  };

  const start = () => {
    const t1 = meta.teams.find((t) => t.id === Number(team1Id));
    const t2 = meta.teams.find((t) => t.id === Number(team2Id));
    const ev = meta.events.find((e) => e.id === Number(eventId));
    if (!ev) return setErr('请选择或创建赛事');
    if (rosterMissing.length > 0) return setErr(`本赛事还有 ${rosterMissing.length} 支战队未登记大名单（${missingNames}），请先在「大名单」页完成登记后再录入`);
    if (!t1 || !t2) return setErr('请选择两支战队');
    if (t1.id === t2.id) return setErr('两队不能相同');
    if (roster1.some((x) => !x.trim()) || roster2.some((x) => !x.trim())) return setErr('请填满双方 5 名出场选手');
    // 同队重名会让选手归属/整队锁定全部错位（indexOf 恒命中首个槽位），前后端一致拦截
    if (new Set(roster1.map((x) => x.trim())).size !== 5) return setErr(`${t1.name} 存在重复选手`);
    if (new Set(roster2.map((x) => x.trim())).size !== 5) return setErr(`${t2.name} 存在重复选手`);
    savePrefs({ eventId: ev.id, stage, date, bo });
    onStart(createRecording({
      eventId: ev.id, stage, date, bo,
      team1: { id: t1.id, name: t1.name }, team2: { id: t2.id, name: t2.name },
      roster1: roster1.map((x) => x.trim()), roster2: roster2.map((x) => x.trim()),
      note: note.trim(),
      scheduleId: prefill?.scheduleId || null,
    }));
  };

  // 某战队最近一场已录比赛的首发阵容（含逐局换人时的最终局阵容）
  const lastLineup = (teamId) => {
    if (!seriesList || !teamId) return null;
    const latest = [...seriesList]
      .filter((s) => s.team1.id === teamId || s.team2.id === teamId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
    if (!latest) return null;
    const isTeam1 = latest.team1.id === teamId;
    const lastGame = latest.games[latest.games.length - 1];
    const roster = isTeam1
      ? (lastGame?.roster1 || latest.roster1)
      : (lastGame?.roster2 || latest.roster2);
    return Array.isArray(roster) && roster.length === 5 && roster.every((x) => x) ? { roster, date: latest.date } : null;
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>新建系列赛录入</h2>
        <button className="btn btn-ghost" onClick={onCancel}>← 返回列表</button>
      </div>
      <div className="panel form-panel">
        <datalist id="player-names">
          {meta.players.map((p) => <option key={p.id} value={p.name} />)}
        </datalist>

        <div className="setup-row">
          <span className="setup-label">赛事</span>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">请选择…</option>
            {meta.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => promptAdd()}>＋新建赛事</button>
        </div>

        <div className="setup-row">
          <span className="setup-label">赛段</span>
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGE_PRESETS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <span className="setup-label">日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="setup-label">赛制</span>
          {[3, 5, 7].map((b) => (
            <button key={b} className={`chip chip-lg ${bo === b ? 'on' : ''}`} onClick={() => setBo(b)}>BO{b}</button>
          ))}
        </div>

        <div className="setup-row">
          <span className="setup-label">备注</span>
          <input
            style={{ flex: 1 }}
            value={note}
            maxLength={120}
            placeholder="可选：如「第一轮」「第1轮」「季后赛」「bo7 打满」等，保存后显示在列表对阵下方"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="setup-teams">
          <div className={`panel setup-team team-blue`}>
            <TeamPicker teams={pickableTeams} value={team1Id} onChange={(id) => pickTeam(1, id)} placeholder="搜索战队1（首局执蓝）…" />
            <RosterQuick
              list={bigRoster(1)}
              used={roster1.map((x) => x.trim())}
              onPick={(n) => pickPlayer(1, n)}
              hint={pickHint?.which === 1 ? pickHint.text : ''}
            />
            <div className="roster-title">
              <span>出场阵容（按位置 1-5 顺序）</span>
              <span className="roster-title-actions">
                {bigRoster(1) && (
                  <button
                    className="btn btn-blue btn-sm"
                    title="按大名单的位置顺序填入前五名选手"
                    onClick={() => { fillStarters(1, bigRoster(1)); setPickHint(null); }}
                  >
                    填入前五首发
                  </button>
                )}
                {lastLineup(meta.teams.find((t) => t.id === Number(team1Id))?.id) && (
                  <button
                    className="btn btn-gold btn-sm"
                    title="填入该战队最近一场已录比赛的首发阵容"
                    onClick={() => { const L = lastLineup(meta.teams.find((t) => t.id === Number(team1Id))?.id); if (L) { setRoster1([...L.roster]); setPickHint({ which: 1, text: `已填入 ${L.date} 那场的首发` }); } }}
                  >
                    上一场首发
                  </button>
                )}
              </span>
            </div>
            {rosterInputs(1)}
          </div>
          <div className="setup-vs">VS</div>
          <div className={`panel setup-team team-red`}>
            <TeamPicker teams={pickableTeams} value={team2Id} onChange={(id) => pickTeam(2, id)} placeholder="搜索战队2…" />
            <RosterQuick
              list={bigRoster(2)}
              used={roster2.map((x) => x.trim())}
              onPick={(n) => pickPlayer(2, n)}
              hint={pickHint?.which === 2 ? pickHint.text : ''}
            />
            <div className="roster-title">
              <span>出场阵容（按位置 1-5 顺序）</span>
              <span className="roster-title-actions">
                {bigRoster(2) && (
                  <button
                    className="btn btn-blue btn-sm"
                    title="按大名单的位置顺序填入前五名选手"
                    onClick={() => { fillStarters(2, bigRoster(2)); setPickHint(null); }}
                  >
                    填入前五首发
                  </button>
                )}
                {lastLineup(meta.teams.find((t) => t.id === Number(team2Id))?.id) && (
                  <button
                    className="btn btn-gold btn-sm"
                    title="填入该战队最近一场已录比赛的首发阵容"
                    onClick={() => { const L = lastLineup(meta.teams.find((t) => t.id === Number(team2Id))?.id); if (L) { setRoster2([...L.roster]); setPickHint({ which: 2, text: `已填入 ${L.date} 那场的首发` }); } }}
                  >
                    上一场首发
                  </button>
                )}
              </span>
            </div>
            {rosterInputs(2)}
          </div>
        </div>

        {eventId && rosterMissing.length > 0 && (
          <div className="error-banner" title="录入前置条件：本赛事全部参赛战队都登记大名单">
            本赛事还有 <b>{rosterMissing.length}</b> 支战队未登记大名单（{missingNames}），
            完成登记前无法开始录入——请到「大名单」页{eventTeamIds ? '' : '（可先点「参赛战队」确定参赛队伍）'}完成登记
          </div>
        )}
        {err && <div className="error-banner">{err}</div>}
        <button
          className="btn btn-gold btn-lg"
          disabled={!!eventId && rosterMissing.length > 0}
          title={eventId && rosterMissing.length > 0
            ? `还有 ${rosterMissing.length} 支战队未登记大名单（${missingNames}），先到「大名单」页登记`
            : '按真实 BP 顺序操作'}
          onClick={start}
        >
          开始录入（按真实 BP 顺序操作）
        </button>
      </div>
    </div>
  );
}

/* 大名单点选区：选定战队且有登记名单时显示 */
function RosterQuick({ list, used, onPick, hint }) {
  if (!list) return null;
  return (
    <div className="roster-quick">
      <div className="roster-quick-head">
        <span className="dim">点选手名填空位 · 点已选名移出 · 先点位置框再点选手名覆盖该位置</span>
      </div>
      <div className="chip-list">
        {list.map((p) => {
          const isUsed = used.includes(p);
          return (
            <button
              key={p}
              className={`chip roster-pick ${isUsed ? 'used' : ''}`}
              title={isUsed ? '已入选 · 点击移出' : '点击选入'}
              onClick={() => onPick(p)}
            >
              {p}
            </button>
          );
        })}
      </div>
      {hint && <div className="pick-hint">{hint}</div>}
    </div>
  );
}

/* 列表页的未完成草稿卡：可继续录入、把已录局保存入库或放弃 */
function DraftBanner({ draft: d, onResume, onSave, onDiscard }) {
  return (
    <div className="panel draft-banner">
      <div className="draft-banner-info">
        <b>未完成的录入草稿</b>
        <span className="draft-banner-meta">
          {d.meta.date} · {d.meta.stage} · {d.meta.team1.name} vs {d.meta.team2.name}
          （BO{d.meta.bo}，
          {d.phase === 'done'
            ? `${d.games.length} 局已录完，待保存入库`
            : `已录 ${d.games.length} 局${d.current && d.current.actions.length > 0 ? `，第 ${d.games.length + 1} 局进行中（已点 ${d.current.actions.length} 步）` : ''}`}）
        </span>
      </div>
      <div className="draft-banner-actions">
        <button className="btn btn-gold" onClick={onResume}>继续录入</button>
        {d.games.length > 0 && (
          <button
            className="btn btn-blue"
            title="把已完成的对局保存到数据库；之后可在列表用「继续录入」补录剩余小局"
            onClick={onSave}
          >
            保存 {d.games.length} 局入库
          </button>
        )}
        <button className="btn btn-ghost danger" onClick={onDiscard}>放弃草稿</button>
      </div>
    </div>
  );
}

/* ================= 录入会话 ================= */
function RecordSession({ rec, dispatch, heroesById, onExit, onPark }) {
  const viewState = useMemo(() => (rec?.current ? toViewState(rec) : null), [rec]);
  const [saveErr, setSaveErr] = useState('');
  const [rosterEdit, setRosterEdit] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!rec) return null;
  const { meta } = rec;
  const cur = rec.current;
  const w1 = teamWins(rec.games, 1);
  const w2 = teamWins(rec.games, 2);

  const doSave = async () => {
    setSaving(true); setSaveErr('');
    try {
      await saveSeriesToDb(meta, gamesPayload(rec));
      dispatch({ type: 'SAVED' });
    } catch (e) {
      setSaveErr(`保存失败：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 部分保存：把已完成的对局入库并结束本场录入（本局未完成部分不保存），列表可「继续录入」补录
  const savePartial = async () => {
    if (rec.games.length === 0) return;
    const unfinished = cur && cur.actions.length > 0
      ? `\n当前第 ${rec.games.length + 1} 局已点 ${cur.actions.length} 步，未完成的部分不会保存。`
      : '';
    if (!window.confirm(`将已完成的 ${rec.games.length} 局保存到数据库？${unfinished}\n保存后本场录入结束，之后可在列表用「继续录入」补录。`)) return;
    await doSave();
  };

  if (rec.phase === 'saved') {
    const complete = Math.max(w1, w2) >= winsNeeded(meta.bo);
    return (
      <div className="page">
        <div className="panel saved-panel">
          <div className="champion-star">✓</div>
          <h3>已保存到数据库</h3>
          <p>{meta.date} · {meta.team1.name} {w1} : {w2} {meta.team2.name}</p>
          {!complete && (
            <p className="dim" style={{ fontSize: 13 }}>
              本场尚未录满（BO{meta.bo} 已录 {rec.games.length} 局）：在列表点「继续录入」可补录后续小局
            </p>
          )}
          <button className="btn btn-gold" onClick={onExit}>返回列表</button>
        </div>
      </div>
    );
  }

  if (rec.phase === 'done') {
    return (
      <div className="page">
        <div className="page-head"><h2>录入完成，确认保存</h2></div>
        <div className="panel rec-summary">
          <div className="final-score">
            {meta.team1.name} {w1} : {w2} {meta.team2.name}
            <span className="final-bo">（BO{meta.bo}，共 {rec.games.length} 局）</span>
          </div>
          {saveErr && <div className="error-banner">{saveErr}</div>}
          <div className="overlay-actions">
            <button className="btn btn-gold btn-lg" disabled={saving} onClick={doSave}>
              {saving ? '保存中…' : '保存到数据库'}
            </button>
            <button
              className="btn btn-ghost"
              disabled={saving}
              title="退回上一局，重新标记胜者"
              onClick={() => dispatch({ type: 'UNDO_LAST_GAME' })}
            >
              撤销上一局（改判胜者）
            </button>
            <button className="btn btn-ghost" onClick={onExit}>放弃不保存</button>
          </div>
        </div>
        <div className="panel replay-list">
          <div className="panel-title">本场 BP 预览</div>
          {rec.games.map((g, i) => (
            <ReplayGame
              key={i}
              gameNo={i + 1}
              game={{ blind: g.blind, winner: g.winner, blue1: g.blueFirst === 1, draft: g.actions, roster1: g.roster1, roster2: g.roster2 }}
              series={{ team1: meta.team1, team2: meta.team2, roster1: meta.roster1, roster2: meta.roster2 }}
              heroesById={heroesById}
            />
          ))}
        </div>
      </div>
    );
  }

  const blueBtn = (teamIdx) => (
    <button
      key={teamIdx}
      className={`chip chip-lg ${cur.blueFirst === teamIdx ? 'on' : ''}`}
      onClick={() => {
        if (cur.blueFirst === teamIdx) return;
        // 换向后已选英雄会归属另一队，先检查是否撞上该队的历史已用英雄（整队锁定）
        const bad = blueFlipConflicts(rec, teamIdx);
        if (bad.length > 0) {
          alert(`无法把本局蓝方改为 ${meta[`team${teamIdx}`].name}：换向后已选的 ${bad.map((a) => heroesById[a.hero]?.name ?? a.hero).join('、')} 与该队本系列赛已用英雄冲突（全局 BP 整队锁定）`);
          return;
        }
        if (cur.actions.length > 0 && !window.confirm(
          `本局已点 ${cur.actions.length} 步。确定把本局蓝方改为 ${meta[`team${teamIdx}`].name}？\n已点的 Ban/Pick 步骤保持不变，已选英雄对应的选手可能需要撤销后重点。`
        )) return;
        dispatch({ type: 'SET_BLUE', team: teamIdx });
      }}
    >
      {meta[`team${teamIdx}`].name}
    </button>
  );

  const toolbar = (
    <div className="panel rec-toolbar">
      <span className="rec-hint">
        {meta.continueSeriesId ? '继续录入：' : '正在录入：'}{meta.date} · {meta.team1.name} vs {meta.team2.name} · 第 {rec.games.length + 1} 局
      </span>
      <span className="rec-hint-dim">草稿自动保存 · 意外关闭可从列表继续</span>
      <span className="setup-label">本局蓝方</span>
      {blueBtn(1)}
      {blueBtn(2)}
      <span className="toolbar-right">
        <button
          className="btn btn-blue"
          disabled={rec.games.length === 0 || saving}
          title={rec.games.length === 0
            ? '至少完整录入一局后才能保存'
            : '把已完成的对局保存到数据库并结束本场录入；之后可在列表「继续录入」补录'}
          onClick={savePartial}
        >
          保存已录 {rec.games.length} 局
        </button>
        <button
          className="btn btn-ghost"
          title="保留草稿返回列表（不写数据库），之后可从列表继续本场录入"
          onClick={onPark}
        >
          暂存并返回
        </button>
        <button className="btn btn-ghost" onClick={() => setRosterEdit(true)}>更换选手</button>
        <button className="btn btn-ghost" disabled={cur.actions.length === 0} onClick={() => dispatch({ type: 'UNDO' })}>撤销上一步</button>
        <button
          className="btn btn-ghost"
          onClick={() => { if (window.confirm('清空本局 BP 重新录入？')) dispatch({ type: 'RESTART_GAME' }); }}
        >
          重做本局
        </button>
        <button
          className="btn btn-ghost"
          title="随机补全本局剩余 Ban/Pick（测试辅助，规则校验与手动操作一致；胜者仍需手动标记）"
          onClick={() => dispatch({ type: 'QUICK_COMPLETE' })}
        >
          快速完成本局
        </button>
        <button className="btn btn-ghost" onClick={() => { if (window.confirm('放弃本场录入？已录内容不会保存')) onExit(); }}>
          放弃录入
        </button>
      </span>
    </div>
  );

  return (
    <>
      {rosterEdit && (
        <GameRosterModal
          rec={rec}
          heroesById={heroesById}
          onClose={() => setRosterEdit(false)}
          onSave={({ roster1, roster2, changed }) => {
            if (changed.includes(1)) dispatch({ type: 'SET_GAME_ROSTER', team: 1, roster: roster1 });
            if (changed.includes(2)) dispatch({ type: 'SET_GAME_ROSTER', team: 2, roster: roster2 });
            setRosterEdit(false);
          }}
        />
      )}
      {saveErr && <div className="error-banner">{saveErr}</div>}
      <DraftCenter state={viewState} dispatch={dispatch} heroesById={heroesById} toolbar={toolbar} />
    </>
  );
}

/* 本局更换选手：按位置替换双方出场选手（默认列出该队大名单，可手填；换人后校验全局锁定） */
function GameRosterModal({ rec, heroesById, onClose, onSave }) {
  useEscape(onClose);
  const { meta } = rec;
  const [r1, setR1] = useState(() => [...curRosterOf(rec, 1)]);
  const [r2, setR2] = useState(() => [...curRosterOf(rec, 2)]);
  const [big, setBig] = useState({}); // teamId -> 大名单选手名
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api.rosters(meta.eventId)
      .then((list) => { if (alive) setBig(Object.fromEntries(list.map((r) => [r.teamId, r.players]))); })
      .catch(() => { if (alive) setBig({}); });
    return () => { alive = false; };
  }, [meta.eventId]);

  const conflicts = useMemo(() => rosterLockConflicts(rec, r1, r2), [rec, r1, r2]);

  const teams = [
    { team: 1, name: meta.team1.name, id: meta.team1.id, roster: r1, set: setR1 },
    { team: 2, name: meta.team2.name, id: meta.team2.id, roster: r2, set: setR2 },
  ];

  // 有大名单：下拉选（当前姓名不在名单时补进选项）；无大名单：返回空列表 → 渲染文本框手填
  const optionsFor = (t, name) => {
    const list = big[t.id] || [];
    return list.length > 0 && name && !list.includes(name) ? [...list, name] : list;
  };

  const save = () => {
    for (const t of teams) {
      const names = t.roster.map((x) => String(x).trim());
      if (names.some((n) => !n)) return setErr(`请填满 ${t.name} 的 5 个位置`);
      if (new Set(names).size !== 5) return setErr(`${t.name} 存在重复选手`);
    }
    if (conflicts.length > 0) return setErr('换人后与本系列赛已用英雄（全局 BP 锁定）冲突，请调整');
    const changed = teams.filter((t) => t.roster.join('\u0001') !== [...curRosterOf(rec, t.team)].join('\u0001'));
    if (changed.length === 0) return onClose();
    onSave({ roster1: r1, roster2: r2, changed: changed.map((t) => t.team) });
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-wide modal-scroll" onClick={(e) => e.stopPropagation()}>
        <div className="replay-head">
          <h3>本局出场选手（第 {rec.games.length + 1} 局）</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>关闭</button>
        </div>
        <div className="roster-edit-hint">
          已选英雄按位置保留；换人后该位置的英雄归属新选手（用于选手统计与全局 BP 锁定）
        </div>
        <div className="two-col">
          {teams.map((t) => (
            <div key={t.team}>
              <div className={`history-team-name ${t.team === 1 ? 'ht-blue' : 'ht-red'}`}>{t.name}</div>
              {t.roster.map((name, i) => (
                <div className="setup-player" key={i}>
                  <span className={`lane-badge ${LANE_BADGES[i].cls}`} title={LANE_BADGES[i].full}>{LANE_BADGES[i].text}</span>
                  {optionsFor(t, name).length > 0 ? (
                    <select
                      value={name}
                      onChange={(e) => { const n = [...t.roster]; n[i] = e.target.value; t.set(n); }}
                    >
                      {optionsFor(t, name).map((p) => (
                        <option key={p} value={p} disabled={t.roster.some((x, idx) => idx !== i && x === p)}>
                          {t.roster.some((x, idx) => idx !== i && x === p) ? `${p}（已在该队）` : p}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={name} maxLength={12} placeholder={DEFAULT_PLAYERS[i]}
                      onChange={(e) => { const n = [...t.roster]; n[i] = e.target.value; t.set(n); }}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        {conflicts.length > 0 && (
          <div className="error-banner">
            与全局 BP 冲突：
            {conflicts.map((a, i) => (
              <span key={i}> {SIDE[a.side].label}·{a.player + 1}号位 已在本系列赛用过 {heroesById[a.hero]?.name ?? a.hero}；</span>
            ))}
          </div>
        )}
        {err && <div className="error-banner">{err}</div>}
        <div className="overlay-actions">
          <button className="btn btn-gold" onClick={save}>保存本局阵容</button>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

/* ================= 单局 BP 编辑（已录系列赛） ================= */
function RecordEditSession({ rec, dispatch, heroesById, series, game, onExit }) {
  const viewState = useMemo(
    () => (rec?.current ? { ...toViewState(rec), phase: 'editing' } : null),
    [rec],
  );
  const [saveErr, setSaveErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [rosterEdit, setRosterEdit] = useState(false);
  // 本局胜者（编辑时可改判）
  const [winner, setWinner] = useState(game.winner);

  // 是否有未保存的修改（BP/蓝红/胜者/本局阵容 任一变化）
  const hasChanges = useMemo(() => {
    const cur = rec?.current;
    if (!cur) return false;
    if (JSON.stringify(cur.actions) !== JSON.stringify(game.draft)) return true;
    if ((cur.blueFirst === 1) !== game.blue1) return true;
    if (winner !== game.winner) return true;
    if (JSON.stringify(curRosterOf(rec, 1)) !== JSON.stringify(game.roster1 ?? rec.meta.roster1)) return true;
    if (JSON.stringify(curRosterOf(rec, 2)) !== JSON.stringify(game.roster2 ?? rec.meta.roster2)) return true;
    return false;
  }, [rec, game, winner]);

  const exitEdit = () => {
    if (!hasChanges || window.confirm('放弃修改？未保存的调整将丢失')) onExit();
  };
  // Esc 退出（换人弹窗打开时让给它）
  useEscape(exitEdit, !rosterEdit);

  if (!rec || !rec.current) return null;
  const { meta } = rec;
  const cur = rec.current;
  const flowLen = getFlow(cur.blind).length;
  const complete = cur.actions.length === flowLen;
  const winnerChanged = winner !== game.winner;

  const save = async () => {
    if (cur.actions.length !== flowLen) { setSaveErr('本局 BP 未点完，无法保存'); return; }
    // 整体校验：BP 步骤或蓝红归属变化时，把本局放在整场系列赛（含本局之后的局）
    // 语境下重放——换向后撞锁定、与后续局重复英雄、流程非法都会在此拦截；
    // 仅改判胜者/换阵容不会引入 BP 违规，无需重放
    const bpChanged = JSON.stringify(cur.actions) !== JSON.stringify(game.draft)
      || (cur.blueFirst === 1) !== game.blue1;
    if (bpChanged) {
      const others = (series?.games || []).filter((g) => g.gameNo !== game.gameNo);
      const errs = editSaveConflicts(cur, others, (h) => heroesById[h]?.name ?? h);
      if (errs.length > 0) {
        setSaveErr(`无法保存：${errs[0]}${errs.length > 1 ? `（共 ${errs.length} 处）` : ''}`);
        return;
      }
    }
    setSaving(true); setSaveErr('');
    try {
      await api.updateGameDraft(game.id, {
        draft: cur.actions,
        blue1: cur.blueFirst === 1,
        blind: cur.blind,
        winner,
        roster1: curRosterOf(rec, 1),
        roster2: curRosterOf(rec, 2),
      });
      onExit();
    } catch (e) {
      setSaveErr(`保存失败：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const blueBtn = (teamIdx) => (
    <button
      key={teamIdx}
      className={`chip chip-lg ${cur.blueFirst === teamIdx ? 'on' : ''}`}
      onClick={() => {
        if (cur.blueFirst === teamIdx) return;
        // 换向后已选英雄会归属另一队，先检查是否撞上该队此前局的已用英雄（整队锁定）；
        // 与本局之后局的冲突会在「保存修改」时由整体校验拦截
        const bad = blueFlipConflicts(rec, teamIdx);
        if (bad.length > 0) {
          alert(`无法把本局蓝方改为 ${meta[`team${teamIdx}`].name}：换向后已选的 ${bad.map((a) => heroesById[a.hero]?.name ?? a.hero).join('、')} 与该队本系列赛已用英雄冲突（全局 BP 整队锁定）`);
          return;
        }
        if (cur.actions.length > 0 && !window.confirm(
          `本局已点 ${cur.actions.length} 步。确定把本局蓝方改为 ${meta[`team${teamIdx}`].name}？\n已点的 Ban/Pick 步骤保持不变，已选英雄对应的选手可能需要调整。`
        )) return;
        dispatch({ type: 'SET_BLUE', team: teamIdx });
      }}
    >
      {meta[`team${teamIdx}`].name}
    </button>
  );

  const toolbar = (
    <div className="panel rec-toolbar">
      <span className="rec-hint">
        编辑第 {game.gameNo} 局 BP：{meta.date} · {meta.team1.name} vs {meta.team2.name}
      </span>
      <span className="setup-label">本局蓝方</span>
      {blueBtn(1)}
      {blueBtn(2)}
      <span className="setup-label">胜方</span>
      <button
        className={`chip chip-lg ${winner === 'blue' ? 'on' : ''}`}
        title="本局胜者（改判后随「保存修改」一并写入）"
        onClick={() => setWinner('blue')}
      >
        {cur.blueFirst === 1 ? meta.team1.name : meta.team2.name}（蓝）
      </button>
      <button
        className={`chip chip-lg ${winner === 'red' ? 'on' : ''}`}
        title="本局胜者（改判后随「保存修改」一并写入）"
        onClick={() => setWinner('red')}
      >
        {cur.blueFirst === 1 ? meta.team2.name : meta.team1.name}（红）
      </button>
      <span className="toolbar-right">
        <button className="btn btn-ghost" onClick={() => setRosterEdit(true)}>更换选手</button>
        <button
          className="btn btn-gold"
          disabled={!complete || saving}
          title={complete ? '保存对这一局 BP 与胜者的修改' : '本局 BP 未点完'}
          onClick={save}
        >
          {saving ? '保存中…' : complete ? (winnerChanged ? '保存修改（含改判）' : '保存修改') : `还需 ${flowLen - cur.actions.length} 步`}
        </button>
        <button className="btn btn-ghost" disabled={cur.actions.length === 0} onClick={() => dispatch({ type: 'UNDO' })}>撤销上一步</button>
        <button
          className="btn btn-ghost"
          onClick={() => { if (window.confirm('清空本局 BP 重新录入？')) dispatch({ type: 'RESTART_GAME' }); }}
        >
          重做本局
        </button>
        <button
          className="btn btn-ghost"
          onClick={exitEdit}
        >
          放弃修改
        </button>
      </span>
    </div>
  );

  return (
    <>
      {rosterEdit && (
        <GameRosterModal
          rec={rec}
          heroesById={heroesById}
          onClose={() => setRosterEdit(false)}
          onSave={({ roster1, roster2, changed }) => {
            if (changed.includes(1)) dispatch({ type: 'SET_GAME_ROSTER', team: 1, roster: roster1 });
            if (changed.includes(2)) dispatch({ type: 'SET_GAME_ROSTER', team: 2, roster: roster2 });
            setRosterEdit(false);
          }}
        />
      )}
      {saveErr && <div className="error-banner">{saveErr}</div>}
      <DraftCenter
        state={viewState}
        dispatch={dispatch}
        heroesById={heroesById}
        toolbar={toolbar}
        donePrompt={complete ? 'BP 已完成 · 请选择本局胜者（上方「胜方」），再点「保存修改」' : undefined}
      />
    </>
  );
}

/* ================= 回放 ================= */
function ReplayModal({ series, heroesById, onClose, onChanged, onEdit }) {
  useEscape(onClose);
  const fixWinner = async (game, next) => {
    if (!window.confirm(`确认把第 ${game.gameNo} 局改判为${next === 'blue' ? '蓝方' : '红方'}获胜？`)) return;
    try {
      await api.updateGameWinner(game.id, next);
      await onChanged?.();
      onClose();
    } catch (e) { alert(e.message); }
  };

  // 换人计算：每局阵容与"上一局"实际阵容逐位对比（第 1 局对比系列赛首发）。
  // 每局的生效阵容 = 该局显式记录的阵容，null 回退系列赛阵容（写入语义，
  // 不得回退上一局——否则"换人后换回首发"的局会被当成沿用替补，漏标换人条）；
  // 对比基准滚动延续，只在实际发生更换的那局标注
  const gamesWithSubs = useMemo(() => {
    let cur1 = series.roster1;
    let cur2 = series.roster2;
    return series.games.map((g) => {
      const e1 = Array.isArray(g.roster1) ? g.roster1 : series.roster1;
      const e2 = Array.isArray(g.roster2) ? g.roster2 : series.roster2;
      const subs = [];
      for (const [teamIdx, eff, prev] of [[1, e1, cur1], [2, e2, cur2]]) {
        for (let i = 0; i < 5; i++) {
          if (eff[i] !== prev[i]) subs.push({ teamIdx, pos: i, out: prev[i], in: eff[i] });
        }
      }
      const item = { game: g, subs };
      cur1 = e1;
      cur2 = e2;
      return item;
    });
  }, [series]);

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-replay" onClick={(e) => e.stopPropagation()}>
        <div className="replay-head">
          <h3>{series.date} · {series.event} · {series.stage}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>关闭</button>
        </div>
        {series.note && (
          <div className="replay-note" title={series.note}>📝 备注：{series.note}</div>
        )}
        <div className="replay-body">
          {gamesWithSubs.map(({ game, subs }, i) => {
            const nodes = [];
            if (i > 0 && subs.length > 0) {
              nodes.push(<SubBar key={`sub-${i}`} subs={subs} series={series} gameNo={game.gameNo} />);
            }
            nodes.push(
              <ReplayGame
                key={game.id || i} gameNo={game.gameNo} game={game} series={series} heroesById={heroesById}
                onFix={game.id ? (next) => fixWinner(game, next) : undefined}
                onEdit={game.id ? onEdit : undefined}
              />
            );
            return nodes;
          })}
        </div>
      </div>
    </div>
  );
}

/** 局间换人条：标注该局相对上一局的出场选手更换（下 ↓ / 上 ↑） */
function SubBar({ subs, series, gameNo }) {
  const teamName = (idx) => (idx === 1 ? series.team1.name : series.team2.name);
  const groups = [1, 2]
    .map((idx) => ({ idx, list: subs.filter((s) => s.teamIdx === idx) }))
    .filter((g) => g.list.length > 0);
  return (
    <div className="sub-bar">
      <span className="sub-bar-label">⇄ 第 {gameNo} 局换人</span>
      {groups.map(({ idx, list }) => (
        <span className="sub-bar-team" key={idx}>
          <span className="sub-team-name">{teamName(idx)}</span>
          {list.map((s, i) => (
            <span className="sub-pair" key={i}
              title={`位置${s.pos + 1}（${LANE_BADGES[s.pos].full}）：${s.out} 换为 ${s.in}`}>
              <span className="sub-chip out"><b>下</b>{s.out}</span>
              <span className="sub-arrow">→</span>
              <span className="sub-chip in"><b>上</b>{s.in}</span>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

/** 回放单局：只展示最终 Ban / 阵容（按位置顺序，红方从右到左），不展示逐步顺序 */
function ReplayGame({ gameNo, game, series, heroesById, onFix, onEdit }) {
  const blueName = game.blue1 ? series.team1.name : series.team2.name;
  const redName = game.blue1 ? series.team2.name : series.team1.name;
  const winnerName = game.winner === 'blue' ? blueName : redName;
  const gRoster1 = Array.isArray(game.roster1) ? game.roster1 : series.roster1;
  const gRoster2 = Array.isArray(game.roster2) ? game.roster2 : series.roster2;
  const blueRoster = game.blue1 ? gRoster1 : gRoster2;
  const redRoster = game.blue1 ? gRoster2 : gRoster1;
  const bansOf = (side) => game.draft.filter((a) => a.type === 'ban' && a.side === side).map((a) => a.hero);
  const pickOf = (side, i) => game.draft.find((a) => a.type === 'pick' && a.side === side && a.player === i);

  const banRow = (side) => {
    const ids = bansOf(side);
    return (
      <div className={`ban-row br-${side}`}>
        <span className="ban-label">{side === 'blue' ? '蓝方' : '红方'}禁用</span>
        <div className="ban-list">
          {Array.from({ length: Math.max(5, ids.length) }, (_, i) => {
            const hero = ids[i] ? heroesById[ids[i]] : null;
            return hero ? (
              <span className="ban-chip" key={ids[i]} title={hero.name}>
                <HeroAvatar hero={hero} size={32} />
                <span className="ban-chip-name">{hero.name}</span>
              </span>
            ) : (
              <div className="ban-empty-slot" key={i} />
            );
          })}
        </div>
      </div>
    );
  };

  const teamCol = (side) => {
    const roster = side === 'blue' ? blueRoster : redRoster;
    return (
      <div className={`replay-team rt-${side}`}>
        <div className={`history-team-name ${side === 'blue' ? 'ht-blue' : 'ht-red'}`}>
          {side === 'blue' ? blueName : redName}（{side === 'blue' ? '蓝' : '红'}）
        </div>
        {[0, 1, 2, 3, 4].map((i) => {
          const pick = pickOf(side, i);
          const hero = pick && heroesById[pick.hero];
          return (
            <div className="replay-player-row" key={i}>
              <span className={`lane-badge ${LANE_BADGES[i].cls}`} title={LANE_BADGES[i].full}>{LANE_BADGES[i].text}</span>
              <span className="rp-player">{roster[i]}</span>
              {hero ? (
                <span className="rp-hero">
                  <HeroAvatar hero={hero} size={30} />
                  <span className="rp-hero-name">{hero.name}</span>
                </span>
              ) : (
                <span className="rp-empty">待定</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="replay-game">
      <div className="history-head">
        <span className={`winner-tag ${game.winner === 'blue' ? 'tag-blue' : 'tag-red'}`}>
          第 {gameNo} 局 · {winnerName} 胜
        </span>
        {game.blind && <span className="tag-blind">巅峰对决</span>}
        <span className="replay-sides">{blueName}（蓝）vs {redName}（红）</span>
        <span className="op-cell" style={{ marginLeft: 'auto' }}>
          {onEdit && (
            <button className="btn btn-ghost btn-sm" onClick={() => onEdit(game)}>编辑BP</button>
          )}
          {onFix && (
            <>
              <span className="dim" style={{ fontSize: 11 }}>改判：</span>
              <button className="btn btn-ghost btn-sm" disabled={game.winner === 'blue'} onClick={() => onFix('blue')}>蓝胜</button>
              <button className="btn btn-ghost btn-sm" disabled={game.winner === 'red'} onClick={() => onFix('red')}>红胜</button>
            </>
          )}
        </span>
      </div>
      {!game.blind && (
        <div className="replay-bans">
          {banRow('blue')}
          {banRow('red')}
        </div>
      )}
      <div className="replay-teams">
        {teamCol('blue')}
        {teamCol('red')}
      </div>
    </div>
  );
}
