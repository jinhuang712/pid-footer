/**
 * The desktop half of this extension.
 *
 * The terminal half draws a footer with `setFooter`, which hands back a pi-tui component only a
 * terminal can mount. This runs in the window instead, reads the same snapshot, and draws one line
 * above the composer.
 *
 * Everything here is a host primitive. A utility class would not survive: the window's stylesheet
 * is built from the window's own sources, so a class no host file uses does not exist by the time
 * this loads. Composing the library is not a style preference, it is the only thing that works.
 */

import { Dot, Eyebrow, Inline, Line, Say } from "@pid/ui";
import type { UsageWidgetPayload } from "./host/widget.js";

type Tone = "ok" | "warn" | "danger" | "muted";

/** The publisher's own verdict outranks any percentage: a rate-limited window is never green. */
function tone(state: string, percent?: number): Tone {
  if (state === "error" || state === "expired") return "danger";
  if (state === "warning") return "warn";
  if (percent === undefined) return "muted";
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warn";
  return "ok";
}

const SAY: Record<Tone, "ok" | "warn" | "danger" | "faint"> = {
  ok: "ok",
  warn: "warn",
  danger: "danger",
  muted: "faint",
};

function resetIn(at: number | undefined, from: number): string | undefined {
  if (at === undefined) return undefined;
  const ms = at - from;
  if (ms <= 0) return "now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

interface Api {
  readonly id: string;
  strip: (spec: { render: (ctx: { state: unknown }) => unknown }) => void;
}

export default function register(pid: Api) {
  pid.strip({
    render: ({ state }) => {
      const usage = state as UsageWidgetPayload | undefined;
      if (!usage || usage.state === "unavailable") return null;
      const stale = usage.state === "stale";
      const from = usage.fetchedAt ?? Date.now();
      return (
        <Line gap="wide">
          <Inline>
            <Dot tone={stale ? "warn" : "accent"} />
            <Say tone="soft">{usage.providerLabel ?? usage.provider}</Say>
            {stale && <Say tone="faint">stale</Say>}
          </Inline>
          {usage.windows.length === 0 && usage.state === "loading" && <Say tone="faint">—</Say>}
          {usage.windows.map((w) => {
            const reset = resetIn(w.resetAt, from);
            return (
              <Inline key={w.id}>
                <Eyebrow>{w.label}</Eyebrow>
                <Say tone={SAY[tone(w.state, w.usedPercent)]} mono>
                  {w.usedPercent === undefined ? "—" : `${Math.round(w.usedPercent)}%`}
                </Say>
                {reset && (
                  <Say tone="faint" mono>
                    {reset}
                  </Say>
                )}
              </Inline>
            );
          })}
        </Line>
      );
    },
  });
}
