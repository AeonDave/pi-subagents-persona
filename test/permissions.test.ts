import assert from "node:assert/strict";
import { test } from "node:test";
import { globToRegExp, isAllowed, type Permission } from "../src/permissions.ts";

test("globToRegExp: * and ? match, regex specials are escaped, anchored", () => {
	assert.ok(globToRegExp("code-*").test("code-reviewer"));
	assert.ok(!globToRegExp("code-*").test("xcode-reviewer"));
	assert.ok(globToRegExp("web_?").test("web_a"));
	assert.ok(!globToRegExp("web_?").test("web_ab"));
	assert.ok(globToRegExp("a.b").test("a.b"));
	assert.ok(!globToRegExp("a.b").test("axb")); // '.' is literal, not wildcard
	assert.ok(globToRegExp("*").test("anything"));
});

test("isAllowed: absent permission → defaultAllow (true by default, false on override)", () => {
	assert.equal(isAllowed("x", undefined), true);
	assert.equal(isAllowed("x", undefined, false), false); // delegate lockdown default
});

test("isAllowed: allowlist mode (allow present) denies the unlisted", () => {
	const perm: Permission = { allow: ["code-*", "scout"] };
	assert.equal(isAllowed("code-reviewer", perm), true);
	assert.equal(isAllowed("scout", perm), true);
	assert.equal(isAllowed("planner", perm), false); // not listed → denied
});

test("isAllowed: empty allow array = explicit lockdown (nothing allowed)", () => {
	assert.equal(isAllowed("anything", { allow: [] }), false);
});

test("isAllowed: denylist-only (no allow) allows everything except denied", () => {
	const perm: Permission = { deny: ["experimental-*"] };
	assert.equal(isAllowed("code-reviewer", perm), true);
	assert.equal(isAllowed("experimental-x", perm), false);
});

test("isAllowed: deny wins over allow", () => {
	const perm: Permission = { allow: ["*"], deny: ["secret-*"] };
	assert.equal(isAllowed("normal", perm), true);
	assert.equal(isAllowed("secret-agent", perm), false);
});
