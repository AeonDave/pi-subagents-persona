import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDelegationAgents, filterAgentListText, isListAction, isManagementAction } from "../src/subagent.ts";

test("extractDelegationAgents: single / parallel / chain shapes, deduped", () => {
	assert.deepEqual(extractDelegationAgents({ agent: "scout", task: "x" }), ["scout"]);
	assert.deepEqual(
		extractDelegationAgents({ tasks: [{ agent: "scout" }, { agent: "tester" }, { agent: "scout" }] }),
		["scout", "tester"],
	);
	assert.deepEqual(extractDelegationAgents({ chain: [{ agent: "planner" }, { agent: "worker" }] }), ["planner", "worker"]);
});

test("extractDelegationAgents: management actions are not delegations", () => {
	assert.deepEqual(extractDelegationAgents({ action: "list" }), []);
	assert.deepEqual(extractDelegationAgents({ action: "status", id: "r1" }), []);
	assert.deepEqual(extractDelegationAgents({}), []);
	assert.deepEqual(extractDelegationAgents(undefined), []);
});

test("isManagementAction / isListAction", () => {
	assert.equal(isManagementAction({ action: "list" }), true);
	assert.equal(isManagementAction({ action: "resume" }), true);
	assert.equal(isManagementAction({ agent: "scout" }), false);
	assert.equal(isListAction({ action: "list" }), true);
	assert.equal(isListAction({ action: "status" }), false);
});

test("filterAgentListText: drops disallowed agent lines, keeps headers/others", () => {
	const text = [
		"Executable agents:",
		"- qa_worker (user): test agent",
		"- scout (builtin): scout the repo",
		"- planner (user): plan work",
		"- experimental-x (project): danger",
		"",
		"Chains:",
		"- review-loop: ...",
	].join("\n");
	const allow = (n: string) => n === "scout" || n === "review-loop";
	const out = filterAgentListText(text, allow);
	assert.ok(out.includes("- scout (builtin)"));
	assert.ok(!out.includes("qa_worker"));
	assert.ok(!out.includes("planner (user)"));
	assert.ok(!out.includes("experimental-x"));
	assert.ok(out.includes("Executable agents:")); // header kept
	assert.ok(out.includes("- review-loop")); // allowed chain kept
	assert.ok(out.includes("hidden by the active persona")); // note appended
});

test("filterAgentListText: nothing dropped → no note appended", () => {
	const text = "Executable agents:\n- scout (builtin): x";
	const out = filterAgentListText(text, () => true);
	assert.equal(out, text);
});
