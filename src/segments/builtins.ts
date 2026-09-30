import type {
	CacheDisplayStyle,
	ContextDisplayStyle,
	CostDisplayStyle,
	CostNotationStyle,
	GitDisplayStyle,
	ProjectDisplayStyle,
	SegmentFormat,
	SegmentId,
	TokenDisplayStyle,
	UsageDisplayStyle,
	UsageWindow,
} from "../config/types.js";
import { USAGE_WINDOWS } from "../config/types.js";
import type {
	CostUsageSnapshot,
	ProviderUsageSnapshot,
	RepositorySnapshot,
	ThroughputSnapshot,
	UsageWindowSnapshot,
} from "../state/types.js";
import {
	compactPath,
	formatCost,
	formatCount,
	formatPercent,
	sanitizeSegmentText,
	shortenHome,
} from "./format.js";
import { SEGMENT_CONFIG_FIELDS } from "./metadata.js";
import type {
	FooterSegment,
	SegmentContent,
	SegmentContentPart,
	SegmentResolveContext,
	SemanticState,
} from "./types.js";

const builtin = (
	id: SegmentId,
	resolve: (context: SegmentResolveContext) => SegmentContent | undefined,
): FooterSegment => ({
	id,
	configFields: SEGMENT_CONFIG_FIELDS[id],
	resolve,
});

const DEFAULT_LABELS: Record<SegmentId, string> = {
	identity: "Identity",
	provider: "Provider",
	model: "Model",
	thinking: "Thinking",
	cwd: "Project",
	git: "Git",
	context: "Context",
	tokens: "Tokens",
	cache: "Cache",
	cost: "Cost",
	tools: "Tool",
	provider_usage: "Usage",
	extensions: "Extensions",
};

export const BUILTIN_SEGMENTS: readonly FooterSegment[] = [
	builtin("identity", ({ snapshot, format, label, config }) =>
		identityContent(snapshot.session, format, label, config),
	),
	builtin("provider", ({ snapshot, format, label }) => {
		const provider = snapshot.session.provider;
		return provider
			? displayContent(
					label ?? DEFAULT_LABELS.provider,
					sanitizeSegmentText(provider),
					format,
					"accent",
				)
			: undefined;
	}),
	builtin("model", ({ snapshot, format, label }) => {
		const model = snapshot.session.model;
		return model
			? displayContent(label ?? DEFAULT_LABELS.model, sanitizeSegmentText(model), format, "text")
			: undefined;
	}),
	builtin("thinking", ({ snapshot, format, label }) => {
		const level = snapshot.session.thinkingLevel;
		return level
			? displayContent(label ?? DEFAULT_LABELS.thinking, sanitizeSegmentText(level), format, "info")
			: undefined;
	}),
	builtin("cwd", ({ snapshot, format, label, display }) => {
		if (!snapshot.session.cwd) return undefined;
		const style = display as ProjectDisplayStyle | undefined;
		// The compact fallback must preserve the project name even when the
		// configured display is a longer path form; otherwise responsive
		// fitting cannot shrink a long path without dropping the whole Segment.
		// `tilde` is the default: `~/dev/project` stays readable while full
		// paths such as `/Users/jin/dev/project` waste a whole row. The
		// removed `path` value keeps working as an alias of `tilde`.
		const text =
			format === "compact"
				? compactPath(snapshot.session.cwd, false)
				: style === "name"
					? compactPath(snapshot.session.cwd, false)
					: style === "full"
						? compactPath(snapshot.session.cwd, true)
						: shortenHome(snapshot.session.cwd, snapshot.session.home);
		return displayContent(label ?? DEFAULT_LABELS.cwd, text, format, "muted");
	}),
	builtin("git", ({ snapshot, format, label, display }) =>
		gitContent(snapshot.repository, format, label, display as GitDisplayStyle | undefined),
	),
	builtin("context", ({ snapshot, format, label, contextThresholds, display }) =>
		contextContent(
			snapshot.conversation.context,
			format,
			label,
			contextThresholds,
			display as ContextDisplayStyle | undefined,
		),
	),
	builtin("tokens", ({ snapshot, format, label, display }) =>
		withThroughput(
			tokensContent(
				snapshot.conversation.tokens,
				format,
				label,
				display as TokenDisplayStyle | undefined,
			),
			snapshot.conversation.throughput,
		),
	),
	builtin("cache", ({ snapshot, format, label, display }) =>
		cacheContent(
			snapshot.conversation.cache,
			format,
			label,
			display as CacheDisplayStyle | undefined,
		),
	),
	builtin("cost", ({ snapshot, format, label, display, notation }) =>
		costContent(
			snapshot.conversation.cost,
			format,
			label,
			display as CostDisplayStyle | undefined,
			notation as CostNotationStyle | undefined,
		),
	),
	builtin("tools", ({ snapshot, format, label }) => {
		if (!snapshot.tools.active || !snapshot.tools.current) return undefined;
		return displayContent(
			label ?? DEFAULT_LABELS.tools,
			sanitizeSegmentText(snapshot.tools.current),
			format,
			"info",
			"info",
		);
	}),
	builtin(
		"provider_usage",
		({
			snapshot,
			format,
			label,
			display,
			usageWindows,
			showUsageResets,
			providerUsageThresholds,
		}) =>
			providerUsageContent(
				snapshot.providerUsage,
				format,
				label,
				display as UsageDisplayStyle | undefined,
				usageWindows,
				showUsageResets,
				providerUsageThresholds,
				snapshot.updatedAt,
			),
	),
	builtin("extensions", ({ snapshot, format, label }) => {
		if (snapshot.extensions.statuses.length === 0) return undefined;
		const parts: SegmentContentPart[] = [];
		if (format !== "compact") {
			parts.push({ text: `${label ?? DEFAULT_LABELS.extensions}: `, role: "dim" });
		}
		for (const [index, status] of snapshot.extensions.statuses.entries()) {
			if (index > 0) parts.push({ text: " · ", role: "dim" });
			parts.push({
				text: `${sanitizeSegmentText(status.key)}: ${sanitizeSegmentText(status.text)}`,
				state: status.state ?? "normal",
			});
		}
		return {
			text: parts.map((part) => part.text).join(""),
			parts,
			state: snapshot.extensions.statuses.some((status) => status.state === "error")
				? "error"
				: snapshot.extensions.statuses.some((status) => status.state === "warning")
					? "warning"
					: "normal",
		};
	}),
];

function identityContent(
	session: {
		provider?: string;
		model?: string;
		thinkingLevel?: string;
	},
	format: SegmentFormat,
	label: string | undefined,
	config: SegmentResolveContext["config"],
): SegmentContent | undefined {
	const provider = config.segments.provider.enabled ? session.provider : undefined;
	const model = config.segments.model.enabled ? session.model : undefined;
	const thinking = config.segments.thinking.enabled ? session.thinkingLevel : undefined;
	if (!provider && !model && !thinking) return undefined;

	const parts: SegmentContentPart[] = [];
	if (label && format !== "compact") parts.push({ text: `${label}: `, role: "dim" });
	if (format !== "compact" && provider && model) {
		parts.push({ text: sanitizeSegmentText(provider), role: "accent" });
		parts.push({ text: ": ", role: "dim" });
	}
	if (model) parts.push({ text: sanitizeSegmentText(model), role: "text" });
	else if (provider) parts.push({ text: sanitizeSegmentText(provider), role: "accent" });
	if (thinking && thinking !== "off" && (provider || model)) {
		parts.push({ text: " (", role: "dim" });
		parts.push({ text: sanitizeSegmentText(thinking), role: "info" });
		parts.push({ text: ")", role: "dim" });
	} else if (thinking && thinking !== "off") {
		parts.push({ text: sanitizeSegmentText(thinking), role: "info" });
	}
	return { text: parts.map((part) => part.text).join(""), parts };
}

function displayContent(
	label: string,
	value: string,
	format: SegmentFormat,
	role: SegmentContentPart["role"],
	state?: SemanticState,
): SegmentContent {
	const parts: SegmentContentPart[] = [];
	if (format !== "compact") parts.push({ text: `${label}: `, role: "dim" });
	parts.push({ text: value, role, state });
	return { text: parts.map((part) => part.text).join(""), parts, state };
}

type CostBreakdown = Required<
	Pick<CostUsageSnapshot, "input" | "output" | "cacheRead" | "cacheWrite">
>;

type CostBreakdownKey = keyof CostBreakdown;

function costContent(
	cost: CostUsageSnapshot | undefined,
	format: SegmentFormat,
	label: string | undefined,
	display: CostDisplayStyle | undefined,
	notation: CostNotationStyle | undefined,
): SegmentContent | undefined {
	if (!cost || cost.total === undefined) return undefined;
	const labelText = label ?? DEFAULT_LABELS.cost;
	const totalText = formatCost(cost.total, cost.currency ?? "$");
	const style =
		display ?? (format === "brief" ? "compact" : format === "detailed" ? "full" : "standard");
	if (style === "compact" || format === "compact") {
		return displayContent(labelText, totalText, format, "info", "info");
	}

	const breakdown = completeCostBreakdown(cost);
	if (!breakdown) return displayContent(labelText, totalText, format, "info", "info");

	const notationStyle = notation ?? (format === "detailed" ? "full" : "short");
	const parts: SegmentContentPart[] = [];
	parts.push({ text: `${labelText}: `, role: "dim" });
	parts.push({ text: totalText, role: "info" });
	parts.push({ text: " · ", role: "dim" });

	if (style === "standard") {
		parts.push({
			text: formatCostPart(
				costLabel("cache", notationStyle),
				breakdown.cacheRead + breakdown.cacheWrite,
				cost.currency ?? "$",
				notationStyle,
			),
			role: "success",
		});
		parts.push({ text: " · ", role: "dim" });
		parts.push({
			text: formatCostPart(
				costLabel("noCache", notationStyle),
				breakdown.input + breakdown.output,
				cost.currency ?? "$",
				notationStyle,
			),
			role: "text",
		});
	} else {
		const componentRoles: Record<CostBreakdownKey, SegmentContentPart["role"]> = {
			input: "info",
			output: "accent",
			cacheRead: "success",
			cacheWrite: "warning",
		};
		const components: CostBreakdownKey[] = ["input", "output", "cacheRead", "cacheWrite"];
		for (const [index, component] of components.entries()) {
			if (index > 0) parts.push({ text: " · ", role: "dim" });
			parts.push({
				text: formatCostPart(
					costLabel(component, notationStyle),
					breakdown[component],
					cost.currency ?? "$",
					notationStyle,
				),
				role: componentRoles[component],
			});
		}
	}
	return { text: parts.map((part) => part.text).join(""), parts, state: "info" };
}

function completeCostBreakdown(cost: CostUsageSnapshot): CostBreakdown | undefined {
	const input = cost.input;
	const output = cost.output;
	const cacheRead = cost.cacheRead;
	const cacheWrite = cost.cacheWrite;
	if (
		input === undefined ||
		output === undefined ||
		cacheRead === undefined ||
		cacheWrite === undefined
	)
		return undefined;
	return { input, output, cacheRead, cacheWrite };
}

function formatCostPart(
	label: string,
	value: number,
	currency: string,
	notation: CostNotationStyle,
): string {
	const formatted = formatCost(value, currency);
	return notation === "arrows" ? `${label}${formatted}` : `${label} ${formatted}`;
}

function costLabel(
	component: "cache" | "noCache" | CostBreakdownKey,
	notation: CostNotationStyle,
): string {
	if (notation === "full") {
		return {
			cache: "Cached",
			noCache: "No Cache",
			input: "Input",
			output: "Output",
			cacheRead: "Cache In",
			cacheWrite: "Cache Write",
		}[component];
	}
	if (notation === "arrows") {
		return {
			cache: "↔",
			noCache: "—",
			input: "↓",
			output: "↑",
			cacheRead: "←",
			cacheWrite: "→",
		}[component];
	}
	return {
		cache: "cache",
		noCache: "no-cache",
		input: "in",
		output: "out",
		cacheRead: "read",
		cacheWrite: "write",
	}[component];
}

function gitContent(
	repository: RepositorySnapshot,
	format: SegmentFormat,
	label: string | undefined,
	display?: GitDisplayStyle,
): SegmentContent | undefined {
	if (!repository.isRepository) {
		if (repository.state !== "fresh") return undefined;
		const value =
			format === "compact" || format === "brief" ? "no Git repo" : "not a Git repository";
		return displayContent(label ?? DEFAULT_LABELS.git, value, format, "muted", "muted");
	}
	const state: SemanticState =
		repository.conflicts && repository.conflicts > 0
			? "error"
			: repository.dirty
				? "warning"
				: "success";
	if (display === "branch") {
		return displayContent(
			label ?? DEFAULT_LABELS.git,
			sanitizeSegmentText(repository.branch ?? "repository"),
			format,
			"success",
			"success",
		);
	}
	if (display === "full") return fullGitContent(repository, format, label, state);

	const values: string[] = [];
	if (repository.branch) values.push(sanitizeSegmentText(repository.branch));
	if (repository.dirty)
		values.push(format === "detailed" ? `dirty (${repository.changedFiles ?? 0})` : "dirty");
	if (format === "detailed") {
		if (repository.ahead && repository.ahead > 0) values.push(`ahead ${repository.ahead}`);
		if (repository.behind && repository.behind > 0) values.push(`behind ${repository.behind}`);
		if (repository.conflicts && repository.conflicts > 0)
			values.push(`conflicts ${repository.conflicts}`);
	}
	if (values.length === 0) values.push("repository");
	return displayContent(label ?? DEFAULT_LABELS.git, values.join(" · "), format, state, state);
}

function fullGitContent(
	repository: RepositorySnapshot,
	format: SegmentFormat,
	label: string | undefined,
	state: SemanticState,
): SegmentContent {
	const parts: SegmentContentPart[] = [];
	if (format !== "compact") parts.push({ text: `${label ?? DEFAULT_LABELS.git}: `, role: "dim" });
	const addSeparator = () => {
		if (parts.length > (format === "compact" ? 0 : 1)) parts.push({ text: " · ", role: "dim" });
	};
	const branch = repository.branch ? sanitizeSegmentText(repository.branch) : undefined;
	if (branch) parts.push({ text: branch, role: state === "success" ? "success" : "text" });

	// Tracking hangs directly off the branch: `main ↑2↓3`.
	const ahead = repository.ahead && repository.ahead > 0 ? `↑${repository.ahead}` : "";
	const behind = repository.behind && repository.behind > 0 ? `↓${repository.behind}` : "";
	if (ahead || behind) parts.push({ text: ` ${ahead}${behind}`, role: "info" });

	const fileCounts: Array<[number | undefined, string, SegmentContentPart["role"]]> = [
		[repository.addedFiles, "+", "success"],
		[repository.deletedFiles, "-", "error"],
		[repository.modifiedFiles, "~", "warning"],
		[repository.untrackedFiles, "?", "muted"],
	];
	const visibleFileCounts = fileCounts.filter(([count]) => (count ?? 0) > 0);

	if (repository.dirty) {
		addSeparator();
		if (repository.additions !== undefined || repository.deletions !== undefined) {
			const additions = repository.additions ?? 0;
			const deletions = repository.deletions ?? 0;
			parts.push({ text: "diff ", role: "dim" });
			parts.push({ text: `-${deletions}`, role: "error" });
			parts.push({ text: `+${additions}`, role: "success" });
			parts.push({ text: ` (${additions + deletions})`, role: "muted", state });
		} else if (visibleFileCounts.length === 0) {
			// No line stats and no per-file counts: the least we can say is "diff".
			parts.push({ text: "diff", role: "warning", state });
		}
	}

	if (visibleFileCounts.length > 0) {
		addSeparator();
		parts.push({ text: "files ", role: "dim" });
		for (const [index, [count, symbol, role]] of visibleFileCounts.entries()) {
			parts.push({
				text: `${symbol}${count}${index === visibleFileCounts.length - 1 ? "" : " "}`,
				role,
			});
		}
	}

	if (repository.conflicts && repository.conflicts > 0) {
		addSeparator();
		parts.push({ text: `conflicts ${repository.conflicts}`, role: "error", state: "error" });
	}
	if (parts.length === (format === "compact" ? 0 : 1)) {
		parts.push({ text: "repository", role: "muted", state });
	}
	return { text: parts.map((part) => part.text).join(""), parts, state };
}

function contextContent(
	context:
		| {
				usedTokens?: number;
				limitTokens?: number;
				usedPercent?: number;
		  }
		| undefined,
	format: SegmentFormat,
	label: string | undefined,
	thresholds: { warning: number; error: number } | undefined,
	display?: ContextDisplayStyle,
): SegmentContent | undefined {
	if (!context) return undefined;
	const state = contextState(context.usedPercent, thresholds);
	const valueParts = styledContextParts(context, display ?? "full", thresholds);
	if (valueParts.length === 0) return undefined;
	const parts: SegmentContentPart[] = [];
	if (format !== "compact")
		parts.push({ text: `${label ?? DEFAULT_LABELS.context}: `, role: "dim" });
	parts.push(...valueParts);
	return { text: parts.map((part) => part.text).join(""), parts, state };
}

/** Context display presets; the percent is always one decimal. */
function styledContextParts(
	context: {
		usedTokens?: number;
		limitTokens?: number;
		usedPercent?: number;
	},
	display: ContextDisplayStyle,
	thresholds: { warning: number; error: number } | undefined,
): SegmentContentPart[] {
	const used = context.usedTokens === undefined ? undefined : formatCount(context.usedTokens);
	const limit = context.limitTokens === undefined ? undefined : formatCount(context.limitTokens);
	const percent =
		context.usedPercent === undefined ? undefined : formatPercent(context.usedPercent, 1);
	const state = contextState(context.usedPercent, thresholds);
	const textFor = (value: string): SegmentContentPart => ({
		text: value,
		role: contextRole(context.usedPercent, thresholds),
		state,
	});
	if (display === "compact") return percent ? [textFor(percent)] : [];
	if (display === "hybrid") {
		if (!limit) return percent ? [textFor(percent)] : [];
		return percent ? [textFor(`${limit} × ${percent}`)] : [textFor(limit)];
	}
	if (!used || !limit) {
		if (limit && percent) return [textFor(`${limit} × ${percent}`)];
		if (used && percent) return [textFor(`${used} (${percent})`)];
		return percent ? [textFor(percent)] : used ? [textFor(used)] : limit ? [textFor(limit)] : [];
	}
	return [textFor(percent ? `${used}/${limit} (${percent})` : `${used}/${limit}`)];
}

function withThroughput(
	content: SegmentContent | undefined,
	throughput: ThroughputSnapshot | undefined,
): SegmentContent | undefined {
	if (!content || !throughput) return content;
	const parts: SegmentContentPart[] = [
		...(content.parts ?? [{ text: content.text }]),
		{ text: " · ", role: "dim" },
		{ text: `${throughput.tokensPerSecond.toFixed(1)} tok/s`, role: "accent" },
	];
	return { ...content, text: parts.map((part) => part.text).join(""), parts };
}

function tokensContent(
	tokens: { input?: number; output?: number } | undefined,
	format: SegmentFormat,
	label: string | undefined,
	display?: TokenDisplayStyle,
): SegmentContent | undefined {
	// Keep the enabled Token Segment visible before the first assistant response.
	// The snapshot still correctly omits usage data; this is only a presentation
	// fallback so the configured Token/Cache row does not disappear.
	const unavailable = tokens === undefined;
	const values = tokens ?? { input: 0, output: 0 };
	const inputRole: SegmentContentPart["role"] = unavailable ? "muted" : "info";
	const outputRole: SegmentContentPart["role"] = unavailable ? "muted" : "accent";
	// Cache reads/writes have their own Segment, so the Token total is the
	// model I/O sum rather than the provider's aggregate total field.
	const total = (values.input ?? 0) + (values.output ?? 0);
	const parts: SegmentContentPart[] = [];
	switch (display) {
		case "compact":
			return displayContent(
				label ?? DEFAULT_LABELS.tokens,
				formatCount(total),
				format,
				unavailable ? "muted" : "info",
				unavailable ? "muted" : "info",
			);
		case "standard":
			parts.push({
				text: `\u2193${formatCount(values.input)} \u2191${formatCount(values.output)}`,
				role: unavailable ? "muted" : "text",
			});
			if (format !== "compact")
				parts.unshift({ text: `${label ?? DEFAULT_LABELS.tokens}: `, role: "dim" });
			return { text: parts.map((part) => part.text).join(""), parts };
		default:
			break;
	}
	if (format !== "compact")
		parts.push({ text: `${label ?? DEFAULT_LABELS.tokens}: `, role: "dim" });
	if (format === "detailed" || format === "labeled") {
		if (values.input !== undefined)
			parts.push({ text: `input ↓ ${formatCount(values.input)}`, role: inputRole });
		if (values.input !== undefined && values.output !== undefined)
			parts.push({ text: " · ", role: "dim" });
		if (values.output !== undefined)
			parts.push({ text: `output ↑ ${formatCount(values.output)}`, role: outputRole });
	} else {
		if (values.input !== undefined)
			parts.push({ text: `↓${formatCount(values.input)}`, role: inputRole });
		if (values.input !== undefined && values.output !== undefined)
			parts.push({ text: " ", role: "dim" });
		if (values.output !== undefined)
			parts.push({ text: `↑${formatCount(values.output)}`, role: outputRole });
	}
	if (parts.length === 0) return undefined;
	return { text: parts.map((part) => part.text).join(""), parts };
}

function cacheContent(
	cache:
		| {
				read?: number;
				write?: number;
				hitPercent?: number;
				state: "hit" | "miss" | "unavailable" | "error";
		  }
		| undefined,
	format: SegmentFormat,
	label: string | undefined,
	display?: CacheDisplayStyle,
): SegmentContent | undefined {
	const unavailable = !cache || cache.state === "unavailable";
	if (unavailable) {
		const emptyText =
			display === "compact" || display === "ratio"
				? "0"
				: format === "detailed" || format === "labeled"
					? "read 0 · write 0"
					: "0r 0w";
		return displayContent(label ?? DEFAULT_LABELS.cache, emptyText, format, "muted", "muted");
	}
	if (cache && cache.state !== "unavailable") {
		if (display === "compact") {
			// Most concise: just the hit ratio. Useful when cache detail is incidental.
			const text = cache.hitPercent !== undefined ? formatPercent(cache.hitPercent) : "no hit";
			return displayContent(
				label ?? DEFAULT_LABELS.cache,
				text,
				format,
				cache.state === "hit" ? "success" : "muted",
				cache.state === "error" ? "error" : cache.state === "hit" ? "success" : "warning",
			);
		}
		if (display === "ratio") {
			// Counters + hit ratio, no label words.
			const values: string[] = [];
			if (cache.read !== undefined) values.push(formatCount(cache.read));
			if (cache.write !== undefined) values.push(formatCount(cache.write));
			if (cache.hitPercent !== undefined) values.push(formatPercent(cache.hitPercent));
			if (values.length === 0) return undefined;
			const cparts: SegmentContentPart[] = [];
			if (format !== "compact")
				cparts.push({ text: `${label ?? DEFAULT_LABELS.cache}: `, role: "dim" });
			cparts.push({ text: values.join(" "), role: "text" });
			return { text: cparts.map((part) => part.text).join(""), parts: cparts };
		}
	}
	if (!cache || cache.state === "unavailable") return undefined;
	const parts: SegmentContentPart[] = [];
	if (format !== "compact") parts.push({ text: `${label ?? DEFAULT_LABELS.cache}: `, role: "dim" });
	if (format === "detailed" || format === "labeled") {
		if (cache.read !== undefined)
			parts.push({ text: `read ${formatCount(cache.read)}`, role: "accent" });
		if (cache.read !== undefined && cache.write !== undefined)
			parts.push({ text: " · ", role: "dim" });
		if (cache.write !== undefined)
			parts.push({ text: `write ${formatCount(cache.write)}`, role: "muted" });
		if (cache.hitPercent !== undefined)
			parts.push({ text: ` · hit ${formatPercent(cache.hitPercent)}`, role: "success" });
	} else {
		const values = [`${formatCount(cache.read)}r`, `${formatCount(cache.write)}w`];
		if (cache.hitPercent !== undefined) values.push(`${formatPercent(cache.hitPercent)} hit`);
		parts.push({
			text: values.join(" "),
			role: cache.state === "hit" ? "success" : "muted",
		});
	}
	const state: SemanticState =
		cache.state === "hit" ? "success" : cache.state === "error" ? "error" : "warning";
	return { text: parts.map((part) => part.text).join(""), parts, state };
}

function providerUsageContent(
	usage: ProviderUsageSnapshot | undefined,
	format: SegmentFormat,
	label: string | undefined,
	display?: UsageDisplayStyle,
	selectedWindows: readonly UsageWindow[] = USAGE_WINDOWS,
	showResets = false,
	thresholds: { warning: number; error: number } | undefined = undefined,
	referenceNow: number = 0,
): SegmentContent | undefined {
	if (!usage || usage.state === "unavailable") return undefined;
	const selected = selectedWindows.length > 0 ? selectedWindows : USAGE_WINDOWS;
	const windows = usage.windows.filter((window) => {
		const normalized = normalizeUsageWindow(window);
		// OpenCode's rolling window is the provider equivalent of the shared
		// 5h window, so the user-facing selection remains provider-neutral.
		return selected.includes(normalized === "rolling" ? "5h" : normalized);
	});
	const style = display ?? "standard";
	const visible =
		usage.state === "loading" && windows.length === 0
			? selected.map((id): UsageWindowSnapshot => ({ id, label: id, state: "unknown" }))
			: windows;
	if (visible.length === 0) return undefined;

	const stateForWindow = (window: ProviderUsageSnapshot["windows"][number]): SemanticState =>
		usage.state === "error"
			? "error"
			: usage.state === "stale"
				? "warning"
				: usage.state === "loading"
					? "muted"
					: usageWindowState(window, thresholds);

	const entryText = (
		window: ProviderUsageSnapshot["windows"][number],
		showLabel: boolean,
		resetMode: "hidden" | "short" | "verbose",
	): string => {
		const percent = usage.state === "loading" ? "—" : formatPercent(window.usedPercent, 0);
		const labelPart = showLabel ? usageWindowLabel(window) : undefined;
		const resetPart =
			resetMode !== "hidden" && window.resetAt !== undefined
				? `${resetMode === "verbose" ? "resets in" : "reset"} ${formatResetDuration(
						window.resetAt - referenceNow,
						resetMode === "verbose",
					)}`
				: undefined;
		const inner = [labelPart, resetPart]
			.filter((value): value is string => value !== undefined)
			.join(resetMode === "verbose" ? " " : ", ");
		return inner.length > 0 ? `${percent} (${inner})` : percent;
	};

	const parts: SegmentContentPart[] = [];
	if (format !== "compact")
		parts.push({ text: `${label ?? DEFAULT_LABELS.provider_usage}: `, role: "dim" });

	if (style === "compact") {
		for (const [index, window] of visible.entries()) {
			if (index > 0) parts.push({ text: " · ", role: "dim" });
			const reset =
				showResets && window.resetAt !== undefined
					? ` (reset ${formatResetDuration(window.resetAt - referenceNow)})`
					: "";
			parts.push({
				text: `${usage.state === "loading" ? "—" : formatPercent(window.usedPercent, 0)}${reset}`,
				state: stateForWindow(window),
			});
		}
	} else {
		parts.push({ text: providerUsageLabel(usage.provider), role: "accent" });
		for (const [index, window] of visible.entries()) {
			if (index > 0) parts.push({ text: " · ", role: "dim" });
			const resetMode = showResets ? (style === "detailed" ? "verbose" : "short") : "hidden";
			const text = entryText(window, true, resetMode);
			parts.push({
				text: `${index === 0 ? " " : ""}${text}`,
				state: stateForWindow(window),
			});
		}
	}
	const state =
		usage.state === "error"
			? "error"
			: usage.state === "stale"
				? "warning"
				: usage.state === "loading"
					? "muted"
					: usageState(visible, thresholds);
	return { text: parts.map((part) => part.text).join(""), state, parts };
}

export function formatResetDuration(milliseconds: number, detailed = false): string {
	if (milliseconds <= 0) return "now";
	const minutes = Math.ceil(milliseconds / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	if (detailed) {
		if (hours < 24) return `${hours}hr${remainder > 0 ? `${remainder}m` : ""}`;
		const days = Math.floor(hours / 24);
		const dayRemainder = hours % 24;
		return dayRemainder > 0 ? `${days}d ${dayRemainder}h` : `${days}d`;
	}
	if (hours < 24) return `${Math.ceil(minutes / 60)}h`;
	return `${Math.ceil(hours / 24)}d`;
}

export function usageWindowLabel(
	window: ProviderUsageSnapshot["windows"][number],
	short = false,
): string {
	switch (normalizeUsageWindow(window)) {
		case "5h":
		case "rolling":
			return short ? "5h" : "5hr";
		case "week":
			return "7d";
		case "month":
			return "30d";
	}
}

function normalizeUsageWindow(
	window: ProviderUsageSnapshot["windows"][number],
): "5h" | "rolling" | "week" | "month" {
	switch (window.id) {
		case "5h":
		case "codex:primary":
		case "session":
			return "5h";
		case "week":
		case "weekly":
		case "codex:secondary":
			return "week";
		case "rolling":
			return "rolling";
		case "monthly":
		case "month":
			return "month";
		default:
			return "5h";
	}
}

export function providerUsageLabel(provider: string): string {
	if (provider === "openai-codex") return "Codex";
	if (provider === "opencode-go") return "OpenCode Go";
	if (provider === "volcengine-agent-plan") return "Ark";
	if (provider === "volcengine-coding-plan") return "Coding";
	return provider;
}

function usageWindowState(
	window: ProviderUsageSnapshot["windows"][number],
	thresholds: { warning: number; error: number } | undefined = undefined,
): SemanticState {
	if (window.state === "expired") return "error";
	if (window.state === "unknown") return "muted";
	if (window.state === "warning") return "warning";
	if (window.state === "error") return "error";
	if (window.usedPercent === undefined) return "muted";
	const warning = thresholds?.warning ?? 70;
	const error = thresholds?.error ?? 90;
	if (window.usedPercent >= error) return "error";
	if (window.usedPercent >= warning) return "warning";
	return "success";
}

function usageState(
	windows: ProviderUsageSnapshot["windows"],
	thresholds: { warning: number; error: number } | undefined,
): SegmentContent["state"] {
	const states = windows.map((window) => usageWindowState(window, thresholds));
	if (states.includes("error")) return "error";
	if (states.includes("warning")) return "warning";
	if (states.every((state) => state === "muted")) return "muted";
	return "success";
}

function contextRole(
	percent: number | undefined,
	thresholds: { warning: number; error: number } | undefined,
): SegmentContentPart["role"] {
	if (percent === undefined) return "muted";
	const warning = thresholds?.warning ?? 70;
	const error = thresholds?.error ?? 90;
	if (percent >= error) return "error";
	if (percent >= warning) return "warning";
	return "success";
}

function contextState(
	percent: number | undefined,
	thresholds: { warning: number; error: number } | undefined,
): SegmentContent["state"] {
	if (percent === undefined) return "muted";
	const warning = thresholds?.warning ?? 70;
	const error = thresholds?.error ?? 90;
	if (percent >= error) return "error";
	if (percent >= warning) return "warning";
	return "success";
}
