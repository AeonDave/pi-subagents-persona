import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { seedPersonas } from "../src/config.ts";

test("seedPersonas copies missing files and never overwrites existing ones", () => {
	const root = mkdtempSync(join(tmpdir(), "persona-seed-"));
	const bundled = join(root, "bundled");
	const target = join(root, "target");
	try {
		mkdirSync(bundled, { recursive: true });
		mkdirSync(target, { recursive: true });
		writeFileSync(join(bundled, "a.md"), "BUNDLED A");
		writeFileSync(join(bundled, "b.md"), "BUNDLED B");
		writeFileSync(join(bundled, "notes.txt"), "ignored"); // non-.md ignored
		writeFileSync(join(target, "b.md"), "USER B"); // pre-existing → must not be overwritten

		const res = seedPersonas(bundled, target);

		assert.deepEqual(res.copied.sort(), ["a.md"]);
		assert.deepEqual(res.skipped.sort(), ["b.md"]);
		assert.equal(res.errors.length, 0);
		assert.equal(readFileSync(join(target, "a.md"), "utf8"), "BUNDLED A"); // copied
		assert.equal(readFileSync(join(target, "b.md"), "utf8"), "USER B"); // preserved
		assert.ok(!existsSync(join(target, "notes.txt"))); // non-md skipped
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("seedPersonas on a missing bundle dir is a safe no-op", () => {
	const res = seedPersonas(join(tmpdir(), "does-not-exist-persona-bundle"), join(tmpdir(), "irrelevant-target"));
	assert.deepEqual(res, { copied: [], skipped: [], errors: [] });
});
