import React from 'react';
import HeroAvatar from './HeroAvatar.jsx';

/** 本局 BP 完成后的结算浮层：展示双方阵容并选择胜者 */
export function GameEndOverlay({ state, dispatch, heroesById }) {
  const cur = state.current;
  const no = state.games.length + 1;

  const sideBlock = (side) => (
    <div className={`lineup lu-${side}`}>
      <div className="lineup-name">{state[side].name}</div>
      <div className="lineup-list">
        {state[side].players.map((name, i) => {
          const pick = cur.actions
            .filter((a) => a.type === 'pick' && a.side === side)
            .find((p) => p.player === i);
          const hero = pick ? heroesById[pick.hero] : null;
          return (
            <div className="lineup-row" key={i}>
              <span className="lineup-player">{name}</span>
              {hero ? (
                <span className="lineup-hero">
                  <HeroAvatar hero={hero} size={44} />
                  {hero.name}
                </span>
              ) : (
                <span className="pick-empty">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="overlay">
      <div className={`overlay-card${cur.blind ? ' decider' : ''}`}>
        <h3>
          第 {no} 局 BP 完成{cur.blind ? ' · 巅峰对决' : ''}
        </h3>
        <div className="overlay-lineups">
          {sideBlock('blue')}
          <div className="overlay-vs">VS</div>
          {sideBlock('red')}
        </div>
        <p className="overlay-tip">请标记本局胜者（用于系列赛比分与历史记录）</p>
        <div className="overlay-actions">
          <button className="btn btn-blue btn-lg" onClick={() => dispatch({ type: 'FINISH_GAME', winner: 'blue' })}>
            {state.blue.name} 获胜
          </button>
          <button className="btn btn-ghost" onClick={() => dispatch({ type: 'UNDO' })}>撤销上一步</button>
          <button className="btn btn-red btn-lg" onClick={() => dispatch({ type: 'FINISH_GAME', winner: 'red' })}>
            {state.red.name} 获胜
          </button>
        </div>
      </div>
    </div>
  );
}

/** 系列赛结束浮层 */
export function FinishedOverlay({ state, dispatch }) {
  const winner = state.blueScore > state.redScore ? 'blue' : 'red';
  return (
    <div className="overlay">
      <div className="overlay-card finished">
        <div className="champion-star">★</div>
        <h3 className="champion-name">{state[winner].name} 夺冠</h3>
        <div className="final-score">
          {state.blueScore} : {state.redScore}
          <span className="final-bo">（BO{state.bo}）</span>
        </div>
        <p className="overlay-tip">恭喜！可在下方查看每局 BP 复盘</p>
        <div className="overlay-actions">
          <button className="btn btn-gold btn-lg" onClick={() => dispatch({ type: 'NEW_SERIES' })}>
            开启新系列赛
          </button>
          <button
            className="btn btn-ghost"
            title="退回上一局，重新标记胜者"
            onClick={() => dispatch({ type: 'UNDO_LAST_GAME' })}
          >
            撤销上一局（改判胜者）
          </button>
        </div>
      </div>
    </div>
  );
}
