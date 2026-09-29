/**
 * 把生产数据库完整复制到测试环境（替代已删除的导出/导入功能）。
 *   npm run copy:test
 * 前置条件：测试服务必须已关闭（9101 端口空闲）；生产服务可保持运行
 * （使用 node:sqlite 在线备份 API，对正在写入的生产库也能拿到一致快照）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROD = path.join(ROOT, 'data', 'kpl.db');
const TEST = path.join(ROOT, 'data', 'kpl-test.db');

// 测试服务在运行时直接覆盖其数据库文件会损坏数据，先拒绝
try {
  await fetch('http://localhost:9101/api/meta', { signal: AbortSignal.timeout(800) });
  console.error('[copy:test] 检测到测试服务正在运行（9101）。请先关闭测试服务窗口，再执行本命令。');
  process.exit(1);
} catch { /* 连不上 = 测试服务已停，继续 */ }

if (!fs.existsSync(PROD)) {
  console.error('[copy:test] 未找到生产数据库 data/kpl.db');
  process.exit(1);
}

// 清理旧测试库及残留的 journal 文件，再写入全新副本
for (const suffix of ['', '-wal', '-shm']) {
  const f = TEST + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const prod = new DatabaseSync(PROD, { readOnly: true });
await backup(prod, TEST);

const check = new DatabaseSync(TEST, { readOnly: true });
const count = (t) => check.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
console.log(`[copy:test] 已复制到 data/kpl-test.db：${count('teams')} 队 / ${count('players')} 选手 / ${count('events')} 赛事 / ${count('series')} 场系列赛 / ${count('schedule')} 条赛程 / ${count('team_rosters')} 份大名单`);
check.close();
console.log('[copy:test] 启动测试环境（npm run start:test）即可使用。');
