/**
 * 本地数据服务：Express + node:sqlite
 * 开发：npm run dev（与 Vite 并行，/api 由 Vite 代理转发）
 * 生产：npm run build && npm start（同端口直出 dist 静态文件）
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, DB_PATH, ensureSeed, absorbPlayers, loadAllData, seriesInUse } from './db.mjs';
import { fetchOfficial, normalizeDump, summarize, ensureBase } from './adapters.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 默认 9100：避开 Windows Hyper-V 动态保留端口段（可用 PORT 环境变量覆盖）
const PORT = Number(process.env.PORT) || 9100;
// 静态目录可经 DIST_DIR 覆盖（测试环境用 dist-test，验证通过后再构建进生产 dist）
const DIST_DIR = process.env.DIST_DIR ? path.resolve(ROOT, process.env.DIST_DIR) : path.join(ROOT, 'dist');

ensureSeed();

const app = express();
app.use(express.json({ limit: '10mb' }));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: String(e?.message || e) });
});

/* ---------- 元数据 ---------- */
app.get('/api/meta', wrap((req, res) => {
  const { teams, players, events } = loadAllData();
  // 当前赛事：最新有系列赛录入的赛事（按系列赛日期，同日取后录入的）；
  // 全部无录入时取最新创建的赛事。各页面的默认赛事以它为准
  const latest = db.prepare('SELECT event_id AS eid FROM series ORDER BY date DESC, id DESC LIMIT 1').get();
  const currentEventId = latest ? latest.eid : (events.length ? events[events.length - 1].id : null);
  res.json({ teams, players, events, currentEventId });
}));

/* ---------- 赛程 ---------- */
app.get('/api/schedule', wrap((req, res) => {
  res.json({ schedule: loadAllData().schedule });
}));

app.post('/api/schedule', wrap((req, res) => {
  const p = req.body || {};
  if (!p.eventId || !p.date || !p.team1Id || !p.team2Id || p.team1Id === p.team2Id) {
    return res.status(400).json({ error: '赛程字段不完整（需赛事/日期/两支不同战队）' });
  }
  const r = db.prepare(`
    INSERT INTO schedule(event_id, stage, date, time, team1_id, team2_id, note)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `).run(p.eventId, p.stage || '常规赛', p.date, p.time || '', p.team1Id, p.team2Id, p.note || '');
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.put('/api/schedule/:id', wrap((req, res) => {
  const p = req.body || {};
  const c = db.prepare('SELECT * FROM schedule WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: '赛程不存在' });
  const next = {
    eventId: p.eventId ?? c.event_id,
    stage: p.stage ?? c.stage,
    date: p.date ?? c.date,
    time: p.time ?? c.time,
    team1Id: p.team1Id ?? c.team1_id,
    team2Id: p.team2Id ?? c.team2_id,
    note: p.note ?? c.note,
  };
  if (next.team1Id === next.team2Id) return res.status(400).json({ error: '两队不能相同' });
  db.prepare(`
    UPDATE schedule SET event_id=?, stage=?, date=?, time=?, team1_id=?, team2_id=?, note=? WHERE id=?
  `).run(next.eventId, next.stage, next.date, next.time, next.team1Id, next.team2Id, next.note, c.id);
  res.json({ ok: true });
}));

app.delete('/api/schedule/:id', wrap((req, res) => {
  db.prepare('DELETE FROM schedule WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
}));

/* ---------- 战队 ---------- */
app.post('/api/teams', wrap((req, res) => {
  const { name, short } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '战队名不能为空' });
  const exist = db.prepare('SELECT id FROM teams WHERE name = ?').get(name.trim());
  if (exist) return res.status(409).json({ error: '已存在同名战队' });
  const r = db.prepare('INSERT INTO teams(name, short) VALUES(?, ?)').run(name.trim(), (short || '').trim());
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.put('/api/teams/:id', wrap((req, res) => {
  const { name, short } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '战队名不能为空' });
  db.prepare('UPDATE teams SET name = ?, short = ? WHERE id = ?').run(name.trim(), (short || '').trim(), req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/teams/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  if (seriesInUse(id)) return res.status(409).json({ error: '该战队已有关联系列赛，无法删除' });
  // schedule/team_rosters 均有外键约束（无 ON DELETE），有引用时删除会撞约束 → 提前给友好提示
  const schedRefs = db.prepare('SELECT COUNT(*) AS c FROM schedule WHERE team1_id = ? OR team2_id = ?').get(id, id).c;
  if (schedRefs > 0) return res.status(409).json({ error: `该战队尚有 ${schedRefs} 条关联赛程，请先删除相关排期` });
  const rosterRefs = db.prepare('SELECT COUNT(*) AS c FROM team_rosters WHERE team_id = ?').get(id).c;
  if (rosterRefs > 0) return res.status(409).json({ error: '该战队尚有大名单，请先在大名单页删除' });
  db.prepare('DELETE FROM event_teams WHERE team_id = ?').run(id); // 参赛关系随战队清理（无外键，顺手清孤儿）
  db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  res.json({ ok: true });
}));

/* ---------- 选手 ---------- */
app.post('/api/players', wrap((req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '选手名不能为空' });
  db.prepare('INSERT INTO players(name) VALUES(?) ON CONFLICT(name) DO NOTHING').run(name.trim());
  res.json({ ok: true });
}));

app.delete('/api/players/:id', wrap((req, res) => {
  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

/* ---------- 赛事 ---------- */
app.post('/api/events', wrap((req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '赛事名不能为空' });
  const exist = db.prepare('SELECT id FROM events WHERE name = ?').get(name.trim());
  if (exist) return res.status(409).json({ error: '已存在同名赛事' });
  const r = db.prepare('INSERT INTO events(name) VALUES(?)').run(name.trim());
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.delete('/api/events/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) AS c FROM series WHERE event_id = ?').get(id).c;
  if (used > 0) return res.status(409).json({ error: '该赛事已有关联系列赛，无法删除' });
  // schedule/team_rosters 对 events 也有外键，有引用时提前 409 而非裸 500
  const schedRefs = db.prepare('SELECT COUNT(*) AS c FROM schedule WHERE event_id = ?').get(id).c;
  if (schedRefs > 0) return res.status(409).json({ error: `该赛事尚有 ${schedRefs} 条赛程，请先删除相关排期` });
  const rosterRefs = db.prepare('SELECT COUNT(*) AS c FROM team_rosters WHERE event_id = ?').get(id).c;
  if (rosterRefs > 0) return res.status(409).json({ error: `该赛事尚有 ${rosterRefs} 份战队大名单，请先删除` });
  db.prepare('DELETE FROM event_teams WHERE event_id = ?').run(id); // 参赛关系随赛事清理
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  res.json({ ok: true });
}));

/* ---------- 系列赛（含全部对局） ---------- */
app.get('/api/series', wrap((req, res) => {
  res.json({ series: loadAllData().series });
}));

function validateSeriesPayload(p) {
  const need = ['eventId', 'stage', 'date', 'bo', 'team1Id', 'team2Id', 'roster1', 'roster2', 'games'];
  for (const k of need) if (p[k] === undefined || p[k] === null) return `缺少字段 ${k}`;
  if (p.team1Id === p.team2Id) return '两队不能相同';
  if (![3, 5, 7].includes(p.bo)) return 'BO 只能为 3/5/7';
  // 阵容需 5 名且互不重复（同队重名会让选手归属与整队锁定全部错位，与换人/单局修正端点同口径）
  const rosterErr = (r, label) => (!Array.isArray(r) || r.length !== 5)
    ? `${label}阵容需为 5 名选手`
    : (new Set(r.map((x) => String(x ?? '').trim())).size !== 5 ? `${label}阵容存在重复选手` : null);
  const e1 = rosterErr(p.roster1, '队伍1');
  if (e1) return e1;
  const e2 = rosterErr(p.roster2, '队伍2');
  if (e2) return e2;
  if (!Array.isArray(p.games) || p.games.length === 0) return '至少需要 1 局比赛';
  for (const g of p.games) {
    if (!['blue', 'red'].includes(g.winner)) return '胜方字段不合法';
    if (![1, 2, true, false].includes(g.blue1)) return '本局蓝方字段不合法';
    if (!Array.isArray(g.draft)) return 'draft 数据不合法';
  }
  return null;
}

// 归一化本局蓝方字段：布尔或 1/2 → 1|2（表示执蓝的队伍编号）
function blue1Norm(v) {
  return v === true || v === 1 ? 1 : 2;
}

/** 收集载荷中出现的全部选手名（系列赛阵容 + 逐局阵容），用于吸收进选手库 */
function collectPlayerNames(p) {
  const names = [];
  const push = (r) => { if (Array.isArray(r)) names.push(...r); };
  push(p.roster1); push(p.roster2);
  for (const g of (Array.isArray(p.games) ? p.games : [])) { push(g.roster1); push(g.roster2); }
  return names;
}

app.post('/api/series', wrap((req, res) => {
  const p = req.body || {};
  const err = validateSeriesPayload(p);
  if (err) return res.status(400).json({ error: err });

  db.exec('BEGIN');
  try {
    // 选手吸收在事务内：保存失败回滚时不留孤儿选手；逐局换人的替补也一并收录
    absorbPlayers(collectPlayerNames(p));
    const r = db.prepare(`
      INSERT INTO series(event_id, stage, date, bo, team1_id, team2_id, roster1, roster2, note)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.eventId, p.stage || '常规赛', p.date, p.bo, p.team1Id, p.team2Id,
      JSON.stringify(p.roster1), JSON.stringify(p.roster2), p.note || '');
    const seriesId = Number(r.lastInsertRowid);
    const insGame = db.prepare(`
      INSERT INTO games(series_id, game_no, blind, blue_team_is_1, winner_side, roster1, roster2, draft)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `);
    p.games.forEach((g, i) => {
      insGame.run(seriesId, g.gameNo ?? i + 1, g.blind ? 1 : 0, blue1Norm(g.blue1), g.winner,
        g.roster1 ? JSON.stringify(g.roster1) : null, g.roster2 ? JSON.stringify(g.roster2) : null,
        JSON.stringify(g.draft));
    });
    // 赛程联动：赛程页「录入」带入的 scheduleId 优先；否则自动匹配
    // 同赛事同日同对阵的未录赛程；两者皆无则补一条"已录入"镜像行（auto=1），
    // 使赛程页完整展示已录比赛（删除系列赛时镜像行随之删除）
    if (p.scheduleId) {
      db.prepare('UPDATE schedule SET status = ?, series_id = ? WHERE id = ? AND status = ?')
        .run('recorded', seriesId, Number(p.scheduleId), 'planned');
    } else {
      const match = db.prepare(`
        SELECT id FROM schedule
        WHERE status = 'planned' AND event_id = ? AND date = ?
          AND ((team1_id = ? AND team2_id = ?) OR (team1_id = ? AND team2_id = ?))
        ORDER BY id LIMIT 1
      `).get(p.eventId, p.date, p.team1Id, p.team2Id, p.team2Id, p.team1Id);
      if (match) {
        db.prepare('UPDATE schedule SET status = ?, series_id = ? WHERE id = ?').run('recorded', seriesId, match.id);
      } else {
        db.prepare(`
          INSERT INTO schedule(event_id, stage, date, time, team1_id, team2_id, status, series_id, auto)
          VALUES(?, ?, ?, '', ?, ?, 'recorded', ?, 1)
        `).run(p.eventId, p.stage || '常规赛', p.date, p.team1Id, p.team2Id, seriesId);
      }
    }
    db.exec('COMMIT');
    res.json({ id: seriesId });
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}));

/* 补录保存（「继续录入」在原系列赛上写入对局）。
   fromGameNo 给出时为尾部追加语义：只替换该局号及之后的对局，此前的库内对局
   保持服务端版本——补录会话建立期间通过回放做的修正不会被草稿里的旧副本覆盖；
   库内局数与会话基准不一致（期间被增删过局）则 409 拒绝。
   fromGameNo 缺省 = 旧客户端整体替换，行为不变 */
app.put('/api/series/:id/games', wrap((req, res) => {
  const p = req.body || {};
  if (!Array.isArray(p.games) || p.games.length === 0) return res.status(400).json({ error: '至少需要 1 局比赛' });
  for (const g of p.games) {
    if (!['blue', 'red'].includes(g.winner)) return res.status(400).json({ error: '胜方字段不合法' });
    if (![1, 2, true, false].includes(g.blue1)) return res.status(400).json({ error: '本局蓝方字段不合法' });
    if (!Array.isArray(g.draft)) return res.status(400).json({ error: 'draft 数据不合法' });
  }
  const s = db.prepare('SELECT id FROM series WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: '系列赛不存在' });

  let from = 1;
  if (Number.isInteger(p.fromGameNo) && p.fromGameNo >= 1) {
    from = p.fromGameNo;
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM games WHERE series_id = ?').get(Number(req.params.id)).c;
    if (cnt !== from - 1) {
      return res.status(409).json({
        error: `数据冲突：该系列赛库中现有 ${cnt} 局，与补录会话建立时的 ${from - 1} 局不一致（期间库内对局被修改过）。`
          + '请刷新列表、放弃该草稿后重新「继续录入」',
      });
    }
  }

  db.exec('BEGIN');
  try {
    // 补录对局中出现的选手（含逐局换人替补）也吸收进选手库；事务内执行
    absorbPlayers(collectPlayerNames({ games: p.games }));
    if (from > 1) {
      db.prepare('DELETE FROM games WHERE series_id = ? AND game_no >= ?').run(Number(req.params.id), from);
    } else {
      db.prepare('DELETE FROM games WHERE series_id = ?').run(Number(req.params.id));
    }
    const insGame = db.prepare(`
      INSERT INTO games(series_id, game_no, blind, blue_team_is_1, winner_side, roster1, roster2, draft)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `);
    p.games.forEach((g, i) => {
      insGame.run(Number(req.params.id), from + i, g.blind ? 1 : 0, blue1Norm(g.blue1), g.winner,
        g.roster1 ? JSON.stringify(g.roster1) : null, g.roster2 ? JSON.stringify(g.roster2) : null,
        JSON.stringify(g.draft));
    });
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}));

app.delete('/api/series/:id', wrap((req, res) => {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM games WHERE series_id = ?').run(Number(req.params.id));
    db.prepare('DELETE FROM series WHERE id = ?').run(Number(req.params.id));
    // 录入联动自动生成的赛程镜像行随之删除；手动排期则恢复为未录入
    db.prepare('DELETE FROM schedule WHERE series_id = ? AND auto = 1').run(Number(req.params.id));
    db.prepare('UPDATE schedule SET status = ?, series_id = NULL WHERE series_id = ?').run('planned', Number(req.params.id));
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}));

/* 系列赛元数据修正（日期/赛段/赛事/战队/阵容/备注） */
app.put('/api/series/:id', wrap((req, res) => {
  const p = req.body || {};
  const c = db.prepare('SELECT * FROM series WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: '系列赛不存在' });
  const next = {
    eventId: p.eventId ?? c.event_id,
    stage: p.stage ?? c.stage,
    date: p.date ?? c.date,
    team1Id: p.team1Id ?? c.team1_id,
    team2Id: p.team2Id ?? c.team2_id,
    roster1: JSON.stringify(Array.isArray(p.roster1) && p.roster1.length === 5 ? p.roster1 : JSON.parse(c.roster1)),
    roster2: JSON.stringify(Array.isArray(p.roster2) && p.roster2.length === 5 ? p.roster2 : JSON.parse(c.roster2)),
    note: p.note ?? c.note,
  };
  if (next.team1Id === next.team2Id) return res.status(400).json({ error: '两队不能相同' });
  // 更新的阵容同样要求 5 名互不重复（与 validateSeriesPayload 同口径）
  for (const [roster, label] of [[JSON.parse(next.roster1), '队伍1'], [JSON.parse(next.roster2), '队伍2']]) {
    if (new Set(roster.map((x) => String(x ?? '').trim())).size !== 5) {
      return res.status(400).json({ error: `${label}阵容存在重复选手` });
    }
  }
  absorbPlayers([...JSON.parse(next.roster1), ...JSON.parse(next.roster2)]);
  db.prepare(`
    UPDATE series SET event_id=?, stage=?, date=?, team1_id=?, team2_id=?, roster1=?, roster2=?, note=? WHERE id=?
  `).run(next.eventId, next.stage, next.date, next.team1Id, next.team2Id, next.roster1, next.roster2, next.note, c.id);
  // 录入联动自动生成的赛程镜像行跟随系列赛元数据；手动排期不受影响
  db.prepare(`UPDATE schedule SET event_id=?, stage=?, date=?, team1_id=?, team2_id=? WHERE series_id = ? AND auto = 1`)
    .run(next.eventId, next.stage, next.date, next.team1Id, next.team2Id, c.id);
  res.json({ ok: true });
}));

/* 单局胜者修正 */
app.put('/api/games/:id', wrap((req, res) => {
  const { winner } = req.body || {};
  if (!['blue', 'red'].includes(winner)) return res.status(400).json({ error: 'winner 不合法' });
  const r = db.prepare('UPDATE games SET winner_side = ? WHERE id = ?').run(winner, Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: '对局不存在' });
  res.json({ ok: true });
}));

/* 单局 BP 修正：整体替换该局 draft（蓝红归属/盲选标记/本局阵容/胜者 可一并更新） */
app.put('/api/games/:id/draft', wrap((req, res) => {
  const { draft, blue1, blind, roster1, roster2, winner } = req.body || {};
  if (!Array.isArray(draft)) return res.status(400).json({ error: 'draft 不合法' });
  for (const a of draft) {
    if (!a || !['ban', 'pick'].includes(a.type) || !['blue', 'red'].includes(a.side) || a.hero === undefined) {
      return res.status(400).json({ error: 'draft 步骤不合法' });
    }
  }
  if (winner !== undefined && !['blue', 'red'].includes(winner)) return res.status(400).json({ error: '胜方不合法' });
  const okRoster = (r) => r === undefined || r === null
    || (Array.isArray(r) && r.length === 5 && r.every((x) => String(x ?? '').trim()) && new Set(r).size === 5);
  if (!okRoster(roster1) || !okRoster(roster2)) return res.status(400).json({ error: '本局阵容需为 5 名不重复选手' });

  const cur = db.prepare('SELECT blue_team_is_1, blind, roster1, roster2, winner_side FROM games WHERE id = ?').get(Number(req.params.id));
  if (!cur) return res.status(404).json({ error: '对局不存在' });
  // 更换本局阵容时，新上场的选手（替补）一并吸收进选手库
  absorbPlayers([...(Array.isArray(roster1) ? roster1 : []), ...(Array.isArray(roster2) ? roster2 : [])]);
  db.prepare(`
    UPDATE games SET draft = ?, blue_team_is_1 = ?, blind = ?, winner_side = ?, roster1 = ?, roster2 = ? WHERE id = ?
  `).run(
    JSON.stringify(draft),
    typeof blue1 === 'boolean' ? (blue1 ? 1 : 0) : cur.blue_team_is_1,
    typeof blind === 'boolean' ? (blind ? 1 : 0) : cur.blind,
    winner ?? cur.winner_side,
    roster1 === undefined ? cur.roster1 : (roster1 === null ? null : JSON.stringify(roster1)),
    roster2 === undefined ? cur.roster2 : (roster2 === null ? null : JSON.stringify(roster2)),
    Number(req.params.id),
  );
  res.json({ ok: true });
}));

/* ---------- 赛事参赛战队（大名单页「参赛战队」弹窗，整体替换语义） ---------- */
app.get('/api/events/:id/teams', wrap((req, res) => {
  const rows = db.prepare('SELECT team_id FROM event_teams WHERE event_id = ? ORDER BY id').all(Number(req.params.id));
  res.json({ teamIds: rows.map((r) => r.team_id) }); // 空数组 = 未设置，前端回退显示全部战队
}));

app.put('/api/events/:id/teams', wrap((req, res) => {
  const { teamIds } = req.body || {};
  if (!Array.isArray(teamIds) || teamIds.length < 1 || teamIds.length > 30) {
    return res.status(400).json({ error: '参赛战队数量需为 1-30' });
  }
  const ids = [...new Set(teamIds.map(Number))];
  if (ids.some((x) => !Number.isInteger(x) || x <= 0)) return res.status(400).json({ error: '战队 id 不合法' });
  if (ids.length !== teamIds.length) return res.status(400).json({ error: '参赛战队存在重复' });
  const exist = db.prepare(`SELECT COUNT(DISTINCT id) AS c FROM teams WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids).c;
  if (exist !== ids.length) return res.status(400).json({ error: '存在未知战队' });

  const eventId = Number(req.params.id);
  if (!db.prepare('SELECT id FROM events WHERE id = ?').get(eventId)) {
    return res.status(404).json({ error: '赛事不存在' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM event_teams WHERE event_id = ?').run(eventId);
    const ins = db.prepare('INSERT INTO event_teams(event_id, team_id) VALUES(?, ?)');
    for (const tid of ids) ins.run(eventId, tid);
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}));

/* ---------- 战队大名单（每赛事每队一份） ---------- */
app.get('/api/rosters', wrap((req, res) => {
  const { eventId } = req.query;
  let rosters = loadAllData().rosters;
  if (eventId) rosters = rosters.filter((r) => String(r.eventId) === String(eventId));
  res.json({ rosters });
}));

app.put('/api/rosters', wrap((req, res) => {
  const { eventId, teamId, players } = req.body || {};
  if (!eventId || !teamId) return res.status(400).json({ error: '缺少赛事或战队' });
  if (!Array.isArray(players) || players.length === 0) return res.status(400).json({ error: '名单不能为空' });
  const names = players.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (names.length === 0) return res.status(400).json({ error: '名单不能为空' });
  if (names.length > 12) return res.status(400).json({ error: '名单最多 12 人' });
  if (new Set(names).size !== names.length) return res.status(400).json({ error: '名单内存在重复选手' });
  absorbPlayers(names);
  db.prepare(`
    INSERT INTO team_rosters(event_id, team_id, players) VALUES(?, ?, ?)
    ON CONFLICT(event_id, team_id) DO UPDATE SET players = excluded.players, updated_at = datetime('now','localtime')
  `).run(eventId, teamId, JSON.stringify(names));
  res.json({ ok: true });
}));

app.delete('/api/rosters/:id', wrap((req, res) => {
  db.prepare('DELETE FROM team_rosters WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
}));

/* ---------- 数据同步（抓取 → 待审 → 确认） ---------- */

/** 与已有数据重复检测：同日期+同两队（无序）视为疑似重复 */
function dupWarning(item) {
  const p = item.payload;
  if (item.kind === 'series') {
    const names = [p.team1.name, p.team2.name];
    const rows = db.prepare(`
      SELECT s.id FROM series s JOIN teams t1 ON t1.id=s.team1_id JOIN teams t2 ON t2.id=s.team2_id
      WHERE s.date = ? AND ((t1.name = ? AND t2.name = ?) OR (t1.name = ? AND t2.name = ?))
    `).all(p.date, names[0], names[1], names[1], names[0]);
    if (rows.length > 0) return `库中已存在同日 ${names[0]} vs ${names[1]} 的系列赛（#${rows[0].id}），确认前请核对是否重复`;
  } else {
    const names = [p.team1.name, p.team2.name];
    const rows = db.prepare(`
      SELECT s.id FROM schedule s JOIN teams t1 ON t1.id=s.team1_id JOIN teams t2 ON t2.id=s.team2_id
      WHERE s.date = ? AND s.status='planned' AND ((t1.name = ? AND t2.name = ?) OR (t1.name = ? AND t2.name = ?))
    `).all(p.date, names[0], names[1], names[1], names[0]);
    if (rows.length > 0) return `赛程中已存在同日 ${names[0]} vs ${names[1]} 的未录入比赛，确认前请核对`;
  }
  return '';
}

app.post('/api/sync/fetch', wrap(async (req, res) => {
  const { source, url, text } = req.body || {};
  let dump;
  let rawText = '';
  if (source === 'official') {
    dump = await fetchOfficial();
    rawText = JSON.stringify(dump).slice(0, 8000);
  } else if (source === 'url') {
    if (!url) return res.status(400).json({ error: '缺少 url' });
    rawText = await fetchText(url);
    dump = JSON.parse(rawText);
  } else if (source === 'text') {
    if (!text) return res.status(400).json({ error: '缺少 JSON 文本' });
    rawText = String(text).slice(0, 8000);
    dump = JSON.parse(text);
  } else {
    return res.status(400).json({ error: '未知同步源' });
  }

  const meta = loadAllData();
  const norm = normalizeDump(dump, meta);
  const items = [...norm.series, ...norm.schedule];
  const ins = db.prepare(`
    INSERT INTO pending_imports(kind, source, summary, payload, warning, raw)
    VALUES(?, ?, ?, ?, ?, ?)
  `);
  for (const it of items) {
    ins.run(it.kind, source === 'official' ? '官方赛程' : (source === 'url' ? `URL: ${String(url).slice(0, 80)}` : '粘贴JSON'),
      JSON.stringify(summarize(it)), JSON.stringify(it.payload), dupWarning(it), rawText.slice(0, 4000));
  }
  res.json({ staged: items.length, errors: norm.errors });
}));

app.get('/api/sync/pending', wrap((req, res) => {
  const rows = db.prepare(`SELECT * FROM pending_imports WHERE status = 'pending' ORDER BY id DESC`).all();
  res.json({
    pending: rows.map((r) => ({
      id: r.id, kind: r.kind, source: r.source,
      summary: JSON.parse(r.summary), warning: r.warning, fetchedAt: r.fetched_at,
    })),
  });
}));

app.delete('/api/sync/pending/:id', wrap((req, res) => {
  db.prepare(`DELETE FROM pending_imports WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/sync/pending/:id/confirm', wrap((req, res) => {
  const row = db.prepare(`SELECT * FROM pending_imports WHERE id = ? AND status = 'pending'`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '待审条目不存在' });
  const payload = JSON.parse(row.payload);

  db.exec('BEGIN');
  try {
    const { eventId, team1Id, team2Id } = ensureBase(db, payload);
    if (row.kind === 'schedule') {
      db.prepare(`
        INSERT INTO schedule(event_id, stage, date, time, team1_id, team2_id, note)
        VALUES(?, ?, ?, ?, ?, ?, ?)
      `).run(eventId, payload.stage, payload.date, payload.time || '', team1Id, team2Id, payload.note || '');
    } else {
      absorbPlayers([...payload.roster1, ...payload.roster2]);
      const r = db.prepare(`
        INSERT INTO series(event_id, stage, date, bo, team1_id, team2_id, roster1, roster2, note)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(eventId, payload.stage, payload.date, payload.bo, team1Id, team2Id,
        JSON.stringify(payload.roster1), JSON.stringify(payload.roster2), payload.note || '');
      const sid = Number(r.lastInsertRowid);
      const insGame = db.prepare(`
        INSERT INTO games(series_id, game_no, blind, blue_team_is_1, winner_side, roster1, roster2, draft)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const g of payload.games) {
        insGame.run(sid, g.gameNo, g.blind ? 1 : 0, g.blue1, g.winner,
          g.roster1 ? JSON.stringify(g.roster1) : null, g.roster2 ? JSON.stringify(g.roster2) : null,
          JSON.stringify(g.draft));
      }
    }
    db.prepare(`DELETE FROM pending_imports WHERE id = ?`).run(row.id);
    db.exec('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}));

/* ---------- 静态资源（生产模式；测试环境经 DIST_DIR 指向 dist-test） ---------- */
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[server] 数据服务已启动: http://localhost:${PORT}  (数据库: ${DB_PATH})`);
});
