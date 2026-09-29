import React from 'react';
import { getFlow } from '../bp/rules.js';
import { SIDE } from '../data/constants.js';
import HeroAvatar from './HeroAvatar.jsx';

/** 本局 BP 步骤条：展示 20 步（常规）或 10 步（巅峰对决）的 Ban/Pick 进度 */
export default function Timeline({ current, heroesById }) {
  const flow = getFlow(current.blind);
  const stepIdx = current.actions.length;

  return (
    <div className="timeline">
      {flow.map((s, i) => {
        const act = current.actions[i];
        const emptyBan = act && act.type === 'ban' && act.hero == null;
        const hero = act ? heroesById[act.hero] : null;
        const stateCls = i < stepIdx ? 'done' : i === stepIdx ? 'now' : 'todo';
        const tip = act
          ? `${SIDE[s.side].label}${s.type === 'ban' ? '禁用' : '选择'}${emptyBan ? '（空禁）' : ' ' + (hero?.name ?? '')}`
          : `${SIDE[s.side].label}${s.type === 'ban' ? '禁用' : '选择'}（待进行）`;
        return (
          <div
            key={i}
            className={`tl-node tl-${s.side} tl-${s.type} ${stateCls}`}
            title={tip}
          >
            <div className="tl-avatar">
              {emptyBan ? <span className="tl-q">空</span> : act ? <HeroAvatar hero={hero} size={36} /> : null}
              {s.type === 'ban' && act && <span className="tl-ban-mark">✕</span>}
            </div>
            <div className="tl-label">
              {s.type === 'ban' ? '禁' : '选'}{SIDE[s.side].short}
            </div>
          </div>
        );
      })}
    </div>
  );
}
