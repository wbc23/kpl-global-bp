import React from 'react';
import { SIDE } from '../data/constants.js';
import HeroAvatar from './HeroAvatar.jsx';

/** 已完成小局的历史记录：比分、胜负、Ban 位与双方阵容。
 *  录入模式传 state.history（当局真实蓝红方 + 队名 + 累计比分）；
 *  模拟器无该字段，回退到 state.games（蓝红固定，state.blue/red 即当局真实队名）。 */
export default function HistoryPanel({ state, heroesById }) {
  const games = state.history || state.games;
  if (games.length === 0) return null;
  const blueNameOf = (g) => g.blueName ?? state.blue.name;
  const redNameOf = (g) => g.redName ?? state.red.name;

  return (
    <div className="panel history-panel">
      <div className="panel-title">历史对局（{games.length} 局）</div>
      <div className="history-list">
        {[...games].reverse().map((g) => {
          const no = games.indexOf(g) + 1;
          const blueName = blueNameOf(g);
          const redName = redNameOf(g);
          // 录入模式比分按队伍1:队伍2 随 g.score 提供；模拟器按固定蓝红累计
          const [b, r] = g.score ?? [
            games.slice(0, no).filter((x) => x.winner === 'blue').length,
            games.slice(0, no).filter((x) => x.winner === 'red').length,
          ];
          const winnerName = g.winner === 'blue' ? blueName : redName;
          return (
            <div className="history-card" key={no}>
              <div className="history-head">
                <span className={`winner-tag tag-${g.winner}`}>
                  第 {no} 局 · {winnerName} 获胜
                </span>
                {g.blind && <span className="tag-blind">巅峰对决</span>}
                <span className="history-score">{b} : {r}</span>
              </div>
              <div className="history-body">
                {['blue', 'red'].map((side) => {
                  const teamName = side === 'blue' ? blueName : redName;
                  return (
                    <div className={`history-team ht-${side}`} key={side}>
                      <div className="history-team-name">{teamName}</div>
                      {g[`${side}Bans`].length > 0 && (
                        <div className="history-bans">
                          <span className="hb-label">Ban</span>
                          {g[`${side}Bans`].map((id) => (
                            <span className="history-hero-chip ban" key={id} title={heroesById[id]?.name}>
                              <HeroAvatar hero={heroesById[id]} size={24} />
                              {heroesById[id]?.name ?? id}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="history-picks">
                        {g[`${side}Picks`].map((p, i) => (
                          <span className="history-hero-chip" key={i}>
                            <HeroAvatar hero={heroesById[p.hero]} size={24} />
                            <span className="hhc-player">{p.name ?? state[side].players[p.player] ?? '?'}</span>
                            {heroesById[p.hero]?.name ?? p.hero}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
