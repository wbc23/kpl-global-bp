/**
 * 数据同步命令行：抓取 → 写入待审区（不会直接入库！）
 * 抓取结果写入 pending_imports 待审表，需自行从表中确认后入库（原「赛程 → 数据同步」确认面板已随赛程页移除）。
 *
 * 用法：
 *   npm run sync                  # 抓取官方赛程（实验性）
 *   npm run sync -- official      # 同上
 *   npm run sync -- url <地址>    # 抓取自定义 JSON 源
 *   npm run sync -- text <文件>   # 从本地 JSON 文件读取
 *
 * 若网络需走代理（如官方接口被拦截）：
 *   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 npm run sync
 */
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:9100';

const [, , cmd = 'official', arg] = process.argv;

async function main() {
  let body;
  if (cmd === 'official' || cmd === 'official-schedule') body = { source: 'official' };
  else if (cmd === 'url') body = { source: 'url', url: arg };
  else if (cmd === 'text') body = { source: 'text', text: fs.readFileSync(arg, 'utf8') };
  else {
    console.log('用法: npm run sync -- [official | url <地址> | text <文件>]');
    process.exit(1);
  }

  let res;
  try {
    res = await fetch(`${BASE}/api/sync/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    console.error(`✗ 无法连接数据服务（${BASE}）。请先启动：npm run dev 或 npm start`);
    process.exit(1);
  }
  const data = await res.json();
  if (!res.ok) {
    console.error(`✗ 抓取失败：${data.error}`);
    process.exit(1);
  }
  console.log(`✓ 已抓取并放入待审区：${data.staged} 条`);
  if (data.errors?.length) console.log('  以下条目解析失败被跳过：\n  - ' + data.errors.join('\n  - '));
  console.log('\n→ 已写入待审表 pending_imports，需自行从表中取出确认后入库（原「赛程 → 数据同步」确认面板已随赛程页移除）。');
}
main();
