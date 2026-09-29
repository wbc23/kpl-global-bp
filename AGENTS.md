# KPL BP 数据平台 — 交接文档

项目在 `D:\AI\BP_GLM5.3`（React18+Vite5 前端 / Express+node:sqlite 后端，**需 Node ≥ 22.5**）。用户日常双击根目录 `启动.bat` 访问 http://localhost:9100 ；重启电脑后双击 `启动全部环境.bat`（生产 9100 + 测试 9101 一起起，两窗口独立关闭互不影响）。

- **历史沿革/决策考据**：见 CHANGELOG.md（按日期，只记录变更过程）
- **数据/服务现状**（战队数、已录场次、9100/9101 是否在跑）：跑 `npm run status`，不要在文档里维护快照
- 功能与使用说明：见 README.md；涉及本项目任务时先读 README

## 文档维护纪律（每次改动落地时必须执行）

- **CHANGELOG.md 顶部加一条**：日期 + 改了什么 + 为什么（用户的取舍决策要记进去）
- **AGENTS.md 对应小节原地重写**成现状描述——禁止追加带日期的叙述段落；已修复/用户决定不再处理的问题及时从文档清理
- **动态状态不进文档**：数据量、服务是否在跑等一律用 `npm run status` 查，不在任何文档里维护快照

## 运行与工作流

- 本地是 git 仓库（main，**无远程、从未推送**，用户 2026-09-29 决定暂不开源）；data/、dist*、node_modules、.zcode 已在 .gitignore，*.bat 经 .gitattributes 锁 CRLF。改动无需提交仪式，文档纪律照旧以 CHANGELOG/AGENTS 为准

- `npm run dev` = 数据服务(9100) + Vite(5173)；`npm run build` 后 `npm start` 单进程直出 dist
- **改前端必须 `npm run build`**（服务托管 dist 产物）；改 server/ 需重启服务
- 端口固定 9100/9101：本机 5173/5174 被 Hyper-V 保留段拦截（EACCES）
- **测试环境**：9101 / `data/kpl-test.db` / dist-test，与生产完全隔离，页面红「测试环境」徽标。`npm run build:test` + `npm run start:test`（`--reset` 清空测试库）或 `启动测试环境.bat`；server 支持 PORT/DB_PATH/DIST_DIR 环境变量，快照按库名前缀隔离（kpl-test-*）。**工作流：改动 → build:test → 9101 验证 → 用户确认 → 同步生产（前端 `npm run build`；改 server 需重启生产服务）**
- 生产→测试数据复制：`npm run copy:test`（sqlite 在线备份；需先关测试服务，生产可运行中）
- 数据库 `data/kpl.db`；服务启动自动快照到 `data/backups/`（保留 14 份）
- `npm test`：纯函数回归测试（BP 校验/轮次/大场胜负/组合统计/阵容 null 语义，覆盖历次修复的回归场景）；改 BP 规则、录入校验或分析口径后必跑，新增修复请补用例
- **Git Bash 里 curl 发中文会 GBK 乱码**：中文数据操作一律用页面 fetch 或 node 脚本
- 后台 Bash 起的服务用 TaskStop 停不干净（npm 的 node 子进程残留占端口）：先 `netstat -ano | grep :9101` 找 PID `taskkill //F //PID <pid>`
- **bat 文件必须 GBK(ANSI) 编码 + CRLF**：Write 工具默认 UTF-8+LF 会被中文 Windows 的 cmd 按 GBK 解析、行尾吞换行导致相邻行粘连执行；转换用 PowerShell ReadAllText(UTF8)→WriteAllText(GetEncoding(936))。三个启动 bat 均已是该编码

## 页面（src/pages/）

模拟推演 / 比赛录入 / 大名单 / 数据分析 / 基础数据。赛程页已移除（schedule 表仍在，录入自动维护镜像行）。**JSON 同步导入链路**（scripts/sync.mjs、server/adapters.mjs、/api/sync 端点、pending_imports 表）：用户不需要，**未使用、不维护、文档不展开**——勿再报告/修复其缺陷（fetchText 未导入、拒空禁、ensureBase 唯一约束等），代码保留在原处勿动。

## 关键设计决策（现状，勿回退）

**BP 引擎**（src/bp/，模拟器与录入共用）：rules.js 的 STANDARD_FLOW 定义 5Ban5Pick 顺序（首轮 Ban 蓝红各 2、二轮 Ban 红先手各 3）；validate.js 是唯一校验入口；store.js 模拟器状态机；录入状态机 src/record/recording.js（蓝红逐局轮换、视角映射 toViewState、草稿 localStorage 多槽位自动保存/续录）；src/record/checks.js 为纯函数整体校验（见下）。

- **全局 BP 锁定 = 整队口径**：该方任一选手用过的英雄，本方后续常规局任何选手都不可再选；对手不受影响（sideLocks/usedHeroesBySide 按蓝红视角、名字无关，兼容逐局换人）
- **巅峰对决 = 仅 BO7 第 7 局自动盲选**（无手动开关）：解除锁定、蓝红各 1 交替选人、双方可同英雄、不遮对方阵容；DeciderBanner 鎏金氛围（.decider-* 样式）
- 空禁记 `hero: null`（validate/分析/回放均兼容）；BP 提示条"x方x楼 选择/禁用英雄"，Ban 手无楼层
- **补录保存 = 尾部追加**：继续录入会话建立时记录 `meta.baseGames`（当时库内局数），保存只传新录的局 + `fromGameNo`，服务端（PUT /api/series/:id/games）只替换该局号之后的对局——期间经回放修正的旧局不被草稿旧副本覆盖；库内局数与基准不符 → 409 冲突提示。不带 fromGameNo = 整体替换（旧客户端兼容）
- **编辑 BP 保存 = 全系列赛重放校验**（src/record/checks.js）：`editSaveConflicts` 把被编辑局放整场系列赛（含本局之后的局）语境下用 validateAct 逐步重放，锁定冲突/流程非法/重复英雄拦截；**锁定语境只计常规局——盲选局的 pick 不产生锁定**（否则编辑打满 BO7 的前几局会被盲选复用的招牌英雄误拦）；`SET_BLUE` 换向前 `blueFlipConflicts` 按新蓝红映射重校验整队锁定（reducer 兜底拒绝 + 页面 alert 列冲突英雄）。checks.js 不依赖 heroes.json，node 可直接导入做回归测试
- 逐局换人：games.roster1/2 存本局阵容，**null = 与系列赛阵容一致**（写入与全部读取统一：回放换人条/回放展示/分析 flattenGames/锁定换算 perspectiveGames 一律回退系列赛阵容，不得回退"上一局"或"当前局"，见 checks.js 的 effRoster）；换人走 SET_GAME_ROSTER（与锁定冲突则拒绝）；补录/连续录入的下一局默认沿用**末局实际阵容**（与 FINISH_GAME 的换人延续一致）
- 已录数据修正入口：回放「编辑BP」（单局，PUT /api/games/:id/draft，可带改判）、「改判」、列表「继续录入」（该系列已有草稿则恢复草稿）、done 阶段 UNDO_LAST_GAME 退回重标胜者
- 赛程联动：保存系列赛自动同步 schedule（带入 scheduleId 优先；否则匹配同赛事+同日+同对阵 planned 行；均无补 auto=1 镜像行）；series PUT/DELETE 联动同步/清理 auto 行，手动排期不受影响
- 元流之子拆 5 个独立英雄（id 581-585）；赛段只保留 常规赛/季后赛；录入表单不放"新建战队"（战队管理在基础数据页）；录入表单与大名单页都有「＋新建赛事」快捷入口（赛事完整管理在基础数据页）
- 出场阵容按位置 1-5（对抗/打野/中/发育/游走），分路徽章 LANE_BADGES（彩色文字）；**阵容 5 人互不重复是前后端共同约束**（同队重名会让选手归属/整队锁定全部错位：新建表单、validateSeriesPayload、PUT series、换人弹窗、SET_GAME_ROSTER、单局修正 okRoster 全链路拦截）；team_rosters 按（赛事,战队）唯一；大名单页不显示战队简称列
- **赛事参赛战队**（event_teams 表，无外键）：大名单页「参赛战队」弹窗整体替换（数量→逐槽选队→可当场新建战队）；**无记录=未设置，前端回退显示全部战队**；战队/赛事删除时接口顺手清 event_teams 行；录入选队暂不按参赛队过滤
- **当前赛事**：= 最近有系列赛录入的赛事（按系列赛日期，同日取后录入的；全部无录入时取最新创建），由 /api/meta 的 currentEventId 返回。各页默认以它为准：录入列表的赛事筛选（可选全部，选项带场次计数）、新建录入表单默认赛事（优先于上次偏好）、大名单页默认赛事、分析页打开时的默认筛选（用户手选后不再干预）
- **录入前置条件**：新建录入表单要求本赛事**全部参赛战队（未设置时=全部战队）都登记了大名单**才可开始录入（RecordForm 实时校验，缺登时禁用按钮+横幅列缺登战队；继续录入/已录系列赛不受影响）
- 战队/赛事删除受引用约束：有关联系列赛 → 409；尚有赛程（schedule）或大名单（team_rosters）引用也 → 409 提示先清理（两表对 teams/events 有外键无 ON DELETE，不预检会裸 500）
- 英雄数据 src/data/heroes.json（132 名，官方 API 生成，**勿手改**，会被 refresh 覆盖）：`curl herolist.json -o scripts/herolist.raw.json && npm run refresh-heroes && npm run build`。头像 gtimg CDN 失败回退职业色块；主分路人工修正表在 scripts/refresh-heroes.mjs 的 **LANE_PRIMARY**（当前：哪吒/夏侯惇/杨戬/元流之子·坦克/梦奇/猪八戒→打野，蚩奼/卢雅那→发育路，张良/赵怀真/墨子→游走），排到 lanes 最前作选人默认推荐位
- **英雄搜索 heroMatch**（src/data/heroSearch.js，英雄池与分析页共用）：**只按英雄名**（称号不参与，py 仅名称拼音），子串匹配英雄名与 py 各词（全拼+首字母+别名，如 guanyu/gy/lvbu/lubu）；曾评估"≥3 字符子序列匹配"方案，用户决定**不做**——勿自行加回
- 选人交互：点英雄按分路自动预填同位置选手（无可用推荐才弹手动窗）；点已选英雄 SWAP_PLAYERS 互换/移动；英雄池对系列赛已用英雄**仅在轮到用过的一方选择时**灰显+禁选（tooltip 标使用者与局数；对手回合不灰显）
- 「快速完成本局」QUICK_COMPLETE：随机补全剩余 Ban/Pick，校验与 ACT 完全一致（流程/本局唯一/整队锁定/选手位不重复；测试辅助，胜者仍手动标记）
- 录入表单记忆上次配置（localStorage `kpl-bp-record-prefs`：赛事/赛段/日期/赛制）；「上一场首发」取该队最近一场已录系列的末局阵容；录入可直接填备注（meta.note，编辑弹窗可改、续录不改）；PoolPanel 搜索方向键首尾环绕；HistoryPanel 按当局真实蓝红方展示（红方 row-reverse）
- 录入草稿多槽位（localStorage `kpl-bp-record-drafts`，key=meta.sessionId，旧单键自动迁移）：支持同时进行多场录入；「暂存并返回」留草稿退出；「保存已录 X 局」部分保存（仅已完成局入库，SAVED 结束会话，列表「继续录入」补录）；gamesPayload/saveSeriesToDb 是模块级函数（勿移回组件内）

**分析口径**（聚合全在 src/analysis/compute.js，页面 AnalysisPage.jsx，细节以代码注释为准）：

- 五个 tab：总览（Pick/Ban-Pick/Ban 三榜 TOP10）/ 英雄 / 战队 / 选手 / 赛事分析；战队页锚点 4 区块：战队总览/总览/英雄偏好/组合胜率；单队「总览」统计卡一行 6 张：系列赛场次/对局数（小局）/蓝方胜/红方胜/落败后下一局执蓝/执红（afterLossSideStats 口径，无样本显示 —）
- Pick/Ban 率分母 = 2×局数；Ban-Pick 率 =(Pick+Ban)÷(2×局数)；组合榜三档门槛：两位置 ≥5（COMBO_MIN）、三英雄 ≥3（TRIO_MIN）、五英雄 ≥2 且 TOP10（搜索均不限门槛）；全 KPL 组合榜的 Ban 覆盖局 = 任一成员被任一方 ban 的局
- counter 场景按 BP 手序判断"对方已亮"；HAND_OF=[blue:1,4,5,8,9 / red:2,3,6,7,10] 是全场手序表（勿改）
- 轮次为**区间语义**（ROUND_DEFS/seriesRoundKeys/groupByRound）：从备注「第x轮」的首场系列赛起、到下一轮标记场之前的全部归该轮（**中文数字与阿拉伯数字均可**：第一轮/第1轮）；只需给每轮首场标注备注；季后赛边界=首场季后赛系列赛；首边界之前归"未标注"不计入常规赛合计（regular=r1+r2+r3）。**归属在完整未筛选数据上计算（seriesRoundKeys(allGames)，页面筛选掉标记场不影响归属），且按赛事隔离找边界，不跨赛事继承**
- 大场胜负 = **任一方小局先胜 (BO+1)/2 局才计胜负**，未达门槛的未录完系列赛记"未分"（只入胜率分母；allTeamStats 的 seriesMap 带 bo）
- 英雄页：主分路筛选（口径 lanes[0]）、英雄表/组合榜默认 20 行增量展开+搜索；Counter 关系有"它 counter 谁/谁 counter 它"两视角

## 历史教训（红线）

1. 2026-09-11 清理"测试数据"时未先检查内容，误删用户 18 份大名单（恢复 17/18）。
2. 2026-09-12 API 测试造的假阵容选手（a–j）被自动吸进选手库，删系列赛时未清理选手。
**任何批量删除/覆盖前：先列出目标内容并确认归属，只删自己创建的东西；测试数据用完必须连带检查选手库等衍生数据。**
