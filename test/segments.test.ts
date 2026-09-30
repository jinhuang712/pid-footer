import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../src/config/defaults.js";
import { SEGMENT_IDS } from "../src/config/types.js";
import {
	formatCount,
	formatPercent,
	sanitizeSegmentText,
	shortenHome,
} from "../src/segments/format.js";
import { segmentPreview } from "../src/segments/metadata.js";
import { createBuiltinSegmentRegistry, resolveSegments } from "../src/segments/registry.js";
import { createEmptySnapshot } from "../src/state/snapshot.js";
import type { FooterSnapshot } from "../src/state/types.js";

function snapshotWith(overrides: Partial<FooterSnapshot> = {}): FooterSnapshot {
	const snapshot = createEmptySnapshot();
	return {
		...snapshot,
		...overrides,
	};
}

describe("segment formatters", () => {
	it("formats counts, percentages, and terminal-safe text", () => {
		expect(formatCount(999)).toBe("999");
		expect(formatCount(1_234)).toBe("1.2k");
		expect(formatCount(12_345)).toBe("12k");
		expect(formatCount(1_234_567)).toBe("1.2m");
		expect(formatPercent(18.94)).toBe("18.9%");
		expect(formatPercent(undefined)).toBe("?");
		expect(sanitizeSegmentText("  model\n\tname \u001b[31m")).toBe("model name [31m");
	});

	it("shortens home-relative paths without touching other paths", () => {
		expect(shortenHome("/Users/jin/dev/project", "/Users/jin")).toBe("~/dev/project");
		expect(shortenHome("/Users/jin", "/Users/jin")).toBe("~");
		expect(shortenHome("/Users/jin", "/Users/jin/")).toBe("~");
		expect(shortenHome("/var/tmp/work", "/Users/jin")).toBe("/var/tmp/work");
		expect(shortenHome("/Users/jin-dev/project", "/Users/jin")).toBe("/Users/jin-dev/project");
		expect(shortenHome("/Users/jin/dev/project", undefined)).toBe("/Users/jin/dev/project");
		expect(shortenHome("C:\\Users\\jin\\dev", "C:\\Users\\jin")).toBe("~/dev");
	});
});

describe("builtin Segment Registry", () => {
	it.each(["compact", "standard", "full"] as const)(
		"renders Speed independently of %s Token display",
		(display) => {
			const config = createDefaultConfig();
			config.segments.tokens.display = display;
			const snapshot = snapshotWith({
				conversation: {
					tokens: { input: 1000, output: 100 },
					throughput: { outputTokens: 100, durationMs: 2000, tokensPerSecond: 50, recordedAt: 1 },
				},
			});
			const segment = resolveSegments(snapshot, config, ["speed"])[0];
			expect(segment?.text).toBe("Speed: 50.0 tok/s");
			expect(segment?.compactText).toBe("50.0 tok/s");
			expect(resolveSegments(snapshot, config, ["tokens"])[0]?.text).not.toContain("tok/s");
			config.segments.tokens.enabled = false;
			expect(resolveSegments(snapshot, config, ["speed"])[0]?.text).toBe("Speed: 50.0 tok/s");
			config.segments.speed.label = "Rate";
			expect(resolveSegments(snapshot, config, ["speed"])[0]?.text).toBe("Rate: 50.0 tok/s");
			config.segments.speed.enabled = false;
			expect(resolveSegments(snapshot, config, ["speed"])).toEqual([]);
		},
	);
	it("hides Speed until a valid measurement exists", () => {
		expect(resolveSegments(createEmptySnapshot(), createDefaultConfig(), ["speed"])).toEqual([]);
	});

	it("exposes metadata-driven previews for every built-in Segment", () => {
		const config = createDefaultConfig();
		for (const id of SEGMENT_IDS) {
			expect(segmentPreview(id, config.segments[id], "automatic", "balanced")).not.toBe("hidden");
		}
		config.segments.context.label = "Window";
		expect(segmentPreview("context", config.segments.context, "labeled", "balanced")).toBe(
			"Window: 261k/1.0m (25.5%)",
		);
	});

	it("registers all v0.1 built-in Segment IDs", () => {
		const registry = createBuiltinSegmentRegistry();
		expect(registry.values().every((segment) => segment.configFields.length > 0)).toBe(true);
		expect(registry.get("context")?.configFields.map((field) => field.key)).toContain("display");
		expect(registry.get("cost")?.configFields.map((field) => field.key)).toContain("notation");
		const config = createDefaultConfig();
		expect(segmentPreview("cost", config.segments.cost, "automatic", "custom")).toBe(
			"Cost: $0.123 · cache $0.028 · no-cache $0.095",
		);
		config.segments.cost.display = "full";
		config.segments.cost.notation = "full";
		expect(segmentPreview("cost", config.segments.cost, "automatic", "custom")).toBe(
			"Cost: $0.123 · Input $0.012 · Output $0.083 · Cache In $0.025 · Cache Write $0.003",
		);
		expect(registry.values().map((segment) => segment.id)).toEqual([
			"identity",
			"provider",
			"model",
			"thinking",
			"cwd",
			"git",
			"context",
			"tokens",
			"speed",
			"cache",
			"cost",
			"tools",
			"provider_usage",
			"extensions",
		]);
	});

	it("resolves a collapsed provider/model/thinking identity", () => {
		const snapshot = snapshotWith({
			session: {
				provider: "openai-codex",
				model: "gpt-5.6-luna",
				thinkingLevel: "xhigh",
				cwd: "/workspace/project",
				isStreaming: false,
			},
		});
		const identity = resolveSegments(snapshot, createDefaultConfig(), ["identity"])[0];

		expect(identity?.text).toBe("openai-codex: gpt-5.6-luna (xhigh)");
		expect(identity?.compactText).toBe("gpt-5.6-luna (xhigh)");
		expect(identity?.parts).toEqual([
			{ text: "openai-codex", role: "accent" },
			{ text: ": ", role: "dim" },
			{ text: "gpt-5.6-luna", role: "text" },
			{ text: " (", role: "dim" },
			{ text: "xhigh", role: "info" },
			{ text: ")", role: "dim" },
		]);
	});

	it("resolves configured Segments without rendering styles", () => {
		const snapshot = snapshotWith({
			session: {
				provider: "openai-codex",
				model: "gpt-5.6",
				thinkingLevel: "xhigh",
				cwd: "/workspace/project",
				isStreaming: false,
			},
			conversation: {
				context: { usedTokens: 20_000, limitTokens: 100_000, usedPercent: 20 },
				tokens: { input: 10_000, output: 500, total: 10_500 },
				cost: { input: 0.012, output: 0.083, cacheRead: 0.025, cacheWrite: 0.003, total: 0.123 },
			},
		});
		const config = createDefaultConfig();
		const segments = resolveSegments(snapshot, config, [
			"provider",
			"model",
			"context",
			"tokens",
			"cost",
		]);

		expect(segments.map((segment) => segment.id)).toEqual([
			"provider",
			"model",
			"context",
			"tokens",
			"cost",
		]);
		expect(segments.map((segment) => segment.text)).toEqual([
			"Provider: openai-codex",
			"Model: gpt-5.6",
			"Context: 20k/100k (20.0%)",
			"Tokens: ↓10k ↑500",
			"Cost: $0.123 · cache $0.028 · no-cache $0.095",
		]);
		expect(segments.find((segment) => segment.id === "context")?.state).toBe("success");
	});

	it("renders cost density and notation independently", () => {
		const snapshot = snapshotWith({
			conversation: {
				cost: { input: 0.012, output: 0.083, cacheRead: 0.025, cacheWrite: 0.003, total: 0.123 },
			},
		});
		const config = createDefaultConfig();

		config.segments.cost.display = "compact";
		expect(resolveSegments(snapshot, config, ["cost"])[0]?.text).toBe("Cost: $0.123");

		config.segments.cost.display = "standard";
		config.segments.cost.notation = "full";
		expect(resolveSegments(snapshot, config, ["cost"])[0]?.text).toBe(
			"Cost: $0.123 · Cached $0.028 · No Cache $0.095",
		);

		config.segments.cost.display = "full";
		config.segments.cost.notation = "short";
		expect(resolveSegments(snapshot, config, ["cost"])[0]?.text).toBe(
			"Cost: $0.123 · in $0.012 · out $0.083 · read $0.025 · write $0.003",
		);
		config.segments.cost.notation = "arrows";
		expect(resolveSegments(snapshot, config, ["cost"])[0]?.text).toBe(
			"Cost: $0.123 · ↓$0.012 · ↑$0.083 · ←$0.025 · →$0.003",
		);
	});

	it("uses built-in priority/required defaults and shows zero local usage", () => {
		const snapshot = createEmptySnapshot();
		const config = createDefaultConfig();
		const segments = resolveSegments(snapshot, config, [
			"model",
			"tokens",
			"cache",
			"provider_usage",
		]);

		expect(segments.map((segment) => segment.id)).toEqual(["tokens", "cache"]);
		expect(segments.map((segment) => segment.text)).toEqual(["Tokens: ↓0 ↑0", "Cache: 0"]);
		expect(segments.find((segment) => segment.id === "cache")?.state).toBe("muted");

		const customConfig = createDefaultConfig();
		customConfig.preset = "custom";
		customConfig.segments.tokens.display = "standard";
		customConfig.segments.cache.display = "compact";
		expect(
			resolveSegments(snapshot, customConfig, ["tokens", "cache"]).map((segment) => segment.text),
		).toEqual(["Tokens: ↓0 ↑0", "Cache: 0"]);

		const tokenSnapshot = snapshotWith({
			conversation: { tokens: { input: 8_000, output: 500, total: 99_999 } },
		});
		const compactConfig = createDefaultConfig();
		compactConfig.segments.tokens.display = "compact";
		expect(resolveSegments(tokenSnapshot, compactConfig, ["tokens"])[0]?.text).toBe("Tokens: 8.5k");

		const fullConfig = createDefaultConfig();
		fullConfig.segments.tokens.display = "full";
		expect(resolveSegments(tokenSnapshot, fullConfig, ["tokens"])[0]?.text).toBe(
			"Tokens: input ↓ 8.0k · output ↑ 500",
		);

		const configured = resolveSegments(
			snapshotWith({ session: { ...snapshot.session, model: "model-name" } }),
			config,
			["model"],
		);
		expect(configured[0]).toMatchObject({ id: "model", priority: 100, required: true });
	});

	it("applies context, Git, and provider usage display settings", () => {
		const snapshot = snapshotWith({
			repository: {
				isRepository: true,
				branch: "main",
				dirty: true,
				ahead: 2,
				behind: 1,
				changedFiles: 3,
				conflicts: 0,
				state: "fresh",
			},
			conversation: { context: { usedPercent: 17.8, limitTokens: 272_000 } },
			providerUsage: {
				provider: "openai-codex",
				state: "fresh",
				windows: [
					{ id: "codex:primary", label: "5h", usedPercent: 17.8, state: "normal" },
					{ id: "codex:secondary", label: "wk", usedPercent: 6, state: "normal" },
				],
			},
		});
		const config = createDefaultConfig();
		config.style.labelMode = "labeled";
		config.segments.git.display = "status";
		config.segments.context.display = "hybrid";
		config.usage.windows = ["week"];

		const segments = resolveSegments(snapshot, config, ["git", "context", "provider_usage"]);
		expect(segments.map((segment) => segment.text)).toEqual([
			"Git: main · dirty",
			"Context: 272k × 17.8%",
			"Usage: Codex 6% (7d)",
		]);
	});

	it("shows a muted no-repository status after a fresh Git check", () => {
		const snapshot = snapshotWith({
			repository: { isRepository: false, state: "fresh" },
		});
		const config = createDefaultConfig();
		config.style.labelMode = "labeled";

		const labeled = resolveSegments(snapshot, config, ["git"])[0];
		expect(labeled?.text).toBe("Git: not a Git repository");
		expect(labeled?.state).toBe("muted");

		config.style.labelMode = "brief";
		const brief = resolveSegments(snapshot, config, ["git"])[0];
		expect(brief?.text).toBe("Git: no Git repo");
		expect(brief?.compactText).toBe("no Git repo");

		const loading = resolveSegments(
			snapshotWith({ repository: { isRepository: false, state: "loading" } }),
			config,
			["git"],
		);
		expect(loading).toEqual([]);
	});

	it("makes the Git full preset include all available repository details", () => {
		const snapshot = snapshotWith({
			repository: {
				isRepository: true,
				branch: "main",
				dirty: true,
				changedFiles: 15,
				additions: 6,
				deletions: 5,
				addedFiles: 3,
				deletedFiles: 2,
				modifiedFiles: 10,
				untrackedFiles: 20,
				ahead: 2,
				behind: 3,
				conflicts: 0,
				state: "fresh",
			},
		});
		const config = createDefaultConfig();
		config.preset = "custom";
		config.style.labelMode = "labeled";
		config.segments.git.display = "full";

		const git = resolveSegments(snapshot, config, ["git"])[0];
		expect(git?.text).toBe("Git: main ↑2↓3 · diff -5+6 (11) · files +3 -2 ~10 ?20");
	});

	it("keeps the Usage row visible with muted placeholders while loading", () => {
		const snapshot = snapshotWith({
			providerUsage: {
				provider: "openai-codex",
				state: "loading",
				windows: [],
			},
		});
		const config = createDefaultConfig();
		config.style.labelMode = "labeled";
		config.usage.windows = ["5h", "week"];

		const usage = resolveSegments(snapshot, config, ["provider_usage"])[0];
		expect(usage?.text).toBe("Usage: Codex — (5hr) · — (7d)");
		expect(usage?.state).toBe("muted");
	});

	it("maps OpenCode rolling usage to the shared 5h window", () => {
		const snapshot = snapshotWith({
			providerUsage: {
				provider: "opencode-go",
				state: "fresh",
				windows: [
					{ id: "rolling", label: "5h", usedPercent: 2, state: "normal" },
					{ id: "weekly", label: "w", usedPercent: 4, state: "normal" },
					{ id: "monthly", label: "m", usedPercent: 6, state: "normal" },
				],
			},
		});
		const config = createDefaultConfig();
		config.style.labelMode = "labeled";
		config.usage.windows = ["5h", "week", "month"];

		const usage = resolveSegments(snapshot, config, ["provider_usage"])[0];
		expect(usage?.text).toBe("Usage: OpenCode Go 2% (5hr) · 4% (7d) · 6% (30d)");
	});

	it("applies project/cost/usage display presets", () => {
		const snapshot = snapshotWith({
			session: {
				...createEmptySnapshot().session,
				cwd: "/Users/jin/dev/project",
				isStreaming: false,
			},
			conversation: {
				cost: {
					input: 0.0123,
					output: 0.0831,
					cacheRead: 0.025,
					cacheWrite: 0.003,
					total: 0.1234,
				},
			},
			providerUsage: {
				provider: "openai-codex",
				state: "fresh",
				windows: [
					{ id: "5h", label: "5h", usedPercent: 58, state: "normal" },
					{ id: "week", label: "wk", usedPercent: 9, state: "normal" },
				],
			},
		});
		const config = createDefaultConfig();
		config.preset = "custom";
		config.segments.cwd.display = "name";
		config.segments.cost.display = "full";
		config.segments.cost.notation = "short";
		config.segments.provider_usage.display = "standard";
		config.usage.windows = ["5h"];
		const segments = resolveSegments(snapshot, config, ["cwd", "cost", "provider_usage"]);

		expect(segments.map((segment) => segment.text)).toEqual([
			"Project: project",
			"Cost: $0.123 · in $0.012 · out $0.083 · read $0.025 · write $0.003",
			"Usage: Codex 58% (5hr)",
		]);
	});

	it("precomputes compact fallbacks for responsive fitting", () => {
		const snapshot = snapshotWith({
			session: { ...createEmptySnapshot().session, model: "gpt-5.6-luna" },
		});
		const config = createDefaultConfig();
		config.preset = "detailed";
		const model = resolveSegments(snapshot, config, ["model"])[0];

		expect(model?.text).toBe("Model: gpt-5.6-luna");
		expect(model?.compactText).toBe("gpt-5.6-luna");
	});

	it("compacts a full project path to its basename to preserve the project name", () => {
		const snapshot = snapshotWith({
			session: { ...createEmptySnapshot().session, cwd: "/Users/jin/dev/project" },
		});
		const config = createDefaultConfig();
		config.preset = "custom";
		config.segments.cwd.display = "full";
		const cwd = resolveSegments(snapshot, config, ["cwd"])[0];

		expect(cwd?.text).toBe("Project: /Users/jin/dev/project");
		expect(cwd?.compactText).toBe("project");
	});

	it("renders home-relative, absolute, and legacy project path displays", () => {
		const cwd = "/Users/jin/dev/project";
		const home = "/Users/jin";
		const snapshot = snapshotWith({
			session: { ...createEmptySnapshot().session, cwd, home },
		});
		const config = createDefaultConfig();
		config.preset = "custom";

		config.segments.cwd.display = "tilde";
		expect(resolveSegments(snapshot, config, ["cwd"])[0]?.text).toBe("Project: ~/dev/project");

		config.segments.cwd.display = "full";
		expect(resolveSegments(snapshot, config, ["cwd"])[0]?.text).toBe(
			"Project: /Users/jin/dev/project",
		);

		// The removed `path` value keeps rendering as home-relative.
		config.segments.cwd.display = "path";
		expect(resolveSegments(snapshot, config, ["cwd"])[0]?.text).toBe("Project: ~/dev/project");

		config.segments.cwd.display = "name";
		expect(resolveSegments(snapshot, config, ["cwd"])[0]?.text).toBe("Project: project");
	});

	it("falls back to the absolute path when tilde shortening is unavailable", () => {
		const config = createDefaultConfig();
		config.preset = "custom";
		config.segments.cwd.display = "tilde";

		const outside = snapshotWith({
			session: { ...createEmptySnapshot().session, cwd: "/var/tmp/work", home: "/Users/jin" },
		});
		expect(resolveSegments(outside, config, ["cwd"])[0]?.text).toBe("Project: /var/tmp/work");

		const noHome = snapshotWith({
			session: { ...createEmptySnapshot().session, cwd: "/Users/jin/dev/project" },
		});
		expect(resolveSegments(noHome, config, ["cwd"])[0]?.text).toBe(
			"Project: /Users/jin/dev/project",
		);

		const atHome = snapshotWith({
			session: { ...createEmptySnapshot().session, cwd: "/Users/jin", home: "/Users/jin" },
		});
		expect(resolveSegments(atHome, config, ["cwd"])[0]?.text).toBe("Project: ~");
	});

	it("hides reset text when reset display is disabled", () => {
		const snapshot = snapshotWith({
			updatedAt: 0,
			providerUsage: {
				provider: "openai-codex",
				state: "fresh",
				windows: [{ id: "5h", label: "5h", usedPercent: 58, resetAt: 3_600_000, state: "normal" }],
			},
		});
		const config = createDefaultConfig();
		config.usage.showResetTime = false;
		config.segments.provider_usage.display = "detailed";
		const usage = resolveSegments(snapshot, config, ["provider_usage"])[0];

		expect(usage?.text).toBe("Usage: Codex 58% (5hr)");
	});

	it("renders Usage detail, window, and reset settings independently", () => {
		const snapshot = snapshotWith({
			updatedAt: 0,
			providerUsage: {
				provider: "openai-codex",
				state: "fresh",
				windows: [
					{
						id: "5h",
						label: "5h",
						usedPercent: 50,
						resetAt: (3 * 60 + 53) * 60_000,
						state: "normal",
					},
					{
						id: "week",
						label: "wk",
						usedPercent: 30,
						resetAt: (6 * 24 + 14) * 60 * 60_000,
						state: "normal",
					},
				],
			},
		});
		const config = createDefaultConfig();
		config.preset = "custom";
		config.segments.provider_usage.display = "standard";
		const standard = resolveSegments(snapshot, config, ["provider_usage"])[0];
		expect(standard?.text).toBe("Usage: Codex 50% (5hr, reset 4h) · 30% (7d, reset 7d)");
		expect(standard?.parts?.[1]).toMatchObject({ text: "Codex", role: "accent" });

		config.segments.provider_usage.display = "detailed";
		const detailed = resolveSegments(snapshot, config, ["provider_usage"])[0];
		expect(detailed?.text).toBe(
			"Usage: Codex 50% (5hr resets in 3hr53m) · 30% (7d resets in 6d 14h)",
		);

		config.usage.showResetTime = false;
		const noResets = resolveSegments(snapshot, config, ["provider_usage"])[0];
		expect(noResets?.text).toBe("Usage: Codex 50% (5hr) · 30% (7d)");

		config.segments.provider_usage.display = "compact";
		const compact = resolveSegments(snapshot, config, ["provider_usage"])[0];
		expect(compact?.text).toBe("Usage: 50% · 30%");

		config.usage.showResetTime = true;
		const compactWithResets = resolveSegments(snapshot, config, ["provider_usage"])[0];
		expect(compactWithResets?.text).toBe("Usage: 50% (reset 4h) · 30% (reset 7d)");
	});

	it("renders the three Context display presets and configurable thresholds", () => {
		const snapshot = snapshotWith({
			conversation: { context: { usedTokens: 200_000, limitTokens: 272_000, usedPercent: 64.4 } },
		});
		const config = createDefaultConfig();
		config.style.labelMode = "detailed";
		config.thresholds.context = { warning: 60, error: 90 };
		config.segments.context.display = "compact";
		const compact = resolveSegments(snapshot, config, ["context"])[0];
		expect(compact?.text).toBe("Context: 64.4%");

		config.segments.context.display = "hybrid";
		const hybrid = resolveSegments(snapshot, config, ["context"])[0];
		expect(hybrid?.text).toBe("Context: 272k × 64.4%");

		config.segments.context.display = "full";
		const context = resolveSegments(snapshot, config, ["context"])[0];
		expect(context?.text).toBe("Context: 200k/272k (64.4%)");
		expect(context?.state).toBe("warning");

		const usageConfig = createDefaultConfig();
		usageConfig.thresholds.providerUsage = { warning: 50, error: 90 };
		const usage = resolveSegments(
			snapshotWith({
				providerUsage: {
					provider: "openai-codex",
					state: "fresh",
					windows: [{ id: "5h", label: "5h", usedPercent: 60, state: "normal" }],
				},
			}),
			usageConfig,
			["provider_usage"],
		)[0];
		expect(usage?.state).toBe("warning");
	});

	it("assigns semantic states to Git, cache, context, and provider usage", () => {
		const snapshot = snapshotWith({
			repository: {
				isRepository: true,
				branch: "main",
				dirty: true,
				staged: true,
				changedFiles: 2,
				conflicts: 0,
				state: "fresh",
			},
			conversation: {
				context: { usedPercent: 95, limitTokens: 100_000 },
				cache: { read: 0, write: 100, state: "miss" },
			},
			providerUsage: {
				provider: "openai-codex",
				state: "fresh",
				windows: [{ id: "5h", label: "5h", usedPercent: 92, state: "warning" }],
			},
		});
		const config = createDefaultConfig();
		const segments = resolveSegments(snapshot, config, [
			"git",
			"context",
			"cache",
			"provider_usage",
		]);

		expect(segments.map((segment) => segment.state)).toEqual([
			"warning",
			"error",
			"warning",
			"warning",
		]);
		expect(segments.find((segment) => segment.id === "provider_usage")?.parts).toMatchObject([
			{ text: "Usage: ", role: "dim" },
			{ text: "Codex", role: "accent" },
			{ text: " 92% (5hr)", state: "warning" },
		]);
	});
});
