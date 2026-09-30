import { describe, expect, it, vi } from "vitest";
import { createThroughputDataSource, THROUGHPUT_ENTRY } from "../src/data/throughput.js";
import { createFooterStore } from "../src/state/store.js";

function setup() {
	const store = createFooterStore();
	const persist = vi.fn();
	let time = 0;
	const source = createThroughputDataSource(store, persist, {
		monotonic: () => time,
		wall: () => 1700000000000,
	});
	return {
		store,
		persist,
		source,
		advance: (ms: number) => {
			time += ms;
		},
	};
}

const record = {
	outputTokens: 100,
	durationMs: 2000,
	tokensPerSecond: 50,
	recordedAt: 1700000000000,
};
const entry = { type: "custom", customType: THROUGHPUT_ENTRY, data: record };

describe("output throughput", () => {
	it("records final provider output tokens over message duration, not tool time", () => {
		const { store, source, persist, advance } = setup();
		source.messageStart({ role: "user" });
		advance(1000);
		source.messageStart({ role: "assistant" });
		advance(2000);
		source.messageEnd({ role: "assistant", stopReason: "toolUse", usage: { output: 100 } });
		expect(store.getSnapshot().conversation.throughput).toEqual(record);
		expect(persist).toHaveBeenCalledWith(record);
		advance(10000);
		source.messageStart({ role: "toolResult" });
		source.messageEnd({ role: "toolResult" });
		source.messageStart({ role: "assistant" });
		advance(1000);
		source.messageEnd({ role: "assistant", stopReason: "stop", usage: { output: 75 } });
		expect(store.getSnapshot().conversation.throughput?.tokensPerSecond).toBe(75);
		expect(persist).toHaveBeenCalledTimes(2);
	});

	it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		"ignores invalid output %s",
		(output) => {
			const { source, persist, advance } = setup();
			source.messageStart({ role: "assistant" });
			advance(1000);
			source.messageEnd({ role: "assistant", usage: { output } });
			expect(persist).not.toHaveBeenCalled();
		},
	);

	it.each(["error", "aborted"])("preserves the last reading after %s", (stopReason) => {
		const { source, store, persist, advance } = setup();
		source.restore([entry]);
		source.messageStart({ role: "assistant" });
		advance(1000);
		source.messageEnd({ role: "assistant", stopReason, usage: { output: 100 } });
		expect(store.getSnapshot().conversation.throughput).toEqual(record);
		expect(persist).not.toHaveBeenCalled();
	});

	it("ignores missing starts, zero durations and duplicate ends; accepts zero output", () => {
		const { source, persist, advance } = setup();
		const message = { role: "assistant", usage: { output: 0 } };
		source.messageEnd(message);
		source.messageStart(message);
		source.messageEnd(message);
		expect(persist).not.toHaveBeenCalled();
		source.messageStart(message);
		advance(1000);
		source.messageEnd(message);
		source.messageEnd(message);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist.mock.calls[0]?.[0].tokensPerSecond).toBe(0);
	});

	it("restores only valid supplied branch records and clears on session/tree changes", () => {
		const { source, store, persist, advance } = setup();
		source.restore([entry, { ...entry, data: { ...record, durationMs: 0 } }]);
		expect(store.getSnapshot().conversation.throughput).toEqual(record);
		source.messageStart({ role: "assistant" });
		advance(1000);
		source.restore([]);
		source.messageEnd({ role: "assistant", usage: { output: 100 } });
		expect(store.getSnapshot().conversation.throughput).toBeUndefined();
		expect(persist).not.toHaveBeenCalled();
	});

	it("discards incomplete timing at shutdown", () => {
		const { source, persist, advance } = setup();
		source.messageStart({ role: "assistant" });
		advance(1000);
		source.shutdown();
		source.messageEnd({ role: "assistant", usage: { output: 100 } });
		expect(persist).not.toHaveBeenCalled();
	});
});
