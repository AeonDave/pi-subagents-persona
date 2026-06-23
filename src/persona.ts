/**
 * Pure persona parsing — no Pi imports, unit-tested.
 *
 * A persona file is Markdown with YAML-ish frontmatter and a body. The body is
 * the SUPERVISOR system prompt; the frontmatter configures the persona. Example:
 *
 *   ---
 *   name: reviewer
 *   label: "🔍 Reviewer"
 *   persona: true                     # marks this file as a switchable persona
 *   # model / thinking optional — if present they are applied, else the user/
 *   # supervisor keeps its own choice.
 *   model: claude-pro-max-native/claude-opus-4-8
 *   thinking: high
 *   systemPromptMode: append          # append (default) | replace
 *   delegate:                         # which subagents this persona may launch
 *     allow: ["code-*", "scout"]      #   absent block → allow all ("sees everyone")
 *     deny:  ["experimental-*"]
 *   tools:                            # supervisor's active tools (absent → all)
 *     allow: ["read", "grep", "bash", "subagent", "web_*"]   # include `subagent` to keep delegation!
 *   skills: [code-review]             # advisory skill scope (absent → all)
 *   ---
 *   You are the Reviewer: ...
 *
 * The frontmatter parser is a small, purpose-built YAML SUBSET: top-level
 * `key: value` scalars, inline `[a, b]` and block (`- a`) lists, and one level of
 * nested maps (for `delegate`/`tools` allow/deny). It is NOT a full YAML engine.
 */

import type { Permission } from "./permissions.ts";

export type SystemPromptMode = "append" | "replace";

export interface Persona {
	name: string;
	label: string;
	/** `persona: true` marks a file as a switchable supervisor persona. Files
	 *  without it are ignored by this extension (they may be plain pi-subagents
	 *  agents living in the same directory). */
	isPersona: boolean;
	model?: string;
	thinking?: string;
	systemPromptMode: SystemPromptMode;
	delegate?: Permission;
	tools?: Permission;
	skills?: Permission;
	/** The Markdown body — the supervisor system prompt. */
	body: string;
	/** Where the persona was loaded from (file path), for diagnostics. */
	source: string;
}

// --------------------------------------------------------------------------
// Minimal YAML-subset parser
// --------------------------------------------------------------------------

/** Strip a trailing `# comment` that is not inside quotes. */
function stripComment(line: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === "'" && !inDouble) inSingle = !inSingle;
		else if (c === '"' && !inSingle) inDouble = !inDouble;
		else if (c === "#" && !inSingle && !inDouble && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
			return line.slice(0, i);
		}
	}
	return line;
}

function unquote(value: string): string {
	const v = value.trim();
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
		return v.slice(1, -1);
	}
	return v;
}

/** Parse a scalar or inline list (`[a, "b", c]`). Returns string | string[] | boolean. */
function parseValue(raw: string): string | string[] | boolean {
	const v = raw.trim();
	if (v.startsWith("[") && v.endsWith("]")) {
		const inner = v.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((s) => unquote(s)).filter((s) => s.length > 0);
	}
	if (v === "true") return true;
	if (v === "false") return false;
	return unquote(v);
}

interface Frame {
	indent: number;
	container: Record<string, unknown>;
	/** When this frame was opened by `key:` with no value, the parent + key so a
	 *  following `- item` line can convert it to an array. */
	selfKey?: string;
	parent?: Record<string, unknown>;
	listArr?: unknown[];
}

/** Parse the YAML subset (see module doc) into a plain object. */
export function parseYamlSubset(src: string): Record<string, unknown> {
	const root: Record<string, unknown> = {};
	const stack: Frame[] = [{ indent: -1, container: root }];

	for (const rawLine of src.split(/\r?\n/)) {
		const line = stripComment(rawLine);
		if (line.trim() === "") continue;
		const indent = line.length - line.trimStart().length;
		const content = line.trim();

		while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
		const top = stack[stack.length - 1];

		if (content.startsWith("- ") || content === "-") {
			// Block list item under the current `key:` frame.
			const itemRaw = content === "-" ? "" : content.slice(2);
			if (!top.listArr) {
				top.listArr = [];
				if (top.parent && top.selfKey) top.parent[top.selfKey] = top.listArr;
			}
			top.listArr.push(parseValue(itemRaw));
			continue;
		}

		const colon = content.indexOf(":");
		if (colon < 0) continue; // not a key line — ignore
		const key = content.slice(0, colon).trim();
		const rest = content.slice(colon + 1).trim();

		if (rest === "") {
			// Open a nested container (map by default; becomes a list if `- ` follows).
			const child: Record<string, unknown> = {};
			top.container[key] = child;
			stack.push({ indent, container: child, selfKey: key, parent: top.container });
		} else {
			top.container[key] = parseValue(rest);
		}
	}

	return root;
}

// --------------------------------------------------------------------------
// Persona mapping
// --------------------------------------------------------------------------

function asStringArray(value: unknown): string[] | undefined {
	if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.length > 0);
	if (typeof value === "string" && value.trim().length > 0) {
		// tolerate a comma-separated scalar (pi-subagents style)
		return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
	}
	return undefined;
}

function asPermission(value: unknown): Permission | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		// A bare list/scalar is treated as the allow list (shorthand).
		const allow = asStringArray(value);
		return allow ? { allow } : undefined;
	}
	const obj = value as Record<string, unknown>;
	const allow = asStringArray(obj.allow);
	const deny = asStringArray(obj.deny);
	if (allow === undefined && deny === undefined) return undefined;
	const perm: Permission = {};
	if (allow !== undefined) perm.allow = allow;
	if (deny !== undefined) perm.deny = deny;
	return perm;
}

/** Split `---\nfrontmatter\n---\nbody`. Missing frontmatter → all body. */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const normalized = content.replace(/^﻿/, "");
	const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
	if (!match) return { frontmatter: "", body: normalized.trim() };
	return { frontmatter: match[1], body: match[2].trim() };
}

/**
 * Parse a persona file into a `Persona`, or `null` when it has no `name`
 * (required). Unknown frontmatter keys are ignored. `systemPromptMode` defaults
 * to `append` (safe: persona text augments Pi's base prompt rather than
 * replacing it). `isPersona` is true only when the frontmatter has `persona:
 * true`; files without it are plain agents the caller ignores.
 */
export function parsePersona(content: string, source: string): Persona | null {
	const { frontmatter, body } = splitFrontmatter(content);
	const fm = parseYamlSubset(frontmatter);
	const name = typeof fm.name === "string" ? fm.name.trim() : "";
	if (!name) return null;

	const mode = fm.systemPromptMode === "replace" ? "replace" : "append";
	const label = typeof fm.label === "string" && fm.label.trim() ? fm.label : name;
	const model = typeof fm.model === "string" && fm.model.trim() ? fm.model.trim() : undefined;
	const thinking = typeof fm.thinking === "string" && fm.thinking.trim() ? fm.thinking.trim() : undefined;

	return {
		name,
		label,
		isPersona: fm.persona === true,
		model,
		thinking,
		systemPromptMode: mode,
		delegate: asPermission(fm.delegate),
		tools: asPermission(fm.tools),
		skills: asPermission(fm.skills),
		body,
		source,
	};
}

/** Compose the system prompt for a turn given the base prompt and a persona. */
export function composeSystemPrompt(basePrompt: string, persona: Persona): string {
	if (persona.systemPromptMode === "replace") return persona.body;
	if (!persona.body.trim()) return basePrompt;
	return `${basePrompt}\n\n${persona.body}`;
}
