# AGENTS.md

Pi companion extension to **pi-subagents**: switchable supervisor personas
(system prompt + optional model/effort + opencode-style delegation/tool
allowlists) applied to the top-level session. TypeScript, loaded by Pi via jiti
(no build step).

## Commands

```bash
npm install
npm run typecheck                 # tsc --noEmit (uses real @earendil-works/* types)
npm test                          # pure unit tests + mock-pi integration test
pi -e ./src/index.ts              # live-load in Pi for manual testing
```

## Architecture

- `src/permissions.ts` — **pure**: opencode-style `{allow?, deny?}` resolution
  (`isAllowed`/`filterAllowed`) with glob (`*`/`?`) matching. deny wins; `allow`
  present ⇒ allowlist (unlisted denied); absent block ⇒ `defaultAllow`.
- `src/persona.ts` — **pure**: a small YAML-SUBSET parser (`parseYamlSubset`:
  scalars, inline/block lists, one level of nested allow/deny maps),
  `splitFrontmatter`, `parsePersona` (→ `Persona`), and `composeSystemPrompt`
  (append/replace). The Markdown body IS the supervisor system prompt.
- `src/subagent.ts` — **pure**: bridge helpers for the pi-subagents `subagent`
  tool — `extractDelegationAgents` (single/parallel/chain shapes; management
  actions excluded), `isListAction`, `filterAgentListText` (filter the `list`
  result to allowed agents).
- `src/config.ts` — env-driven config + persona discovery/loading (`loadPersonas`
  from `~/.pi/agent/agents`, `<project>/.pi/agents`, `PI_PERSONA_DIRS`; returns
  ONLY files with `persona: true`) + `seedPersonas` (idempotent, non-destructive
  copy of the bundle into the agents dir) + last-selection persistence
  (`readLastPersona`/`writeLastPersona`/`isPersistEnabled`/`getStateFile`, a small
  `~/.pi/agent/persona/state.json` remembering the last explicit pick across restarts).
- `src/index.ts` — the factory: seed the bundle once on `session_start`, then
  `registerShortcut(f8)` + `/persona` command + `before_agent_start`
  (inject systemPrompt) + `tool_call` (block disallowed `subagent` delegations) +
  `tool_result` (filter the `list` roster) + `setStatus`/`setModel`/
  `setThinkingLevel`/`setActiveTools` on activation.

## Key invariants (do not break)

- **One marker: `persona: true`.** A file is a switchable persona iff it has
  `persona: true`; everything else in the agents dir is a plain pi-subagents agent
  (an operator) that this extension ignores for the picker but seeds for delegation.
  This package bundles only supervisor personas — they author ad-hoc subagents on the
  fly, so no generic operator ships. There is no separate `hidden` flag (it would overlap).
- **Persona = top-level supervisor identity.** Injected via
  `before_agent_start.systemPrompt`; default `append` (augments Pi's base prompt),
  `replace` only for self-complete personas. Do not reimplement pi-subagents
  delegation — only shape the supervisor + enforce its allowlist.
- **Seeding is non-destructive.** `seedPersonas` copies bundled files into the
  agents dir only when absent — never overwrites user edits. `tools`/`skills` in
  bundled files are FLAT (comma-separated) so the same file is valid as both a
  persona and a pi-subagents agent; `delegate` is nested and read only here.
- **model/thinking are optional but symmetric with tools.** When a persona
  declares model/thinking, snapshot the session baseline ONCE and apply the
  override; when a following persona omits it — or on deactivate — restore the
  snapshot (`restoreModel`/`restoreThinking`, mirroring `restoreTools`). A persona
  that declares neither never touches them. A declared model that isn't in the
  registry (or a bad thinking level) keeps the current value — no override, no
  restore.
- **Companion: never strip pi-subagents power by default.** A missing
  `tools`/`skills`/`delegate` block ⇒ allow all. With no `delegate` (or `deny`-only),
  the supervisor keeps full delegation — persona-subagents, native agents, AND
  ad-hoc subagents it authors. `delegate.allow` is OPT-IN lockdown (then the fleet
  IS that allowlist, no separate field). `delegate`'s absent-default is flippable
  to `deny` via `PI_PERSONA_DELEGATE_DEFAULT`.
- **Delegation enforced at two points.** Filter the `subagent {action:"list"}`
  tool_result (supervisor only sees allowed) AND block disallowed `subagent`
  delegations in `tool_call`. Management actions (`list`/`status`/…) are never blocked.
- **`getAllTools()` is the full registry**, `getActiveTools()` the active subset —
  restore tools via `setActiveTools(getAllTools names)`, never via the active set.
- **Distinct UI keys.** Use status key `persona`; never clobber pi-subagents'
  `subagent-async` widget / `subagent-slash` status keys.
- **Pure modules stay pure.** `permissions.ts`/`persona.ts`/`subagent.ts` import
  nothing from Pi; any change needs tests.

## Relationship to pi-claude / pi-skill-optimizer

Independent extension. It composes cleanly: persona changes the system-prompt
*content* (before_agent_start) while pi-claude's classifier-fix/billing run later
in `before_provider_request`, and pi-skill-optimizer trims the catalog — different
hooks, no conflict.

## Testing

- Pure modules: `test/permissions.test.ts`, `test/persona.test.ts`,
  `test/subagent.test.ts`.
- Wiring: `test/integration.test.ts` drives the factory with a mock `pi`/`ctx`
  (mock `getAllTools` returns the FULL registry) and asserts activation, prompt
  injection, tool restriction, delegate block/allow, and list filtering.
