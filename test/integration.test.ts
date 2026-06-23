import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import subagentsPersona from "../src/index.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");

/** Point loading at the fixtures dir only, and never seed during tests. */
function setupEnv(defaultPersona?: string, seedDir = FIXTURES) {
	process.env.PI_PERSONA_SEED = "off";
	process.env.PI_PERSONA_SEED_DIR = seedDir; // getPersonaDirs[0] = fixtures/override
	delete process.env.PI_PERSONA_DIRS;
	delete process.env.PI_PERSONA_DISABLE;
	delete process.env.PI_PERSONA_DELEGATE_DEFAULT;
	if (defaultPersona) process.env.PI_PERSONA_DEFAULT = defaultPersona;
	else delete process.env.PI_PERSONA_DEFAULT;
}

/** Minimal mock of the bits of ExtensionAPI/ExtensionContext the factory uses. */
function makeHarness() {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	const allTools = ["read", "grep", "bash", "subagent", "web_search", "experimental_tool"];
	let activeTools = [...allTools];
	const statuses: Record<string, string | undefined> = {};
	const notes: string[] = [];
	let thinking = "medium";
	let model = { provider: "x", id: "base" };
	const commands = new Map<string, (args: string, ctx: any) => any>();
	const shortcuts: unknown[] = [];

	const pi = {
		on: (event: string, handler: (e: any, c: any) => any) => handlers.set(event, handler),
		registerShortcut: (...args: unknown[]) => { shortcuts.push(args); },
		registerCommand: (name: string, opts: { handler: (args: string, ctx: any) => any }) => commands.set(name, opts.handler),
		getAllTools: () => allTools.map((name) => ({ name })),
		setActiveTools: (names: string[]) => { activeTools = names; },
		setModel: async (m: any) => { model = m; return true; },
		setThinkingLevel: (l: string) => { thinking = l; },
	} as any;

	const ctx = {
		cwd: join(FIXTURES, "no-project"), // <cwd>/.pi/agents won't exist
		hasUI: false,
		ui: {
			setStatus: (k: string, t: string | undefined) => { statuses[k] = t; },
			notify: (m: string) => { notes.push(m); },
			select: async () => undefined,
		},
		modelRegistry: { getAll: () => [{ provider: "claude-pro-max-native", id: "claude-opus-4-8" }] },
	} as any;

	subagentsPersona(pi);
	return {
		fire: (event: string, e: any) => handlers.get(event)?.(e, ctx),
		runCommand: (args: string) => commands.get("persona")?.(args, ctx),
		get state() { return { activeTools, statuses, notes, thinking, model, commandCount: commands.size, shortcutCount: shortcuts.length }; },
	};
}

test("default persona activates: injects prompt, restricts tools, sets status", async () => {
	setupEnv("locked");
	const h = makeHarness();
	await h.fire("session_start", { type: "session_start", reason: "startup" });

	assert.equal(h.state.statuses.persona, "🔒 Locked");
	assert.ok(h.state.activeTools.includes("read"));
	assert.ok(!h.state.activeTools.includes("experimental_tool")); // locked tools allowlist

	const res = h.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "BASE", prompt: "x", systemPromptOptions: {} });
	assert.ok(res?.systemPrompt?.startsWith("BASE\n\n"));
	assert.ok(res.systemPrompt.includes("You are Locked supervisor"));
});

test("delegate allowlist blocks the unlisted, allows the listed, never blocks management", async () => {
	setupEnv("locked"); // delegate.allow = [worker, scout]
	const h = makeHarness();
	await h.fire("session_start", { type: "session_start", reason: "startup" });

	const blocked = h.fire("tool_call", { type: "tool_call", toolName: "subagent", toolCallId: "1", input: { agent: "planner", task: "x" } });
	assert.equal(blocked?.block, true);
	assert.match(blocked.reason, /may not delegate to: planner/);

	assert.equal(h.fire("tool_call", { type: "tool_call", toolName: "subagent", toolCallId: "2", input: { agent: "scout", task: "x" } }), undefined);
	assert.equal(h.fire("tool_call", { type: "tool_call", toolName: "subagent", toolCallId: "3", input: { action: "list" } }), undefined);
});

test("tool allowlist blocks disallowed tool calls defensively", async () => {
	setupEnv("locked");
	const h = makeHarness();
	await h.fire("session_start", { type: "session_start", reason: "startup" });

	const blocked = h.fire("tool_call", { type: "tool_call", toolName: "experimental_tool", toolCallId: "x", input: {} });
	assert.equal(blocked?.block, true);
	assert.match(blocked.reason, /may not use tool: experimental_tool/);
	assert.equal(h.fire("tool_call", { type: "tool_call", toolName: "read", toolCallId: "r", input: {} }), undefined);
});

test("tool_result of action:list is filtered to the allowed agents", async () => {
	setupEnv("locked");
	const h = makeHarness();
	await h.fire("session_start", { type: "session_start", reason: "startup" });

	const res = h.fire("tool_result", {
		type: "tool_result",
		toolName: "subagent",
		input: { action: "list" },
		content: [{ type: "text", text: "Executable agents:\n- scout (builtin): x\n- planner (user): y\n- worker (user): z" }],
		isError: false,
	});
	const text = res.content[0].text;
	assert.ok(text.includes("- scout") && text.includes("- worker"));
	assert.ok(!text.includes("planner"));
});

test("/persona off clears persona and restores tools", async () => {
	setupEnv("locked");
	const h = makeHarness();
	await h.fire("session_start", { type: "session_start", reason: "startup" });
	assert.equal(h.state.statuses.persona, "🔒 Locked");

	await h.runCommand("off");
	assert.equal(h.state.statuses.persona, undefined);
	assert.ok(h.state.activeTools.includes("experimental_tool")); // restored to full set
	assert.equal(h.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "BASE", prompt: "x", systemPromptOptions: {} }), undefined);
});

test("a free persona (no delegate block) keeps full delegation power", async () => {
	setupEnv("free");
	const h = makeHarness();
	await h.fire("session_start", { type: "session_start", reason: "startup" });
	// no tools block → nothing restricted
	assert.ok(h.state.activeTools.includes("experimental_tool"));
	// any delegation (native, ad-hoc, persona-subagent) is allowed
	assert.equal(h.fire("tool_call", { type: "tool_call", toolName: "subagent", toolCallId: "1", input: { agent: "any-native-or-adhoc", task: "x" } }), undefined);
});

test("PI_PERSONA_DELEGATE_DEFAULT=deny locks down personas with no delegate block", async () => {
	setupEnv("free");
	process.env.PI_PERSONA_DELEGATE_DEFAULT = "deny";
	const h = makeHarness();
	await h.fire("session_start", { type: "session_start", reason: "startup" });

	const blocked = h.fire("tool_call", { type: "tool_call", toolName: "subagent", toolCallId: "1", input: { agent: "scout", task: "x" } });
	assert.equal(blocked?.block, true);
	assert.match(blocked.reason, /may not delegate to: scout/);

	const res = h.fire("tool_result", {
		type: "tool_result",
		toolName: "subagent",
		input: { action: "list" },
		content: [{ type: "text", text: "Executable agents:\n- scout (builtin): x\n- worker (user): z" }],
		isError: false,
	});
	assert.ok(!res.content[0].text.includes("- scout"));
	assert.ok(!res.content[0].text.includes("- worker"));
	assert.ok(res.content[0].text.includes("hidden by the active persona"));
	delete process.env.PI_PERSONA_DELEGATE_DEFAULT;
});

test("/persona reload reapplies the active persona from disk", async () => {
	const dir = mkdtempSync(join(tmpdir(), "persona-reload-"));
	try {
		writeFileSync(
			join(dir, "locked.md"),
			[
				"---",
				"name: locked",
				'label: "Locked One"',
				"persona: true",
				"tools:",
				'  allow: ["read"]',
				"delegate:",
				'  allow: ["worker"]',
				"---",
				"Version one prompt.",
			].join("\n"),
		);
		setupEnv("locked", dir);
		const h = makeHarness();
		await h.fire("session_start", { type: "session_start", reason: "startup" });
		assert.equal(h.state.statuses.persona, "Locked One");
		assert.deepEqual(h.state.activeTools, ["read"]);

		writeFileSync(
			join(dir, "locked.md"),
			[
				"---",
				"name: locked",
				'label: "Locked Two"',
				"persona: true",
				"tools:",
				'  allow: ["bash", "subagent"]',
				"delegate:",
				'  allow: ["scout"]',
				"---",
				"Version two prompt.",
			].join("\n"),
		);

		await h.runCommand("reload");
		assert.equal(h.state.statuses.persona, "Locked Two");
		assert.deepEqual(h.state.activeTools, ["bash", "subagent"]);
		const prompt = h.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "BASE", prompt: "x", systemPromptOptions: {} });
		assert.ok(prompt.systemPrompt.includes("Version two prompt."));
		assert.ok(!prompt.systemPrompt.includes("Version one prompt."));
		assert.equal(h.fire("tool_call", { type: "tool_call", toolName: "subagent", toolCallId: "1", input: { agent: "scout", task: "x" } }), undefined);
		assert.equal(h.fire("tool_call", { type: "tool_call", toolName: "subagent", toolCallId: "2", input: { agent: "worker", task: "x" } })?.block, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("/persona reload deactivates cleanly when the active persona disappears", async () => {
	const dir = mkdtempSync(join(tmpdir(), "persona-reload-missing-"));
	try {
		const file = join(dir, "locked.md");
		writeFileSync(
			file,
			[
				"---",
				"name: locked",
				'label: "Locked"',
				"persona: true",
				"tools:",
				'  allow: ["read"]',
				"---",
				"Prompt.",
			].join("\n"),
		);
		setupEnv("locked", dir);
		const h = makeHarness();
		await h.fire("session_start", { type: "session_start", reason: "startup" });
		assert.deepEqual(h.state.activeTools, ["read"]);

		rmSync(file);
		await h.runCommand("reload");
		assert.equal(h.state.statuses.persona, undefined);
		assert.ok(h.state.activeTools.includes("experimental_tool"));
		assert.equal(h.fire("before_agent_start", { type: "before_agent_start", systemPrompt: "BASE", prompt: "x", systemPromptOptions: {} }), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("PI_PERSONA_DISABLE prevents registering persona controls", async () => {
	setupEnv("locked");
	process.env.PI_PERSONA_DISABLE = "1";
	const h = makeHarness();
	assert.equal(h.state.commandCount, 0);
	assert.equal(h.state.shortcutCount, 0);
	await h.fire("session_start", { type: "session_start", reason: "startup" });
	assert.equal(h.state.statuses.persona, undefined);
	assert.ok(h.state.activeTools.includes("experimental_tool"));
	delete process.env.PI_PERSONA_DISABLE;
});

test("an operator file (no persona:true) is not loaded as a persona", async () => {
	setupEnv();
	const h = makeHarness();
	await h.fire("session_start", { type: "session_start", reason: "startup" });
	await h.runCommand("op"); // 'op' fixture has no persona:true
	assert.equal(h.state.statuses.persona, undefined);
});
