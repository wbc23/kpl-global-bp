import React from 'react';
import { getFlow } from '../bp/rules.js';
import { SIDE } from '../data/constants.js';
import ScoreBoard from './ScoreBoard.jsx';
import TeamPanel from './TeamPanel.jsx';
import Timeline from './Timeline.jsx';
import PoolPanel from './PoolPanel.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import HeroAvatar from './HeroAvatar.jsx';
import { GameEndOverlay } from './Overlays.jsx';

/**
 * BP 主操作区（模拟器与比赛录入共用）。
 * state 为“系列赛形态”的数据结构：blue/red 队伍、games（已完成局，蓝红视角）、current。
 * 录入模式下通过视角映射把真实战队换边转换成该结构。
 */
export default function DraftCenter({ state, dispatch, heroesById, toolbar, donePrompt }) {
  const cur = state.current;
  if (!cur) return null;
  const flow = getFlow(cur.blind);
  const stepIdx = cur.actions.length;
  const step = flow[stepIdx];
  const draftComplete = stepIdx === flow.length;

  return (
    <>
      <ScoreBoard state={state} />
      {toolbar}
      {cur.blind && <DeciderBanner />}
      <div className="main-grid">
        <TeamPanel side="blue" state={state} dispatch={dispatch} heroesById={heroesById} />
        <div className="center-col">
          <div className={`prompt ${step ? step.side : 'done'}${cur.blind ? ' blind' : ''}`}>
            {step ? (
              <>
                <span className="prompt-side">
                  {SIDE[step.side].label}
                  {step.type === 'pick' &&
                    ` ${cur.actions.filter((a) => a.type === 'pick' && a.side === step.side).length + 1}楼`}
                </span>
                <span className="prompt-act">{step.type === 'ban' ? '禁用英雄' : '选择英雄'}</span>
              </>
            ) : (
              <span className="prompt-act">{donePrompt || '本局 BP 已完成，请标记胜者'}</span>
            )}
          </div>
          <div className="panel timeline-wrap">
            <Timeline current={cur} heroesById={heroesById} />
          </div>
          <BanRows current={cur} heroesById={heroesById} />
          {!draftComplete && <PoolPanel state={state} dispatch={dispatch} />}
        </div>
        <TeamPanel side="red" state={state} dispatch={dispatch} heroesById={heroesById} />
      </div>

      {state.phase === 'draft' && draftComplete && (
        <GameEndOverlay state={state} dispatch={dispatch} heroesById={heroesById} />
      )}

      <HistoryPanel state={state} heroesById={heroesById} />
    </>
  );
}

/** 巅峰对决横幅：BO7 第 7 局盲选局专属的决战氛围（模拟器与录入共用） */
function DeciderBanner() {
  return (
    <div className="decider-banner">
      <span className="decider-star">★</span>
      <div className="decider-text">
        <span className="decider-title">巅峰对决</span>
        <span className="decider-sub">BO7 决胜局 · 盲选 · 无禁用 · 全局锁定解除 · 双方英雄可重复</span>
      </div>
      <span className="decider-star decider-star-r">★</span>
    </div>
  );
}

/** 本局 Ban 位展示（巅峰对决无 Ban；槽位数随规则流程自动变化） */
function BanRows({ current, heroesById }) {
  if (current.blind) return null;
  const flow = getFlow(false);
  const row = (side) => {
    const ids = current.actions.filter((a) => a.type === 'ban' && a.side === side).map((a) => a.hero);
    const slots = flow.filter((s) => s.type === 'ban' && s.side === side).length;
    return (
      <div className={`ban-row br-${side}`}>
        <span className="ban-label">{SIDE[side].label}禁用</span>
        <div className="ban-list">
          {Array.from({ length: slots }, (_, i) => {
            const id = ids[i];
            const hero = id ? heroesById[id] : null;
            return hero ? (
              <span className="ban-chip" key={id} title={hero.name}>
                <HeroAvatar hero={hero} size={32} />
                <span className="ban-chip-name">{hero.name}</span>
              </span>
            ) : (
              <div className="ban-empty-slot" key={i} />
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div className="panel ban-rows">
      {row('blue')}
      {row('red')}
    </div>
  );
}
