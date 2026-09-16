import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FooterStore } from "../state/store.js";
import type { FooterSnapshot, ProviderUsageSnapshot } from "../state/types.js";

/**
 * The same footer data, for a host that is not a terminal.
 *
 * A graphical host cannot mount `setFooter`: that API hands back a pi-tui `Component`, which only a
 * terminal can draw. What such a host can read is `setWidget`, which carries lines in every Pi host.
 * So outside a terminal this publishes the snapshot the footer would have drawn, and this
 * extension's own desktop half — `src/ui.tsx` — draws it there.
 *
 * One pipeline, one set of numbers. What differs is who paints them.
 */

/** This extension's name. A widget key is an identity, so the host routes the lines back by it. */
export const WIDGET_USAGE_KEY = "pid-footer";

/**
 * Provider quota, ready to render: percentages already consumed, plus the moment each window rolls
 * over. `label` travels with each window so a host does not need this extension's vocabulary to
 * name them.
 */
export interface UsageWidgetPayload extends ProviderUsageSnapshot {
	providerLabel?: string;
}

/** A host that draws, but not in a terminal. In a terminal the footer itself is the presentation. */
export function wantsWidgets(ctx: ExtensionContext): boolean {
	return ctx.hasUI && ctx.mode !== "tui";
}

export function usagePayload(snapshot: FooterSnapshot): UsageWidgetPayload | undefined {
	const usage = snapshot.providerUsage;
	if (!usage) return undefined;
	const label = snapshot.session.providerLabel;
	return label === undefined ? { ...usage } : { ...usage, providerLabel: label };
}

export interface WidgetPublisher {
	/** Publishes the current snapshot and follows the store until `stop`. */
	start(ctx: ExtensionContext): void;
	stop(ctx: ExtensionContext): void;
}

export function createWidgetPublisher(store: FooterStore): WidgetPublisher {
	let unsubscribe: (() => void) | undefined;
	// The store publishes on every token during a turn; only a changed payload is worth a message.
	let published: string | undefined;

	const publish = (ctx: ExtensionContext): void => {
		const payload = usagePayload(store.getSnapshot());
		const encoded = payload ? JSON.stringify(payload) : undefined;
		if (encoded === published) return;
		published = encoded;
		ctx.ui.setWidget(WIDGET_USAGE_KEY, encoded === undefined ? undefined : [encoded]);
	};

	const stop = (ctx: ExtensionContext): void => {
		unsubscribe?.();
		unsubscribe = undefined;
		if (published === undefined) return;
		published = undefined;
		if (wantsWidgets(ctx)) ctx.ui.setWidget(WIDGET_USAGE_KEY, undefined);
	};

	return {
		start(ctx) {
			stop(ctx);
			if (!wantsWidgets(ctx)) return;
			publish(ctx);
			unsubscribe = store.subscribe(() => publish(ctx));
		},
		stop,
	};
}
