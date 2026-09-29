/**
 * 数据分析核心：把系列赛原始数据展平为“局视角”，再按维度聚合。
 * 数据量级为职业联赛（每年数百局），全部前端内存计算。
 */

/** 把一场系列赛展平为逐局记录 */
export function flattenGames(seriesList) {
  const games = [];
  for (const s of seriesList) {
    s.games.forEach((g, i) => {
      const blueIs1 = g.blue1;
      const blueTeam = blueIs1 ? s.team1 : s.team2;
      const redTeam = blueIs1 ? s.team2 : s.team1;
      // 逐局阵容：某局单独换过选手时用该局阵容，否则沿用系列赛阵容
      const gRoster1 = Array.isArray(g.roster1) ? g.roster1 : s.roster1;
      const gRoster2 = Array.isArray(g.roster2) ? g.roster2 : s.roster2;
      const blueRoster = blueIs1 ? gRoster1 : gRoster2;
      const redRoster = blueIs1 ? gRoster2 : gRoster1;
      const winnerTeamId = g.winner === 'blue' ? blueTeam.id : redTeam.id;

      const picksOf = (side, roster) => g.draft
        .filter((a) => a.type === 'pick' && a.side === side)
        .map((a, idx) => ({ player: roster[a.player], playerIdx: a.player, hero: a.hero, floor: idx + 1 }));

      // 该队本场第一个 Ban（用于首Ban偏好统计）
      const firstBan = {};
      for (const side of ['blue', 'red']) {
        const b = g.draft.find((a) => a.type === 'ban' && a.side === side);
        if (b) firstBan[side] = b.hero;
      }

      games.push({
        key: `${s.id}-${g.id ?? i}`,
        seriesId: s.id,
        seriesIndex: i,
        gameNo: g.gameNo,
        date: s.date,
        eventId: s.eventId,
        event: s.event,
        stage: s.stage,
        note: s.note || '',
        blind: !!g.blind,
        bo: s.bo,
        winnerTeamId,
        winnerSide: g.winner,
        firstBan,
        blue: {
          teamId: blueTeam.id, teamName: blueTeam.name, short: blueTeam.short || blueTeam.name,
          roster: blueRoster,
          bans: g.draft.filter((a) => a.type === 'ban' && a.side === 'blue').map((a) => a.hero),
          picks: picksOf('blue', blueRoster),
        },
        red: {
          teamId: redTeam.id, teamName: redTeam.name, short: redTeam.short || redTeam.name,
          roster: redRoster,
          bans: g.draft.filter((a) => a.type === 'ban' && a.side === 'red').map((a) => a.hero),
          picks: picksOf('red', redRoster),
        },
      });
    });
  }
  return games;
}

/** 筛选：赛事 / 赛段 / 日期区间 / 战队（参与即可） */
export function filterGames(games, { eventId = '', stage = '', dateFrom = '', dateTo = '', teamId = '' }) {
  return games.filter((g) =>
    (!eventId || String(g.eventId) === String(eventId)) &&
    (!stage || g.stage === stage) &&
    (!dateFrom || g.date >= dateFrom) &&
    (!dateTo || g.date <= dateTo) &&
    (!teamId || g.blue.teamId === Number(teamId) || g.red.teamId === Number(teamId))
  );
}

/* ================= 英雄维度 ================= */

/**
 * 英雄统计。pickRate/banRate 分母为局数（每局每队各算一次出场机会，即 2×局数）。
 * 楼层 = 该英雄在被选中时的队内选人顺位（第几个被选，1-5）。
 */
export function heroStats(games) {
  const map = new Map(); // heroId -> stats
  const get = (id) => {
    if (!map.has(id)) map.set(id, {
      heroId: id, picks: 0, pickWins: 0, bans: 0,
      bluePicks: 0, redPicks: 0, floors: [0, 0, 0, 0, 0], banFirst: 0,
    });
    return map.get(id);
  };

  for (const g of games) {
    for (const side of ['blue', 'red']) {
      const t = g[side];
      const won = (g.winnerSide === side);
      for (const p of t.picks) {
        const st = get(p.hero);
        st.picks += 1;
        if (won) st.pickWins += 1;
        if (side === 'blue') st.bluePicks += 1; else st.redPicks += 1;
        if (p.floor >= 1 && p.floor <= 5) st.floors[p.floor - 1] += 1;
      }
      for (const b of t.bans) if (b != null) get(b).bans += 1;
      if (g.firstBan?.[side]) get(g.firstBan[side]).banFirst += 1;
    }
  }
  return map;
}

/* ================= 战队维度 ================= */

export function teamStats(games, teamId) {
  const teamGames = games.filter((g) => g.blue.teamId === teamId || g.red.teamId === teamId);
  let blueGames = 0, blueWins = 0, redGames = 0, redWins = 0;
  const heroUse = new Map(); // heroId -> {picks, wins, bans}
  const use = (id) => {
    if (!heroUse.has(id)) heroUse.set(id, { heroId: id, picks: 0, wins: 0, bans: 0 });
    return heroUse.get(id);
  };

  for (const g of teamGames) {
    const side = g.blue.teamId === teamId ? 'blue' : 'red';
    const t = g[side];
    const won = g.winnerSide === side;
    if (side === 'blue') { blueGames += 1; if (won) blueWins += 1; }
    else { redGames += 1; if (won) redWins += 1; }
    for (const p of t.picks) { const u = use(p.hero); u.picks += 1; if (won) u.wins += 1; }
    for (const b of t.bans) if (b != null) use(b).bans += 1;
  }
  return { games: teamGames, blueGames, blueWins, redGames, redWins, heroUse };
}

/** 位置组合对（阵容按下标 0-4：对抗/打野/中/发育/游走） */
export const PAIR_DEFS = [
  { key: '0-1', label: '上野' }, { key: '0-2', label: '上中' }, { key: '0-3', label: '上射' },
  { key: '0-4', label: '上辅' }, { key: '1-2', label: '中野' }, { key: '1-3', label: '野射' },
  { key: '1-4', label: '野辅' }, { key: '2-3', label: '中射' }, { key: '2-4', label: '中辅' },
  { key: '3-4', label: '射辅' },
];

/** 战队组合统计：同一队内两个位置的英雄对 → 出场数/胜场/胜率。
 *  key 带位置组合（与三位置统计一致）：同一英雄对打不同位置分开成不同行，互不合并 */
export function comboStats(teamGames, teamId) {
  const map = new Map(); // key "a|b@pair"（heroId 升序 + 位置对）-> { heroA, heroB, pair, picks, wins }
  for (const g of teamGames) {
    const side = g.blue.teamId === teamId ? 'blue' : 'red';
    const t = g[side];
    const won = g.winnerSide === side;
    const heroesByPos = Array.from({ length: 5 }, () => null);
    for (const p of t.picks) heroesByPos[p.playerIdx] = p.hero;
    for (const [i, j] of [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]) {
      const a = heroesByPos[i]; const b = heroesByPos[j];
      if (!a || !b) continue;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const key = `${lo}|${hi}@${i}-${j}`;
      if (!map.has(key)) map.set(key, { heroA: lo, heroB: hi, pair: `${i}-${j}`, picks: 0, wins: 0 });
      const e = map.get(key);
      e.picks += 1;
      if (won) e.wins += 1;
    }
  }
  return map;
}

/* ================= 总览 ================= */

export function overviewStats(games, seriesCount) {
  let blueWins = 0;
  const heroAgg = new Map(); // id -> {picks, wins, bans}
  const get = (id) => {
    if (!heroAgg.has(id)) heroAgg.set(id, { heroId: id, picks: 0, wins: 0, bans: 0 });
    return heroAgg.get(id);
  };
  for (const g of games) {
    if (g.winnerSide === 'blue') blueWins += 1;
    for (const side of ['blue', 'red']) {
      const won = g.winnerSide === side;
      for (const p of g[side].picks) { const s = get(p.hero); s.picks += 1; if (won) s.wins += 1; }
      for (const b of g[side].bans) if (b != null) get(b).bans += 1;
    }
  }
  const topBy = (key, n = 10) => [...heroAgg.values()].filter((s) => s[key] > 0)
    .sort((a, b) => b[key] - a[key]).slice(0, n);
  return {
    games: games.length,
    seriesCount,
    blueWins,
    redWins: games.length - blueWins,
    heroes: heroAgg,
    topPicked: topBy('picks'),
    topBanned: topBy('bans'),
  };
}

/* ================= BP 手序 / Counter 关系 ================= */

/** 全场选人手序（标准流程）：蓝1(1) 红1(2) 红2(3) 蓝2(4) 蓝3(5) 红3(6) 红4(7) 蓝4(8) 蓝5(9) 红5(10)。
 * 二轮 Ban 结束后红方先选（红4楼），蓝方连选两个（4、5楼），红5楼收尾。 */
export const HAND_OF = {
  blue: [1, 4, 5, 8, 9],
  red: [2, 3, 6, 7, 10],
};

/* ================= Counter 关系（全局，英雄分析页） ================= */

/** 5. 英雄 counter 场景：该英雄被选出时，对方已亮（手序更早）的英雄分布 */
export function heroCounterScene(games, heroId) {
  const count = new Map();
  let picks = 0, wins = 0;
  for (const g of games) {
    if (g.blind) continue;
    for (const side of ['blue', 'red']) {
      const oppSide = side === 'blue' ? 'red' : 'blue';
      const opp = g[oppSide];
      for (const p of g[side].picks) {
        if (p.hero !== heroId) continue;
        picks += 1;
        if (g.winnerSide === side) wins += 1;
        const myHand = HAND_OF[side][p.floor - 1];
        for (const o of opp.picks) {
          if (HAND_OF[oppSide][o.floor - 1] < myHand) count.set(o.hero, (count.get(o.hero) || 0) + 1);
        }
      }
    }
  }
  return { picks, wins, count };
}

/** 5c. 英雄被 counter 视角（反转）：对方在该英雄已亮出（手序更早）之后选出的英雄分布 */
export function heroCounteredByScene(games, heroId) {
  const count = new Map();
  let picks = 0, wins = 0;
  for (const g of games) {
    if (g.blind) continue;
    for (const side of ['blue', 'red']) {
      const oppSide = side === 'blue' ? 'red' : 'blue';
      for (const p of g[side].picks) {
        if (p.hero !== heroId) continue;
        picks += 1;
        if (g.winnerSide === side) wins += 1;
        const myHand = HAND_OF[side][p.floor - 1];
        for (const o of g[oppSide].picks) {
          if (HAND_OF[oppSide][o.floor - 1] > myHand) count.set(o.hero, (count.get(o.hero) || 0) + 1);
        }
      }
    }
  }
  return { picks, wins, count };
}

/** 5b. 组合 counter 场景：该组合成型（两英雄均被该队选出）时，对方已亮的英雄与组合分布 */
export function comboCounterScene(games, heroA, heroB) {
  const [lo, hi] = heroA < heroB ? [heroA, heroB] : [heroB, heroA];
  const heroCount = new Map();
  const comboCount = new Map(); // "lo|hi"（对方英雄对）
  let picks = 0, wins = 0;
  for (const g of games) {
    if (g.blind) continue;
    for (const side of ['blue', 'red']) {
      const oppSide = side === 'blue' ? 'red' : 'blue';
      const t = g[side];
      const pa = t.picks.find((p) => p.hero === lo);
      const pb = t.picks.find((p) => p.hero === hi);
      if (!pa || !pb) continue;
      picks += 1;
      if (g.winnerSide === side) wins += 1;
      const formHand = Math.max(HAND_OF[side][pa.floor - 1], HAND_OF[side][pb.floor - 1]);
      const shown = g[oppSide].picks.filter((o) => HAND_OF[oppSide][o.floor - 1] < formHand);
      for (const o of shown) heroCount.set(o.hero, (heroCount.get(o.hero) || 0) + 1);
      const shownHeroes = shown.map((o) => o.hero);
      for (let i = 0; i < shownHeroes.length; i++) {
        for (let j = i + 1; j < shownHeroes.length; j++) {
          const a = shownHeroes[i], b = shownHeroes[j];
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          comboCount.set(key, (comboCount.get(key) || 0) + 1);
        }
      }
    }
  }
  return { picks, wins, heroCount, comboCount };
}

/* ================= 三位置组合（战队分析页） ================= */

/** 6. 三位置组合（阵容按下标 0-4：对抗/打野/中/发育/游走） */
export const TRIO_DEFS = [
  { key: '0-1-2', label: '上中野' }, { key: '0-1-3', label: '上野射' }, { key: '0-1-4', label: '上野辅' },
  { key: '0-2-3', label: '上中射' }, { key: '0-2-4', label: '上中辅' }, { key: '0-3-4', label: '上射辅' },
  { key: '1-2-3', label: '中野射' }, { key: '1-2-4', label: '中野辅' }, { key: '1-3-4', label: '野射辅' },
  { key: '2-3-4', label: '中射辅' },
];
const TRIO_INDEXES = TRIO_DEFS.map((d) => d.key.split('-').map(Number));

/** 6. 战队三位置组合统计：key `${heroA}|${heroB}|${heroC}@${trio}` -> { heroes, trio, picks, wins } */
export function trioComboStats(teamGames, teamId) {
  const map = new Map();
  for (const g of teamGames) {
    const side = g.blue.teamId === teamId ? 'blue' : 'red';
    const won = g.winnerSide === side;
    const heroesByPos = Array.from({ length: 5 }, () => null);
    for (const p of g[side].picks) heroesByPos[p.playerIdx] = p.hero;
    for (let idx = 0; idx < TRIO_INDEXES.length; idx++) {
      const [i, j, k] = TRIO_INDEXES[idx];
      const a = heroesByPos[i], b = heroesByPos[j], c = heroesByPos[k];
      if (!a || !b || !c) continue;
      const hs = [a, b, c].sort((x, y) => x - y);
      const trio = TRIO_DEFS[idx].key;
      const key = `${hs.join('|')}@${trio}`;
      if (!map.has(key)) map.set(key, { heroes: hs, trio, picks: 0, wins: 0 });
      const e = map.get(key);
      e.picks += 1;
      if (won) e.wins += 1;
    }
  }
  return map;
}

/* ================= 全 KPL 英雄组合榜（英雄分析页） ================= */

const PAIR_INDEXES = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];

/** 10. 全 KPL 英雄组合：pick 次数、被 Ban 覆盖局数、胜率、楼位倾向（成员各自队内楼层对）。
 * pick 率分母 2×局数；Ban 覆盖 = 该局中组合任一名成员被任一方 Ban 即计 1 次（规则上一个英雄
 * 被 Ban 的局不可能再被 Pick，因此覆盖局均为组合未登场的局），分母 = 局数（每局 0/1） */
export function globalComboStats(games) {
  const map = new Map();
  for (const g of games) {
    for (const side of ['blue', 'red']) {
      const t = g[side];
      const won = g.winnerSide === side;
      const heroFloor = new Map();
      const byPos = Array.from({ length: 5 }, () => null);
      for (const p of t.picks) { heroFloor.set(p.hero, p.floor); byPos[p.playerIdx] = p.hero; }
      for (const [i, j] of PAIR_INDEXES) {
        const a = byPos[i], b = byPos[j];
        if (!a || !b) continue;
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const key = `${lo}|${hi}`;
        if (!map.has(key)) map.set(key, { heroA: lo, heroB: hi, picks: 0, wins: 0, banGames: 0, floorPairs: new Map() });
        const e = map.get(key);
        e.picks += 1;
        if (won) e.wins += 1;
        const fa = heroFloor.get(lo), fb = heroFloor.get(hi);
        const fp = `${fa}-${fb}`;
        e.floorPairs.set(fp, (e.floorPairs.get(fp) || 0) + 1);
      }
    }
  }
  // Ban 覆盖：按局对已登场组合检查成员是否被 Ban（组合全集过大，仅统计有 pick 记录的组合）
  for (const g of games) {
    const banSet = new Set([...g.blue.bans, ...g.red.bans].filter((b) => b != null));
    if (banSet.size === 0) continue;
    for (const e of map.values()) {
      if (banSet.has(e.heroA) || banSet.has(e.heroB)) e.banGames += 1;
    }
  }
  return map;
}

/* ================= 轮次分组（赛事分析页，按系列赛备注识别，区间语义） ================= */

/** 轮次分组定义。regular = r1+r2+r3 合计 */
export const ROUND_DEFS = [
  { key: 'r1', label: '第一轮' },
  { key: 'r2', label: '第二轮' },
  { key: 'r3', label: '第三轮' },
  { key: 'regular', label: '常规赛（一二三轮合计）' },
  { key: 'po', label: '季后赛（含总决赛）' },
  { key: 'other', label: '未标注轮次' },
];

/** 轮次边界识别：备注含「第x轮」标记该轮起点（中文数字与阿拉伯数字均可：第一轮/第1轮）；
 *  备注含「季后赛/总决赛」或赛段=季后赛标记季后赛起点 */
function roundMarker(note = '', stage = '') {
  const n = String(note || '');
  const s = String(stage || '');
  if (n.includes('总决赛') || n.includes('季后赛') || s.includes('季后赛')) return 'po';
  if (n.includes('第三轮') || n.includes('第3轮')) return 'r3';
  if (n.includes('第二轮') || n.includes('第2轮')) return 'r2';
  if (n.includes('第一轮') || n.includes('第1轮')) return 'r1';
  return null;
}

/** 轮次归属（区间语义）：基于**完整未筛选**的数据计算每个系列赛的轮次 key（seriesId → r1/r2/r3/po/other）。
 *  边界场（带「第x轮」备注的首场）可能被页面筛选掉，因此归属必须先在完整数据上算好、再对筛选结果套用；
 *  轮次标记**按赛事隔离**：每个赛事独立找边界，不跨赛事继承（无标记的赛事整体归 other） */
export function seriesRoundKeys(allGames) {
  const seriesMap = new Map(); // seriesId -> { date, note, stage, eventId }
  for (const g of allGames) {
    if (!seriesMap.has(g.seriesId)) seriesMap.set(g.seriesId, { date: g.date, note: g.note, stage: g.stage, eventId: g.eventId });
  }
  const byEvent = new Map(); // eventId -> [[seriesId, meta], ...]
  for (const [sid, s] of seriesMap) {
    if (!byEvent.has(s.eventId)) byEvent.set(s.eventId, []);
    byEvent.get(s.eventId).push([sid, s]);
  }

  const keyAt = new Map();
  for (const list of byEvent.values()) {
    list.sort((a, b) =>
      String(a[1].date).localeCompare(String(b[1].date)) || a[0] - b[0]);
    // 每个轮次只取首个标记场作为边界，按时间排序
    const bounds = [];
    const seen = new Set();
    list.forEach(([sid, s], pos) => {
      const k = roundMarker(s.note, s.stage);
      if (k && !seen.has(k)) { seen.add(k); bounds.push({ pos, key: k }); }
    });
    // 每场系列赛的轮次 = 其位置之前（含）最近的边界；首个边界之前 → other
    let bi = -1;
    list.forEach(([sid], pos) => {
      while (bi + 1 < bounds.length && bounds[bi + 1].pos <= pos) bi += 1;
      keyAt.set(sid, bi >= 0 ? bounds[bi].key : 'other');
    });
  }
  return keyAt;
}

/** 轮次分组（区间语义，归属规则见 seriesRoundKeys）。
 *  games = 筛选后的局；allGames = 完整数据（默认同 games，仅供无法提供全量时的兼容，
 *  页面正常使用必须传完整数据，否则被筛掉的边界场会让后续场次错归"未标注"） */
export function groupByRound(games, allGames = games) {
  const keyAt = seriesRoundKeys(allGames);
  const m = new Map();
  for (const r of ROUND_DEFS) m.set(r.key, []);
  for (const g of games) {
    const k = keyAt.get(g.seriesId) || 'other';
    m.get(k).push(g);
    if (k === 'r1' || k === 'r2' || k === 'r3') m.get('regular').push(g);
  }
  return m;
}

/** 全 KPL 三英雄组合（同队任意三名英雄；同队任意 3 人必然占据某种三位置型，故与"按位置"统计同集）：
 *  key "a|b|c"（升序）-> { heroes, picks, wins } */
export function globalTrioStats(games) {
  const map = new Map();
  for (const g of games) {
    for (const side of ['blue', 'red']) {
      const t = g[side];
      const heroes = t.picks.map((p) => p.hero).sort((a, b) => a - b);
      if (heroes.length !== 5) continue;
      const won = g.winnerSide === side;
      for (let i = 0; i < 5; i++) {
        for (let j = i + 1; j < 5; j++) {
          for (let k = j + 1; k < 5; k++) {
            const key = `${heroes[i]}|${heroes[j]}|${heroes[k]}`;
            if (!map.has(key)) map.set(key, { heroes: [heroes[i], heroes[j], heroes[k]], picks: 0, wins: 0 });
            const e = map.get(key);
            e.picks += 1;
            if (won) e.wins += 1;
          }
        }
      }
    }
  }
  return map;
}

/** 全 KPL 五英雄阵容（同队整队英雄集）：key "a|b|c|d|e"（升序）-> { heroes, picks, wins }。
 *  注意整队锁定规则下同系列赛内不会重复，重复只能来自跨系列赛 */
export function globalFiveStats(games) {
  const map = new Map();
  for (const g of games) {
    for (const side of ['blue', 'red']) {
      const t = g[side];
      const heroes = t.picks.map((p) => p.hero).sort((a, b) => a - b);
      if (heroes.length !== 5) continue;
      const key = heroes.join('|');
      if (!map.has(key)) map.set(key, { heroes, picks: 0, wins: 0 });
      const e = map.get(key);
      e.picks += 1;
      const won = g.winnerSide === side;
      if (won) e.wins += 1;
    }
  }
  return map;
}

/* ================= 全战队一览（战队分析页） ================= */

/** 全部登场战队聚合：系列赛场次/大场胜负/小局/蓝红方拆分/登场英雄数/常用英雄（按当前筛选的 games） */
export function allTeamStats(games) {
  const map = new Map();
  const get = (id, name) => {
    if (!map.has(id)) map.set(id, {
      teamId: id, name,
      seriesMap: new Map(), // seriesId -> { w, l } 该队在每场系列赛的小局胜负
      games: 0, wins: 0, blueGames: 0, blueWins: 0, redGames: 0, redWins: 0,
      heroUse: new Map(),
    });
    return map.get(id);
  };
  for (const g of games) {
    for (const side of ['blue', 'red']) {
      const t = g[side];
      const st = get(t.teamId, t.teamName);
      const won = g.winnerSide === side;
      const se = st.seriesMap.get(g.seriesId) || { w: 0, l: 0, bo: g.bo };
      if (won) se.w += 1; else se.l += 1;
      st.seriesMap.set(g.seriesId, se);
      st.games += 1;
      if (won) st.wins += 1;
      if (side === 'blue') { st.blueGames += 1; if (won) st.blueWins += 1; }
      else { st.redGames += 1; if (won) st.redWins += 1; }
      for (const p of t.picks) {
        if (!st.heroUse.has(p.hero)) st.heroUse.set(p.hero, { heroId: p.hero, picks: 0, wins: 0 });
        const u = st.heroUse.get(p.hero);
        u.picks += 1;
        if (won) u.wins += 1;
      }
    }
  }
  // 大场胜负：任一方小局胜场达到 BO 胜场门槛（先胜 (bo+1)/2 局）才计胜负；
  // 领先但未达标的未录完系列赛记"未分"（只入分母，不打进胜/负）
  for (const st of map.values()) {
    let sW = 0, sL = 0, sD = 0;
    for (const se of st.seriesMap.values()) {
      const need = Math.ceil((se.bo || 7) / 2);
      if (se.w >= need) sW += 1;
      else if (se.l >= need) sL += 1;
      else sD += 1;
    }
    st.seriesWins = sW; st.seriesLosses = sL; st.seriesDraws = sD;
  }
  return map;
}

/* ================= 赛事分析（时间推移 / 跨赛事对比） ================= *//** 8. 按自然月分组：'YYYY-MM -> games[]（保持原顺序） */
export function groupByMonth(games) {
  const map = new Map();
  for (const g of games) {
    const m = (g.date || '').slice(0, 7);
    if (!m) continue;
    if (!map.has(m)) map.set(m, []);
    map.get(m).push(g);
  }
  return map;
}

/** 8. 两个月份的英雄 Ban-Pick 率变化（要求两月样本 Pick+Ban 各 ≥3），按 |变化| 降序 */
export function heroShiftRows(statsA, gamesA, statsB, gamesB, topN = 12) {
  const rows = [];
  for (const [heroId, sB] of statsB) {
    const sA = statsA.get(heroId);
    const totalA = sA ? sA.picks + sA.bans : 0;
    const totalB = sB.picks + sB.bans;
    if (totalA < 3 || totalB < 3) continue;
    const bpA = (totalA / (gamesA * 2)) * 100;
    const bpB = (totalB / (gamesB * 2)) * 100;
    rows.push({
      heroId, totalA, totalB,
      bpA: Math.round(bpA * 10) / 10, bpB: Math.round(bpB * 10) / 10,
      diff: Math.round((bpB - bpA) * 10) / 10,
    });
  }
  return rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, topN);
}

/** 8. 两个月份的组合出现率变化（组合出现率分母 = 局数，每局每队各 1 次机会），按 |变化| 降序 */
export function comboShiftRows(comboA, gamesA, comboB, gamesB, topN = 8) {
  const rows = [];
  for (const [key, cB] of comboB) {
    const cA = comboA.get(key);
    const pA = cA ? cA.picks : 0;
    if (pA < 2 || cB.picks < 2) continue;
    const rA = (pA / gamesA) * 100;
    const rB = (cB.picks / gamesB) * 100;
    rows.push({
      key, heroA: cB.heroA, heroB: cB.heroB, picksA: pA, picksB: cB.picks,
      rateA: Math.round(rA * 10) / 10, rateB: Math.round(rB * 10) / 10,
      diff: Math.round((rB - rA) * 10) / 10,
    });
  }
  return rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, topN);
}

/* ================= 全选手一览（选手分析页） ================= */

/** 9. 全部出场选手聚合：出场/胜率/蓝红方胜率/英雄偏好/所属战队 */
export function allPlayerStats(games) {
  const map = new Map();
  const get = (name) => {
    if (!map.has(name)) map.set(name, {
      name, picks: 0, wins: 0, blueGames: 0, blueWins: 0, redGames: 0, redWins: 0,
      heroUse: new Map(), teamUse: new Map(),
    });
    return map.get(name);
  };
  for (const g of games) {
    for (const side of ['blue', 'red']) {
      const t = g[side];
      const won = g.winnerSide === side;
      for (const p of t.picks) {
        if (!p.player) continue;
        const st = get(p.player);
        st.picks += 1;
        if (won) st.wins += 1;
        if (side === 'blue') { st.blueGames += 1; if (won) st.blueWins += 1; }
        else { st.redGames += 1; if (won) st.redWins += 1; }
        if (!st.heroUse.has(p.hero)) st.heroUse.set(p.hero, { heroId: p.hero, picks: 0, wins: 0 });
        const u = st.heroUse.get(p.hero);
        u.picks += 1;
        if (won) u.wins += 1;
        st.teamUse.set(t.teamName, (st.teamUse.get(t.teamName) || 0) + 1);
      }
    }
  }
  return map;
}

/* ================= 落败后下一局选边（战队分析页） ================= */

/** 11. 该战队每场落败（系列赛最后一局除外）后，下一局执蓝/执红的次数（败方拥有下一局选边权） */
export function afterLossSideStats(games, teamId) {
  const bySeries = new Map();
  for (const g of games) {
    if (g.blue.teamId !== teamId && g.red.teamId !== teamId) continue;
    if (!bySeries.has(g.seriesId)) bySeries.set(g.seriesId, []);
    bySeries.get(g.seriesId).push(g);
  }
  let blue = 0, red = 0;
  for (const list of bySeries.values()) {
    for (let i = 0; i < list.length - 1; i++) {
      const g = list[i];
      const side = g.blue.teamId === teamId ? 'blue' : 'red';
      if (g.winnerSide === side) continue;
      const next = list[i + 1];
      if (next.blue.teamId === teamId) blue += 1; else red += 1;
    }
  }
  return { blue, red, total: blue + red };
}

export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
