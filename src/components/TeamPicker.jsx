import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * 预置战队的拼音检索词（新名单外的自定义战队自动按名称/简称匹配）。
 * 想补充新战队拼音时，在这里加一行即可。
 */
const PINYIN = {
  '北京JDG': 'bj jdg', '广州TTG': 'gz ttg', '长沙TES.A': 'cs tesa tes',
  'SYG': 'syg', '西安WE': 'xa we', '佛山DRG': 'fs drg', '北京WB': 'bj wb',
  '杭州LGD.NBW': 'hz lgd nbw', '上海EDG.M': 'sh edgm edg',
  '南通Hero久竞': 'nt hero jj', '武汉eStarPro': 'wh estar es star pro',
  '上海RNG.M': 'sh rngm rng', 'KSG': 'ksg', '成都AG超玩会': 'cd ag cwh chaowan',
  '重庆狼队': 'cq ld langdui', '济南RW侠': 'jn rw xia', '深圳DYG': 'sz dyg',
  'WST': 'wst',
};

/**
 * 战队搜索选择器：输入名称/简称/拼音过滤，点击或回车选中，✕ 清除重选。
 * value 为战队 id（空串表示未选择），用法与 select 基本一致。
 */
export default function TeamPicker({ teams, value, onChange, placeholder = '搜索战队…' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = teams.find((t) => t.id === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return teams;
    return teams.filter((t) =>
      `${t.name} ${t.short || ''} ${PINYIN[t.name] || ''}`.toLowerCase().includes(query));
  }, [q, teams]);

  if (selected) {
    return (
      <span className="tp-chip">
        {selected.name}
        <button type="button" className="chip-del" title="清除重选" onClick={() => onChange('')}>✕</button>
      </span>
    );
  }

  return (
    <div className="team-picker" ref={ref}>
      <input
        className="tp-input"
        value={q}
        placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) { onChange(list[0].id); setQ(''); setOpen(false); }
        }}
      />
      {open && (
        <div className="tp-list">
          {list.map((t) => (
            <div
              key={t.id}
              className="tp-option"
              onMouseDown={(e) => { e.preventDefault(); onChange(t.id); setQ(''); setOpen(false); }}
            >
              <span>{t.name}</span>
              {t.short && <span className="dim">{t.short}</span>}
            </div>
          ))}
          {list.length === 0 && <div className="tp-empty">无匹配战队</div>}
        </div>
      )}
    </div>
  );
}
