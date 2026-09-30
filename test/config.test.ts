import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../src/config/defaults.js";
import {
	configFilePath,
	loadConfig,
	projectConfigFilePath,
	serializeConfig,
} from "../src/config/loader.js";
import { saveConfig, saveConfigDocument } from "../src/config/persistence.js";
import { normalizeConfig } from "../src/config/schema.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe("config defaults", () => {
	it("creates the current Custom profile by default", () => {
		const config = createDefaultConfig();
		expect(config.version).toBe(1);
		expect(config.preset).toBe("custom");
		expect(config.projectOverrides.enabled).toBe(false);
		expect(config.style.icons).toBe("off");
		expect(config.style.separator).toBe("dot");
		expect(config.style.labelMode).toBe("automatic");
		expect(config.layout.rows.map((row) => row.id)).toEqual([
			"project",
			"git",
			"usage",
			"session",
			"extensions",
		]);
		expect(config.layout.rows[0]?.left).toEqual(["cwd"]);
		expect(config.layout.rows[0]?.right).toEqual(["identity"]);
		expect(config.segments.cwd.display).toBe("tilde");
		expect(config.segments.git.display).toBe("full");
		expect(config.segments.context.display).toBe("full");
		expect(config.segments.tokens.display).toBe("standard");
		expect(config.segments.cache.display).toBe("compact");
		expect(config.segments.provider_usage.display).toBe("detailed");
		expect(config.usage.windows).toEqual(["5h", "week"]);
		expect(config.usage.refreshSeconds).toBe(30);
		expect(config.usage.showResetTime).toBe(true);
	});
});

describe("legacy layout compatibility", () => {
	it("preserves old custom rows and starts unconfigured Speed Off", () => {
		const result = normalizeConfig({
			layout: { rows: [{ id: "session", left: ["tokens"], right: ["cache"] }] },
		});
		expect(result.config.segments.speed.enabled).toBe(false);
		expect(result.config.layout.rows[0]?.left).toEqual(["tokens"]);
		expect(result.diagnostics).toEqual([]);
	});

	it("round trips explicit Speed settings and placements", () => {
		const result = normalizeConfig({
			layout: { rows: [{ id: "session", left: ["speed"], right: ["tokens"] }] },
			segments: { speed: { enabled: true, label: "Rate" } },
		});
		expect(result.config.segments.speed).toEqual({ enabled: true, label: "Rate" });
		expect(result.diagnostics).toEqual([]);
		expect(normalizeConfig(JSON.parse(serializeConfig(result.config))).config).toEqual(
			result.config,
		);
	});
	it("keeps an explicit separate identity layout intact", () => {
		const result = normalizeConfig({
			layout: {
				rows: [{ id: "identity", left: [], right: ["provider", "model", "thinking"] }],
			},
		});
		expect(result.config.preset).toBe("custom");
		expect(result.config.layout.rows[0]?.right).toEqual(["provider", "model", "thinking"]);
	});
});

describe("config normalization", () => {
	it("normalizes valid partial values over a supplied base", () => {
		const base = createDefaultConfig();
		base.style.icons = "minimal";
		const result = normalizeConfig(
			{
				style: { colorMode: "monochrome" },
				usage: { refreshSeconds: 600 },
			},
			base,
		);

		expect(result.diagnostics).toEqual([]);
		expect(result.config.style.colorMode).toBe("monochrome");
		expect(result.config.style.icons).toBe("minimal");
		expect(result.config.usage.refreshSeconds).toBe(600);

		const display = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["context"], right: [] }] },
			segments: { context: { display: "hybrid" } },
			usage: { windows: ["5h", "week"], showResetTime: true },
		});
		expect(display.config.segments.context).toEqual({ enabled: true, display: "hybrid" });
		expect(display.config.usage.windows).toEqual(["5h", "week"]);
		expect(display.config.usage.showResetTime).toBe(true);
		expect(display.diagnostics).toEqual([]);

		const everything = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["model"], right: [] }] },
			style: { labelMode: "detailed" },
			segments: {
				model: { label: "Model" },
			},
			thresholds: { context: { warning: 75, error: 95 } },
			responsive: { strategy: "compact-hide-truncate" },
		});
		expect(everything.diagnostics).toEqual([]);
		expect(everything.config.style.labelMode).toBe("detailed");
		expect(everything.config.segments.model).toEqual({ enabled: true, label: "Model" });
		expect(everything.config.thresholds.context).toEqual({ warning: 75, error: 95 });
		expect(everything.config.responsive.strategy).toBe("compact-hide-truncate");
	});

	it("rejects unsafe labels and invalid threshold order", () => {
		const result = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["model"], right: [] }] },
			segments: { model: { label: "bad\u0000label" } },
			thresholds: { context: { warning: 90, error: 70 } },
		});
		expect(result.config.segments.model.label).toBeUndefined();
		expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
			"segments.model.label",
			"thresholds.context",
		]);
	});

	it("reports unknown and invalid fields without discarding valid fields", () => {
		const result = normalizeConfig({
			future: true,
			style: { colorMode: "rainbow", icons: "off" },
			usage: { refreshSeconds: -1 },
		});

		expect(result.config.style.icons).toBe("off");
		expect(result.config.style.colorMode).toBe("semantic");
		expect(result.config.usage.refreshSeconds).toBe(30);
		expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
			{ code: "unknown", path: "future" },
			{ code: "invalid", path: "style.colorMode" },
			{ code: "invalid", path: "usage.refreshSeconds" },
		]);
	});

	it("snaps a legacy refresh interval to the nearest fixed tier", () => {
		const result = normalizeConfig({ usage: { refreshSeconds: 1 } });
		expect(result.config.usage.refreshSeconds).toBe(15);
		expect(result.diagnostics).toEqual([
			{
				severity: "warning",
				code: "unknown",
				path: "usage.refreshSeconds",
				message: expect.stringContaining("not a supported tier"),
			},
		]);

		const oneHour = normalizeConfig({ usage: { refreshSeconds: 3600 } });
		expect(oneHour.config.usage.refreshSeconds).toBe(900);
	});

	it("migrates the legacy Project path display to home-relative tilde", () => {
		const result = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["cwd"], right: [] }] },
			segments: { cwd: { display: "path" } },
		});
		expect(result.config.segments.cwd.display).toBe("tilde");
		expect(result.diagnostics[0]?.message).toContain("was renamed");
	});

	it("migrates legacy Usage display names to the simplified presets", () => {
		const migrations = [
			["windows", "standard"],
			["max", "detailed"],
			["percent-only", "compact"],
			["no-reset", "standard"],
			["reset-focus", "detailed"],
			["ratio-bars", "standard"],
			["countdown", "detailed"],
			["compact-list", "compact"],
			["timed", "detailed"],
			["focus", "detailed"],
			["full", "detailed"],
			["verbose", "detailed"],
		] as const;
		for (const [legacy, current] of migrations) {
			const result = normalizeConfig({
				preset: "custom",
				layout: { rows: [{ id: "main", left: ["provider_usage"], right: [] }] },
				segments: { provider_usage: { display: legacy } },
			});
			expect(result.config.segments.provider_usage.display).toBe(current);
			expect(result.diagnostics[0]?.message).toContain("was renamed");
		}
	});

	it("normalizes selectable Usage windows and removes the legacy maximum", () => {
		const result = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["provider_usage"], right: [] }] },
			usage: { windows: ["rolling", "month"] },
			segments: { provider_usage: { maxWindows: 1 } },
		});
		expect(result.config.usage.windows).toEqual(["5h", "month"]);
		expect(result.config.segments.provider_usage.maxWindows).toBeUndefined();
		expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
			"segments.provider_usage.maxWindows",
			"usage.windows",
		]);
	});

	it("accepts only the three Context display presets", () => {
		const valid = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["context"], right: [] }] },
			segments: { context: { display: "hybrid" } },
		});
		expect(valid.config.segments.context.display).toBe("hybrid");
		expect(valid.diagnostics).toEqual([]);

		const invalid = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["context"], right: [] }] },
			segments: { context: { display: "usage" } },
		});
		expect(invalid.config.segments.context.display).toBe("full");
		expect(invalid.diagnostics[0]).toMatchObject({
			code: "invalid",
			path: "segments.context.display",
		});
	});

	it("accepts Cost density and notation independently", () => {
		const valid = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["cost"], right: [] }] },
			segments: { cost: { display: "full", notation: "arrows" } },
		});
		expect(valid.config.segments.cost.display).toBe("full");
		expect(valid.config.segments.cost.notation).toBe("arrows");
		expect(valid.diagnostics).toEqual([]);

		const invalid = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["cost"], right: [] }] },
			segments: { cost: { display: "precise", notation: "verbose" } },
		});
		expect(invalid.config.segments.cost.display).toBe("standard");
		expect(invalid.config.segments.cost.notation).toBe("short");
		expect(invalid.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
			"segments.cost.display",
			"segments.cost.notation",
		]);
	});

	it("locks preset-owned details when a built-in preset is active", () => {
		const result = normalizeConfig({
			preset: "balanced",
			style: { labelMode: "detailed" },
			segments: { context: { display: "compact" } },
		});
		expect(result.config.style.labelMode).toBe("automatic");
		expect(result.config.segments.context.display).toBe("hybrid");
		expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
			"style.labelMode",
			"segments",
		]);
	});

	it("diagnoses removed per-Segment fine-grained fields without breaking the config", () => {
		const result = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "main", left: ["model", "context"], right: [] }] },
			segments: {
				model: { enabled: true, format: "brief", priority: 10, colorRole: "accent" },
				context: { display: "usage" },
			},
		});
		expect(result.config.segments.model).toEqual({ enabled: true });
		expect(result.config.segments.context.display).toBe("full");
		const removed = result.diagnostics.filter((d) => d.code === "unknown");
		expect(removed.map((d) => d.path)).toEqual([
			"segments.model.format",
			"segments.model.priority",
			"segments.model.colorRole",
		]);
		for (const diagnostic of removed) {
			expect(diagnostic.message).toContain("removed");
		}
	});

	it("rejects per-reference option objects in rows", () => {
		const result = normalizeConfig({
			layout: {
				rows: [{ id: "one", left: [{ id: "model", priority: 10 }], right: [] }],
			},
		});
		expect(result.config.layout.rows[0]?.left).toEqual(["model"]);
		expect(result.diagnostics.map((d) => d.path)).toEqual(["layout.rows[0].left[0].options"]);
		expect(result.diagnostics[0]?.message).toContain("Unknown setting");
	});

	it("applies preset-specific layouts and display profiles unless an explicit layout is present", () => {
		const compact = normalizeConfig({ preset: "compact" });
		expect(compact.config.layout.rows.map((row) => row.id)).toEqual(["overview", "session"]);
		expect(compact.config.layout.rows[0]?.left).toEqual(["cwd", "git"]);
		expect(compact.config.layout.rows[0]?.right).toEqual(["identity", "context"]);
		expect(compact.config.segments.cwd.display).toBe("name");
		expect(compact.config.segments.context.display).toBe("compact");
		expect(compact.config.segments.tokens.display).toBe("compact");
		expect(compact.config.segments.provider_usage.display).toBe("compact");
		expect(compact.config.segments.cost.display).toBe("compact");
		expect(compact.config.segments.cost.notation).toBe("short");
		expect(compact.config.style.labelMode).toBe("automatic");

		const balanced = normalizeConfig({ preset: "balanced" });
		expect(balanced.config.layout.rows.map((row) => row.id)).toEqual([
			"project",
			"git",
			"usage",
			"session",
			"extensions",
		]);
		expect(balanced.config.segments.cwd.display).toBe("tilde");
		expect(balanced.config.segments.cache.display).toBe("read-write-hit");
		expect(balanced.config.segments.context.display).toBe("hybrid");
		expect(balanced.config.segments.tokens.display).toBe("standard");
		expect(balanced.config.segments.provider_usage.display).toBe("standard");
		expect(balanced.config.segments.cost.display).toBe("standard");
		expect(balanced.config.segments.cost.notation).toBe("short");

		const detailed = normalizeConfig({ preset: "detailed" });
		expect(detailed.config.layout).toEqual(balanced.config.layout);
		expect(detailed.config.segments.git.display).toBe("full");
		expect(detailed.config.segments.cost.display).toBe("full");
		expect(detailed.config.segments.cost.notation).toBe("full");
		expect(detailed.config.segments.tokens.display).toBe("full");
		expect(detailed.config.segments.provider_usage.display).toBe("detailed");

		const legacyMinimal = normalizeConfig({ preset: "minimal" });
		expect(legacyMinimal.config.preset).toBe("compact");
		expect(legacyMinimal.diagnostics[0]?.message).toContain("renamed");

		const custom = normalizeConfig({
			preset: "balanced",
			layout: { rows: [{ id: "only", left: ["model"], right: [] }] },
		});
		expect(custom.config.preset).toBe("custom");
		expect(custom.config.layout.rows.map((row) => row.id)).toEqual(["only"]);

		const explicitCustom = normalizeConfig({
			preset: "custom",
			layout: { rows: [{ id: "only", left: ["model"], right: [] }] },
		});
		expect(explicitCustom.diagnostics).toEqual([]);
		expect(explicitCustom.config.preset).toBe("custom");
		const missingLayout = normalizeConfig({ preset: "custom" });
		expect(missingLayout.config.preset).toBe("custom");
		expect(missingLayout.diagnostics[0]?.path).toBe("preset");
	});

	it("removes empty rows and duplicate Segment placements", () => {
		const result = normalizeConfig({
			preset: "custom",
			layout: {
				rows: [
					{ id: "empty", left: [], right: [] },
					{ id: "main", left: ["model", "model"], right: [] },
					{ id: "duplicate", left: ["model"], right: [] },
				],
			},
		});

		expect(result.config.layout.rows.map((row) => row.id)).toEqual(["main"]);
		expect(result.config.layout.rows[0]?.left).toEqual(["model"]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				path: "layout.rows",
				message: "Empty or duplicate Segment placements were removed from the layout",
			}),
		]);
	});

	it("allows an intentionally empty custom layout without restoring the default rows", () => {
		const result = normalizeConfig({ preset: "custom", layout: { rows: [] } });

		expect(result.config.preset).toBe("custom");
		expect(result.config.layout.rows).toEqual([]);
		expect(result.diagnostics).toEqual([]);
	});

	it("validates row references and preserves valid rows", () => {
		const result = normalizeConfig({
			layout: {
				rows: [
					{ id: "identity", left: ["model", "not-a-segment"], right: [] },
					{ id: "identity", left: ["context"], right: [] },
					{ id: "usage", left: ["cost"], right: [] },
				],
			},
		});

		expect(result.config.layout.rows.map((row) => row.id)).toEqual(["identity", "usage"]);
		expect(result.config.layout.rows[0]?.left).toEqual(["model"]);
		expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
			"layout.rows[0].left[1]",
			"layout.rows[1].id",
		]);
	});
});

describe("config loading and project overrides", () => {
	it("uses built-in defaults when the global document is missing", () => {
		const root = makeTemporaryDirectory();
		const loaded = loadConfig({ agentDir: join(root, "agent") });
		expect(loaded.source).toBe("built-in");
		expect(loaded.diagnostics).toEqual([]);
		expect(loaded.config.preset).toBe("custom");
	});

	it("reads the file written under the extension's former name", () => {
		const root = makeTemporaryDirectory();
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "pi-x-footer.json"), '{"style":{"icons":"minimal"}}\n', "utf8");
		const loaded = loadConfig({ agentDir });
		expect(loaded.source).toBe("global");
		expect(loaded.config.style.icons).toBe("minimal");
		expect(configFilePath(agentDir)).toBe(join(agentDir, "pi-x-footer.json"));
	});

	it("prefers the current name when both files are present", () => {
		const root = makeTemporaryDirectory();
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "pi-x-footer.json"), '{"style":{"icons":"minimal"}}\n', "utf8");
		writeFileSync(join(agentDir, "pid-footer.json"), '{"style":{"icons":"nerd"}}\n', "utf8");
		expect(loadConfig({ agentDir }).config.style.icons).toBe("nerd");
		expect(configFilePath(agentDir)).toBe(join(agentDir, "pid-footer.json"));
	});

	it("loads global configuration and keeps malformed input out of the active config", () => {
		const root = makeTemporaryDirectory();
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		const path = join(agentDir, "pid-footer.json");
		writeFileSync(path, '{"style":{"icons":"minimal"}}\n', "utf8");
		const loaded = loadConfig({ agentDir });
		expect(loaded.source).toBe("global");
		expect(loaded.config.style.icons).toBe("minimal");
		expect(loaded.globalRawDocument).toContain('"icons"');

		writeFileSync(path, "{not-json", "utf8");
		const malformed = loadConfig({ agentDir });
		expect(malformed.config.style.icons).toBe("off");
		expect(malformed.diagnostics[0]?.code).toBe("parse");
	});

	it("does not read project config until the global opt-in is enabled", () => {
		const root = makeTemporaryDirectory();
		const agentDir = join(root, "agent");
		const projectRoot = join(root, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectRoot, ".pi"), { recursive: true });
		writeFileSync(
			join(agentDir, "pid-footer.json"),
			JSON.stringify({ style: { icons: "minimal" } }),
			"utf8",
		);
		writeFileSync(
			projectConfigFilePath(projectRoot),
			JSON.stringify({ style: { icons: "nerd" } }),
			"utf8",
		);

		const disabled = loadConfig({ agentDir, projectRoot });
		expect(disabled.source).toBe("global");
		expect(disabled.config.style.icons).toBe("minimal");
		expect(disabled.projectPath).toBeUndefined();

		writeFileSync(
			join(agentDir, "pid-footer.json"),
			JSON.stringify({ projectOverrides: { enabled: true }, style: { icons: "minimal" } }),
			"utf8",
		);
		const enabled = loadConfig({ agentDir, projectRoot });
		expect(enabled.source).toBe("project");
		expect(enabled.config.style.icons).toBe("nerd");
		expect(enabled.projectPath).toBe(projectConfigFilePath(projectRoot));
	});
});

describe("config persistence", () => {
	it("serializes preset-owned details only for custom mode", () => {
		const presetConfig = createDefaultConfig();
		presetConfig.preset = "balanced";
		const presetDocument = JSON.parse(serializeConfig(presetConfig)) as Record<string, unknown>;
		expect(presetDocument).not.toHaveProperty("layout");
		expect(presetDocument).not.toHaveProperty("segments");
		expect(presetDocument.style).not.toHaveProperty("labelMode");

		const custom = createDefaultConfig();
		custom.preset = "custom";
		const customDocument = JSON.parse(serializeConfig(custom)) as Record<string, unknown>;
		expect(customDocument).toHaveProperty("layout");
		expect(customDocument).toHaveProperty("segments");

		custom.layout.rows = [
			{ id: "empty", left: [], right: [], visible: "always", overflow: "hide" },
			{ id: "main", left: ["model", "model"], right: [], visible: "always", overflow: "hide" },
		];
		const cleanedDocument = JSON.parse(serializeConfig(custom)) as {
			layout: { rows: Array<{ id: string; left: string[] }> };
		};
		expect(cleanedDocument.layout.rows).toHaveLength(1);
		expect(cleanedDocument.layout.rows[0]).toMatchObject({ id: "main", left: ["model"] });
	});

	it("writes a normalized config document atomically", () => {
		const root = makeTemporaryDirectory();
		const path = join(root, "nested", "pid-footer.json");
		const config = createDefaultConfig();
		config.enabled = false;
		saveConfig(path, config);
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ enabled: false, version: 1 });
	});

	it("writes a supplied document without leaving temporary files", () => {
		const root = makeTemporaryDirectory();
		const path = join(root, "pid-footer.json");
		saveConfigDocument(path, '{"version":1}\n');
		expect(readFileSync(path, "utf8")).toBe('{"version":1}\n');
	});
});

function makeTemporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "pid-footer-config-"));
	temporaryDirectories.push(directory);
	return directory;
}
