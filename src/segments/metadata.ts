import type { LabelMode, PresetName, SegmentConfig, SegmentId } from "../config/types.js";
import {
	resolveSegmentFormat,
	SEGMENT_DISPLAY_STYLES,
	SEGMENT_IDS,
	SEGMENT_NOTATION_STYLES,
} from "../config/types.js";

export type SegmentConfigFieldKey = keyof SegmentConfig;
export type SegmentConfigFieldKind = "toggle" | "select" | "number" | "text";

export interface SegmentConfigField {
	key: SegmentConfigFieldKey;
	label: string;
	kind: SegmentConfigFieldKind;
	description: string;
	options?: readonly string[];
}

export interface SegmentMetadata {
	id: SegmentId;
	label: string;
	description: string;
	configFields: readonly SegmentConfigField[];
	preview(config: SegmentConfig, labelMode: LabelMode, preset?: PresetName): string;
}

const commonFields: readonly SegmentConfigField[] = [
	{
		key: "enabled",
		label: "Enabled",
		kind: "toggle",
		description: "Whether this Segment can render.",
	},
	{
		key: "label",
		label: "Label",
		kind: "text",
		description: "Human-readable label shown in labeled formats.",
	},
];

const fields = (...specific: SegmentConfigField[]): readonly SegmentConfigField[] => [
	...commonFields,
	...specific,
];

/** Shared Display preset field derived from SEGMENT_DISPLAY_STYLES. */
const displayFieldFor = (id: SegmentId): SegmentConfigField => ({
	key: "display",
	label: "Display",
	kind: "select",
	description: "Curated format presets for this information block.",
	options: (SEGMENT_DISPLAY_STYLES as Record<string, readonly string[]>)[id] ?? [],
});

/** Optional content-specific notation, currently used by Cost. */
const notationFieldFor = (id: SegmentId): SegmentConfigField => ({
	key: "notation",
	label: "Notation",
	kind: "select",
	description: "Choose how the Cost breakdown labels are written.",
	options: (SEGMENT_NOTATION_STYLES as Record<string, readonly string[]>)[id] ?? [],
});

export const SEGMENT_CONFIG_FIELDS: Record<SegmentId, readonly SegmentConfigField[]> =
	Object.fromEntries(
		SEGMENT_IDS.map((id) => {
			const specific = [
				...(id in SEGMENT_DISPLAY_STYLES ? [displayFieldFor(id)] : []),
				...(id in SEGMENT_NOTATION_STYLES ? [notationFieldFor(id)] : []),
			];
			return [id, fields(...specific)];
		}),
	) as Record<SegmentId, readonly SegmentConfigField[]>;

const SEGMENT_LABELS: Record<SegmentId, string> = {
	identity: "Identity",
	provider: "Provider",
	model: "Model",
	thinking: "Thinking",
	cwd: "Project",
	git: "Git",
	context: "Context",
	tokens: "Tokens",
	speed: "Speed",
	cache: "Cache",
	cost: "Cost",
	tools: "Tool",
	provider_usage: "Provider Usage",
	extensions: "Extensions",
};

const SEGMENT_EXAMPLES: Record<SegmentId, string> = {
	identity: "openai-codex: gpt-5.6-luna (xhigh)",
	provider: "openai-codex",
	model: "gpt-5.6-luna",
	thinking: "xhigh",
	cwd: "project",
	git: "main · dirty",
	context: "261k/1.0m (25.5%)",
	tokens: "input ↓ 901k · output ↑ 63k",
	speed: "42.5 tok/s",
	cache: "read 19.7m · write 0 · hit 99.3%",
	cost: "$0.123",
	tools: "Read",
	provider_usage: "Codex 58% (5hr) · 9% (7d)",
	extensions: "lint: ready",
};

export const SEGMENT_METADATA: Record<SegmentId, SegmentMetadata> = Object.fromEntries(
	SEGMENT_IDS.map((id) => [
		id,
		{
			id,
			label: SEGMENT_LABELS[id],
			description: `Configure the ${SEGMENT_LABELS[id]} Footer Segment.`,
			configFields: SEGMENT_CONFIG_FIELDS[id],
			preview: (config: SegmentConfig, labelMode: LabelMode, preset?: PresetName) =>
				segmentPreviewValue(id, config, labelMode, preset),
		},
	]),
) as Record<SegmentId, SegmentMetadata>;

function segmentPreviewValue(
	id: SegmentId,
	config: SegmentConfig,
	labelMode: LabelMode,
	preset?: PresetName,
): string {
	if (!config.enabled) return "hidden";
	const format = resolveSegmentFormat(labelMode, preset ?? "balanced");
	const example = SEGMENT_EXAMPLES[id];
	const label = config.label ?? SEGMENT_LABELS[id];
	if (id === "identity") return config.label ? `${config.label}: ${example}` : example;
	if (id === "provider_usage") {
		return `${label}: ${providerUsagePreview(config.display, format)}`;
	}
	if (id === "context") {
		return `${label}: ${contextPreview(config.display)}`;
	}
	if (id === "tokens") {
		return `${label}: ${tokensPreview(config.display)}`;
	}
	if (id === "cost") {
		return `${label}: ${costPreview(config.display, config.notation)}`;
	}
	if (format === "brief") return `${label}: ${compactPreview(id)}`;
	if (format === "detailed") return `${label}: ${example}`;
	return `${label}: ${example}`;
}

function compactPreview(id: SegmentId): string {
	const examples: Record<SegmentId, string> = {
		identity: "openai-codex: gpt-5.6-luna (xhigh)",
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		thinking: "xhigh",
		cwd: "project",
		git: "main · dirty",
		context: "64.4%",
		tokens: "964k",
		speed: "42.5 tok/s",
		cache: "19.7mr 0w 99.3% hit",
		cost: "$0.123",
		tools: "Read",
		provider_usage: "Codex 58% (5h)",
		extensions: "lint: ready",
	};
	return examples[id];
}

function tokensPreview(display: string | undefined): string {
	switch (display) {
		case "compact":
			return "964k";
		case "standard":
			return "↓901k ↑63k";
		default:
			return "input ↓901k · output ↑63k";
	}
}

function costPreview(display: string | undefined, notation: string | undefined): string {
	const effectiveDisplay = display ?? "standard";
	const effectiveNotation = notation ?? "short";
	if (effectiveDisplay === "compact") return "$0.123";
	if (effectiveDisplay === "standard") {
		const cacheLabel =
			effectiveNotation === "full" ? "Cached" : effectiveNotation === "arrows" ? "↔" : "cache";
		const noCacheLabel =
			effectiveNotation === "full" ? "No Cache" : effectiveNotation === "arrows" ? "—" : "no-cache";
		return `$0.123 · ${cacheLabel} $0.028 · ${noCacheLabel} $0.095`;
	}
	if (effectiveNotation === "full") {
		return "$0.123 · Input $0.012 · Output $0.083 · Cache In $0.025 · Cache Write $0.003";
	}
	if (effectiveNotation === "arrows") return "$0.123 · ↓$0.012 · ↑$0.083 · ←$0.025 · →$0.003";
	return "$0.123 · in $0.012 · out $0.083 · read $0.025 · write $0.003";
}

function contextPreview(display: string | undefined): string {
	switch (display) {
		case "compact":
			return "25.5%";
		case "hybrid":
			return "1.0m × 25.5%";
		default:
			return "261k/1.0m (25.5%)";
	}
}

function providerUsagePreview(
	display: string | undefined,
	format: "brief" | "compact" | "labeled" | "detailed",
): string {
	const effective =
		display ?? (format === "brief" ? "compact" : format === "detailed" ? "detailed" : "standard");
	switch (effective) {
		case "compact":
			return "58% · 9%";
		case "detailed":
			return "Codex 58% (5hr resets in 3hr53m) · 9% (7d)";
		default:
			return "Codex 58% (5hr) · 9% (7d)";
	}
}

export function segmentConfigFields(id: SegmentId): readonly SegmentConfigField[] {
	return SEGMENT_CONFIG_FIELDS[id];
}

export function segmentMetadata(id: SegmentId): SegmentMetadata {
	return SEGMENT_METADATA[id];
}

export function segmentLabel(id: SegmentId): string {
	return SEGMENT_METADATA[id].label;
}

export function segmentPreview(
	id: SegmentId,
	config: SegmentConfig,
	labelMode: LabelMode,
	preset?: PresetName,
): string {
	return SEGMENT_METADATA[id].preview(config, labelMode, preset);
}
