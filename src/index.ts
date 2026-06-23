/**
 * pi-subagents-persona — switchable SUPERVISOR personas for Pi, companion to
 * pi-subagents.
 *
 * A persona is applied to the TOP-LEVEL session (you talk to Pi and Pi *is* the
 * supervisor), and switching it (a key or `/persona`) swaps:
 *   - the supervisor system prompt (injected at `before_agent_start`);
 *   - optionally the model and thinking level (only if the persona specifies them);
 *   - the active tool set (when the persona declares a `tools` allowlist);
 *   - the delegation allowlist — which pi-subagents agents this persona may
 *     launch — enforced by filtering `subagent {action:"list"}` results AND
 *     blocking disallowed `subagent` delegations.
 *
 * It does NOT reimplement delegation: pi-subagents still runs the subagents. The
 * persona only shapes who the supervisor is and what fleet/model/tools it has.
 * Pi core has no native persona concept, so this is synthesized from documented
 * primitives (before_agent_start systemPrompt, setStatus, setModel,
 * setThinkingLevel, setActiveTools, tool_call/tool_result, registerShortcut).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
	getAgentsDir,
	getDefaultPersonaName,
	getDelegateDefaultAllow,
	getKeybinding,
	getPersonaDirs,
	isDisabled,
	isSeedEnabled,
	loadPersonas,
	seedPersonas,
} from "./config.ts";
import { composeSystemPrompt, type Persona } from "./persona.ts";
import { isAllowed } from "./permissions.ts";
import { extractDelegationAgents, filterAgentListText, isListAction } from "./subagent.ts";

const STATUS_KEY = "persona";
const VALID_THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
/** The plugin's bundled personas dir (`<plugin>/personas`), seeded on startup. */
const BUNDLED_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "personas");

export default function subagentsPersona(pi: ExtensionAPI) {
	if (isDisabled()) return;

	let personas: Persona[] = [];
	let active: Persona | undefined;
	let toolsRestricted = false;
	let seeded = false;
	const delegateDefaultAllow = getDelegateDefaultAllow();

	// All loaded entries are personas (loadPersonas already filters to `persona: true`).
	const pickable = () => personas;
	const find = (name: string) => personas.find((p) => p.name === name || p.label === name);

	function setStatus(ctx: ExtensionContext, text: string | undefined): void {
		try {
			ctx.ui.setStatus(STATUS_KEY, text);
		} catch {
			// cosmetic
		}
	}

	function allToolNames(): string[] {
		try {
			return pi.getAllTools().map((t) => t.name);
		} catch {
			return [];
		}
	}

	/** Apply a persona's side effects (status, optional model/thinking, tools). */
	async function applyPersona(persona: Persona, ctx: ExtensionContext): Promise<void> {
		setStatus(ctx, persona.label);

		if (persona.model) {
			const model = ctx.modelRegistry
				.getAll()
				.find((m: Model<any>) => `${m.provider}/${m.id}` === persona.model || m.id === persona.model);
			if (model) {
				try {
					await pi.setModel(model);
				} catch {
					// keep current model on failure
				}
			} else {
				try {
					ctx.ui.notify(`persona ${persona.name}: model "${persona.model}" not found — keeping current`, "warning");
				} catch {
					/* ignore */
				}
			}
		}

		if (persona.thinking && VALID_THINKING.has(persona.thinking)) {
			try {
				pi.setThinkingLevel(persona.thinking as Parameters<ExtensionAPI["setThinkingLevel"]>[0]);
			} catch {
				/* clamped/ignored */
			}
		}

		// Tools: restrict when the persona declares an allowlist; restore all when
		// a non-restricting persona follows a restricting one.
		if (persona.tools) {
			const names = allToolNames();
			const allowed = names.filter((n) => isAllowed(n, persona.tools));
			try {
				pi.setActiveTools(allowed);
				toolsRestricted = true;
			} catch {
				/* ignore */
			}
		} else if (toolsRestricted) {
			try {
				pi.setActiveTools(allToolNames());
			} catch {
				/* ignore */
			}
			toolsRestricted = false;
		}
	}

	async function activate(persona: Persona, ctx: ExtensionContext): Promise<void> {
		active = persona;
		await applyPersona(persona, ctx);
	}

	async function deactivate(ctx: ExtensionContext): Promise<void> {
		active = undefined;
		setStatus(ctx, undefined);
		if (toolsRestricted) {
			try {
				pi.setActiveTools(allToolNames());
			} catch {
				/* ignore */
			}
			toolsRestricted = false;
		}
	}

	function reload(cwd: string): string[] {
		const { personas: loaded, errors } = loadPersonas(getPersonaDirs(cwd));
		personas = loaded;
		return errors;
	}

	pi.on("session_start", async (_event, ctx) => {
		// Seed bundled personas into the Pi agents dir once per process (idempotent;
		// never overwrites existing files), so pi-subagents can discover/launch them.
		if (!seeded && isSeedEnabled()) {
			seeded = true;
			seedPersonas(BUNDLED_DIR, getAgentsDir());
		}
		const previousActiveName = active?.name;
		reload(ctx.cwd);
		const wanted = getDefaultPersonaName();
		const target = wanted ? find(wanted) : previousActiveName ? find(previousActiveName) : undefined;
		if (target) await activate(target, ctx);
		else if (previousActiveName) await deactivate(ctx);
		else setStatus(ctx, active?.label);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		setStatus(ctx, undefined);
	});

	// Inject the supervisor persona into the system prompt for the turn.
	pi.on("before_agent_start", (event, _ctx) => {
		if (!active) return;
		return { systemPrompt: composeSystemPrompt(event.systemPrompt, active) };
	});

	// Block tool calls outside the persona's tool allowlist, then block
	// subagent delegations outside the persona's delegate allowlist.
	pi.on("tool_call", (event, _ctx) => {
		if (!active) return;
		if (active.tools && !isAllowed(event.toolName, active.tools)) {
			return {
				block: true,
				reason: `Persona "${active.label}" may not use tool: ${event.toolName}. Allowed tools are restricted by this persona's tool allowlist.`,
			};
		}
		if (event.toolName !== "subagent") return;
		const targets = extractDelegationAgents(event.input);
		const blocked = targets.filter((name) => !isAllowed(name, active!.delegate, delegateDefaultAllow));
		if (blocked.length > 0) {
			return {
				block: true,
				reason: `Persona "${active!.label}" may not delegate to: ${blocked.join(", ")}. Allowed agents are restricted by this persona's delegate allowlist.`,
			};
		}
	});

	// Filter the subagent roster the supervisor sees to the allowed agents.
	pi.on("tool_result", (event, _ctx) => {
		if (!active || event.toolName !== "subagent" || !isListAction(event.input)) return;
		if (!active.delegate && delegateDefaultAllow) return; // no restriction → nothing to filter
		const allow = (name: string) => isAllowed(name, active!.delegate, delegateDefaultAllow);
		const content = event.content.map((block) =>
			block.type === "text" ? { ...block, text: filterAgentListText(block.text, allow) } : block,
		);
		return { content };
	});

	pi.registerShortcut(getKeybinding() as Parameters<ExtensionAPI["registerShortcut"]>[0], {
		description: "Cycle persona (pi-subagents-persona)",
		handler: async (ctx) => {
			const list = pickable();
			if (list.length === 0) {
				setStatus(ctx, undefined);
				return;
			}
			const idx = active ? list.findIndex((p) => p.name === active!.name) : -1;
			await activate(list[(idx + 1) % list.length], ctx);
		},
	});

	pi.registerCommand("persona", {
		description: "Switch the active supervisor persona: /persona [name|off|list|reload]",
		handler: async (args, ctx) => {
			const arg = args.trim();
			if (arg === "off" || arg === "none") {
				await deactivate(ctx);
				ctx.ui.notify("persona: cleared (default supervisor)", "info");
				return;
			}
			if (arg === "reload") {
				const previousActiveName = active?.name;
				const errors = reload(ctx.cwd);
				if (previousActiveName) {
					const refreshed = find(previousActiveName);
					if (refreshed) await activate(refreshed, ctx);
					else await deactivate(ctx);
				}
				ctx.ui.notify(
					`persona: reloaded ${personas.length} personas${errors.length ? ` (${errors.length} skipped)` : ""}`,
					errors.length ? "warning" : "info",
				);
				return;
			}
			if (arg === "list" || arg === "") {
				const list = pickable();
				if (arg === "list" || !ctx.hasUI) {
					const lines = list.map((p) => `${p.name === active?.name ? "▶ " : "  "}${p.label} (${p.name})`);
					ctx.ui.notify(
						[`Personas (active: ${active?.label ?? "none"}):`, ...lines, "", "Switch: /persona <name> | clear: /persona off"].join("\n"),
						"info",
					);
					return;
				}
				const choice = await ctx.ui.select("Select persona", list.map((p) => p.label));
				if (!choice) return;
				const chosen = list.find((p) => p.label === choice);
				if (chosen) await activate(chosen, ctx);
				return;
			}
			const persona = find(arg);
			if (!persona) {
				ctx.ui.notify(`persona: "${arg}" not found. Try /persona list`, "error");
				return;
			}
			await activate(persona, ctx);
			ctx.ui.notify(`persona: ${persona.label} active`, "info");
		},
	});
}
