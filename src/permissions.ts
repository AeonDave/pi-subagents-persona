/**
 * Pure opencode-style allow/deny permission resolution — no Pi imports, testable.
 *
 * A `Permission` is `{ allow?: string[]; deny?: string[] }` of glob patterns
 * (`*` = any run of chars, `?` = one char). Semantics, by design:
 *
 *   - deny wins: if a name matches any `deny` pattern → denied.
 *   - allowlist mode: if `allow` is PRESENT (an array, even empty) → a name is
 *     allowed only if it matches an `allow` pattern; unlisted → denied.
 *   - denylist mode: if `allow` is ABSENT but `deny` is present → allowed unless
 *     denied.
 *   - absent block: a missing/undefined Permission → allowed (default-allow), or
 *     the caller's `defaultAllow` override (used by `delegate`, which can be
 *     flipped to default-deny via config).
 *
 * `allow: ["*"]` = allow everything (with optional `deny` exceptions).
 * `allow: []`   = explicit lockdown (nothing allowed) — distinct from absent.
 */

export interface Permission {
	allow?: string[];
	deny?: string[];
}

/** Compile a glob (`*`, `?`) to an anchored, case-sensitive RegExp. */
export function globToRegExp(pattern: string): RegExp {
	let out = "^";
	for (const ch of pattern) {
		if (ch === "*") out += ".*";
		else if (ch === "?") out += ".";
		else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`${out}$`);
}

function matchesAny(name: string, patterns: readonly string[] | undefined): boolean {
	if (!patterns || patterns.length === 0) return false;
	return patterns.some((p) => globToRegExp(p).test(name));
}

/**
 * Is `name` allowed by `perm`? When `perm` is undefined, returns `defaultAllow`
 * (true unless the caller — e.g. `delegate` under a deny-default config — passes
 * false).
 */
export function isAllowed(name: string, perm: Permission | undefined, defaultAllow = true): boolean {
	if (!perm) return defaultAllow;
	if (matchesAny(name, perm.deny)) return false; // deny wins
	if (perm.allow !== undefined) return matchesAny(name, perm.allow); // allowlist mode
	return true; // denylist-only (allow not specified) → allow unless denied above
}
