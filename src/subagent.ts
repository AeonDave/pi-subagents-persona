/**
 * Pure helpers for the pi-subagents `subagent` tool bridge — no Pi imports.
 *
 * Enforcement of a persona's `delegate` allowlist happens at two points:
 *   1. tool_result of `subagent {action:"list"}` — filter the listed agents so
 *      the supervisor only SEES the allowed ones (`filterAgentListText`);
 *   2. tool_call of a delegation (`{agent}` / `{tasks:[…]}` / `{chain:[…]}`) —
 *      BLOCK the call if it targets a disallowed agent (`extractDelegationAgents`).
 *
 * Both rely only on parsing the tool's JSON input/text, so they are pure.
 */

/** Names of the management actions that are NOT delegations (don't gate them). */
const MANAGEMENT_ACTIONS = new Set([
	"list",
	"get",
	"create",
	"update",
	"delete",
	"status",
	"interrupt",
	"resume",
	"append-step",
	"doctor",
]);

function agentOf(value: unknown): string | undefined {
	if (value && typeof value === "object") {
		const a = (value as { agent?: unknown }).agent;
		if (typeof a === "string" && a.trim()) return a.trim();
	}
	return undefined;
}

/** True when the input is a `subagent` management action (e.g. `action:"list"`). */
export function isManagementAction(input: unknown): boolean {
	const action = (input as { action?: unknown })?.action;
	return typeof action === "string" && MANAGEMENT_ACTIONS.has(action);
}

export function isListAction(input: unknown): boolean {
	return (input as { action?: unknown })?.action === "list";
}

/**
 * The agent names a `subagent` tool call would delegate to, across all run
 * shapes: single `{agent}`, parallel `{tasks:[{agent}]}`, chain `{chain:[{agent}]}`.
 * Returns `[]` for management actions or inputs with no agent (deduplicated).
 */
export function extractDelegationAgents(input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	if (isManagementAction(input)) return [];
	const out = new Set<string>();
	const single = agentOf(input);
	if (single) out.add(single);
	for (const listKey of ["tasks", "chain"] as const) {
		const list = (input as Record<string, unknown>)[listKey];
		if (Array.isArray(list)) for (const item of list) {
			const a = agentOf(item);
			if (a) out.add(a);
		}
	}
	return [...out];
}

/**
 * Filter the text of a `subagent {action:"list"}` result so only allowed agents
 * remain. pi-subagents emits one agent per line as `- <name> (<source>…): <desc>`;
 * non-agent lines (headers, chain sections, blank) are preserved. `isAllowed`
 * decides per agent name.
 */
export function filterAgentListText(text: string, isAllowed: (name: string) => boolean): string {
	const lines = text.split(/\r?\n/);
	const kept: string[] = [];
	let droppedAny = false;
	for (const line of lines) {
		const m = line.match(/^\s*-\s+([a-z0-9][a-z0-9._-]*)\b/i);
		if (m && !isAllowed(m[1])) {
			droppedAny = true;
			continue;
		}
		kept.push(line);
	}
	let result = kept.join("\n");
	if (droppedAny) {
		result += "\n(Some agents are hidden by the active persona's delegate allowlist.)";
	}
	return result;
}
