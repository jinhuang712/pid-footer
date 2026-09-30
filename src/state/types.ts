export type DataState = "fresh" | "stale" | "loading" | "unavailable";

export interface SessionSnapshot {
	provider?: string;
	providerLabel?: string;
	model?: string;
	thinkingLevel?: string;
	cwd: string;
	/** Home directory for `~` shortening; absent in old snapshots and tests. */
	home?: string;
	isStreaming: boolean;
	turnStartedAt?: number;
}

export interface RepositorySnapshot {
	isRepository: boolean;
	branch?: string;
	dirty?: boolean;
	staged?: boolean;
	ahead?: number;
	behind?: number;
	changedFiles?: number;
	additions?: number;
	deletions?: number;
	addedFiles?: number;
	deletedFiles?: number;
	modifiedFiles?: number;
	untrackedFiles?: number;
	conflicts?: number;
	state: DataState;
}

export interface ContextUsageSnapshot {
	usedTokens?: number;
	limitTokens?: number;
	usedPercent?: number;
}

export interface TokenUsageSnapshot {
	input?: number;
	output?: number;
	total?: number;
}

export interface CacheUsageSnapshot {
	read?: number;
	write?: number;
	hitPercent?: number;
	state: "hit" | "miss" | "unavailable" | "error";
}

export interface CostUsageSnapshot {
	/** Cost of input tokens not served from cache. */
	input?: number;
	/** Cost of generated output tokens. */
	output?: number;
	/** Cost of input tokens served from cache. */
	cacheRead?: number;
	/** Cost of writing input tokens into cache. */
	cacheWrite?: number;
	total?: number;
	currency?: string;
	billingMode?: string;
}

export interface ThroughputSnapshot {
	outputTokens: number;
	durationMs: number;
	tokensPerSecond: number;
	recordedAt: number;
}

export interface ConversationSnapshot {
	throughput?: ThroughputSnapshot;
	context?: ContextUsageSnapshot;
	tokens?: TokenUsageSnapshot;
	cache?: CacheUsageSnapshot;
	cost?: CostUsageSnapshot;
}

export interface ToolSnapshot {
	active: boolean;
	current?: string;
	recent: string[];
	count?: number;
}

export interface ExtensionStatusSnapshot {
	key: string;
	text: string;
	state?: "normal" | "info" | "warning" | "error";
}

export interface ExtensionSnapshot {
	statuses: ExtensionStatusSnapshot[];
}

export interface UsageWindowSnapshot {
	id: string;
	label: string;
	usedPercent?: number;
	resetAt?: number;
	state: "normal" | "warning" | "error" | "expired" | "unknown";
}

export interface ProviderUsageSnapshot {
	provider: string;
	state: "fresh" | "loading" | "stale" | "error" | "unavailable";
	fetchedAt?: number;
	errorCode?: string;
	windows: UsageWindowSnapshot[];
}

export interface RuntimeSnapshot {
	mode: "tui" | "rpc" | "print" | "json" | "unknown";
	sessionGeneration: number;
}

export interface FooterSnapshot {
	version: number;
	updatedAt: number;
	session: SessionSnapshot;
	repository: RepositorySnapshot;
	conversation: ConversationSnapshot;
	tools: ToolSnapshot;
	extensions: ExtensionSnapshot;
	providerUsage?: ProviderUsageSnapshot;
	runtime: RuntimeSnapshot;
}

export interface ConversationSnapshotPatch {
	throughput?: ThroughputSnapshot;
	context?: Partial<ContextUsageSnapshot>;
	tokens?: Partial<TokenUsageSnapshot>;
	cache?: Partial<CacheUsageSnapshot> & Pick<CacheUsageSnapshot, "state">;
	cost?: Partial<CostUsageSnapshot>;
}

export interface FooterSnapshotPatch {
	session?: Partial<SessionSnapshot>;
	repository?: Partial<RepositorySnapshot>;
	conversation?: ConversationSnapshotPatch;
	tools?: Partial<ToolSnapshot>;
	extensions?: Partial<ExtensionSnapshot>;
	providerUsage?: ProviderUsageSnapshot;
	runtime?: Partial<RuntimeSnapshot>;
}

export type SnapshotListener = (snapshot: FooterSnapshot) => void;
