import { getFlow } from './rules.js';

/**
 * Ban/Pick 操作合法性校验（模拟器与比赛录入共用）。
 * ctx: { actions: 当前局已进行的操作, blind, sideLocks(side) → 该阵营在历史局已用英雄的 Set }
 * act: { kind: 'ban'|'pick', side, hero, player? }
 *
 * 全局 BP 锁定为整队口径：该方任一选手在历史局用过的英雄，
 * 后续常规局中该方不可再选（对手不受影响；巅峰对决解除）。
 */
export function validateAct(ctx, act) {
  const { actions, blind, sideLocks } = ctx;
  const { kind, side, hero, player } = act;
  const flow = getFlow(blind);
  const expected = flow[actions.length];
  if (!expected || expected.side !== side || expected.type !== kind) return false;

  const takenAnywhere = actions.some((a) => a.hero === hero);
  const takenBySide = actions.some((a) => a.side === side && a.hero === hero);

  if (kind === 'ban') {
    if (hero == null) return !blind; // 空禁：占位但不禁用任何英雄
    return !blind && !takenAnywhere;
  }

  // 巅峰对决仅限制己方阵容内不重复，对手选过的英雄仍可选
  if (blind ? takenBySide : takenAnywhere) return false;
  // 该选手本局已选过英雄
  if (actions.some((a) => a.type === 'pick' && a.side === side && a.player === player)) return false;
  // 全局 BP：本方任一选手此前小局用过的英雄，整队不可再选
  if (!blind && sideLocks(side).has(hero)) return false;
  return true;
}
