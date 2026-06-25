# pi-subagents-persona

A [Pi](https://github.com/earendil-works/pi-mono) **companion extension to
[pi-subagents](https://github.com/nicobailon/pi-subagents)** that adds switchable
**supervisor personas**: a named identity (system prompt + optional model/effort
+ an opencode-style delegation/tool allowlist) applied to your top-level session,
switched with a key or `/persona`, and shown in the footer.

> [!IMPORTANT]
> **Requires [pi-subagents](https://github.com/nicobailon/pi-subagents)** — this is a
> companion, not a standalone extension. For live, async **coaching** it also needs a
> coordination bus:
> **[pi-subagents-comtac](https://github.com/AeonDave/pi-subagents-comtac)** — a
> cross-platform, drop-in replacement for the legacy `pi-intercom`.
> ```bash
> pi install npm:pi-subagents                               # delegation / chains / parallel
> pi install git:github.com/AeonDave/pi-subagents-comtac    # async child→supervisor channel
> pi install git:github.com/AeonDave/pi-subagents-persona   # this extension
> ```
> The delegation allowlist and the seeded supervisor personas only do anything with
> pi-subagents present. **`pi-subagents-comtac` is what turns a supervisor persona into
> an actual coach**: it carries `contact_supervisor` escalations from running children
> and lets `resume` steer a still-running async child. Without it, delegation is
> fire-and-forget — you can launch and read results, but not supervise live, so the
> personas' active-coaching guidance has no channel to work over. (The
> persona-as-supervisor-identity part — system prompt + model/effort + tool
> allowlist — works on its own, but the point is to drive a *coached* pi-subagents fleet.)

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
  allow: ["scout", "researcher"]   #   absent block → allow all ("sees everyone")
  deny:  ["experimental-*"]
skills: [code-review]             # advisory skill scope (absent → all)
---
You are Reviewer: ...             # body = the supervisor system prompt
```

> **One marker, no overlap.** A file is a switchable supervisor persona **iff it
> has `persona: true`**. A file without it is a plain pi-subagents *operator* —
> seeded for delegation, never shown in the persona picker (there is no separate
> `hidden` flag). This package bundles only supervisor personas; they build the
> executors they need as **ad-hoc subagents on the fly**, so no generic operator ships.

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
> supervisor keeps full delegation: per task it **authors an ad-hoc subagent on the
> fly** (its default), or delegates to a **native pi-subagents agent** (scout,
> planner, …) or another persona when one already fits. Use
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
| Switch key | `registerShortcut('f8')` + `/persona` command/picker |
| Model / effort (optional) | `setModel` / `setThinkingLevel` — only if the persona declares them |
| Tool allowlist | `setActiveTools(filter(getAllTools, persona.tools))`; restored on clear |
| Delegation allowlist | filter `subagent {action:"list"}` result (supervisor only *sees* allowed) **and** block disallowed `subagent` delegations |
| Operators | a file without `persona: true` — seeded for delegation, never in the picker (this package bundles none; supervisors author ad-hoc subagents) |

> The default is **`f8`**, not a modifier combo. A `ctrl+shift+<letter>` has to
> dodge Pi's **reserved** keys (`shift+tab` = effort, `ctrl+p`/`shift+ctrl+p` =
> model cycle, `ctrl+o`/`ctrl+k`/`ctrl+g`/… — extension shortcuts on these are
> *skipped*), **the terminal's** own grabs (Windows Terminal alone claims
> `ctrl+shift+{a,c,d,f,n,p,t,v,w}`; iTerm/VS Code claim others), *and* survive the
> kitty/win32 keyboard protocol. Function keys sidestep all of it — Pi binds none,
> terminals don't intercept them (only F11), no protocol needed. Override with
> `PI_PERSONA_KEY` if your terminal leaves a combo free (e.g. `alt+p`).

## Seeding

On the first session, the extension **seeds its bundled personas into your Pi
agents dir** (`~/.pi/agent/agents`) — only files that don't already exist (it never
overwrites your edits). This makes them discoverable (so you can `/run` them) and is
where the extension loads personas from. Disable with `PI_PERSONA_SEED=off`.

Bundled: `planner`, `coder`, `reviewer`, `researcher` (supervisor personas). No
generic operator ships — each supervisor **authors task-specific ad-hoc subagents on
the fly** (cold packet + skill plan + ad-hoc model) for whatever a step needs.

All supervisor personas keep delegated children on the **same provider** as the
supervisor's current model by default (varying only tier/effort per task), to avoid
cross-provider tool/format mismatches; they switch provider only on explicit user
request.

## Install & use

```bash
pi install npm:pi-subagents                               # required: owns delegation / chains / parallel runs
pi install git:github.com/AeonDave/pi-subagents-comtac    # async coaching: child→supervisor escalation
pi install git:github.com/AeonDave/pi-subagents-persona   # this extension
# to hack on / test it locally instead of from GitHub:
pi install <local path>                                   # e.g. `pi install .` from the repo root
pi list
```

- `f8` — cycle to the next persona, wrapping through a **"no persona"** slot
  (back to the default supervisor) before the first one. Override with `PI_PERSONA_KEY`.
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
| `PI_PERSONA_DEFAULT` | _(none)_ | Persona name to activate on session start (pins it; overrides the remembered one). |
| `PI_PERSONA_KEY` | `f8` | Keybinding that cycles personas. |
| `PI_PERSONA_PERSIST` | `on` | Remember the last selected persona and restore it (already visible) on restart; `off` disables. |
| `PI_PERSONA_STATE_FILE` | `~/.pi/agent/persona/state.json` | Where the remembered selection is stored (the plugin's own folder). |
| `PI_PERSONA_DELEGATE_DEFAULT` | `allow` | Meaning of an ABSENT `delegate` block: `allow` (sees everyone) or `deny` (lockdown). |
| `PI_PERSONA_SEED` | `on` | Seed bundled personas/operators into the agents dir on startup; `off` disables. |
| `PI_PERSONA_SEED_DIR` | `~/.pi/agent/agents` | Seed target + primary load dir. |

## Relationship to pi-subagents (and pi-subagents-comtac)

Strictly a companion. pi-subagents owns agent definitions, delegation, chains,
and parallel runs; **pi-subagents-comtac** owns the child↔supervisor coordination
channel (`contact_supervisor`, live `resume`) and is **needed for the async
coaching** the personas assume; this extension never reimplements either.
It only: injects the supervisor persona (Pi-core, provider-agnostic), and enforces
the persona's delegation allowlist over pi-subagents' `subagent` tool (filter its
`list` result, block out-of-list calls). It uses its own UI key (`persona`) so it
never clobbers pi-subagents' `subagent-async` widget / `subagent-slash` status.
pi-subagents is required; pi-subagents-comtac is required for live async coaching
(the bundled supervisor personas assume an async, coached fleet).

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
