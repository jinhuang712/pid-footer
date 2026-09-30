export const CONFIG_VERSION = 1 as const;

export const PRESET_NAMES = ["compact", "balanced", "detailed", "custom"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const SEGMENT_IDS = [
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
] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];

export const VISIBILITY_RULES = [
	"always",
	"when-available",
	"when-nonempty",
	"when-streaming",
	"when-provider-supported",
	"when-state-is-warning",
] as const;
export type VisibilityRule = (typeof VISIBILITY_RULES)[number];

export const OVERFLOW_POLICIES = ["hide", "compact", "truncate"] as const;
export type OverflowPolicy = (typeof OVERFLOW_POLICIES)[number];

export const COLOR_MODES = ["semantic", "monochrome"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const ICON_MODES = ["off", "minimal", "nerd", "emoji"] as const;
export type IconMode = (typeof ICON_MODES)[number];

export const SEPARATOR_STYLES = ["none", "dot", "bar", "slash", "powerline", "ascii"] as const;
export type SeparatorStyle = (typeof SEPARATOR_STYLES)[number];

export const DENSITIES = ["compact", "cozy"] as const;
export type Density = (typeof DENSITIES)[number];

export const LABEL_MODES = ["automatic", "brief", "labeled", "detailed"] as const;
export type LabelMode = (typeof LABEL_MODES)[number];

export const COLOR_ROLES = [
	"text",
	"muted",
	"dim",
	"accent",
	"info",
	"success",
	"warning",
	"error",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const RESPONSIVE_STRATEGIES = [
	"hide-compact-truncate",
	"compact-hide-truncate",
	"truncate",
] as const;
export type ResponsiveStrategy = (typeof RESPONSIVE_STRATEGIES)[number];

/** Internal presentation detail resolved from the global label mode. */
export type SegmentFormat = "brief" | "compact" | "labeled" | "detailed";

/** Context display presets, ordered from least to most information. */
export const CONTEXT_DISPLAY_STYLES = ["compact", "hybrid", "full"] as const;
export const CONTEXT_DISPLAY_UI_ORDER = ["compact", "hybrid", "full"] as const;
export type ContextDisplayStyle = (typeof CONTEXT_DISPLAY_STYLES)[number];

/** Token display presets, ordered from least to most information. */
export const TOKEN_DISPLAY_STYLES = ["compact", "standard", "full"] as const;
export const TOKEN_DISPLAY_UI_ORDER = ["compact", "standard", "full"] as const;
export type TokenDisplayStyle = (typeof TOKEN_DISPLAY_STYLES)[number];

/** Cache presets: full read/write/hit line, hit ratio only, or compact counters. */
export const CACHE_DISPLAY_STYLES = ["read-write-hit", "ratio", "compact"] as const;
export const CACHE_DISPLAY_UI_ORDER = ["compact", "ratio", "read-write-hit"] as const;
export type CacheDisplayStyle = (typeof CACHE_DISPLAY_STYLES)[number];

/** Git presets: branch + dirty state, branch only, or everything available. */
export const GIT_DISPLAY_STYLES = ["branch", "status", "full"] as const;
export const GIT_DISPLAY_UI_ORDER = ["branch", "status", "full"] as const;
export type GitDisplayStyle = (typeof GIT_DISPLAY_STYLES)[number];

/** Project presets: bare directory name, home-relative, or absolute path. */
export const PROJECT_DISPLAY_STYLES = ["name", "tilde", "full"] as const;
export const PROJECT_DISPLAY_UI_ORDER = ["name", "tilde", "full"] as const;
export type ProjectDisplayStyle = (typeof PROJECT_DISPLAY_STYLES)[number];

/** Cost display presets, ordered from least to most information. */
export const COST_DISPLAY_STYLES = ["compact", "standard", "full"] as const;
export const COST_DISPLAY_UI_ORDER = ["compact", "standard", "full"] as const;
export type CostDisplayStyle = (typeof COST_DISPLAY_STYLES)[number];

/** Cost notation is independent from the amount of breakdown shown. */
export const COST_NOTATION_STYLES = ["arrows", "short", "full"] as const;
export const COST_NOTATION_UI_ORDER = ["arrows", "short", "full"] as const;
export type CostNotationStyle = (typeof COST_NOTATION_STYLES)[number];

/** Usage detail levels; window selection and reset display are independent. */
export const USAGE_DISPLAY_STYLES = ["compact", "standard", "detailed"] as const;
export const USAGE_DISPLAY_UI_ORDER = ["compact", "standard", "detailed"] as const;
export type UsageDisplayStyle = (typeof USAGE_DISPLAY_STYLES)[number];

/** User-selectable quota windows; provider-specific aliases stay internal. */
export const USAGE_WINDOWS = ["5h", "week", "month"] as const;
export const USAGE_WINDOW_UI_ORDER = ["5h", "week", "month"] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

export const USAGE_PROVIDERS = [
	"openai-codex",
	"opencode-go",
	"volcengine-agent-plan",
	"volcengine-coding-plan",
] as const;
export type UsageProviderId = (typeof USAGE_PROVIDERS)[number];

/** Fixed refresh tiers; free-form seconds are not user-configurable. */
export const USAGE_REFRESH_SECONDS_OPTIONS = [15, 30, 60, 120, 300, 600, 900] as const;
export type UsageRefreshSeconds = (typeof USAGE_REFRESH_SECONDS_OPTIONS)[number];

export const SEGMENT_DISPLAY_STYLES = {
	context: CONTEXT_DISPLAY_STYLES,
	tokens: TOKEN_DISPLAY_STYLES,
	cache: CACHE_DISPLAY_STYLES,
	git: GIT_DISPLAY_STYLES,
	cwd: PROJECT_DISPLAY_STYLES,
	cost: COST_DISPLAY_STYLES,
	provider_usage: USAGE_DISPLAY_STYLES,
} as const satisfies Partial<Record<SegmentId, readonly string[]>>;

export const SEGMENT_NOTATION_STYLES = {
	cost: COST_NOTATION_STYLES,
} as const satisfies Partial<Record<SegmentId, readonly string[]>>;

/**
 * Built-in responsive defaults. Priority and requiredness are not
 * user-configurable; formatting detail is owned by the global label mode.
 */
export interface SegmentBuiltInDefaults {
	priority: number;
	required: boolean;
}

export interface FooterRowConfig {
	id: string;
	left: SegmentId[];
	right: SegmentId[];
	visible: VisibilityRule;
	overflow: OverflowPolicy;
}

export interface FooterLayoutConfig {
	rows: FooterRowConfig[];
}

export interface FooterStyleConfig {
	colorMode: ColorMode;
	icons: IconMode;
	separator: SeparatorStyle;
	density: Density;
	labelMode: LabelMode;
}

/**
 * Per-Segment settings are intentionally small: presence and the display
 * label, plus Segment-specific display options. Formatting detail,
 * responsive priority, and requiredness are not configurable.
 */
export interface SegmentConfig {
	enabled: boolean;
	label?: string;
	/** @deprecated Use UsageConfig.windows for window selection. */
	maxWindows?: number;
	/** Curated per-Segment display preset; accepted ids live in SEGMENT_DISPLAY_STYLES. */
	display?: string;
	/** Optional content-specific notation; accepted ids live in SEGMENT_NOTATION_STYLES. */
	notation?: string;
}

export type SegmentConfigMap = Partial<Record<SegmentId, Partial<SegmentConfig>>>;

export interface UsageConfig {
	enabled: boolean;
	providers: UsageProviderId[];
	windows: UsageWindow[];
	refreshSeconds: number;
	showResetTime: boolean;
}

export interface ThresholdConfig {
	warning: number;
	error: number;
}

export interface FooterThresholdConfig {
	context: ThresholdConfig;
	providerUsage: ThresholdConfig;
}

export interface ResponsiveConfig {
	strategy: ResponsiveStrategy;
}

export interface ProjectOverridesConfig {
	enabled: boolean;
}

export interface FooterConfig {
	version: typeof CONFIG_VERSION;
	enabled: boolean;
	preset: PresetName;
	projectOverrides: ProjectOverridesConfig;
	layout: FooterLayoutConfig;
	style: FooterStyleConfig;
	segments: Record<SegmentId, SegmentConfig>;
	thresholds: FooterThresholdConfig;
	responsive: ResponsiveConfig;
	usage: UsageConfig;
}

export type DiagnosticSeverity = "warning" | "error";
export type DiagnosticCode = "unknown" | "invalid" | "parse" | "io";

export interface ConfigDiagnostic {
	severity: DiagnosticSeverity;
	code: DiagnosticCode;
	path: string;
	message: string;
}

export interface NormalizedConfig {
	config: FooterConfig;
	diagnostics: ConfigDiagnostic[];
}

export type ConfigSource = "built-in" | "global" | "project";

export interface LoadedConfig {
	config: FooterConfig;
	source: ConfigSource;
	globalPath: string;
	projectPath?: string;
	globalRawDocument?: string;
	projectRawDocument?: string;
	diagnostics: ConfigDiagnostic[];
}

/** Resolve the effective presentation format for a segment. */
export function resolveSegmentFormat(
	labelMode: LabelMode,
	preset: PresetName,
): Exclude<SegmentFormat, "compact"> {
	if (labelMode === "brief") return "brief";
	if (labelMode === "labeled") return "labeled";
	if (labelMode === "detailed") return "detailed";
	return preset === "compact" ? "brief" : preset === "detailed" ? "detailed" : "labeled";
}
