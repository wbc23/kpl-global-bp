/**
 * KPL 全局 BP 规则定义
 *
 * 常规局 BP 顺序（每方 5 次 Ban、5 次 Pick，蓝方先手）：
 *   Ban①  蓝红蓝红（各 2）
 *   Pick① 蓝1 → 红2 → 蓝2 → 红1（各 3）
 *   Ban②  红蓝红蓝红蓝（各 3，红方先手，累计每方 5）
 *   Pick② 红 → 蓝蓝 → 红（各 2，累计每方 5）
 *
 * 巅峰对决（仅 BO7 第 7 局，KPL 规则自动触发；BO5/BO3 末局为普通全局 BP 局）：
 *   无 Ban；蓝红交替盲选（蓝 1 → 红 1 → … 各 5 人）；选手可复用此前小局用过的英雄；
 *   双方可以使用相同英雄（双方选人均全程可见，不互相遮蔽）。
 *
 * 全局 BP 核心规则：本方任一选手在本次系列赛已使用过的英雄，
 * 后续常规小局中该方整队不可再次使用（对手不受影响）。
 *
 * 如赛制顺序有变，直接修改下方 STANDARD_FLOW 数组即可。
 */
export const STANDARD_FLOW = [
  { type: 'ban', side: 'blue' }, { type: 'ban', side: 'red' },
  { type: 'ban', side: 'blue' }, { type: 'ban', side: 'red' },
  { type: 'pick', side: 'blue' },
  { type: 'pick', side: 'red' }, { type: 'pick', side: 'red' },
  { type: 'pick', side: 'blue' }, { type: 'pick', side: 'blue' },
  { type: 'pick', side: 'red' },
  { type: 'ban', side: 'red' }, { type: 'ban', side: 'blue' },
  { type: 'ban', side: 'red' }, { type: 'ban', side: 'blue' },
  { type: 'ban', side: 'red' }, { type: 'ban', side: 'blue' },
  { type: 'pick', side: 'red' }, { type: 'pick', side: 'blue' },
  { type: 'pick', side: 'blue' }, { type: 'pick', side: 'red' },
];

export const BLIND_FLOW = [
  { type: 'pick', side: 'blue' }, { type: 'pick', side: 'red' },
  { type: 'pick', side: 'blue' }, { type: 'pick', side: 'red' },
  { type: 'pick', side: 'blue' }, { type: 'pick', side: 'red' },
  { type: 'pick', side: 'blue' }, { type: 'pick', side: 'red' },
  { type: 'pick', side: 'blue' }, { type: 'pick', side: 'red' },
];

export function getFlow(blind) {
  return blind ? BLIND_FLOW : STANDARD_FLOW;
}

/** BO 系列赛需要的胜场数：BO3→2 BO5→3 BO7→4 */
export function winsNeeded(bo) {
  return (bo + 1) / 2;
}

/**
 * 巅峰对决（盲选无 Ban）只在 KPL BO7 的第 7 局触发。
 * BO5 第 5 局与 BO3 第 3 局均为普通全局 BP 局（有 Ban、逐位选人）。
 */
export function isBlindDecider(bo, gameNo) {
  return bo === 7 && gameNo === 7;
}

/** 巅峰对决头像地址（腾讯官方 CDN，加载失败时前端回退为职业色块） */
export function avatarUrl(heroId) {
  return `https://game.gtimg.cn/images/yxzj/img201606/heroimg/${heroId}/${heroId}.jpg`;
}
