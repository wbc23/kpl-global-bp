export const ROLES = ['坦克', '战士', '刺客', '法师', '射手', '辅助'];
export const LANES = ['对抗路', '打野', '中路', '发育路', '游走'];

export const SIDE = {
  blue: { label: '蓝方', short: '蓝' },
  red: { label: '红方', short: '红' },
};

export const DEFAULT_PLAYERS = ['对抗路', '打野', '中路', '发育路', '游走'];

/** 分路徽章（与 DEFAULT_PLAYERS 位置一一对应）：文字直观、颜色辅助区分 */
export const LANE_BADGES = [
  { text: '对抗', full: '对抗路', cls: 'lane-top' },
  { text: '打野', full: '打野', cls: 'lane-jungle' },
  { text: '中路', full: '中路', cls: 'lane-mid' },
  { text: '发育', full: '发育路', cls: 'lane-farm' },
  { text: '游走', full: '游走', cls: 'lane-roam' },
];

export function sideName(state, side) {
  return state[side]?.name || SIDE[side].label;
}

/** 赛段体系：不同赛事赛制不同（录入表单与轮次分组共用）。
 *  默认（春季赛/夏季赛等常规赛季）= 常规赛 / 季后赛；
 *  赛事名含「总决赛」= 擂台赛 / 突围赛 / 淘汰赛（年度总决赛赛制）。
 *  以后出现新赛制（如挑战者杯）在 STAGE_SCHEMES 加一行即可；
 *  分析页对非默认赛段自动按赛段值直接分组（见 compute.js customStageDefs） */
export const DEFAULT_STAGES = ['常规赛', '季后赛'];
const STAGE_SCHEMES = [
  { match: /总决赛/, stages: ['擂台赛', '突围赛', '淘汰赛'] },
];
export function stagesForEvent(eventName) {
  const hit = STAGE_SCHEMES.find((s) => s.match.test(String(eventName || '')));
  return hit ? hit.stages : DEFAULT_STAGES;
}

/** 所有特殊赛段的固有赛制顺序（擂台赛→突围赛→淘汰赛）展开成一维表，
 *  供分析页对非默认赛段排序（同日期系列赛无法按日期分先后时以此为准） */
export const CUSTOM_STAGE_ORDER = STAGE_SCHEMES.flatMap((s) => s.stages);
