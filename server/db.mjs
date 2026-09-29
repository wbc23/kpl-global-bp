/**
 * 数据层：Node 内置 sqlite（node:sqlite），零原生编译依赖
 * 数据文件：<项目根>/data/kpl.db（可经 DB_PATH 环境变量覆盖，测试环境用 data/kpl-test.db 隔离）
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
export const DB_PATH = process.env.DB_PATH
  ? path.resolve(ROOT, process.env.DB_PATH)
  : path.join(DATA_DIR, 'kpl.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// 启动时自动快照数据库，防止误删/误改无法恢复（保留最近 14 份；快照与库同名前缀，测试库不混入生产备份）
try {
  const backupDir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const base = path.basename(DB_PATH, '.db');
  if (fs.existsSync(DB_PATH)) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const dst = path.join(backupDir, `${base}-${stamp}.db`);
    if (!fs.existsSync(dst)) fs.copyFileSync(DB_PATH, dst);
    const snapRe = new RegExp(`^${base}-\\d+\\.db$`);
    const olds = fs.readdirSync(backupDir).filter((f) => snapRe.test(f)).sort();
    while (olds.length > 14) fs.unlinkSync(path.join(backupDir, olds.shift()));
  }
} catch { /* 备份失败不阻断启动 */ }

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  short TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- 一场系列赛：赛段、日期、BO、双方战队与本场出场阵容（系列赛级，选手按位置顺序 0-4）
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  stage TEXT NOT NULL DEFAULT '常规赛',
  date TEXT NOT NULL,
  bo INTEGER NOT NULL,
  team1_id INTEGER NOT NULL REFERENCES teams(id),
  team2_id INTEGER NOT NULL REFERENCES teams(id),
  roster1 TEXT NOT NULL, -- JSON: ["选手名" x5]
  roster2 TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 一局比赛：完整 Ban/Pick 顺序（draft JSON）+ 胜方 + 本局蓝方是系列赛的哪一队
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  game_no INTEGER NOT NULL,
  blind INTEGER NOT NULL DEFAULT 0,          -- 巅峰对决（盲选）
  blue_team_is_1 INTEGER NOT NULL,           -- 1: 队伍1执蓝, 2: 队伍2执蓝
  winner_side TEXT NOT NULL,                 -- 'blue' | 'red'
  roster1 TEXT,                              -- 本局队伍1阵容 JSON（逐局换人时才有值，null=沿用系列赛阵容）
  roster2 TEXT,
  draft TEXT NOT NULL                        -- JSON [{type:'ban'|'pick', side, hero, player?}]
);
CREATE INDEX IF NOT EXISTS idx_games_series ON games(series_id);

-- 赛程（未打的比赛排期，可手动维护或由同步源生成）
CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  stage TEXT NOT NULL DEFAULT '常规赛',
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  team1_id INTEGER NOT NULL REFERENCES teams(id),
  team2_id INTEGER NOT NULL REFERENCES teams(id),
  status TEXT NOT NULL DEFAULT 'planned',  -- planned | recorded
  series_id INTEGER,                        -- 录入完成后关联的系列赛
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 同步待审区：抓取的数据先落这里，人工确认后才入库
CREATE TABLE IF NOT EXISTS pending_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                       -- 'series' | 'schedule'
  source TEXT NOT NULL,
  summary TEXT NOT NULL,                    -- 预览信息 JSON
  payload TEXT NOT NULL,                    -- 标准化后的数据 JSON（确认时入库）
  warning TEXT NOT NULL DEFAULT '',         -- 如“与已有系列赛重复”
  raw TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending（确认后删除）
  fetched_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 战队大名单：每赛事每队一份，前 5 位默认按位置顺序（对抗/打野/中/发育/游走），其余为替补
CREATE TABLE IF NOT EXISTS team_rosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  players TEXT NOT NULL,                    -- JSON: ["选手名", ...]
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(event_id, team_id)
);

-- 赛事参赛战队：某赛事的参赛队集合（大名单页「参赛战队」弹窗整体替换写入）。
-- 无外键（战队/赛事删除时由接口顺手清理，避免删除联动复杂化）；
-- 某赛事无记录 = 未设置，前端回退显示全部战队
CREATE TABLE IF NOT EXISTS event_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  UNIQUE(event_id, team_id)
);
`);

// 老库迁移：schedule.auto 标记（由"录入联动"自动生成的镜像行，删系列赛时随之删除）
// 首次升级时为已录入但没有赛程行的系列赛补齐镜像，使赛程页完整展示历史录入
let scheduleAutoAdded = false;
try {
  db.prepare('ALTER TABLE schedule ADD COLUMN auto INTEGER NOT NULL DEFAULT 0').run();
  scheduleAutoAdded = true;
} catch { /* 列已存在（非首次升级） */ }
if (scheduleAutoAdded) {
  db.prepare(`
    INSERT INTO schedule(event_id, stage, date, time, team1_id, team2_id, status, series_id, auto)
    SELECT s.event_id, s.stage, s.date, '', s.team1_id, s.team2_id, 'recorded', s.id, 1
    FROM series s
    WHERE NOT EXISTS (SELECT 1 FROM schedule sc WHERE sc.series_id = s.id)
  `).run();
}

// 老库迁移：games.roster1/roster2（逐局换人阵容，null=沿用系列赛阵容）
for (const col of ['roster1', 'roster2']) {
  try { db.prepare(`ALTER TABLE games ADD COLUMN ${col} TEXT`).run(); } catch { /* 列已存在 */ }
}

/** 首次启动预置 KPL 战队（2026 赛季 18 支名单，名称可随时在“基础数据”页修改/删除） */
const PRESET_TEAMS = [
  ['北京JDG', 'JDG'], ['广州TTG', 'TTG'], ['长沙TES.A', 'TES.A'], ['SYG', 'SYG'],
  ['西安WE', 'WE'], ['佛山DRG', 'DRG'], ['北京WB', 'WB'], ['杭州LGD.NBW', 'NBW'],
  ['上海EDG.M', 'EDG.M'], ['南通Hero久竞', 'Hero'], ['武汉eStarPro', 'eStar'],
  ['上海RNG.M', 'RNG.M'], ['KSG', 'KSG'], ['成都AG超玩会', 'AG'], ['重庆狼队', '狼队'],
  ['济南RW侠', 'RW侠'], ['深圳DYG', 'DYG'], ['WST', 'WST'],
];

// 选手快捷库：仅作录入提示用，可删改，不代表任何当前阵容
const PRESET_PLAYERS = ['一诺', '花海', '帆帆', '妖刀', '清融', '暖阳', '子阳', '无畏', '久诚', 'Cat'];

export function ensureSeed() {
  const teamCount = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
  if (teamCount === 0) {
    const ins = db.prepare('INSERT INTO teams(name, short) VALUES(?, ?)');
    for (const [name, short] of PRESET_TEAMS) ins.run(name, short);
  }
  const playerCount = db.prepare('SELECT COUNT(*) AS c FROM players').get().c;
  if (playerCount === 0) {
    const ins = db.prepare('INSERT INTO players(name) VALUES(?)');
    for (const name of PRESET_PLAYERS) ins.run(name);
  }
}

/** 录入系列赛时，把阵容中出现的新选手名收进选手库 */
export function absorbPlayers(names) {
  const ins = db.prepare('INSERT INTO players(name) VALUES(?) ON CONFLICT(name) DO NOTHING');
  for (const n of names) if (n && n.trim()) ins.run(n.trim());
}

export function loadAllData() {
  const teams = db.prepare('SELECT * FROM teams ORDER BY name').all();
  const players = db.prepare('SELECT * FROM players ORDER BY name').all();
  const events = db.prepare('SELECT * FROM events ORDER BY name').all();
  const seriesRows = db.prepare(`
    SELECT s.*, t1.name AS team1_name, t1.short AS team1_short,
           t2.name AS team2_name, t2.short AS team2_short, e.name AS event_name
    FROM series s
    JOIN teams t1 ON t1.id = s.team1_id
    JOIN teams t2 ON t2.id = s.team2_id
    JOIN events e ON e.id = s.event_id
    ORDER BY s.date DESC, s.id DESC
  `).all();
  const gameRows = db.prepare('SELECT * FROM games ORDER BY series_id, game_no').all();
  const scheduleRows = db.prepare(`
    SELECT sc.*, t1.name AS team1_name, t1.short AS team1_short,
           t2.name AS team2_name, t2.short AS team2_short, e.name AS event_name
    FROM schedule sc
    JOIN teams t1 ON t1.id = sc.team1_id
    JOIN teams t2 ON t2.id = sc.team2_id
    JOIN events e ON e.id = sc.event_id
    ORDER BY sc.date ASC, sc.time ASC, sc.id ASC
  `).all();

  const gamesBySeries = new Map();
  for (const g of gameRows) {
    if (!gamesBySeries.has(g.series_id)) gamesBySeries.set(g.series_id, []);
    gamesBySeries.get(g.series_id).push({
      id: g.id,
      gameNo: g.game_no,
      blind: !!g.blind,
      blue1: g.blue_team_is_1 === 1,
      winner: g.winner_side,
      roster1: g.roster1 ? JSON.parse(g.roster1) : null,
      roster2: g.roster2 ? JSON.parse(g.roster2) : null,
      draft: JSON.parse(g.draft),
    });
  }

  const series = seriesRows.map((s) => ({
    id: s.id,
    eventId: s.event_id,
    event: s.event_name,
    stage: s.stage,
    date: s.date,
    bo: s.bo,
    note: s.note,
    team1: { id: s.team1_id, name: s.team1_name, short: s.team1_short },
    team2: { id: s.team2_id, name: s.team2_name, short: s.team2_short },
    roster1: JSON.parse(s.roster1),
    roster2: JSON.parse(s.roster2),
    games: gamesBySeries.get(s.id) || [],
  }));

  const schedule = scheduleRows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    event: r.event_name,
    stage: r.stage,
    date: r.date,
    time: r.time,
    team1: { id: r.team1_id, name: r.team1_name, short: r.team1_short },
    team2: { id: r.team2_id, name: r.team2_name, short: r.team2_short },
    status: r.status,
    seriesId: r.series_id,
    auto: !!r.auto,
    note: r.note,
  }));

  const rosterRows = db.prepare(`
    SELECT r.*, t.name AS team_name, t.short AS team_short, e.name AS event_name
    FROM team_rosters r
    JOIN teams t ON t.id = r.team_id
    JOIN events e ON e.id = r.event_id
    ORDER BY t.name
  `).all();
  const rosters = rosterRows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    event: r.event_name,
    teamId: r.team_id,
    team: { id: r.team_id, name: r.team_name, short: r.team_short },
    players: JSON.parse(r.players),
    updatedAt: r.updated_at,
  }));

  return { teams, players, events, series, schedule, rosters };
}

export function seriesInUse(teamId) {
  return db.prepare('SELECT COUNT(*) AS c FROM series WHERE team1_id = ? OR team2_id = ?').get(teamId, teamId).c > 0;
}
