import type { FooterStore } from "../state/store.js";
import type { ThroughputSnapshot } from "../state/types.js";

export const THROUGHPUT_ENTRY = "pid-footer/throughput";

interface MessageLike {
	role: string;
	stopReason?: string;
	usage?: { output?: number };
}

export function createThroughputDataSource(
	store: FooterStore,
	persist: (record: ThroughputSnapshot) => void,
	clock: { monotonic(): number; wall(): number } = {
		monotonic: () => performance.now(),
		wall: () => Date.now(),
	},
) {
	let startedAt: number | undefined;
	return {
		messageStart(message: MessageLike) {
			if (message.role === "assistant") startedAt = clock.monotonic();
		},
		messageEnd(message: MessageLike) {
			if (message.role !== "assistant") return;
			const start = startedAt;
			startedAt = undefined;
			if (start === undefined || message.stopReason === "error" || message.stopReason === "aborted")
				return;
			const durationMs = clock.monotonic() - start;
			const outputTokens = message.usage?.output;
			if (outputTokens === undefined) return;
			const record: ThroughputSnapshot = {
				outputTokens,
				durationMs,
				tokensPerSecond: (outputTokens * 1000) / durationMs,
				recordedAt: clock.wall(),
			};
			if (!isThroughputRecord(record)) return;
			persist(record);
			store.update({ conversation: { throughput: record } });
		},
		restore(entries: readonly unknown[]) {
			startedAt = undefined;
			let throughput: ThroughputSnapshot | undefined;
			for (const entry of entries) {
				if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== THROUGHPUT_ENTRY)
					continue;
				if (isThroughputRecord(entry.data)) throughput = entry.data;
			}
			store.update({ conversation: { throughput } });
		},
		shutdown() {
			startedAt = undefined;
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThroughputRecord(value: unknown): value is ThroughputSnapshot {
	if (!isRecord(value)) return false;
	return (
		["outputTokens", "durationMs", "tokensPerSecond", "recordedAt"].every(
			(key) => typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0,
		) && (value.durationMs as number) > 0
	);
}
