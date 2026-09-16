import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createWidgetPublisher, usagePayload, wantsWidgets } from "../src/host/widget.js";
import { createEmptySnapshot } from "../src/state/snapshot.js";
import { createFooterStore } from "../src/state/store.js";
import type { ProviderUsageSnapshot } from "../src/state/types.js";

const USAGE: ProviderUsageSnapshot = {
	provider: "opencode-go",
	state: "fresh",
	fetchedAt: 1_700_000_000_000,
	windows: [
		{ id: "5h", label: "5H", usedPercent: 6, resetAt: 1_700_000_100_000, state: "normal" },
		{ id: "week", label: "7D", usedPercent: 57, state: "warning" },
	],
};

interface Call {
	key: string;
	lines: string[] | undefined;
}

/** Only the parts of the context the publisher touches. */
function fakeContext(mode: string, hasUI: boolean) {
	const calls: Call[] = [];
	const ctx = {
		mode,
		hasUI,
		ui: {
			setWidget(key: string, lines: string[] | undefined) {
				calls.push({ key, lines });
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, calls };
}

function storeWithUsage() {
	const store = createFooterStore({ initialSnapshot: createEmptySnapshot() });
	store.update({ session: { providerLabel: "OpenCode Go" }, providerUsage: USAGE });
	return store;
}

describe("wantsWidgets", () => {
	it("is true only for a host that draws and is not a terminal", () => {
		expect(wantsWidgets(fakeContext("rpc", true).ctx)).toBe(true);
		// A terminal has the Footer API; the widget would duplicate it.
		expect(wantsWidgets(fakeContext("tui", true).ctx)).toBe(false);
		// Nothing is watching in print or json mode.
		expect(wantsWidgets(fakeContext("print", false).ctx)).toBe(false);
		expect(wantsWidgets(fakeContext("json", false).ctx)).toBe(false);
	});
});

describe("usagePayload", () => {
	it("carries the provider label so a host needs none of our vocabulary", () => {
		const payload = usagePayload(storeWithUsage().getSnapshot());
		expect(payload?.provider).toBe("opencode-go");
		expect(payload?.providerLabel).toBe("OpenCode Go");
		expect(payload?.windows.map((w) => w.label)).toEqual(["5H", "7D"]);
	});

	it("is undefined until a reading exists", () => {
		expect(usagePayload(createEmptySnapshot())).toBeUndefined();
	});
});

describe("createWidgetPublisher", () => {
	it("publishes the current snapshot and then every change", () => {
		const store = storeWithUsage();
		const { ctx, calls } = fakeContext("rpc", true);
		createWidgetPublisher(store).start(ctx);

		expect(calls).toHaveLength(1);
		expect(calls[0].key).toBe("pid-footer");
		expect(JSON.parse(calls[0].lines?.[0] ?? "{}").providerLabel).toBe("OpenCode Go");

		store.update({ providerUsage: { ...USAGE, state: "stale" } });
		expect(calls).toHaveLength(2);
		expect(JSON.parse(calls[1].lines?.[0] ?? "{}").state).toBe("stale");
	});

	it("sends nothing when the payload has not changed", () => {
		const store = storeWithUsage();
		const { ctx, calls } = fakeContext("rpc", true);
		createWidgetPublisher(store).start(ctx);
		// The store publishes on every token of a turn; only the payload decides whether to send.
		store.update({ session: { isStreaming: true } });
		store.update({ session: { isStreaming: false } });
		expect(calls).toHaveLength(1);
	});

	it("clears the widget on stop", () => {
		const store = storeWithUsage();
		const { ctx, calls } = fakeContext("rpc", true);
		const publisher = createWidgetPublisher(store);
		publisher.start(ctx);
		publisher.stop(ctx);
		expect(calls).toHaveLength(2);
		expect(calls[1]).toEqual({ key: "pid-footer", lines: undefined });

		// Stopping twice must not send a second clear, and the store no longer reaches it.
		store.update({ providerUsage: { ...USAGE, state: "error" } });
		publisher.stop(ctx);
		expect(calls).toHaveLength(2);
	});

	it("stays out of a terminal, where the Footer is the presentation", () => {
		const store = storeWithUsage();
		const { ctx, calls } = fakeContext("tui", true);
		createWidgetPublisher(store).start(ctx);
		store.update({ providerUsage: { ...USAGE, state: "stale" } });
		expect(calls).toEqual([]);
	});
});
