/**
 * 英雄检索通用匹配（英雄池搜索框 / 数据分析页搜索共用）。
 *
 * 匹配规则（只按英雄名检索，称号不参与）：子串匹配英雄名与 py 各词
 * （名称全拼 / 标准首字母 / 别名，如 guanyu、gy、lvbu、lubu）。
 * 曾评估过"≥3 字符子序列匹配"，用户决定不做——勿自行加回。
 */

// 每英雄检索词缓存：[名称小写, py 各词小写...]，只在首次访问时构建
const tokenCache = new Map();
export function heroTokens(hero) {
  if (hero == null) return [];
  if (!tokenCache.has(hero.id)) {
    const tokens = [];
    if (hero.name) tokens.push(String(hero.name).toLowerCase());
    for (const t of String(hero.py || '').toLowerCase().split(/\s+/)) {
      if (t) tokens.push(t);
    }
    tokenCache.set(hero.id, tokens);
  }
  return tokenCache.get(hero.id);
}

/** hero 是否命中查询词（大小写不敏感；空查询恒命中） */
export function heroMatch(hero, rawQuery) {
  const q = String(rawQuery ?? '').trim().toLowerCase();
  if (!q) return true;
  if (hero == null) return false;
  for (const t of heroTokens(hero)) {
    if (t.includes(q)) return true;
  }
  return false;
}
