/**
 * Environment-driven config + persona discovery for pi-subagents-persona.
 *
 * | Env var | Default | Purpose |
 * |---------|---------|---------|
 * | `PI_PERSONA_DISABLE`          | _(off)_       | Any non-empty value disables the extension. |
 * | `PI_PERSONA_DIRS`             | _(see below)_ | Extra persona dirs (`;` or `,` separated), highest priority. |
 * | `PI_PERSONA_DEFAULT`          | _(none)_      | Persona name to activate on session start. |
 * | `PI_PERSONA_KEY`             | `ctrl+shift+p`| Keybinding that cycles personas. |
 * | `PI_PERSONA_DELEGATE_DEFAULT` | `allow`       | What an ABSENT `delegate` block means: `allow` (sees everyone) or `deny` (lockdown). |
 * | `PI_PERSONA_SEED`            | `on`          | Seed bundled personas into the agents dir on startup; `off` disables. |
 * | `PI_PERSONA_SEED_DIR`        | `~/.pi/agent/agents` | Target dir for seeding (also the primary load dir). |
 *
 * Personas live alongside pi-subagents agents in `~/.pi/agent/agents` (user) and
 * `<cwd>/.pi/agents` (project). Only files with `persona: true` are loaded as
 * personas; the rest are left to pi-subagents. Project wins on name collisions;
 * `PI_PERSONA_DIRS` wins over both.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parsePersona, type Persona } from "./persona.ts";

export function isDisabled(): boolean {
	return !!process.env.PI_PERSONA_DISABLE?.trim();
}

export function getKeybinding(): string {
	return process.env.PI_PERSONA_KEY?.trim() || "ctrl+shift+p";
}

export function getDefaultPersonaName(): string | undefined {
	return process.env.PI_PERSONA_DEFAULT?.trim() || undefined;
}

/** Absent `delegate` block → allow all (default) unless `…_DELEGATE_DEFAULT=deny`. */
export function getDelegateDefaultAllow(): boolean {
	return process.env.PI_PERSONA_DELEGATE_DEFAULT?.trim().toLowerCase() !== "deny";
}

/** The Pi user agents dir where personas live next to pi-subagents agents. */
export function getAgentsDir(): string {
	return process.env.PI_PERSONA_SEED_DIR?.trim() || join(homedir(), ".pi", "agent", "agents");
}

export function isSeedEnabled(): boolean {
	return process.env.PI_PERSONA_SEED?.trim().toLowerCase() !== "off";
}

/** Persona directories in increasing priority (later overrides earlier by name). */
export function getPersonaDirs(cwd: string): string[] {
	const dirs = [getAgentsDir(), join(cwd, ".pi", "agents")];
	const extra = process.env.PI_PERSONA_DIRS?.trim();
	if (extra) dirs.push(...extra.split(/[;,]/).map((d) => d.trim()).filter(Boolean));
	return dirs;
}

/**
 * Copy bundled persona files into `targetDir`, but only when a file with that
 * name does not already exist (never overwrites user edits). Returns what was
 * copied / skipped for diagnostics. Best-effort; missing bundle dir is a no-op.
 */
export function seedPersonas(bundledDir: string, targetDir: string): { copied: string[]; skipped: string[]; errors: string[] } {
	const copied: string[] = [];
	const skipped: string[] = [];
	const errors: string[] = [];
	let files: string[];
	try {
		if (!existsSync(bundledDir)) return { copied, skipped, errors };
		files = readdirSync(bundledDir).filter((f) => f.endsWith(".md"));
	} catch (err) {
		return { copied, skipped, errors: [`${bundledDir}: ${(err as Error).message}`] };
	}
	try {
		mkdirSync(targetDir, { recursive: true });
	} catch {
		// best-effort
	}
	for (const file of files) {
		const dest = join(targetDir, file);
		try {
			if (existsSync(dest)) {
				skipped.push(file);
				continue;
			}
			copyFileSync(join(bundledDir, file), dest);
			copied.push(file);
		} catch (err) {
			errors.push(`${file}: ${(err as Error).message}`);
		}
	}
	return { copied, skipped, errors };
}

/**
 * Load and merge personas from `dirs` (later dirs override earlier by name).
 * Only files marked `persona: true` are returned — plain pi-subagents agents in
 * the same directory are ignored. Returns the list sorted by label + soft errors.
 */
export function loadPersonas(dirs: readonly string[]): { personas: Persona[]; errors: string[] } {
	const byName = new Map<string, Persona>();
	const errors: string[] = [];
	for (const dir of dirs) {
		let entries: string[];
		try {
			if (!existsSync(dir)) continue;
			entries = readdirSync(dir).filter((f) => f.endsWith(".md"));
		} catch (err) {
			errors.push(`${dir}: ${(err as Error).message}`);
			continue;
		}
		for (const file of entries) {
			const path = join(dir, file);
			try {
				const persona = parsePersona(readFileSync(path, "utf8"), path);
				if (persona?.isPersona) byName.set(persona.name, persona); // ignore non-persona agents
			} catch (err) {
				errors.push(`${path}: ${(err as Error).message}`);
			}
		}
	}
	const personas = [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
	return { personas, errors };
}
