import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getFlow } from '../bp/rules.js';
import { usedHeroesByPlayer, usedHeroesBySide, picksOf } from '../bp/store.js';
import { ROLES, LANES, SIDE, LANE_BADGES } from '../data/constants.js';
import { heroMatch } from '../data/heroSearch.js';
import heroesData from '../data/heroes.json';
import HeroAvatar from './HeroAvatar.jsx';
import PlayerPicker from './PlayerPicker.jsx';

const heroes = heroesData;

/** 英雄池：筛选（职业/分路）+ 搜索（支持方向键选择/回车确认）+ Ban/Pick 操作（含空禁） */
export default function PoolPanel({ state, dispatch }) {
  const cur = state.current;
  const flow = getFlow(cur.blind);
  const stepIdx = cur.actions.length;
  const step = flow[stepIdx];

  const [role, setRole] = useState('全部');
  const [lane, setLane] = useState('全部');
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(null); // 键盘高亮：方向键选择的英雄下标
  const [pendingHero, setPendingHero] = useState(null);
  const searchRef = useRef(null);
  const gridRef = useRef(null);

  const usedMap = useMemo(() => usedHeroesByPlayer(state.games), [state.games]);
  // 全局 BP 整队锁定：该方任一选手在历史局用过的英雄，本方不可再选（对手不受影响）
  const sideUsed = useMemo(() => usedHeroesBySide(state.games), [state.games]);

  const pickedPlayers = {
    blue: new Set(picksOf(cur, 'blue').map((p) => p.player)),
    red: new Set(picksOf(cur, 'red').map((p) => p.player)),
  };

  const actionOfHero = (id) => cur.actions.find((a) => a.hero === id);

  // 本方在历史局用过该英雄 → 常规局整队禁选
  const isSideLocked = (h) => {
    if (!step || step.type !== 'pick' || cur.blind) return false;
    return sideUsed[step.side].has(h.id);
  };

  const isDisabled = (h) => {
    if (!step) return true;
    const takenByOwn = cur.actions.some((a) => a.side === step.side && a.hero === h.id);
    if (step.type === 'ban') return cur.actions.some((a) => a.hero === h.id);
    if (cur.blind) return takenByOwn;
    if (cur.actions.some((a) => a.hero === h.id)) return true;
    return isSideLocked(h);
  };

  // 按英雄分路找可用选手（主分路优先）：本局未选过且未被全局 BP 锁定
  const recPlayerIdx = (h) => {
    for (const lane of h.lanes || []) {
      const i = LANE_BADGES.findIndex((b) => b.full === lane);
      if (i !== -1 && !pickedPlayers[step.side].has(i) && (cur.blind || !usedMap[step.side][i].has(h.id))) return i;
    }
    return null;
  };

  // 本系列赛此前各局用过该英雄的选手（按蓝红视角展示）
  const seriesUsedOf = (heroId) => {
    const res = [];
    state.games.forEach((g, gi) => {
      for (const s of ['blue', 'red']) {
        for (const p of g[`${s}Picks`] || []) {
          if (p.hero === heroId) {
            const who = p.name ?? (p.player >= 0 ? state[s].players[p.player] : '?');
            res.push({ side: s, who, game: gi + 1 });
          }
        }
      }
    });
    return res;
  };

  const list = heroes.filter(
    (h) =>
      (role === '全部' || h.roles.includes(role)) &&
      (lane === '全部' || h.lanes.includes(lane)) &&
      (q === '' || heroMatch(h, q))
  );

  // 键盘高亮滚动到可见位置
  useEffect(() => {
    if (hi === null || !gridRef.current) return;
    gridRef.current.children[hi]?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  // 操作完成后把焦点还给搜索框，保证连续键盘输入
  const focusSearch = () => { requestAnimationFrame(() => searchRef.current?.focus()); };

  const doBan = (hero) => {
    dispatch({ type: 'ACT', kind: 'ban', side: step.side, hero });
    setQ('');
    setHi(null);
    focusSearch();
  };

  function onHeroClick(h) {
    if (!step || isDisabled(h)) return;
    if (step.type === 'ban') {
      doBan(h.id);
      return;
    }
    // Pick：有分路可用选手时直接按推荐入列，省去确认；无可用推荐（分路均被占/锁定）才手动指定
    const rec = recPlayerIdx(h);
    if (rec !== null) {
      dispatch({ type: 'ACT', kind: 'pick', side: step.side, hero: h.id, player: rec });
      setQ('');
      setHi(null);
      focusSearch();
    } else {
      setPendingHero(h);
    }
  }

  // 搜索框键盘操作：↓ 选中第一个 → ←/→/↑ 移动 → Enter 确认
  const onSearchKeyDown = (e) => {
    if (list.length === 0) return;
    const cols = gridRef.current
      ? (getComputedStyle(gridRef.current).gridTemplateColumns.match(/px/g) || []).length || 5
      : 5;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => (h === null ? 0 : Math.min(h + cols, list.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => (h === null ? null : h - cols < 0 ? null : Math.max(0, h - cols)));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHi((h) => (h === null ? null : h === 0 ? list.length - 1 : h - 1)); // 首尾环绕
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHi((h) => (h === null ? null : h === list.length - 1 ? 0 : h + 1));
    } else if (e.key === 'Enter') {
      if (hi !== null && list[hi]) {
        e.preventDefault();
        onHeroClick(list[hi]);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // 只清高亮，不触发上层界面的 Esc 退出
      setHi(null);
    }
  };

  return (
    <div className="panel pool-panel">
      <div className="filters">
        <div className="filter-group">
          <span className="filter-label">职业</span>
          {['全部', ...ROLES].map((r) => (
            <button key={r} className={`chip ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>{r}</button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">分路</span>
          {['全部', ...LANES].map((l) => (
            <button key={l} className={`chip ${lane === l ? 'on' : ''}`} onClick={() => setLane(l)}>{l}</button>
          ))}
        </div>
        <input
          ref={searchRef}
          className="search"
          placeholder="搜索英雄名/拼音（gy=关羽），↓选择 ←→移动 ⏎确认"
          value={q}
          onChange={(e) => { setQ(e.target.value.trim()); setHi(null); }}
          onKeyDown={onSearchKeyDown}
        />
      </div>

      <div className="pool-meta">
        共 {list.length} 名英雄可选{step && ` · 当前：${SIDE[step.side].label}${step.type === 'ban' ? '禁用' : '选择'}`}
        {step?.type === 'ban' && !cur.blind && (
          <button
            className="chip"
            style={{ marginLeft: 10 }}
            title="该队放弃本次 Ban，占位但不禁用英雄"
            onClick={() => doBan(null)}
          >
            空禁（跳过本条 Ban）
          </button>
        )}
      </div>

      <div className="pool-grid" ref={gridRef}>
        {list.map((h, idx) => {
          const act = actionOfHero(h.id);
          const disabled = isDisabled(h);
          const locked = disabled && isSideLocked(h);
          // 全局 BP 提示：仅当轮到"用过该英雄的一方"操作时展示锁定（对手回合该英雄照常可选）
          const usedAll = step?.type === 'pick' && !cur.blind ? seriesUsedOf(h.id) : [];
          const usedByActing = usedAll.filter((u) => u.side === step.side);
          const fmt = (arr) => arr.map((u) => `${SIDE[u.side].short}·${u.who}（第${u.game}局）`).join('、');
          let title = `${h.name}${h.title ? ' · ' + h.title : ''}｜${h.roles.join('/')}${h.lanes.length ? '｜' + h.lanes.join('/') : ''}`;
          if (usedAll.length) title += `｜全局BP：${fmt(usedAll)}已用`;
          if (locked) title += '，本方后续不可再选';
          return (
            <button
              key={h.id}
              className={`hero-card ${disabled ? 'off' : ''} ${act ? `taken-${act.side}` : ''} ${locked ? 'g-used' : ''} ${hi === idx ? 'kb-hi' : ''}`}
              onClick={() => onHeroClick(h)}
              disabled={disabled}
              title={title}
            >
              <HeroAvatar hero={h} size={56} />
              <span className="hero-card-name">{h.name}</span>
              {act?.type === 'ban' && <span className="mark-ban">✕</span>}
              {act?.type === 'pick' && <span className={`mark-pick mark-${act.side}`}>✓</span>}
              {locked && (
                <span className="mark-gused" title={`全局BP：${fmt(usedByActing)}已用，本方后续不可再选`}>已用</span>
              )}
            </button>
          );
        })}
        {list.length === 0 && <div className="pool-empty">没有符合条件的英雄</div>}
      </div>

      {pendingHero && step?.type === 'pick' && (
        <PlayerPicker
          hero={pendingHero}
          side={step.side}
          state={state}
          usedMap={usedMap}
          pickedPlayers={pickedPlayers}
          onClose={() => { setPendingHero(null); focusSearch(); }}
          onConfirm={(playerIdx) => {
            dispatch({ type: 'ACT', kind: 'pick', side: step.side, hero: pendingHero.id, player: playerIdx });
            setPendingHero(null);
            setQ(''); // 选人完成后清空搜索，方便下一个 Pick 直接输入
            focusSearch();
          }}
        />
      )}
    </div>
  );
}
