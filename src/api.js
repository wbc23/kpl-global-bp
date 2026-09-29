/** 后端 API 客户端（开发模式经 Vite 代理，生产同源直连） */

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (!res.ok) throw new Error(data?.error || `请求失败(${res.status})`);
  return data;
}

export const api = {
  meta: () => request('/api/meta'),
  series: () => request('/api/series').then((d) => d.series),
  saveSeries: (payload) => request('/api/series', { method: 'POST', body: payload }),
  deleteSeries: (id) => request(`/api/series/${id}`, { method: 'DELETE' }),
  addTeam: (name, short) => request('/api/teams', { method: 'POST', body: { name, short } }),
  updateTeam: (id, name, short) => request(`/api/teams/${id}`, { method: 'PUT', body: { name, short } }),
  deleteTeam: (id) => request(`/api/teams/${id}`, { method: 'DELETE' }),
  addPlayer: (name) => request('/api/players', { method: 'POST', body: { name } }),
  deletePlayer: (id) => request(`/api/players/${id}`, { method: 'DELETE' }),
  addEvent: (name) => request('/api/events', { method: 'POST', body: { name } }),
  deleteEvent: (id) => request(`/api/events/${id}`, { method: 'DELETE' }),

  // 系列赛/对局修正
  updateSeries: (id, p) => request(`/api/series/${id}`, { method: 'PUT', body: p }),
  updateGameWinner: (id, winner) => request(`/api/games/${id}`, { method: 'PUT', body: { winner } }),
  updateGameDraft: (id, p) => request(`/api/games/${id}/draft`, { method: 'PUT', body: p }),
  // 在原系列赛上写入补录对局（「继续录入」）。payload: { games, fromGameNo? }；
  // fromGameNo 给出时服务端只替换该局号之后的对局（尾部追加，保护库内已修正的旧局）
  updateSeriesGames: (id, payload) => request(`/api/series/${id}/games`, { method: 'PUT', body: payload }),

  // 战队大名单（每赛事每队一份）
  rosters: (eventId) => request(`/api/rosters${eventId ? `?eventId=${eventId}` : ''}`).then((d) => d.rosters),
  saveRoster: (p) => request('/api/rosters', { method: 'PUT', body: p }),
  deleteRoster: (id) => request(`/api/rosters/${id}`, { method: 'DELETE' }),

  // 赛事参赛战队（整体替换语义；空数组=未设置，前端回退全部战队）
  eventTeams: (eventId) => request(`/api/events/${eventId}/teams`).then((d) => d.teamIds),
  saveEventTeams: (eventId, teamIds) => request(`/api/events/${eventId}/teams`, { method: 'PUT', body: { teamIds } }),
};
