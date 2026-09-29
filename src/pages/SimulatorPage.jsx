import React, { useEffect, useMemo, useReducer } from 'react';
import { reducer, loadState, STORAGE_KEY } from '../bp/store.js';
import DraftCenter from '../components/DraftCenter.jsx';
import SetupScreen from '../components/SetupScreen.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import { FinishedOverlay } from '../components/Overlays.jsx';

/** 纯模拟推演（不入库）：与 v1 行为一致，进度存 localStorage */
export default function SimulatorPage({ heroesById }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  // 刷新不丢进度
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  const inDraft = state.phase === 'draft' && state.current;

  const toolbar = inDraft ? (
    <div className="panel rec-toolbar">
      <span className="rec-hint">自由推演模式（不保存到数据库）</span>
      <button className="btn btn-ghost" disabled={state.current.actions.length === 0} onClick={() => dispatch({ type: 'UNDO' })}>
        撤销上一步
      </button>
      <button
        className="btn btn-ghost"
        onClick={() => { if (window.confirm('确定清空本局 BP 重新开始？')) dispatch({ type: 'RESTART_GAME' }); }}
      >
        重做本局
      </button>
      <button
        className="btn btn-ghost"
        onClick={() => { if (window.confirm('确定结束当前系列赛并返回设置页？')) dispatch({ type: 'NEW_SERIES' }); }}
      >
        新系列赛
      </button>
    </div>
  ) : null;

  return (
    <>
      {state.phase === 'setup' && <SetupScreen state={state} dispatch={dispatch} />}
      {inDraft && <DraftCenter state={state} dispatch={dispatch} heroesById={heroesById} toolbar={toolbar} />}
      {state.phase === 'finished' && (
        <>
          <FinishedOverlay state={state} dispatch={dispatch} />
          <HistoryPanel state={state} heroesById={heroesById} />
        </>
      )}
    </>
  );
}
