import React, { useState } from 'react';
import { DEFAULT_PLAYERS } from '../data/constants.js';

/** 系列赛配置页：BO、双方队名与 5 名选手 */
export default function SetupScreen({ state, dispatch }) {
  const [bo, setBo] = useState(state.bo);
  const [blue, setBlue] = useState({ name: state.blue.name, players: [...state.blue.players] });
  const [red, setRed] = useState({ name: state.red.name, players: [...state.red.players] });

  function setPlayer(team, i, v) {
    const setter = team === 'blue' ? setBlue : setRed;
    const cur = team === 'blue' ? blue : red;
    const players = [...cur.players];
    players[i] = v;
    setter({ ...cur, players });
  }
  function setName(team, v) {
    const setter = team === 'blue' ? setBlue : setRed;
    const cur = team === 'blue' ? blue : red;
    setter({ ...cur, name: v });
  }

  function start() {
    dispatch({ type: 'SETUP', bo, blue, red });
  }

  const teamCard = (team) => {
    const t = team === 'blue' ? blue : red;
    return (
      <div className={`panel setup-team team-${team}`}>
        <input
          className="team-name-input"
          value={t.name}
          maxLength={10}
          onChange={(e) => setName(team, e.target.value)}
          placeholder={team === 'blue' ? '蓝方队名' : '红方队名'}
        />
        {t.players.map((p, i) => (
          <div className="setup-player" key={i}>
            <span className="setup-player-no">{i + 1}</span>
            <input
              value={p}
              maxLength={10}
              placeholder={DEFAULT_PLAYERS[i]}
              onChange={(e) => setPlayer(team, i, e.target.value)}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="setup">
      <div className="panel setup-main">
        <h2 className="setup-title">系列赛设置</h2>

        <div className="setup-row">
          <span className="setup-label">赛制</span>
          {[3, 5, 7].map((b) => (
            <button key={b} className={`chip chip-lg ${bo === b ? 'on' : ''}`} onClick={() => setBo(b)}>
              BO{b}（先胜 {Math.ceil(b / 2)} 局）
            </button>
          ))}
          <span className="dim" style={{ fontSize: 12, marginLeft: 8 }}>
            BO7 第 7 局自动进入巅峰对决（无 Ban 盲选、解除锁定、双方可选相同英雄）
          </span>
        </div>

        <div className="setup-teams">
          {teamCard('blue')}
          <div className="setup-vs">VS</div>
          {teamCard('red')}
        </div>

        <div className="setup-rules-hint">
          <b>KPL 全局 BP 规则：</b>
          每局双方各 5 次 Ban、5 次 Pick（第二轮 Ban 红方先手，各 3 次）；本方任一选手在本次系列赛
          中用过的英雄，后续常规小局中<b>整队</b>不可再次使用（对手不受影响；巅峰对决解除锁定）。
        </div>

        <button className="btn btn-gold btn-lg" onClick={start}>开始系列赛</button>
      </div>
    </div>
  );
}
