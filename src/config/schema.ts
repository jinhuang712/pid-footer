import { segmentConfigFields } from "../segments/metadata.js";
import { cloneConfig, createPresetSegmentConfig, layoutForPreset } from "./defaults.js";
import { cleanLayoutRows } from "./layout.js";
import {
	COLOR_MODES,
	CONFIG_VERSION,
	type ConfigDiagnostic,
	DENSITIES,
	type FooterConfig,
	type FooterLayoutConfig,
	type FooterRowConfig,
	ICON_MODES,
	LABEL_MODES,
	type NormalizedConfig,
	OVERFLOW_POLICIES,
	PRESET_NAMES,
	RESPONSIVE_STRATEGIES,
	SEGMENT_DISPLAY_STYLES,
	SEGMENT_IDS,
	SEGMENT_NOTATION_STYLES,
	SEPARATOR_STYLES,
	type SegmentId,
	USAGE_PROVIDERS,
	USAGE_REFRESH_SECONDS_OPTIONS,
	USAGE_WINDOWS,
	type UsageDisplayStyle,
	type UsageWindow,
	VISIBILITY_RULES,
} from "./types.js";

/** Per-Segment fields that were removed in favor of simpler global controls. */
const REMOVED_SEGMENT_FIELDS = new Set([
	"format",
	"visibility",
	"priority",
	"required",
	"colorRole",
	"emphasis",
	"minWidth",
]);

/** Provider Usage field kept for the existing settings schema. */
const LEGACY_SEGMENT_FIELDS: Partial<Record<SegmentId, readonly string[]>> = {
	provider_usage: ["maxWindows"],
};

/** `minimal` was the old name for the compact built-in preset. */
const LEGACY_PRESET_NAMES = { minimal: "compact" } as const;

/** `path` was the old name for the home-relative project display. */
const LEGACY_PROJECT_DISPLAY_STYLES: Record<string, string> = {
	// Retained only as an input migration: old configs keep rendering `~/…`.
	path: "tilde",
};

/** Usage display names from the previous, more granular settings model. */
const LEGACY_USAGE_DISPLAY_STYLES: Record<string, UsageDisplayStyle> = {
	// The old display names are retained only as input migrations.
	timed: "detailed",
	focus: "detailed",
	full: "detailed",
	verbose: "detailed",
	windows: "standard",
	max: "detailed",
	"percent-only": "compact",
	"no-reset": "standard",
	"reset-focus": "detailed",
	"ratio-bars": "standard",
	countdown: "detailed",
	"compact-list": "compact",
};

const LEGACY_USAGE_WINDOWS = ["rolling"] as const;

export function normalizeConfig(value: unknown, base?: FooterConfig): NormalizedConfig {
	const config = cloneConfig(base);
	const diagnostics: ConfigDiagnostic[] = [];

	if (!isRecord(value)) {
		return {
			config,
			diagnostics: [invalidDiagnostic("", "Expected a JSON object")],
		};
	}

	const knownRoot = new Set([
		"version",
		"enabled",
		"preset",
		"projectOverrides",
		"layout",
		"style",
		"segments",
		"thresholds",
		"responsive",
		"usage",
	]);
	for (const key of Object.keys(value)) {
		if (!knownRoot.has(key)) diagnostics.push(unknownDiagnostic(key));
	}

	if (value.version !== undefined) {
		if (value.version !== CONFIG_VERSION) {
			diagnostics.push(invalidDiagnostic("version", `Expected version ${CONFIG_VERSION}`));
		}
	}

	if (value.enabled !== undefined) {
		if (typeof value.enabled === "boolean") config.enabled = value.enabled;
		else diagnostics.push(invalidDiagnostic("enabled", "Expected a boolean"));
	}

	let hasExplicitLayout = false;
	if (value.preset !== undefined) {
		const legacyPreset =
			typeof value.preset === "string" ? LEGACY_PRESET_NAMES[value.preset as "minimal"] : undefined;
		const preset = legacyPreset ?? value.preset;
		if (legacyPreset) {
			diagnostics.push(migratedDiagnostic("preset", 'Preset "minimal" was renamed to "compact"'));
		}
		if (isPresetName(preset)) {
			// Built-in presets always own their known-good layout. A custom layout
			// is an explicit mode, rather than a mutable version of a preset.
			if (preset === "custom") {
				if (value.layout === undefined) {
					diagnostics.push(
						invalidDiagnostic("preset", 'The "custom" preset requires an explicit layout'),
					);
				} else {
					config.preset = "custom";
				}
			} else {
				config.preset = preset;
				if (value.layout === undefined) {
					config.layout = layoutForPreset(preset) ?? config.layout;
					config.segments = createPresetSegmentConfig(preset);
					config.style.labelMode = "automatic";
				}
			}
		} else diagnostics.push(invalidDiagnostic("preset", "Unknown preset name"));
	}

	if (value.projectOverrides !== undefined) {
		if (!isRecord(value.projectOverrides)) {
			diagnostics.push(invalidDiagnostic("projectOverrides", "Expected an object"));
		} else {
			checkUnknownKeys(value.projectOverrides, ["enabled"], "projectOverrides", diagnostics);
			if (value.projectOverrides.enabled !== undefined) {
				if (typeof value.projectOverrides.enabled === "boolean") {
					config.projectOverrides.enabled = value.projectOverrides.enabled;
				} else {
					diagnostics.push(invalidDiagnostic("projectOverrides.enabled", "Expected a boolean"));
				}
			}
		}
	}

	if (value.layout !== undefined) {
		hasExplicitLayout = true;
		const layout = normalizeLayout(value.layout, config.layout, diagnostics);
		if (layout) config.layout = layout;
	}
	if (hasExplicitLayout) config.preset = "custom";
	// Do not insert new components into a user's existing explicit layout.
	// An absent Speed placement/setting starts Off, so enabling it in the UI adds it.
	if (
		hasExplicitLayout &&
		!config.layout.rows.some((row) => [...row.left, ...row.right].includes("speed")) &&
		(!isRecord(value.segments) || value.segments.speed === undefined)
	) {
		config.segments.speed.enabled = false;
	}
	const presetLocked = config.preset !== "custom";

	if (value.style !== undefined) normalizeStyle(value.style, config, diagnostics, presetLocked);
	if (value.segments !== undefined)
		normalizeSegments(value.segments, config, diagnostics, presetLocked);
	if (value.thresholds !== undefined) normalizeThresholds(value.thresholds, config, diagnostics);
	if (value.responsive !== undefined) normalizeResponsive(value.responsive, config, diagnostics);
	if (value.usage !== undefined) normalizeUsage(value.usage, config, diagnostics);

	return { config, diagnostics };
}

function normalizeLayout(
	value: unknown,
	base: FooterLayoutConfig,
	diagnostics: ConfigDiagnostic[],
): FooterLayoutConfig | undefined {
	if (!isRecord(value)) {
		diagnostics.push(invalidDiagnostic("layout", "Expected an object"));
		return undefined;
	}
	checkUnknownKeys(value, ["rows"], "layout", diagnostics);
	if (!Array.isArray(value.rows)) {
		diagnostics.push(invalidDiagnostic("layout.rows", "Expected an array"));
		return undefined;
	}

	const rows: FooterRowConfig[] = [];
	const seenIds = new Set<string>();
	for (const [index, item] of value.rows.entries()) {
		const path = `layout.rows[${index}]`;
		const normalized = normalizeRow(item, path, diagnostics);
		if (!normalized) continue;
		if (seenIds.has(normalized.id)) {
			diagnostics.push(
				invalidDiagnostic(`${path}.id`, `Duplicate row id ${JSON.stringify(normalized.id)}`),
			);
			continue;
		}
		seenIds.add(normalized.id);
		rows.push(normalized);
	}
	if (rows.length === 0 && value.rows.length > 0) return base;

	const cleaned = cleanLayoutRows(rows);
	if (
		cleaned.length !== rows.length ||
		layoutReferenceCount(cleaned) !== layoutReferenceCount(rows)
	) {
		diagnostics.push(
			migratedDiagnostic(
				"layout.rows",
				"Empty or duplicate Segment placements were removed from the layout",
			),
		);
	}
	return { rows: cleaned };
}

function layoutReferenceCount(rows: readonly FooterRowConfig[]): number {
	return rows.reduce((count, row) => count + row.left.length + row.right.length, 0);
}

function normalizeRow(
	value: unknown,
	path: string,
	diagnostics: ConfigDiagnostic[],
): FooterRowConfig | undefined {
	if (!isRecord(value)) {
		diagnostics.push(invalidDiagnostic(path, "Expected an object"));
		return undefined;
	}
	checkUnknownKeys(value, ["id", "left", "right", "visible", "overflow"], path, diagnostics);

	if (typeof value.id !== "string" || !/^[a-z][a-z0-9_-]*$/u.test(value.id)) {
		diagnostics.push(invalidDiagnostic(`${path}.id`, "Expected a safe row id"));
		return undefined;
	}

	const left = normalizeReferences(value.left ?? [], `${path}.left`, diagnostics);
	const right = normalizeReferences(value.right ?? [], `${path}.right`, diagnostics);
	if (left === undefined || right === undefined) return undefined;

	const visible = normalizeEnum(
		value.visible,
		VISIBILITY_RULES,
		"always",
		`${path}.visible`,
		diagnostics,
	);
	const overflow = normalizeEnum(
		value.overflow,
		OVERFLOW_POLICIES,
		"hide",
		`${path}.overflow`,
		diagnostics,
	);

	return {
		id: value.id,
		left,
		right,
		visible,
		overflow,
	};
}

function normalizeReferences(
	value: unknown,
	path: string,
	diagnostics: ConfigDiagnostic[],
): SegmentId[] | undefined {
	if (!Array.isArray(value)) {
		diagnostics.push(invalidDiagnostic(path, "Expected an array"));
		return undefined;
	}
	const result: SegmentId[] = [];
	for (const [index, item] of value.entries()) {
		const itemPath = `${path}[${index}]`;
		if (typeof item === "string") {
			if (isSegmentId(item)) result.push(item);
			else diagnostics.push(invalidDiagnostic(itemPath, "Unknown Segment id"));
			continue;
		}
		if (isRecord(item) && isSegmentId(item.id)) {
			result.push(item.id);
			diagnostics.push(unknownDiagnostic(`${itemPath}.options`));
			continue;
		}
		diagnostics.push(invalidDiagnostic(itemPath, "Expected a Segment id string"));
	}
	return result;
}

function normalizeStyle(
	value: unknown,
	config: FooterConfig,
	diagnostics: ConfigDiagnostic[],
	presetLocked: boolean,
): void {
	if (!isRecord(value)) {
		diagnostics.push(invalidDiagnostic("style", "Expected an object"));
		return;
	}
	checkUnknownKeys(
		value,
		["colorMode", "icons", "separator", "density", "labelMode"],
		"style",
		diagnostics,
	);
	config.style.colorMode = normalizeEnum(
		value.colorMode,
		COLOR_MODES,
		config.style.colorMode,
		"style.colorMode",
		diagnostics,
	);
	config.style.icons = normalizeEnum(
		value.icons,
		ICON_MODES,
		config.style.icons,
		"style.icons",
		diagnostics,
	);
	config.style.separator = normalizeEnum(
		value.separator,
		SEPARATOR_STYLES,
		config.style.separator,
		"style.separator",
		diagnostics,
	);
	config.style.density = normalizeEnum(
		value.density,
		DENSITIES,
		config.style.density,
		"style.density",
		diagnostics,
	);
	if (value.labelMode !== undefined && presetLocked) {
		diagnostics.push(lockedDiagnostic("style.labelMode"));
	} else {
		config.style.labelMode = normalizeEnum(
			value.labelMode,
			LABEL_MODES,
			config.style.labelMode,
			"style.labelMode",
			diagnostics,
		);
	}
}

function normalizeSegments(
	value: unknown,
	config: FooterConfig,
	diagnostics: ConfigDiagnostic[],
	presetLocked: boolean,
): void {
	if (!isRecord(value)) {
		diagnostics.push(invalidDiagnostic("segments", "Expected an object"));
		return;
	}
	if (presetLocked) {
		diagnostics.push(lockedDiagnostic("segments"));
		return;
	}
	for (const [id, valueForSegment] of Object.entries(value)) {
		const path = `segments.${id}`;
		if (!isSegmentId(id)) {
			diagnostics.push(unknownDiagnostic(path));
			continue;
		}
		if (!isRecord(valueForSegment)) {
			diagnostics.push(invalidDiagnostic(path, "Expected an object"));
			continue;
		}
		const supportedFields = new Set([
			...segmentConfigFields(id).map((field) => field.key),
			...(LEGACY_SEGMENT_FIELDS[id] ?? []),
			...REMOVED_SEGMENT_FIELDS,
		]);
		checkUnknownKeys(valueForSegment, [...supportedFields], path, diagnostics);
		for (const key of Object.keys(valueForSegment)) {
			if (REMOVED_SEGMENT_FIELDS.has(key)) {
				diagnostics.push(removedDiagnostic(`${path}.${key}`));
			}
		}
		const target = config.segments[id];
		if (id === "provider_usage") delete target.maxWindows;
		if (supportedFields.has("enabled"))
			applyBoolean(valueForSegment.enabled, target, "enabled", `${path}.enabled`, diagnostics);
		if (supportedFields.has("label") && valueForSegment.label !== undefined) {
			if (isSafeLabel(valueForSegment.label)) target.label = valueForSegment.label;
			else
				diagnostics.push(
					invalidDiagnostic(`${path}.label`, "Expected plain text up to 40 characters"),
				);
		}
		if (id === "provider_usage" && valueForSegment.maxWindows !== undefined) {
			diagnostics.push(
				migratedDiagnostic(
					`${path}.maxWindows`,
					"Maximum Usage windows is replaced by usage.windows; ignoring maxWindows",
				),
			);
		}
		const displayStyles: readonly string[] | undefined = (
			SEGMENT_DISPLAY_STYLES as Record<string, readonly string[]>
		)[id];
		if (displayStyles && valueForSegment.display !== undefined) {
			if (isOneOf(valueForSegment.display, displayStyles)) {
				target.display = valueForSegment.display;
			} else if (id === "cwd" && typeof valueForSegment.display === "string") {
				const migrated = LEGACY_PROJECT_DISPLAY_STYLES[valueForSegment.display];
				if (migrated) {
					target.display = migrated;
					diagnostics.push(
						migratedDiagnostic(
							`${path}.display`,
							`Project display ${JSON.stringify(valueForSegment.display)} was renamed; using ${JSON.stringify(migrated)}`,
						),
					);
				} else {
					diagnostics.push(invalidDiagnostic(`${path}.display`, "Unknown display preset"));
				}
			} else if (id === "provider_usage" && typeof valueForSegment.display === "string") {
				const migrated = LEGACY_USAGE_DISPLAY_STYLES[valueForSegment.display];
				if (migrated) {
					target.display = migrated;
					diagnostics.push(
						migratedDiagnostic(
							`${path}.display`,
							`Usage display ${JSON.stringify(valueForSegment.display)} was renamed; using ${JSON.stringify(migrated)}`,
						),
					);
				} else {
					diagnostics.push(invalidDiagnostic(`${path}.display`, "Unknown display preset"));
				}
			} else {
				diagnostics.push(invalidDiagnostic(`${path}.display`, "Unknown display preset"));
			}
		}
		const notationStyles: readonly string[] | undefined = (
			SEGMENT_NOTATION_STYLES as Record<string, readonly string[]>
		)[id];
		if (notationStyles && valueForSegment.notation !== undefined) {
			if (isOneOf(valueForSegment.notation, notationStyles)) {
				target.notation = valueForSegment.notation;
			} else {
				diagnostics.push(invalidDiagnostic(`${path}.notation`, "Unknown notation style"));
			}
		}
	}
}

function normalizeThresholds(
	value: unknown,
	config: FooterConfig,
	diagnostics: ConfigDiagnostic[],
): void {
	if (!isRecord(value)) {
		diagnostics.push(invalidDiagnostic("thresholds", "Expected an object"));
		return;
	}
	checkUnknownKeys(value, ["context", "providerUsage"], "thresholds", diagnostics);
	normalizeThresholdGroup(
		value.context,
		config.thresholds.context,
		"thresholds.context",
		diagnostics,
	);
	normalizeThresholdGroup(
		value.providerUsage,
		config.thresholds.providerUsage,
		"thresholds.providerUsage",
		diagnostics,
	);
}

function normalizeThresholdGroup(
	value: unknown,
	target: { warning: number; error: number },
	path: string,
	diagnostics: ConfigDiagnostic[],
): void {
	if (value === undefined) return;
	if (!isRecord(value)) {
		diagnostics.push(invalidDiagnostic(path, "Expected an object"));
		return;
	}
	checkUnknownKeys(value, ["warning", "error"], path, diagnostics);
	applyNumber(value.warning, target, "warning", `${path}.warning`, diagnostics, 0, 100);
	applyNumber(value.error, target, "error", `${path}.error`, diagnostics, 0, 100);
	if (target.error < target.warning) {
		diagnostics.push(
			invalidDiagnostic(path, "error threshold must be greater than or equal to warning"),
		);
	}
}

function normalizeResponsive(
	value: unknown,
	config: FooterConfig,
	diagnostics: ConfigDiagnostic[],
): void {
	if (!isRecord(value)) {
		diagnostics.push(invalidDiagnostic("responsive", "Expected an object"));
		return;
	}
	checkUnknownKeys(value, ["strategy"], "responsive", diagnostics);
	config.responsive.strategy = normalizeEnum(
		value.strategy,
		RESPONSIVE_STRATEGIES,
		config.responsive.strategy,
		"responsive.strategy",
		diagnostics,
	);
}

function normalizeUsage(
	value: unknown,
	config: FooterConfig,
	diagnostics: ConfigDiagnostic[],
): void {
	if (!isRecord(value)) {
		diagnostics.push(invalidDiagnostic("usage", "Expected an object"));
		return;
	}
	checkUnknownKeys(
		value,
		["enabled", "providers", "windows", "refreshSeconds", "showResetTime"],
		"usage",
		diagnostics,
	);
	applyBoolean(value.enabled, config.usage, "enabled", "usage.enabled", diagnostics);
	applyBoolean(
		value.showResetTime,
		config.usage,
		"showResetTime",
		"usage.showResetTime",
		diagnostics,
	);
	normalizeRefreshSeconds(value.refreshSeconds, config, diagnostics);
	if (value.windows !== undefined) {
		if (!Array.isArray(value.windows)) {
			diagnostics.push(invalidDiagnostic("usage.windows", "Expected an array"));
		} else {
			const selected = new Set<UsageWindow>();
			for (const window of value.windows) {
				if (isOneOf(window, USAGE_WINDOWS)) {
					selected.add(window);
					continue;
				}
				if (isOneOf(window, LEGACY_USAGE_WINDOWS)) {
					selected.add("5h");
					diagnostics.push(
						migratedDiagnostic("usage.windows", 'Usage window "rolling" was renamed to "5h"'),
					);
					continue;
				}
				diagnostics.push(invalidDiagnostic("usage.windows", "Unknown usage window"));
			}
			if (selected.size > 0) {
				config.usage.windows = USAGE_WINDOWS.filter((window) => selected.has(window));
			} else {
				diagnostics.push(
					invalidDiagnostic("usage.windows", "At least one usage window must be selected"),
				);
			}
		}
	}
	if (value.providers !== undefined) {
		if (!Array.isArray(value.providers)) {
			diagnostics.push(invalidDiagnostic("usage.providers", "Expected an array"));
		} else {
			const providers = value.providers.filter(
				(provider): provider is (typeof USAGE_PROVIDERS)[number] => {
					if (isOneOf(provider, USAGE_PROVIDERS)) return true;
					diagnostics.push(invalidDiagnostic("usage.providers", "Unknown Provider id"));
					return false;
				},
			);
			config.usage.providers = [...new Set(providers)];
		}
	}
}

function normalizeRefreshSeconds(
	value: unknown,
	config: FooterConfig,
	diagnostics: ConfigDiagnostic[],
): void {
	if (value === undefined) return;
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		diagnostics.push(
			invalidDiagnostic("usage.refreshSeconds", "Expected an integer number of seconds"),
		);
		return;
	}
	if ((USAGE_REFRESH_SECONDS_OPTIONS as readonly number[]).includes(value)) {
		config.usage.refreshSeconds = value;
		return;
	}
	const nearest = USAGE_REFRESH_SECONDS_OPTIONS.reduce((best, candidate) =>
		Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
	);
	config.usage.refreshSeconds = nearest;
	diagnostics.push(
		migratedDiagnostic(
			"usage.refreshSeconds",
			`Refresh interval ${value}s is not a supported tier; using ${nearest}s`,
		),
	);
}

function applyBoolean<T extends object>(
	value: unknown,
	target: T,
	key: keyof T,
	path: string,
	diagnostics: ConfigDiagnostic[],
): void {
	if (value === undefined) return;
	if (typeof value === "boolean") {
		(target as Record<keyof T, unknown>)[key] = value;
	} else diagnostics.push(invalidDiagnostic(path, "Expected a boolean"));
}

function applyNumber<T extends object>(
	value: unknown,
	target: T,
	key: keyof T,
	path: string,
	diagnostics: ConfigDiagnostic[],
	min: number,
	max: number,
): void {
	if (value === undefined) return;
	if (isIntegerInRange(value, min, max)) {
		(target as Record<keyof T, unknown>)[key] = value;
	} else diagnostics.push(invalidDiagnostic(path, `Expected an integer from ${min} to ${max}`));
}

function normalizeEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
	path: string,
	diagnostics: ConfigDiagnostic[],
): T {
	if (value === undefined) return fallback;
	if (isOneOf(value, allowed)) return value;
	diagnostics.push(invalidDiagnostic(path, "Unknown value"));
	return fallback;
}

function checkUnknownKeys(
	value: Record<string, unknown>,
	known: readonly string[],
	prefix: string,
	diagnostics: ConfigDiagnostic[],
): void {
	const knownSet = new Set(known);
	for (const key of Object.keys(value)) {
		if (!knownSet.has(key)) diagnostics.push(unknownDiagnostic(`${prefix}.${key}`));
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
	return typeof value === "string" && values.includes(value as T);
}

function isPresetName(value: unknown): value is FooterConfig["preset"] {
	return isOneOf(value, PRESET_NAMES);
}

function isSegmentId(value: unknown): value is SegmentId {
	return isOneOf(value, SEGMENT_IDS);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isSafeLabel(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 40) return false;
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 32 || code === 127) return false;
	}
	return true;
}

function unknownDiagnostic(path: string): ConfigDiagnostic {
	return {
		severity: "warning",
		code: "unknown",
		path,
		message: `Unknown setting ${JSON.stringify(path)}`,
	};
}

function lockedDiagnostic(path: string): ConfigDiagnostic {
	return {
		severity: "warning",
		code: "unknown",
		path,
		message: `Setting ${JSON.stringify(path)} is owned by the active preset; switch to custom with an explicit layout to edit it`,
	};
}

function migratedDiagnostic(path: string, message: string): ConfigDiagnostic {
	return { severity: "warning", code: "unknown", path, message };
}

function removedDiagnostic(path: string): ConfigDiagnostic {
	return {
		severity: "warning",
		code: "unknown",
		path,
		message: `Setting ${JSON.stringify(path)} was removed; formatting detail is owned by style.labelMode and responsive defaults are built in`,
	};
}

function invalidDiagnostic(path: string, message: string): ConfigDiagnostic {
	return { severity: "error", code: "invalid", path, message };
}
