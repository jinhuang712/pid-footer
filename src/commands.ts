import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
	cloneConfig,
	createCustomDefaultConfig,
	createPresetSegmentConfig,
	layoutForPreset,
} from "./config/defaults.js";
import {
	cleanLayoutRows,
	type LayoutSegmentPosition,
	layoutPositions,
	moveLayoutSegment,
	setLayoutSegmentSide,
} from "./config/layout.js";
import {
	CACHE_DISPLAY_UI_ORDER,
	COLOR_MODES,
	CONTEXT_DISPLAY_STYLES,
	CONTEXT_DISPLAY_UI_ORDER,
	COST_DISPLAY_UI_ORDER,
	COST_NOTATION_UI_ORDER,
	type FooterConfig,
	type FooterRowConfig,
	GIT_DISPLAY_UI_ORDER,
	ICON_MODES,
	LABEL_MODES,
	PRESET_NAMES,
	PROJECT_DISPLAY_UI_ORDER,
	type PresetName,
	SEGMENT_DISPLAY_STYLES,
	SEGMENT_IDS,
	SEGMENT_NOTATION_STYLES,
	type SegmentId,
	TOKEN_DISPLAY_UI_ORDER,
	USAGE_DISPLAY_STYLES,
	USAGE_DISPLAY_UI_ORDER,
	USAGE_REFRESH_SECONDS_OPTIONS,
	USAGE_WINDOW_UI_ORDER,
	type UsageWindow,
} from "./config/types.js";
import { layoutFooter } from "./layout/layout-engine.js";
import { prepareSegmentForLayout } from "./render/presentation.js";
import { resolveSegments } from "./segments/registry.js";
import {
	type LayoutEditorRequest,
	type LayoutEditorResult,
	type SettingsTab,
	WIZARD_EXIT,
} from "./settings-ui.js";
import { createEmptySnapshot } from "./state/snapshot.js";
import type { FooterSnapshot } from "./state/types.js";

export interface WizardSelectRequest {
	title: string;
	options: string[];
	tabs?: SettingsTab[];
	initialTab?: number;
	/** Live plain-text preview lines shown above the options. When a function is provided it is called with the current TUI width. */
	preview?: string[] | ((width: number) => string[]);
	/** Left/right cycling groups: option string -> ordered option list. */
	cycles?: Record<string, string[]>;
}

export interface FooterWizardUI {
	select(request: WizardSelectRequest): Promise<string | undefined>;
	input?(title: string, placeholder?: string): Promise<string | undefined>;
	layout?(request: LayoutEditorRequest): Promise<LayoutEditorResult>;
	/** Supplies the same live snapshot used by the installed Footer. */
	previewSnapshot?: () => FooterSnapshot;
}

export type WizardSaveResult = { ok: true } | { ok: false; message: string };
export type WizardSaveCallback = (
	config: FooterConfig,
) => Promise<WizardSaveResult> | WizardSaveResult;

const IDENTITY_PARTS = ["provider", "model", "thinking"] as const;
type IdentityPresentation = "collapsed" | "separate" | "mixed";
type WizardStatus = { message?: string; tabDirection?: 1 | -1 };
type Commit = (message: string) => Promise<boolean>;

/** Legacy escape path retained for non-TUI wizard hosts. */
class WizardExit extends Error {}

function rowValue<T extends string>(
	choice: string,
	prefix: string,
	values: readonly T[],
): T | undefined {
	if (!choice.startsWith(prefix)) return undefined;
	const rest = choice.slice(prefix.length);
	// Options may carry a rolling "a / b / c" hint after " - "; ignore it when matching.
	const dash = rest.indexOf(" - ");
	return values.find((value) => value === (dash >= 0 ? rest.slice(0, dash) : rest));
}

function chainRow(label: string, values: readonly string[], current: string): string {
	return `${label}: ${current} - [${values.join(" / ")}]`;
}

const DISPLAY_VALUE_LABELS: Partial<Record<SegmentId, Record<string, string>>> = {
	cwd: { name: "folder name", tilde: "home-relative (~)", full: "full path" },
	context: { compact: "Compact", hybrid: "Hybrid", full: "Full" },
	tokens: { compact: "Compact", standard: "Standard", full: "Full" },
	cost: { compact: "Compact", standard: "Standard", full: "Full" },
};

const NOTATION_VALUE_LABELS: Record<string, string> = {
	arrows: "Arrows",
	short: "Short",
	full: "Full labels",
};

function displayValueLabel(id: SegmentId, value: string): string {
	return DISPLAY_VALUE_LABELS[id]?.[value] ?? value;
}

function displayChainRow(id: SegmentId, values: readonly string[], current: string): string {
	return chainRow(
		"Display",
		values.map((value) => displayValueLabel(id, value)),
		displayValueLabel(id, current),
	);
}

function displayUiOrder(id: SegmentId): readonly string[] | undefined {
	switch (id) {
		case "context":
			return CONTEXT_DISPLAY_UI_ORDER;
		case "tokens":
			return TOKEN_DISPLAY_UI_ORDER;
		case "cache":
			return CACHE_DISPLAY_UI_ORDER;
		case "git":
			return GIT_DISPLAY_UI_ORDER;
		case "cwd":
			return PROJECT_DISPLAY_UI_ORDER;
		case "cost":
			return COST_DISPLAY_UI_ORDER;
		case "provider_usage":
			return USAGE_DISPLAY_UI_ORDER;
		default:
			return undefined;
	}
}

function displayChainRowWithOrder(
	id: SegmentId,
	order: readonly string[],
	current: string,
): string {
	return chainRow(
		"Display",
		order.map((value) => displayValueLabel(id, value)),
		displayValueLabel(id, current),
	);
}

function displayCycleMapWithOrder(
	id: SegmentId,
	order: readonly string[],
): Record<string, string[]> {
	return Object.fromEntries(
		order.map((value) => [
			displayChainRowWithOrder(id, order, value),
			order.map((candidate) => displayChainRowWithOrder(id, order, candidate)),
		]),
	);
}

function displayValueFromChoice(
	id: SegmentId,
	choice: string,
	values: readonly string[],
): string | undefined {
	const selected = choice.slice("Display: ".length);
	return values.find(
		(value) => selected.startsWith(value) || selected.startsWith(displayValueLabel(id, value)),
	);
}

function notationChainRow(values: readonly string[], current: string): string {
	return chainRow(
		"Notation",
		values.map((value) => NOTATION_VALUE_LABELS[value] ?? value),
		NOTATION_VALUE_LABELS[current] ?? current,
	);
}

function notationCycleMap(values: readonly string[]): Record<string, string[]> {
	return Object.fromEntries(
		values.map((value) => [
			notationChainRow(values, value),
			values.map((candidate) => notationChainRow(values, candidate)),
		]),
	);
}

function notationValueFromChoice(choice: string, values: readonly string[]): string | undefined {
	const selected = choice.slice("Notation: ".length);
	return values.find(
		(value) =>
			selected.startsWith(value) || selected.startsWith(NOTATION_VALUE_LABELS[value] ?? value),
	);
}

function cycleMap(values: readonly string[], label: string): Record<string, string[]> {
	return Object.fromEntries(
		values.map((value) => [
			chainRow(label, values, value),
			values.map((candidate) => chainRow(label, values, candidate)),
		]),
	);
}

function chainCycles(values: readonly string[], label: string): Record<string, string[]> {
	return cycleMap(values, label);
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

const BOLD_ON = "\u001b[1m";
const BOLD_OFF = "\u001b[22m";

const CATEGORY_HIGHLIGHTS: Record<string, readonly SegmentId[]> = {
	Appearance: ["context", "tokens", "cache"],
	Project: ["cwd"],
	Git: ["git"],
	"Models & Providers": ["identity", "provider", "model", "thinking"],
	Usage: ["provider_usage"],
	Context: ["context"],
	Cache: ["cache"],
	Tokens: ["tokens"],
	Speed: ["speed"],
	Cost: ["cost"],
	Layout: SEGMENT_IDS,
};

function highlightIdsForTitle(title: string): readonly SegmentId[] | undefined {
	for (const [key, ids] of Object.entries(CATEGORY_HIGHLIGHTS)) {
		if (title === key || title.startsWith(`${key} \u00b7`) || title.startsWith(`${key} `))
			return ids;
	}
	// Handles "Context (read-only)" etc.
	for (const [key, ids] of Object.entries(CATEGORY_HIGHLIGHTS)) {
		if (title.startsWith(key)) return ids;
	}
	return undefined;
}

/** Render a plain-text Footer preview from a draft configuration and snapshot.
 *  When no snapshot is supplied, a deterministic sample snapshot is used for
 *  non-TUI callers and tests. The interactive extension supplies its live
 *  runtime snapshot so availability matches the installed Footer.
 */
export function footerPreviewLines(
	config: FooterConfig,
	width = 80,
	highlightIds?: readonly SegmentId[],
	snapshot = createSamplePreviewSnapshot(config),
): string[] {
	const references = config.layout.rows.flatMap((row) => [...row.left, ...row.right]);
	const segments = resolveSegments(snapshot, config, references).map((segment) =>
		prepareSegmentForLayout(segment, config.style),
	);
	const layout = layoutFooter(snapshot, config, segments, width);
	if (!highlightIds || highlightIds.length === 0) return layout.lines;
	const highlight = new Set<string>(highlightIds);
	const bold = (text: string) => `${BOLD_ON}${text}${BOLD_OFF}`;
	return layout.rows.map((row) => {
		const leftParts = row.left.map((segment) =>
			highlight.has(segment.id) ? bold(segment.text) : segment.text,
		);
		const rightParts = row.right.map((segment) =>
			highlight.has(segment.id as string) ? bold(segment.text) : segment.text,
		);
		const leftText = leftParts.join(row.separator);
		const rightText = rightParts.join(row.separator);
		if (leftText && rightText) {
			const leftWidth = visibleWidth(stripTerminalSequences(leftText));
			const rightWidth = visibleWidth(stripTerminalSequences(rightText));
			const padding = Math.max(1, width - leftWidth - rightWidth);
			return `${leftText}${" ".repeat(padding)}${rightText}`;
		}
		if (rightText) {
			const rightWidth = visibleWidth(stripTerminalSequences(rightText));
			return `${" ".repeat(Math.max(0, width - rightWidth))}${rightText}`;
		}
		return leftText;
	});
}

function createSamplePreviewSnapshot(config: FooterConfig): FooterSnapshot {
	const empty = createEmptySnapshot();
	return {
		...empty,
		session: {
			...empty.session,
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			thinkingLevel: "xhigh",
			cwd: "~/dev/project",
		},
		repository: {
			isRepository: true,
			branch: "main",
			dirty: true,
			changedFiles: 2,
			additions: 6,
			deletions: 5,
			addedFiles: 3,
			deletedFiles: 2,
			modifiedFiles: 10,
			untrackedFiles: 20,
			ahead: 2,
			behind: 3,
			state: "fresh",
		},
		conversation: {
			context: { usedTokens: 175_000, limitTokens: 272_000, usedPercent: 64.4 },
			tokens: { input: 901_000, output: 63_000 },
			throughput: { outputTokens: 85, durationMs: 2000, tokensPerSecond: 42.5, recordedAt: 0 },
			cache: { read: 19_700_000, write: 0, hitPercent: 99.3, state: "hit" },
			cost: { input: 0.012, output: 0.083, cacheRead: 0.025, cacheWrite: 0.003, total: 0.123 },
		},
		...(config.usage.enabled
			? {
					providerUsage: {
						provider: "openai-codex" as const,
						state: "fresh" as const,
						windows: [
							{
								id: "5h",
								label: "5h",
								usedPercent: 58,
								resetAt: empty.updatedAt + (3 * 60 + 53) * 60_000,
								state: "normal" as const,
							},
							{ id: "week", label: "wk", usedPercent: 9, state: "normal" as const },
						],
					},
				}
			: {}),
	};
}

// ---------------------------------------------------------------------------
// Status feedback and menu rendering
// ---------------------------------------------------------------------------

function withStatus(status: WizardStatus, lines: string[]): string[] {
	if (!status.message) return lines;
	const message = status.message;
	status.message = undefined;
	return [`✓ ${message}`, "", ...lines];
}

async function menuSelect(
	ui: FooterWizardUI,
	status: WizardStatus,
	config: FooterConfig,
	title: string,
	options: string[],
	cycles?: Record<string, string[]>,
	tabs?: SettingsTab[],
	initialTab?: number,
): Promise<string | undefined> {
	return ui.select({
		title,
		preview: (width) =>
			withStatus(
				status,
				footerPreviewLines(
					config,
					width,
					highlightIdsForTitle(title),
					resolvePreviewSnapshot(ui, config),
				),
			),
		options,
		...(cycles ? { cycles } : {}),
		...(tabs ? { tabs } : {}),
		...(initialTab !== undefined ? { initialTab } : {}),
	});
}

function createCommit(
	config: FooterConfig,
	save: WizardSaveCallback,
	status: WizardStatus,
): Commit {
	return async (message: string): Promise<boolean> => {
		const previousRows = config.layout.rows;
		config.layout.rows = cleanLayoutRows(config.layout.rows);
		try {
			const result = await save(config);
			if (result.ok) {
				status.message = message;
				return true;
			}
			status.message = result.message;
			config.layout.rows = previousRows;
			return false;
		} catch {
			status.message = "Unable to save settings. The previous configuration was not changed.";
			config.layout.rows = previousRows;
			return false;
		}
	};
}

/** Apply a single-field change, committing immediately and rolling back on save failure. */
async function applyChange<T>(
	commit: Commit,
	get: () => T,
	set: (value: T) => void,
	next: T,
	message: string,
): Promise<void> {
	const previous = get();
	if (previous === next) return;
	set(next);
	const ok = await commit(message);
	if (!ok) set(previous);
}

async function toggleSegmentEnabled(
	config: FooterConfig,
	commit: Commit,
	id: SegmentId,
	title: string,
	next: boolean,
): Promise<void> {
	const segment = config.segments[id];
	if (segment.enabled === next) return;
	const previousRows = structuredClone(config.layout.rows);
	segment.enabled = next;
	markCustom(config, id, true);
	const ok = await commit(`${title} ${next ? "shown" : "hidden"}`);
	if (!ok) {
		segment.enabled = !next;
		config.layout.rows = previousRows;
	}
}

async function editSegmentLabel(
	ui: FooterWizardUI,
	commit: Commit,
	status: WizardStatus,
	segment: { label?: string },
	title: string,
): Promise<void> {
	if (!ui.input) return;
	const value = await ui.input(`${title} label`, segment.label ?? "");
	if (value === undefined) return;
	const trimmed = value.trim();
	if (
		trimmed.length > 40 ||
		[...trimmed].some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	) {
		status.message = "Invalid label: use plain text up to 40 characters.";
		return;
	}
	const next = trimmed.length > 0 ? trimmed : undefined;
	await applyChange(
		commit,
		() => segment.label,
		(v) => {
			segment.label = v;
		},
		next,
		`${title} label updated`,
	);
}

// ---------------------------------------------------------------------------
// Wizard entry point
// ---------------------------------------------------------------------------

function wrapUi(ui: FooterWizardUI): FooterWizardUI {
	const wrapped: FooterWizardUI = {
		...ui,
		select: async (request) => {
			const choice = await ui.select(request);
			if (choice === WIZARD_EXIT) throw new WizardExit();
			return choice;
		},
	};
	if (ui.input) wrapped.input = ui.input.bind(ui);
	if (ui.layout) wrapped.layout = ui.layout.bind(ui);
	if (ui.previewSnapshot) wrapped.previewSnapshot = ui.previewSnapshot.bind(ui);
	return wrapped;
}

function resolvePreviewSnapshot(ui: FooterWizardUI, config: FooterConfig): FooterSnapshot {
	return ui.previewSnapshot?.() ?? createSamplePreviewSnapshot(config);
}

/**
 * Edit the active configuration through a hierarchical menu. Enter confirms
 * and immediately persists each setting through `save`; Layout uses a two-step
 * pick/move/confirm canvas. `Esc` cancels a pending Layout move, or exits the
 * wizard when the canvas is idle; at the root it also exits the wizard. Search
 * input is always active, like the native `/model` selector.
 * There is no separate Apply/Discard step.
 * Preset mode only allows changing Mode and
 * Footer; every other category is read-only until the user selects Custom
 * through the Mode setting.
 */
export async function runFooterWizard(
	current: FooterConfig,
	rawUi: FooterWizardUI,
	save: WizardSaveCallback,
): Promise<FooterConfig> {
	const config = cloneConfig(current);
	// A session may have been started with a config created by an older build.
	// Clean it before any editor receives it so stale empty rows cannot reappear
	// in the Layout canvas or be carried into a later save.
	config.layout.rows = cleanLayoutRows(config.layout.rows);
	const ui = wrapUi(rawUi);
	const status: WizardStatus = {};
	const commit = createCommit(config, save, status);
	try {
		await rootMenu(config, ui, status, commit);
	} catch (error) {
		if (!(error instanceof WizardExit)) throw error;
	}
	return config;
}

// ---------------------------------------------------------------------------
// Root menu
// ---------------------------------------------------------------------------

interface Category {
	title: string;
	/** Labels shown in the Root menu to describe the settings inside this category. */
	settings: string;
	/** Current rendered value shown in the Root menu summary. */
	summary(config: FooterConfig): string | undefined;
	/** Current values for the category's read-only detail page. */
	readOnly(config: FooterConfig): string[];
	edit(
		config: FooterConfig,
		ui: FooterWizardUI,
		status: WizardStatus,
		commit: Commit,
	): Promise<void>;
}

function categorySummarySegment(config: FooterConfig, id: SegmentId): string | undefined {
	const snapshot = createSamplePreviewSnapshot(config);
	const segment = resolveSegments(snapshot, config, [id])[0];
	return segment?.compactText ?? segment?.text;
}

function appearanceSummary(config: FooterConfig): string {
	return `${config.style.labelMode} · ${config.style.colorMode} · icons ${config.style.icons} · ${config.style.separator}`;
}

function modelsAndProvidersSummary(config: FooterConfig): string | undefined {
	const snapshot = createSamplePreviewSnapshot(config);
	if (identityPresentation(config) === "collapsed") {
		const segment = resolveSegments(snapshot, config, ["identity"])[0];
		return segment?.compactText ?? segment?.text;
	}
	const parts = resolveSegments(snapshot, config, ["provider", "model", "thinking"]).map(
		(segment) => segment.compactText ?? segment.text,
	);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function simpleSegmentReadOnlyOptions(
	config: FooterConfig,
	id: SegmentId,
	title: string,
	showLabel: string,
): string[] {
	const segment = config.segments[id];
	const disabled = !segment.enabled;
	const options = [`${showLabel}: ${segment.enabled ? "On" : "Off"}`];
	const displayStyles = (SEGMENT_DISPLAY_STYLES as Record<string, readonly string[]>)[id];
	const notationStyles = (SEGMENT_NOTATION_STYLES as Record<string, readonly string[]>)[id];
	const uiOrder = displayUiOrder(id);
	if (displayStyles && uiOrder) {
		options.push(
			lockWhenDisabled(
				displayChainRowWithOrder(id, uiOrder, currentDisplay(displayStyles, segment)),
				disabled,
			),
		);
	} else if (displayStyles) {
		options.push(
			lockWhenDisabled(
				displayChainRow(id, displayStyles, currentDisplay(displayStyles, segment)),
				disabled,
			),
		);
	}
	if (notationStyles) {
		const order = id === "cost" ? COST_NOTATION_UI_ORDER : notationStyles;
		options.push(
			lockWhenDisabled(notationChainRow(order, currentNotation(order, segment)), disabled),
		);
	}
	options.push(lockWhenDisabled(`Label: ${segment.label ?? title}`, disabled));
	return options;
}

function simpleSegmentCategory(
	id: SegmentId,
	title: string,
	showLabel: string,
	settings: string,
): Category {
	return {
		title,
		settings,
		summary: (config) => categorySummarySegment(config, id),
		readOnly: (config) => simpleSegmentReadOnlyOptions(config, id, title, showLabel),
		edit: (config, ui, status, commit) =>
			editSimpleSegment(config, ui, status, commit, id, title, showLabel),
	};
}

const USAGE_WINDOW_LABELS: Record<UsageWindow, string> = {
	"5h": "5h",
	week: "Week (7d)",
	month: "Month (30d)",
};

function usageWindowsSummary(windows: readonly UsageWindow[]): string {
	const selected = USAGE_WINDOW_UI_ORDER.filter((window) => windows.includes(window));
	return selected.length > 0
		? selected.map((window) => USAGE_WINDOW_LABELS[window]).join(" · ")
		: "none";
}

function usageWindowOption(window: UsageWindow, selected: readonly UsageWindow[]): string {
	return `${USAGE_WINDOW_LABELS[window]}: ${selected.includes(window) ? "On" : "Off"}`;
}

const CATEGORIES: readonly Category[] = [
	{
		title: "Appearance",
		settings: "Detail level · Color · Icons · Separator",
		summary: appearanceSummary,
		readOnly: (config) => [
			chainRow("Detail level", LABEL_MODES, config.style.labelMode),
			chainRow("Color", COLOR_MODES, config.style.colorMode),
			chainRow("Icons", ICON_MODES, config.style.icons),
			chainRow("Separator", VISIBLE_SEPARATORS, config.style.separator),
		],
		edit: editAppearance,
	},
	simpleSegmentCategory("cwd", "Project", "Show Project", "Show Project · Display · Label"),
	simpleSegmentCategory("git", "Git", "Show Git", "Show Git · Display · Label"),
	{
		title: "Models & Providers",
		settings: "Identity style · Provider · Model · Thinking · Label",
		summary: modelsAndProvidersSummary,
		readOnly: (config) => [
			`Identity style: ${identityPresentation(config)} - [collapsed / separate]`,
			`Provider: ${config.segments.provider.enabled ? "On" : "Off"}`,
			`Model: ${config.segments.model.enabled ? "On" : "Off"}`,
			`Thinking: ${config.segments.thinking.enabled ? "On" : "Off"}`,
			`Label: ${config.segments.identity.label ?? "[none]"}`,
		],
		edit: editModelsAndProviders,
	},
	{
		title: "Usage",
		settings: "Show Usage · Display · Windows · Resets · Alerts · Refresh",
		summary: (config) => categorySummarySegment(config, "provider_usage"),
		readOnly: (config) => {
			const disabled = !config.usage.enabled;
			return [
				`Show Usage: ${config.usage.enabled ? "On" : "Off"}`,
				lockWhenDisabled(
					chainRow(
						"Display",
						USAGE_DISPLAY_UI_ORDER,
						currentDisplay(USAGE_DISPLAY_STYLES, config.segments.provider_usage),
					),
					disabled,
				),
				lockWhenDisabled(`Windows: ${usageWindowsSummary(config.usage.windows)}`, disabled),
				lockWhenDisabled(`Resets: ${config.usage.showResetTime ? "On" : "Off"}`, disabled),
				lockWhenDisabled(
					`Alerts: warning ${config.thresholds.providerUsage.warning}% · error ${config.thresholds.providerUsage.error}%`,
					disabled,
				),
				lockWhenDisabled(`Refresh: ${refreshLabel(config.usage.refreshSeconds)}`, disabled),
			];
		},
		edit: editUsage,
	},
	{
		title: "Context",
		settings: "Show Context · Display · Label",
		summary: (config) => categorySummarySegment(config, "context"),
		readOnly: (config) => {
			const disabled = !config.segments.context.enabled;
			return [
				`Show Context: ${config.segments.context.enabled ? "On" : "Off"}`,
				lockWhenDisabled(
					displayChainRowWithOrder(
						"context",
						CONTEXT_DISPLAY_UI_ORDER,
						currentDisplay(CONTEXT_DISPLAY_STYLES, config.segments.context),
					),
					disabled,
				),
				lockWhenDisabled(`Label: ${config.segments.context.label ?? "Context"}`, disabled),
			];
		},
		edit: editContext,
	},
	simpleSegmentCategory("cache", "Cache", "Show Cache", "Show Cache · Label"),
	simpleSegmentCategory("tokens", "Tokens", "Show Tokens", "Show Tokens · Display · Label"),
	simpleSegmentCategory("speed", "Speed", "Show Speed", "Show Speed · Label"),
	simpleSegmentCategory("cost", "Cost", "Show Cost", "Show Cost · Display · Notation · Label"),
	{
		title: "Layout",
		settings: "Canvas · Move Segments · Add/Clear rows",
		summary: layoutSummary,
		readOnly: layoutReadOnly,
		edit: editLayout,
	},
];

function categoryRow(category: Category): string {
	return `${category.title} — ${category.settings}`;
}

// ---------------------------------------------------------------------------
// Layout: move Segments between rows (up/down) and groups (left/right)
// ---------------------------------------------------------------------------

const LAYOUT_SEGMENT_LABELS: Partial<Record<SegmentId, string>> = {
	identity: "Provider",
	provider: "Provider",
	model: "Model",
	thinking: "Thinking",
	cwd: "Project",
	git: "Git",
	context: "Context",
	tokens: "Token",
	speed: "Speed",
	cache: "Cache",
	cost: "Cost",
	tools: "Tools",
	provider_usage: "Usage",
	extensions: "Extensions",
};

function layoutSummary(config: FooterConfig): string {
	const segmentCount = config.layout.rows.reduce(
		(total, row) => total + row.left.length + row.right.length,
		0,
	);
	return `${config.layout.rows.length} rows · ${segmentCount} Segments`;
}

function layoutReadOnly(config: FooterConfig): string[] {
	return config.layout.rows.map((row) => {
		const left = row.left.length > 0 ? row.left.join(", ") : "—";
		const right = row.right.length > 0 ? row.right.join(", ") : "—";
		return `Row ${row.id}: [${left} | ${right}]`;
	});
}

async function applyLayoutRowsChange(
	config: FooterConfig,
	commit: Commit,
	nextRows: FooterRowConfig[],
	message: string,
): Promise<boolean> {
	const previousRows = structuredClone(config.layout.rows);
	config.layout.rows = nextRows;
	const ok = await commit(message);
	if (!ok) config.layout.rows = previousRows;
	return ok;
}

async function editLayout(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	if (ui.layout) {
		let layoutChangeHandled = false;
		const edited = await ui.layout({
			title: "Layout — arrange Segments",
			tabs: ["General", "Components", "Layout", "Appearance"],
			activeTab: 2,
			rows: structuredClone(config.layout.rows),
			labels: LAYOUT_SEGMENT_LABELS,
			preview: (rows, width, selected) =>
				footerPreviewLines(
					{ ...config, layout: { rows: structuredClone([...rows]) } },
					width,
					selected ? [selected] : undefined,
					resolvePreviewSnapshot(ui, { ...config, layout: { rows: structuredClone([...rows]) } }),
				),
			onChange: async (rows, message) => {
				layoutChangeHandled = true;
				const previousRows = config.layout.rows;
				config.layout.rows = structuredClone(rows);
				markCustom(config);
				const ok = await commit(message);
				if (!ok) config.layout.rows = previousRows;
				return ok;
			},
		});
		if (edited && !Array.isArray(edited)) {
			if (edited.kind === "tab") status.tabDirection = edited.direction;
			else throw new WizardExit();
			return;
		}
		if (edited) {
			// The TUI editor normally persists on its second Enter. Keep this
			// guard for alternate UI hosts that only return the edited layout.
			// Normalize the returned value before comparing it so a host that calls
			// onChange with an empty source row does not cause a second save.
			const normalizedEdited = cleanLayoutRows(edited);
			if (
				!layoutChangeHandled &&
				JSON.stringify(config.layout.rows) !== JSON.stringify(normalizedEdited)
			) {
				const previousRows = config.layout.rows;
				config.layout.rows = structuredClone(normalizedEdited);
				markCustom(config);
				const ok = await commit("Layout updated");
				if (!ok) config.layout.rows = previousRows;
			} else if (!layoutChangeHandled) {
				config.layout.rows = structuredClone(normalizedEdited);
			}
		}
		return;
	}

	// Non-TUI hosts retain the original menu fallback.
	while (true) {
		const positions = layoutPositions(config.layout.rows);
		const options = positions.map(({ id, rowId, side }) => {
			return `Segment: ${id} — row ${rowId} · ${side}`;
		});
		const choice = await menuSelect(ui, status, config, "Layout — move Segments", options);
		if (choice === undefined) return;
		const position = positions.find(({ id, rowId, side }) => {
			return `Segment: ${id} — row ${rowId} · ${side}` === choice;
		});
		if (!position) continue;
		await editSegmentPosition(config, ui, status, commit, position);
	}
}

async function editSegmentPosition(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
	position: LayoutSegmentPosition,
): Promise<void> {
	while (true) {
		const { id } = position;
		const rowIds = config.layout.rows.map((row) => row.id);
		const sideRow = chainRow("Side", ["left", "right"], position.side);
		const rowRow = chainRow("Row", rowIds, position.rowId);
		const choice = await menuSelect(ui, status, config, `Move: ${id}`, [sideRow, rowRow], {
			...chainCycles(["left", "right"], "Side"),
			...chainCycles(rowIds, "Row"),
		});
		if (choice === undefined) return;
		const nextSide = rowValue(choice, "Side: ", ["left", "right"] as const);
		if (nextSide) {
			if (nextSide === position.side) continue;
			const nextRows = setLayoutSegmentSide(config.layout.rows, id, nextSide);
			const ok = await applyLayoutRowsChange(
				config,
				commit,
				nextRows,
				`Segment ${id} → ${nextSide}`,
			);
			if (ok) position.side = nextSide;
			continue;
		}
		const nextRowId = rowValue(choice, "Row: ", rowIds as readonly string[]);
		if (nextRowId) {
			if (nextRowId === position.rowId) continue;
			const nextRows = moveLayoutSegment(config.layout.rows, id, nextRowId, position.side);
			const ok = await applyLayoutRowsChange(
				config,
				commit,
				nextRows,
				`Segment ${id} → row ${nextRowId}`,
			);
			if (ok) position.rowId = nextRowId;
		}
	}
}

function lockWhenDisabled(option: string, disabled: boolean): string {
	return disabled ? `${option} 🔒` : option;
}

async function rootMenu(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	let activeRootTab = 0;
	while (true) {
		const isCustom = config.preset === "custom";
		const disabled = !config.enabled;
		const modeRow = `Mode: ${config.preset} - [${PRESET_NAMES.join(" / ")}]${disabled ? " 🔒" : ""}`;
		const footerRow = `Footer: ${config.enabled ? "On" : "Off"}`;
		const projectSettingsRow = `Project-specific settings: ${config.projectOverrides.enabled ? "On" : "Off"}`;
		const projectSettingsOption = lockWhenDisabled(projectSettingsRow, disabled);
		const categoryOptions = CATEGORIES.map((category) =>
			lockWhenDisabled(categoryRow(category), disabled),
		);
		const categoryOption = (title: string, locked = disabled): string | undefined => {
			const category = CATEGORIES.find((candidate) => candidate.title === title);
			return category ? lockWhenDisabled(categoryRow(category), locked) : undefined;
		};
		const componentsLocked = disabled || !isCustom;
		const componentsTab = CATEGORIES.filter((category) =>
			[
				"Project",
				"Git",
				"Models & Providers",
				"Usage",
				"Context",
				"Cache",
				"Tokens",
				"Speed",
				"Cost",
			].includes(category.title),
		).map((category) => lockWhenDisabled(categoryRow(category), componentsLocked));
		const layoutTabActivation = categoryOption("Layout", componentsLocked) ?? "Layout";
		const detailRow = chainRow("Detail level", LABEL_MODES, config.style.labelMode);
		const colorRow = chainRow("Color", COLOR_MODES, config.style.colorMode);
		const iconsRow = chainRow("Icons", ICON_MODES, config.style.icons);
		const separatorRow = chainRow("Separator", VISIBLE_SEPARATORS, config.style.separator);
		const appearanceLocked = disabled || !isCustom;
		const appearanceTab = [detailRow, colorRow, iconsRow, separatorRow].map((row) =>
			lockWhenDisabled(row, appearanceLocked),
		);
		const generalTab = [footerRow, modeRow, projectSettingsOption];
		const options = [footerRow, modeRow, ...categoryOptions, projectSettingsOption];
		const tabs: SettingsTab[] = [
			{ title: "General", options: generalTab },
			{ title: "Components", options: componentsTab },
			{
				title: "Layout",
				options: [],
				activateOnTab: layoutTabActivation,
			},
			{ title: "Appearance", options: appearanceTab },
		];
		const choice = await menuSelect(
			ui,
			status,
			config,
			`Footer settings · ${config.preset}${isCustom ? "" : " (read-only)"}`,
			options,
			{
				...(disabled
					? {}
					: {
							[modeRow]: PRESET_NAMES.map(
								(preset) => `Mode: ${preset} - [${PRESET_NAMES.join(" / ")}]`,
							),
						}),
				[footerRow]: ["Footer: On", "Footer: Off"],
				...(disabled
					? {}
					: {
							[projectSettingsOption]: [
								"Project-specific settings: On",
								"Project-specific settings: Off",
							],
						}),
				...(appearanceLocked
					? {}
					: {
							...chainCycles(LABEL_MODES, "Detail level"),
							...chainCycles(COLOR_MODES, "Color"),
							...chainCycles(ICON_MODES, "Icons"),
							...chainCycles(VISIBLE_SEPARATORS, "Separator"),
						}),
			},
			tabs,
			activeRootTab,
		);
		// Esc on the root menu exits the wizard directly.
		if (choice === undefined) return;
		if (generalTab.includes(choice)) activeRootTab = 0;
		else if (componentsTab.includes(choice)) activeRootTab = 1;
		else if (choice.startsWith("Layout")) activeRootTab = 2;
		else if (appearanceTab.includes(choice)) activeRootTab = 3;
		const mode = rowValue(choice, "Mode: ", PRESET_NAMES);
		if (mode) {
			if (disabled) continue;
			await handleModeChange(config, mode, commit);
			continue;
		}
		if (rowValue(choice, "Footer: ", ["On", "Off"] as const)) {
			await applyChange(
				commit,
				() => config.enabled,
				(value) => {
					config.enabled = value;
				},
				choice.endsWith("On"),
				`Footer ${choice.endsWith("On") ? "enabled" : "disabled"}`,
			);
			continue;
		}
		const detail = rowValue(choice, "Detail level: ", LABEL_MODES);
		if (detail) {
			if (appearanceLocked) continue;
			await applyChange(
				commit,
				() => config.style.labelMode,
				(value) => {
					config.style.labelMode = value;
				},
				detail,
				`Detail level = ${detail}`,
			);
			continue;
		}
		const color = rowValue(choice, "Color: ", COLOR_MODES);
		if (color) {
			if (appearanceLocked) continue;
			await applyChange(
				commit,
				() => config.style.colorMode,
				(value) => {
					config.style.colorMode = value;
				},
				color,
				`Color = ${color}`,
			);
			continue;
		}
		const icons = rowValue(choice, "Icons: ", ICON_MODES);
		if (icons) {
			if (appearanceLocked) continue;
			await applyChange(
				commit,
				() => config.style.icons,
				(value) => {
					config.style.icons = value;
				},
				icons,
				`Icons = ${icons}`,
			);
			continue;
		}
		const separator = rowValue(choice, "Separator: ", VISIBLE_SEPARATORS);
		if (separator) {
			if (appearanceLocked) continue;
			await applyChange(
				commit,
				() => config.style.separator,
				(value) => {
					config.style.separator = value;
				},
				separator,
				`Separator = ${separator}`,
			);
			continue;
		}
		if (choice.startsWith("Project-specific settings:")) {
			if (disabled) continue;
			await applyChange(
				commit,
				() => config.projectOverrides.enabled,
				(value) => {
					config.projectOverrides.enabled = value;
				},
				choice.endsWith("On"),
				`Project-specific settings ${choice.endsWith("On") ? "enabled" : "disabled"}`,
			);
			continue;
		}
		const category = CATEGORIES.find((candidate) => choice.startsWith(candidate.title));
		if (!category) continue;
		if (disabled) {
			if (category.title === "Layout") activeRootTab = 0;
			continue;
		}
		if (!isCustom) {
			await showReadOnlyCategory(config, ui, status, category);
			if (category.title === "Layout") activeRootTab = 0;
			continue;
		}
		await category.edit(config, ui, status, commit);
		if (category.title === "Layout") {
			if (status.tabDirection !== undefined) {
				activeRootTab = (2 + status.tabDirection + 4) % 4;
				status.tabDirection = undefined;
			} else {
				activeRootTab = 0;
			}
		}
	}
}

async function showReadOnlyCategory(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	category: Category,
): Promise<void> {
	while (true) {
		const summary = category.summary(config) ?? "hidden";
		const options = category.readOnly(config);
		if (options.length === 0) options.push(`Current: ${summary}`);
		const choice = await menuSelect(ui, status, config, `${category.title} (read-only)`, options);
		if (choice === undefined) return;
	}
}

async function handleModeChange(
	config: FooterConfig,
	mode: PresetName,
	commit: Commit,
): Promise<void> {
	if (mode === config.preset) return;
	const previous = cloneConfig(config);
	if (mode === "custom") applyCustomPreset(config);
	else applyBuiltInPreset(config, mode);
	const ok = await commit(`Mode = ${mode}`);
	if (!ok) Object.assign(config, previous);
}

// ---------------------------------------------------------------------------
// Simple show/label categories: Project, Git, Cache, Tokens, Cost
// ---------------------------------------------------------------------------

async function editSimpleSegment(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
	id: SegmentId,
	title: string,
	showLabel: string,
): Promise<void> {
	const segment = config.segments[id];
	const displayStyles = (SEGMENT_DISPLAY_STYLES as Record<string, readonly string[]>)[id];
	const notationStyles = (SEGMENT_NOTATION_STYLES as Record<string, readonly string[]>)[id];
	const uiOrder = displayUiOrder(id);
	const notationOrder = id === "cost" ? COST_NOTATION_UI_ORDER : notationStyles;
	while (true) {
		const disabled = !segment.enabled;
		const showRow = `${showLabel}: ${segment.enabled ? "On" : "Off"}`;
		const options = [showRow];
		let displayRow: string | undefined;
		let lockedDisplayRow: string | undefined;
		let notationRow: string | undefined;
		let lockedNotationRow: string | undefined;
		const cycles: Record<string, string[]> = {};
		cycles[showRow] = [`${showLabel}: On`, `${showLabel}: Off`];
		if (displayStyles) {
			const current = currentDisplay(displayStyles, segment);
			const order = uiOrder ?? displayStyles;
			displayRow = displayChainRowWithOrder(id, order, current);
			lockedDisplayRow = lockWhenDisabled(displayRow, disabled);
			options.push(lockedDisplayRow);
			if (!disabled) {
				const map = displayCycleMapWithOrder(id, order)[displayRow];
				if (map) cycles[lockedDisplayRow] = map;
			}
		}
		if (notationStyles && notationOrder) {
			notationRow = notationChainRow(notationOrder, currentNotation(notationOrder, segment));
			lockedNotationRow = lockWhenDisabled(notationRow, disabled);
			options.push(lockedNotationRow);
			if (!disabled) cycles[lockedNotationRow] = notationCycleMap(notationOrder)[notationRow] ?? [];
		}
		const labelRow = lockWhenDisabled(`Label: ${segment.label ?? title}`, disabled);
		options.push(labelRow);
		const choice = await menuSelect(ui, status, config, title, options, cycles);
		if (choice === undefined) return;
		if (choice.startsWith(showLabel)) {
			await toggleSegmentEnabled(config, commit, id, title, choice.endsWith("On"));
			continue;
		}
		if (displayRow && choice.startsWith("Display:")) {
			if (disabled) continue;
			const next = displayValueFromChoice(id, choice, displayStyles);
			if (next !== undefined) {
				await applyChange(
					commit,
					() => segment.display,
					(v) => {
						segment.display = v;
					},
					next,
					`Display = ${next}`,
				);
			}
			continue;
		}
		if (notationRow && choice.startsWith("Notation:")) {
			if (disabled || !notationStyles || !notationOrder) continue;
			const next = notationValueFromChoice(choice, notationStyles);
			if (next !== undefined) {
				await applyChange(
					commit,
					() => segment.notation,
					(v) => {
						segment.notation = v;
					},
					next,
					`Notation = ${next}`,
				);
			}
			continue;
		}
		if (choice.startsWith("Label:")) {
			if (disabled) continue;
			await editSegmentLabel(ui, commit, status, segment, title);
		}
	}
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

const VISIBLE_SEPARATORS = ["none", "dot", "bar", "slash"] as const;

async function editAppearance(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	while (true) {
		const detailRow = chainRow("Detail level", LABEL_MODES, config.style.labelMode);
		const colorRow = chainRow("Color", COLOR_MODES, config.style.colorMode);
		const iconsRow = chainRow("Icons", ICON_MODES, config.style.icons);
		const separatorRow = chainRow("Separator", VISIBLE_SEPARATORS, config.style.separator);
		const choice = await menuSelect(
			ui,
			status,
			config,
			"Appearance",
			[detailRow, colorRow, iconsRow, separatorRow],
			{
				...chainCycles(LABEL_MODES, "Detail level"),
				...chainCycles(COLOR_MODES, "Color"),
				...chainCycles(ICON_MODES, "Icons"),
				...chainCycles(VISIBLE_SEPARATORS, "Separator"),
			},
		);
		if (choice === undefined) return;
		const detail = rowValue(choice, "Detail level: ", LABEL_MODES);
		if (detail) {
			await applyChange(
				commit,
				() => config.style.labelMode,
				(v) => {
					config.style.labelMode = v;
				},
				detail,
				`Detail level = ${detail}`,
			);
			continue;
		}
		const color = rowValue(choice, "Color: ", COLOR_MODES);
		if (color) {
			await applyChange(
				commit,
				() => config.style.colorMode,
				(v) => {
					config.style.colorMode = v;
				},
				color,
				`Color = ${color}`,
			);
			continue;
		}
		const icons = rowValue(choice, "Icons: ", ICON_MODES);
		if (icons) {
			await applyChange(
				commit,
				() => config.style.icons,
				(v) => {
					config.style.icons = v;
				},
				icons,
				`Icons = ${icons}`,
			);
			continue;
		}
		const separator = rowValue(choice, "Separator: ", VISIBLE_SEPARATORS);
		if (separator) {
			await applyChange(
				commit,
				() => config.style.separator,
				(v) => {
					config.style.separator = v;
				},
				separator,
				`Separator = ${separator}`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Models & Providers
// ---------------------------------------------------------------------------

function isIdentityPart(id: string): boolean {
	return (IDENTITY_PARTS as readonly string[]).includes(id);
}

function identityPresentation(config: FooterConfig): IdentityPresentation {
	const references = config.layout.rows.flatMap((row) => [...row.left, ...row.right]);
	const hasCollapsed = references.includes("identity");
	const hasSeparate = references.some((id) => isIdentityPart(id));
	if (hasCollapsed && hasSeparate) return "mixed";
	return hasCollapsed ? "collapsed" : "separate";
}

function setIdentityPresentation(config: FooterConfig, mode: IdentityPresentation): void {
	let placed = false;
	for (const row of config.layout.rows) {
		for (const side of ["left", "right"] as const) {
			const group = row[side];
			if (!group.some((id) => id === "identity" || isIdentityPart(id))) continue;
			const next: SegmentId[] = [];
			for (const id of group) {
				if (id !== "identity" && !isIdentityPart(id)) {
					next.push(id);
					continue;
				}
				if (placed) continue;
				placed = true;
				if (mode === "collapsed") next.push("identity");
				else next.push(...IDENTITY_PARTS);
			}
			row[side] = next;
		}
	}
	markCustom(config);
}

async function editModelsAndProviders(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	const identitySegment = config.segments.identity;
	while (true) {
		const identityRow = `Identity style: ${identityPresentation(config)} - [collapsed / separate]`;
		const providerRow = `Provider: ${config.segments.provider.enabled ? "On" : "Off"}`;
		const modelRow = `Model: ${config.segments.model.enabled ? "On" : "Off"}`;
		const thinkingRow = `Thinking: ${config.segments.thinking.enabled ? "On" : "Off"}`;
		const labelRow = `Label: ${identitySegment.label ?? "[none]"}`;
		const choice = await menuSelect(
			ui,
			status,
			config,
			"Models & Providers",
			[identityRow, providerRow, modelRow, thinkingRow, labelRow],
			{
				[identityRow]: [
					"Identity style: collapsed - [collapsed / separate]",
					"Identity style: separate - [collapsed / separate]",
				],
				[providerRow]: ["Provider: On", "Provider: Off"],
				[modelRow]: ["Model: On", "Model: Off"],
				[thinkingRow]: ["Thinking: On", "Thinking: Off"],
			},
		);
		if (choice === undefined) return;
		const identityMode = rowValue(choice, "Identity style: ", ["collapsed", "separate"] as const);
		if (identityMode) {
			if (identityMode !== identityPresentation(config)) {
				const previousRows = structuredClone(config.layout.rows);
				setIdentityPresentation(config, identityMode);
				const ok = await commit(`Identity style = ${identityMode}`);
				if (!ok) config.layout.rows = previousRows;
			}
			continue;
		}
		if (rowValue(choice, "Provider: ", ["On", "Off"] as const)) {
			await toggleSegmentEnabled(config, commit, "provider", "Provider", choice.endsWith("On"));
			continue;
		}
		if (rowValue(choice, "Model: ", ["On", "Off"] as const)) {
			await toggleSegmentEnabled(config, commit, "model", "Model", choice.endsWith("On"));
			continue;
		}
		if (rowValue(choice, "Thinking: ", ["On", "Off"] as const)) {
			await toggleSegmentEnabled(config, commit, "thinking", "Thinking", choice.endsWith("On"));
			continue;
		}
		if (choice.startsWith("Label:")) {
			await editSegmentLabel(ui, commit, status, identitySegment, "Models & Providers");
		}
	}
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const REFRESH_LABELS: Record<number, string> = {
	15: "15 seconds",
	30: "30 seconds",
	60: "1 minute",
	120: "2 minutes",
	300: "5 minutes",
	600: "10 minutes",
	900: "15 minutes",
};

function refreshLabel(seconds: number): string {
	return REFRESH_LABELS[seconds] ?? `${seconds}s`;
}

async function editUsage(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	const segment = config.segments.provider_usage;
	while (true) {
		const disabled = !config.usage.enabled;
		const showRow = `Show Usage: ${config.usage.enabled ? "On" : "Off"}`;
		const displayRow = lockWhenDisabled(
			chainRow("Display", USAGE_DISPLAY_UI_ORDER, currentDisplay(USAGE_DISPLAY_STYLES, segment)),
			disabled,
		);
		const windowsRow = lockWhenDisabled(
			`Windows: ${usageWindowsSummary(config.usage.windows)}`,
			disabled,
		);
		const resetsRow = lockWhenDisabled(
			`Resets: ${config.usage.showResetTime ? "On" : "Off"}`,
			disabled,
		);
		const alertsRow = lockWhenDisabled(
			`Alerts: warning ${config.thresholds.providerUsage.warning}% · error ${config.thresholds.providerUsage.error}%`,
			disabled,
		);
		const refreshRow = lockWhenDisabled(
			`Refresh: ${refreshLabel(config.usage.refreshSeconds)}`,
			disabled,
		);
		const options = [showRow, displayRow, windowsRow, resetsRow, alertsRow, refreshRow];
		const cycles: Record<string, string[]> = {
			[showRow]: ["Show Usage: On", "Show Usage: Off"],
			...(disabled
				? {}
				: {
						[displayRow]: USAGE_DISPLAY_UI_ORDER.map((value) =>
							chainRow("Display", USAGE_DISPLAY_UI_ORDER, value),
						),
						[resetsRow]: ["Resets: On", "Resets: Off"],
					}),
		};
		const choice = await menuSelect(ui, status, config, "Usage", options, cycles);
		if (choice === undefined) return;
		if (choice.startsWith("Show Usage:")) {
			const next = choice.endsWith("On");
			if (config.usage.enabled === next && segment.enabled === next) continue;
			const previousUsageEnabled = config.usage.enabled;
			const previousSegmentEnabled = segment.enabled;
			const previousRows = structuredClone(config.layout.rows);
			config.usage.enabled = next;
			segment.enabled = next;
			markCustom(config, "provider_usage", true);
			const ok = await commit(`Usage ${next ? "shown" : "hidden"}`);
			if (!ok) {
				config.usage.enabled = previousUsageEnabled;
				segment.enabled = previousSegmentEnabled;
				config.layout.rows = previousRows;
			}
			continue;
		}
		if (choice.startsWith("Display:")) {
			if (disabled) continue;
			const next = USAGE_DISPLAY_STYLES.find((value) =>
				choice.slice("Display: ".length).startsWith(value),
			);
			if (next !== undefined) {
				await applyChange(
					commit,
					() => segment.display,
					(v) => {
						segment.display = v;
					},
					next,
					`Display = ${next}`,
				);
			}
			continue;
		}
		if (choice.startsWith("Windows:")) {
			if (disabled) continue;
			await editUsageWindows(config, ui, status, commit);
			continue;
		}
		if (choice.startsWith("Resets:")) {
			if (disabled) continue;
			await applyChange(
				commit,
				() => config.usage.showResetTime,
				(value) => {
					config.usage.showResetTime = value;
				},
				choice.endsWith("On"),
				`Resets ${choice.endsWith("On") ? "shown" : "hidden"}`,
			);
			continue;
		}
		if (choice.startsWith("Alerts:")) {
			if (disabled) continue;
			await editUsageAlerts(config, ui, status, commit);
			continue;
		}
		if (choice.startsWith("Refresh:")) {
			if (disabled) continue;
			await editUsageRefresh(config, ui, status, commit);
		}
	}
}

async function editUsageWindows(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	while (true) {
		const selected = config.usage.windows;
		const options = USAGE_WINDOW_UI_ORDER.map((window) => usageWindowOption(window, selected));
		const cycles = Object.fromEntries(
			USAGE_WINDOW_UI_ORDER.map((window) => {
				const option = usageWindowOption(window, selected);
				return [
					option,
					[usageWindowOption(window, selected.includes(window) ? [] : [window]), option],
				];
			}),
		) as Record<string, string[]>;
		const choice = await menuSelect(ui, status, config, "Usage · Windows", options, cycles);
		if (choice === undefined) return;
		const window = USAGE_WINDOW_UI_ORDER.find((candidate) =>
			choice.startsWith(`${USAGE_WINDOW_LABELS[candidate]}:`),
		);
		if (window === undefined) continue;
		const next = choice.endsWith("On");
		const nextWindows = USAGE_WINDOW_UI_ORDER.filter((candidate) =>
			candidate === window ? next : selected.includes(candidate),
		);
		if (!next && nextWindows.length === 0) {
			status.message = "At least one Usage window must remain enabled.";
			continue;
		}
		await applyChange(
			commit,
			() => config.usage.windows,
			(value) => {
				config.usage.windows = value;
			},
			nextWindows,
			`Usage windows = ${usageWindowsSummary(nextWindows)}`,
		);
	}
}

async function editUsageAlerts(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	while (true) {
		const warningRow = `Warning threshold: ${config.thresholds.providerUsage.warning}%`;
		const errorRow = `Error threshold: ${config.thresholds.providerUsage.error}%`;
		const choice = await menuSelect(ui, status, config, "Usage · Alerts", [warningRow, errorRow]);
		if (choice === undefined) return;
		if (choice.startsWith("Warning threshold:")) {
			await editThreshold(config, ui, status, commit, "providerUsage", "warning");
		} else if (choice.startsWith("Error threshold:")) {
			await editThreshold(config, ui, status, commit, "providerUsage", "error");
		}
	}
}

async function editUsageRefresh(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	while (true) {
		const rows = USAGE_REFRESH_SECONDS_OPTIONS.map((seconds) => {
			const current = seconds === config.usage.refreshSeconds;
			return `${current ? "\u2192" : " "} Every ${refreshLabel(seconds)}`;
		});
		const choice = await menuSelect(ui, status, config, "Usage \u00b7 Refresh interval", rows);
		if (choice === undefined) return;
		const stripped = choice.replace(/^[\u2192\u0020]+/u, "");
		const seconds = USAGE_REFRESH_SECONDS_OPTIONS.find((candidate) =>
			stripped.includes(refreshLabel(candidate)),
		);
		if (seconds === undefined) continue;
		await applyChange(
			commit,
			() => config.usage.refreshSeconds,
			(v) => {
				config.usage.refreshSeconds = v;
			},
			seconds,
			`Refresh interval = every ${refreshLabel(seconds)}`,
		);
	}
}

async function editThreshold(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
	group: "context" | "providerUsage",
	level: "warning" | "error",
): Promise<void> {
	if (!ui.input) return;
	const thresholds = config.thresholds[group];
	const label = group === "context" ? "Context" : "Usage";
	const value = await ui.input(`${label} ${level} threshold`, String(thresholds[level]));
	if (value === undefined) return;
	const raw = value.trim();
	const parsed = Number(raw);
	if (!raw || !Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
		status.message = "Invalid threshold: enter an integer from 0 to 100.";
		return;
	}
	const other = level === "warning" ? thresholds.error : thresholds.warning;
	if (level === "warning" && parsed > other) {
		status.message = `Invalid threshold: warning must be at most ${other}%.`;
		return;
	}
	if (level === "error" && parsed < other) {
		status.message = `Invalid threshold: error must be at least ${other}%.`;
		return;
	}
	await applyChange(
		commit,
		() => thresholds[level],
		(v) => {
			thresholds[level] = v;
		},
		parsed,
		`${label} ${level} threshold = ${parsed}%`,
	);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

function currentDisplay(styles: readonly string[], segment: { display?: string }): string {
	const allowed = styles as readonly string[];
	return segment.display !== undefined && allowed.includes(segment.display)
		? segment.display
		: allowed[0];
}

function currentNotation(styles: readonly string[], segment: { notation?: string }): string {
	const allowed = styles as readonly string[];
	return segment.notation !== undefined && allowed.includes(segment.notation)
		? segment.notation
		: allowed[0];
}

async function editContext(
	config: FooterConfig,
	ui: FooterWizardUI,
	status: WizardStatus,
	commit: Commit,
): Promise<void> {
	const segment = config.segments.context;
	while (true) {
		const disabled = !segment.enabled;
		const showRow = `Show Context: ${segment.enabled ? "On" : "Off"}`;
		const display = currentDisplay(CONTEXT_DISPLAY_STYLES, segment);
		const displayRowRaw = `Display: ${display} - [${CONTEXT_DISPLAY_UI_ORDER.join(" / ")}]`;
		const displayRow = lockWhenDisabled(displayRowRaw, disabled);
		const labelRow = lockWhenDisabled(`Label: ${segment.label ?? "Context"}`, disabled);
		const choice = await menuSelect(
			ui,
			status,
			config,
			"Context",
			[showRow, displayRow, labelRow],
			{
				[showRow]: ["Show Context: On", "Show Context: Off"],
				...(disabled ? {} : displayCycleMapWithOrder("context", CONTEXT_DISPLAY_UI_ORDER)),
			},
		);
		if (choice === undefined) return;
		if (choice.startsWith("Show Context:")) {
			await toggleSegmentEnabled(config, commit, "context", "Context", choice.endsWith("On"));
			continue;
		}
		if (disabled) continue;
		const displayValue = displayValueFromChoice("context", choice, CONTEXT_DISPLAY_STYLES);
		if (displayValue) {
			await applyChange(
				commit,
				() => segment.display,
				(v) => {
					segment.display = v;
				},
				displayValue,
				`Display = ${displayValue}`,
			);
			continue;
		}
		if (choice.startsWith("Label:")) {
			await editSegmentLabel(ui, commit, status, segment, "Context");
		}
	}
}

// ---------------------------------------------------------------------------
// Preset and custom transitions
// ---------------------------------------------------------------------------

export function applyBuiltInPreset(
	config: FooterConfig,
	preset: Exclude<PresetName, "custom">,
): void {
	config.preset = preset;
	config.layout = layoutForPreset(preset) ?? config.layout;
	config.segments = createPresetSegmentConfig(preset);
	config.style.labelMode = "automatic";
}

/** Restore the checked-in profile used as the starting point for Custom mode. */
export function applyCustomPreset(config: FooterConfig): void {
	const defaults = createCustomDefaultConfig();
	config.preset = "custom";
	config.layout = defaults.layout;
	config.segments = defaults.segments;
	config.style.labelMode = defaults.style.labelMode;
}

/** Switch the draft to custom mode and, when requested, place a newly-enabled Segment in a sensible row. */
function markCustom(config: FooterConfig, segmentId?: SegmentId, syncLayout = false): void {
	config.preset = "custom";
	if (!segmentId || !syncLayout) return;
	const references = config.layout.rows.flatMap((row) => [...row.left, ...row.right]);
	// Collapsed identity composites read part-enabled flags directly.
	if (references.includes("identity") && isIdentityPart(segmentId)) return;
	const segment = config.segments[segmentId];
	const present = references.includes(segmentId);
	if (segment.enabled && !present) {
		const targetId = segmentRow(segmentId);
		let target = config.layout.rows.find((row) => row.id === targetId);
		if (!target) {
			const template = layoutForPreset("balanced")?.rows.find((row) => row.id === targetId);
			if (template) {
				target = { ...structuredClone(template), left: [], right: [] };
				config.layout.rows.push(target);
			}
		}
		if (target) {
			const rightSide = new Set<SegmentId>(["identity", "context", "cost"]);
			if (rightSide.has(segmentId)) target.right.push(segmentId);
			else target.left.push(segmentId);
		}
	} else if (!segment.enabled) {
		for (const row of config.layout.rows) {
			row.left = row.left.filter((candidate) => candidate !== segmentId);
			row.right = row.right.filter((candidate) => candidate !== segmentId);
		}
	}
}

function segmentRow(segmentId: SegmentId): string {
	if (segmentId === "provider_usage") return "usage";
	if (segmentId === "extensions") return "extensions";
	if (segmentId === "context") return "git";
	if (segmentId === "tokens" || segmentId === "speed" || segmentId === "cache") return "session";
	if (segmentId === "cost") return "usage";
	return "project";
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type FooterCommandAction =
	| { kind: "wizard" }
	| { kind: "toggle" }
	| { kind: "preset"; preset: Exclude<PresetName, "custom"> }
	| { kind: "refresh" }
	| { kind: "status" }
	| { kind: "help" }
	| { kind: "invalid"; argument: string };

export function parseFooterCommand(args: string): FooterCommandAction {
	const argument = args.trim();
	if (!argument) return { kind: "wizard" };
	if (argument === "toggle") return { kind: "toggle" };
	if (argument === "refresh") return { kind: "refresh" };
	if (argument === "status") return { kind: "status" };
	if (argument === "help") return { kind: "help" };
	if (argument === "compact" || argument === "balanced" || argument === "detailed") {
		return { kind: "preset", preset: argument };
	}
	if (argument === "minimal") return { kind: "preset", preset: "compact" };
	return { kind: "invalid", argument };
}

export const FOOTER_HELP = [
	"/footer - open the interactive configuration menu",
	"  Type to search, Enter confirms and saves, Esc goes back one level",
	"/footer toggle - enable or disable the Footer",
	"/footer compact|balanced|detailed - apply a built-in preset (minimal is a legacy alias)",
	"/footer refresh - refresh Git and provider usage",
	"/footer status - show non-secret status",
].join("\n");
