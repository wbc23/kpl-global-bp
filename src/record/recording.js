import { getFlow, winsNeeded, isBlindDecider } from '../bp/rules.js';
import { validateAct } from '../bp/validate.js';
import { usedHeroesByPlayer, usedHeroesBySide } from '../bp/store.js';
import { sideUsedFromGames, effRoster, perspectiveGames } from './checks.js';

// perspectiveGames 移至 checks.js（纯函数、node 可直测）；保留导出以免外部引用失效
export { perspectiveGames };
import { LANE_BADGES } from '../data/constants.js';
import heroesData from '../data/heroes.json';

/**
 * 比赛录入状态机。
 * 真实比赛中蓝红方逐局互换，因此每局记录 blueFirst（系列赛队伍1是否执蓝）；
 * 全局锁定校验与队伍面板通过视角映射把历史局换算到"当前局的蓝红视角"，
 * 历史对局面板（toViewState 的 history）按当局真实蓝红方展示（与回放一致）。
 *
 * meta: { eventId, stage, date, bo, team1:{id,name}, team2:{id,name}, roster1:[5], roster2:[5], note }
 * games: [{ blueFirst: 1|2, blind, winner:'blue'|'red', roster1?:[5], roster2?:[5], actions:[...] }]
 *   roster1/2 为该局实际阵容（可在 BP 中逐局更换选手）；缺省表示与 meta 的系列赛阵容一致
 * current: { blueFirst, blind, roster1:[5], roster2:[5], actions:[...] }
 */
export function createRecording(meta) {
  return {
    phase: 'recording', meta: { ...meta, sessionId: newSessionId() }, games: [],
    current: {
      blueFirst: 1, blind: isBlindDecider(meta.bo, 1),
      roster1: [...meta.roster1], roster2: [...meta.roster2], actions: [],
    },
  };
}

/** 从已保存系列赛取一局构造"单局 BP 编辑"状态：此前各局作为全局锁定上下文，仅编辑该局 */
export function createEditRecording(series, game) {
  const meta = {
    eventId: series.eventId, stage: series.stage, date: series.date, bo: series.bo,
    team1: series.team1, team2: series.team2,
    roster1: series.roster1, roster2: series.roster2,
  };
  const games = series.games
    .filter((g) => g.gameNo < game.gameNo)
    .map((g) => ({
      blueFirst: g.blue1 ? 1 : 2, blind: g.blind, winner: g.winner, actions: g.draft,
      roster1: g.roster1, roster2: g.roster2,
    }));
  return {
    phase: 'recording', meta, games,
    current: {
      blueFirst: game.blue1 ? 1 : 2, blind: game.blind,
      roster1: [...(game.roster1 || series.roster1)], roster2: [...(game.roster2 || series.roster2)],
      actions: game.draft.map((a) => ({ ...a })),
    },
  };
}

/** 从已保存系列赛构造"继续录入"状态：保留全部已录局，接着录下一局。
 *  蓝红按逐局轮换延续（以最后一局的 blueFirst 取反为准）；胜场已达标的系列赛不应调用。
 *  meta.baseGames 记录会话建立时库内的局数：保存时只尾部追加该局数之后的对局，
 *  会话期间通过回放修正的旧局不会被草稿里的副本覆盖（见 saveSeriesToDb）。 */
export function createContinueRecording(series) {
  const meta = {
    eventId: series.eventId, stage: series.stage, date: series.date, bo: series.bo,
    team1: series.team1, team2: series.team2,
    roster1: series.roster1, roster2: series.roster2,
    scheduleId: null,
    continueSeriesId: series.id,
    baseGames: series.games.length,
    sessionId: newSessionId(),
  };
  const games = series.games.map((g) => ({
    blueFirst: g.blue1 ? 1 : 2, blind: g.blind, winner: g.winner, actions: g.draft,
    roster1: g.roster1, roster2: g.roster2,
  }));
  const last = series.games[series.games.length - 1];
  const nextBlueFirst = last ? (last.blue1 ? 2 : 1) : 1;
  const nextGameNo = games.length + 1;
  // 下一局默认沿用末局实际阵容（换人通常延续，与 FINISH_GAME 行为一致；
  // null = 系列赛阵容）。此前用系列赛首发，会把末局的换人悄悄换回
  const nextRoster1 = effRoster(last?.roster1, series.roster1);
  const nextRoster2 = effRoster(last?.roster2, series.roster2);
  return {
    phase: 'recording', meta, games,
    current: {
      blueFirst: nextBlueFirst, blind: isBlindDecider(series.bo, nextGameNo),
      roster1: [...nextRoster1], roster2: [...nextRoster2], actions: [],
    },
  };
}

export function teamWins(games, teamIdx) {
  return games.filter((g) => (g.winner === 'blue' ? g.blueFirst : g.blueFirst === 1 ? 2 : 1) === teamIdx).length;
}

/** 某队在本局的实际阵容（可能已逐局更换），缺省回退到系列赛阵容 */
export function curRosterOf(state, team) {
  const key = team === 1 ? 'roster1' : 'roster2';
  const cur = state.current;
  return cur && Array.isArray(cur[key]) ? cur[key] : state.meta[key];
}

/** 若把本局阵容改成给定值，当前已选英雄中会触犯全局 BP 锁定的步骤（用于换人前的预检） */
export function rosterLockConflicts(rec, roster1, roster2) {
  const cur = rec.current;
  if (!cur) return [];
  const usedMap = usedHeroesByPlayer(perspectiveGames(rec.games, cur.blueFirst, roster1, roster2, rec.meta.roster1, rec.meta.roster2));
  const out = [];
  for (const a of cur.actions) {
    if (a.type !== 'pick' || cur.blind) continue;
    if (usedMap[a.side]?.[a.player]?.has(a.hero)) out.push(a);
  }
  return out;
}

/** 构造与模拟器同构的视图状态（蓝方=当前局执蓝战队） */
export function toViewState(rec) {
  const { meta } = rec;
  const cur = rec.current;
  const blueIs1 = cur.blueFirst === 1;
  const teams = blueIs1 ? [meta.team1, meta.team2] : [meta.team2, meta.team1];
  // 当前局阵容（可能已在 BP 中逐局调整过选手）
  const curRoster1 = cur.roster1 || meta.roster1;
  const curRoster2 = cur.roster2 || meta.roster2;
  const rosters = blueIs1 ? [curRoster1, curRoster2] : [curRoster2, curRoster1];
  // 历史对局面板按"当局真实蓝红方"展示（与回放一致），不做当前局视角换算；
  // 比分按系列赛队伍1:队伍2 累计，跨局稳定
  let w1 = 0;
  let w2 = 0;
  const history = rec.games.map((g) => {
    const rosterOf = (team) => {
      const r = team === 1 ? g.roster1 : g.roster2;
      return Array.isArray(r) ? r : (team === 1 ? meta.roster1 : meta.roster2);
    };
    const blueRoster = rosterOf(g.blueFirst);
    const redRoster = rosterOf(g.blueFirst === 1 ? 2 : 1);
    const sidePicks = (side, roster) => g.actions
      .filter((a) => a.type === 'pick' && a.side === side)
      .map((a) => ({ player: a.player, hero: a.hero, name: roster[a.player] }));
    const winnerTeam = g.winner === 'blue' ? g.blueFirst : (g.blueFirst === 1 ? 2 : 1);
    if (winnerTeam === 1) w1 += 1; else w2 += 1;
    const gBlueIs1 = g.blueFirst === 1;
    return {
      blind: g.blind,
      winner: g.winner,
      blueName: gBlueIs1 ? meta.team1.name : meta.team2.name,
      redName: gBlueIs1 ? meta.team2.name : meta.team1.name,
      blueBans: g.actions.filter((a) => a.type === 'ban' && a.side === 'blue').map((a) => a.hero),
      redBans: g.actions.filter((a) => a.type === 'ban' && a.side === 'red').map((a) => a.hero),
      bluePicks: sidePicks('blue', blueRoster),
      redPicks: sidePicks('red', redRoster),
      score: [w1, w2],
    };
  });
  return {
    phase: 'draft',
    bo: meta.bo,
    blue: { name: teams[0].name, players: rosters[0] },
    red: { name: teams[1].name, players: rosters[1] },
    blueScore: teamWins(rec.games, blueIs1 ? 1 : 2),
    redScore: teamWins(rec.games, blueIs1 ? 2 : 1),
    games: perspectiveGames(rec.games, cur.blueFirst, curRoster1, curRoster2, meta.roster1, meta.roster2),
    history,
    current: cur,
  };
}

export function recordingReducer(state, action) {
  switch (action.type) {
    case '@@RESET':
      return action.recording ?? null;

    case 'ACT': {
      const cur = state.current;
      if (!cur || state.phase !== 'recording') return state;
      const act = { kind: action.kind, side: action.side, hero: action.hero, player: action.player };
      const sideUsed = usedHeroesBySide(perspectiveGames(state.games, cur.blueFirst, curRosterOf(state, 1), curRosterOf(state, 2), state.meta.roster1, state.meta.roster2));
      const ok = validateAct(
        { actions: cur.actions, blind: cur.blind, sideLocks: (side) => sideUsed[side] },
        act
      );
      if (!ok) return state;
      return {
        ...state,
        current: { ...cur, actions: [...cur.actions, { type: act.kind, side: act.side, hero: act.hero, player: act.player }] },
      };
    }

    case 'UNDO': {
      const cur = state.current;
      if (!cur || cur.actions.length === 0) return state;
      return { ...state, current: { ...cur, actions: cur.actions.slice(0, -1) } };
    }

    // 从"录入完成"退回上一局，重新标记胜者（点错决胜局胜者时挽回）
    case 'UNDO_LAST_GAME': {
      if (state.phase !== 'done' || state.games.length === 0) return state;
      const last = state.games[state.games.length - 1];
      const { winner, ...rest } = last;
      return { ...state, phase: 'recording', games: state.games.slice(0, -1), current: { ...rest } };
    }

    // 互换/移动本局已选英雄的选手归属（a、b 为同侧位置下标）：
    // 双方均有英雄则互换，仅一方有则移动到空位；换向后违反全局 BP 锁定时拒绝
    case 'SWAP_PLAYERS': {
      const cur = state.current;
      const { side, a, b } = action;
      if (!cur || state.phase !== 'recording' || !['blue', 'red'].includes(side)) return state;
      if (![a, b].every((x) => Number.isInteger(x) && x >= 0 && x <= 4) || a === b) return state;
      const actions = cur.actions.map((act) => {
        if (act.type !== 'pick' || act.side !== side) return act;
        if (act.player === a) return { ...act, player: b };
        if (act.player === b) return { ...act, player: a };
        return act;
      });
      const usedMap = usedHeroesByPlayer(perspectiveGames(state.games, cur.blueFirst, curRosterOf(state, 1), curRosterOf(state, 2), state.meta.roster1, state.meta.roster2));
      const ok = actions.every((act) =>
        act.type !== 'pick' || cur.blind || !usedMap[act.side][act.player]?.has(act.hero));
      if (!ok) return state;
      return { ...state, current: { ...cur, actions } };
    }

    // 更换本局出场选手（team: 1|2，roster: 5 个非空且互不重复的选手名）。
    // 已选英雄按位置保留；若换人后当前局某选手触犯全局 BP 锁定则拒绝
    case 'SET_GAME_ROSTER': {
      const cur = state.current;
      if (!cur || state.phase !== 'recording') return state;
      const { team, roster } = action;
      if (![1, 2].includes(team)) return state;
      const names = Array.isArray(roster) ? roster.map((n) => String(n ?? '').trim()) : null;
      if (!names || names.length !== 5 || names.some((n) => !n) || new Set(names).size !== 5) return state;
      const next1 = team === 1 ? names : curRosterOf(state, 1);
      const next2 = team === 2 ? names : curRosterOf(state, 2);
      if (rosterLockConflicts(state, next1, next2).length > 0) return state;
      return { ...state, current: { ...cur, [team === 1 ? 'roster1' : 'roster2']: names } };
    }

    case 'RESTART_GAME': {
      if (!state.current) return state;
      return { ...state, current: { ...state.current, actions: [] } };
    }

    // 调整本局蓝方归属（默认逐局轮换）。已点步骤后也允许交换：已录步骤/顺序不变，
    // 仅队伍-蓝红映射翻转（页面会先确认，并用 blueFlipConflicts 提示冲突）。
    // 兜底校验：换向后已选英雄不得与该方历史局已用英雄重复（整队锁定），冲突则拒绝
    case 'SET_BLUE': {
      const cur = state.current;
      if (!cur || ![1, 2].includes(action.team) || cur.blueFirst === action.team) return state;
      if (!cur.blind && cur.actions.length > 0) {
        const used = sideUsedFromGames(state.games, action.team);
        const bad = cur.actions.some((a) => a.type === 'pick' && a.hero != null && used[a.side]?.has(a.hero));
        if (bad) return state;
      }
      return { ...state, current: { ...cur, blueFirst: action.team } };
    }

    // 测试辅助：随机补全本局剩余 Ban/Pick（校验与 ACT 完全一致：流程顺序、本局唯一性、
    // 全局锁定、选手位不重复；Pick 位置优先按英雄分路，与选人面板推荐一致。胜者仍需手动标记）
    case 'QUICK_COMPLETE': {
      const cur = state.current;
      if (!cur || state.phase !== 'recording') return state;
      const flow = getFlow(cur.blind);
      if (cur.actions.length >= flow.length) return state;
      const gamesCtx = perspectiveGames(state.games, cur.blueFirst, curRosterOf(state, 1), curRosterOf(state, 2), state.meta.roster1, state.meta.roster2);
      const sideUsed = usedHeroesBySide(gamesCtx);
      const usedMap = usedHeroesByPlayer(gamesCtx);
      const laneIndexOf = (lane) => LANE_BADGES.findIndex((b) => b.full === lane);
      let actions = [...cur.actions];
      const gameTaken = new Set();                            // 本局已出现过的英雄（常规局全局唯一）
      const ownPicked = { blue: new Set(), red: new Set() };  // 盲选：己方已选
      const pickedPos = { blue: new Set(), red: new Set() };  // 本局各阵营已占用的选手位
      for (const a of actions) {
        if (a.hero != null) gameTaken.add(a.hero);
        if (a.type === 'pick') {
          pickedPos[a.side].add(a.player);
          if (a.hero != null) ownPicked[a.side].add(a.hero);
        }
      }
      const rand = (n) => Math.floor(Math.random() * n);
      for (let i = actions.length; i < flow.length; i++) {
        const step = flow[i];
        if (step.type === 'ban') {
          const cands = heroesData.filter((h) => !gameTaken.has(h.id));
          if (cands.length === 0) return state;
          const h = cands[rand(cands.length)];
          actions = [...actions, { type: 'ban', side: step.side, hero: h.id }];
          gameTaken.add(h.id);
          continue;
        }
        const freePos = [0, 1, 2, 3, 4].filter((p) => !pickedPos[step.side].has(p));
        const posOk = (h, p) => cur.blind || !usedMap[step.side][p]?.has(h.id);
        const cands = heroesData.filter((h) =>
          (cur.blind ? !ownPicked[step.side].has(h.id) : !gameTaken.has(h.id) && !sideUsed[step.side].has(h.id)) &&
          freePos.some((p) => posOk(h, p)));
        if (cands.length === 0) return state;
        const h = cands[rand(cands.length)];
        let pos = (h.lanes || []).map(laneIndexOf).find((idx) => idx !== -1 && freePos.includes(idx) && posOk(h, idx));
        if (pos === undefined) pos = freePos.find((p) => posOk(h, p));
        if (pos === undefined) return state;
        actions = [...actions, { type: 'pick', side: step.side, hero: h.id, player: pos }];
        pickedPos[step.side].add(pos);
        gameTaken.add(h.id);
        ownPicked[step.side].add(h.id);
      }
      return { ...state, current: { ...cur, actions } };
    }

    case 'FINISH_GAME': {
      const cur = state.current;
      if (!cur || state.phase !== 'recording') return state;
      if (cur.actions.length !== getFlow(cur.blind).length) return state;

      const roster1 = curRosterOf(state, 1);
      const roster2 = curRosterOf(state, 2);
      const games = [...state.games, { ...cur, roster1, roster2, winner: action.winner }];
      const w1 = teamWins(games, 1);
      const w2 = teamWins(games, 2);

      if (Math.max(w1, w2) >= winsNeeded(state.meta.bo)) {
        return { ...state, games, current: null, phase: 'done' };
      }
      const nextBlind = isBlindDecider(state.meta.bo, games.length + 1); // 仅 BO7 决胜局自动巅峰对决
      const nextBlueFirst = cur.blueFirst === 1 ? 2 : 1; // 蓝红逐局轮换
      // 下一局默认沿用本局阵容（换人通常延续），仍可再次更换
      return {
        ...state, games,
        current: { blueFirst: nextBlueFirst, blind: nextBlind, roster1: [...roster1], roster2: [...roster2], actions: [] },
      };
    }

    case 'SAVED': {
      // 完整保存（done）与部分保存（recording，"保存已录 X 局"）都会走到这里结束会话
      if (state.phase !== 'done' && state.phase !== 'recording') return state;
      return { ...state, phase: 'saved' };
    }

    default:
      return state;
  }
}

/** 兼容旧草稿/旧数据：把当前局按现行规则纠正盲选标记。
 *  规则变化（巅峰对决仅 BO7 第 7 局）后，旧草稿可能把 BO5 第 5 局置为盲选；
 *  仅在本局尚未开始时纠正，已录步骤一律不动。 */
export function normalizeBlind(rec) {
  if (!rec || !rec.current || !rec.meta) return rec;
  const gameNo = (rec.games?.length ?? 0) + 1;
  const shouldBlind = isBlindDecider(rec.meta.bo, gameNo);
  if (rec.current.blind !== shouldBlind && rec.current.actions.length === 0) {
    return { ...rec, current: { ...rec.current, blind: shouldBlind } };
  }
  return rec;
}

/* ---------- 录入草稿：防止录入中途被打断后整场重录。
   多槽位存储（key=meta.sessionId），支持同时进行多场录入；旧版单键草稿首次读取时迁移 ---------- */
export const DRAFT_KEY = 'kpl-bp-record-draft'; // 旧版单槽（仅用于迁移）
export const DRAFTS_KEY = 'kpl-bp-record-drafts';

export const newSessionId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

/** 草稿是否已有可展示的进度（没有任何已录内容的出现在列表上只会造成干扰） */
export function hasDraftProgress(rec) {
  return !!rec && (rec.games.length > 0 || !!(rec.current && rec.current.actions.length > 0));
}

function readDraftStore() {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    const store = raw ? JSON.parse(raw) : {};
    // 旧版单槽迁移：读出后并入多槽存储并删除旧键
    const legacy = localStorage.getItem(DRAFT_KEY);
    if (legacy) {
      try {
        const r = JSON.parse(legacy);
        if (r && r.meta) {
          const sid = r.meta.sessionId || newSessionId();
          r.meta.sessionId = sid;
          store[sid] = { ...r, savedAt: Date.now() };
        }
      } catch { /* 忽略损坏的旧草稿 */ }
      localStorage.removeItem(DRAFT_KEY);
      writeDraftStore(store);
    }
    return store && typeof store === 'object' ? store : {};
  } catch { return {}; }
}

function writeDraftStore(store) {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(store)); } catch { /* 存储满等异常不阻断录入 */ }
}

/** 覆盖保存一场录入会话的草稿（按 meta.sessionId 定位槽位） */
export function saveDraft(rec) {
  if (!rec?.meta?.sessionId) return;
  try {
    const store = readDraftStore();
    store[rec.meta.sessionId] = { ...rec, savedAt: Date.now() };
    writeDraftStore(store);
  } catch { /* ignore */ }
}

/** 删除指定会话的草稿槽位 */
export function clearDraft(sessionId) {
  if (!sessionId) return;
  try {
    const store = readDraftStore();
    if (sessionId in store) {
      delete store[sessionId];
      writeDraftStore(store);
    }
  } catch { /* ignore */ }
}

/** 读取全部可继续的草稿（结构校验 + 有进度过滤），按最近保存倒序 */
export function loadDrafts() {
  const store = readDraftStore();
  const okShape = (r) => r && ['recording', 'done'].includes(r.phase)
    && r.meta && r.meta.team1 && r.meta.team2 && r.meta.sessionId
    && Array.isArray(r.meta.roster1) && Array.isArray(r.meta.roster2)
    && Array.isArray(r.games)
    && (!r.current || Array.isArray(r.current.actions));
  return Object.values(store)
    .filter((r) => okShape(r) && hasDraftProgress(r))
    .map((r) => normalizeBlind(r))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
