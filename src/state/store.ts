import { cloneSnapshot, createEmptySnapshot } from "./snapshot.js";
import type {
	ConversationSnapshot,
	ConversationSnapshotPatch,
	FooterSnapshot,
	FooterSnapshotPatch,
	SnapshotListener,
} from "./types.js";

export interface FooterStore {
	getSnapshot(): FooterSnapshot;
	update(patch: FooterSnapshotPatch): FooterSnapshot;
	subscribe(listener: SnapshotListener): () => void;
}

export interface FooterStoreOptions {
	initialSnapshot?: FooterSnapshot;
	now?: () => number;
}

export function createFooterStore(options: FooterStoreOptions = {}): FooterStore {
	let snapshot = cloneSnapshot(options.initialSnapshot ?? createEmptySnapshot());
	const now = options.now ?? Date.now;
	const listeners = new Set<SnapshotListener>();

	return {
		getSnapshot() {
			return cloneSnapshot(snapshot);
		},

		update(patch) {
			const nextData = applyPatch(snapshot, patch);
			if (sameSnapshotData(snapshot, nextData)) return cloneSnapshot(snapshot);

			snapshot = {
				...nextData,
				version: snapshot.version + 1,
				updatedAt: now(),
			};
			const published = cloneSnapshot(snapshot);
			for (const listener of listeners) listener(cloneSnapshot(published));
			return published;
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function applyPatch(snapshot: FooterSnapshot, patch: FooterSnapshotPatch): FooterSnapshot {
	const next: FooterSnapshot = {
		...snapshot,
		session: patch.session ? { ...snapshot.session, ...patch.session } : snapshot.session,
		repository: patch.repository
			? { ...snapshot.repository, ...patch.repository }
			: snapshot.repository,
		conversation: Object.hasOwn(patch, "conversation")
			? patch.conversation
				? mergeConversation(snapshot.conversation, patch.conversation)
				: {}
			: snapshot.conversation,
		tools: patch.tools ? { ...snapshot.tools, ...patch.tools } : snapshot.tools,
		extensions: patch.extensions
			? {
					...snapshot.extensions,
					...patch.extensions,
					...(patch.extensions.statuses
						? { statuses: patch.extensions.statuses.map((status) => ({ ...status })) }
						: {}),
				}
			: snapshot.extensions,
		runtime: patch.runtime ? { ...snapshot.runtime, ...patch.runtime } : snapshot.runtime,
	};

	if (patch.tools?.recent) next.tools = { ...next.tools, recent: [...patch.tools.recent] };
	if (Object.hasOwn(patch, "providerUsage")) {
		next.providerUsage = patch.providerUsage
			? {
					...patch.providerUsage,
					windows: patch.providerUsage.windows.map((window) => ({ ...window })),
				}
			: undefined;
	}
	return next;
}

function mergeConversation(
	base: ConversationSnapshot,
	patch: ConversationSnapshotPatch,
): ConversationSnapshot {
	return {
		...base,
		...(Object.hasOwn(patch, "throughput") ? { throughput: patch.throughput } : {}),
		...(patch.context ? { context: { ...base.context, ...patch.context } } : {}),
		...(patch.tokens ? { tokens: { ...base.tokens, ...patch.tokens } } : {}),
		...(patch.cache ? { cache: { ...base.cache, ...patch.cache } } : {}),
		...(patch.cost ? { cost: { ...base.cost, ...patch.cost } } : {}),
	};
}

function sameSnapshotData(left: FooterSnapshot, right: FooterSnapshot): boolean {
	const { version: _leftVersion, updatedAt: _leftUpdatedAt, ...leftData } = left;
	const { version: _rightVersion, updatedAt: _rightUpdatedAt, ...rightData } = right;
	return JSON.stringify(leftData) === JSON.stringify(rightData);
}
