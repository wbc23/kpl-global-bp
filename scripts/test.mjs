/**
 * 纯函数回归测试（node scripts/test.mjs / npm test）
 *
 * 覆盖 BP 校验与统计口径的关键回归点，被测模块均为纯 JS（不引 heroes.json），
 * node 可直接导入：src/record/checks.js、src/bp/{rules,validate,store}.js、src/analysis/compute.js。
 * 改动 BP 规则、录入校验或分析口径后跑一遍；新增修复时请把回归场景补进来。
 */
import { getFlow } from '../src/bp/rules.js';
import { usedHeroesByPlayer } from '../src/bp/store.js';
import { heroMatch } from '../src/data/heroSearch.js';
import {
  sideUsedFromGames, blueFlipConflicts, editSaveConflicts, effRoster, perspectiveGames,
} from '../src/record/checks.js';
import {
  seriesRoundKeys, groupByRound, allTeamStats, comboStats,
} from '../src/analysis/compute.js';

let failed = 0;
let count = 0;
const ok = (name, cond, extra = '') => {
  count += 1;
  if (!cond) { failed += 1; console.log(`FAIL ${name}${extra ? ` :: ${extra}` : ''}`); }
  else console.log(`PASS ${name}`);
};

/* ================= BP 整体校验（checks.js） ================= */

// 构造一份合法的常规局 20 步（英雄用 900+ 假 id，校验只做集合比较）
function validFlowActions({ bluePickOverride = {} } = {}) {
  const acts = [];
  const picked = { blue: 0, red: 0 };
  let next = 900;
  const used = new Set();
  for (const step of getFlow(false)) {
    if (step.type === 'ban') {
      while (used.has(next)) next += 1;
      acts.push({ type: 'ban', side: step.side, hero: next, player: undefined });
      used.add(next);
      next += 1;
    } else {
      const hero = bluePickOverride[picked[step.side]] ?? next;
      acts.push({ type: 'pick', side: step.side, hero, player: picked[step.side] });
      picked[step.side] += 1;
      used.add(next);
      next += 1;
    }
  }
  return acts;
}

{
  const used = sideUsedFromGames([{ blueFirst: 2, actions: [{ type: 'pick', side: 'blue', hero: 105, player: 0 }] }], 2);
  ok('[checks] sideUsed：队伍2执蓝的历史pick在blue桶', used.blue.has(105) && !used.red.has(105));
}
{
  const actions = validFlowActions({ bluePickOverride: { 0: 105 } }); // 蓝方第1个pick=105
  const rec = {
    games: [{ blueFirst: 2, blind: false, actions: [{ type: 'pick', side: 'blue', hero: 105, player: 0 }] }],
    current: { blueFirst: 1, blind: false, actions: actions.slice(0, 5) },
  };
  const bad = blueFlipConflicts(rec, 2);
  ok('[checks] blueFlip：换向后撞整队锁定被检出', bad.length === 1 && bad[0].hero === 105, JSON.stringify(bad));
  ok('[checks] blueFlip：不换向无冲突', blueFlipConflicts(rec, 1).length === 0);
  ok('[checks] blueFlip：盲选局不检查', blueFlipConflicts({
    games: rec.games,
    current: { blueFirst: 1, blind: true, actions: [{ type: 'pick', side: 'blue', hero: 105, player: 0 }] },
  }, 2).length === 0);
}
{
  ok('[checks] editSave：合法流程通过', editSaveConflicts(
    { blueFirst: 1, blind: false, actions: validFlowActions() },
    [{ blue1: true, draft: [{ type: 'pick', side: 'red', hero: 800, player: 0 }] }],
  ).length === 0);
  ok('[checks] editSave：与后续局重复英雄被拦（含锁定文案）', (() => {
    const errs = editSaveConflicts(
      { blueFirst: 1, blind: false, actions: validFlowActions({ bluePickOverride: { 0: 105 } }) },
      [{ blue1: true, draft: [{ type: 'pick', side: 'blue', hero: 105, player: 2 }] }],
    );
    return errs.length === 1 && errs[0].includes('整队锁定');
  })());
  ok('[checks] editSave：流程顺序非法被拦', (() => {
    const acts = validFlowActions();
    acts[1] = { type: 'pick', side: acts[1].side, hero: 700, player: 0 };
    const errs = editSaveConflicts({ blueFirst: 1, blind: false, actions: acts }, []);
    return errs.length === 1 && errs[0].includes('不符合 BP 规则');
  })());
  ok('[checks] editSave：换向后撞后续局被拦', (() => {
    const acts = validFlowActions();
    const idx = acts.findIndex((a) => a.type === 'pick' && a.side === 'red');
    acts[idx] = { ...acts[idx], hero: 800 };
    const errs = editSaveConflicts(
      { blueFirst: 2, blind: false, actions: acts },
      [{ blue1: true, draft: [{ type: 'pick', side: 'blue', hero: 800, player: 0 }] }],
    );
    return errs.length === 1 && errs[0].includes('整队锁定');
  })());
  ok('[checks] editSave：盲选局不查锁定（流程仍校验）', (() => {
    const acts = Array.from({ length: 10 }, (_, i) => (
      { type: 'pick', side: i % 2 === 0 ? 'blue' : 'red', hero: 950 + i, player: Math.floor(i / 2) }
    ));
    return editSaveConflicts(
      { blueFirst: 1, blind: true, actions: acts },
      [{ blue1: true, draft: [{ type: 'pick', side: 'blue', hero: 950, player: 0 }] }],
    ).length === 0;
  })());
  ok('[checks] editSave：盲选局不产生锁定（编辑打满BO7的前几局不被盲选阵容误拦）', (() => {
    // 第 1 局常规局（合法流程，蓝方 pick 904,907,908,917,918）；others 含第 7 局盲选，
    // 盲选蓝方复用了第 1 局的招牌英雄 904/907 —— 不应误报整队锁定冲突
    const acts = validFlowActions();
    const blueHeroes = acts.filter((a) => a.type === 'pick' && a.side === 'blue').map((a) => a.hero);
    const blind7 = { blue1: true, blind: true, draft: [
      { type: 'pick', side: 'blue', hero: blueHeroes[0], player: 0 },
      { type: 'pick', side: 'red', hero: 950, player: 0 },
      { type: 'pick', side: 'blue', hero: blueHeroes[1], player: 1 },
      { type: 'pick', side: 'red', hero: 951, player: 1 },
    ] };
    return editSaveConflicts(
      { blueFirst: 1, blind: false, actions: acts },
      [{ blue1: true, blind: false, draft: [{ type: 'pick', side: 'red', hero: 960, player: 0 }] }, blind7],
    ).length === 0;
  })());
  ok('[checks] sideUsed：盲选局的 pick 不计入锁定集合', (() => {
    const used = sideUsedFromGames([
      { blueFirst: 1, blind: false, actions: [{ type: 'pick', side: 'blue', hero: 100, player: 0 }] },
      { blueFirst: 1, blind: true, actions: [{ type: 'pick', side: 'blue', hero: 101, player: 0 }] },
    ], 1);
    return used.blue.has(100) && !used.blue.has(101);
  })());
}

/* ================= 阵容 null 语义（#7） ================= */

{
  const A = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const B = ['sub', 'p2', 'p3', 'p4', 'p5'];
  const Q = ['q1', 'q2', 'q3', 'q4', 'q5'];
  ok('[roster] effRoster：null 回退系列赛阵容', effRoster(null, A) === A);
  ok('[roster] effRoster：显式阵容原样返回', effRoster(B, A) === B);
  // 历史局 null（=首发A）0号位 p1 用过 105；当前局 p1 已被 sub 换下 → 归属 p1、下标 -1、不锁任何当前选手
  const out = perspectiveGames(
    [{ blueFirst: 1, blind: false, winner: 'blue', roster1: null, roster2: null,
      actions: [{ type: 'pick', side: 'blue', hero: 105, player: 0 }] }],
    1, B, Q, A, Q,
  );
  const pick = out[0].bluePicks[0];
  ok('[roster] perspective：null局选手取自系列赛阵容（非当前局）', pick.name === 'p1' && pick.player === -1, JSON.stringify(pick));
  ok('[roster] perspective：不锁定当前局任何选手位', usedHeroesByPlayer(out).blue.every((s) => !s.has(105)));
  // 翻转映射：历史局队伍2执蓝(blueFirst=2)→红方=队伍1，其1号位 p2；当前局队伍1执蓝 → 出现在当前蓝方
  const out2 = perspectiveGames(
    [{ blueFirst: 2, blind: false, winner: 'red', roster1: null, roster2: null,
      actions: [{ type: 'pick', side: 'red', hero: 106, player: 1 }] }],
    1, A, Q, A, Q,
  );
  const pick2 = out2[0].bluePicks[0];
  ok('[roster] perspective：翻转映射+null回退（p2）', pick2.name === 'p2' && pick2.player === 1, JSON.stringify(pick2));
}

/* ================= 轮次归属（#4） ================= */

const mkRound = (seriesId, eventId, date, note = '', stage = '常规赛') => ({
  seriesId, eventId, date, note, stage,
  blue: { teamId: 1, teamName: 'A', picks: [] }, red: { teamId: 2, teamName: 'B', picks: [] },
  winnerSide: 'blue', bo: 5,
});
{
  const all = [
    mkRound(101, 1, '2026-06-17', '第一轮'), mkRound(102, 1, '2026-07-01'),
    mkRound(103, 1, '2026-07-09', '第二轮'), mkRound(104, 1, '2026-07-20'),
    mkRound(105, 1, '2026-09-01', '', '季后赛'),
    mkRound(201, 2, '2026-03-01'), mkRound(202, 2, '2026-03-10'), // 赛事2无标记
  ];
  const keys = seriesRoundKeys(all);
  const want = { 101: 'r1', 102: 'r1', 103: 'r2', 104: 'r2', 105: 'po', 201: 'other', 202: 'other' };
  ok('[round] 区间归属正确', Object.entries(want).every(([sid, k]) => keys.get(Number(sid)) === k), JSON.stringify([...keys.entries()]));
  const filtered = all.filter((g) => g.seriesId !== 101); // 模拟筛掉标记场
  const groups = groupByRound(filtered, all);
  ok('[round] 筛掉标记场后归属不漂移', groups.get('r1').length === 1 && groups.get('r1')[0].seriesId === 102);
  ok('[round] regular 只含常规赛轮', groups.get('regular').length === 3);
  ok('[round] 跨赛事不串轮次', (() => {
    const g2 = groupByRound(all.filter((x) => x.eventId === 2), all);
    return g2.get('other').length === 2 && g2.get('r2').length === 0 && g2.get('po').length === 0;
  })());
  ok('[round] 阿拉伯数字备注「第1轮/第2轮」同样识别', (() => {
    const all2 = [mkRound(301, 1, '2026-06-17', '第1轮'), mkRound(302, 1, '2026-07-01'), mkRound(303, 1, '2026-07-09', '第2轮')];
    const keys2 = seriesRoundKeys(all2);
    return keys2.get(301) === 'r1' && keys2.get(302) === 'r1' && keys2.get(303) === 'r2';
  })());
}

/* ================= 大场胜负门槛（#9） ================= */

{
  const game = (seriesId, bo, winnerIsTeam1) => ({
    seriesId, bo, note: '', stage: '常规赛', eventId: 1, date: '2026-07-01',
    winnerSide: winnerIsTeam1 ? 'blue' : 'red',
    blue: { teamId: 1, teamName: 'A', picks: [] }, red: { teamId: 2, teamName: 'B', picks: [] },
  });
  const games = [
    ...Array.from({ length: 2 }, () => game(1, 5, true)), game(1, 5, false),  // BO5 2:1 → 未分
    ...Array.from({ length: 3 }, () => game(2, 5, true)), game(2, 5, false),  // BO5 3:1 → 胜
    game(3, 3, true), game(3, 3, false),                                       // BO3 1:1 → 未分
    ...Array.from({ length: 4 }, () => game(4, 7, true)),
    ...Array.from({ length: 3 }, () => game(4, 7, false)),                     // BO7 4:3 → 胜
    game(5, 3, false), game(5, 3, false),                                      // BO3 0:2 → 负
  ];
  const st = new Map(allTeamStats(games));
  const t1 = st.get(1), t2 = st.get(2);
  ok('[series] t1：2胜1负2未分', t1.seriesWins === 2 && t1.seriesLosses === 1 && t1.seriesDraws === 2,
    `${t1.seriesWins}/${t1.seriesLosses}/${t1.seriesDraws}`);
  ok('[series] t2：1胜2负2未分', t2.seriesWins === 1 && t2.seriesLosses === 2 && t2.seriesDraws === 2,
    `${t2.seriesWins}/${t2.seriesLosses}/${t2.seriesDraws}`);
  ok('[series] BO5 2:1 领先不算胜', t1.seriesDraws === 2);
}

/* ================= 战队两位置组合按位置分列（#5） ================= */

{
  const gameOf = (heroes, won) => ({
    winnerSide: won ? 'blue' : 'red',
    blue: { teamId: 1, teamName: 'A', picks: heroes.map((hero, playerIdx) => ({ hero, playerIdx })) },
    red: { teamId: 2, teamName: 'B', picks: [] },
  });
  // 同一英雄对(100,101)两次出场：一次打 0-1（上野），一次打 2-4（中辅）→ 应分开两行
  const games = [
    gameOf([100, 101, 102, 103, 104], true),   // 100@0 101@1 → 100|101@0-1
    gameOf([105, 106, 100, 107, 101], false),  // 100@2 101@4 → 100|101@2-4
  ];
  const map = comboStats(games, 1);
  const e1 = map.get('100|101@0-1');
  const e2 = map.get('100|101@2-4');
  ok('[combo] 同英雄对不同位置分开两行', !!e1 && !!e2 && e1 !== e2, JSON.stringify([...map.keys()]));
  ok('[combo] 各行胜率独立（1胜0胜）', e1.picks === 1 && e1.wins === 1 && e2.picks === 1 && e2.wins === 0,
    JSON.stringify({ e1, e2 }));
  ok('[combo] 每局产生10个位置对条目', map.size === 20, String(map.size));
}

/* ================= 英雄搜索（heroMatch：只做子串匹配，无子序列） ================= */

{
  const H = {
    sikongzhen: { id: 1, name: '司空震', py: 'sikongzhen skz' },
    guanyu: { id: 2, name: '关羽', py: 'guanyu gy' },
    donghuangtaiyi: { id: 3, name: '东皇太一', py: 'donghuangtaiyi dhty' },
    luban: { id: 5, name: '鲁班大师', py: 'lubandashi lbds' },
  };
  const m = (q) => Object.values(H).filter((h) => heroMatch(h, q)).map((h) => h.name);
  ok('[search] 2字符首字母精确：gy→关羽', m('gy').includes('关羽') && m('gy').length === 1, m('gy').join(','));
  ok('[search] 首字母前缀子串：sk→司空震（命中首字母词 skz）', m('sk').includes('司空震'));
  ok('[search] 首字母全拼：lbds→鲁班大师', m('lbds').includes('鲁班大师'));
  ok('[search] 全拼子串：guanyu→关羽', m('guanyu').includes('关羽'));
  ok('[search] 名称子串：司空→司空震', m('司空').includes('司空震'));
  ok('[search] 不做子序列：skzh 不命中司空震', !m('skzh').includes('司空震'), m('skzh').join(','));
  ok('[search] 不做子序列：sz 不命中司空震', !m('sz').includes('司空震'));
  ok('[search] 空查询恒命中、null hero 不命中', heroMatch(H.guanyu, '  ') === true && heroMatch(null, 'gy') === false);
}

console.log(failed === 0 ? `\n全部通过（${count} 项）` : `\n${failed}/${count} 项失败`);
process.exit(failed === 0 ? 0 : 1);
