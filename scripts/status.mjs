/**
 * 数据与服务现状一览（交接用：代替在文档里维护易过期的数据快照）。
 * 文档只写"怎么查"，快照会过期，本脚本输出的永远是当前真实状态。
 *
 * 用法：npm run status           生产 + 测试都看
 *       npm run status -- --test 只看测试环境
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function dbStats(file) {
  const p = path.join(ROOT, 'data', file);
  if (!fs.existsSync(p)) return null;
  const db = new DatabaseSync(p);
  try {
    const c = (sql) => db.prepare(sql).get().c;
    const last = db.prepare('SELECT date FROM series ORDER BY date DESC, id DESC LIMIT 1').get();
    return {
      teams: c('SELECT COUNT(*) c FROM teams'),
      players: c('SELECT COUNT(*) c FROM players'),
      events: c('SELECT COUNT(*) c FROM events'),
      series: c('SELECT COUNT(*) c FROM series'),
      games: c('SELECT COUNT(*) c FROM games'),
      rosters: c('SELECT COUNT(*) c FROM team_rosters'),
      pending: c('SELECT COUNT(*) c FROM pending_imports'),
      lastDate: last?.date || '',
    };
  } finally {
    db.close();
  }
}

async function portStatus(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/meta`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? '运行中' : `HTTP ${r.status}`;
  } catch {
    return '未运行';
  }
}

const fmt = (name, s) => (s
  ? `${name}：${s.teams} 队 / ${s.players} 选手 / ${s.events} 赛事 / ${s.series} 场系列赛 / ${s.games} 局 / ${s.rosters} 份大名单 / 待审 ${s.pending} 条${s.lastDate ? `（最近一场 ${s.lastDate}）` : ''}`
  : `${name}：数据库不存在`);

const onlyTest = process.argv.includes('--test');

console.log('— 服务 —');
console.log(`9100 生产：${await portStatus(9100)}`);
console.log(`9101 测试：${await portStatus(9101)}`);
console.log('— 数据 —');
if (!onlyTest) console.log(fmt('生产库 data/kpl.db', dbStats('kpl.db')));
console.log(fmt('测试库 data/kpl-test.db', dbStats('kpl-test.db')));
