# Changelog

All notable changes to `pid-footer` are documented here.

## [Unreleased]

### Changed

- **Renamed to `pid-footer`, and the command with it: `/xfooter` is now `/footer`.** The
  configuration file follows — `pid-footer.json` — and the former `pi-x-footer.json` is still read
  when no new file sits beside it, so an existing setup keeps working untouched. Writes always use
  the new name and the old file is left where it is; it is the user's.

### Added

- **A graphical host gets the same numbers, drawn by this extension.** `setFooter()` takes a pi-tui
  component and only a terminal can mount one, so outside a terminal the extension publishes the
  Snapshot Store's snapshot, and its own desktop half (`src/ui.tsx`, declared as
  `"pid": { "ui": … }`) renders it there out of the host's primitives. One pipeline, one set of
  numbers, two renderers — the footer in the terminal, a tone-coloured quota line in the window.
  Nothing is guessed by the host: one that does not load the desktop half simply shows nothing.

## [0.1.0] - 2026-09-01

### Added

- Volcano Engine Agent Plan (`volcengine-agent-plan`) provider usage monitoring: the 5h / weekly / monthly subscription quota from the Ark console `subscription/agent-plan` page, queried through the official `arkcli` CLI (`usage plan --product agent-plan`) instead of an HTTP endpoint. Login failures, a missing CLI, or an inactive subscription degrade to muted states without surfacing raw CLI output.
- Volcano Engine Coding Plan (`volcengine-coding-plan`) provider usage monitoring through the same `arkcli` CLI transport (`usage plan --product coding-plan`), mapping its `session` rolling window to the shared 5h window.

### Changed

- The Git Segment now shows a muted `not a Git repository` status after a confirmed non-repository check instead of disappearing silently.
- Renamed the built-in `minimal` mode to `compact`; the old name remains accepted as a legacy alias.
- Compact, Balanced, and Detailed now share the same four-row content layout: Project/Provider, Git/Context, Usage/Cost, and Token/Cache; unavailable Provider Usage rows collapse without leaving gaps.
- Simplified the settings model around immutable built-in presets and an explicit `custom` mode.
- Rebuilt `/footer` around user-visible information blocks (`Appearance`, `Project`, `Git`, `Models & Providers`, `Usage`, `Context`, `Cache`, `Tokens`, `Cost`) instead of internal modules.
- Preset mode is now fully read-only except for `Mode` and `Footer`; use `Mode → Custom` to edit other categories.
- Reduced Segment configuration to visibility, labels, and a small set of content-specific options.
- Cost now keeps the full input/output/cache read/cache write breakdown and exposes independent `compact` / `standard` / `full` display presets.
- Cost notation is independently selectable as `arrows`, `short`, or `full` labels.
- Made formatting detail a single global `style.labelMode` setting.
- Replaced per-reference overrides with plain Segment IDs and moved responsive priority/requiredness to built-in defaults.
- Replaced the Layout settings list with a spatial two-column canvas: arrows traverse until `Enter` picks a Segment, then movement is previewed in bold/accented state; a second `Enter` confirms, while `n` inserts a row, `x` clears a row, and `l`/`r` set its side.

### Added

- Immediate persistence: each `Enter` confirms a value and writes it to disk; no Apply/Discard step.
- Native-style settings search keeps an always-focused input; `Esc` returns one level (and exits from the root), and ordinary letters remain searchable.
- Raised Cache's built-in priority above Tokens so cache status survives narrow terminals instead of being hidden first.
- Fixed Context display presets: `usage`, `used-percent`, `percent`, `percent-limit` replace the old percentage/limit/token/precision toggles; legacy fields keep working when no preset is set.
- Fixed Context precision choices (0/1/2 decimals); legacy higher values are clamped with a migration warning.
- Usage Display presets fully own window and reset display: `Compact`/`Standard` stay clean, `Timed`/`Focus` use relative countdowns, `Full` shows clock-aware reset times, and `Verbose` shows detailed relative countdowns.
- Removed the per-window `Visible/Hidden` toggles and the `Reset time` row from the Usage settings page; all provider windows are always shown.
- Rolling value chains: arrow-controlled rows render like `usage / used-percent / percent / percent-limit` with the current value first, and the cursor stays on the edited row across saves instead of resetting to the top.
- Curated display presets now cover every information block: Context (`compact/hybrid/full`), Tokens (`compact/standard/full`), Cache (`compact/ratio/read-write-hit`), Git (`branch/status/full`), Project (`name/path`), Cost (`compact/standard/full`), and Usage (`compact/standard/detailed`); Cost notation is independent, and Usage `detailed` renders reset countdowns.
- Legacy Usage refresh intervals snap to the nearest supported tier with a migration warning.
- Live, plain-text Footer preview on every settings screen with per-change status feedback.
- Added a native `/model`-style always-focused fuzzy search input across the root menu and all category pages.
- `←`/`→` changes and saves the selected candidate immediately, then restores the cursor to the edited row after re-render.
- `identity` Segment output such as `openai-codex: gpt-5.6-luna (xhigh)`.
- Extension lifecycle integration coverage for source cleanup and redraw coalescing.

### Fixed

- Global preference edits keep the active layout in Custom mode when made there; Provider Usage and all content categories are read-only outside Custom mode.
- Compact, Balanced, and Detailed now share the same responsive four-row layout; unavailable Provider Usage rows collapse so later rows move up without gaps.
- Preset serialization no longer writes preset-owned layout and Segment details.
- The `provider_usage` window cap default now matches every selectable window; legacy UI-only window limits were removed and window/reset display is now owned entirely by the Usage display presets (`usage.windows` and `usage.showResetTime` are ignored with a migration warning).
- Legacy per-reference layout entries remain loadable while their fine-grained overrides are ignored.
- Confirmed Layout edits now remove empty rows and duplicate Segment placements, and failed saves roll back without a retry.

### Initial release

Initial dogfood release of the Footer-only Pi extension.

- Configurable multi-row Footer with left/right alignment.
- Responsive fitting at narrow terminal widths.
- Semantic and monochrome presentation with optional icons and separators.
- Local Context, token, cache, cost, Git, tool, and extension status Segments.
- OpenAI Codex and OpenCode Go Provider Usage adapters with caching, stale state, timeout, cancellation, and official-origin checks.
- Atomic configuration persistence and optional project overrides.
- `/footer` settings, presets, refresh, status, and help commands.
