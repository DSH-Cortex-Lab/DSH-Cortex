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
  | 'persona.soulPlaceholder'
  | 'persona.coreName'
  | 'persona.coreBadge'
  | 'persona.coreGuide'
  | 'persona.corePlaceholder'
  | 'persona.noBridge'
  | 'persona.chars'
  | 'skill.intro'
  | 'skill.heading'
  | 'skill.locateOpen'
  | 'skill.locateFailed'
  | 'user.intro'
  | 'user.placeholder'
  | 'memory.intro'
  | 'memory.placeholder'
  | 'editor.save'
  | 'editor.saving'
  | 'editor.saved'
  | 'editor.saveFailed'
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
  'persona.intro': '人格分两层：SOUL 是档案级人格；core:personality 是机器级公共底线。两层都可在此编辑，保存后原子写回对应文件，懒重载下一条请求生效。',
  'persona.groupArchive': '档案人格',
  'persona.groupBaseline': '机器底线',
  'persona.soulName': 'SOUL',
  'persona.soulBadge': '档案级',
  'persona.soulStatus': '懒重载生效中',
  'persona.soulPlaceholder': '在此编辑档案人格（SOUL）…',
  'persona.coreName': 'core:personality',
  'persona.coreBadge': '机器底线 · 可编辑',
  'persona.coreGuide': '底线守则默认不动；要改你的主要人格请编辑档案人格（SOUL）。',
  'persona.corePlaceholder': '在此编辑机器底线守则…',
  'persona.noBridge': '（未连接 host 桥）',
  'persona.chars': '字符',
  'skill.intro': '来自 ctx.skills 读端（filesystem provider 扫描 $DSH_HOME/skills、项目 .dsh/skills、~/.agents 与 bundled 技能，rank 100–600）。',
  'skill.heading': '技能目录',
  'skill.locateOpen': '打开具体位置',
  'skill.locateFailed': '无法解析技能本地位置',
  'user.intro': '用户画像（USER.md）记录关于用户的持久事实与偏好：称呼、背景、目标、约束。由记忆/复盘流程自动维护，也可在此手动编辑；保存后原子写回 USER.md，下次请求生效。',
  'user.placeholder': '在此编辑用户画像…',
  'memory.intro': '记忆（MEMORY.md）是 agent 的长期记忆：跨会话保留的关键事实、任务进展与经验教训。由复盘（review）流程自动写入，也可在此手动编辑；保存后原子写回 MEMORY.md，下次请求生效。',
  'memory.placeholder': '在此编辑记忆…',
  'editor.save': '保存',
  'editor.saving': '保存中…',
  'editor.saved': '已保存',
  'editor.saveFailed': '保存失败：',
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
  'persona.intro': 'Two persona layers: SOUL is the archive-level persona; core:personality is the machine-level baseline. Both are editable here; saving writes the file atomically and lazy reload applies it on the next request.',
  'persona.groupArchive': 'Archive persona',
  'persona.groupBaseline': 'Machine baseline',
  'persona.soulName': 'SOUL',
  'persona.soulBadge': 'Archive',
  'persona.soulStatus': 'Lazy reload active',
  'persona.soulPlaceholder': 'Edit the archive persona (SOUL) here…',
  'persona.coreName': 'core:personality',
  'persona.coreBadge': 'Machine baseline · editable',
  'persona.coreGuide': 'Leave the baseline alone by default; edit the archive persona (SOUL) to change your main personality.',
  'persona.corePlaceholder': 'Edit the machine baseline rules here…',
  'persona.noBridge': '(host bridge not connected)',
  'persona.chars': 'chars',
  'skill.intro': 'From the ctx.skills read side (the filesystem provider scans $DSH_HOME/skills, project .dsh/skills, ~/.agents, and bundled skills; ranks 100–600).',
  'skill.heading': 'Skill catalog',
  'skill.locateOpen': 'Open file location',
  'skill.locateFailed': 'Cannot resolve the local skill location',
  'user.intro': 'The user profile (USER.md) holds durable facts and preferences about the user: name, background, goals, constraints. Maintained by the memory/review flows and editable here; saving writes USER.md atomically and takes effect on the next request.',
  'user.placeholder': 'Edit the user profile here…',
  'memory.intro': 'Memory (MEMORY.md) is the agent long-term memory: key facts, task progress, and lessons kept across sessions. Written automatically by the review flow and editable here; saving writes MEMORY.md atomically and takes effect on the next request.',
  'memory.placeholder': 'Edit memory here…',
  'editor.save': 'Save',
  'editor.saving': 'Saving…',
  'editor.saved': 'Saved',
  'editor.saveFailed': 'Save failed: ',
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
