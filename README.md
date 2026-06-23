# pi-subagents-persona

A [Pi](https://github.com/earendil-works/pi-mono) **companion extension to
[pi-subagents](https://github.com/nicobailon/pi-subagents)** that adds switchable
**supervisor personas**: a named identity (system prompt + optional model/effort
+ an opencode-style delegation/tool allowlist) applied to your top-level session,
switched with a key or `/persona`, and shown in the footer.

> [!IMPORTANT]
> **Requires [pi-subagents](https://github.com/nicobailon/pi-subagents)** — this
> is a companion, not a standalone extension. Install it first:
> ```bash
> pi install npm:pi-subagents
> ```
> The delegation allowlist and the seeded `worker` operator only do anything with
> pi-subagents present. (The persona-as-supervisor-identity part — system prompt +
> model/effort + tool allowlist — works on its own, but the point is to drive a
> pi-subagents fleet.)

## Why

Pi core has **no native persona/agent concept**, and pi-subagents models
specialists as fixed-role agents with no way to swap the *supervisor's* identity
at runtime. This is the missing piece: think of it as Claude Code's **output
styles** (reshape the main agent) + **subagent fleet** + opencode's
`permission.task` allowlist, ported to Pi. It does **not** reimplement
delegation — pi-subagents still runs the subagents; a persona only shapes *who
the supervisor is* and *what fleet/model/tools it has*.

## What a persona is

A persona file is Markdown: YAML-ish frontmatter + a body (the supervisor system
prompt). Switching a persona applies it to the **top-level session** — you talk
to Pi and Pi *is* that supervisor.

```yaml
---
name: reviewer
label: "🔍 Reviewer"
persona: true                     # the ONE marker: this file is a switchable persona
# model/thinking are OPTIONAL — if present they're applied; if absent the
# user/session keeps its own choice.
model: claude-pro-max-native/claude-opus-4-8
thinking: high
systemPromptMode: append          # append (default) | replace
tools: read, grep, bash, subagent, web_search   # supervisor's active tools (absent → all)
delegate:                         # which pi-subagents agents this persona may launch
  allow: ["worker", "scout"]      #   absent block → allow all ("sees everyone")
  deny:  ["experimental-*"]
skills: [code-review]             # advisory skill scope (absent → all)
---
You are Reviewer: ...             # body = the supervisor system prompt
```

> **One marker, no overlap.** A file is a switchable supervisor persona **iff it
> has `persona: true`**. Files without it (e.g. the bundled `worker`) are plain
> pi-subagents *operators* — seeded so supervisors can delegate to them, but never
> shown in the persona picker. There is no separate `hidden` flag.

The frontmatter is a small YAML **subset** (scalars, inline `[a, b]` and block
`- a` lists, one level of nested `allow`/`deny` maps) — not a full YAML engine.
`tools`/`skills` are written **flat** (comma-separated) so the same file is also a
valid pi-subagents agent when seeded; `delegate` is nested and read only here.

### Permission semantics (opencode-style)

For `delegate`, `tools`, `skills` — each `{ allow?, deny? }` of glob patterns
(`*`, `?`):

- **deny wins**: matches a `deny` pattern → denied.
- **allowlist mode**: if `allow` is present, only matching names are allowed
  (unlisted → denied). `allow: ["*"]` = allow all; `allow: []` = lockdown.
- **denylist mode**: `deny` only → allow everything except denied.
- **absent block → allow** (no restriction). For `delegate`, an absent block also
  means "sees everyone" by default — set `PI_PERSONA_DELEGATE_DEFAULT=deny` to
  make an absent block mean lockdown instead.

> **A persona never removes pi-subagents power by default — it's a companion.**
> Without a `delegate` block (or with `deny`-only / `allow: ["*"]`), the
> supervisor keeps full delegation: it chooses, per task, to delegate to a
> **persona/role subagent** (e.g. `worker`), a **native pi-subagents agent**
> (scout, planner, …), or an **ad-hoc subagent it authors on the fly**. Use
> `delegate.allow` only when you deliberately want a locked-down supervisor — then
> its fleet *is* that allowlist. Likewise an absent `tools` block keeps every tool.
>
> ⚠️ If you DO restrict `tools`, **include `subagent`** — it's the tool used to
> delegate. A `tools.allow` without it blocks delegation entirely (the supervisor
> can no longer reach its fleet).

## How it works (all on documented Pi primitives)

| Concern | Mechanism |
|---------|-----------|
| Supervisor identity | `before_agent_start` → `systemPrompt` (append/replace, composes with other extensions) |
| Persona name shown | `ctx.ui.setStatus('persona', label)` (footer segment) |
| Switch key | `registerShortcut('ctrl+shift+p')` + `/persona` command/picker |
| Model / effort (optional) | `setModel` / `setThinkingLevel` — only if the persona declares them |
| Tool allowlist | `setActiveTools(filter(getAllTools, persona.tools))`; restored on clear |
| Delegation allowlist | filter `subagent {action:"list"}` result (supervisor only *sees* allowed) **and** block disallowed `subagent` delegations |
| Operators (e.g. `worker`) | a file without `persona: true` — seeded for delegation, never in the picker |

> `shift+tab` is **reserved** by Pi core for cycling reasoning effort, so the
> persona cycle uses `ctrl+shift+p` by default (override with `PI_PERSONA_KEY`).

## Seeding

On the first session, the extension **seeds its bundled personas/operators into
your Pi agents dir** (`~/.pi/agent/agents`) — only files that don't already exist
(it never overwrites your edits). This makes them discoverable by pi-subagents
(so supervisors can delegate to `worker`, and you can `/run` them) and is where
the extension loads personas from. Disable with `PI_PERSONA_SEED=off`.

Bundled: `planner`, `reviewer`, `researcher` (supervisor personas) and `worker`
(a hidden operator the supervisors delegate to, verticalized by inherited or
task-supplied skills).

## Install & use

```bash
pi install npm:pi-subagents    # the companion target (required)
pi install .                   # this extension, from the repo root
pi list
```

- `ctrl+shift+p` — cycle to the next persona.
- `/persona` — pick from a list; `/persona <name>` — activate by name;
  `/persona off` — back to the default supervisor; `/persona list` / `/persona reload`.
- Personas load from `~/.pi/agent/agents` and `<project>/.pi/agents` (project
  wins), plus any `PI_PERSONA_DIRS`. Any agent there becomes a switchable persona
  by adding `persona: true`.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PI_PERSONA_DISABLE` | _(off)_ | Any non-empty value disables the extension. |
| `PI_PERSONA_DIRS` | _(none)_ | Extra persona dirs (`;`/`,` separated), highest priority. |
| `PI_PERSONA_DEFAULT` | _(none)_ | Persona name to activate on session start. |
| `PI_PERSONA_KEY` | `ctrl+shift+p` | Keybinding that cycles personas. |
| `PI_PERSONA_DELEGATE_DEFAULT` | `allow` | Meaning of an ABSENT `delegate` block: `allow` (sees everyone) or `deny` (lockdown). |
| `PI_PERSONA_SEED` | `on` | Seed bundled personas/operators into the agents dir on startup; `off` disables. |
| `PI_PERSONA_SEED_DIR` | `~/.pi/agent/agents` | Seed target + primary load dir. |

## Relationship to pi-subagents

Strictly a companion. pi-subagents owns agent definitions, delegation, chains,
and parallel runs; this extension never reimplements them. It only: injects the
supervisor persona (Pi-core, provider-agnostic), and enforces the persona's
delegation allowlist over pi-subagents' `subagent` tool (filter its `list`
result, block out-of-list calls). It uses its own UI key (`persona`) so it never
clobbers pi-subagents' `subagent-async` widget / `subagent-slash` status.

## Development

```bash
npm install
npm run typecheck
npm test          # pure-module unit tests + a mock-pi integration test of the hooks
```

`permissions.ts`, `persona.ts`, and `subagent.ts` are pure (no Pi imports) and
unit-tested; `integration.test.ts` drives the real extension with a mock `pi` to
verify activation, prompt injection, tool restriction, delegation blocking, and
list filtering. See [AGENTS.md](AGENTS.md) for architecture.

## License

MIT
