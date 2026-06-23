import assert from "node:assert/strict";
import { test } from "node:test";
import { composeSystemPrompt, parsePersona, parseYamlSubset, splitFrontmatter } from "../src/persona.ts";

test("parseYamlSubset: scalars, quotes, booleans, comments", () => {
	const obj = parseYamlSubset(
		[
			"name: reviewer",
			'label: "🔍 Reviewer"   # trailing comment',
			"hidden: true",
			"# full-line comment",
			"thinking: high",
		].join("\n"),
	);
	assert.equal(obj.name, "reviewer");
	assert.equal(obj.label, "🔍 Reviewer");
	assert.equal(obj.hidden, true);
	assert.equal(obj.thinking, "high");
});

test("parseYamlSubset: inline and block lists", () => {
	const inline = parseYamlSubset("skills: [a, b, c]");
	assert.deepEqual(inline.skills, ["a", "b", "c"]);
	const block = parseYamlSubset(["skills:", "  - a", "  - b", "  - c"].join("\n"));
	assert.deepEqual(block.skills, ["a", "b", "c"]);
	assert.deepEqual(parseYamlSubset("empty: []").empty, []);
});

test("parseYamlSubset: nested maps with allow/deny (inline and block)", () => {
	const obj = parseYamlSubset(
		["delegate:", '  allow: ["code-*", "scout"]', "  deny: [experimental-*]", "tools:", "  allow:", "    - read", "    - bash"].join("\n"),
	);
	assert.deepEqual(obj.delegate, { allow: ["code-*", "scout"], deny: ["experimental-*"] });
	assert.deepEqual(obj.tools, { allow: ["read", "bash"] });
});

test("splitFrontmatter separates frontmatter and body; no frontmatter → all body", () => {
	const fm = splitFrontmatter("---\nname: x\n---\nHello body\nline2");
	assert.equal(fm.frontmatter, "name: x");
	assert.equal(fm.body, "Hello body\nline2");
	const none = splitFrontmatter("just a body");
	assert.equal(none.frontmatter, "");
	assert.equal(none.body, "just a body");
});

test("parsePersona: full persona with defaults and permissions", () => {
	const persona = parsePersona(
		[
			"---",
			"name: reviewer",
			'label: "🔍 Reviewer"',
			"persona: true",
			"model: claude-pro-max-native/claude-opus-4-8",
			"thinking: high",
			"delegate:",
			'  allow: ["code-*"]',
			"tools:",
			'  allow: ["read", "bash"]',
			"skills: [code-review]",
			"---",
			"You are the Reviewer.",
		].join("\n"),
		"/x/reviewer.md",
	);
	assert.ok(persona);
	assert.equal(persona?.name, "reviewer");
	assert.equal(persona?.label, "🔍 Reviewer");
	assert.equal(persona?.isPersona, true);
	assert.equal(persona?.model, "claude-pro-max-native/claude-opus-4-8");
	assert.equal(persona?.thinking, "high");
	assert.equal(persona?.systemPromptMode, "append"); // default
	assert.deepEqual(persona?.delegate, { allow: ["code-*"] });
	assert.deepEqual(persona?.tools, { allow: ["read", "bash"] });
	assert.deepEqual(persona?.skills, { allow: ["code-review"] });
	assert.equal(persona?.body, "You are the Reviewer.");
});

test("parsePersona: preserves intentional whitespace inside labels", () => {
	const persona = parsePersona(["---", "name: spaced", 'label: " spaced"', "persona: true", "---", "Body."].join("\n"), "/x/spaced.md");
	assert.equal(persona?.label, " spaced");
});

test("parsePersona: optional model/thinking omitted → undefined; isPersona defaults false", () => {
	const persona = parsePersona(["---", "name: planner", "---", "Body."].join("\n"), "/x/planner.md");
	assert.equal(persona?.model, undefined);
	assert.equal(persona?.thinking, undefined);
	assert.equal(persona?.isPersona, false); // no `persona: true` marker → not a persona
	assert.equal(persona?.delegate, undefined); // absent → no restriction (handled by isAllowed default)
});

test("parsePersona: missing name → null", () => {
	assert.equal(parsePersona("---\nlabel: x\n---\nbody", "/x/no-name.md"), null);
});

test("parsePersona: shorthand list as a permission's allow list", () => {
	const persona = parsePersona(["---", "name: p", "delegate: [a, b]", "---", "x"].join("\n"), "/x/p.md");
	assert.deepEqual(persona?.delegate, { allow: ["a", "b"] });
});

test("composeSystemPrompt: append vs replace", () => {
	const base = "BASE PROMPT";
	const append = { systemPromptMode: "append", body: "PERSONA" } as never;
	const replace = { systemPromptMode: "replace", body: "PERSONA" } as never;
	assert.equal(composeSystemPrompt(base, append), "BASE PROMPT\n\nPERSONA");
	assert.equal(composeSystemPrompt(base, replace), "PERSONA");
});
