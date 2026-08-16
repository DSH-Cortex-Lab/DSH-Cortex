# DSH-Cortex

[中文](README.md) | English

> A plugin suite for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): long-term memory, automatic skill capture, and a management panel. Pure Cordis plugin composition — **no modifications to the dsh core**.

[![GitHub stars](https://img.shields.io/github/stars/DSH-Cortex-Lab/DSH-Cortex)](https://github.com/DSH-Cortex-Lab/DSH-Cortex)
[![license](https://img.shields.io/github/license/DSH-Cortex-Lab/DSH-Cortex)](LICENSE)

> [Latest Release](https://github.com/DSH-Cortex-Lab/DSH-Cortex/releases/latest) · [dsh-plugin ecosystem](https://github.com/topics/dsh-plugin) · [Feedback](https://github.com/DSH-Cortex-Lab/DSH-Cortex/issues)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is an open-source agent harness built by DeepSeek AI on the Cordis plugin framework ("everything is a plugin"). DSH-Cortex fills two gaps in dsh — cross-session long-term memory and automatic experience capture — and adds a unified management panel.

## Features

- **Long-term memory**: MEMORY.md / USER.md persistence (file + audit-event dual write), first-step snapshot injection, and snapshot updates that take effect immediately after writes;
- **Persona management**: SOUL archive-level persona (lazy reload — file edits take effect immediately) plus the core:personality machine-level baseline (global, static);
- **Automatic skill capture**: skill write tools (create/patch/edit/delete) + staged writes + session-boundary promotion + background review with three-way output (skills / MEMORY / USER);
- **Management panel**: a "Plugin Management" entry above Settings in the sidebar, opening a full-screen overlay with five tabs (Persona / Memory / User Profile / Skills / MCP);
- **Cache-friendly**: layered persona design (static first, dynamic later), pure-function snapshot rendering, and review triggered on idle/session-end by default — KV cache hit rate does not degrade.

## Packages

| Package | Responsibility | Form |
|---|---|---|
| [`@dsh-cortex/dsh-memory-harness`](dsh-memory-harness/README.md) | MEMORY/USER persistence, SOUL persona injection, memory_add/replace/remove tools, archive isolation | host plugin |
| [`@dsh-cortex/dsh-skill-forge`](dsh-skill-forge/README.md) | skill write tools + staged/promote + background review with three-way output | host plugin |
| [`@dsh-cortex/dsh-review-core`](dsh-review-core/README.md) | shared foundation: digest / dedupe / security scan / review prompts and parsing (pure TS, no dsh dependency) | library |
| [`@dsh-cortex/dsh-cortex-ui`](dsh-cortex-ui/README.md) | management panel: sidebar entry + full-screen overlay with five tabs (host bridge + client UI) | host+client |

Dependency direction: `skill-forge → review-core`, `memory → review-core`, `cortex-ui → memory` (reads the core:personality text).

## Getting Started

### Quick install (from source)

The current version is assembled from source (a one-command `dsh plugin --profile web add dsh-cortex` install will be provided after the npm release):

```sh
git clone https://github.com/DSH-Cortex-Lab/DSH-Cortex.git
# Follow the two "Assembly" steps below: link the four packages into your
# profile and write the cordis.patch.yml entries.
# Restart dsh web to take effect.
```

### Requirements

- Node.js 22+
- A dsh source checkout for builds (point the `DSH_CHECKOUT` environment variable at it)
- `npm install` in each package (build dependencies)

### Assembly

> Note: the packages in this suite are **function plugins** (code packages with
> `apply`) and must **not** go into `dsh.profile.bundles` (that channel is for
> configuration bundles only and fails with `declares no dsh.bundle` at boot).
> Assembly happens in two steps:

**Step 1 — dependency links**: `$DSH_HOME/profiles/<name>/package.json`

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

(`dsh.profile.bundles` keeps only the official configuration bundles; links may
also be junctions: `node_modules/@dsh-cortex/<pkg> → /abs/path/<pkg>`.)

**Step 2 — plugin assembly**: `$DSH_HOME/profiles/<name>/cordis.patch.yml`

```yaml
- insert:
    - id: dsh-memory-harness
      name: '@dsh-cortex/dsh-memory-harness'
    - id: dsh-skill-forge
      name: '@dsh-cortex/dsh-skill-forge'
    - id: dsh-cortex-ui
      name: '@dsh-cortex/dsh-cortex-ui'
```

Constraints:

- The memory plugin must sit after `agent-instructions` / `tool-skill` (injection order baseline→catalog→memory);
- `dsh-cortex-ui` requires **dual assembly** (one package, two mount points; the role is decided automatically by "can see live agents"):
  1. the include layer (the `insert` above in cordis.patch.yml) — provides the browser client (dsh.client declaration);
  2. the agent preset's standing composition (append the same id row at the end of `$DSH_HOME/.agent-presets/<preset>/agent.cordis.yml`) — the preset layer can see host singletons such as skills/agents/webServer and owns the data bridge.
  Reason: the include subtree's ctx is isolated from the root (it cannot see skills/agents), while client-modules only scans host loader entries (preset-layer plugins have no client registration channel).

### Usage

After assembly and restart, a "Plugin Management" entry appears above Settings in the sidebar. Clicking it opens the full-screen panel:

- **Persona**: SOUL (archive persona) and core:personality (machine baseline) cards;
- **Skills**: the `ctx.skills` catalog (search, source, invocation policy, expandable details);
- **MCP**: the mcp-client instances from the loader assembly;
- **Memory / User Profile**: work in progress.

## Persona Layering

The persona structure at the front of the system prompt (in render order):

| order | layer | owner | notes |
|---|---|---|---|
| -200 | soul | DSH-Cortex | archive-level persona (SOUL.md, lazy reload takes effect immediately) |
| -100 | harness:identity | dsh native | system identity statement |
| -90 | core:personality | DSH-Cortex | machine baseline persona (global static, cross-archive shared prefix) |
| 0 | deployment:persona | dsh native | preset persona (shadowable per agent preset) |

## Key Mechanisms

- **Memory**: MEMORY.md persistence (file + `memory/write` audit dual write) + first-step snapshot injection + snapshot update after writes; SOUL lazy reload (mtime check, zero cost when unchanged);
- **Skills**: all writes go to a staged directory (outside scan roots, invisible to Chokidar); promotion at the session boundary is the only trigger for `skills/change` → catalog update;
- **Review**: triggered on session-end / idle, running on `ctx.jobs` in the background, one digest with three-way output (skills/MEMORY/USER), dedupe (similarity ≥ 0.8) + no-change filtering;
- **Cache**: static personas first (cross-session shared prefix), dynamic content later (message-layer append-only); pure-function snapshot rendering (no timestamps/paths); tool schemas contain no runtime data.

## Configuration

- Memory plugin: `memoryLimit` (default 2200 chars), `userLimit` (default 1375), `writeApproval` (default false — fully automatic writes);
- Skill plugin: `reviewTrigger` (default idle), `reviewModel` (optional separate endpoint), `dedupeSimilarity` (default 0.8);
- Management panel routes: `/cortex/api/status`, `/cortex/api/soul` (SOUL.md path defaults to `$DSH_HOME/SOUL.md`).

## Development

```bash
# Build one package (host tsc + client tsdown)
cd <pkg> && DSH_CHECKOUT=/path/to/deepseek-harness bash scripts/build.sh
cd dsh-cortex-ui && npm run build:client   # packages with a client half

# Tests (pure-logic runtime scripts, no assembly required)
node dsh-memory-harness/tests/store.runtime.mjs
node dsh-review-core/tests/review-core.runtime.mjs
node dsh-skill-forge/tests/forge.runtime.mjs
```

## Development Conventions

See [docs/开发准则.md](docs/开发准则.md). Current rule: no emoji, ever.

## Feedback

Issues, feature requests, and design discussions: file at [GitHub Issues](https://github.com/DSH-Cortex-Lab/DSH-Cortex/issues).

## Contributors

| Contributor | Contribution |
|---|---|
| [QinYun165](https://github.com/QinYun165) | plugin implementation (memory-harness / skill-forge / review-core) |
| LAN-TINA-WS | management panel UI (dsh-cortex-ui) / assembly & integration / docs |

## Developer Documentation

| Document | Content |
|---|---|
| [docs/架构说明.md](docs/架构说明.md) | architecture and key mechanisms |
| [docs/自动技能化机制设计.md](docs/自动技能化机制设计.md) | final auto-review design: cadence triggers / checkpoint / write-layer dedupe / staged human-in-the-loop |
| [docs/验收报告.md](docs/验收报告.md) | four-layer acceptance records |
| [docs/交付与交接.md](docs/交付与交接.md) | deliverables and handover notes |
| [docs/开发准则.md](docs/开发准则.md) | development conventions (no emoji + review rules) |
| [dsh-memory-harness/README.md](dsh-memory-harness/README.md) | memory plugin package record |
| [dsh-skill-forge/README.md](dsh-skill-forge/README.md) | skill plugin package record |
| [dsh-review-core/README.md](dsh-review-core/README.md) | shared foundation package record |
| [dsh-cortex-ui/README.md](dsh-cortex-ui/README.md) | management panel package record |

Repository layout: `dsh-memory-harness/`, `dsh-skill-forge/`, `dsh-review-core/`, `dsh-cortex-ui/` (the four packages), `M0/` (environment verification example), `docs/` (documentation).

## License

[MIT](LICENSE)
