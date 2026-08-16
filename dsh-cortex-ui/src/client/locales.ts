/**
 * dsh-cortex-ui 文案字典（namespace: cortex-ui）。
 * 双语平衡：zh 与 en 的 key 一一对应。
 */
export type CortexUiKey =
  | 'entryLabel'
  | 'navTitle'
  | 'close'
  | 'channelError'
  | 'tab.persona'
  | 'tab.memory'
  | 'tab.user'
  | 'tab.skill'
  | 'tab.mcp'
  | 'persona.title'
  | 'persona.intro'
  | 'persona.groupArchive'
  | 'persona.groupBaseline'
  | 'persona.soulName'
  | 'persona.soulBadge'
  | 'persona.soulStatus'
  | 'persona.soulDesc'
  | 'persona.coreName'
  | 'persona.coreBadge'
  | 'persona.coreDesc'
  | 'persona.coreId'
  | 'persona.noBridge'
  | 'persona.chars'
  | 'persona.loaded'
  | 'persona.none'
  | 'skill.intro'
  | 'skill.heading'
  | 'skill.locateOpen'
  | 'skill.locateFailed'
  | 'mcp.intro'
  | 'mcp.heading'
  | 'list.search'
  | 'list.empty'
  | 'list.noMatch'
  | 'list.modelCallable'
  | 'list.userCallable'
  | 'list.enabled'
  | 'list.disabled'
  | 'list.noDescription'
  | 'list.providerSource'
  | 'list.noEndpoint'
  | 'list.loading'
  | 'placeholder.dev'

export type CortexUiDict = Record<CortexUiKey, string>

export const zh: CortexUiDict = {
  entryLabel: '插件管理',
  navTitle: 'DSH-Cortex',
  close: '关闭',
  channelError: '数据通道错误：',
  'tab.persona': '人格',
  'tab.memory': '记忆',
  'tab.user': '用户画像',
  'tab.skill': 'skill',
  'tab.mcp': 'MCP',
  'persona.title': '人格',
  'persona.intro': '人格分两层：SOUL 是档案级人格；core:personality 是机器级公共底线人格。编辑与保存功能后续接入，当前为排版预览。',
  'persona.groupArchive': '档案人格',
  'persona.groupBaseline': '公共底线人格',
  'persona.soulName': 'SOUL',
  'persona.soulBadge': '档案级',
  'persona.soulStatus': '懒重载生效中',
  'persona.soulDesc': '定义「我是谁、我怎么说」——身份、行为准则、沟通风格。每次会话按 SOUL.md 懒重载，改文件即时生效。',
  'persona.coreName': 'core:personality',
  'persona.coreBadge': '机器级 · 只读',
  'persona.coreDesc': '机器级静态人格，所有档案与 agent 共享（order -90），单一来源，不可在此编辑。',
  'persona.coreId': 'order -90 · 全局静态 · 来源：dsh-memory-harness',
  'persona.noBridge': '（未连接 host 桥）',
  'persona.chars': '字符',
  'persona.loaded': '已加载',
  'persona.none': '未提供',
  'skill.intro': '来自 ctx.skills 读端（filesystem provider 扫描 $DSH_HOME/skills、项目 .dsh/skills、~/.agents 与 bundled 技能，rank 100–600）。',
  'skill.heading': '技能目录',
  'skill.locateOpen': '打开具体位置',
  'skill.locateFailed': '无法解析技能本地位置',
  'mcp.intro': '来自 loader 装配的 mcp-client 插件实例（每个实例连接一个 MCP 服务器，工具以 mcp__<server>__<tool> 暴露）。',
  'mcp.heading': 'MCP 服务器',
  'list.search': '搜索',
  'list.empty': '暂无条目',
  'list.noMatch': '无匹配结果',
  'list.modelCallable': '模型可调用',
  'list.userCallable': '用户可调用',
  'list.enabled': '已启用',
  'list.disabled': '未启用',
  'list.noDescription': '（无描述）',
  'list.providerSource': 'provider:',
  'list.noEndpoint': '（无端点信息）',
  'list.loading': '加载中…',
  'placeholder.dev': '功能开发中——后续在此接入',
}

export const en: CortexUiDict = {
  entryLabel: 'Plugin Management',
  navTitle: 'DSH-Cortex',
  close: 'Close',
  channelError: 'Data channel error: ',
  'tab.persona': 'Persona',
  'tab.memory': 'Memory',
  'tab.user': 'User Profile',
  'tab.skill': 'skill',
  'tab.mcp': 'MCP',
  'persona.title': 'Persona',
  'persona.intro': 'Two persona layers: SOUL is the archive-level persona; core:personality is the machine-level baseline. Editing and saving are coming later — layout preview for now.',
  'persona.groupArchive': 'Archive persona',
  'persona.groupBaseline': 'Machine baseline',
  'persona.soulName': 'SOUL',
  'persona.soulBadge': 'Archive',
  'persona.soulStatus': 'Lazy reload active',
  'persona.soulDesc': 'Defines "who I am and how I speak" — identity, conduct, tone. Lazy-reloaded from SOUL.md every session; file edits take effect immediately.',
  'persona.coreName': 'core:personality',
  'persona.coreBadge': 'Machine · read-only',
  'persona.coreDesc': 'Machine-level static persona, shared by all archives and agents (order -90), single source, not editable here.',
  'persona.coreId': 'order -90 · global static · source: dsh-memory-harness',
  'persona.noBridge': '(host bridge not connected)',
  'persona.chars': 'chars',
  'persona.loaded': 'Loaded',
  'persona.none': 'Not provided',
  'skill.intro': 'From the ctx.skills read side (the filesystem provider scans $DSH_HOME/skills, project .dsh/skills, ~/.agents, and bundled skills; ranks 100–600).',
  'skill.heading': 'Skill catalog',
  'skill.locateOpen': 'Open file location',
  'skill.locateFailed': 'Cannot resolve the local skill location',
  'mcp.intro': 'From the mcp-client plugin instances in the loader assembly (each instance connects to one MCP server; tools are exposed as mcp__<server>__<tool>).',
  'mcp.heading': 'MCP servers',
  'list.search': 'Search',
  'list.empty': 'No entries',
  'list.noMatch': 'No matches',
  'list.modelCallable': 'Model-callable',
  'list.userCallable': 'User-callable',
  'list.enabled': 'Enabled',
  'list.disabled': 'Disabled',
  'list.noDescription': '(no description)',
  'list.providerSource': 'provider:',
  'list.noEndpoint': '(no endpoint info)',
  'list.loading': 'Loading…',
  'placeholder.dev': 'Work in progress — ',
}
