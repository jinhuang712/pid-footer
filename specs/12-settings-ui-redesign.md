# Settings UI Redesign Specification

Status: Implemented (`src/commands.ts`, `src/settings-ui.ts`)
Scope: `/footer` 设置信息架构、Preset/Custom 边界、键盘交互、即时保存和设置项合并  
Related: [11-settings-design.md](./11-settings-design.md)（设置与渲染效果手册）

## 实现备注

- 预览面板中的 Category 摘要使用无标签的 compact 文本（与响应式布局用的 fallback 文本相同），而不是带标签的完整文本，避免出现 `Context — Context: 64.4%` 这种重复；交互式预览使用与实际 Footer 相同的运行时 Snapshot，不伪造 Git 可用性。
- Root 菜单中每个分类行列出该分类内的设置项（例如 `Appearance — Detail level · Color · Icons · Separator`），而不是当前渲染值；当前值只在预览和分类详情页出现，避免与“下一行设置项”混淆。
- 普通设置每次 Enter 确认或使用左右键切换后立即写入磁盘（`saveConfig`）；Layout 画布的方向键只修改待确认布局，第二次 Enter 才写入。为避免在快速连续确认时频繁重建 Footer/Usage manager，实时 Footer 重新安装只在向导退出时执行一次；设置菜单本身不受影响，因为它从不直接渲染 Footer。
- Layout 已改为空间画布编辑器：进入后保留同一组 Tab 页签，方向键只负责 traverse；按 Enter 选中 Segment 后才允许移动，选中项以粗体和 accent 色显示；再次按 Enter 确认保存，移动中按 `Esc` 取消本次移动，空闲时按 `Esc` 直接退出设置向导。
- Root 设置页在 Preview 下方显示 `General`、`Components`、`Layout`、`Appearance` 四个 Tab；使用 `Tab` / `Shift+Tab` 在选项组之间切换，切换不会把按键写入搜索框。
- `General` Tab 放置 Footer、Mode 和项目覆盖开关，并位于 Components 之前。
- `Layout` Tab 不显示重复的 `Layout` 分类选项；Tab 激活它时直接打开空间画布。
- 所有设置选择页都像原生 `/model` 一样支持始终可用的模糊搜索输入；搜索框位于 Tab 栏下方、设置列表上方，查询为空时显示完整列表。
- `usage.providers`、`segments.provider_usage.maxWindows`、`style.density` 仍保留在 schema 中（向后兼容），但设置 UI 不再暴露它们。Usage 的窗口选择和 reset 显示属于 `Usage` 分类，不再由 Display preset 隐式控制。

---

## 1. 目标

当前设置 UI 按内部实现模块组织：

```text
Layout / Segments / Context / Provider Usage / Responsive / Appearance
```

目标 UI 改为按用户可见的信息块组织，并用四个 Tab 收纳顶层选项：

```text
General:    Footer / Mode / Project-specific settings
Components: Project / Git / Models & Providers / Usage / Context / Cache / Tokens / Cost
Layout:     activating the tab opens the Layout canvas
Appearance: Detail level / Color / Icons / Separator
```

用户一进入设置，就应该知道 Footer 上有哪些内容可以配置，而不需要理解 Segment、Row 或 Layout。

---

## 2. 核心原则

### 2.1 Preset 只读，Custom 可编辑

Preset mode 下：

- 所有设置分类可见。
- 分类中的当前值可见。
- 细节默认只读。
- `Mode`、`Footer` 和 `Project-specific settings` 可以直接修改。
- 通过 `Mode` 选择 `Custom` 后进入可编辑状态。

Custom mode 下：

- 所有顶层信息块可配置。
- Layout 提供二维画布编辑：选中 Segment 后可用 `↑`/`↓` 移动到其它行，`←`/`→` 调整当前半区内的顺序，或用 `l`/`r` 跨过中轴线设置左右组；也可用 `n` 插入行、`x` 清空行。

### 2.2 没有 Apply / Discard

不再使用 draft transaction，也不提供：

```text
Apply changes
Discard changes
```

保存模型改为：

```text
Enter 确认一个具体值 = 立即校验并保存
← / → 切换枚举值 = 立即校验、保存并重新渲染
Layout 画布 = Enter 选中，方向键预览移动，Enter 再确认保存
```

### 2.3 键盘语义固定

```text
Tab / Shift+Tab  切换 Root 页面的下一个 / 上一个 Tab
Enter            打开子菜单，或确认并立即保存
Esc              返回上一层；Root 页面退出设置
```

补充规则：

- 每个选项页都像原生 `/model` 一样默认聚焦搜索输入框，搜索框位于 Tab 栏下方、设置列表上方。
- 输入内容按设置名称、当前值和描述做模糊匹配，`↑`/`↓` 浏览匹配项。
- 搜索输入中的普通字符（包括 `e`）直接进入查询，不触发退出。
- 查询非空时，`←`/`→` 编辑查询；查询为空时，`←`/`→` 在可循环选项上直接切换、保存并重新渲染。
- `Tab` / `Shift+Tab` 在 Root 页面和 Layout 画布中都可操作 `General`、`Components`、`Layout`、`Appearance`；Tab 栏位于 Preview 下方，切换时清空当前搜索词，并保留各 Tab 的上次选择；`Layout` Tab 不显示重复分类行，激活时直接打开空间画布。
- `Enter` 确认，`Esc` 直接返回上一层（Root 页面退出设置），与原生 `/model` 取消选择一致。

### 2.4 一个设置只有一个位置

例如：

- Context 只出现在 `Context`。
- Usage windows、threshold、refresh 只出现在 `Usage`。
- Provider Usage 不再同时出现在 Segment 和 Usage 两个入口。

### 2.5 不展示无效果或重复效果设置

设置 UI 中不再出现：

```text
Density
ASCII separator
Powerline separator
Maximum windows shown
Providers
More / Advanced
```

---

## 3. 顶层信息架构

### 3.1 Preset mode

```text
Footer settings · Balanced

Preset settings are read-only. Choose `Custom` through `Mode` to edit.

Preview
Project: project · Git: main · dirty          openai-codex: gpt-5.6-luna (xhigh)
Usage: Codex 58% (5hr, reset 4h) · 9% (7d, reset 7d)   Context: 64.4% · limit 272k
Tokens: ↓901k ↑63k · Cache: read 19.7m · write 0 · hit 99.3%   Cost: $0.123 · cache $0.028 · no-cache $0.095
────────────────────────────────────────────────────────────
 General     Components     Layout     Appearance

General
├── Footer                  On
├── Mode                    Balanced
└── Project-specific settings  Off

Components
├── Project                 project
├── Git                     main · dirty
├── Models & Providers      openai-codex: gpt-5.6-luna (xhigh)
├── Usage                   Codex 58% (5hr) · 9% (7d)
├── Context                 64.4% · limit 272k
├── Cache                   99.3% hit
├── Tokens             ↓901k ↑63k
└── Cost                    $0.123

Layout
└── activating the tab opens the canvas

Appearance
├── Detail level            automatic
├── Color                   semantic
├── Icons                   off
└── Separator               dot
```

Preset 分类可以 Enter 查看只读详情。只读详情页按分类列出各设置及当前值，但不可编辑；使用 `Esc` 返回根菜单。

### 3.2 Custom mode

```text
Footer settings · Custom

Preview
Project: project · Git: main · dirty          openai-codex: gpt-5.6-luna (xhigh)
Usage: Codex 58% (5hr resets in 3hr53m) · 9% (7d resets in 6d 14h)   Context: 64.4% · limit 272k
Tokens: ↓901k ↑63k · Cache: read 19.7m · write 0 · hit 99.3%   Cost: $0.123 · cache $0.028 · no-cache $0.095
────────────────────────────────────────────────────────────
 General     Components     Layout     Appearance

General
├── Footer
├── Mode
└── Project-specific settings

Components
├── Project
├── Git
├── Models & Providers
├── Usage
├── Context
├── Cache
├── Tokens
└── Cost

Layout
└── activating the tab opens the canvas

Appearance
├── Detail level
├── Color
├── Icons
└── Separator
```

Preset mode 下不提供额外的 Customize 或 Exit 菜单项；通过 `Mode → Custom` 进入可编辑状态，使用 `Esc` 退出设置。

首次安装或没有配置文件时，默认进入 `Custom` 模式，并使用当前默认 profile：完整 Project 路径、完整 Git、Full Context、Standard Tokens、compact Cache 和 detailed Provider Usage；Usage 默认选择 `5h` / `week`、显示 reset，并每 30 秒刷新。切换到 Custom 时会恢复 preset-owned 的布局和 Segment 设置，同时保留 Usage 的独立偏好。

---

## 4. Mode

```text
Mode
├── Compact
├── Balanced
├── Detailed
└── Custom
```

行为：

- Enter 选择一个 preset 后立即应用并保存。
- 选择 built-in preset 会替换 preset-owned 设置；Compact 使用两行 overview/session 布局，Balanced 和 Detailed 使用稳定的四行布局。
- Compact 使用 brief 的 Segment 显示，Balanced 使用 labeled 显示，Detailed 使用 detailed 显示；三者的具体 Segment display 也随 preset 重置。
- 从 built-in preset 选择 `Custom` 时，加载当前默认 profile 的布局和 Segment 设置：完整 Project 路径、完整 Git、Full Context、Standard Tokens、compact Cache 和 detailed Provider Usage；Usage 的窗口、Resets、Alerts 和 Refresh 偏好保持不变。
- 不需要单独的 `Reset to preset`；重新选择 Mode 即为 reset。

---

## 5. Footer

```text
Footer
├── Show Footer
│   ├── On
│   └── Off
└── Project-specific settings
    ├── On
    └── Off
```

### Show Footer

控制整个 pid-footer 是否显示。关闭时，根菜单中的其他设置会显示为禁用状态，不能进入或修改；重新打开 Footer 后恢复可用。

### Project-specific settings

控制是否读取当前项目的 Footer 设置。

这两个设置不属于 preset 样式，因此在 Preset mode 下也允许修改。

---

## 6. Appearance

```text
Appearance
├── Detail level
│   ├── Automatic
│   ├── Brief
│   ├── Labeled
│   └── Detailed
│
├── Color
│   ├── Semantic
│   └── Monochrome
│
├── Icons
│   ├── Off
│   ├── Minimal
│   ├── Nerd
│   └── Emoji
│
└── Separator
    ├── None
    ├── Dot
    ├── Bar
    └── Slash
```

### 移除项

UI 不再显示：

```text
Density
ASCII
Powerline
```

原因：

- `Density` 当前没有渲染效果。
- `ASCII` 当前与 `Bar` 相同。
- `Powerline` 当前也与 `Bar` 相同。

旧配置仍应兼容读取，但新 UI 不写入这些重复或无效果选项。

---

## 7. Project

```text
Project
├── Show Project
│   ├── On
│   └── Off
├── Display
│   ├── Folder name
│   └── Full path
└── Label
    └── Project
```

效果：

```text
Project: project
```

Display 的两个选项在设置 UI 中使用用户语言：`folder name`（只显示目录名）和 `full path`（显示完整路径）。

---

## 8. Git

```text
Git
├── Show Git
│   ├── On
│   └── Off
└── Label
    └── Git
```

效果：

```text
Git: main · dirty
```

---

## 9. Models & Providers

该分类只负责当前模型身份，不负责 Usage。

```text
Models & Providers
├── Identity style
│   ├── Collapsed
│   │   └── openai-codex: gpt-5.6-luna (xhigh)
│   └── Separate
│       └── Provider: openai-codex · Model: gpt-5.6-luna · Thinking: xhigh
│
├── Provider
│   ├── On
│   └── Off
│
├── Model
│   ├── On
│   └── Off
│
├── Thinking
│   ├── On
│   └── Off
│
└── Label
    └── Identity
```

Identity 的组合规则：

```text
Provider + Model + Thinking → openai-codex: gpt-5.6-luna (xhigh)
隐藏 Thinking             → openai-codex: gpt-5.6-luna
隐藏 Provider             → gpt-5.6-luna (xhigh)
```

---

## 10. Usage

Usage 是顶层分类，不再放在 `Models & Providers` 下。它把窗口选择、reset 显示和信息密度分成三个独立设置：

```text
Usage
├── Show Usage
│   ├── On
│   │   └── Auto-detect Codex / OpenCode Go from the active model
│   └── Off
│       └── Hidden; no provider usage requests
│
├── Display
│   ├── Compact
│   ├── Standard
│   └── Detailed
│
├── Windows
│   ├── 5h: On / Off
│   ├── Week (7d): On / Off
│   └── Month (30d): On / Off
│
├── Resets
│   ├── On
│   └── Off
│
├── Alerts
│   ├── Warning threshold
│   └── Error threshold
│
└── Refresh
    └── Every 30 seconds (default)
```

至少保留一个窗口。只渲染用户选中且 Provider 返回的窗口；`rolling`、`weekly` 和 `monthly` 只作为 Provider 内部别名。

### 10.1 自动 Provider 识别

用户不管理 Providers。

```text
Active model is Codex       → query Codex Usage
Active model is OpenCode Go → query OpenCode Go Usage
Anything else               → Usage hidden
```

`Show Usage: Off` 时不创建 Usage 请求。

### 10.2 Display、Windows 和 Resets

Display 只控制信息密度，不控制窗口数量或 reset 是否显示：

```text
Compact   Usage: 58% · 9%
Standard  Usage: Codex 58% (5hr) · 9% (7d)
Detailed  Usage: Codex 58% (5hr resets in 3hr53m) · 9% (7d)
```

启用 Resets 后，Compact 使用简短倒计时，Standard 使用短 `reset` 后缀，Detailed 使用完整的 `resets in` 表达。关闭 Resets 后，任何 Display 都不显示 reset。

### 10.3 Refresh interval

Refresh interval 是固定档位，不允许自由输入，默认值为 30 秒：

```text
15 seconds
30 seconds   # default
1 minute
2 minutes
5 minutes
10 minutes
15 minutes
```

不提供 30 分钟、1 小时或自定义秒数。

除了定时刷新，Usage 仍会在这些时机触发防抖刷新：

```text
Session start
Model changed
Turn ended
Manual refresh
```

---

## 11. Context

```text
Context
├── Show Context
│   ├── On
│   └── Off
├── Display
│   ├── Compact        Context: 25.5%
│   ├── Hybrid         Context: 1.0m × 25.5%
│   └── Full           Context: 261k/1.0m (25.5%)
└── Label
    └── Context
```

Display 预设直接决定 Context 的信息密度，不再拆分 Percentage、Context limit、Used tokens 和 Precision 等独立开关。

---

## 12. Cache

```text
Cache
├── Show Cache
│   ├── On
│   └── Off
└── Label
    └── Cache
```

效果：

```text
Cache: read 19.7m · write 0 · hit 99.3%
```

---

## 13. Tokens

```text
Tokens
├── Show Tokens
│   ├── On
│   └── Off
├── Display
│   ├── Compact      Tokens: 964k
│   ├── Standard     Tokens: ↓901k ↑63k
│   └── Full         Tokens: input ↓901k · output ↑63k
└── Label
    └── Tokens
```

效果：

```text
Compact:  Tokens: 964k
Standard: Tokens: ↓901k ↑63k
Full:     Tokens: input ↓901k · output ↑63k
```

该分类表示当前会话的 token 消耗，和 Usage、Cost 不同：

```text
Usage       账号额度
Tokens 当前会话 tokens
Cost        当前会话费用
```

---

### 13.1 Speed

Components 增加独立的 `Speed` 分类：`Show Speed`（On / Off）和 `Label`（默认 Speed）。
示例为 `Speed: 42.5 tok/s`，与 Tokens 消耗计数独立；无有效测速记录时实际 Footer 隐藏它，
分类说明和代表性预览仍展示示例。Custom 下修改后即时保存，失败回滚；Preset 下详情只读。
Show Speed: On 自动把 `speed` 放入 session 行左组；Off 从所有行移除它。Layout 画布使用
`Speed` 标签，支持独立移动、左右对齐和排序。旧布局不会自动被改写，未配置 Speed 时从 Off 开始。

## 14. Cost

```text
Cost
├── Show Cost
│   ├── On
│   └── Off
├── Display
│   ├── Compact
│   ├── Standard
│   └── Full
├── Notation
│   ├── Arrows
│   ├── Short
│   └── Full labels
└── Label
    └── Cost
```

效果：

```text
Compact:  Cost: $0.123
Standard: Cost: $0.123 · cache $0.028 · no-cache $0.095
Full:     Cost: $0.123 · in $0.012 · out $0.083 · read $0.025 · write $0.003
```

Display 控制信息密度，Notation 独立控制 breakdown 标签：`Arrows`、`Short`（`in/out/read/write`）或 `Full labels`（`Input/Output/Cache In/Cache Write`）。

---

## 15. 本阶段明确不做的内容

### 15.1 Layout UI：空间画布编辑器已实现

Custom 模式下的 `Layout` 分类使用两列画布展示当前布局：左列是左组，右列是右组；每一行对应 Footer 的一行。选中的 Segment 使用粗体和 accent 色突出显示。

```text
Layout — arrange Segments
→ Project                         Provider
  Git                             Context
  Usage                           Cost
  Token                           Cache
```

键盘行为：

- 未选中时，`↑` / `↓` / `←` / `→` 只在画布中 traverse，不改变布局。
- `Enter` 选中当前 Segment；选中项以粗体和 accent 色显示。
- 选中后，`↑` / `↓` 把 Segment 移到上一行/下一行；`←` / `→` 只在当前半区内调整顺序；`l` / `r` 才把它跨过中轴线放入左组/右组。
- `n` 在当前行下方插入临时空行；`x` 移除当前行。移动或清空后，确认保存会自动移除空行和重复的 Segment 放置，避免留下空白行。
- 再次按 `Enter` 确认并保存；`Esc` 取消本次移动，未选中时离开画布；保存失败自动回滚。

仍未实现：

```text
Row visibility
Row overflow
Responsive strategy
Narrow screen behavior
```

现有配置文件中的 Layout 仍会被尊重和渲染。

### 15.2 不做 More / Advanced

移除：

```text
More
├── Current tool
└── Extension status
```

原因：这两个入口的常用价值不足以占据设置 UI。

Current tool 和 Extension status 的底层 Segment 可以继续在已有 Layout 中渲染，但本阶段不提供设置入口。

### 15.3 不做 Provider 管理

移除 Providers 设置。Provider adapter 根据当前模型自动匹配。

### 15.4 不做最大窗口数

移除 `Maximum windows shown`。Usage 通过 `Windows` 子菜单独立控制 5h、Week 和 Month；Provider 返回但未选择的窗口不渲染。

---

## 16. 保存和错误处理

### 16.1 即时保存

当用户按 Enter 确认一个具体值，或使用 `←` / `→` 切换可循环值时：

1. 校验新值。
2. 原子写入配置。
3. 替换 active config。
4. 更新 Preview。
5. 显示短暂反馈：

```text
Saved: Color = Monochrome
```

### 16.2 保存失败

如果写入失败：

```text
Unable to save settings. Previous configuration was not changed.
```

行为：

- 保留旧配置。
- 停留在当前页面。
- 不更新 active config。

### 16.3 非法输入

非法值不保存。

示例：

```text
Refresh interval: 45 seconds
Invalid: choose one of 15s, 30s, 1m, 2m, 5m, 10m, 15m
```

---

## 17. 旧配置兼容策略

第一阶段可以不修改配置格式，只重组 UI；但后续实现应按以下方向收敛。

| 旧设置 | 新行为 |
|---|---|
| `usage.providers` | UI 移除；Provider 自动识别；旧字段可 warning + ignore |
| `segments.context.display` | 固定为 `compact` / `hybrid` / `full`，不提供旧 preset 映射 |
| `segments.provider_usage.maxWindows` | UI 移除；窗口数量改由 `usage.windows` 选择；旧字段 warning + ignore |
| `usage.windows` | UI 提供 5h / Week / Month 的独立开关；旧的 `rolling` 别名迁移到 5h |
| `usage.showResetTime` | UI 提供 Resets On / Off；旧字段继续生效 |
| `style.density` | UI 移除；旧字段 warning + ignore |
| `separator: ascii` | UI 隐藏；读取时按 `bar` 兼容 |
| `separator: powerline` | UI 隐藏；读取时按 `bar` 兼容或 warning |
| Context percentage precision | 不再单独配置，由 preset 固定为一位小数 |
| `refreshSeconds` 非固定档位 | 收敛到最近支持档位，并产生 migration warning |
| 显式 Layout | 继续读取和渲染；Custom 模式下通过空间画布编辑 |

---

## 18. 验收标准

实现完成后应满足：

- Preset mode 下能看到所有可配置分类，但细节只读。
- Preset mode 下只能直接修改 General Tab 中的 `Mode`、`Footer` 和 `Project-specific settings`。
- Custom mode 下 Root 页面使用四个 Tab：

```text
General:    Footer, Mode, Project-specific settings
Components: Project, Git, Models & Providers, Usage, Context, Cache, Tokens, Cost
Layout:     activating the tab opens the Layout canvas
Appearance: Detail level, Color, Icons, Separator
```

- Custom 模式下存在 `Layout` 空间画布；不提供单独的 `Position`、`Advanced` 或 `More` 菜单。
- 不存在 `Apply changes` / `Discard changes`。
- Enter 确认具体值后立即保存；`←` / `→` 切换候选值时也立即保存并重新渲染。
- Esc 在子菜单返回上一层；在 Root 页面直接退出设置。
- 设置选择页默认聚焦 Tab 栏下方、列表上方的搜索输入，按名称、值和描述做模糊过滤；`e` 是普通查询字符。
- Root 页面拆成 `General`、`Components`、`Layout`、`Appearance` 四个 Tab；Layout 画布继续显示同一组 Tab；Tab 栏位于 Preview 下方，`Tab` / `Shift+Tab` 循环切换可见选项组，且不进入搜索查询；`Layout` Tab 不增加重复分类菜单层级，激活时直接打开空间画布。
- `Esc` 直接返回上一层；Root 页面按 `Esc` 退出设置，与原生 `/model` 的取消行为一致。
- Layout 画布进入后先用方向键 traverse；按 `Enter` 选中项后才以粗体和 accent 色显示，`↑`/`↓` 移动行、`←`/`→` 调整当前半区顺序，`l`/`r` 设置左右组，第二次 `Enter` 确认，`n` 插入临时行，`x` 移除行；确认时会移除空行、清理重复放置，并原子保存；无待确认移动时按 `Esc` 直接退出设置向导。
- Context Display 预设固定为 Compact / Hybrid / Full：分别显示百分比、Limit × 百分比、已用/Limit/百分比。
- Tokens Display 预设固定为 Compact / Standard / Full：分别显示 I/O 合计、箭头形式的 Input/Output、带语义标签的 Input/Output。
- Cache 的内置优先级提高到 Tokens 之上，避免在窄屏被最先隐藏。
- Refresh interval 只能选择 15s / 30s / 1m / 2m / 5m / 10m / 15m，默认 30s。
- Usage 不包含 Providers 或 Maximum windows；Windows 和 Resets 是独立设置，Display 只控制信息密度。
- 每次保存后 Preview 立即反映 active config。
- 保存失败时 active config 保持不变。
