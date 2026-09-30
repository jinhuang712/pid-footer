import { describe, expect, it } from "vitest";
import {
	applyBuiltInPreset,
	applyCustomPreset,
	footerPreviewLines,
	parseFooterCommand,
	runFooterWizard,
	type WizardSaveCallback,
	type WizardSaveResult,
	type WizardSelectRequest,
} from "../src/commands.js";
import { createDefaultConfig } from "../src/config/defaults.js";
import type { FooterConfig } from "../src/config/types.js";
import type { LayoutEditorRequest, LayoutEditorResult } from "../src/settings-ui.js";
import { createEmptySnapshot } from "../src/state/snapshot.js";

function okSave(): { save: WizardSaveCallback; snapshots: FooterConfig[] } {
	const snapshots: FooterConfig[] = [];
	return {
		save: (config: FooterConfig): WizardSaveResult => {
			snapshots.push(structuredClone(config));
			return { ok: true };
		},
		snapshots,
	};
}

function failingSave(failOnCall: number): { save: WizardSaveCallback; calls: number[] } {
	let call = 0;
	const calls: number[] = [];
	const save: WizardSaveCallback = (): WizardSaveResult => {
		call += 1;
		calls.push(call);
		return call === failOnCall ? { ok: false, message: "disk error" } : { ok: true };
	};
	return { save, calls };
}

interface ScriptedUi {
	titles: string[];
	select(request: WizardSelectRequest): Promise<string | undefined>;
	input?(title: string, placeholder?: string): Promise<string | undefined>;
}

function scripted(...answers: Array<string | undefined>): ScriptedUi {
	let index = 0;
	const titles: string[] = [];
	return {
		titles,
		async select(request: WizardSelectRequest) {
			titles.push(request.title);
			return answers[index++];
		},
	};
}

function withInput(ui: ScriptedUi, ...inputs: Array<string | undefined>): ScriptedUi {
	let index = 0;
	return {
		...ui,
		async input() {
			return inputs[index++];
		},
	};
}

function customConfig(): FooterConfig {
	const config = createDefaultConfig();
	config.preset = "custom";
	return config;
}

describe("footer command parsing", () => {
	it("opens the wizard for an empty command and recognizes every subcommand", () => {
		expect(parseFooterCommand(" ")).toEqual({ kind: "wizard" });
		expect(parseFooterCommand("toggle")).toEqual({ kind: "toggle" });
		expect(parseFooterCommand("compact")).toEqual({ kind: "preset", preset: "compact" });
		expect(parseFooterCommand("minimal")).toEqual({ kind: "preset", preset: "compact" });
		expect(parseFooterCommand("refresh")).toEqual({ kind: "refresh" });
		expect(parseFooterCommand("status")).toEqual({ kind: "status" });
		expect(parseFooterCommand("help")).toEqual({ kind: "help" });
		expect(parseFooterCommand("unknown")).toEqual({ kind: "invalid", argument: "unknown" });
	});
});

describe("built-in presets", () => {
	it("resets preset-owned Segment settings but preserves global preferences", () => {
		const config = createDefaultConfig();
		config.segments.cache.enabled = false;
		config.segments.context.display = "compact";
		config.style.icons = "minimal";
		config.style.labelMode = "detailed";
		applyBuiltInPreset(config, "balanced");
		expect(config.preset).toBe("balanced");
		expect(config.layout.rows.map((row) => row.id)).toEqual([
			"project",
			"git",
			"usage",
			"session",
			"extensions",
		]);
		expect(config.segments.cache).toEqual({ enabled: true, display: "read-write-hit" });
		expect(config.segments.context).toEqual({ enabled: true, display: "hybrid" });
		expect(config.segments.provider_usage).toEqual({ enabled: true, display: "standard" });
		expect(config.style.icons).toBe("minimal");
		expect(config.style.labelMode).toBe("automatic");
	});

	it("renders compact as two rows while keeping the other presets at four rows", () => {
		const compact = createDefaultConfig();
		applyBuiltInPreset(compact, "compact");
		const compactLines = footerPreviewLines(compact, 120);
		expect(compactLines).toHaveLength(2);
		expect(compactLines.join("\n")).toContain("Usage: 58% (reset 4h) · 9%");
		expect(compactLines.join("\n")).not.toContain("diff");

		const balanced = createDefaultConfig();
		applyBuiltInPreset(balanced, "balanced");
		expect(footerPreviewLines(balanced, 120)).toHaveLength(4);
		expect(footerPreviewLines(balanced, 120).join("\n")).toContain(
			"Usage: Codex 58% (5hr, reset 4h)",
		);

		const detailed = createDefaultConfig();
		applyBuiltInPreset(detailed, "detailed");
		const detailedText = footerPreviewLines(detailed, 120).join("\n");
		expect(footerPreviewLines(detailed, 120)).toHaveLength(4);
		expect(detailedText).toContain("diff");
		expect(detailedText).toContain("resets in");
	});

	it("restores the current profile when entering Custom mode", () => {
		const config = createDefaultConfig();
		applyBuiltInPreset(config, "balanced");
		config.style.icons = "minimal";
		applyCustomPreset(config);

		expect(config.preset).toBe("custom");
		expect(config.segments.cwd.display).toBe("tilde");
		expect(config.segments.git.display).toBe("full");
		expect(config.segments.tokens.display).toBe("standard");
		expect(config.segments.cache.display).toBe("compact");
		expect(config.segments.provider_usage.display).toBe("detailed");
		expect(config.style.icons).toBe("minimal");
	});

	it("renders a live plain-text preview from the draft", () => {
		const lines = footerPreviewLines(createDefaultConfig(), 120);
		expect(lines.join("\n")).toContain("openai-codex: gpt-5.6-luna (xhigh)");
		expect(lines.join("\n")).toContain("Context:");
		expect(lines.some((line) => line.includes("\u001b["))).toBe(false);
	});

	it("uses the supplied runtime snapshot instead of fabricating Git availability", () => {
		const snapshot = createEmptySnapshot();
		snapshot.session = {
			...snapshot.session,
			cwd: "/workspace",
			provider: "openai-codex",
			model: "gpt-5.6",
		};
		const lines = footerPreviewLines(createDefaultConfig(), 120, undefined, snapshot);
		expect(lines.join("\n")).toContain("Project: /workspace");
		expect(lines.join("\n")).not.toContain("Git:");
	});
});

describe("Speed settings", () => {
	it("appears in Components and immediately saves visibility and label changes", async () => {
		const { save, snapshots } = okSave();
		const requests: WizardSelectRequest[] = [];
		const answers = [
			"Speed — Show Speed · Label",
			"Show Speed: Off",
			"Show Speed: On",
			"Label: Speed",
			undefined,
			undefined,
		];
		const result = await runFooterWizard(
			customConfig(),
			{
				async select(request) {
					requests.push(request);
					return answers.shift();
				},
				async input(title) {
					expect(title).toBe("Speed label");
					return "Output rate";
				},
			},
			save,
		);
		expect(requests[0]?.tabs?.[1]?.options).toContain("Speed — Show Speed · Label");
		expect(requests[1]?.options).toEqual(["Show Speed: On", "Label: Speed"]);
		expect(snapshots).toHaveLength(3);
		expect(snapshots[0]?.segments.speed.enabled).toBe(false);
		expect(snapshots[0]?.layout.rows.flatMap((row) => [...row.left, ...row.right])).not.toContain(
			"speed",
		);
		expect(snapshots[1]?.layout.rows.find((row) => row.id === "session")?.left).toContain("speed");
		expect(result.segments.speed).toEqual({ enabled: true, label: "Output rate" });
		expect(result.segments.tokens.enabled).toBe(true);
		expect(footerPreviewLines(result, 120).join("\n")).toContain("Output rate: 42.5 tok/s");
	});

	it("rolls back Speed visibility and layout on save failure", async () => {
		const config = customConfig();
		const { save, calls } = failingSave(1);
		const result = await runFooterWizard(
			config,
			scripted("Speed — Show Speed · Label", "Show Speed: Off", undefined, undefined),
			save,
		);
		expect(calls).toEqual([1]);
		expect(result.segments.speed).toEqual(config.segments.speed);
		expect(result.layout).toEqual(config.layout);
	});

	it("shows Speed read-only in preset mode", async () => {
		const config = customConfig();
		applyBuiltInPreset(config, "balanced");
		const { save, snapshots } = okSave();
		const requests: WizardSelectRequest[] = [];
		await runFooterWizard(
			config,
			{
				async select(request) {
					requests.push(request);
					return requests.length === 1 ? "Speed — Show Speed · Label" : undefined;
				},
			},
			save,
		);
		expect(requests[0]?.tabs?.[1]?.options).toContain("Speed — Show Speed · Label 🔒");
		expect(requests[1]?.options).toEqual(["Show Speed: On", "Label: Speed"]);
		expect(snapshots).toEqual([]);
	});

	it("lets Layout move Speed independently and keeps previews within width", async () => {
		const { save, snapshots } = okSave();
		let selected = false;
		const result = await runFooterWizard(
			customConfig(),
			{
				async select() {
					if (selected) return undefined;
					selected = true;
					return "Layout — Canvas · Move Segments · Add/Clear rows";
				},
				async layout(request) {
					expect(request.labels?.speed).toBe("Speed");
					const rows = structuredClone([...request.rows]);
					for (const row of rows) {
						row.left = row.left.filter((id) => id !== "speed");
						row.right = row.right.filter((id) => id !== "speed");
					}
					rows[0]?.right.push("speed");
					return rows;
				},
			},
			save,
		);
		expect(result.layout.rows[0]?.right).toContain("speed");
		expect(result.layout.rows.find((row) => row.id === "session")?.left).toEqual(["tokens"]);
		expect(snapshots).toHaveLength(1);
		for (const width of [40, 60, 80, 120]) {
			for (const line of footerPreviewLines(result, width))
				expect(line.length).toBeLessThanOrEqual(width);
		}
	});
});

describe("root menu", () => {
	it("uses the runtime snapshot in interactive previews", async () => {
		const snapshot = createEmptySnapshot();
		snapshot.session = {
			...snapshot.session,
			cwd: "/workspace/live-project",
			provider: "openai-codex",
			model: "gpt-5.6",
		};
		const requests: WizardSelectRequest[] = [];
		const ui = {
			async select(request: WizardSelectRequest) {
				requests.push(request);
				return undefined;
			},
			previewSnapshot: () => snapshot,
		};

		await runFooterWizard(createDefaultConfig(), ui, okSave().save);

		const preview = requests[0]?.preview;
		expect(preview).toBeTypeOf("function");
		expect((preview as (width: number) => string[])(120).join("\n")).toContain(
			"Project: /workspace/live-project",
		);
		expect((preview as (width: number) => string[])(120).join("\n")).not.toContain("~/dev/project");
	});

	it("puts Footer first and disables the other root settings when it is off", async () => {
		const requests: WizardSelectRequest[] = [];
		const ui: ScriptedUi = {
			titles: [],
			async select(request) {
				requests.push(request);
				return requests.length === 1
					? "Mode: balanced - [compact / balanced / detailed / custom] 🔒"
					: undefined;
			},
		};
		const config = createDefaultConfig();
		config.enabled = false;
		const { save, snapshots } = okSave();
		await runFooterWizard(config, ui, save);
		const options = requests[0]?.options ?? [];
		expect(options[0]).toBe("Footer: Off");
		expect(options[1]).toContain("Mode: custom");
		expect(options[1]).toContain("🔒");
		expect(options[2]).toContain("🔒");
		expect(options.at(-1)).toContain("Project-specific settings");
		expect(options.at(-1)).toContain("🔒");
		expect(snapshots).toEqual([]);
	});

	it("exits the wizard when Esc is pressed at the root", async () => {
		const { save, snapshots } = okSave();
		const ui = scripted(undefined);
		const result = await runFooterWizard(createDefaultConfig(), ui, save);
		expect(result.preset).toBe("custom");
		expect(snapshots).toEqual([]);
	});

	it("describes category settings instead of showing current values in the root menu", async () => {
		const { save } = okSave();
		const requests: WizardSelectRequest[] = [];
		const ui: ScriptedUi = {
			titles: [],
			async select(request) {
				requests.push(request);
				return undefined;
			},
		};
		await runFooterWizard(customConfig(), ui, save);
		const options = requests[0]?.options ?? [];
		expect(options).toContain("Appearance — Detail level · Color · Icons · Separator");
		expect(options).toContain("Project — Show Project · Display · Label");
		expect(options).toContain("Usage — Show Usage · Display · Windows · Resets · Alerts · Refresh");
		expect(options).not.toContain("Appearance — automatic · semantic · icons off · dot");
		expect(options).not.toContain("Customize with Custom mode");
		expect(options).not.toContain("Exit settings");
		expect(requests[0]?.tabs?.map((tab) => tab.title)).toEqual([
			"General",
			"Components",
			"Layout",
			"Appearance",
		]);
		expect(requests[0]?.tabs?.[0]?.options).toEqual([
			"Footer: On",
			"Mode: custom - [compact / balanced / detailed / custom]",
			"Project-specific settings: Off",
		]);
		expect(requests[0]?.tabs?.[1]?.options).toContain(
			"Models & Providers — Identity style · Provider · Model · Thinking · Label",
		);
		expect(requests[0]?.tabs?.[2]?.options).toEqual([]);
		expect(requests[0]?.tabs?.[2]?.activateOnTab).toBe(
			"Layout — Canvas · Move Segments · Add/Clear rows",
		);
		expect(requests[0]?.tabs?.[3]?.options).toEqual([
			"Detail level: automatic - [automatic / brief / labeled / detailed]",
			"Color: semantic - [semantic / monochrome]",
			"Icons: off - [off / minimal / nerd / emoji]",
			"Separator: dot - [none / dot / bar / slash]",
		]);
	});

	it("locks Component and Appearance tab entries in preset mode", async () => {
		const requests: WizardSelectRequest[] = [];
		const ui: ScriptedUi = {
			titles: [],
			async select(request) {
				requests.push(request);
				return undefined;
			},
		};
		const presetConfig = createDefaultConfig();
		applyBuiltInPreset(presetConfig, "balanced");
		await runFooterWizard(presetConfig, ui, okSave().save);
		expect(
			requests[0]?.tabs?.[0]?.options.slice(0, 2).every((option) => !option.endsWith("🔒")),
		).toBe(true);
		expect(requests[0]?.tabs?.[1]?.options.every((option) => option.endsWith("🔒"))).toBe(true);
		expect(requests[0]?.tabs?.[3]?.options.every((option) => option.endsWith("🔒"))).toBe(true);
	});

	it("shows category-specific read-only settings in preset mode", async () => {
		const requests: WizardSelectRequest[] = [];
		const ui: ScriptedUi = {
			titles: [],
			async select(request) {
				requests.push(request);
				return requests.length === 1
					? "Appearance — Detail level · Color · Icons · Separator"
					: undefined;
			},
		};
		const presetConfig = createDefaultConfig();
		applyBuiltInPreset(presetConfig, "balanced");
		await runFooterWizard(presetConfig, ui, okSave().save);
		const categoryOptions = requests[1]?.options ?? [];
		expect(categoryOptions).toContain(
			"Detail level: automatic - [automatic / brief / labeled / detailed]",
		);
		expect(categoryOptions).toContain("Color: semantic - [semantic / monochrome]");
		expect(categoryOptions).not.toEqual(["Current: automatic · semantic · icons off · dot"]);
	});

	it("keeps categories read-only while a preset is active", async () => {
		const { save, snapshots } = okSave();
		const ui = scripted(
			"Context \u2014 Show Context \u00b7 Display \u00b7 Label",
			undefined,
			undefined,
		);
		const presetConfig = createDefaultConfig();
		applyBuiltInPreset(presetConfig, "balanced");
		const result = await runFooterWizard(presetConfig, ui, save);
		expect(result.preset).toBe("balanced");
		expect(snapshots).toEqual([]);
	});

	it("toggles project-specific settings independently of the active preset", async () => {
		const { save, snapshots } = okSave();
		const ui = scripted("Project-specific settings: On", undefined);
		const result = await runFooterWizard(createDefaultConfig(), ui, save);
		expect(result.projectOverrides.enabled).toBe(true);
		expect(snapshots).toHaveLength(1);
	});

	it("toggles Footer On/Off while a preset is active", async () => {
		const { save, snapshots } = okSave();
		const ui = scripted("Footer: Off", undefined);
		const result = await runFooterWizard(createDefaultConfig(), ui, save);
		expect(result.enabled).toBe(false);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.enabled).toBe(false);
	});

	it("switches to custom mode and back to a preset through Mode", async () => {
		const { save } = okSave();
		const ui = scripted(
			"Mode: custom - [compact / balanced / detailed / custom]",
			"Mode: compact - [compact / balanced / detailed / custom]",
			undefined,
		);
		const result = await runFooterWizard(createDefaultConfig(), ui, save);
		expect(result.preset).toBe("compact");
		expect(result.layout.rows.map((row) => row.id)).toEqual(["overview", "session"]);
	});

	it("rolls back a change when save fails", async () => {
		const { save, calls } = failingSave(1);
		const ui = scripted("Footer: Off", undefined);
		const result = await runFooterWizard(createDefaultConfig(), ui, save);
		expect(result.enabled).toBe(true);
		expect(calls).toEqual([1]);
	});
});

describe("Appearance", () => {
	it("edits a flattened appearance value directly from its root tab", async () => {
		const { save, snapshots } = okSave();
		const ui = scripted("Color: monochrome - [semantic / monochrome]", undefined);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.style.colorMode).toBe("monochrome");
		expect(snapshots).toHaveLength(1);
	});

	it("edits color and separator immediately", async () => {
		const { save, snapshots } = okSave();
		const ui = scripted(
			"Appearance \u2014 Detail level \u00b7 Color \u00b7 Icons \u00b7 Separator",
			"Color: monochrome",
			"Separator: bar",
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.style.colorMode).toBe("monochrome");
		expect(result.style.separator).toBe("bar");
		expect(snapshots).toHaveLength(2);
	});
});

describe("simple show/label categories", () => {
	it("hides Project and renames its label", async () => {
		const { save } = okSave();
		const ui = withInput(
			scripted(
				"Project \u2014 Show Project \u00b7 Display \u00b7 Label",
				"Display: home-relative (~) - [folder name / home-relative (~) / full path]",
				"Label: Project",
				"Show Project: Off",
				undefined,
			),
			"Workdir",
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.segments.cwd.enabled).toBe(false);
		expect(result.segments.cwd.display).toBe("tilde");
		expect(result.segments.cwd.label).toBe("Workdir");
		expect(result.layout.rows.flatMap((row) => [...row.left, ...row.right])).not.toContain("cwd");
	});

	it("rejects unsafe labels without writing a partial configuration", async () => {
		const { save, snapshots } = okSave();
		const ui = withInput(
			scripted(
				"Project \u2014 Show Project \u00b7 Display \u00b7 Label",
				"Label: Project",
				undefined,
			),
			"a".repeat(41),
		);

		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.segments.cwd.label).toBeUndefined();
		expect(snapshots).toEqual([]);
	});

	it("restores a re-enabled Segment to its default row even when no rows remain", async () => {
		const { save } = okSave();
		const config = customConfig();
		config.segments.cost.enabled = false;
		config.layout.rows = [];
		const ui = scripted(
			"Cost \u2014 Show Cost \u00b7 Display \u00b7 Notation \u00b7 Label",
			"Show Cost: On",
			undefined,
		);
		const result = await runFooterWizard(config, ui, save);
		expect(result.layout.rows.find((row) => row.id === "usage")?.right).toContain("cost");
	});

	it("does not keep a row after its last Segment is hidden", async () => {
		const { save } = okSave();
		const config = customConfig();
		config.layout.rows = [
			{ id: "only", left: ["cost"], right: [], visible: "always", overflow: "hide" },
		];
		const ui = scripted(
			"Cost \u2014 Show Cost \u00b7 Display \u00b7 Notation \u00b7 Label",
			"Show Cost: Off",
			undefined,
		);
		const result = await runFooterWizard(config, ui, save);
		expect(result.layout.rows).toEqual([]);
	});

	it("switches Cost density and notation independently", async () => {
		const { save } = okSave();
		const ui = scripted(
			"Cost \u2014 Show Cost \u00b7 Display \u00b7 Notation \u00b7 Label",
			"Display: Full - [Compact / Standard / Full]",
			"Notation: Full labels - [Arrows / Short / Full labels]",
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.segments.cost.display).toBe("full");
		expect(result.segments.cost.notation).toBe("full");
	});
});

describe("Context", () => {
	it("switches the display preset and renames the label", async () => {
		const { save } = okSave();
		const ui = withInput(
			scripted(
				"Context \u2014 Show Context \u00b7 Display \u00b7 Label",
				"Display: Full - [Compact / Hybrid / Full]",
				"Display: Hybrid - [Compact / Hybrid / Full]",
				"Label: Context",
				undefined,
			),
			"Window",
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.segments.context.display).toBe("hybrid");
		expect(result.segments.context.label).toBe("Window");
	});

	it("shows and hides Context", async () => {
		const { save } = okSave();
		const ui = scripted(
			"Context \u2014 Show Context \u00b7 Display \u00b7 Label",
			"Show Context: Off",
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.segments.context.enabled).toBe(false);
	});
});

describe("Usage", () => {
	it("rejects invalid thresholds without saving", async () => {
		const { save, snapshots } = okSave();
		const ui = withInput(
			scripted(
				"Usage \u2014 Show Usage \u00b7 Display \u00b7 Windows \u00b7 Resets \u00b7 Alerts \u00b7 Refresh",
				"Warning threshold: 70%",
				undefined,
			),
			"101",
		);

		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.thresholds.providerUsage.warning).toBe(70);
		expect(snapshots).toEqual([]);
	});

	it("edits display and refresh tier", async () => {
		const { save } = okSave();
		const ui = scripted(
			"Usage \u2014 Show Usage \u00b7 Display \u00b7 Windows \u00b7 Resets \u00b7 Alerts \u00b7 Refresh",
			"Refresh: 5 minutes",
			"\u2192 Every 30 seconds",
			undefined,
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.usage.refreshSeconds).toBe(30);
	});

	it("edits Usage windows and reset visibility independently", async () => {
		const { save, snapshots } = okSave();
		const ui = scripted(
			"Usage \u2014 Show Usage \u00b7 Display \u00b7 Windows \u00b7 Resets \u00b7 Alerts \u00b7 Refresh",
			"Windows: 5h \u00b7 Week (7d)",
			"Month (30d): On",
			undefined,
			"Resets: Off",
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.usage.windows).toEqual(["5h", "week", "month"]);
		expect(result.usage.showResetTime).toBe(false);
		expect(snapshots).toHaveLength(2);
	});

	it("shows and hides Usage as one setting covering both the manager and the Segment", async () => {
		const { save } = okSave();
		const ui = scripted(
			"Usage \u2014 Show Usage \u00b7 Display \u00b7 Windows \u00b7 Resets \u00b7 Alerts \u00b7 Refresh",
			"Show Usage: Off",
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		expect(result.usage.enabled).toBe(false);
		expect(result.segments.provider_usage.enabled).toBe(false);
	});
});

describe("Models & Providers", () => {
	it("collapses identity parts across rows into one placement", async () => {
		const { save } = okSave();
		const config = customConfig();
		config.layout.rows = [
			{ id: "provider-row", left: ["provider"], right: [], visible: "always", overflow: "hide" },
			{ id: "model-row", left: [], right: ["model"], visible: "always", overflow: "hide" },
			{ id: "thinking-row", left: ["thinking"], right: [], visible: "always", overflow: "hide" },
		];
		const ui = scripted(
			"Models & Providers \u2014 Identity style \u00b7 Provider \u00b7 Model \u00b7 Thinking \u00b7 Label",
			"Identity style: collapsed",
			undefined,
		);

		const result = await runFooterWizard(config, ui, save);
		const references = result.layout.rows.flatMap((row) => [...row.left, ...row.right]);
		expect(references).toEqual(["identity"]);
		expect(result.layout.rows.map((row) => row.id)).toEqual(["provider-row"]);
	});

	it("expands a collapsed identity only once across a custom layout", async () => {
		const { save } = okSave();
		const config = customConfig();
		config.layout.rows = [
			{ id: "identity-row", left: ["identity"], right: [], visible: "always", overflow: "hide" },
			{ id: "extra-row", left: ["provider"], right: [], visible: "always", overflow: "hide" },
		];
		const ui = scripted(
			"Models & Providers \u2014 Identity style \u00b7 Provider \u00b7 Model \u00b7 Thinking \u00b7 Label",
			"Identity style: separate",
			undefined,
		);

		const result = await runFooterWizard(config, ui, save);
		const identityRow = result.layout.rows.find((row) => row.id === "identity-row");
		expect(identityRow?.left).toEqual(["provider", "model", "thinking"]);
		expect(result.layout.rows.map((row) => row.id)).toEqual(["identity-row"]);
	});

	it("switches to separate identity and toggles individual fields with layout placement", async () => {
		const { save } = okSave();
		const ui = scripted(
			"Models & Providers \u2014 Identity style \u00b7 Provider \u00b7 Model \u00b7 Thinking \u00b7 Label",
			"Identity style: separate",
			"Thinking: Off",
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		const references = result.layout.rows.flatMap((row) => [...row.left, ...row.right]);
		expect(references).toEqual(expect.arrayContaining(["provider", "model"]));
		expect(references).not.toContain("thinking");
		expect(references).not.toContain("identity");
		expect(result.segments.thinking.enabled).toBe(false);
	});

	it("rolls back the layout change when save fails", async () => {
		const { save, calls } = failingSave(1);
		const ui = scripted(
			"Models & Providers \u2014 Identity style \u00b7 Provider \u00b7 Model \u00b7 Thinking \u00b7 Label",
			"Identity style: separate",
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		const references = result.layout.rows.flatMap((row) => [...row.left, ...row.right]);
		expect(references).toContain("identity");
		expect(calls).toEqual([1]);
	});
});

describe("Layout", () => {
	it("does not pass legacy empty rows to the spatial editor", async () => {
		let receivedRows: FooterConfig["layout"]["rows"] | undefined;
		const config = customConfig();
		config.layout.rows.splice(1, 0, {
			id: "legacy-empty",
			left: [],
			right: [],
			visible: "always",
			overflow: "hide",
		});
		const ui: ScriptedUi & {
			layout(request: LayoutEditorRequest): Promise<FooterConfig["layout"]["rows"]>;
		} = {
			titles: [],
			async select(request) {
				ui.titles.push(request.title);
				return ui.titles.length === 1
					? "Layout \u2014 Canvas \u00b7 Move Segments \u00b7 Add/Clear rows"
					: undefined;
			},
			async layout(request) {
				receivedRows = structuredClone([...request.rows]);
				return structuredClone([...request.rows]);
			},
		};

		const result = await runFooterWizard(config, ui, okSave().save);
		expect(receivedRows?.some((row) => row.id === "legacy-empty")).toBe(false);
		expect(result.layout.rows.some((row) => row.id === "legacy-empty")).toBe(false);
	});

	it("exits the wizard when Esc leaves the spatial Layout editor", async () => {
		const ui: ScriptedUi & {
			layout(request: LayoutEditorRequest): Promise<LayoutEditorResult>;
		} = {
			titles: [],
			async select(request) {
				ui.titles.push(request.title);
				return ui.titles.length === 1
					? "Layout — Canvas · Move Segments · Add/Clear rows"
					: undefined;
			},
			async layout() {
				return { kind: "exit" };
			},
		};

		await runFooterWizard(customConfig(), ui, okSave().save);
		expect(ui.titles).toHaveLength(1);
	});

	it("uses the spatial editor when the TUI host provides it", async () => {
		let layoutRequest: LayoutEditorRequest | undefined;
		const ui: ScriptedUi & {
			layout(request: LayoutEditorRequest): Promise<FooterConfig["layout"]["rows"]>;
		} = {
			titles: [],
			async select(request) {
				ui.titles.push(request.title);
				return ui.titles.length === 1
					? "Layout — Canvas · Move Segments · Add/Clear rows"
					: undefined;
			},
			async layout(request) {
				layoutRequest = request;
				return structuredClone([...request.rows]);
			},
		};
		await runFooterWizard(customConfig(), ui, okSave().save);
		expect(layoutRequest?.title).toBe("Layout — arrange Segments");
		expect(layoutRequest?.labels?.cwd).toBe("Project");
		expect(layoutRequest?.rows[0]?.left).toEqual(["cwd"]);
		expect(layoutRequest?.rows[0]?.right).toEqual(["identity"]);
	});

	it("persists the layout returned by a confirmed editor change", async () => {
		const { save, snapshots } = okSave();
		const ui: ScriptedUi & {
			layout(request: LayoutEditorRequest): Promise<FooterConfig["layout"]["rows"]>;
		} = {
			titles: [],
			async select(request) {
				ui.titles.push(request.title);
				return ui.titles.length === 1
					? "Layout — Canvas · Move Segments · Add/Clear rows"
					: undefined;
			},
			async layout(request) {
				const next = structuredClone([...request.rows]);
				const first = next[0];
				const second = next[1];
				if (!first || !second) throw new Error("expected default layout rows");
				first.left = [];
				first.right = [];
				second.left.push("cwd");
				await request.onChange?.(next, "Project moved");
				return next;
			},
		};
		await runFooterWizard(customConfig(), ui, save);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.layout.rows[0]?.id).toBe("git");
		expect(snapshots[0]?.layout.rows[0]?.left).toEqual(["git", "cwd"]);
		expect(
			snapshots[0]?.layout.rows.every((row) => row.left.length > 0 || row.right.length > 0),
		).toBe(true);
	});

	it("does not retry a failed layout save after cleanup", async () => {
		const { save, calls } = failingSave(1);
		const ui: ScriptedUi & {
			layout(request: LayoutEditorRequest): Promise<FooterConfig["layout"]["rows"]>;
		} = {
			titles: [],
			async select(request) {
				ui.titles.push(request.title);
				return ui.titles.length === 1
					? "Layout \u2014 Canvas \u00b7 Move Segments \u00b7 Add/Clear rows"
					: undefined;
			},
			async layout(request) {
				const next = structuredClone([...request.rows]);
				const first = next[0];
				const second = next[1];
				if (!first || !second) throw new Error("expected default layout rows");
				first.left = [];
				first.right = [];
				second.left.push("cwd");
				await request.onChange?.(next, "Project moved");
				return next;
			},
		};

		const result = await runFooterWizard(customConfig(), ui, save);
		expect(calls).toEqual([1]);
		expect(result.layout.rows[0]?.id).toBe("project");
		expect(result.layout.rows[0]?.left).toContain("cwd");
	});

	it("lists the Layout category in the root menu", async () => {
		const requests: WizardSelectRequest[] = [];
		const ui: ScriptedUi = {
			titles: [],
			async select(request) {
				requests.push(request);
				return undefined;
			},
		};
		await runFooterWizard(customConfig(), ui, okSave().save);
		const options = requests[0]?.options ?? [];
		expect(options).toContain("Layout \u2014 Canvas \u00b7 Move Segments \u00b7 Add/Clear rows");
	});

	it("lists every Segment with its row and group", async () => {
		const requests: WizardSelectRequest[] = [];
		const ui: ScriptedUi = {
			titles: [],
			async select(request) {
				requests.push(request);
				return requests.length === 1
					? "Layout \u2014 Canvas \u00b7 Move Segments \u00b7 Add/Clear rows"
					: undefined;
			},
		};
		await runFooterWizard(customConfig(), ui, okSave().save);
		const layoutOptions = requests[1]?.options ?? [];
		expect(layoutOptions).toContain("Segment: cwd \u2014 row project \u00b7 left");
		expect(layoutOptions).toContain("Segment: git \u2014 row git \u00b7 left");
		expect(layoutOptions).toContain("Segment: context \u2014 row git \u00b7 right");
		expect(layoutOptions).toContain("Segment: cost \u2014 row usage \u00b7 right");
	});

	it("flips a Segment between left and right groups", async () => {
		const { save, snapshots } = okSave();
		const ui = scripted(
			"Layout \u2014 Canvas \u00b7 Move Segments \u00b7 Add/Clear rows",
			"Segment: context \u2014 row git \u00b7 right",
			"Side: left - [left / right]",
			undefined,
			undefined,
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		const gitRow = result.layout.rows.find((row) => row.id === "git");
		expect(gitRow?.right).not.toContain("context");
		expect(gitRow?.left).toContain("context");
		expect(snapshots.length).toBeGreaterThan(0);
	});

	it("moves a Segment to another row keeping its group", async () => {
		const { save } = okSave();
		const ui = scripted(
			"Layout \u2014 Canvas \u00b7 Move Segments \u00b7 Add/Clear rows",
			"Segment: context \u2014 row git \u00b7 right",
			"Row: session - [project / git / usage / session / extensions]",
			undefined,
			undefined,
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		const gitRow = result.layout.rows.find((row) => row.id === "git");
		const session = result.layout.rows.find((row) => row.id === "session");
		expect(gitRow?.right).not.toContain("context");
		expect(session?.right).toContain("context");
	});

	it("rolls back a moved Segment when save fails", async () => {
		const { save, calls } = failingSave(1);
		const ui = scripted(
			"Layout \u2014 Canvas \u00b7 Move Segments \u00b7 Add/Clear rows",
			"Segment: context \u2014 row git \u00b7 right",
			"Row: session - [project / git / usage / session / extensions]",
			undefined,
			undefined,
			undefined,
		);
		const result = await runFooterWizard(customConfig(), ui, save);
		const gitRow = result.layout.rows.find((row) => row.id === "git");
		expect(gitRow?.right).toContain("context");
		expect(calls).toEqual([1]);
	});

	it("keeps fallback Row selection valid after removing an empty source Row", async () => {
		const config = customConfig();
		config.layout.rows = [
			{ id: "source", left: [], right: ["cost"], visible: "always", overflow: "hide" },
			{ id: "target", left: ["tokens"], right: [], visible: "always", overflow: "hide" },
		];
		const requests: WizardSelectRequest[] = [];
		const ui: ScriptedUi = {
			titles: [],
			async select(request) {
				requests.push(request);
				if (requests.length === 1)
					return "Layout \u2014 Canvas \u00b7 Move Segments \u00b7 Add/Clear rows";
				if (request.title === "Layout \u2014 move Segments") {
					return requests.filter((item) => item.title === request.title).length === 1
						? "Segment: cost \u2014 row source \u00b7 right"
						: undefined;
				}
				if (request.title === "Move: cost") {
					return requests.filter((item) => item.title === request.title).length === 1
						? "Row: target - [source / target]"
						: undefined;
				}
				return undefined;
			},
		};
		const result = await runFooterWizard(config, ui, okSave().save);
		const moveRequests = requests.filter((request) => request.title === "Move: cost");
		expect(moveRequests[1]?.options).toContain("Row: target - [target]");
		expect(moveRequests[1]?.options).not.toContain("Row: ? - [source / target]");
		expect(result.layout.rows).toEqual([
			{ id: "target", left: ["tokens"], right: ["cost"], visible: "always", overflow: "hide" },
		]);
	});
});
