# dsh-hello-tool

M0 验证插件：注册一个 `hello` 模型工具，验证 DeepSeek Harness 的 Cordis 工具装配链路。

## 作用

- 插件导出 `name` / `inject` / `apply(ctx)`，在 `apply` 中调用 `ctx.tools.register(defineTool({...}))`。
- `hello` 工具参数 `name?`，返回 `Hello, <name>!`。
- 仅用于验证「插件 → 装配 → 工具注册 → 模型可见」链路，是 `dsh-memory-harness` 与 `dsh-skill-forge` 两个正式插件的最小原型。

## 装配（二选一）

### 路径 A：加入 profile bundles（简单宿主工具插件，推荐）

在目标 profile 的 `package.json`（`$DSH_HOME/profiles/<name>/package.json`）：

```jsonc
{
  "dependencies": {
    "dsh-hello-tool": "link:D:/documents/code/dsh-soul-user-memory/M0/dsh-hello-tool"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-hello-tool"]
    }
  }
}
```

然后 `dsh --profile <name>` 启动即可。

### 路径 B：cordis.patch.yml 插入行

用本目录的 `cordis.patch.yml`（或 `dsh --patch` 覆盖）显式插入插件行，用于需要精确控制装配位置的场景。

## 参考

- 工具范式：`packages/todo/tool-todo/src/index.ts`
- 工具契约：`docs/cookbook/adding-a-tool.md`
- 包清单约束：`docs/cookbook/adding-a-package.md`
