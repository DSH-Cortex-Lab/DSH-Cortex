# dsh-skill-forge

dsh 自动技能化插件（Cordis）。P0 范围：**技能写端（SkillForge 落盘引擎 + 四写端工具 + 会话边界 promote）**；后台 review 自动生成（review.ts/digest.ts）后移至 M3。

## 职责

| 能力 | 机制 | 落点 |
|---|---|---|
| 落盘引擎 | frontmatter 生成、staged 写入、promote、校验（纯 TS） | `src/forge.ts`、`src/validate.ts` |
| 写端工具 | `skill_create` / `skill_patch` / `skill_edit` / `skill_delete`（一律写 staged）+ `skill_promote` | `src/tools.ts` |
| 会话边界 promote | 最后一个 live session 离开后落回扫描根（D19/D25） | `src/promote.ts` |
| 审计事件 | `skill/write`（log-only，声明内联于 tools.ts） | `src/tools.ts` |
| 不变式 | skill/write 载荷校验（companion） | `src/invariant.ts` |
| 后台 review | 三路输出 + 去重（D5/D27） | `src/review.ts`、`src/digest.ts`、`src/dedupe.ts` |

## 装配

在目标 profile 的 `package.json`：

```jsonc
{
  "dependencies": { "dsh-skill-forge": "link:<本包绝对路径>" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-skill-forge"]
    }
  }
}
```

## 配置（P0 子集）

| 字段 | 默认 | 说明 |
|---|---|---|
| `defaultRoot` | `user` | 技能扫描根（`user` → `$DSH_HOME/skills`） |
| `maxSkillBytes` | 32768 | 单个 SKILL.md 字节上限 |
| `writeApproval` | false | 写入门控（D7 取消默认，P0 无效果） |
| `homePath` | $DSH_HOME | 自定义 home 根 |
| `skillRoot` / `stagedDir` | 推导 | 显式覆盖扫描根 / staged 目录（staged 必须在扫描根之外，D19） |

> review 相关配置（`reviewEnabled/reviewTrigger/reviewModel/…`）后移至 M3。

## 关键决策落地

- **D3/D19**：写端一律进 staged 目录（扫描根之外，Chokidar 不监视）；promote 只在会话边界执行，落回才触发 `skills/change` → 目录消息更新。
- **D25**：promote 前检查无其他 live session（`ctx.sessions.list()`），最后一个 session 离开后才 promote。
- **D17**：工具 schema/描述不含运行时数据（不写死路径/limits）。
- **D2/D18**：`skill/write` 审计事件 log-only。
- **frontmatter 对齐 skill-filesystem**：name/description/whenToUse + `---` 定界，渲染用 JSON 字符串（合法 YAML），能被 skill-filesystem 的 `parseYaml` 正确读回。

## 测试

- `tests/forge.spec.ts`（vitest，monorepo 内 `pnpm vitest run`）
- `tests/forge.runtime.mjs`（自包含，`node tests/forge.runtime.mjs` 直接跑，已 10/10 通过）

## 范围边界（P0）

- 解析为自包含的 `key: value` 标量解析器（本写端格式 + 简单外部 frontmatter）；复杂 YAML（多行块/嵌套 map）若需解析任意外部技能，M3 引入 `yaml`。
- 后台 review（一次 digest 三路输出）、去重、pending 门控、崩溃清扫 → M3/M4。
- `defaultRoot` 的 `project`/`custom` 根解析、与 dsh 真实 user 技能根精确对齐 → M3。
