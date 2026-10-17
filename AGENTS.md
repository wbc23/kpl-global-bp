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

- 项目已开源：https://github.com/wbc23/kpl-global-bp （公开仓库，gh CLI + 设备码登录 wbc23 账号推送）。**生产库 data/kpl.db 随仓库公开**（2026-10-12 用户决定公开比赛数据：clone 即得全部对局、随推送自动更新）；data/ 其余内容（backups/、kpl-test.db*、SQLite 临时文件）、构建产物 dist*、node_modules、.zcode 不入库（.gitignore），*.bat 经 .gitattributes 锁 CRLF。**提交 kpl.db 前确认 data/ 下无 kpl.db-journal/-wal 临时文件**（有 = 服务正在写，稍后再提交）。日常改动仍以测试环境验收 → 用户确认 → 同步生产为准；**推送到 GitHub 不在例行流程内**，用户提出时再 commit+push。gh 在 `/c/Program Files/GitHub CLI/gh.exe`

- `npm run dev` = 数据服务(9100) + Vite(5173)；`npm run build` 后 `npm start` 单进程直出 dist
- **改前端必须 `npm run build`**（服务托管 dist 产物）；改 server/ 需重启服务
- 端口固定 9100/9101：本机 5173/5174 被 Hyper-V 保留段拦截（EACCES）
- **测试环境**：9101 / `data/kpl-test.db` / dist-test，与生产完全隔离，页面红「测试环境」徽标。`npm run build:test` + `npm run start:test`（`--reset` 清空测试库）或 `启动测试环境.bat`；server 支持 PORT/DB_PATH/DIST_DIR 环境变量，快照按库名前缀隔离（kpl-test-*）。**工作流：改动 → build:test → 9101 验证 → 用户确认 → 同步生产（前端 `npm run build`；改 server 需重启生产服务）**
- 生产→测试数据复制：`npm run copy:test`（sqlite 在线备份；需先关测试服务，生产可运行中）
- 数据库 `data/kpl.db`；服务启动自动快照到 `data/backups/`（保留 14 份）
- `npm test`：纯函数回归测试（BP 校验/轮次与赛段分组/大场胜负/组合统计与出现率变化/楼层变化/对位克制/英雄月度趋势/阵容 null 语义/英雄搜索，覆盖历次修复的回归场景）；改 BP 规则、录入校验或分析口径后必跑，新增修复请补用例
- **Git Bash 里 curl 发中文会 GBK 乱码**：中文数据操作一律用页面 fetch 或 node 脚本
- 后台 Bash 起的服务用 TaskStop 停不干净（npm 的 node 子进程残留占端口）：先 `netstat -ano | grep :9101` 找 PID `taskkill //F //PID <pid>`
- **bat 文件必须 GBK(ANSI) 编码 + CRLF**：Write 工具默认 UTF-8+LF 会被中文 Windows 的 cmd 按 GBK 解析、行尾吞换行导致相邻行粘连执行；转换用 PowerShell ReadAllText(UTF8)→WriteAllText(GetEncoding(936))。三个启动 bat 均已是该编码

## 页面（src/pages/）

模拟推演 / 比赛录入 / 大名单 / 数据分析 / 基础数据。赛程页已移除（schedule 表仍在，录入自动维护镜像行）。**JSON 同步导入链路**（scripts/sync.mjs、server/adapters.mjs、/api/sync 端点、pending_imports 表）：用户不需要，**未使用、不维护、文档不展开**——勿再报告/修复其缺陷（fetchText 未导入、拒空禁、ensureBase 唯一约束等），代码保留在原处勿动。

## 关键设计决策（现状，勿回退）

**BP 引擎**（src/bp/，模拟器与录入共用）：rules.js 的 STANDARD_FLOW 定义 5Ban5Pick 顺序（首轮 Ban 蓝红各 2、二轮 Ban 红先手各 3）；validate.js 是唯一校验入口；store.js 模拟器状态机；录入状态机 src/record/recording.js（蓝红逐局轮换、视角映射 toViewState、草稿 localStorage 多槽位自动保存/续录）；src/record/checks.js 为纯函数整体校验（见下）。

- **全局 BP 锁定 = 整队口径**：该方任一选手用过的英雄，本方后续常规局任何选手都不可再选；对手不受影响（sideLocks/usedHeroesBySide 按蓝红视角、名字无关，兼容逐局换人）。BP 面板「已用英雄」按位置分组展示且**含被换下的选手**（usedHeroGroups：按选手名聚合、换下选手（player=-1）按出场次数最多的位置归组、组内当前选手在前；perspectiveGames 的 pick 带 slot=该局原位置与 name），同位置多人时组内紧凑+左侧虚线；锁定校验仍用 usedHeroesByPlayer（只按当前阵容下标，-1 跳过），两条链路勿混用
- **巅峰对决 = 仅 BO7 第 7 局自动盲选**（无手动开关）：解除锁定、蓝红各 1 交替选人、双方可同英雄、不遮对方阵容；DeciderBanner 鎏金氛围（.decider-* 样式）
- 空禁记 `hero: null`（validate/分析/回放均兼容）；BP 提示条"x方x楼 选择/禁用英雄"，Ban 手无楼层
- **补录保存 = 尾部追加**：继续录入会话建立时记录 `meta.baseGames`（当时库内局数），保存只传新录的局 + `fromGameNo`，服务端（PUT /api/series/:id/games）只替换该局号之后的对局——期间经回放修正的旧局不被草稿旧副本覆盖；库内局数与基准不符 → 409 冲突提示。不带 fromGameNo = 整体替换（旧客户端兼容）
- **编辑 BP 保存 = 全系列赛重放校验**（src/record/checks.js）：`editSaveConflicts` 把被编辑局放整场系列赛（含本局之后的局）语境下用 validateAct 逐步重放，锁定冲突/流程非法/重复英雄拦截；**锁定语境只计常规局——盲选局的 pick 不产生锁定**（否则编辑打满 BO7 的前几局会被盲选复用的招牌英雄误拦）；`SET_BLUE` 换向前 `blueFlipConflicts` 按新蓝红映射重校验整队锁定（reducer 兜底拒绝 + 页面 alert 列冲突英雄）。checks.js 不依赖 heroes.json，node 可直接导入做回归测试
- 逐局换人：games.roster1/2 存本局阵容，**null = 与系列赛阵容一致**（写入与全部读取统一：回放换人条/回放展示/分析 flattenGames/锁定换算 perspectiveGames 一律回退系列赛阵容，不得回退"上一局"或"当前局"，见 checks.js 的 effRoster）；换人走 SET_GAME_ROSTER（与锁定冲突则拒绝）；补录/连续录入的下一局默认沿用**末局实际阵容**（与 FINISH_GAME 的换人延续一致）
- 已录数据修正入口：回放「编辑BP」（单局，PUT /api/games/:id/draft，可带改判）、「改判」、列表「继续录入」（该系列已有草稿则恢复草稿）、done 阶段 UNDO_LAST_GAME 退回重标胜者
- 赛程联动：保存系列赛自动同步 schedule（带入 scheduleId 优先；否则匹配同赛事+同日+同对阵 planned 行；均无补 auto=1 镜像行）；series PUT/DELETE 联动同步/清理 auto 行，手动排期不受影响
- 元流之子拆 5 个独立英雄（id 581-585）；**赛段体系按赛事区分**（constants.js 的 stagesForEvent：默认=常规赛/季后赛，赛事名含"总决赛"=擂台赛/突围赛/淘汰赛——年度总决赛赛制；新赛制在 STAGE_SCHEMES 加行）；录入表单与编辑弹窗的赛段选项随所选赛事切换，当前值非法时自动回退首项（effStage）；录入表单不放"新建战队"（战队管理在基础数据页）；录入表单与大名单页都有「＋新建赛事」快捷入口（赛事完整管理在基础数据页）
- 出场阵容按位置 1-5（对抗/打野/中/发育/游走），分路徽章 LANE_BADGES（彩色文字）；**阵容 5 人互不重复是前后端共同约束**（同队重名会让选手归属/整队锁定全部错位：新建表单、validateSeriesPayload、PUT series、换人弹窗、SET_GAME_ROSTER、单局修正 okRoster 全链路拦截）；team_rosters 按（赛事,战队）唯一；大名单页不显示战队简称列；**大名单新登记自动预填**：新赛事下首次「登记」预填该队其他赛事的名单，来源按"最近有比赛的赛事"优先（api.series 取各赛事最大日期，无比赛按创建较晚），拉取完成前用户已手输则不覆盖（仅提示条手动带入），可切换来源/清空
- **赛事参赛战队**（event_teams 表，无外键）：大名单页「参赛战队」弹窗**卡片点选**（全部战队卡片网格，点卡片切换选中，搜索名称/简称/拼音，全选/清空只作用于当前搜索结果，＋新建战队创建即选中，至少 1 支才能保存，整体替换）；**无记录=未设置，前端回退显示全部战队**；战队/赛事删除时接口顺手清 event_teams 行；**录入选队按参赛战队过滤**（未设置时=全部战队；切赛事后已选但不在名单中的战队自动清空，RecordForm 的 pickableTeams）
- **当前赛事**：= 最近有系列赛录入的赛事（按系列赛日期，同日取后录入的；全部无录入时取最新创建），由 /api/meta 的 currentEventId 返回。各页默认以它为准：录入列表的赛事筛选（可选全部，选项带场次计数）、新建录入表单默认赛事（优先于上次偏好）、大名单页默认赛事、分析页打开时的默认筛选（用户手选后不再干预）
- **录入前置条件**：新建录入表单要求本赛事**全部参赛战队（未设置时=全部战队）都登记了大名单**才可开始录入（RecordForm 实时校验，缺登时禁用按钮+横幅列缺登战队；继续录入/已录系列赛不受影响）
- 战队/赛事删除受引用约束：有关联系列赛 → 409；尚有赛程（schedule）或大名单（team_rosters）引用也 → 409 提示先清理（两表对 teams/events 有外键无 ON DELETE，不预检会裸 500）
- 英雄数据 src/data/heroes.json（133 名，官方 API 生成，**勿手改**，会被 refresh 覆盖）：`curl herolist.json -o scripts/herolist.raw.json && npm run refresh-heroes && npm run build`。头像 gtimg CDN 失败回退职业色块；主分路人工修正表在 scripts/refresh-heroes.mjs 的 **LANE_PRIMARY**（当前：哪吒/夏侯惇/杨戬/元流之子·坦克/梦奇/猪八戒→打野，蚩奼/卢雅那→发育路，张良/赵怀真/墨子→游走，王维→中路），排到 lanes 最前作选人默认推荐位
- **英雄搜索 heroMatch**（src/data/heroSearch.js，英雄池与分析页共用）：**只按英雄名**（称号不参与，py 仅名称拼音），子串匹配英雄名与 py 各词（全拼+首字母+别名，如 guanyu/gy/lvbu/lubu）；曾评估"≥3 字符子序列匹配"方案，用户决定**不做**——勿自行加回
- 选人交互：点英雄按分路自动预填同位置选手（无可用推荐才弹手动窗）；点已选英雄 SWAP_PLAYERS 互换/移动；英雄池对系列赛已用英雄**仅在轮到用过的一方选择时**灰显+禁选（tooltip 标使用者与局数；对手回合不灰显）
- 「快速完成本局」QUICK_COMPLETE：随机补全剩余 Ban/Pick，校验与 ACT 完全一致（流程/本局唯一/整队锁定/选手位不重复；测试辅助，胜者仍手动标记）
- 录入表单记忆上次配置（localStorage `kpl-bp-record-prefs`：赛事/赛段/日期/赛制）；「上一场首发」取该队最近一场已录系列的末局阵容；录入可直接填备注（meta.note，编辑弹窗可改、续录不改）；PoolPanel 搜索方向键首尾环绕；HistoryPanel 按当局真实蓝红方展示（红方 row-reverse）
- 录入草稿多槽位（localStorage `kpl-bp-record-drafts`，key=meta.sessionId，旧单键自动迁移）：支持同时进行多场录入；「暂存并返回」留草稿退出；「保存已录 X 局」部分保存（仅已完成局入库，SAVED 结束会话，列表「继续录入」补录）；gamesPayload/saveSeriesToDb 是模块级函数（勿移回组件内）

**分析口径**（聚合全在 src/analysis/compute.js，页面 AnalysisPage.jsx，细节以代码注释为准）：

- 五个 tab：总览（Pick/Ban-Pick/Ban 三榜 TOP10）/ 英雄 / 战队 / 选手（全表可排序/可搜索，**点击行内联展开英雄池**——完整英雄按场次排序、胜率≥60%绿/＜40%红、效力战队与最常用英雄在汇总行；数据来自 allPlayerStats 的 heroUse）/ 赛事分析；战队页锚点 4 区块：战队总览/总览/英雄偏好/组合胜率；单队「总览」统计卡一行 6 张：系列赛场次/对局数（小局）/蓝方胜/红方胜/落败后下一局执蓝/执红（afterLossSideStats 口径，无样本显示 —）
- Pick/Ban 率分母 = 2×局数；Ban-Pick 率 =(Pick+Ban)÷(2×局数)；组合榜三档门槛：两位置 ≥5（COMBO_MIN）、三英雄 ≥3（TRIO_MIN）、五英雄 ≥2 且 TOP10（搜索均不限门槛）；全 KPL 组合榜的 Ban 覆盖局 = 任一成员被任一方 ban 的局
- counter 场景按 BP 手序判断"对方已亮"；HAND_OF=[blue:1,4,5,8,9 / red:2,3,6,7,10] 是全场手序表（勿改）
- 轮次为**区间语义**（ROUND_DEFS/seriesRoundKeys/groupByRound）：从备注「第x轮」的首场系列赛起、到下一轮标记场之前的全部归该轮（**中文数字与阿拉伯数字均可**：第一轮/第1轮）；只需给每轮首场标注备注；季后赛边界=首场季后赛系列赛；首边界之前归"未标注"不计入常规赛合计（regular=r1+r2+r3）。**归属在完整未筛选数据上计算（seriesRoundKeys(allGames)，页面筛选掉标记场不影响归属），且按赛事隔离找边界，不跨赛事继承**。**特殊赛制赛事（年度总决赛）不走备注轮次：非默认赛段按赛段值直接分组**（customStageDefs 从全量 allGames 发现、排序先按 CUSTOM_STAGE_ORDER 固有赛制顺序再按首场日期——同日多场只认赛制顺序；roundDefs 动态并入选项，轮次对比区块自动加相邻赛段预设按钮），服务器对 stage 无枚举校验、新赛段值无需后端改动；轮次/赛段对比含三张变化表（英雄 BP率 / 组合出现率 / 英雄平均楼层——floorShiftRows：两组各 Pick≥2 次、平均楼层差排序，▼=更早被选向1楼）；轮次/赛段对比的预设按钮（静态轮次对+相邻赛段对）**只在两端分组都有数据时显示、全空整行隐藏**（年度总决赛范围不会出现"第一轮↔第二轮"等无关预设——用户明确要求，勿回退成静态全显；区块赛事范围只由页面顶部赛事筛选控制，勿再加区块级选择器，用户已回退过一次）
- 大场胜负 = **任一方小局先胜 (BO+1)/2 局才计胜负**，未达门槛的未录完系列赛记"未分"（只入胜率分母；allTeamStats 的 seriesMap 带 bo）
- 英雄页为二级页签：「数据总览」（主分路筛选口径 lanes[0]、英雄表/组合榜默认 20 行增量展开+搜索；**英雄热度趋势**区块——heroTrendRows 按自然月分组、分母=该月 2×局数、零出场月份保留 0 点、手绘 SVG 三线图 Pick 蓝/Ban 红/BP 金、悬停看当月明细）与「对位克制」（顶部一个共用「选择英雄」下拉，下方两区块联动同一英雄——①对位胜负：heroRivalStats 看最常输给/最常赢的对方英雄与两英雄组合，按负场/胜场排序、对战场次 ≥3（RIVAL_MIN）入榜、输给榜只列真输过赢榜只列真赢过、盲选局不计；②Counter 关系：BP 手序应对时机（"对方已亮才选"），有"它 counter 谁/谁 counter 它"两视角，组合模式用自带组合下拉）。两区块语义不同（战绩 vs 时机）**勿合并成一张表**，只共用选择器
- 赛事分析页=轮次对比+不同赛事对比两区块；**不同赛事对比基于全量 allGames，不受上方筛选影响，一次对比两个范围（side）**（选择器为 赛事+赛段 两级 × A/B：默认最近两个赛事的"全部赛段"，可细分到具体赛段如 夏季赛·季后赛 vs 年度总决赛·擂台赛，同赛事不同赛段也可互比；切赛事时该侧赛段重置，两侧完全相同（key=eventId:stage）时去重单侧展示；赛段选项来自 stageGroupsByEvent，默认赛段在前、特殊赛段按 CUSTOM_STAGE_ORDER），T0候选/非Ban必选/热门组合与跨赛事表同源；跨赛事表行为**两侧各出场（Pick+Ban）≥3 次的英雄、按 BP率 变化幅度排序（≤15，用户要求——不再按各侧 TOP10 并集，稳定但无变化的英雄不再霸榜）**；单侧展示时按 BP率 TOP10，**单元格显示该赛事真实 BP率/胜率**（行内存数值、渲染时格式化；B 赛事列附与 A 的差值箭头 delta-up/down，▲升▼降），下方另有 英雄平均楼层变化表（floorShiftRows，两侧各 Pick≥2）与 两/三英雄组合出现率变化表（comboShiftRows/trioShiftRows，两侧各出现 ≥2、出现率分母=该侧局数，ComboChangeTable 组件 pair/trio 共用）（—=未出场，勿改回"不在TOP10显示—"——会把夏洛特这类高频英雄误显为未使用）；**T0 候选阈值 = BP率≥40% 且 ≥5 次**（原 70% 数学上不可达：BP率上限 50%，每局每英雄最多出场 1 次、分母 2×局数；2026-10-03 由 70% 下调），非Ban必选 = ban率≥40% 且 ≥3 次；小样本赛事不加"样本小"标注（用户明确不要）

## 历史教训（红线）

1. 2026-09-11 清理"测试数据"时未先检查内容，误删用户 18 份大名单（恢复 17/18）。
2. 2026-09-12 API 测试造的假阵容选手（a–j）被自动吸进选手库，删系列赛时未清理选手。
**任何批量删除/覆盖前：先列出目标内容并确认归属，只删自己创建的东西；测试数据用完必须连带检查选手库等衍生数据。**
