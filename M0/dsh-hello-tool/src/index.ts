/**
 * M0 验证插件：注册一个 `hello` 模型工具，验证 dsh 的 Cordis 工具装配链路。
 *
 * 装配链路（对照计划 §2.1 与 docs/cookbook/adding-a-tool.md、packages/todo/tool-todo）：
 *   profile package.json `dsh.profile.bundles` 加入本包 → dsh 启动加载 → apply(ctx)
 *   → ctx.tools.register(defineTool(...)) → 工具进入 system prompt 工具 schema 与可调用注册表。
 *
 * @module dsh-hello-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'hello-tool'

// 硬依赖：tools 注册表就绪后才 apply。
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'hello',
    description: 'Return a greeting. Exists only to verify the plugin-to-tool assembly chain.',
    parameters: {
      name: {
        type: 'string',
        description: 'Optional name to greet. Defaults to "world".',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      const who = args.name ?? 'world'
      return Promise.resolve(`Hello, ${who}!`)
    },
    presentCall: (args) => ({ card: 'generic', title: 'hello', kind: 'other', rawInput: args }),
  }))
}
