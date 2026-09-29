import { getFlow, winsNeeded, isBlindDecider } from './rules.js';
import { validateAct } from './validate.js';
import { DEFAULT_PLAYERS } from '../data/constants.js';

export const STORAGE_KEY = 'kpl-bp-v1';

export function createInitial() {
  return {
    phase: 'setup', // setup | draft | finished
    bo: 5,
    blue: { name: '蓝方', players: [...DEFAULT_PLAYERS] },
    red: { name: '红方', players: [...DEFAULT_PLAYERS] },
    blueScore: 0,
    redScore: 0,
    games: [], // 已完成的局
    current: null, // 进行中的局 { blind, actions:[{type,side,hero,player?}] }
  };
}

function makeCurrent(blind) {
  return { blind, actions: [] };
}

/** 从已完成小局统计每个选手用过的英雄（全局 BP 锁定依据）。
 *  player 为 -1（该选手不在当前阵容中，逐局换人后的历史局可能出现）时跳过。 */
export function usedHeroesByPlayer(games) {
  const res = {
    blue: Array.from({ length: 5 }, () => new Set()),
    red: Array.from({ length: 5 }, () => new Set()),
  };
  for (const g of games) {
    for (const side of ['blue', 'red']) {
      for (const p of g[`${side}Picks`] || []) {
        if (p.player < 0 || p.player > 4) continue;
        res[side][p.player].add(p.hero);
      }
    }
  }
  return res;
}

/** 该阵营在本系列赛历史局已用过的全部英雄（全局 BP 整队锁定依据，按蓝红视角） */
export function usedHeroesBySide(games) {
  const res = { blue: new Set(), red: new Set() };
  for (const g of games) {
    for (const side of ['blue', 'red']) {
      for (const p of g[`${side}Picks`] || []) res[side].add(p.hero);
    }
  }
  return res;
}

export function picksOf(game, side) {
  return game.actions.filter((a) => a.type === 'pick' && a.side === side)
    .map((a) => ({ player: a.player, hero: a.hero }));
}

export function bansOf(game, side) {
  return game.actions.filter((a) => a.type === 'ban' && a.side === side).map((a) => a.hero);
}

function toRecordedGame(cur) {
  return {
    blind: cur.blind,
    winner: null, // 由 FINISH_GAME 填充
    blueBans: bansOf(cur, 'blue'),
    redBans: bansOf(cur, 'red'),
    bluePicks: picksOf(cur, 'blue'),
    redPicks: picksOf(cur, 'red'),
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'SETUP': {
      const { bo, blue, red } = action;
      return {
        ...state, bo, blue, red,
        blueScore: 0, redScore: 0, games: [],
        current: makeCurrent(isBlindDecider(bo, 1)), phase: 'draft',
      };
    }

    case 'ACT': {
      const cur = state.current;
      if (!cur || state.phase !== 'draft') return state;
      const act = { kind: action.kind, side: action.side, hero: action.hero, player: action.player };
      const sideUsed = usedHeroesBySide(state.games);
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

    // 从"系列赛结束"退回上一局，重新标记胜者
    case 'UNDO_LAST_GAME': {
      if (state.phase !== 'finished' || state.games.length === 0) return state;
      const last = state.games[state.games.length - 1];
      const winner = last.winner;
      return {
        ...state,
        phase: 'draft',
        games: state.games.slice(0, -1),
        blueScore: state.blueScore - (winner === 'blue' ? 1 : 0),
        redScore: state.redScore - (winner === 'red' ? 1 : 0),
        current: { blind: last.blind, actions: last.actions },
      };
    }

    // 互换/移动本局已选英雄的选手归属（a、b 为同侧位置下标）：
    // 双方均有英雄则互换，仅一方有则移动到空位；换向后违反全局 BP 锁定时拒绝
    case 'SWAP_PLAYERS': {
      const cur = state.current;
      const { side, a, b } = action;
      if (!cur || state.phase !== 'draft' || !['blue', 'red'].includes(side)) return state;
      if (![a, b].every((x) => Number.isInteger(x) && x >= 0 && x <= 4) || a === b) return state;
      const actions = cur.actions.map((act) => {
        if (act.type !== 'pick' || act.side !== side) return act;
        if (act.player === a) return { ...act, player: b };
        if (act.player === b) return { ...act, player: a };
        return act;
      });
      const usedMap = usedHeroesByPlayer(state.games);
      const ok = actions.every((act) =>
        act.type !== 'pick' || cur.blind || !usedMap[act.side][act.player]?.has(act.hero));
      if (!ok) return state;
      return { ...state, current: { ...cur, actions } };
    }

    case 'RESTART_GAME': {
      if (!state.current) return state;
      return { ...state, current: makeCurrent(state.current.blind) };
    }

    case 'FINISH_GAME': {
      const cur = state.current;
      if (!cur || state.phase !== 'draft') return state;
      if (cur.actions.length !== getFlow(cur.blind).length) return state;

      // 保留原始步骤，便于"结束后退回上一局重新标记胜者"
      const game = { ...toRecordedGame(cur), winner: action.winner, actions: cur.actions };
      const games = [...state.games, game];
      const blueScore = state.blueScore + (action.winner === 'blue' ? 1 : 0);
      const redScore = state.redScore + (action.winner === 'red' ? 1 : 0);

      if (Math.max(blueScore, redScore) >= winsNeeded(state.bo)) {
        return { ...state, games, blueScore, redScore, current: null, phase: 'finished' };
      }
      // 下一局若为 BO7 决胜局则自动盲选（KPL 规则，BO5/BO3 末局为普通局）
      const nextBlind = isBlindDecider(state.bo, games.length + 1);
      return { ...state, games, blueScore, redScore, current: makeCurrent(nextBlind), phase: 'draft' };
    }

    case 'NEW_SERIES': {
      // 保留队伍与赛制配置，回到设置页
      return {
        ...createInitial(),
        bo: state.bo,
        blue: state.blue, red: state.red,
      };
    }

    default:
      return state;
  }
}

/** 旧存档兼容：巅峰对决仅 BO7 第 7 局，纠正下一局的盲选标记（未开局的局才纠正）。
 *  曾有"巅峰对决"手动开关（存档字段 blindDecider），移除后统一按 KPL 规则自动触发——
 *  旧存档若关着开关且 BO7 未开局第 7 局，加载后自动转为盲选 */
function normalizeLoaded(s) {
  if (!s || s.phase !== 'draft' || !s.current) return s;
  const gameNo = (s.games?.length ?? 0) + 1;
  const shouldBlind = isBlindDecider(s.bo, gameNo);
  if (s.current.blind !== shouldBlind && s.current.actions.length === 0) {
    return { ...s, current: makeCurrent(shouldBlind) };
  }
  return s;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && ['setup', 'draft', 'finished'].includes(s.phase)) return normalizeLoaded(s);
    }
  } catch { /* 忽略损坏的存档 */ }
  return createInitial();
}
