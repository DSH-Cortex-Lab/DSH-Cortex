# core:personality 可编辑改造 · 实施说明与验收报告

> 分支：`feat/core-editable` · 2026-08-16
> 对象：`@dsh-cortex/dsh-memory-harness`

---

## 一、实施说明

### 目标

`core:personality` 从「开发者写死的静态常量」改为「用户文件 + 懒重载可编辑」——「我的 agent 底线是什么」由用户定义，与 SOUL 同款懒重载机制。

### 改动清单

| 文件 | 变更 |
|---|---|
| `src/soul.ts` | 抽出 `FilePersonalityProvider`（懒重载基类）；`SoulProvider`（SOUL，缺失返回空）+ `CoreProvider`（core，缺失写默认模板） |
| `src/profile.ts` | 新增 `resolveCoreFile()` → `$DSH_HOME/core-personality.md` |
| `src/index.ts` | `includeSoul` 时同时注册 `soul`(-200) + `core:personality`(-90) |
| `tests/core.runtime.mjs` | 新增 7 个运行时用例 |
| `tests/memory-harness.spec.ts` | 新增 CoreProvider vitest 用例（4 组） |
| `cordis.patch.yml` + `package.json` | 补 `dsh.bundle` 声明（bundle 装配） |

### core 文件约定

- 路径固定 `$DSH_HOME/core-personality.md`——**全局、跨档案**，不随 profile 定位（这是 core 与 SOUL 的本质差异，务必保持）。
- 首次启动缺失 → 原子写默认模板 `CORE_PERSONALITY_TEXT`（temp + rename）。
- 用户/UI 编辑该文件 → 懒重载下一条请求生效（mtime 检测）。
- 仍禁动态变量（`{{变量}}`）；review 三路输出不写 core/SOUL。

### UI 接入（dsh-cortex-ui，后续）

1. 「公共底线人格」卡片：只读 → 可编辑（textarea + 保存，与 SOUL 卡片同款）。
2. 保存通道：`POST /cortex/api/core`，原子写 `core-personality.md`（与 `/cortex/api/soul` 同构）。
3. 文案：「机器级 · 只读」→「机器底线 · 可编辑」；引导语「底线守则默认不动；改主要人格请编辑档案人格」。

### 不改变的部分

- 两层结构保留（不合并）；order 布局不变（soul -200 → identity -100 → core -90 → persona 0）。
- section 名保持 `core:personality`（改名 `core:baseline` 后续处理）。
- `SoulProvider` 公开 API（`constructor` + `frozenFor`）未变。

---

## 二、验收报告

### 验收结果总览

| 层 | 内容 | 结果 |
|---|---|---|
| 本地 runtime | `tests/core.runtime.mjs` | ✅ 7/7 |
| typecheck | CoreProvider/FilePersonalityProvider/resolveCoreFile | ✅ 0 错误 |
| ① vitest | memory-harness.spec.ts（CoreProvider 新增 + SoulProvider 回归） | ✅ 10/10 |
| ① 全量 | memory + skill-forge 全 spec | ✅ 41 passed |
| ② e2e | memory-harness.e2e（真实 DeepSeek） | ✅ 2/2 |
| ③ 真进程 | 首启动生成默认 + 手改生效 | ✅ |
| ④ KV | core 未动字节稳定 | ✅ 86.5% |

### 验收项逐项

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 首次启动无 core-personality.md → 自动生成默认模板 | ✅（生成 `CORE_PERSONALITY_TEXT` 默认句） |
| 2 | UI 编辑 → 保存 → 下一条生效 | ⏳ 依赖 dsh-cortex-ui（本 PR 交付文件桥） |
| 3 | 手改 core-personality.md → 下一条生效 | ✅（追加中文底线 → 模型答「中文」） |
| 4 | 未改动字节稳定（缓存全命中） | ✅（runtime + KV 86.5%） |
| 5 | review 三路输出不触碰 core 文件 | ✅（代码路径未动） |

### 真进程证据

```text
$ dsh --profile coreA "你好"          # 首启动，core-personality.md 不存在
$ cat ~/.dsh/core-personality.md
→ "You are a careful, direct assistant. Prefer accurate answers over speed;
   verify before claiming success; ask one concise question when a decision
   would materially change the outcome."    ← 默认模板 ✅

$ echo "Always answer in Simplified Chinese." >> ~/.dsh/core-personality.md
$ dsh --profile coreA "用中文还是英文回答？只回答语言名"
→ "中文"                                     ← 懒重载生效 ✅
```

### 回归确认

- 两层结构 + order 布局、section 名、`SoulProvider` API、core 文件全局路径——均保持不变，既有用例全过。

---

## 三、结论

core:personality 可编辑改造**验收通过**。核心语义（懒重载 + 首启动初始化 + 全局路径）全部实证，向后兼容（SoulProvider API 未变）。剩余验收项 2（UI 编辑）依赖后续 dsh-cortex-ui。
