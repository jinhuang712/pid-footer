import type {
	FooterConfig,
	FooterLayoutConfig,
	FooterRowConfig,
	PresetName,
	SegmentBuiltInDefaults,
	SegmentConfig,
	SegmentId,
} from "./types.js";
import { CONFIG_VERSION, USAGE_PROVIDERS } from "./types.js";

const row = (
	id: string,
	left: FooterRowConfig["left"],
	right: FooterRowConfig["right"] = [],
	visible: FooterRowConfig["visible"] = "always",
): FooterRowConfig => ({
	id,
	left,
	right,
	visible,
	overflow: "hide",
});

// Keep the normal layouts aligned with the Footer's natural reading order:
// Project / Provider, Git / Context, Usage / Cost, Token / Cache.
const PREFERRED_LAYOUT: FooterLayoutConfig = {
	rows: [
		row("project", ["cwd"], ["identity"]),
		row("git", ["git"], ["context"]),
		row("usage", ["provider_usage"], ["cost"], "when-available"),
		row("session", ["tokens", "speed"], ["cache"]),
		row("extensions", ["extensions"], [], "when-nonempty"),
	],
};

// Compact keeps the same information priorities but fits the common case into
// two rows: orientation/identity first, then quota and session metrics.
const COMPACT_LAYOUT: FooterLayoutConfig = {
	rows: [
		row("overview", ["cwd", "git"], ["identity", "context"]),
		row("session", ["provider_usage"], ["tokens", "speed", "cache", "cost"]),
	],
};

export const PRESET_LAYOUTS: Record<Exclude<PresetName, "custom">, FooterLayoutConfig> = {
	compact: structuredClone(COMPACT_LAYOUT),
	balanced: structuredClone(PREFERRED_LAYOUT),
	detailed: structuredClone(PREFERRED_LAYOUT),
};

/** Built-in responsive defaults; not user-configurable. */
export const SEGMENT_DEFAULTS: Record<SegmentId, SegmentBuiltInDefaults> = {
	identity: { priority: 100, required: true },
	provider: { priority: 85, required: false },
	model: { priority: 100, required: true },
	thinking: { priority: 40, required: false },
	// The project path is a primary orientation cue and should survive before
	// the verbose Git stats at narrow widths.
	cwd: { priority: 85, required: false },
	git: { priority: 70, required: false },
	context: { priority: 100, required: true },
	// Cache survives narrowing longer than Tokens: a silent cache miss is more
	// costly to notice than losing the raw token counters.
	tokens: { priority: 45, required: false },
	speed: { priority: 50, required: false },
	cache: { priority: 65, required: false },
	cost: { priority: 70, required: false },
	tools: { priority: 60, required: false },
	provider_usage: { priority: 85, required: false },
	extensions: { priority: 20, required: false },
};

const CUSTOM_DEFAULT_DISPLAYS: Partial<Record<SegmentId, string>> = {
	cwd: "tilde",
	git: "full",
	context: "full",
	tokens: "standard",
	cache: "compact",
	cost: "standard",
	provider_usage: "detailed",
};

const CUSTOM_DEFAULT_NOTATIONS: Partial<Record<SegmentId, string>> = {
	cost: "short",
};

const PRESET_SEGMENT_DISPLAYS: Record<
	Exclude<PresetName, "custom">,
	Partial<Record<SegmentId, string>>
> = {
	compact: {
		cwd: "name",
		git: "status",
		context: "compact",
		tokens: "compact",
		cache: "compact",
		cost: "compact",
		provider_usage: "compact",
	},
	balanced: {
		cwd: "tilde",
		git: "status",
		context: "hybrid",
		tokens: "standard",
		cache: "read-write-hit",
		cost: "standard",
		provider_usage: "standard",
	},
	detailed: {
		cwd: "tilde",
		git: "full",
		context: "full",
		tokens: "full",
		cache: "read-write-hit",
		cost: "full",
		provider_usage: "detailed",
	},
};

const PRESET_SEGMENT_NOTATIONS: Record<
	Exclude<PresetName, "custom">,
	Partial<Record<SegmentId, string>>
> = {
	compact: { cost: "short" },
	balanced: { cost: "short" },
	detailed: { cost: "full" },
};

function createSegmentConfig(
	displays: Partial<Record<SegmentId, string>> = {},
	notations: Partial<Record<SegmentId, string>> = {},
): Record<SegmentId, SegmentConfig> {
	return Object.fromEntries(
		(Object.keys(SEGMENT_DEFAULTS) as SegmentId[]).map((id) => [
			id,
			{
				enabled: true,
				...(displays[id] === undefined ? {} : { display: displays[id] }),
				...(notations[id] === undefined ? {} : { notation: notations[id] }),
			},
		]),
	) as Record<SegmentId, SegmentConfig>;
}

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
	version: CONFIG_VERSION,
	enabled: true,
	preset: "custom",
	projectOverrides: {
		enabled: false,
	},
	layout: PRESET_LAYOUTS.balanced,
	style: {
		colorMode: "semantic",
		icons: "off",
		separator: "dot",
		density: "compact",
		labelMode: "automatic",
	},
	segments: createSegmentConfig(CUSTOM_DEFAULT_DISPLAYS, CUSTOM_DEFAULT_NOTATIONS),
	thresholds: {
		context: { warning: 70, error: 90 },
		providerUsage: { warning: 70, error: 90 },
	},
	responsive: {
		strategy: "hide-compact-truncate",
	},
	usage: {
		enabled: true,
		providers: [...USAGE_PROVIDERS],
		windows: ["5h", "week"],
		refreshSeconds: 30,
		showResetTime: true,
	},
};

export function cloneConfig(config: FooterConfig = DEFAULT_FOOTER_CONFIG): FooterConfig {
	return structuredClone(config);
}

export function createDefaultConfig(): FooterConfig {
	return cloneConfig();
}

/** Return the current profile used as the starting point for Custom mode. */
export function createCustomDefaultConfig(): FooterConfig {
	return cloneConfig(DEFAULT_FOOTER_CONFIG);
}

export function createDefaultSegmentConfig(): Record<SegmentId, SegmentConfig> {
	return createSegmentConfig();
}

export function createPresetSegmentConfig(
	preset: Exclude<PresetName, "custom">,
): Record<SegmentId, SegmentConfig> {
	return createSegmentConfig(PRESET_SEGMENT_DISPLAYS[preset], PRESET_SEGMENT_NOTATIONS[preset]);
}

export function layoutForPreset(preset: PresetName): FooterLayoutConfig | undefined {
	if (preset === "custom") return undefined;
	return structuredClone(PRESET_LAYOUTS[preset]);
}
