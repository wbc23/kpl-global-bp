/**
 * BP 整体校验与视角映射（纯函数，不依赖 heroes.json，可被 node 直接导入测试）。
 * 与录入状态机（recording.js）共用 validateAct，保证校验口径与逐步点击完全一致。
 *
 * 阵容 null 语义（写入与读取统一）：games.roster1/2 为 null = 该局阵容与系列赛阵容一致
 * （gamesPayload 按此写入）。所有读取处一律回退到系列赛阵容（baseRoster），
 * 不得回退到"上一局阵容"或"当前局阵容"——否则换人后换回首发时归属会算错。
 */
import { validateAct } from '../bp/validate.js';

/** 历史局的生效阵容：显式记录用记录值，null 回退系列赛阵容 */
export function effRoster(gameRoster, seriesRoster) {
  return Array.isArray(gameRoster) ? gameRoster : seriesRoster;
}

/** 给定"队伍1是否执蓝"的映射（blueFirst: 1|2），双方历史局已用英雄（整队锁定口径，按阵营色分桶）。
 *  games: [{ blueFirst: 1|2, blind, actions:[{type,side,hero,player}] }, ...]（录入会话格式）。
 *  盲选局的 pick 不产生锁定（巅峰对决解除锁定，且其后无常规局），不计入 */
export function sideUsedFromGames(games, blueFirst) {
  const res = { blue: new Set(), red: new Set() };
  const sideOfTeam = (team) => (team === blueFirst ? 'blue' : 'red');
  for (const g of games) {
    if (g.blind) continue;
    const gBlueTeam = g.blueFirst === 1 ? 1 : 2;
    for (const a of (g.actions || [])) {
      if (a.type !== 'pick' || a.hero == null) continue;
      const team = a.side === 'blue' ? gBlueTeam : (gBlueTeam === 1 ? 2 : 1);
      res[sideOfTeam(team)].add(a.hero);
    }
  }
  return res;
}

/** 把历史局换算到当前蓝红视角，供 DraftCenter / 全局锁定校验使用。
 *  每局阵容可能不同（逐局换人），历史局的选手按"姓名"换算到当前局阵容的下标；
 *  不在当前局阵容中的选手记 -1（不占用当前任何位置，锁定也不影响当前阵容）。
 *  历史局 null 阵容回退到 baseRoster1/2（系列赛阵容），不回退当前局阵容——
 *  否则当前局换过人时，历史局英雄会被归到错误选手名下（错误锁定/错误灰显）。
 *  recGames: [{ blueFirst: 1|2, blind, winner, actions, roster1?, roster2? }] */
export function perspectiveGames(recGames, curBlueFirst, curRoster1, curRoster2, baseRoster1 = curRoster1, baseRoster2 = curRoster2) {
  return recGames.map((g) => {
    const flip = (g.blueFirst === 1) !== (curBlueFirst === 1);
    const toSide = (s) => (flip ? (s === 'blue' ? 'red' : 'blue') : s);
    const gRoster1 = effRoster(g.roster1, baseRoster1);
    const gRoster2 = effRoster(g.roster2, baseRoster2);
    const teamOfSide = (side) => (side === 'blue' ? g.blueFirst : g.blueFirst === 1 ? 2 : 1);
    const rosterForTeam = (team) => (team === 1 ? gRoster1 : gRoster2);
    const curRosterForTeam = (team) => (team === 1 ? curRoster1 : curRoster2);

    const picks = (side) => g.actions
      .filter((a) => a.type === 'pick' && toSide(a.side) === side)
      .map((a) => {
        const team = teamOfSide(a.side);
        const name = rosterForTeam(team)[a.player];
        const idx = curRosterForTeam(team).indexOf(name);
        return { player: idx, hero: a.hero, name };
      });
    const bans = (side) => g.actions
      .filter((a) => a.type === 'ban' && toSide(a.side) === side)
      .map((a) => a.hero);
    return {
      blind: g.blind,
      winner: flip ? (g.winner === 'blue' ? 'red' : 'blue') : g.winner,
      blueBans: bans('blue'),
      redBans: bans('red'),
      bluePicks: picks('blue'),
      redPicks: picks('red'),
    };
  });
}

/** 若把本局蓝方改为 team（1|2），当前已选步骤中会触犯整队锁定的 pick 列表（换向后
 *  该英雄与该方历史局已用英雄重复）。空数组 = 可安全换向。
 *  rec 为录入/编辑会话状态（games 只含本会话已知的局；编辑会话仅含被编辑局之前的局，
 *  与之后局的冲突由编辑保存时的 editSaveConflicts 兜底） */
export function blueFlipConflicts(rec, team) {
  const cur = rec.current;
  if (!cur || cur.blind || !Array.isArray(cur.actions) || cur.actions.length === 0) return [];
  if (![1, 2].includes(team) || cur.blueFirst === team) return [];
  const used = sideUsedFromGames(rec.games, team);
  return cur.actions.filter((a) => a.type === 'pick' && a.hero != null && used[a.side]?.has(a.hero));
}

/** 编辑BP保存前的整体校验：把本局（含换向后）放在整场系列赛语境下用 validateAct 逐步重放。
 *  cur: 被编辑局的当前状态 { blueFirst: 1|2, blind, actions }
 *  others: 同系列赛其他局的服务端格式 [{ blue1, blind, draft:[{type,side,hero,player}] }, ...]（含本局之后的局）
 *  heroName: 英雄 id → 名称（用于错误提示，缺省原样显示 id）
 *  锁定语境只计**常规局**的 pick：盲选局（BO7 第 7 局）解除锁定且可复用招牌英雄，
 *  其 pick 不产生锁定——否则编辑已打满 BO7 的前几局时会被盲选阵容误拦（回归场景见 npm test）
 *  返回违规描述数组（遇首个错误即止）；空数组 = 通过 */
export function editSaveConflicts(cur, others, heroName = (h) => h) {
  const errs = [];
  const used = { blue: new Set(), red: new Set() };
  const sideOfTeam = (team) => (team === cur.blueFirst ? 'blue' : 'red');
  for (const g of others) {
    if (g.blind) continue; // 盲选局不产生锁定
    const gBlueTeam = g.blue1 ? 1 : 2;
    for (const a of (g.draft || [])) {
      if (a.type !== 'pick' || a.hero == null) continue;
      const team = a.side === 'blue' ? gBlueTeam : (gBlueTeam === 1 ? 2 : 1);
      used[sideOfTeam(team)].add(a.hero);
    }
  }
  const done = [];
  for (const a of cur.actions) {
    const ok = validateAct(
      { actions: done, blind: cur.blind, sideLocks: (s) => used[s] },
      { kind: a.type, side: a.side, hero: a.hero, player: a.player },
    );
    if (!ok) {
      if (a.type === 'pick' && a.hero != null && !cur.blind && used[a.side]?.has(a.hero)) {
        errs.push(`${heroName(a.hero)} 与该队本系列赛其他局的已用英雄重复（全局 BP 整队锁定）`);
      } else {
        errs.push(`第 ${done.length + 1} 步不符合 BP 规则（流程顺序 / 本局英雄唯一 / 选手位不重复）`);
      }
      break;
    }
    done.push(a);
  }
  return errs;
}
