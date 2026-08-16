# DSH-Cortex

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）开发的「长期记忆 + 自动技能化」插件集。纯 Cordis 插件叠加、通过 profile 装配，不修改 dsh 核心。

## 包

| 包 | 职责 |
|---|---|
| [`@dsh-cortex/dsh-memory-harness`](dsh-memory-harness/README.md) | MEMORY/USER 持久化、SOUL 人格注入、memory_add/replace/remove 工具、档案隔离、安全扫描 |
| [`@dsh-cortex/dsh-skill-forge`](dsh-skill-forge/README.md) | 技能写端（skill_create/patch/edit/delete）+ staged/promote + 后台 review 三路输出 |
| [`@dsh-cortex/dsh-review-core`](dsh-review-core/README.md) | 共享基建：digest / 去重 / 安全扫描 / review prompt 与解析（纯 TS，无 dsh 依赖） |

依赖方向：`skill-forge → review-core`、`memory → review-core`。

## 装配

> ⚠️ 三个包是**功能插件**（含 `apply` 的代码包），**不能**放进 `dsh.profile.bundles`
> （那是配置 bundle 专用通道，会报 `declares no dsh.bundle` 导致启动崩溃）。
> 正确装配：`dependencies` 用 `link:` + `cordis.patch.yml` 的 `insert` 条目。

**① 依赖链接**：`$DSH_HOME/profiles/<name>/package.json`

```jsonc
{
  "dependencies": {
    "@dsh-cortex/dsh-memory-harness": "link:/abs/path/dsh-memory-harness",
    "@dsh-cortex/dsh-skill-forge": "link:/abs/path/dsh-skill-forge",
    "@dsh-cortex/dsh-review-core": "link:/abs/path/dsh-review-core"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]
    }
  }
}
```

（`dsh.profile.bundles` 只保留官方配置 bundle，**不要**加入本插件集的包；依赖链接也可用 junction：
`node_modules/@dsh-cortex/dsh-memory-harness → /abs/path/dsh-memory-harness`。）

**② 插件装配**：`$DSH_HOME/profiles/<name>/cordis.patch.yml`

```yaml
- insert:
    - id: dsh-memory-harness
      name: '@dsh-cortex/dsh-memory-harness'
    - id: dsh-skill-forge
      name: '@dsh-cortex/dsh-skill-forge'
```

约束：memory 插件须装配在 `agent-instructions` / `tool-skill` 之后（注入顺序 baseline→catalog→memory）。

## 关键机制

- **记忆**：MEMORY.md 持久化（文件 + `memory/write` 审计双写）+ 首 step 快照注入 + 写入后快照 update；SOUL 懒重载（mtime 检测，没变零成本）。
- **技能**：写端一律进 staged（扫描根之外，Chokidar 不监视），会话边界 promote 才触发 `skills/change` → 目录更新。
- **review**：session-end / idle 触发，`ctx.jobs` 后台 + 一次 digest 三路输出（技能/MEMORY/USER），去重（相似度 ≥0.8）+ no-change 过滤。

## 验证

- 每个包含 vitest 单测 + 纯逻辑运行时脚本（`node tests/*.runtime.mjs` 可直接跑）。
- 四层验收已通过：① 进程内 mock ② 真模型 e2e ③ 真进程引导 ④ KV 缓存指标。
