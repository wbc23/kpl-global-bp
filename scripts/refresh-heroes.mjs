/**
 * 生成 src/data/heroes.json
 *
 * 数据来源：王者荣耀官网 https://pvp.qq.com/web201605/js/herolist.json
 * 头像 CDN：https://game.gtimg.cn/images/yxzj/img201606/heroimg/{id}/{id}.jpg
 *
 * 用法：
 *   1. curl -sL https://pvp.qq.com/web201605/js/herolist.json -o scripts/herolist.raw.json
 *   2. node scripts/refresh-heroes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPath = path.join(__dirname, 'herolist.raw.json');
const outPath = path.join(__dirname, '..', 'src', 'data', 'heroes.json');

// 拼音检索字段依赖 pinyin-pro（devDependency）；未安装时沿用旧 heroes.json 中已有的 py，
// 避免例行刷新后悄悄丢失拼音搜索能力
let pinyinFn = null;
try {
  ({ pinyin: pinyinFn } = await import('pinyin-pro'));
} catch { /* 沿用旧数据 */ }
let prevPy = {};
try {
  for (const h of JSON.parse(fs.readFileSync(outPath, 'utf8'))) prevPy[h.id] = h.py || '';
} catch { /* 首次生成 */ }

/** 全拼 + 首字母，如 关羽 → "guanyu gy"，称号一骑当千 → "yiqidangqian yqdq"。
 *  ü 按“绿=lv、女=nv”惯例转 v，并附 u 写法变体（吕布 → "lvbu lb lubu"） */
function pinyinKeys(text) {
  if (!pinyinFn || !text) return '';
  const syllables = pinyinFn(text, { toneType: 'none', type: 'array', v: true, nonZh: 'consecutive' })
    .join(' ').split(/[^a-z]+/).filter(Boolean);
  if (!syllables.length) return '';
  const full = syllables.join('');
  const initials = syllables.map((s) => s[0]).join('');
  const parts = [full, initials];
  if (full.includes('v')) parts.push(full.replace(/v/g, 'u'));
  return parts.join(' ');
}

// 官方职业编码（hero_type / hero_type2）
const ROLE_TYPE = { 1: '战士', 2: '法师', 3: '坦克', 4: '刺客', 5: '射手', 6: '辅助' };
// 官方分路编码（roles / extra_cold_lane 字段）
const LANE_TYPE = { 1: '对抗路', 2: '打野', 3: '中路', 4: '发育路', 5: '游走' };

/**
 * 分路默认值人工修正：官方接口的分路顺序与版本实况不一致时，在此指定主分路，
 * 生成时把该分路排到最前（其余分路保留作次选回退）。想改哪个英雄加一行即可。
 */
const LANE_PRIMARY = {
  '哪吒': '打野',
  '夏侯惇': '打野',
  '杨戬': '打野',
  '蚩奼': '发育路',
  '卢雅那': '发育路',
  '张良': '游走',
  '赵怀真': '游走',
  '元流之子·坦克': '打野',
  '梦奇': '打野',
  '墨子': '游走',
  '猪八戒': '打野',
};

/**
 * 拼音检索别名表：heroMatch 按英雄名 / py 各词做子串匹配（见 src/data/heroSearch.js），
 * 子串覆盖不到的写法才需要在这里手工补（heroes.json 勿手改，会被本脚本覆盖）。示例：
 *   '司空震': 'xxx',
 */
const PY_EXTRA = {};

const list = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

// 多形态英雄（如“元流之子(法师/坦克/射手/辅助/刺客)”）按独立条目处理，
// 名称格式化为“元流之子·法师”，各形态保留自己的官方头像/职业/分路
const heroes = [];
for (const h of list) {
  const m = String(h.cname).match(/^(.+?)[(（](.+?)[)）]$/);
  const name = m ? `${m[1]}·${m[2]}` : h.cname;
  const roles = [...new Set([h.hero_type, h.hero_type2].filter((t) => ROLE_TYPE[t]).map((t) => ROLE_TYPE[t]))];
  const laneCodes = `${h.roles || ''}|${h.extra_cold_lane || ''}`.split('|').filter(Boolean);
  let lanes = [...new Set(laneCodes.map((c) => LANE_TYPE[c]).filter(Boolean))];
  // 人工指定的主分路排到最前（官方未给该分路时补上），作为选人时的默认推荐位置
  const primary = LANE_PRIMARY[name];
  if (primary) lanes = [primary, ...lanes.filter((l) => l !== primary)];
  // py 仅含英雄名拼音（用户只用名称搜索，称号不参与检索）
  const py = [
    pinyinFn ? pinyinKeys(name) : (prevPy[h.ename] || ''),
    PY_EXTRA[name] || '',
  ].filter(Boolean).join(' ');
  heroes.push({ id: h.ename, name, title: h.title || '', py, roles, lanes });
}

// 按名称排序，方便浏览
heroes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

fs.writeFileSync(outPath, JSON.stringify(heroes, null, 2));
console.log(`已生成 ${outPath}，共 ${heroes.length} 名英雄`);
if (!pinyinFn) console.warn('未安装 pinyin-pro：py 字段沿用旧数据，新英雄将无拼音检索');
const forms = heroes.filter((h) => h.name.includes('·'));
if (forms.length) console.log('多形态条目：', forms.map((h) => h.name).join('、'));
