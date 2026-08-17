# dsh-skill-forge 现状与启停说明（开发日志）

> 更新：2026-08-16 深夜 · 状态：**本机停机中**（用户指令），代码主线已推送 main。
> 关联设计：`docs/自动技能化机制设计.md`（v2 定稿，含 D-g fork 形态与 D-d 人控修订）。

---

## 一、当前状态（验证矩阵）

| 能力 | 代码状态 | 单测 | 实机验证 |
|---|---|---|---|
| 写端工具 skill_create / patch / edit / delete | 完成 | 过 | agent 实际使用未充分观察 |
| staged 写入（扫描根外） | 完成 | 过 | 过（面板可见） |
| 人控入库 / 丢弃 / 删除标记确认（面板） | 完成 | — | 入库/丢弃过；删除标记流未验 |
| 节律触发（cadence：10 用户轮；工具路关闭） | 完成 | 计数函数过 | 过（多次 triggered/completed） |
| checkpoint 增量持久化（重启不重复） | 完成 | 增量切窗过 | 过（checkpoint 落盘、重启后未重复） |
| 单发 JSON review（三路输出 + 去重 + 后缀） | 完成 | 过 | 过（5 个技能 + MEMORY 经验条目均为其产物） |
| **fork 子 agent 形态（Hermes 式）** | 完成 | 构建过 | **未实机验证**（提交后未重启加载，随即停机） |
| 同名 merge / 相似度跳过 | 完成 | merge 有单测 | merge 路径实机未触发（历史产物均为新建） |
| 活动日志（[review] 行，仅日志文件，面板不展示） | 完成 | — | 过 |

## 二、与 Hermes 对比（最终形态）

| 维度 | Hermes | 本插件 |
|---|---|---|
| 触发 | 每 10 用户轮（记忆）+ 10 工具迭代（技能） | 每 10 用户轮；工具路因每轮工具密集而关闭（本机配置 999999） |
| 执行形态 | fork 子 agent，16 轮上限，工具白名单 | 同款 fork（toolFilter 白名单 + 影子 persona + 自主读库落盘），180s 超时 |
| review 输入 | 全量重放（warm cache） | checkpoint 增量 + 尾窗 + compaction 摘要（更省；重启不重复） |
| 判定 prompt | 信号分类学 + 反向过滤 + 保护清单 | 已对齐（目录带 source 标注；仅 user-dsh 可扩展） |
| 落盘 | 直接写库 | staged 人控入库（唯一入口 = 面板「入库」按钮） |
| 自动标记 | 无 | name `-auto-save` + description `(Auto-save)` |
| 用户画像 | 并入 memory | 三路输出③独立 USER.md |
| 未对齐项 | — | support files（references/templates/scripts）三层结构、curator 整合、warm cache 复用（增量 digest 无此需求） |

## 三、推进进度（对照计划）

- M2（写端 + staged/promote）：完成并实机验证；
- M3（review 引擎 + 三路输出 + 去重）：完成并实机验证（单发形态）；
- review v2（设计文档 D-a..D-g）：完成——节律触发、checkpoint、写入层去重、staged 人控、fork 形态（D-g）、Hermes 对齐 prompt；
- 未完成：fork 形态实机验证、merge 路径实机验证、删除标记流实机验证、fork 成本/耗时观测。

## 四、停机与启动条件

**当前**：本机 `profiles/web/cordis.patch.yml` 中 `dsh-skill-forge` 置 `disabled: true`（用户指令 2026-08-16）。面板与记忆插件保持运行。

**重新启动的前置条件（"写好后再启动"清单）**：
1. [x] skill_promote 工具移除——入库唯一入口 = 面板（防 agent 绕过人控）；
2. [x] 自动 promote 全部移除（启动清扫 + 会话结束），纯人控；
3. [ ] 启动后首轮实机验证（fork 链路 spawn → completed、技能产出进 staged）；
4. [ ] 观察项：fork 单次耗时/成本、同名 merge 路径、删除标记确认流、10 轮节奏是否合适。

**恢复方式**：删除 `cordis.patch.yml` 中 `dsh-skill-forge` 段的 `disabled: true`，重启 web。恢复后建议先按清单 3/4 观察一轮再放量。

## 五、决策记录（增量）

| # | 决策 | 理由 |
|---|---|---|
| 6 | 工具路触发关闭（reviewToolInterval=999999） | 每轮工具调用密集，按工具数触发过于频繁（用户实测反馈） |
| 7 | 入库唯一入口 = 面板按钮；移除全部自动 promote（含启动清扫） | 技能曾在用户未确认时被启动清扫悄悄入库（用户实测反馈） |
| 8 | 移除 skill_promote 工具 | agent 可显式调用绕过人控，与决策 7 冲突；入库必须经面板 |
| 9 | fork 形态提交后未实机验证即停机 | 用户要求"写好后再启动"；fork 为最后一份未验证代码，列入启动后验证清单 |

---

附：实机验证过的 5 个自动技能（electron-window-icon / electron-cdp-debugging / electron-desktop-shell / electron-local-web-shell / dsh-automatic-skill-review，均为单发形态产物）为启动清扫误入库，非用户手动入库；现已改为纯人控，此类情况不会再现。
