# dsh-memory-harness

dsh 记忆管理插件（Cordis）。P0 范围：**MEMORY（长期记忆）+ SOUL（人格）**；USER 用户画像后移（M1b，协作者在 review 三路输出落地后整合）。

## 职责

| 能力 | 机制 | 落点 |
|---|---|---|
| 长期记忆 | MEMORY.md 持久化 + 首 step 快照注入 + 写入后快照 update | `src/store.ts`、`src/snapshot.ts` |
| 记忆工具 | `memory_add` / `memory_replace` / `memory_remove` | `src/tools.ts` |
| 人格 | SOUL.md → section(order -200) + core:personality(order -90) | `src/soul.ts` |
| 档案路径 | 配置档案 > default（$DSH_HOME） | `src/profile.ts` |
| 审计事件 | `memory/write`（log-only，D2/D18，声明内联于 tools.ts） | `src/tools.ts` |
| 不变式 | memory/write 载荷校验（companion） | `src/invariant.ts` |

## 装配

在目标 profile 的 `package.json`（`$DSH_HOME/profiles/<name>/package.json`）：

```jsonc
{
  "dependencies": {
    "dsh-memory-harness": "link:<本包绝对路径>"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-memory-harness"]
    }
  }
}
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `memoryLimit` | 2200 | MEMORY 容量上限（条目内容字符数） |
| `userLimit` | 1375 | USER 容量上限（预留，M1b 启用） |
| `includeSoul` | true | 注入 SOUL 人格 section |
| `includeSnapshot` | true | 注入 MEMORY 快照消息 |
| `writeApproval` | false | 写入门控（D7 已取消默认，P0 无效果） |
| `homePath` | $DSH_HOME | 自定义 home 根 |
| `profile` | — | 显式档案（进程级 dsh --profile 解析后移至 M3） |

## 关键决策落地

- **D1/D10/D20**：记忆走 durable user/message（首 step 快照 + 写入后 update），不进 system prompt section。
- **D2/D18**：写 = 文件 + `memory/write` 审计事件双写；事件 log-only。
- **D13/D28**：SOUL 懒重载（mtime 检查 + 内容双重校验 + 同步 statSync/readFileSync）。
- **D14**：快照渲染 = 文件内容纯函数（固定表头 + 条目 + `§`），无容量表头/时间戳/路径。
- **D26 方案 A**：soul(-200) → identity(-100) → core:personality(-90) → persona(0)。
- **D4**：超限报错返回当前条目，让模型自整理，不静默截断。
- **D17**：工具 schema/描述不含运行时数据（不写死 limits/路径）。

## 测试

- `tests/store.spec.ts`（vitest，单测规范，包构建后对齐 TS 源码）
- `tests/memory-harness.spec.ts`（vitest，① 层集成，SOUL 懒重载/快照注入/跨会话）
- `tests/memory-harness.e2e.spec.ts`（② 层真模型，需 DEEPSEEK_API_KEY）
- `tests/store.runtime.mjs` / `tests/profile.runtime.mjs`（node 直接跑，纯逻辑）

## 范围边界（P0）

- 仅实现 `target='memory'`；`'user'` 槽位保留（userFile/userLimit 已就位），M1b 启用。
- 进程级 `dsh --profile` 档案解析、frozenByScope 防御性键控、安全扫描（`security.ts`）后移至 M3。
- 写入门控（pending/审批）按 D7 取消默认，未实现。
