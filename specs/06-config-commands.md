# Configuration and Command Specification

> Note: this document describes the JSON configuration file format and precedence, which remain accurate. The `/footer` settings menu itself has been rebuilt around the information architecture and interaction model in [12-settings-ui-redesign.md](./12-settings-ui-redesign.md) (implemented in `src/commands.ts`); that document supersedes section 9 of this file ("Configuration menu model") and the "editable in any mode" classification in section 6a, since Provider Usage and every other content category are now read-only outside Custom mode.

## 1. Configuration locations

Global configuration:

```text
~/.pi/agent/pid-footer.json
```

Optional project configuration:

```text
<project-root>/.pi/pid-footer.json
```

Project configuration is ignored by default. It is read only when the global configuration contains:

```json
{
  "projectOverrides": {
    "enabled": true
  }
}
```

## 2. Precedence

```text
defaults
  ↓
global config
  ↓
project config, only when enabled
  ↓
explicit runtime command changes
```

Arrays such as `layout.rows` SHOULD be replaced as a whole at the overriding layer rather than merged by index. Objects SHOULD be merged by named key where safe.

## 3. Top-level schema

```json
{
  "version": 1,
  "enabled": true,
  "preset": "balanced",
  "projectOverrides": {
    "enabled": false
  },
  "layout": {
    "rows": []
  },
  "style": {
    "colorMode": "semantic",
    "icons": "off",
    "separator": "dot",
    "density": "compact",
    "labelMode": "automatic"
  },
  "segments": {},
  "thresholds": {
    "context": { "warning": 70, "error": 90 },
    "providerUsage": { "warning": 70, "error": 90 }
  },
  "responsive": {
    "strategy": "hide-compact-truncate"
  },
  "usage": {
    "enabled": true,
    "providers": ["openai-codex", "opencode-go"],
    "windows": ["5h", "week"],
    "refreshSeconds": 30,
    "showResetTime": true
  }
}
```

`usage.windows` selects the user-facing `5h`, `week`, and `month` windows. Provider-specific aliases such as `rolling` are migrated to `5h`. `usage.showResetTime` independently controls reset countdowns.

## 4. Default layout

```json
{
  "layout": {
    "rows": [
      {
        "id": "project",
        "left": ["cwd"],
        "right": ["identity"]
      },
      {
        "id": "git",
        "left": ["git"],
        "right": ["context"]
      },
      {
        "id": "usage",
        "left": ["provider_usage"],
        "right": ["cost"],
        "visible": "when-available"
      },
      {
        "id": "session",
        "left": ["tokens", "speed"],
        "right": ["cache"]
      },
      {
        "id": "extensions",
        "left": ["extensions"],
        "visible": "when-nonempty"
      }
    ]
  }
}
```

The default canvas pairs Project/Provider, Git/Context, Usage/Cost, and Token/Cache across four content rows; Extensions remain an optional hidden row.

## 5. Presets

### Default profile and built-in presets

A missing configuration starts in `custom` mode with the current default profile: full project path, full Git details, Full Context, Standard Tokens, compact Cache, detailed Provider Usage with reset countdowns, `5h` and `week` windows, and a 30-second refresh interval. Selecting `compact`, `balanced`, or `detailed` switches to the corresponding immutable built-in preset.

The built-in presets use two layout densities:

`compact` uses a two-row overview/session layout:

```text
project + git                                      identity + context
usage                                              tokens + cache + cost
```

`balanced` and `detailed` keep the stable four-row content layout:

```text
project                                                provider
git                                                    context
usage                                                     cost
token                                                   cache
```

They differ in presentation detail: `compact` uses brief values and short Segment displays, `balanced` uses labeled values, and `detailed` shows the most information. When no supported provider snapshot exists, the affected optional content collapses according to the normal empty-group rules without leaving a blank line.

Selecting a preset SHOULD replace the active layout and reset preset-owned Segment settings to defaults while preserving global preferences (style, thresholds, responsive, usage). Built-in presets are immutable: an explicit `layout` always switches the active mode to `custom`, even if a built-in `preset` is also present. `custom` requires an explicit layout and is intended for hand-edited configuration; it is not a fourth built-in layout. The default compact, balanced, and detailed identity row uses the collapsed `identity` Segment; replacing it with `provider`, `model`, and `thinking` selects the separate presentation.

## 6. Segment configuration

Segments expose a small, declarative configuration surface. The settings UI and JSON schema MUST use the same Segment metadata. Arbitrary format strings, JavaScript expressions, and user code are not allowed.

```json
{
  "segments": {
    "cwd": {
      "enabled": true,
      "label": "Project"
    },
    "context": {
      "enabled": true,
      "label": "Context",
      "display": "full"
    },
    "provider_usage": {
      "enabled": true,
      "label": "Usage",
      "display": "detailed"
    },
    "cost": {
      "enabled": true,
      "display": "standard",
      "notation": "short"
    }
  }
}
```

`speed` uses only `enabled` and `label`, displays the last valid output `tok/s`, and is independent
from `tokens`. Components exposes Speed (Show Speed / Label); Layout places it like any other
Segment. Old explicit layouts are preserved; without a Speed setting or placement it starts Off.
Enabling it through the menu adds it to the session row.

Common Segment fields are limited to:

```text
enabled
label
```

Plus the Segment-specific display preset: Project `name`, `tilde`, or `full`; Context `compact`, `hybrid`, or `full`; Cost `compact`, `standard`, or `full`. The legacy Project value `path` migrates to `tilde` with a warning. Cost also supports the independent `notation` values `arrows`, `short`, and `full`. Provider Usage window selection and reset visibility are configured under `usage`.

Per-Segment `format`, `priority`, `required`, `visibility`, `colorRole`, `emphasis`, and `minWidth` are intentionally NOT configurable:

- Formatting detail is owned by the single global `style.labelMode` switch.
- Responsive priority and requiredness come from the built-in defaults table.
- Semantic states and parts own coloring.

Row references are plain Segment IDs. Per-reference option objects are not accepted.

The `identity` Segment is a declarative composite of provider, model, and thinking fields; its representative output is `openai-codex: gpt-5.6-luna (xhigh)`. The shared Segment metadata registry is the source for field labels, descriptions, options, and representative previews; the settings menu MUST not duplicate per-Segment field branches. Every supported field MUST have a validation rule and a menu representation. Free-form labels and numeric values use validated text input; enum and toggle values use selectors.

## 6a. Preset-owned versus global settings

Settings split into two tiers:

**Preset-owned** (fixed while a built-in preset is active):

```text
layout.rows
segments.<id>.enabled / label / display options
style.labelMode
```

**Global preferences** (editable in any mode):

```text
enabled
style.colorMode / icons / separator / density
thresholds
responsive.strategy
usage.*
projectOverrides.enabled
```

Only edits to preset-owned settings switch the active mode to `custom`. Global preferences never change the mode.


## 7. `/footer` commands

Supported forms:

```text
/footer
/footer toggle
/footer compact
/footer balanced
/footer detailed
/footer refresh
/footer status
/footer help
```

### `/footer`

Opens a hierarchical interactive configuration menu when a TUI is available. Pressing Enter confirms, validates, and persists each selected value immediately; there is no second Save step.

The root menu SHOULD expose:

- A live representative Footer preview rendered from the current draft Snapshot and width, so users see the effect of changes without leaving the settings menu. The preview MUST be plain-text safe (no raw ANSI) and MUST update after every confirmed choice.
- Four tabs below a separator after the preview: `General` (`Footer`, `Mode`, and the project override gate), `Components` (`Project`, `Git`, `Models & Providers`, `Usage`, `Context`, `Cache`, `Tokens`, `Speed`, `Cost`), `Layout` (activating the tab opens the row canvas without a duplicate category row), and `Appearance` (`Detail level`, `Color`, `Icons`, and `Separator`).
- Mode: `compact`, `balanced`, `detailed`, or `custom`, with an example of the resulting shape.
- Preset-owned entries (Layout, Segments, Context, Label style) when the active mode is `custom`.
- Provider Usage windows.
- Responsive strategy and Context/Provider Usage thresholds.
- Automatic tab navigation with `Tab` / `Shift+Tab`; there is no separate Save action.

While a built-in preset is active, preset-owned entries are shown grayed out and locked with their current values. Select `custom` through `Mode` to edit them. Selecting a built-in mode loads its immutable layout and resets preset-owned settings.

### `/footer toggle`

Toggles the extension's `enabled` setting and persists it atomically.

### `/footer <preset>`

Applies and persists a built-in preset.

### `/footer refresh`

Requests an immediate refresh of provider usage and stale data sources. It MUST show a non-secret status or notification on failure.

### `/footer status`

Reports active preset, enabled state, provider usage state, and config paths without displaying credentials.

### `/footer help`

Prints concise usage information.

Commands MUST reject unknown arguments with a clear message and MUST not mutate configuration on invalid input.

## 8. Validation and persistence

The loader MUST:

- Validate the top-level object and version.
- Reject invalid row IDs and unknown Segment references with actionable warnings.
- Clamp or reject invalid refresh intervals.
- Normalize missing fields to defaults.
- Preserve valid settings when one optional setting is invalid.
- Remove empty rows and duplicate Segment placements when normalizing or persisting a custom layout.
- Fall back to defaults if the file is malformed.

Writes MUST use a private temporary file followed by an atomic rename. A failed write MUST leave the previous file intact.

## 9. Configuration menu model

The menu is intentionally hierarchical rather than a linear questionnaire, with two tiers:

```text
/footer
  ├─ Mode
  ├─ Enable Footer
  ├─ Layout          (preset-owned)
  ├─ Segments        (preset-owned)
  ├─ Context         (preset-owned)
  ├─ Provider Usage
  ├─ Responsive & thresholds
  ├─ Appearance
  └─ Project Overrides
```

**Preset mode** (`compact`, `balanced`, `detailed`): preset-owned entries are visible but grayed out/locked with their current values. Select `Custom` through `Mode` to edit them. Global preference entries remain active.

**Custom mode**: preset-owned entries are active and fully expanded. Switching from a preset seeds `custom` with that preset's layout and Segment settings.

The custom settings include:

- Every choice SHOULD include a representative output example rather than only an abstract enum label.
- Layout: inspect row order, switch Identity between collapsed `provider: model (thinking)` and separate fields, edit row visibility/overflow, move a Segment between configured Rows and left/right groups, or restore the balanced layout. Empty rows created while moving or clearing are temporary and are removed when the edit is confirmed.
- Segments: select any built-in Segment, then edit metadata-defined `enabled`, `label`, and Segment-specific display options. Cost also exposes its independent Notation selector.
- Provider Usage: enabled state, display detail, selected windows, reset visibility, alert thresholds, and refresh interval; providers are auto-detected from the active model.
- Responsive & thresholds: fitting strategy plus Context and Provider Usage warning/error thresholds.
- Label style: automatic, brief, labeled, or detailed (preset-owned).
- Color: semantic or monochrome.
- Icons: off, minimal, nerd, or emoji.
- Separator and density.

Settings are edited in memory as a transaction. Returning from a submenu keeps the selected values. Leaving the root menu validates and atomically persists the complete document. Escape/close from the root menu commits the current draft; there is no separate Save confirmation.

Because the Footer itself is not re-rendered while the settings menu is open, the menu MUST show a live preview built by rendering the draft configuration through the same pure layout pipeline used by the Footer. The preview is advisory: it does not mutate the active runtime Config or the Snapshot until the draft is committed.

In TUI mode the menu SHOULD use a custom SelectList presentation: selected values use the accent role, previews use muted/dim text, locked preset-owned entries use the muted role with a lock annotation, enabled/success states use success, and warning/error states use their semantic roles. Non-TUI and RPC modes MAY use the native string selector fallback with a `(locked)` suffix for locked entries.

## 10. Reload behavior

After a command or file change:

1. Validate the new configuration.
2. Replace the active immutable Config object.
3. Rebuild the layout plan.
4. Trigger one Footer redraw.
5. Keep provider/network state unless the usage settings changed.

Configuration changes MUST NOT require restarting the Pi session unless a Pi API limitation makes that unavoidable.
