# DSH-Cortex

中文 | [English](README.en.md)

> DeepSeek Harness（`dsh`）的「长期记忆 + 自动技能化 + 管理面板」插件集。
> 纯 Cordis 插件叠加、通过 profile 装配，**不修改 dsh 核心**。

[![GitHub stars](https://img.shields.io/github/stars/DSH-Cortex-Lab/DSH-Cortex)](https://github.com/DSH-Cortex-Lab/DSH-Cortex)
[![license](https://img.shields.io/github/license/DSH-Cortex-Lab/DSH-Cortex)](LICENSE)

> [最新 Release](https://github.com/DSH-Cortex-Lab/DSH-Cortex/releases/latest) · [dsh-plugin 生态](https://github.com/topics/dsh-plugin) · [反馈](https://github.com/DSH-Cortex-Lab/DSH-Cortex/issues)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 是 DeepSeek AI 开源的 agent harness（Cordis 插件框架，"everything is a plugin"）。DSH-Cortex 补齐 dsh 缺失的两个能力——跨会话长期记忆与经验自动沉淀，并提供统一的管理面板。

## 特性

- **长期记忆**：MEMORY.md / USER.md 持久化（文件 + 审计事件双写），首 step 快照注入，写入后快照 update 即时生效；
- **人格管理**：SOUL 档案级人格（懒重载，改文件即时生效）+ core:personality 机器底线人格（全局静态）；
- **自动技能化**：技能写端（create/patch/edit/delete）+ staged 写入 + 会话边界 promote + 后台 review 三路输出（技能 / MEMORY / USER）；
- **管理面板**：侧栏「插件管理」入口 + 全屏 overlay（人格 / 记忆 / 用户画像 / 技能 / MCP 五个 tab）；
- **缓存友好**：人格分层设计（静态在前、动态靠后）、快照渲染纯函数、review 默认 idle/session-end 触发，KV 缓存命中率不劣化。

## 包结构

| 包 | 职责 | 形态 |
|---|---|---|
| [`@dsh-cortex/dsh-memory-harness`](dsh-memory-harness/README.md) | MEMORY/USER 持久化、SOUL 人格注入、memory_add/replace/remove 工具、档案隔离 | host 插件 |
| [`@dsh-cortex/dsh-skill-forge`](dsh-skill-forge/README.md) | 技能写端 + staged/promote + 后台 review 三路输出 | host 插件 |
| [`@dsh-cortex/dsh-review-core`](dsh-review-core/README.md) | 共享基建：digest / 去重 / 安全扫描 / review prompt 与解析（纯 TS，无 dsh 依赖） | 纯库 |
| [`@dsh-cortex/dsh-cortex-ui`](dsh-cortex-ui/README.md) | 管理面板：侧栏入口 + 全屏 overlay 五 tab（host 桥 + client UI） | host+client |

依赖方向：`skill-forge → review-core`、`memory → review-core`、`cortex-ui → memory`（读取 core:personality 文本）。

## 快速开始

### 快速安装（源码）

当前版本从源码装配（npm 发布后提供 `dsh plugin --profile web add dsh-cortex` 一键安装）：

```sh
git clone https://github.com/DSH-Cortex-Lab/DSH-Cortex.git
# 按下方「装配」两节，把四个包 link 进 profile 并写入 cordis.patch.yml
# 重启 dsh web 生效
```

### 环境要求

- Node.js 22+
- dsh 源码 checkout（构建用，`DSH_CHECKOUT` 环境变量指向）
- 每个包 `npm install`（构建依赖）

### 装配

> 注意：本插件集的包是**功能插件**（含 `apply` 的代码包），**不能**放进
> `dsh.profile.bundles`（那是配置 bundle 专用通道，会报 `declares no dsh.bundle`
> 导致启动崩溃）。正确装配分两步：

**① 依赖链接**：`$DSH_HOME/profiles/<name>/package.json`

```jsonc
{
  "dependencies": {
    "@dsh-cortex/dsh-memory-harness": "link:/abs/path/dsh-memory-harness",
    "@dsh-cortex/dsh-skill-forge": "link:/abs/path/dsh-skill-forge",
    "@dsh-cortex/dsh-review-core": "link:/abs/path/dsh-review-core",
    "@dsh-cortex/dsh-cortex-ui": "link:/abs/path/dsh-cortex-ui"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]
    }
  }
}
```

（`dsh.profile.bundles` 只保留官方配置 bundle；依赖链接也可用 junction：
`node_modules/@dsh-cortex/<pkg> → /abs/path/<pkg>`。）

**② 插件装配**：`$DSH_HOME/profiles/<name>/cordis.patch.yml`

```yaml
- insert:
    - id: dsh-memory-harness
      name: '@dsh-cortex/dsh-memory-harness'
    - id: dsh-skill-forge
      name: '@dsh-cortex/dsh-skill-forge'
    - id: dsh-cortex-ui
      name: '@dsh-cortex/dsh-cortex-ui'
```

约束：

- memory 插件须装配在 `agent-instructions` / `tool-skill` 之后（注入顺序 baseline→catalog→memory）；
- `dsh-cortex-ui` 需要**双装配**（同一包两个装配点，角色按"能否看到 live agents"自动判定）：
  1. include 层（上面 cordis.patch.yml 的 insert）——提供浏览器端 client（dsh.client 声明）；
  2. agent preset 的 standing composition（`$DSH_HOME/.agent-presets/<preset>/agent.cordis.yml`
     末尾追加同 id 行）——preset 层能看到 skills/agents/webServer 等 host 单例，负责数据桥。
  原因：include 子树的 ctx 与根隔离（拿不到 skills/agents），而 client-modules
  只扫描 host loader entries（preset 层插件没有 client 注册通道）。

### 使用

装配并重启 dsh 后，左侧栏**设置上方**出现「插件管理」入口，点击打开全屏面板：

- **人格**：SOUL（档案人格）与 core:personality（机器底线）卡片；
- **技能**：`ctx.skills` 技能目录（搜索、来源、调用策略、展开详情）；
- **MCP**：loader 装配的 mcp-client 实例清单；
- **记忆 / 用户画像**：功能接入中。

## 人格分层

系统提示词最前部的人格结构（顺序即渲染顺序）：

| order | 层 | 归属 | 说明 |
|---|---|---|---|
| -200 | soul | DSH-Cortex | 档案级人格（SOUL.md，懒重载即时生效） |
| -100 | harness:identity | dsh 原生 | 系统身份声明 |
| -90 | core:personality | DSH-Cortex | 机器底线人格（全局静态，跨档案公共前缀） |
| 0 | deployment:persona | dsh 原生 | 预设人格（agent preset 可 shadow） |

## 关键机制

- **记忆**：MEMORY.md 持久化（文件 + `memory/write` 审计双写）+ 首 step 快照注入 + 写入后快照 update；SOUL 懒重载（mtime 检测，没变零成本）；
- **技能**：写端一律进 staged（扫描根之外，Chokidar 不监视），会话边界 promote 才触发 `skills/change` → 目录更新；
- **review**：session-end / idle 触发，`ctx.jobs` 后台 + 一次 digest 三路输出（技能/MEMORY/USER），去重（相似度 ≥ 0.8）+ no-change 过滤；
- **缓存**：静态人格在前（跨会话公共前缀）、动态内容靠后（消息层 append-only）；快照渲染纯函数（无时间戳/路径）；工具 schema 不含运行时数据。

## 配置

- 记忆插件：`memoryLimit`（默认 2200 字符）、`userLimit`（默认 1375）、`writeApproval`（默认 false，全自动落盘）；
- 技能插件：`reviewTrigger`（默认 idle）、`reviewModel`（独立端点可选）、`dedupeSimilarity`（默认 0.8）；
- 管理面板凭证/数据：webServer 路由 `/cortex/api/status`、`/cortex/api/soul`（SOUL.md 路径默认 `$DSH_HOME/SOUL.md`）。

## 开发

```bash
# 构建单个包（host tsc + client tsdown）
cd <pkg> && DSH_CHECKOUT=/path/to/deepseek-harness bash scripts/build.sh
cd dsh-cortex-ui && npm run build:client   # 含 client 的包

# 测试（纯逻辑运行时脚本，无需装配）
node dsh-memory-harness/tests/store.runtime.mjs
node dsh-review-core/tests/review-core.runtime.mjs
node dsh-skill-forge/tests/forge.runtime.mjs
```

## 开发准则

见 [docs/开发准则.md](docs/开发准则.md)。当前准则：严禁使用 emoji。

## 反馈

问题、需求、设计讨论：提交到 [GitHub Issues](https://github.com/DSH-Cortex-Lab/DSH-Cortex/issues)。

## 贡献者

| 贡献者 | 贡献 |
|---|---|
| [QinYun165](https://github.com/QinYun165) | 插件实现（memory-harness / skill-forge / review-core） |
| LAN-TINA-WS | 管理面板 UI（dsh-cortex-ui）/ 装配集成 / 文档 |

## 开发者文档

| 文档 | 内容 |
|---|---|
| [docs/架构说明.md](docs/架构说明.md) | 架构设计与关键机制 |
| [docs/自动技能化机制设计.md](docs/自动技能化机制设计.md) | 自动总结（review）机制设计定稿：节律触发 / checkpoint / 写入层去重 / staged 人控入库 |
| [docs/skill-forge现状与启停说明.md](docs/skill-forge现状与启停说明.md) | skill-forge 开发日志：验证矩阵 / Hermes 对比 / 停机与启动条件 |
| [docs/验收报告.md](docs/验收报告.md) | 四层验收记录 |
| [docs/交付与交接.md](docs/交付与交接.md) | 交付物与交接说明 |
| [docs/开发准则.md](docs/开发准则.md) | 开发准则（严禁 emoji + review 四项铁律） |
| [dsh-memory-harness/README.md](dsh-memory-harness/README.md) | 记忆插件包档案 |
| [dsh-skill-forge/README.md](dsh-skill-forge/README.md) | 技能插件包档案 |
| [dsh-review-core/README.md](dsh-review-core/README.md) | 共享基建包档案 |
| [dsh-cortex-ui/README.md](dsh-cortex-ui/README.md) | 管理面板包档案 |

仓库结构：`dsh-memory-harness/`、`dsh-skill-forge/`、`dsh-review-core/`、`dsh-cortex-ui/`（四个包）、`M0/`（环境验证示例）、`docs/`（文档）。

## 许可

[MIT](LICENSE)
