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
