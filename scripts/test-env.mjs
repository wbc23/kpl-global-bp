/**
 * 测试环境启动器：与生产完全隔离的端口/数据库/静态目录。
 *   npm run start:test            → http://localhost:9101（库：data/kpl-test.db，静态：dist-test）
 *   npm run start:test -- --reset → 同上，但先删除测试数据库（重新预置战队/选手/赛事）
 * 验证通过后的"同步到生产"见 README「测试环境与同步」一节。
 */
const fs = await import('node:fs');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = path.join(ROOT, 'data', `kpl-test.db${suffix}`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log('[test-env] 测试数据库已重置（data/kpl-test.db 将在启动时重新预置）');
}

process.env.PORT = process.env.PORT || '9101';
process.env.DB_PATH = process.env.DB_PATH || 'data/kpl-test.db';
process.env.DIST_DIR = process.env.DIST_DIR || 'dist-test';

await import('../server/index.mjs');
