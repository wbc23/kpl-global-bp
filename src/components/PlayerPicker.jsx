import React, { useMemo, useState } from 'react';
import { SIDE, LANE_BADGES } from '../data/constants.js';
import { useEscape } from '../app.js';
import HeroAvatar from './HeroAvatar.jsx';

/**
 * 选人时的选手分配弹窗：
 * - 本局已选过英雄的选手不可再选
 * - 全局 BP 为整队锁定：本方任一选手用过的英雄已在英雄池层面整队禁选，此处为兜底校验（巅峰对决解除）
 * - 默认按英雄分路预选同位置选手（英雄 lanes 首位为主分路），有误点其他选手改选后确认
 */
export default function PlayerPicker({ hero, side, state, usedMap, pickedPlayers, onClose, onConfirm }) {
  const blind = state.current.blind;
  useEscape(onClose);

  const isDisabled = (i) => {
    const alreadyPicked = pickedPlayers[side].has(i);
    const lockedByPast = !blind && usedMap[side][i].has(hero.id);
    return alreadyPicked || lockedByPast;
  };

  // 推荐位：按英雄分路顺序（主分路优先）找第一个可用的同位置选手
  const recIdx = useMemo(() => {
    for (const lane of hero.lanes || []) {
      const i = LANE_BADGES.findIndex((b) => b.full === lane);
      if (i !== -1 && !isDisabled(i)) return i;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero.id, side, blind, pickedPlayers, usedMap]);

  const [selected, setSelected] = useState(recIdx);
  const noteOf = (i) => {
    if (isDisabled(i)) return { text: pickedPlayers[side].has(i) ? '本局已选英雄' : '全局BP：此前小局已用过', cls: 'bad' };
    if (selected === i && recIdx === i) return { text: '推荐 · 已选', cls: 'ok' };
    if (selected === i) return { text: '已选', cls: 'ok' };
    if (recIdx === i) return { text: '推荐', cls: 'rec' };
    return { text: '可选', cls: 'ok' };
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className={`modal-head head-${side}`}>
          <HeroAvatar hero={hero} size={56} />
          <div>
            <div className="modal-title">{hero.name}</div>
            <div className="modal-sub">
              {SIDE[side].label}选择 · {recIdx === null
                ? '请指定使用该英雄的选手'
                : `已按分路预选（${LANE_BADGES[recIdx].full}），点选手可改选`}
            </div>
          </div>
        </div>
        <div className="player-list">
          {state[side].players.map((name, i) => {
            const disabled = isDisabled(i);
            const note = noteOf(i);
            return (
              <button
                key={i}
                className={`player-option ${disabled ? 'off' : ''} ${selected === i ? 'sel' : ''}`}
                disabled={disabled}
                onClick={() => setSelected(i)}
              >
                <span className="po-name">
                  <span className={`lane-badge ${LANE_BADGES[i].cls}`} title={LANE_BADGES[i].full}>{LANE_BADGES[i].text}</span>
                  {name}
                </span>
                <span className={`po-note ${note.cls}`}>{note.text}</span>
              </button>
            );
          })}
        </div>
        <div className="overlay-actions">
          <button
            className="btn btn-gold"
            autoFocus
            disabled={selected === null || isDisabled(selected)}
            onClick={() => selected !== null && onConfirm(selected)}
          >
            确认分配{selected !== null ? `：${state[side].players[selected]}` : ''}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
