# pid-footer 开发规范

## 1. 项目定位

`pid-footer` 是一个 Footer-only 的 Pi Extension，核心目标是提供：

- 可配置的多行 Footer。
- 响应式宽度适配。
- Context、Token、Cache、Cost 等本地会话指标。
- OpenAI Codex 和 OpenCode Go 的 Provider Usage 监控。
- 基于语义状态的文字颜色。

本项目不负责编辑器、Bash mode、Prompt queue、Stash、Welcome overlay、Working Vibes 或其他非 Footer 功能。

## 2. 必读文档

开始开发前必须阅读相关规格文档：

```text
specs/README.md
specs/00-product-spec.md
specs/01-architecture.md
specs/09-implementation-plan.md
```

开发某个模块时，还必须阅读对应专题文档：

- 数据和 Segment：`specs/02-data-model-segments.md`
- 布局和渲染：`specs/03-layout-rendering.md`
- 颜色和主题：`specs/04-color-themes.md`
- Provider Usage：`specs/05-provider-usage.md`
- 配置和命令：`specs/06-config-commands.md`
- 生命周期和安全：`specs/07-lifecycle-performance-security.md`
- 测试和验收：`specs/08-testing-acceptance.md`

如果实现与规格不一致，必须先更新规格文档或记录决策，再修改代码。

## 3. 核心开发原则：小步快跑

这是本项目最重要的开发规范。

### 3.1 小任务、小改动

每次只解决一个清晰的问题，例如：

- 只实现配置加载。
- 只实现一个纯函数布局算法。
- 只实现 Context Segment。
- 只实现 Codex 响应标准化。
- 只实现一个 `/footer` 子命令。

不要在同一个改动中同时重构架构、增加功能、修改样式和整理无关代码。

### 3.2 及时 Commit

每完成一个可验证的逻辑单元，必须及时创建 Git commit。不要等到多个 Phase 全部完成后再一次性提交。

推荐提交时机：

- 项目骨架可以加载后。
- 配置读取和校验完成后。
- Snapshot Store 完成后。
- 一个或一组相关 Segment 完成并通过测试后。
- 布局算法完成并通过宽度测试后。
- 颜色系统完成后。
- 一个 Provider Adapter 完成并通过 fixture 测试后。
- 一个命令完成后。
- 每个实施 Phase 完成后。

### 3.3 Commit 质量

每个 commit 必须满足：

- 只包含一个主题。
- 能够说明做了什么。
- 尽可能保持项目可构建、可测试。
- 不包含临时调试代码、无关格式化或生成物噪音。
- Commit 前检查 `git diff` 和 `git status`。

建议使用清晰的 Conventional Commit 风格：

```text
feat(config): add validated global settings
feat(layout): add independent multi-row fitting
feat(usage): add Codex usage adapter
test(render): cover narrow terminal layouts
fix(usage): ignore stale provider responses
docs(spec): clarify project config precedence
chore(repo): add package build scaffold
```

### 3.4 不要为了“大改动更整齐”而延迟提交

如果工作过程中发现新的问题：

1. 先提交当前已经完成且可验证的部分。
2. 再创建下一个小任务处理新问题。
3. 不要把所有发现都堆进当前 commit。

除非明确说明原因，不得使用 `git reset --hard`、强制覆盖用户修改或随意 amend 已完成的 commit。

## 4. 阶段推进汇报

每完成一个实施阶段、准备进入下一个阶段之前，必须先向用户说明：

1. 当前阶段完成了什么。
2. 当前阶段的验证结果和 commit。
3. 下一个阶段要解决什么问题。
4. 下一个阶段明确不做什么。
5. 下一个阶段的预期交付物和验收标准。

在用户确认或明确要求继续后，才进入下一个阶段。阶段说明必须简洁、具体，不能只说“继续开发”。

## 5. Git 工作流

开始工作前：

```bash
git status
git log --oneline -5
```

提交前：

```bash
npm test        # 如果项目已提供该命令
npm run check   # 如果项目已提供该命令
git diff --check
git status
git diff
```

提交后：

```bash
git status
git log --oneline -3
```

工作区应明确知道哪些文件仍未提交。不要静默留下未说明的修改。

## 6. 代码架构规范

必须保持以下边界：

```text
数据采集 → Snapshot Store → Segment Resolver → Layout Engine → Renderer → Pi Footer
```

具体要求：

- Renderer 不得执行网络请求、文件读取、Git 命令或其他 I/O。
- Layout Engine 必须是可测试的纯逻辑。
- Provider Adapter 只负责 Provider 识别、请求和标准化，不负责 Footer 布局。
- Segment 不得直接读取 Provider 原始 JSON。
- 状态更新必须通过统一 Snapshot Store。
- 必须使用 Pi 公共 Extension API。
- 不得依赖 Pi 内部编译产物或私有 TUI API。
- 在终端里不得使用 `setWidget()` 来绕过 Footer API。
- 终端之外没有 Footer API 可用：`setFooter()` 要的是一个 pi-tui 组件，只有终端能挂载。所以
  `ctx.hasUI && ctx.mode !== "tui"` 的宿主改走 `setWidget()`，键就是扩展名 `pid-footer`，内容是
  同一份快照的 JSON；由本扩展自己的桌面半边 `src/ui.tsx` 把它画出来。同一条管线、同一组数字，
  只是换谁来画。
- 不要为了怕宿主显示 JSON 原文而退回一行纯文本：画它的是本扩展自己的代码，宿主不需要认识这份
  结构。桌面半边只能用 `@pid/ui` 的原语，不能写 utility class——宿主的样式表按宿主自己的源码
  构建，它没用过的 class 在插件加载时并不存在。

## 7. 规格优先

新增功能前必须确认它属于当前版本范围。

v0.1 明确不做：

- 通用模板语言。
- 任意用户 TypeScript Segment API。
- GitHub Copilot / OpenRouter Usage。
- Codex Fast 和 Codex reset。
- 编辑器、Bash mode、队列、stash、welcome、vibes。

如果功能超出范围，应记录到 `specs/10-open-decisions.md`，不要直接混入实现。

## 8. 配置和兼容性

- 全局配置路径：`~/.pi/agent/pid-footer.json`。
- 项目配置路径：`<project>/.pi/pid-footer.json`。
- 扩展改名前叫 `pi-x-footer`，旧文件名 `pi-x-footer.json` 仍然会被读取：同目录下两份都在时以新名为准，
  只有旧名时照读不误。写入一律写新名，不迁移、不删除旧文件——那是用户的文件。
- 项目配置默认关闭。
- 配置必须经过校验，写入必须使用原子替换。
- 非法配置不得破坏上一份有效配置。
- 新字段必须考虑旧配置兼容和版本迁移。

## 9. 性能和异步行为

- Footer render 路径不得阻塞。
- Provider 请求必须有超时、取消和并发控制。
- 定时刷新不得导致请求循环。
- 新响应不能覆盖更新的 Session 或账号状态。
- 关闭 Session 时必须清理定时器和请求。
- Slow data source 必须缓存，不能每次渲染重新获取。

## 10. 安全和隐私

绝不：

- 打印 API Key、OAuth Token、Cookie 或 Authorization Header。
- 将凭据写入配置、Snapshot、测试快照或日志。
- 向未经验证的 Provider endpoint 发送运行时凭据。
- 将 Codex CLI 账号当作 Pi 当前账号的可靠替代。
- 直接把未经清理的 Provider 响应作为终端文本输出。

如果复用或实质性改编 MIT 代码，必须：

1. 确认来源和许可证。
2. 保留必要的版权和许可证信息。
3. 在 `NOTICE.md` 中记录归属和使用范围。
4. 不要无依据地声称某段代码来自某个上游项目。

## 11. 测试规范

新增功能必须同时考虑测试：

- 纯逻辑优先写单元测试。
- Provider 使用固定 fixture，不得在测试中调用真实服务。
- 布局必须覆盖至少 40、60、80、120 列宽度。
- 颜色必须覆盖正常、警告、错误、stale、unavailable。
- 配置必须覆盖缺失、非法、部分有效和迁移场景。
- 异步代码必须覆盖超时、取消、迟到响应和错误降级。

不要为了让测试通过而削弱安全校验或修改规格中的行为定义。

## 12. 文档规范

面向用户的行为变化必须同步更新：

- `README.md`
- 对应的 `specs/*.md`
- 必要时的配置示例

代码注释用于解释设计原因，而不是重复代码本身。

## 13. 完成一个任务的 Definition of Done

一个任务只有同时满足以下条件才算完成：

- 实现范围清晰，没有混入无关修改。
- 对应规格已经更新或确认无需更新。
- 类型检查和相关测试通过。
- `git diff --check` 通过。
- 已检查完整 diff。
- 已创建一个主题明确的 commit。
- 工作区剩余修改已明确说明。
