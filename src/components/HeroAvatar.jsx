import React, { useEffect, useState } from 'react';
import { avatarUrl } from '../bp/rules.js';

/** 英雄头像：优先官方 CDN 图片，加载失败回退为职业色块 */
export default function HeroAvatar({ hero, size = 48, className = '' }) {
  const [err, setErr] = useState(false);
  // 切换英雄时复位错误态：同一组件实例（列表复用）从失败英雄换到正常英雄不再残留色块（外B5）
  useEffect(() => { setErr(false); }, [hero?.id]);

  if (!hero) {
    return <div className={`avatar avatar-empty ${className}`} style={{ width: size, height: size }}>?</div>;
  }
  if (err) {
    return (
      <div
        className={`avatar avatar-fallback ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        data-role={hero.roles[0] || ''}
        title={hero.name}
      >
        {hero.name.slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      className={`avatar ${className}`}
      style={{ width: size, height: size }}
      src={avatarUrl(hero.id)}
      alt={hero.name}
      title={`${hero.name}${hero.title ? ' · ' + hero.title : ''}`}
      loading="lazy"
      onError={() => setErr(true)}
    />
  );
}
