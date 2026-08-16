# dsh-review-core

`dsh-memory-harness` 与 `dsh-skill-forge` 共享的 review 基建（纯 TS、无 dsh 依赖、可独立单测）。

## 职责（计划 §6「共享基建 · P2 抽取」）

| 模块 | 职责 | 被谁用 |
|---|---|---|
| `digest.ts` | 最近 K 轮逐字 + 早期摘要投影（D6/D22） | skill-forge review |
| `dedupe.ts` | Jaccard 3-gram 相似度 ≥0.8 去重（D7） | review |
| `security.ts` | 密钥/外泄扫描，纯函数（D14） | 两插件 |
| `prompt.ts` | review 提示词模板 + 三路输出解析（D27） | skill-forge review |

## 使用

两个插件在 P2 抽取后从本包导入（`import { ... } from 'dsh-review-core'`）；当前内存/技能包内的同名副本在链接时移除。

## 测试

- `tests/review-core.runtime.mjs`（`node` 直接跑，已全绿）

## 范围

- 纯函数、无 dsh 依赖：digest/去重/扫描/提示词与解析都可独立单测。
- 不含 review 编排（`ctx.jobs`/`ctx.llm` 调用）——那是 skill-forge 的 `review.ts`（集成层）。
