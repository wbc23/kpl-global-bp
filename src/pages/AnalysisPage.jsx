import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import HeroAvatar from '../components/HeroAvatar.jsx';
import { heroMatch } from '../data/heroSearch.js';
import { LANE_BADGES } from '../data/constants.js';
import {
  flattenGames, filterGames, heroStats, teamStats, comboStats,
  overviewStats, PAIR_DEFS, pct,
  heroCounterScene, heroCounteredByScene, comboCounterScene,
  TRIO_DEFS, trioComboStats,
  globalComboStats, globalTrioStats, globalFiveStats,
  groupByMonth, heroShiftRows, comboShiftRows,
  groupByRound, ROUND_DEFS,
  allPlayerStats, allTeamStats, afterLossSideStats,
} from '../analysis/compute.js';

const TABS = [
  { key: 'overview', label: '总览' },
  { key: 'hero', label: '英雄分析' },
  { key: 'team', label: '战队分析' },
  { key: 'player', label: '选手分析' },
  { key: 'event', label: '赛事分析' },
];

export default function AnalysisPage({ heroesById }) {
  const [seriesList, setSeriesList] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [filters, setFilters] = useState({ eventId: '', stage: '', dateFrom: '', dateTo: '', teamId: '' });

  const load = async () => {
    try {
      setSeriesList(await api.series());
      setError('');
    } catch (e) {
      setError(`数据服务不可达：${e.message}`);
    }
  };
  useEffect(() => { load(); }, []);

  const allGames = useMemo(() => (seriesList ? flattenGames(seriesList) : []), [seriesList]);
  const games = useMemo(() => filterGames(allGames, filters), [allGames, filters]);

  // 打开页面默认筛选"当前赛事"（最近有录入的赛事）：seriesList 加载后一次性设定，
  // 之后用户切到"全部"或其它赛事不再干预
  const [autoEventSet, setAutoEventSet] = useState(false);
  useEffect(() => {
    if (!autoEventSet && seriesList) {
      setAutoEventSet(true);
      if (seriesList.length) {
        const s = [...seriesList].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
        setFilters((f) => (f.eventId === '' ? { ...f, eventId: String(s.eventId) } : f));
      }
    }
  }, [seriesList, autoEventSet]);

  const distinct = (arr) => [...new Set(arr)].sort();
  // 注意不能用 Set 去重 [id,name] 数组（引用不同去重失效），与战队下拉同样用 Map
  const eventOptions = useMemo(() => {
    const m = new Map();
    for (const g of allGames) m.set(g.eventId, g.event);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }, [allGames]);
  const stageOptions = distinct(allGames.map((g) => g.stage));
  const teamOptions = useMemo(() => {
    const m = new Map();
    for (const g of allGames) {
      m.set(g.blue.teamId, g.blue.teamName);
      m.set(g.red.teamId, g.red.teamName);
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }, [allGames]);

  const seriesCount = useMemo(
    () => new Set(games.map((g) => g.seriesId)).size,
    [games]
  );

  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page">
      <div className="page-head">
        <h2>数据分析</h2>
        <button className="btn btn-ghost btn-sm" onClick={load}>刷新数据</button>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {seriesList && allGames.length === 0 && !error && (
        <div className="panel empty-hint">
          暂无比赛数据。先到「比赛录入」录入几场系列赛，这里会自动生成英雄/战队/选手/组合分析。
        </div>
      )}

      {allGames.length > 0 && (
        <>
          <div className="panel filter-bar">
            <div className="filter-inline">
              <span className="filter-label">赛事</span>
              <select value={filters.eventId} onChange={setF('eventId')}>
                <option value="">全部</option>
                {eventOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <span className="filter-label">赛段</span>
              <select value={filters.stage} onChange={setF('stage')}>
                <option value="">全部</option>
                {stageOptions.map((s) => <option key={s}>{s}</option>)}
              </select>
              <span className="filter-label">日期</span>
              <input type="date" value={filters.dateFrom} onChange={setF('dateFrom')} />
              <span className="filter-label">至</span>
              <input type="date" value={filters.dateTo} onChange={setF('dateTo')} />
              <span className="filter-label">战队</span>
              <select value={filters.teamId} onChange={setF('teamId')}>
                <option value="">全部</option>
                {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ eventId: '', stage: '', dateFrom: '', dateTo: '', teamId: '' })}>清除</button>
            </div>
            <div className="sample-meta">当前样本：{seriesCount} 场系列赛 · {games.length} 局比赛</div>
          </div>

          <div className="tab-bar">
            {TABS.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>

          {tab === 'overview' && <OverviewTab games={games} seriesCount={seriesCount} heroesById={heroesById} />}
          {tab === 'hero' && <HeroTab games={games} heroesById={heroesById} />}
          {tab === 'team' && <TeamTab games={games} teams={teamOptions} heroesById={heroesById} />}
          {tab === 'player' && <PlayerTab games={games} heroesById={heroesById} />}
          {tab === 'event' && <EventTab games={games} allGames={allGames} heroesById={heroesById} />}
        </>
      )}
      <BackToTop />
    </div>
  );
}

/* ================= 通用小组件 ================= */

function HeroName({ heroesById, id, size = 28 }) {
  const h = heroesById[id];
  return (
    <span className="hero-name-cell">
      <HeroAvatar hero={h} size={size} />
      <span>{h?.name ?? `#${id}`}</span>
    </span>
  );
}

function WrBar({ value }) {
  const cls = value >= 60 ? 'good' : value >= 45 ? 'mid' : 'bad';
  return (
    <span className="wr-cell">
      <span className="wr-num">{value}%</span>
      <span className="wr-bar"><span className={`fill ${cls}`} style={{ width: `${Math.min(value, 100)}%` }} /></span>
    </span>
  );
}

function Th({ sort, sortKey, setSort, children, className = '', title = '' }) {
  const on = () => setSort({ key: sortKey, dir: sort.key === sortKey && sort.dir === 'desc' ? 'asc' : 'desc' });
  const arrow = sort.key === sortKey ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : '';
  return <th className={`sortable ${className}`} onClick={on} title={title}>{children}{arrow}</th>;
}

function useSort(defaultKey, defaultDir = 'desc') {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });
  // useCallback 稳定引用：否则每次渲染 apply 都是新函数，依赖它的排序 useMemo 会在
  // 任何按键（如搜索框输入）时把几百行数据重新排序一遍，造成卡顿
  const apply = useCallback((rows, keyFn) => {
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => (keyFn(a) > keyFn(b) ? dir : keyFn(a) < keyFn(b) ? -dir : 0));
  }, [sort]);
  return { sort, setSort, apply };
}

/** 区块折叠状态持久化：key 由标题派生（数字归一为 #，数据增减不影响），默认展开 */
const COLLAPSE_STORE = 'kpl-analysis-collapse';
const foldKeyOf = (title) => String(title).replace(/\d+/g, '#').slice(0, 60);

/** 回到顶部悬浮按钮：下滚超过一屏后出现。
 *  scroll 事件 + 轮询双保险：部分内嵌浏览器的程序化滚动不派发 scroll 事件 */
function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const check = () => setShow(window.scrollY > window.innerHeight * 0.8);
    window.addEventListener('scroll', check, { passive: true });
    const timer = setInterval(check, 400);
    return () => { window.removeEventListener('scroll', check); clearInterval(timer); };
  }, []);
  if (!show) return null;
  return (
    <button className="back-to-top" title="回到顶部" onClick={() => window.scrollTo(0, 0)}>↑</button>
  );
}

function Section({ title, children, extra }) {
  const foldKey = foldKeyOf(title);
  const [open, setOpen] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSE_STORE) || '{}');
      return saved[foldKey] !== false;
    } catch { return true; }
  });
  const toggle = () => setOpen((v) => {
    const next = !v;
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSE_STORE) || '{}');
      saved[foldKey] = next;
      localStorage.setItem(COLLAPSE_STORE, JSON.stringify(saved));
    } catch { /* 存储异常不影响折叠功能 */ }
    return next;
  });
  return (
    <div className={`panel section ${open ? '' : 'section-folded'}`}>
      <div className="section-head">
        <span className="panel-title section-fold-btn" onClick={toggle} title="点击折叠/展开该区块">
          <span className="fold-arrow">{open ? '▾' : '▸'}</span>
          {title}
        </span>
        {open && extra}
      </div>
      {open && children}
    </div>
  );
}

function ChipList({ countMap, heroesById }) {
  const rows = [...countMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (rows.length === 0) return <div className="empty-hint">暂无</div>;
  return (
    <div className="chip-list">
      {rows.map(([id, n]) => (
        <span className="stat-chip" key={id}>
          <HeroAvatar hero={heroesById[Number(id)]} size={20} />
          {heroesById[Number(id)]?.name ?? id}
          <b>{n}</b>
        </span>
      ))}
    </div>
  );
}

/** 英雄对计数 chips（Map("a|b -> count)） */
function ComboChipList({ countMap, heroesById, topN = 8 }) {
  const rows = [...countMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  if (rows.length === 0) return <div className="empty-hint">暂无</div>;
  return (
    <div className="chip-list">
      {rows.map(([key, n]) => {
        const [a, b] = key.split('|').map(Number);
        return (
          <span className="stat-chip" key={key}>
            <HeroAvatar hero={heroesById[a]} size={18} />
            {heroesById[a]?.name ?? a}
            <span className="combo-plus">+</span>
            <HeroAvatar hero={heroesById[b]} size={18} />
            {heroesById[b]?.name ?? b}
            <b>{n}</b>
          </span>
        );
      })}
    </div>
  );
}

/* ================= 总览 ================= */
function OverviewTab({ games, seriesCount, heroesById }) {
  const ov = useMemo(() => overviewStats(games, seriesCount), [games, seriesCount]);
  const blueRate = pct(ov.blueWins, ov.games);
  const topBp = useMemo(() => [...ov.heroes.values()]
    .map((s) => ({ ...s, bp: s.picks + s.bans }))
    .filter((s) => s.bp > 0)
    .sort((a, b) => b.bp - a.bp)
    .slice(0, 10), [ov]);

  return (
    <>
      <div className="stat-cards">
        <div className="stat-card"><div className="stat-num">{ov.seriesCount}</div><div className="stat-label">系列赛</div></div>
        <div className="stat-card"><div className="stat-num">{ov.games}</div><div className="stat-label">对局</div></div>
        <div className="stat-card">
          <div className="stat-num blue-text">{blueRate}%</div>
          <div className="stat-label">蓝方胜率（{ov.blueWins}:{ov.redWins}）</div>
          <div className="wr-bar"><span className="fill good" style={{ width: `${blueRate}%` }} /></div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{games.filter((g) => g.blind).length}</div>
          <div className="stat-label">巅峰对决局</div>
        </div>
      </div>

      <div className="three-col">
        <Section title="Pick 榜 TOP10">
          <TopHeroList rows={ov.topPicked} heroesById={heroesById} mode="pick" games={games.length} />
        </Section>
        <Section title="Ban-Pick 榜 TOP10">
          <TopHeroList rows={topBp} heroesById={heroesById} mode="bp" games={games.length} />
        </Section>
        <Section title="Ban 榜 TOP10">
          <TopHeroList rows={ov.topBanned} heroesById={heroesById} mode="ban" games={games.length} />
        </Section>
      </div>
    </>
  );
}

function TopHeroList({ rows, heroesById, mode, games }) {
  if (rows.length === 0) return <div className="empty-hint">暂无数据</div>;
  return (
    <div className="top-list">
      {rows.map((r, i) => (
        <div className="top-row" key={r.heroId}>
          <span className="top-rank">{i + 1}</span>
          <HeroName heroesById={heroesById} id={r.heroId} />
          {mode === 'pick' && <span className="top-info">{r.picks} 场 · 胜率 {pct(r.wins, r.picks)}%</span>}
          {mode === 'ban' && <span className="top-info">{r.bans} 次 · Ban率 {pct(r.bans, games * 2)}%</span>}
          {mode === 'bp' && <span className="top-info">{r.bp} 次 · Ban-Pick率 {pct(r.bp, games * 2)}%</span>}
        </div>
      ))}
    </div>
  );
}

/* ================= 英雄分析 ================= */
const HERO_PAGE = 20;
const HERO_STEP = 30;
const COMBO_STEP = 50;
const COMBO_MIN = 5;  // 两位置组合默认显示门槛（搜索不限）
const TRIO_MIN = 3;   // 三位置组合默认显示门槛（搜索不限）

function HeroTab({ games, heroesById }) {
  const { sort, setSort, apply } = useSort('total');
  const [heroQuery, setHeroQuery] = useState('');
  const [laneFilter, setLaneFilter] = useState('');
  const [visCount, setVisCount] = useState(HERO_PAGE);
  useEffect(() => { setVisCount(HERO_PAGE); }, [heroQuery, laneFilter]);
  const stats = useMemo(() => {
    const m = heroStats(games);
    const rows = [...m.values()].map((s) => ({
      ...s,
      total: s.picks + s.bans,
      pickRate: pct(s.picks, games.length * 2),
      banRate: pct(s.bans, games.length * 2),
      bpRate: pct(s.picks + s.bans, games.length * 2),
      winRate: pct(s.pickWins, s.picks),
    }));
    // 楼层分布排序：1 楼次数优先，相同再依次比 2 楼、3 楼……（仍相同按热度）
    if (sort.key === 'floors') {
      const dir = sort.dir === 'desc' ? -1 : 1;
      return rows.sort((a, b) => {
        for (let i = 0; i < 5; i++) {
          if (a.floors[i] !== b.floors[i]) return (a.floors[i] - b.floors[i]) * dir;
        }
        return (a.total - b.total) * dir;
      });
    }
    return apply(rows, (r) => r[sort.key]);
  }, [games, sort, apply]);

  const q = heroQuery.trim().toLowerCase();
  const matched = useMemo(
    () => stats.filter((row) =>
      (!laneFilter || heroesById[row.heroId]?.lanes?.[0] === laneFilter)
      && heroMatch(heroesById[row.heroId], q)),
    [stats, heroesById, q, laneFilter]
  );
  const shown = matched.slice(0, visCount);
  const heroRemaining = matched.length - shown.length;

  if (games.length === 0) return <div className="panel empty-hint">当前筛选下没有对局</div>;

  return (
    <>
      <Section
        title={`英雄数据（共 ${stats.length} 名英雄登场，Pick/Ban 率分母为 2×局数）`}
        extra={
          <>
            <select
              value={laneFilter}
              onChange={(e) => setLaneFilter(e.target.value)}
              title="按主分路筛选（与选人时推荐位置的口径一致，每名英雄只归入一个位置）"
              style={{ marginRight: 8 }}
            >
              <option value="">全部分路</option>
              {LANE_BADGES.map((l) => <option key={l.full} value={l.full}>{l.full}</option>)}
            </select>
            <input
              value={heroQuery}
              onChange={(e) => setHeroQuery(e.target.value)}
              placeholder="搜索英雄名/拼音"
              style={{ width: 180 }}
            />
          </>
        }
      >
        <div className="table-wrap">
          <table className="data-table hero-table">
            <thead>
              <tr>
                <Th sort={sort} sortKey="total" setSort={setSort} title="默认按 Pick+Ban 总次数排序（热度）。点击其他表头可切换排序">英雄</Th>
                <Th sort={sort} sortKey="picks" setSort={setSort} title="该英雄被选用的总局数（每局蓝红两队各可选 5 人）">Pick</Th>
                <Th sort={sort} sortKey="pickRate" setSort={setSort} title="Pick 次数 ÷ 2×对局数。每局蓝红两队各有一次选用机会，N 局共 2N 次机会，即该英雄平均每局被选中的概率">Pick率</Th>
                <Th sort={sort} sortKey="bans" setSort={setSort} title="该英雄被禁用的总局数（空禁不计）">Ban</Th>
                <Th sort={sort} sortKey="banRate" setSort={setSort} title="Ban 次数 ÷ 2×对局数。每局蓝红两队各有一次禁用机会，N 局共 2N 次机会">Ban率</Th>
                <Th sort={sort} sortKey="bpRate" setSort={setSort} title="(Ban 次数 + Pick 次数) ÷ 2×对局数。该英雄在本局 BP 中出现（被选或被禁）的综合概率">Ban-Pick率</Th>
                <Th sort={sort} sortKey="banFirst" setSort={setSort} title="该英雄作为某一方第一条 Ban 的局数（蓝方一ban 或 红方一ban 都计入，一局最多 2 个首Ban）">首Ban</Th>
                <Th sort={sort} sortKey="winRate" setSort={setSort} title="该英雄被选用且该队获胜的局数 ÷ 被选用总局数">选用胜率</Th>
                <Th sort={sort} sortKey="bluePicks" setSort={setSort} title="作为蓝方被选用的局数">蓝方选</Th>
                <Th sort={sort} sortKey="redPicks" setSort={setSort} title="作为红方被选用的局数">红方选</Th>
                <Th sort={sort} sortKey="floors" setSort={setSort} title="按 1 楼被选次数排序（次数相同再依次比 2 楼、3 楼……，仍相同按热度）；点击切换升/降序">楼层分布（1-5楼）</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const floorMax = Math.max(1, ...s.floors);
                return (
                  <tr key={s.heroId}>
                    <td><HeroName heroesById={heroesById} id={s.heroId} /></td>
                    <td className="num">{s.picks}</td>
                    <td className="num">{s.pickRate}%</td>
                    <td className="num">{s.bans}</td>
                    <td className="num">{s.banRate}%</td>
                    <td className="num">{s.bpRate}%</td>
                    <td className="num">{s.banFirst}</td>
                    <td>{s.picks > 0 ? <WrBar value={s.winRate} /> : <span className="dim">—</span>}</td>
                    <td className="num blue-text">{s.bluePicks}</td>
                    <td className="num red-text">{s.redPicks}</td>
                    <td>
                      <span className="floors">
                        {s.floors.map((f, i) => (
                          <span key={i} className="floor-cell" title={`${i + 1}楼 ${f} 次（${pct(f, s.picks)}%）`}
                            style={{ opacity: f === 0 ? 0.25 : 0.35 + 0.65 * (f / floorMax) }}>
                            {f}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(heroQuery.trim() || laneFilter) && (
          <div className="mini-note" style={{ textAlign: 'center' }}>
            {laneFilter ? `${laneFilter}：` : ''}匹配 {matched.length} 名英雄{heroQuery.trim() ? '（搜索不限门槛）' : ''}
          </div>
        )}
        {(heroRemaining > 0 || visCount > HERO_PAGE) && (
          <div className="table-foot">
            {heroRemaining > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setVisCount((v) => v + HERO_STEP)}>
                显示后 {Math.min(HERO_STEP, heroRemaining)} 名英雄（剩余 {heroRemaining}）
              </button>
            )}
            {visCount > HERO_PAGE && (
              <button className="btn btn-ghost btn-sm" onClick={() => setVisCount(HERO_PAGE)}>收起</button>
            )}
          </div>
        )}
      </Section>

      <GlobalComboSection games={games} heroesById={heroesById} />
      <GlobalTrioSection games={games} heroesById={heroesById} />
      <GlobalFiveSection games={games} heroesById={heroesById} />
      <HeroCounterSection games={games} heroesById={heroesById} />
    </>
  );
}

/* ---- 全 KPL 英雄组合榜（需求 10） ---- */
function GlobalComboSection({ games, heroesById }) {
  const { sort, setSort, apply } = useSort('picks');
  const [comboQuery, setComboQuery] = useState('');
  const [visCount, setVisCount] = useState(HERO_PAGE);
  useEffect(() => { setVisCount(HERO_PAGE); }, [comboQuery]);
  const rows = useMemo(() => {
    const n = games.length;
    return [...globalComboStats(games).values()].map((c) => ({
      ...c,
      pickRate: pct(c.picks, n * 2),
      banRate: pct(c.banGames, n),
      bpRate: pct(c.picks + c.banGames, n * 2),
      winRate: pct(c.wins, c.picks),
      topFloors: [...c.floorPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2),
    }));
  }, [games]);
  const sorted = useMemo(() => apply(rows, (r) => r[sort.key]), [rows, sort, apply]);
  const q = comboQuery.trim().toLowerCase();
  // 默认仅显示出场 ≥COMBO_MIN 的热门组合（只出现 1-2 次视为噪音），搜索不限门槛
  const matched = useMemo(() => {
    const base = q ? sorted : sorted.filter((c) => c.picks >= COMBO_MIN);
    return base.filter((c) => heroMatch(heroesById[c.heroA], q) || heroMatch(heroesById[c.heroB], q));
  }, [sorted, heroesById, q]);
  const shown = matched.slice(0, visCount);
  const comboRemaining = matched.length - shown.length;
  const hotCount = useMemo(() => rows.filter((c) => c.picks >= COMBO_MIN).length, [rows]);

  return (
    <Section
      title={`全 KPL 英雄组合数据（共 ${rows.length} 组登场，默认显示出场 ≥${COMBO_MIN} 次的 ${hotCount} 组，搜索不限门槛）`}
      extra={
        <input
          value={comboQuery}
          onChange={(e) => setComboQuery(e.target.value)}
          placeholder="搜索组合中的英雄/拼音"
          style={{ width: 180 }}
        />
      }
    >
      {rows.length === 0 ? <div className="empty-hint">暂无数据</div> : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>组合</th>
                  <Th sort={sort} sortKey="picks" setSort={setSort} title="两英雄同队同局同时出场的次数（默认排序）">Pick</Th>
                  <Th sort={sort} sortKey="pickRate" setSort={setSort} title="组合出场次数 ÷ 2×对局数（每局每队各有 1 次出现该组合的机会）">Pick率</Th>
                  <Th sort={sort} sortKey="banGames" setSort={setSort} title="该局中组合任一名英雄被任一方 Ban 的局数（每局最多计 1 次，含组合未登场的局；被 Ban 的英雄该局不可能被 Pick）">Ban覆盖局</Th>
                  <Th sort={sort} sortKey="banRate" setSort={setSort} title="Ban覆盖局 ÷ 对局数（反映组合成员整体受 Ban 压制程度）">Ban率</Th>
                  <Th sort={sort} sortKey="bpRate" setSort={setSort} title="(组合 Pick 次数 + Ban 覆盖局数) ÷ 2×对局数。该组合以「被选出」或「成员被禁」形式出现在 BP 中的综合热度，分母与英雄 Ban-Pick 率一致">Ban-Pick率</Th>
                  <Th sort={sort} sortKey="winRate" setSort={setSort} title="组合出场且该队获胜的局数 ÷ 出场总局数">选用胜率</Th>
                  <th title="该组合出现时，两个英雄在队内的选人顺位（前 2 种）。例：「2+1楼 ×12」= 有 12 次，第一个英雄是队内第 2 个被选、第二个英雄是队内第 1 个被选；楼位指队内第几个被选（1-5），不是全场手数。顺序对应组合中两个英雄的展示顺序">楼层倾向</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={`${c.heroA}|${c.heroB}`}>
                    <td className="combo-cell">
                      <HeroName heroesById={heroesById} id={c.heroA} size={24} />
                      <span className="combo-plus">+</span>
                      <HeroName heroesById={heroesById} id={c.heroB} size={24} />
                    </td>
                    <td className="num">{c.picks}</td>
                    <td className="num">{c.pickRate}%</td>
                    <td className="num">{c.banGames}</td>
                    <td className="num">{c.banRate}%</td>
                    <td className="num">{c.bpRate}%</td>
                    <td><WrBar value={c.winRate} /></td>
                    <td className="num dim">
                      {c.topFloors.map(([fp, n]) => (
                        <span key={fp} className="floor-pair" title={`${n} 次：英雄A在第${fp[0]}楼、英雄B在第${fp[2]}楼被选`}>
                          {fp[0]}+{fp[2]}楼 ×{n}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q && (
            <div className="mini-note" style={{ textAlign: 'center' }}>搜索匹配 {matched.length} 组组合（不限出场门槛）</div>
          )}
          {(comboRemaining > 0 || visCount > HERO_PAGE) && (
            <div className="table-foot">
              {comboRemaining > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setVisCount((v) => v + COMBO_STEP)}>
                  显示后 {Math.min(COMBO_STEP, comboRemaining)} 组组合（剩余 {comboRemaining}）
                </button>
              )}
              {visCount > HERO_PAGE && (
                <button className="btn btn-ghost btn-sm" onClick={() => setVisCount(HERO_PAGE)}>收起</button>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/* ---- 全 KPL 三英雄组合榜 ---- */
function GlobalTrioSection({ games, heroesById }) {
  const [trioQuery, setTrioQuery] = useState('');
  const [visCount, setVisCount] = useState(HERO_PAGE);
  useEffect(() => { setVisCount(HERO_PAGE); }, [trioQuery]);
  const rows = useMemo(() => [...globalTrioStats(games).values()]
    .map((c) => ({ ...c, winRate: pct(c.wins, c.picks) }))
    .sort((a, b) => b.picks - a.picks || b.wins - a.wins), [games]);
  const hotCount = useMemo(() => rows.filter((c) => c.picks >= TRIO_MIN).length, [rows]);
  const q = trioQuery.trim().toLowerCase();
  const matched = useMemo(() => {
    const base = q ? rows : rows.filter((c) => c.picks >= TRIO_MIN);
    return base.filter((c) => !q || c.heroes.some((h) => heroMatch(heroesById[h], q)));
  }, [rows, heroesById, q]);
  const shown = matched.slice(0, visCount);
  const remaining = matched.length - shown.length;

  return (
    <Section
      title={`全 KPL 三英雄组合（共 ${rows.length} 组登场，默认显示出场 ≥${TRIO_MIN} 次的 ${hotCount} 组，搜索不限门槛）`}
      extra={
        <input
          value={trioQuery}
          onChange={(e) => setTrioQuery(e.target.value)}
          placeholder="搜索组合中的英雄/拼音"
          style={{ width: 180 }}
        />
      }
    >
      {matched.length === 0 ? (
        <div className="empty-hint">{q ? '没有匹配的组合' : `暂无出场 ≥${TRIO_MIN} 次的三英雄组合（数据积累后自动出现）`}</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>组合</th><th title="三名英雄同队同局同时出场的次数">出场</th><th title="组合出场且该队获胜的局数 ÷ 出场数（小样本下仅供参考）">胜率</th></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.heroes.join('-')}>
                    <td className="combo-cell">
                      {c.heroes.map((h, i) => (
                        <React.Fragment key={h}>
                          {i > 0 && <span className="combo-plus">+</span>}
                          <HeroName heroesById={heroesById} id={h} size={24} />
                        </React.Fragment>
                      ))}
                    </td>
                    <td className="num">{c.picks}</td>
                    <td><WrBar value={c.winRate} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q && (
            <div className="mini-note" style={{ textAlign: 'center' }}>搜索匹配 {matched.length} 组组合（不限出场门槛）</div>
          )}
          {(remaining > 0 || visCount > HERO_PAGE) && (
            <div className="table-foot">
              {remaining > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setVisCount((v) => v + COMBO_STEP)}>
                  显示后 {Math.min(COMBO_STEP, remaining)} 组组合（剩余 {remaining}）
                </button>
              )}
              {visCount > HERO_PAGE && (
                <button className="btn btn-ghost btn-sm" onClick={() => setVisCount(HERO_PAGE)}>收起</button>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/* ---- 全 KPL 五英雄阵容（出场 ≥2 次，TOP10） ---- */
function GlobalFiveSection({ games, heroesById }) {
  const rows = useMemo(() => [...globalFiveStats(games).values()]
    .filter((c) => c.picks >= 2)
    .map((c) => ({ ...c, winRate: pct(c.wins, c.picks) }))
    .sort((a, b) => b.picks - a.picks || b.wins - a.wins)
    .slice(0, 10), [games]);

  return (
    <Section title="全 KPL 五英雄阵容（出场 ≥2 次 · TOP10）">
      {rows.length === 0 ? (
        <div className="empty-hint">暂无重复出现的整队阵容（全局 BP 下同系列赛内不会重复，需跨场次积累）</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>阵容</th><th title="该五英雄作为整队同时出场的次数">出场</th><th title="出场且获胜的局数 ÷ 出场数（小样本下仅供参考）">胜率</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.heroes.join('-')}>
                  <td className="combo-cell">
                    {c.heroes.map((h, i) => (
                      <React.Fragment key={h}>
                        {i > 0 && <span className="combo-plus">+</span>}
                        <HeroName heroesById={heroesById} id={h} size={24} />
                      </React.Fragment>
                    ))}
                  </td>
                  <td className="num">{c.picks}</td>
                  <td><WrBar value={c.winRate} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mini-note">整队锁定规则下同一系列赛内不会复用英雄，重复阵容只能来自不同系列赛之间；当前样本少，胜率仅供参考。</div>
    </Section>
  );
}

/* ---- 英雄/组合 Counter 关系（需求 5） ---- */
function HeroCounterSection({ games, heroesById }) {
  const [mode, setMode] = useState('hero');
  const [view, setView] = useState('out');
  const heroOptions = useMemo(() => [...heroStats(games).values()]
    .filter((s) => s.picks > 0)
    .sort((a, b) => (b.picks + b.bans) - (a.picks + a.bans))
    .slice(0, 40), [games]);
  const [heroId, setHeroId] = useState('');
  const combos = useMemo(() => globalComboStats(games), [games]);
  const comboOptions = useMemo(() => [...combos.values()].sort((a, b) => b.picks - a.picks).slice(0, 40), [combos]);
  const [comboKey, setComboKey] = useState('');

  const effHeroId = Number(heroId) || heroOptions[0]?.heroId;
  const effComboKey = comboKey || (comboOptions[0] ? `${comboOptions[0].heroA}|${comboOptions[0].heroB}` : '');

  const heroScene = useMemo(
    () => (mode === 'hero' && effHeroId ? heroCounterScene(games, effHeroId) : null),
    [mode, games, effHeroId]
  );
  const heroIn = useMemo(
    () => (mode === 'hero' && effHeroId ? heroCounteredByScene(games, effHeroId) : null),
    [mode, games, effHeroId]
  );
  const comboScene = useMemo(() => {
    if (mode !== 'combo' || !effComboKey) return null;
    const [a, b] = effComboKey.split('|').map(Number);
    return comboCounterScene(games, a, b);
  }, [mode, games, effComboKey]);

  const heroRows = useMemo(
    () => (heroScene ? [...heroScene.count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) : []),
    [heroScene]
  );
  const heroInRows = useMemo(
    () => (heroIn ? [...heroIn.count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) : []),
    [heroIn]
  );

  return (
    <Section
      title="Counter 关系（该英雄/组合常在对方亮出什么时作为回应被选出）"
      extra={
        <>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="hero">按英雄</option>
            <option value="combo">按组合</option>
          </select>
          {mode === 'hero' && (
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="out">视角：它 counter 谁</option>
              <option value="in">视角：谁 counter 它</option>
            </select>
          )}
          {mode === 'hero' ? (
            <select value={heroId} onChange={(e) => setHeroId(e.target.value)}>
              {heroOptions.map((s) => (
                <option key={s.heroId} value={s.heroId}>
                  {heroesById[s.heroId]?.name ?? s.heroId}（Pick+Ban {s.picks + s.bans}）
                </option>
              ))}
            </select>
          ) : (
            <select value={comboKey} onChange={(e) => setComboKey(e.target.value)}>
              {comboOptions.map((c) => (
                <option key={`${c.heroA}|${c.heroB}`} value={`${c.heroA}|${c.heroB}`}>
                  {heroesById[c.heroA]?.name}+{heroesById[c.heroB]?.name}（出场 {c.picks}）
                </option>
              ))}
            </select>
          )}
        </>
      }
    >
      {mode === 'hero' && view === 'out' && heroScene && (
        <>
          <div className="counter-summary">
            <HeroName heroesById={heroesById} id={effHeroId} size={22} />
            {' '}常规局出场 {heroScene.picks} 次 · 胜率 {pct(heroScene.wins, heroScene.picks)}% —— 常在对方亮出下列英雄时被选出：
          </div>
          <div className="counter-rows">
            {heroRows.length === 0 && <div className="empty-hint">暂无样本</div>}
            {heroRows.map(([opp, n]) => (
              <div className="counter-row" key={opp}>
                <span className="hero-name-cell opp">
                  <HeroAvatar hero={heroesById[opp]} size={24} />
                  <span>{heroesById[opp]?.name ?? opp}</span>
                </span>
                <span className="arrow">→</span>
                <span className="stat-chip">
                  被选出 <b>{n}</b> 次 · 占出场 {pct(n, heroScene.picks)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {mode === 'hero' && view === 'in' && heroIn && (
        <>
          <div className="counter-summary">
            <HeroName heroesById={heroesById} id={effHeroId} size={22} />
            {' '}常规局出场 {heroIn.picks} 次 · 胜率 {pct(heroIn.wins, heroIn.picks)}% —— 常被以下英雄作为 counter 选出（对方在它亮出后点选）：
          </div>
          <div className="counter-rows">
            {heroInRows.length === 0 && <div className="empty-hint">暂无样本</div>}
            {heroInRows.map(([x, n]) => (
              <div className="counter-row" key={x}>
                <span className="hero-name-cell opp">
                  <HeroAvatar hero={heroesById[x]} size={24} />
                  <span>{heroesById[x]?.name ?? x}</span>
                </span>
                <span className="arrow">→</span>
                <span className="stat-chip">
                  counter 它 <b>{n}</b> 次 · 占它出场 {pct(n, heroIn.picks)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {mode === 'combo' && comboScene && (
        <>
          <div className="counter-summary">
            组合成型 {comboScene.picks} 次 · 胜率 {pct(comboScene.wins, comboScene.picks)}% —— 成型时（两英雄均已选出）对方已亮出的英雄与组合：
          </div>
          <div className="two-col">
            <div>
              <div className="sub-title">对方已亮英雄 TOP10</div>
              <ChipList countMap={comboScene.heroCount} heroesById={heroesById} />
            </div>
            <div>
              <div className="sub-title">对方已亮组合 TOP8</div>
              <ComboChipList countMap={comboScene.comboCount} heroesById={heroesById} />
            </div>
          </div>
        </>
      )}
      <div className="mini-note">
        仅统计常规局中「对方已亮英雄（BP 手序在本方之前）」的场景，即该英雄/组合是在看到对方英雄后作为 counter 被选出的；巅峰对决盲选局不计。下拉中的数字为热度参考：按英雄 = 该英雄 Pick+Ban 总次数，按组合 = 该组合出场次数。
      </div>
    </Section>
  );
}

/* ================= 战队分析 ================= */
const TEAM_SECTIONS = [
  { key: 'allteams', label: '战队总览' },
  { key: 'overview', label: '总览' },
  { key: 'heroes', label: '英雄偏好' },
  { key: 'combo', label: '组合胜率' },
];

/* ---- 战队数据总览：全部战队一张表 ---- */
function AllTeamsTable({ games, heroesById }) {
  const { sort, setSort, apply } = useSort('games');
  const rows = useMemo(() => [...allTeamStats(games).values()].map((t) => ({
    ...t,
    seriesCount: t.seriesMap.size,
    seriesWinRate: pct(t.seriesWins, t.seriesMap.size),
    heroCount: t.heroUse.size,
    winRate: pct(t.wins, t.games),
    blueRate: pct(t.blueWins, t.blueGames),
    redRate: pct(t.redWins, t.redGames),
    topHeroes: [...t.heroUse.values()].sort((a, b) => b.picks - a.picks).slice(0, 3),
  })), [games]);
  const sorted = useMemo(() => apply(rows, (r) => r[sort.key]), [rows, sort, apply]);

  return (
    <Section title={`战队数据总览（共 ${rows.length} 支战队登场，点击表头排序）`}>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sort={sort} sortKey="name" setSort={setSort}>战队</Th>
              <Th sort={sort} sortKey="seriesCount" setSort={setSort} title="参与的系列赛数量">场次</Th>
              <Th sort={sort} sortKey="seriesWinRate" setSort={setSort} title="系列赛胜场 ÷ 系列赛总场次（任一方先胜 (BO+1)/2 局才计胜负，未录完记未分；悬停查看胜负明细）">大场胜率</Th>
              <Th sort={sort} sortKey="games" setSort={setSort} title="总小局数（默认排序）">小局数</Th>
              <Th sort={sort} sortKey="winRate" setSort={setSort} title="获胜小局 ÷ 总小局">小局胜率</Th>
              <Th sort={sort} sortKey="blueWins" setSort={setSort} title="执蓝局获胜的场数">蓝方胜场</Th>
              <Th sort={sort} sortKey="blueRate" setSort={setSort} title="蓝方胜 ÷ 执蓝局数">蓝方胜率</Th>
              <Th sort={sort} sortKey="redWins" setSort={setSort} title="执红局获胜的场数">红方胜场</Th>
              <Th sort={sort} sortKey="redRate" setSort={setSort} title="红方胜 ÷ 执红局数">红方胜率</Th>
              <Th sort={sort} sortKey="heroCount" setSort={setSort} title="该队出场过的不同英雄总数（全局 BP 下的英雄池深度）">登场英雄数</Th>
              <th title="出场次数最多的 3 个英雄（悬停查看各自胜率）">常用英雄</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.teamId}>
                <td className="player-name">{t.name}</td>
                <td className="num">{t.seriesCount}</td>
                <td title={`${t.seriesWins} 胜 ${t.seriesLosses} 负${t.seriesDraws ? ` ${t.seriesDraws} 未分（平/未录完）` : ''} / 共 ${t.seriesCount} 场`}><WrBar value={t.seriesWinRate} /></td>
                <td className="num">{t.games}</td>
                <td title={`${t.wins} 胜 / ${t.games} 局`}><WrBar value={t.winRate} /></td>
                <td className="num" title={`执蓝 ${t.blueGames} 局`}>{t.blueWins}</td>
                <td title={`蓝方 ${t.blueWins} 胜 / ${t.blueGames} 局`}><WrBar value={t.blueRate} /></td>
                <td className="num" title={`执红 ${t.redGames} 局`}>{t.redWins}</td>
                <td title={`红方 ${t.redWins} 胜 / ${t.redGames} 局`}><WrBar value={t.redRate} /></td>
                <td className="num">{t.heroCount}</td>
                <td>
                  <div className="fg-chips">
                    {t.topHeroes.map((u) => (
                      <span className="stat-chip" key={u.heroId}
                        title={`${heroesById[u.heroId]?.name ?? u.heroId} · ${u.picks} 场 · 胜率 ${pct(u.wins, u.picks)}%`}>
                        <HeroAvatar hero={heroesById[u.heroId]} size={18} />
                        {heroesById[u.heroId]?.name ?? u.heroId}
                        <b>{u.picks}</b>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function TeamTab({ games, teams, heroesById }) {
  const [teamId, setTeamId] = useState('');
  const [pairFilter, setPairFilter] = useState('all');
  const [trioFilter, setTrioFilter] = useState('all');
  const [comboQuery2, setComboQuery2] = useState('');
  const [visCount2, setVisCount2] = useState(HERO_PAGE);
  useEffect(() => { setPairFilter('all'); setTrioFilter('all'); setComboQuery2(''); setVisCount2(HERO_PAGE); }, [teamId]);
  useEffect(() => { setVisCount2(HERO_PAGE); }, [comboQuery2, pairFilter]);

  const tid = teams.length > 0 ? (Number(teamId) || teams[0].id) : -1;

  const ts = useMemo(() => teamStats(games, tid), [games, tid]);
  const combos = useMemo(() => comboStats(ts.games, tid), [ts.games, tid]);
  const trios = useMemo(() => trioComboStats(ts.games, tid), [ts.games, tid]);
  const afterLoss = useMemo(() => afterLossSideStats(ts.games, tid), [ts.games, tid]);

  const heroRows = useMemo(() => {
    const rows = [...ts.heroUse.values()].map((u) => ({
      ...u, winRate: pct(u.wins, u.picks), total: u.picks + u.bans,
    })).sort((a, b) => b.total - a.total);
    return rows;
  }, [ts]);

  const comboRows = useMemo(() => {
    const pairLabel = (p) => PAIR_DEFS.find((d) => d.key === p)?.label || p;
    return [...combos.values()]
      .map((c) => ({ ...c, winRate: pct(c.wins, c.picks), pairLabel: pairLabel(c.pair) }))
      .filter((c) => pairFilter === 'all' || c.pair === pairFilter)
      .sort((a, b) => b.picks - a.picks);
  }, [combos, pairFilter]);

  const comboMatched = useMemo(() => {
    const q = comboQuery2.trim().toLowerCase();
    if (!q) return comboRows;
    return comboRows.filter((c) => heroMatch(heroesById[c.heroA], q) || heroMatch(heroesById[c.heroB], q));
  }, [comboRows, heroesById, comboQuery2]);
  const comboShown = comboMatched.slice(0, visCount2);
  const comboRemaining2 = comboMatched.length - comboShown.length;

  const trioRows = useMemo(() => {
    const trioLabel = (p) => TRIO_DEFS.find((d) => d.key === p)?.label || p;
    return [...trios.values()]
      .map((c) => ({ ...c, winRate: pct(c.wins, c.picks), trioLabel: trioLabel(c.trio) }))
      .filter((c) => trioFilter === 'all' || c.trio === trioFilter)
      .filter((c) => c.picks >= 2 || trioFilter !== 'all') // 全部视图下隐藏只出现 1 次的组合，避免长尾噪音
      .sort((a, b) => b.picks - a.picks);
  }, [trios, trioFilter]);

  const scrollTo = (key) => document.getElementById(`team-sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (teams.length === 0 || ts.games.length === 0) {
    return (
      <>
        <div className="panel filter-bar">
          <span className="filter-label">战队</span>
          <select value={tid} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="panel empty-hint">
          {teams.length === 0 ? '暂无战队数据' : '该战队在当前筛选下没有对局'}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="panel filter-bar">
        <div className="filter-inline">
          <span className="filter-label">战队</span>
          <select value={tid} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span className="mini-note">本页分析仅基于该战队出场的对局</span>
        </div>
        <div className="anchor-nav">
          {TEAM_SECTIONS.map((s) => (
            <button key={s.key} onClick={() => scrollTo(s.key)}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* 战队数据总览（全部战队） */}
      <div id="team-sec-allteams">
        <AllTeamsTable games={games} heroesById={heroesById} />
      </div>

      {/* 总览（当前选中战队） */}
      <div id="team-sec-overview">
        <div className="stat-cards">
          <div className="stat-card"><div className="stat-num">{new Set(ts.games.map((g) => g.seriesId)).size}</div><div className="stat-label">系列赛场次</div></div>
          <div className="stat-card"><div className="stat-num">{ts.games.length}</div><div className="stat-label">对局数（小局）</div></div>
          <div className="stat-card">
            <div className="stat-num blue-text">{ts.blueGames}</div>
            <div className="stat-label">蓝方 {ts.blueWins}胜（{pct(ts.blueWins, ts.blueGames)}%）</div>
            <div className="wr-bar"><span className="fill good" style={{ width: pct(ts.blueWins, ts.blueGames) + '%' }} /></div>
          </div>
          <div className="stat-card">
            <div className="stat-num red-text">{ts.redGames}</div>
            <div className="stat-label">红方 {ts.redWins}胜（{pct(ts.redWins, ts.redGames)}%）</div>
            <div className="wr-bar"><span className="fill good" style={{ width: pct(ts.redWins, ts.redGames) + '%' }} /></div>
          </div>
          <div className="stat-card" title="败方拥有下一局选边权；统计该战队每场落败（非系列赛最后一局）后，下一局执蓝方的比率">
            <div className="stat-num blue-text">{afterLoss.total > 0 ? `${pct(afterLoss.blue, afterLoss.total)}%` : '—'}</div>
            <div className="stat-label">落败后下一局执蓝{afterLoss.total > 0 ? `（${afterLoss.blue} 次）` : '（暂无样本）'}</div>
            {afterLoss.total > 0 && <div className="wr-bar"><span className="fill good" style={{ width: pct(afterLoss.blue, afterLoss.total) + '%' }} /></div>}
          </div>
          <div className="stat-card" title="败方拥有下一局选边权；统计该战队每场落败（非系列赛最后一局）后，下一局执红方的比率">
            <div className="stat-num red-text">{afterLoss.total > 0 ? `${pct(afterLoss.red, afterLoss.total)}%` : '—'}</div>
            <div className="stat-label">落败后下一局执红{afterLoss.total > 0 ? `（${afterLoss.red} 次）` : '（暂无样本）'}</div>
            {afterLoss.total > 0 && <div className="wr-bar"><span className="fill bad" style={{ width: pct(afterLoss.red, afterLoss.total) + '%' }} /></div>}
          </div>
        </div>
        <div className="mini-note" style={{ marginTop: 8 }}>落败后下一局选边：败方拥有下一局选边权，统计每场落败（非系列赛最后一局）后下一局执蓝/执红的比率；末局落败没有下一局，不计入。</div>
      </div>

      {/* 英雄偏好 */}
      <div id="team-sec-heroes">
        <div className="two-col">
          <Section title="Pick 偏好">
            <HeroUseTable rows={heroRows.filter((r) => r.picks > 0).sort((a, b) => b.picks - a.picks)} heroesById={heroesById} showWin />
          </Section>
          <Section title="Ban 偏好">
            <HeroUseTable rows={heroRows.filter((r) => r.bans > 0).sort((a, b) => b.bans - a.bans)} heroesById={heroesById} showBan />
          </Section>
        </div>
      </div>

      {/* 组合胜率（两位置 + 三位置） */}
      <div id="team-sec-combo">
        <Section
          title="英雄组合胜率（同队两位置）"
          extra={
            <>
              <input
                value={comboQuery2}
                onChange={(e) => setComboQuery2(e.target.value)}
                placeholder="搜索组合中的英雄/拼音"
                style={{ width: 170, marginRight: 8 }}
              />
              <select value={pairFilter} onChange={(e) => setPairFilter(e.target.value)}>
                <option value="all">全部位置组合</option>
                {PAIR_DEFS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </>
          }
        >
          {comboRows.length === 0 ? <div className="empty-hint">暂无组合数据（至少 2 次）</div> : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>组合</th><th>位置</th><th>出场</th><th>胜率</th></tr></thead>
                  <tbody>
                    {comboShown.map((c) => (
                      <tr key={`${c.heroA}-${c.heroB}-${c.pair}`}>
                        <td className="combo-cell">
                          <HeroName heroesById={heroesById} id={c.heroA} size={24} />
                          <span className="combo-plus">+</span>
                          <HeroName heroesById={heroesById} id={c.heroB} size={24} />
                        </td>
                        <td>{c.pairLabel}</td>
                        <td className="num">{c.picks}</td>
                        <td><WrBar value={c.winRate} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {comboQuery2.trim() && (
                <div className="mini-note" style={{ textAlign: 'center' }}>搜索匹配 {comboMatched.length} 组组合</div>
              )}
              {(comboRemaining2 > 0 || visCount2 > HERO_PAGE) && (
                <div className="table-foot">
                  {comboRemaining2 > 0 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setVisCount2((v) => v + COMBO_STEP)}>
                      显示后 {Math.min(COMBO_STEP, comboRemaining2)} 组组合（剩余 {comboRemaining2}）
                    </button>
                  )}
                  {visCount2 > HERO_PAGE && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setVisCount2(HERO_PAGE)}>收起</button>
                  )}
                </div>
              )}
            </>
          )}
        </Section>

        <Section
          title="三位置组合胜率（同队三位置）"
          extra={
            <select value={trioFilter} onChange={(e) => setTrioFilter(e.target.value)}>
              <option value="all">全部位置组合</option>
              {TRIO_DEFS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          }
        >
          {trioRows.length === 0 ? <div className="empty-hint">暂无三位置组合数据（全部视图下仅显示出场 ≥2 次的组合，可切换具体位置查看）</div> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>组合</th><th>位置</th><th>出场</th><th>胜率</th></tr></thead>
                <tbody>
                  {trioRows.map((c) => (
                    <tr key={`${c.heroes.join('-')}-${c.trio}`}>
                      <td className="combo-cell">
                        {c.heroes.map((h, i) => (
                          <React.Fragment key={h}>
                            {i > 0 && <span className="combo-plus">+</span>}
                            <HeroName heroesById={heroesById} id={h} size={24} />
                          </React.Fragment>
                        ))}
                      </td>
                      <td>{c.trioLabel}</td>
                      <td className="num">{c.picks}</td>
                      <td><WrBar value={c.winRate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

function HeroUseTable({ rows, heroesById, showWin, showBan }) {
  if (rows.length === 0) return <div className="empty-hint">暂无数据</div>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>英雄</th>
            {showBan ? <th>Ban</th> : <th>Pick</th>}
            {showWin && <th>胜率</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 15).map((r) => (
            <tr key={r.heroId}>
              <td><HeroName heroesById={heroesById} id={r.heroId} /></td>
              <td className="num">{showBan ? r.bans : r.picks}</td>
              {showWin && <td><WrBar value={r.winRate} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================= 选手分析（需求 9：全选手一览） ================= */
function PlayerTab({ games, heroesById }) {
  const { sort, setSort, apply } = useSort('picks');
  const [playerQuery, setPlayerQuery] = useState('');
  const [visCount, setVisCount] = useState(HERO_PAGE);
  useEffect(() => { setVisCount(HERO_PAGE); }, [playerQuery]);

  const rows = useMemo(() => [...allPlayerStats(games).values()].map((s) => ({
    ...s,
    winRate: pct(s.wins, s.picks),
    blueRate: pct(s.blueWins, s.blueGames),
    redRate: pct(s.redWins, s.redGames),
    mainTeam: [...s.teamUse.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    topHeroes: [...s.heroUse.values()].sort((a, b) => b.picks - a.picks).slice(0, 3),
  })), [games]);

  const sorted = useMemo(() => apply(rows, (r) => r[sort.key]), [rows, sort, apply]);
  const q = playerQuery.trim().toLowerCase();
  const matched = useMemo(
    () => (q ? sorted.filter((r) => r.name.toLowerCase().includes(q)) : sorted),
    [sorted, q]
  );
  const shown = matched.slice(0, visCount);
  const remaining = matched.length - shown.length;

  if (games.length === 0) return <div className="panel empty-hint">当前筛选下没有对局</div>;

  return (
    <Section
      title={`选手数据（共 ${sorted.length} 名选手登场，点击表头排序；战队为出场最多者）`}
      extra={
        <input
          value={playerQuery}
          onChange={(e) => setPlayerQuery(e.target.value)}
          placeholder="搜索选手名"
          style={{ width: 150 }}
        />
      }
    >
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sort={sort} sortKey="name" setSort={setSort}>选手</Th>
              <th>战队</th>
              <Th sort={sort} sortKey="picks" setSort={setSort} title="出场局数">出场</Th>
              <Th sort={sort} sortKey="winRate" setSort={setSort} title="获胜局数 ÷ 出场局数">胜率</Th>
              <Th sort={sort} sortKey="blueRate" setSort={setSort} title="执蓝局的获胜率">蓝方胜率</Th>
              <Th sort={sort} sortKey="redRate" setSort={setSort} title="执红局的获胜率">红方胜率</Th>
              <th title="出场次数最多的 3 个英雄（悬停查看各自胜率）">常用英雄</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.name}>
                <td className="player-name">{s.name}</td>
                <td>{s.mainTeam}</td>
                <td className="num">{s.picks}</td>
                <td><WrBar value={s.winRate} /></td>
                <td className="num blue-text">{s.blueRate}%</td>
                <td className="num red-text">{s.redRate}%</td>
                <td>
                  <div className="fg-chips">
                    {s.topHeroes.map((u) => (
                      <span className="stat-chip" key={u.heroId}
                        title={`${heroesById[u.heroId]?.name ?? u.heroId} · ${u.picks} 场 · 胜率 ${pct(u.wins, u.picks)}%`}>
                        <HeroAvatar hero={heroesById[u.heroId]} size={18} />
                        {heroesById[u.heroId]?.name ?? u.heroId}
                        <b>{u.picks}</b>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q && (
        <div className="mini-note" style={{ textAlign: 'center' }}>搜索匹配 {matched.length} 名选手</div>
      )}
      {(remaining > 0 || visCount > HERO_PAGE) && (
        <div className="table-foot">
          {remaining > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setVisCount((v) => v + HERO_STEP)}>
              显示后 {Math.min(HERO_STEP, remaining)} 名选手（剩余 {remaining}）
            </button>
          )}
          {visCount > HERO_PAGE && (
            <button className="btn btn-ghost btn-sm" onClick={() => setVisCount(HERO_PAGE)}>收起</button>
          )}
        </div>
      )}
    </Section>
  );
}

/* ================= 赛事分析（需求 8） ================= */

/** 两组样本的变化对比表（英雄 Ban-Pick 率 + 组合出现率），月度对比与轮次对比共用 */
function ShiftTables({ labelA, labelB, heroShift, comboShift, heroesById }) {
  return (
    <div className="two-col">
      <div>
        <div className="sub-title">英雄 Ban-Pick 率变化 TOP（{labelA} → {labelB}）</div>
        {heroShift.length === 0 ? <div className="empty-hint">样本不足（英雄需两组 Pick+Ban 各 ≥3 次）</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>英雄</th><th>{labelA}</th><th>{labelB}</th><th>变化</th></tr></thead>
              <tbody>
                {heroShift.map((r) => (
                  <tr key={r.heroId}>
                    <td><HeroName heroesById={heroesById} id={r.heroId} /></td>
                    <td className="num">{r.bpA}%（{r.totalA} 次）</td>
                    <td className="num">{r.bpB}%（{r.totalB} 次）</td>
                    <td className={`num ${r.diff > 0 ? 'delta-up' : 'delta-down'}`}>
                      {r.diff > 0 ? '▲' : '▼'} {Math.abs(r.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div>
        <div className="sub-title">组合出现率变化 TOP（{labelA} → {labelB}）</div>
        {comboShift.length === 0 ? <div className="empty-hint">样本不足（组合需两组各出现 ≥2 次）</div> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>组合</th><th>{labelA}</th><th>{labelB}</th><th>变化</th></tr></thead>
              <tbody>
                {comboShift.map((r) => (
                  <tr key={r.key}>
                    <td className="combo-cell">
                      <HeroName heroesById={heroesById} id={r.heroA} size={22} />
                      <span className="combo-plus">+</span>
                      <HeroName heroesById={heroesById} id={r.heroB} size={22} />
                    </td>
                    <td className="num">{r.rateA}%（{r.picksA} 次）</td>
                    <td className="num">{r.rateB}%（{r.picksB} 次）</td>
                    <td className={`num ${r.diff > 0 ? 'delta-up' : 'delta-down'}`}>
                      {r.diff > 0 ? '▲' : '▼'} {Math.abs(r.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- 轮次对比（按系列赛备注分组） ---- */
const ROUND_PRESETS = [
  { label: '第一轮 ↔ 第二轮', a: 'r1', b: 'r2' },
  { label: '第二轮 ↔ 第三轮', a: 'r2', b: 'r3' },
  { label: '第三轮 ↔ 季后赛', a: 'r3', b: 'po' },
  { label: '常规赛 ↔ 季后赛', a: 'regular', b: 'po' },
];

function RoundCompareSection({ games, allGames, heroesById }) {
  // 轮次归属在完整数据上计算（allGames）：边界场被上方筛选掉也不影响归属；
  // 各赛事独立判定，不跨赛事继承
  const groups = useMemo(() => groupByRound(games, allGames), [games, allGames]);
  const avail = useMemo(() => ROUND_DEFS.filter((d) => groups.get(d.key).length > 0), [groups]);
  const keyList = avail.map((d) => d.key);
  const [roundA, setRoundA] = useState('');
  const [roundB, setRoundB] = useState('');
  const labelOf = (k) => ROUND_DEFS.find((d) => d.key === k)?.label || k;

  // 默认选中"第一轮 → 第二轮"；组不存在时顺延到可用组，避免死选项
  const effA = keyList.includes(roundA) ? roundA : (keyList.includes('r1') ? 'r1' : keyList[0] || '');
  const effB = keyList.includes(roundB) ? roundB : (keyList.includes('r2') ? 'r2' : keyList.find((k) => k !== effA) || effA);

  const mk = (gs) => ({ n: gs.length, stats: heroStats(gs), combos: globalComboStats(gs), blueWins: gs.filter((g) => g.winnerSide === 'blue').length });
  const A = useMemo(() => mk(groups.get(effA) || []), [groups, effA]);
  const B = useMemo(() => mk(groups.get(effB) || []), [groups, effB]);
  const heroShift = useMemo(() => (A.n > 0 && B.n > 0 ? heroShiftRows(A.stats, A.n, B.stats, B.n) : []), [A, B]);
  const comboShift = useMemo(() => (A.n > 0 && B.n > 0 ? comboShiftRows(A.combos, A.n, B.combos, B.n) : []), [A, B]);

  return (
    <Section title="轮次对比（常规赛第一轮/第二轮/第三轮 ↔ 季后赛）">
      <div className="filter-inline" style={{ marginBottom: 10 }}>
        {ROUND_PRESETS.map((p) => (
          <button key={p.label} className="btn btn-ghost btn-sm" onClick={() => { setRoundA(p.a); setRoundB(p.b); }}>{p.label}</button>
        ))}
      </div>
      <div className="filter-inline" style={{ marginBottom: 10 }}>
        <span className="filter-label">对比</span>
        <select value={effA} onChange={(e) => setRoundA(e.target.value)}>
          {avail.map((d) => <option key={d.key} value={d.key}>{d.label}（{groups.get(d.key).length} 局）</option>)}
        </select>
        <span className="filter-label">→</span>
        <select value={effB} onChange={(e) => setRoundB(e.target.value)}>
          {avail.map((d) => <option key={d.key} value={d.key} disabled={d.key === effA}>{d.label}（{groups.get(d.key).length} 局）</option>)}
        </select>
        {A.n > 0 && B.n > 0 && (
          <>
            <span className="stat-chip">{labelOf(effA)}：{A.n} 局 · 蓝方胜率 {pct(A.blueWins, A.n)}%</span>
            <span className="stat-chip">{labelOf(effB)}：{B.n} 局 · 蓝方胜率 {pct(B.blueWins, B.n)}%</span>
          </>
        )}
      </div>
      {A.n === 0 || B.n === 0 ? (
        <div className="empty-hint">两组中至少一组暂无对局</div>
      ) : (
        <ShiftTables labelA={labelOf(effA)} labelB={labelOf(effB)} heroShift={heroShift} comboShift={comboShift} heroesById={heroesById} />
      )}
      <div className="mini-note">
        轮次按区间划分：从备注「第一轮」的那场系列赛起、到备注「第二轮」的那场之前的所有比赛都算第一轮（其余轮次同理）；季后赛从首场季后赛系列赛（赛段=季后赛或备注含季后赛/总决赛）起。只给系列赛起始处标注轮次即可，无需逐场备注。第一个标记之前的对局归入「未标注轮次」（不计入常规赛合计）。轮次归属按各赛事独立判定、在完整数据上计算（上方筛选不影响归属）。Ban-Pick 率 = (Pick+Ban) ÷ 2×该组局数，组合出现率分母 = 该组局数；英雄需两组 Pick+Ban 各 ≥3 次、组合各 ≥2 次才参与排名。
      </div>
    </Section>
  );
}
function EventTab({ games, allGames, heroesById }) {
  const byEvent = useMemo(() => {
    const m = new Map();
    for (const g of games) {
      if (!m.has(g.eventId)) m.set(g.eventId, { id: g.eventId, name: g.event, games: [] });
      m.get(g.eventId).games.push(g);
    }
    return [...m.values()];
  }, [games]);

  // ---- 同赛事 · 时间推移 ----
  const [trendEventId, setTrendEventId] = useState('');
  const trendGames = useMemo(() => {
    const ev = byEvent.find((e) => String(e.id) === trendEventId);
    return (ev || byEvent[0])?.games || [];
  }, [trendEventId, byEvent]);

  const months = useMemo(
    () => [...groupByMonth(trendGames).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    [trendGames]
  );
  const [monthA, setMonthA] = useState('');
  const [monthB, setMonthB] = useState('');
  useEffect(() => {
    const ks = months.map((m) => m[0]);
    setMonthA(ks.length >= 2 ? ks[ks.length - 2] : ks[0] || '');
    setMonthB(ks.length >= 2 ? ks[ks.length - 1] : '');
  }, [months]);

  const statsByMonth = useMemo(() => {
    const m = new Map();
    for (const [key, gs] of months) {
      m.set(key, { stats: heroStats(gs), combos: globalComboStats(gs), games: gs.length });
    }
    return m;
  }, [months]);

  const A = statsByMonth.get(monthA);
  const B = statsByMonth.get(monthB);
  const heroShift = useMemo(() => (A && B ? heroShiftRows(A.stats, A.games, B.stats, B.games) : []), [A, B]);
  const comboShift = useMemo(() => (A && B ? comboShiftRows(A.combos, A.games, B.combos, B.games) : []), [A, B]);

  // ---- 不同赛事对比 ----
  const eventSummaries = useMemo(() => byEvent.map((ev) => {
    const n = ev.games.length;
    const hs = [...heroStats(ev.games).values()];
    const bpOf = (s) => pct(s.picks + s.bans, n * 2);
    const t0 = hs.filter((s) => s.picks + s.bans >= 5 && bpOf(s) >= 70)
      .sort((a, b) => bpOf(b) - bpOf(a)).slice(0, 6);
    const mustBan = hs.filter((s) => s.bans >= 3 && pct(s.bans, n * 2) >= 40)
      .sort((a, b) => b.bans - a.bans).slice(0, 6);
    const combos = [...globalComboStats(ev.games).values()].sort((a, b) => b.picks - a.picks).slice(0, 6);
    return { ...ev, t0, mustBan, combos };
  }), [byEvent]);

  const compare = useMemo(() => {
    const per = byEvent.map((ev) => {
      const n = ev.games.length;
      const heroes = [...heroStats(ev.games).values()]
        .filter((s) => s.picks + s.bans > 0)
        .map((s) => ({ ...s, bp: pct(s.picks + s.bans, n * 2), winRate: pct(s.pickWins, s.picks) }))
        .sort((a, b) => b.bp - a.bp)
        .slice(0, 10);
      return { id: ev.id, name: ev.name, heroes };
    });
    const maxBp = new Map();
    for (const col of per) for (const h of col.heroes) maxBp.set(h.heroId, Math.max(maxBp.get(h.heroId) || 0, h.bp));
    const heroIds = [...maxBp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id]) => id);
    const rows = heroIds.map((heroId) => {
      const row = { heroId };
      for (const col of per) {
        const h = col.heroes.find((x) => x.heroId === heroId);
        row[`bp_${col.id}`] = h ? `${h.bp}%` : '—';
        row[`wr_${col.id}`] = h && h.picks > 0 ? `${h.winRate}%` : '—';
      }
      return row;
    });
    return { per, rows };
  }, [byEvent]);

  if (games.length === 0) return <div className="panel empty-hint">当前筛选下没有对局</div>;

  return (
    <>
      <Section
        title="同赛事 · 随时间/版本的推移"
        extra={
          <select value={trendEventId} onChange={(e) => setTrendEventId(e.target.value)}>
            {byEvent.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        }
      >
        <div className="filter-inline" style={{ marginBottom: 10 }}>
          <span className="mini-note">各月样本：</span>
          {months.map(([key, gs]) => (
            <span className="stat-chip" key={key}>{key} · {gs.length} 局</span>
          ))}
        </div>
        <div className="filter-inline" style={{ marginBottom: 10 }}>
          <span className="filter-label">对比月份</span>
          <select value={monthA} onChange={(e) => setMonthA(e.target.value)}>
            {months.map(([key]) => <option key={key} value={key}>{key}</option>)}
          </select>
          <span className="filter-label">→</span>
          <select value={monthB} onChange={(e) => setMonthB(e.target.value)}>
            <option value="">（仅看 {monthA}）</option>
            {months.map(([key]) => <option key={key} value={key}>{key}</option>)}
          </select>
        </div>

        {!A ? <div className="empty-hint">该赛事暂无按月可分的数据</div> : (
          <ShiftTables labelA={monthA || '—'} labelB={monthB || '—'} heroShift={heroShift} comboShift={comboShift} heroesById={heroesById} />
        )}
        <div className="mini-note">
          Ban-Pick 率 = (Pick+Ban) ÷ 2×当月局数；组合出现率分母 = 当月局数。变化榜按两个月的差值绝对值排序，用于发现「某月突然变强/变弱」的版本信号；英雄需两个月 Pick+Ban 各 ≥3 次、组合各 ≥2 次才参与排名。
        </div>
      </Section>

      <RoundCompareSection games={games} allGames={allGames} heroesById={heroesById} />

      <Section title="不同赛事对比">
        {eventSummaries.map((ev) => (
          <div className="event-summary" key={ev.id}>
            <div className="sub-title">{ev.name}（{ev.games.length} 局）</div>
            <div className="three-col">
              <div>
                <div className="mini-note" title="Ban-Pick 率 ≥ 70%（Pick+Ban ≥ 5 次）视为版本 T0 级">T0 候选（Ban-Pick率≥70%）</div>
                {ev.t0.length === 0 ? <div className="empty-hint">暂无</div> : (
                  <div className="chip-list">
                    {ev.t0.map((s) => (
                      <span className="stat-chip" key={s.heroId}>
                        <HeroAvatar hero={heroesById[s.heroId]} size={18} />
                        {heroesById[s.heroId]?.name ?? s.heroId}
                        <b>{pct(s.picks + s.bans, ev.games.length * 2)}%</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mini-note" title="Ban 率 ≥ 40%（Ban ≥ 3 次）视为非 Ban 必选倾向">非 Ban 必选倾向（Ban率≥40%）</div>
                {ev.mustBan.length === 0 ? <div className="empty-hint">暂无</div> : (
                  <div className="chip-list">
                    {ev.mustBan.map((s) => (
                      <span className="stat-chip" key={s.heroId}>
                        <HeroAvatar hero={heroesById[s.heroId]} size={18} />
                        {heroesById[s.heroId]?.name ?? s.heroId}
                        <b>{pct(s.bans, ev.games.length * 2)}%</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mini-note">热门组合 TOP6</div>
                {ev.combos.length === 0 ? <div className="empty-hint">暂无</div> : (
                  <div className="chip-list">
                    {ev.combos.map((c) => (
                      <span className="stat-chip" key={`${c.heroA}|${c.heroB}`}>
                        <HeroAvatar hero={heroesById[c.heroA]} size={18} />
                        {heroesById[c.heroA]?.name ?? c.heroA}
                        <span className="combo-plus">+</span>
                        <HeroAvatar hero={heroesById[c.heroB]} size={18} />
                        {heroesById[c.heroB]?.name ?? c.heroB}
                        <b>{c.picks}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        <div className="sub-title" style={{ marginTop: 14 }}>英雄 Ban-Pick 率 / 胜率 跨赛事对比</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>英雄</th>
                {compare.per.map((col) => (
                  <th key={col.id} colSpan={2}>{col.name}</th>
                ))}
              </tr>
              <tr>
                <th></th>
                {compare.per.map((col) => (
                  <React.Fragment key={col.id}>
                    <th className="mini-note">BP率</th>
                    <th className="mini-note">胜率</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {compare.rows.map((r) => (
                <tr key={r.heroId}>
                  <td><HeroName heroesById={heroesById} id={r.heroId} /></td>
                  {compare.per.map((col) => (
                    <React.Fragment key={col.id}>
                      <td className="num blue-text">{r[`bp_${col.id}`]}</td>
                      <td className="num">{r[`wr_${col.id}`]}</td>
                    </React.Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mini-note">列为各赛事 Ban-Pick 率 TOP10 英雄的并集（最多 15 名）；「—」表示该英雄在该赛事未出现或未进入 TOP10。</div>
      </Section>
    </>
  );
}
