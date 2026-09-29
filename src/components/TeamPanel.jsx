import React, { useState } from 'react';
import { getFlow } from '../bp/rules.js';
import { picksOf, usedHeroesByPlayer } from '../bp/store.js';
import { SIDE } from '../data/constants.js';
import HeroAvatar from './HeroAvatar.jsx';

/**
 * 侧边队伍面板：5 名选手的本局英雄 + 全局 BP 已锁定（用过）的英雄。
 * 点击已选英雄可发起"互换/移动"：再点另一行选手交换两人的英雄（目标无英雄则移动过去）
 * side: 'blue' | 'red'
 */
export default function TeamPanel({ side, state, dispatch, heroesById }) {
  const cur = state.current;
  const isActing = cur && getFlow(cur.blind)[cur.actions.length]?.side === side;
  const picks = cur ? picksOf(cur, side) : [];
  const used = usedHeroesByPlayer(state.games)[side];

  // 互换模式：swapFrom 为发起行的位置下标
  const [swapFrom, setSwapFrom] = useState(null);
  const onRowClick = (i, hasPick) => {
    if (!dispatch) return;
    if (swapFrom === null) {
      if (hasPick) setSwapFrom(i);
    } else if (swapFrom === i) {
      setSwapFrom(null);
    } else {
      dispatch({ type: 'SWAP_PLAYERS', side, a: swapFrom, b: i });
      setSwapFrom(null);
    }
  };

  return (
    <div className={`panel team-panel team-${side} ${isActing ? 'acting' : ''}`}>
      <div className="team-panel-head">
        <span className="team-title">{state[side].name}</span>
        <span className={`turn-badge ${isActing ? 'on' : ''}`}>
          {isActing ? 'BP 进行中' : SIDE[side].label}
        </span>
      </div>

      {state[side].players.map((name, i) => {
        const pick = picks.find((p) => p.player === i);
        const hero = pick && heroesById[pick.hero];
        const isSource = swapFrom === i;
        const swapMode = swapFrom !== null;
        return (
          <div
            className={`player-row ${isSource ? 'swap-source' : ''} ${swapMode && !isSource ? 'swap-target' : ''}`}
            key={i}
            onClick={swapMode || pick ? () => onRowClick(i, !!pick) : undefined}
          >
            <span className="player-name">{name}</span>
            {pick ? (
              <span className="pick-shown" title="点击可互换/移动该英雄的选手">
                <HeroAvatar hero={hero} size={34} />
                <span className="pick-hero-name">{hero?.name ?? '?'}</span>
              </span>
            ) : (
              <span className="pick-empty">{swapMode && !isSource ? '↦ 移到这里' : '待定'}</span>
            )}
          </div>
        );
      })}
      {swapFrom !== null && (
        <div className="swap-hint">点另一行互换/移动 · 再点本行取消</div>
      )}

      <div className="used-section">
        <div className="used-title">已用英雄（全局锁定）</div>
        {[...used[0]].length === 0 && used.every((s) => s.size === 0) ? (
          <div className="used-empty">暂无</div>
        ) : (
          state[side].players.map((_, i) =>
            used[i].size > 0 && (
              <div className="used-row" key={i}>
                <span className="used-player">{state[side].players[i]}</span>
                <span className="used-heroes">
                  {[...used[i]].map((id) => (
                    <span className="used-chip" key={id} title={heroesById[id]?.name}>
                      <HeroAvatar hero={heroesById[id]} size={20} />
                      {heroesById[id]?.name ?? id}
                    </span>
                  ))}
                </span>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
