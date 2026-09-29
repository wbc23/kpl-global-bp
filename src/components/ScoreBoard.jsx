import React from 'react';
import { SIDE } from '../data/constants.js';

export default function ScoreBoard({ state }) {
  const gameNo = state.games.length + 1;
  const finished = state.phase === 'finished';
  return (
    <div className={`scoreboard panel${state.current?.blind && !finished ? ' blind' : ''}`}>
      <div className="score-side score-blue">
        <span className="team-name">{state.blue.name}</span>
        <span className="score-num">{state.blueScore}</span>
      </div>
      <div className="score-mid">
        <div className="bo-label">BO{state.bo}{finished ? ' · 系列赛结束' : ` · 第 ${gameNo} 局`}</div>
        {state.current?.blind && !finished && <div className="tag-blind">巅峰对决</div>}
      </div>
      <div className="score-side score-red">
        <span className="score-num">{state.redScore}</span>
        <span className="team-name">{state.red.name}</span>
      </div>
    </div>
  );
}
