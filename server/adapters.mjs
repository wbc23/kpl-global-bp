/**
 * 数据同步适配器
 *
 * 抓取永远只写入待审表 pending_imports，由页面人工确认后才真正入库。
 *
 * 内置源：
 *  - official : 王者荣耀赛事官网赛程接口（实验性：api.tgatv.qq.com 在部分网络被
 *               DNS 污染/拦截；如需走代理，可设置环境变量
 *               NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 后启动服务）
 *  - json     : 自定义 JSON（URL 或文本），格式见 README
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HEROES = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/heroes.json'), 'utf8'));
const HERO_BY_NAME = new Map(HEROES.map((h) => [h.name, h.id]));

export const OFFICIAL_SCHEDULE_URL = 'https://api.tgatv.qq.com/app/match/getKplSchedule?appid=10005';

export async function fetchText(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KPL-BP-Sync/1.0',
      Referer: 'https://pvp.qq.com/match/',
      Accept: 'application/json,text/plain,*/*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/* ---------- 英雄/战队/赛事解析 ---------- */

export function resolveHero(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (HERO_BY_NAME.has(v)) return HERO_BY_NAME.get(v);
    const n = Number(v);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

/** 确认入库时确保基础数据存在，返回 {eventId, team1Id, team2Id} */
export function ensureBase(db, { event, team1, team2 }) {
  let eventId = event.id;
  if (!eventId) {
    const r = db.prepare('INSERT INTO events(name) VALUES(?)').run(event.name);
    eventId = Number(r.lastInsertRowid);
  }
  const teamId = (t) => {
    if (t.id) return t.id;
    const r = db.prepare('INSERT INTO teams(name, short) VALUES(?, ?)').run(t.name, t.short || '');
    return Number(r.lastInsertRowid);
  };
  return { eventId, team1Id: teamId(team1), team2Id: teamId(team2) };
}

/** 基础数据快照 → 名称匹配为 {id?, name, short?}（id 为空表示确认时将新建） */
export function matcher(meta) {
  const teams = new Map(meta.teams.map((t) => [t.name, t]));
  const teamOf = (name) => {
    const hit = teams.get(name) || [...teams.values()].find((t) => t.short === name);
    return hit ? { id: hit.id, name: hit.name, short: hit.short } : { id: null, name, short: '' };
  };
  const events = new Map(meta.events.map((e) => [e.name, e]));
  const eventOf = (name) => {
    const hit = events.get(name);
    return hit ? { id: hit.id, name: hit.name } : { id: null, name };
  };
  return { teamOf, eventOf };
}

/* ---------- 标准化：自定义 JSON → 待审条目 ---------- */

const padRoster = (r) => {
  const arr = Array.isArray(r) ? r.map((x) => String(x ?? '')) : [];
  while (arr.length < 5) arr.push('');
  return arr.slice(0, 5);
};

/**
 * 输入数组长这样（hero 可为名称或数字 id，战队/赛事按名称匹配，缺失自动新建）：
 * {
 *   "series": [{ "event":"2026 KPL春季赛", "stage":"常规赛", "date":"2026-03-01",
 *      "bo":5, "team1":"成都AG超玩会", "team2":"重庆狼队",
 *      "roster1":["一诺",...], "roster2":[...],
 *      "games":[{"gameNo":1,"blind":false,"blue1":1,"winner":"blue",
 *        "draft":[{"type":"ban","side":"blue","hero":"澜"},
 *                 {"type":"pick","side":"blue","hero":"貂蝉","player":0}]}]}],
 *   "schedule": [{ "event":"2026 KPL春季赛", "stage":"常规赛", "date":"2026-03-08",
 *      "time":"17:00", "team1":"武汉eStarPro", "team2":"北京WB" }]
 * }
 */
export function normalizeDump(dump, meta) {
  const { teamOf, eventOf } = matcher(meta);
  const out = { series: [], schedule: [], errors: [] };

  for (const [i, s] of (dump.series || []).entries()) {
    try {
      const team1 = teamOf(String(s.team1 ?? s.teamA ?? '').trim());
      const team2 = teamOf(String(s.team2 ?? s.teamB ?? '').trim());
      if (!team1.name || !team2.name || team1.name === team2.name) throw new Error('双方战队名称不合法');
      const bo = [3, 5, 7].includes(s.bo) ? s.bo : null;
      if (!bo) throw new Error('bo 必须为 3/5/7');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) throw new Error('date 需为 YYYY-MM-DD');
      const games = (s.games || []).map((g, gi) => {
        if (!['blue', 'red'].includes(g.winner)) throw new Error(`第${gi + 1}局 winner 不合法`);
        const draft = (g.draft || []).map((a) => {
          const hero = resolveHero(a.hero);
          if (!HEROES.some((h) => h.id === hero)) throw new Error(`第${gi + 1}局英雄无法识别: ${a.hero}`);
          return { type: a.type === 'ban' ? 'ban' : 'pick', side: a.side === 'red' ? 'red' : 'blue', hero, player: a.player ?? 0 };
        });
        return {
          gameNo: g.gameNo ?? gi + 1,
          blind: !!g.blind,
          blue1: g.blue1 === true || g.blue1 === 1 ? 1 : 2,
          winner: g.winner,
          draft,
        };
      });
      if (games.length === 0) throw new Error('缺少 games');
      out.series.push({
        kind: 'series',
        payload: {
          event: eventOf(String(s.event ?? '').trim() || '未命名赛事'),
          stage: s.stage || '常规赛',
          date: s.date, bo, team1, team2,
          roster1: padRoster(s.roster1), roster2: padRoster(s.roster2),
          note: s.note || '', games,
        },
      });
    } catch (e) {
      out.errors.push(`series[${i}]: ${e.message}`);
    }
  }

  for (const [i, sc] of (dump.schedule || []).entries()) {
    try {
      const team1 = teamOf(String(sc.team1 ?? '').trim());
      const team2 = teamOf(String(sc.team2 ?? '').trim());
      if (!team1.name || !team2.name || team1.name === team2.name) throw new Error('双方战队名称不合法');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sc.date || '')) throw new Error('date 需为 YYYY-MM-DD');
      out.schedule.push({
        kind: 'schedule',
        payload: {
          event: eventOf(String(sc.event ?? '').trim() || '未命名赛事'),
          stage: sc.stage || '常规赛',
          date: sc.date, time: String(sc.time || ''),
          team1, team2, note: sc.note || '',
        },
      });
    } catch (e) {
      out.errors.push(`schedule[${i}]: ${e.message}`);
    }
  }
  return out;
}

/** 待审条目摘要（页面预览用） */
export function summarize(item) {
  const p = item.payload;
  if (item.kind === 'series') {
    const t1 = p.games.filter((g) => (g.winner === 'blue' ? g.blue1 === 1 : g.blue1 === 2)).length;
    return {
      kind: 'series',
      date: p.date, event: p.event.name, stage: p.stage, bo: p.bo,
      team1: p.team1.name, team2: p.team2.name,
      newTeam: !p.team1.id || !p.team2.id ? [!p.team1.id && p.team1.name, !p.team2.id && p.team2.name].filter(Boolean) : [],
      newEvent: !p.event.id ? p.event.name : null,
      rosterMissing: p.roster1.some((x) => !x) || p.roster2.some((x) => !x),
      games: p.games.length, score: `${t1}:${p.games.length - t1}`,
    };
  }
  return {
    kind: 'schedule',
    date: p.date, time: p.time, event: p.event.name, stage: p.stage,
    team1: p.team1.name, team2: p.team2.name,
    newTeam: !p.team1.id || !p.team2.id ? [!p.team1.id && p.team1.name, !p.team2.id && p.team2.name].filter(Boolean) : [],
    newEvent: !p.event.id ? p.event.name : null,
  };
}

/* ---------- 官方赛程（实验性） ---------- */

/** 从未知结构的 JSON 中启发式提取“主队/客队/时间”对象数组 */
function extractMatchArray(obj) {
  const looksLikeMatch = (o) =>
    typeof o === 'object' && o !== null && !Array.isArray(o) &&
    Object.keys(o).some((k) => /(host|home|guest|away|hteam|gteam|ateam|btime|stime|match_?name)/i.test(k));
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((x) => looksLikeMatch(x))) { found.push(node); return; }
      node.forEach(walk);
    } else if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(walk);
    }
  };
  walk(obj);
  return found.sort((a, b) => b.length - a.length)[0] || null;
}

function pick(obj, re) {
  const key = Object.keys(obj).find((k) => re.test(k));
  return key !== undefined ? obj[key] : undefined;
}

export async function fetchOfficial() {
  let text;
  try {
    text = await fetchText(OFFICIAL_SCHEDULE_URL);
  } catch (e) {
    throw new Error(
      `官方接口无法访问（${e.cause?.code || e.message}）。当前网络可能拦截了 api.tgatv.qq.com` +
      '（DNS 污染/代理规则）。可尝试带代理启动：NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 npm start，' +
      '或改用「自定义JSON」源手动/脚本导入。'
    );
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('官方接口返回的不是 JSON（可能被网络拦截或接口已变更）'); }
  const arr = extractMatchArray(json);
  if (!arr || arr.length === 0) {
    throw new Error('官方接口返回结构无法解析（接口字段可能已变更），可改用“自定义JSON”源；原始响应已记录在错误信息外');
  }
  const toName = (v) => String(v ?? '').trim().replace(/(战队|电竞俱乐部)$/, '');
  const schedule = arr.map((m) => {
    const h = pick(m, /(h|host|home|left).*(name|team)/i) ?? pick(m, /hteam/i);
    const a = pick(m, /(a|guest|away|right).*(name|team)/i) ?? pick(m, /gteam|ateam/i);
    const t = pick(m, /(btime|stime|start|match_?time|time|date)/i);
    const raw = String(t ?? '');
    const mDate = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const mTime = raw.match(/(\d{1,2}):(\d{2})/);
    return {
      event: toName(pick(m, /(league|match_?name|season|title)/i)) || 'KPL',
      stage: toName(pick(m, /stage|round|period/i)) || '常规赛',
      date: mDate ? `${mDate[1]}-${String(mDate[2]).padStart(2, '0')}-${String(mDate[3]).padStart(2, '0')}` : '',
      time: mTime ? `${String(mTime[1]).padStart(2, '0')}:${mTime[2]}` : '',
      team1: toName(h), team2: toName(a),
      note: '',
    };
  }).filter((s) => s.team1 && s.team2 && /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  if (schedule.length === 0) throw new Error('官方接口解析结果为空');
  return { schedule };
}
