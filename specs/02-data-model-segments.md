# Data Model and Segment Specification

## 1. Design rule

All raw data is normalized before rendering. Segments never inspect provider-specific JSON, read files, or call network APIs.

## 2. Snapshot model

```ts
interface FooterSnapshot {
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
```

### Session

```ts
interface SessionSnapshot {
  provider?: string;
  providerLabel?: string;
  model?: string;
  thinkingLevel?: string;
  cwd: string;
  home?: string;
  isStreaming: boolean;
  turnStartedAt?: number;
}
```

### Repository

```ts
interface RepositorySnapshot {
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
  state: "fresh" | "stale" | "loading" | "unavailable";
}
```

v0.1 MAY only populate branch and dirty state. Additional Git details are optional data and SHOULD have lower priority. When available, `additions` and `deletions` come from the tracked working-tree diff against `HEAD`. A successful Git check outside a repository uses `isRepository: false` with `state: "fresh"`, allowing the Git Segment to show a muted `not a Git repository` status. Loading or unrelated Git failures remain hidden rather than being presented as a confirmed no-repository state.

### Conversation

```ts
interface ConversationSnapshot {
  context?: {
    usedTokens?: number;
    limitTokens?: number;
    usedPercent?: number;
  };
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  cache?: {
    read?: number;
    write?: number;
    hitPercent?: number;
    state: "hit" | "miss" | "unavailable";
  };
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
    currency?: string;
    billingMode?: string;
  };
}
```

### Tools

```ts
interface ToolSnapshot {
  active: boolean;
  current?: string;
  recent?: string[];
  count?: number;
}
```

Tool information SHOULD be hidden when the agent is idle unless explicitly configured otherwise.

### Extensions

```ts
interface ExtensionSnapshot {
  statuses: Array<{
    key: string;
    text: string;
    state?: "normal" | "info" | "warning" | "error";
  }>;
}
```

Unknown extension statuses are displayed conservatively. The renderer MUST NOT assume arbitrary status text is safe to parse as structured data.

## 3. Local usage versus provider usage

These are different concepts and MUST have different Segment IDs:

```text
context       current conversation context window
 tokens       current session input/output tokens
cache         current session cache reads/writes
cost          current session cost
provider_usage account/subscription quota windows
```

A provider quota value MUST NOT be silently presented as current-session cost or token usage.

## 4. Segment contract

```ts
interface SegmentConfigField {
  key: string;
  label: string;
  kind: "toggle" | "select" | "number" | "text";
  options?: readonly string[];
  description: string;
}

interface FooterSegment {
  id: string;
  defaultPriority: number;
  defaultRequired?: boolean;
  configFields: readonly SegmentConfigField[];
  resolve(context: SegmentResolveContext): SegmentContent | undefined;
}

interface ResolvedSegment {
  id: string;
  text: string;
  compactText?: string;
  state?: SemanticState;
  priority: number;
  required: boolean;
  parts?: SegmentContentPart[];
}
```

`configFields` is the authoritative metadata for validation help, settings UI, previews, and documentation. Adding a built-in Segment without declaring its supported configuration fields is invalid.

`resolve()` MUST be deterministic for a given Snapshot and configuration.

`priority` and `required` come from the built-in defaults table and are not user-configurable. Formatting detail comes from the global `style.labelMode` switch, not per-Segment `format` settings.

## 5. Built-in Segments

| ID | Content | Default visibility | Priority |
|---|---|---|---:|
| `identity` | Provider, model, and thinking level in a self-explanatory form | When available | 100 |
| `cwd` | Current directory/project label | Always when available | 85 |
| `git` | Branch, dirty state, or confirmed no-repository status | When Git status is fresh | 70 |
| `provider` | Provider label | When available | 80 |
| `model` | Model name | Required when available | 100 |
| `thinking` | Thinking level | When non-empty | 40 |
| `context` | Context used/limit/percent | Required when available | 100 |
| `tokens` | Input/output tokens | Always when enabled (zero before first usage) | 55 |
| `cache` | Cache read/write/hit state | Always when enabled (zero before first usage) | 45 |
| `cost` | Current session cost | Balanced/detailed | 65 |
| `tools` | Active tool | Streaming only by default | 60 |
| `provider_usage` | Account quota windows | Supported snapshot only | 85 |
| `extensions` | Extension statuses | Non-empty only | 20 |

## 6. Formatting rules

Supported format modes are declarative:

```text
brief     compact value-oriented output
compact   compact output with selected labels
labeled   human-readable labels and values
detailed  full labels, secondary values, and configured details
```

The legacy `default` format value is no longer accepted in Segment configuration; formatting is owned by `style.labelMode`. Presets resolve `automatic` to `brief`, `labeled`, or `detailed`.

- Empty values MUST produce no Segment rather than `undefined`, `N/A`, or a placeholder by default. The enabled `tokens` and `cache` Segments are the exception: before the first local usage record they MUST render muted zero values (`Tokens: ... 0` and `Cache: ... 0`) so the configured session-usage row remains visible.
- Token counts SHOULD use compact units such as `108k` and `2.1m`. The Tokens Compact total is the Input + Output sum; Cache read/write counters remain a separate Segment.
- Formatting detail is driven by the single global `style.labelMode` switch (`automatic`, `brief`, `labeled`, `detailed`). `automatic` follows the active preset: `compact` resolves to `brief`, `detailed` to `detailed`, and `balanced`/`custom` to `labeled`. The internal Segment `compact` format remains reserved for responsive fallbacks.
- Context display uses three presets: `compact` shows percentage only, `hybrid` shows `limit × percentage`, and `full` shows used/limit plus percentage. Missing source values MUST degrade to the available shorter form.
- Cost has four additive components: uncached input (`input`), output (`output`), cache reads (`cacheRead`), and cache writes (`cacheWrite`). `total` is their aggregate.
- Cost display has three density presets: `compact` shows Total Cost; `standard` shows Total Cost plus the aggregate `cacheRead + cacheWrite` and `input + output` groups; `full` shows Total Cost plus all four components.
- Cost notation is independent from density: `arrows`, `short`, or `full` labels. Short labels use `in`, `out`, `read`, and `write`; full labels use `Input`, `Output`, `Cache In`, and `Cache Write`.
- When component costs are unavailable, the Cost Segment MUST fall back to the available total rather than inventing zero-valued components.
- Costs SHOULD use a stable currency prefix and configurable precision.
- Labels and units are configurable through the Segment `label` field; output MUST not depend on unexplained hard-coded abbreviations.
- The `identity` Segment MAY collapse provider, model, and thinking into a self-explanatory value such as `openai-codex: gpt-5.6-luna (xhigh)`. A separate provider/model/thinking layout remains available.
- Model names MAY be shortened only when the configured formatter can preserve identity.
- Provider usage windows MUST retain their labels, such as `5h`, `wk`, `rolling`, or `monthly`. Configuration selects the provider-neutral windows `5h`, `week`, and `month`; adapters map provider aliases such as `rolling`, `weekly`, and `monthly` to those settings.
- Stale provider usage MUST be visually marked or rendered with a muted state.
- While Provider Usage is loading, the configured Usage Segment MUST remain visible with muted `—` placeholders for the selected windows instead of disappearing; reset countdowns are omitted until values arrive.

### Output throughput

`conversation.throughput` records the latest successful assistant reply as
`{ outputTokens, durationMs, tokensPerSecond, recordedAt }`. Duration uses a monotonic clock
from `message_start` to `message_end`, including reasoning but excluding tool execution.
`message_start` follows the provider stream-start event, so earlier request waiting may be excluded;
this measures a message-phase average rather than full-request or pure decoding throughput. The numerator is the provider's final `usage.output`, never estimated from text.
Missing/invalid usage, zero duration, aborted replies and errors do not replace the last valid record.

Each valid measurement is persisted at `turn_end` with `pi.appendEntry("pid-footer/throughput", data)`
outside model context, after Pi has saved the assistant reply so the record cannot leak into its parent branch. Session start and tree navigation restore only the current branch's latest valid
record; switching sessions without records clears it. Shutdown discards incomplete timing.
Old sessions without measurements do not invent historical rates.

The existing Tokens Segment appends `· 42.5 tok/s` in every display mode when available, using
an accent role. Disabling Tokens hides the rate in the terminal too. Responsive fitting remains
unchanged. The desktop quota payload includes an optional `throughput` field and may show the
rate without a supported quota provider. No new configuration field or dependency is needed.

## 7. Extension status integration

v0.1 supports rendering public extension statuses as a generic Segment. The implementation MUST avoid hard-coding the behavior of a particular extension where possible.

Provider usage adapters remain the authoritative structured source for Codex and OpenCode Go. A text-only extension status may be shown as an informational status, but it MUST NOT be parsed as structured quota data unless an explicit versioned contract is later defined.

## 8. Future compatibility

The registry SHOULD be designed so a future version can add custom Segment providers. v0.1 does not need to expose an arbitrary TypeScript plugin API or execute user-provided code from JSON.
