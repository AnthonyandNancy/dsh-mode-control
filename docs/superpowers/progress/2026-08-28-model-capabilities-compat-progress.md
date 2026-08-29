# Model Capabilities / Compat UI 重构进度记录

> 本文件是当前实现的工作记录，不是新的设计方案。它按 Superpowers 的任务、验证、风险和后续执行格式记录已完成内容与剩余工作，便于低余额环境下继续执行时快速恢复上下文。

## 1. 工作目标

将 `dsh-mode-control` 的客户端设置页从旧的 backend-form / 永久模型列表布局重构为：

```text
DSH Native Settings
→ Provider Selector
→ Compact Setting Rows
→ Selector-first Model Routing
→ Progressive Disclosure
```

同时保持以下既有能力：

- runtime capability detection；
- serialized Schemastery schema-aware visibility；
- provider/model draft state；
- 精确 `set` / `unset` mutations；
- unknown field / unknown compat field preservation；
- reset semantics；
- `expectedRevision` version gate；
- Legacy Subagent 与 Native Subagent model-selection 逻辑；
- Provider `models[]` 与 `modelOverrides` 的既有数据归属。

工作目录：

```text
D:\code\ai\dsh-mode-control
```

目标 GUI：

```text
http://127.0.0.1:57829
```

没有创建 worktree，没有 reset `main`，没有替换 DSH GUI server。

---

## 2. 当前状态摘要

| 项目 | 当前状态 |
|---|---|
| UI 架构重构 | 已完成 |
| Shared model picker | 已实现 |
| Provider/model 精确 mutations | 已完成 |
| Unknown fields preservation | 已实现并有测试 |
| Provider/model compat schema 分离 | 已实现并有测试 |
| models[] / modelOverrides route ownership | 已完成并有测试 |
| Provider/model dirty tracking | 已实现 |
| Save in-flight 防重复 | 已实现 |
| Async load generation guard | 已实现 |
| Subagent writable / revision 基础保护 | 已实现 |
| Subagent nested runtime facts | 已修复（P1） |
| Legacy global agentOptions guard | 已修复（P1） |
| Subagent draft lifecycle | 已修复（P1） |
| Per-model protocol applicability | 已修复（P1） |
| cacheControlFormat enum | 已接入（P2） |
| CompactSelect 动态 accessible name | 已修复（P2） |
| Unsupported compat 普通控件 disabled/clear-only | 已修复（P2） |
| Declared models[] / catalog-only route UI | 已确认只编辑声明/override route（P2） |
| Popup reactive viewport placement | 已实现几何 helper + scroll/resize 重算（P2） |
| ModelRouteOption metadata | 保持现有 label/custom/reasoning/context metadata，不扩大范围（P2 记录理由） |
| 真正 mounted DOM tests | 未真实 mount；以纯 helper 等价回归覆盖，未虚报 |
| 最新源码 build/reload | 本轮已重新执行 |
| 可合并状态 | 仍需人工 GUI 视觉确认后可合并 |

---

## 3. 已完成任务

### Task A — Selector-first UI 重构

**主要文件：**

- `src/client/index.ts`
- `src/client/ui.ts`
- `src/client/model-picker.ts`
- `README.md`

**已完成：**

- 移除永久 model search/list/left-right split。
- Provider 改为 compact selector。
- 当前 model 改为共享 `ModelRoutePicker`。
- Legacy Subagent model 改为共享 `ModelRoutePicker`。
- Native allowed models 改为共享 `MultiModelPicker`。
- Provider defaults、reasoning、compatibility、model details 改为 compact setting rows。
- 高级内容采用 disclosure/progressive disclosure。
- footer 改为 action row，并提供 save/reset 状态展示。
- 引入 DSH semantic tokens。
- 没有引入大型 UI 依赖。
- 没有添加独立 palette、dark-mode media query 或硬编码 `rgb(...)` / 常见十六进制颜色。
- 删除旧的固定 `max-width: 760px` split layout。

### Task B — Shared picker 与键盘行为

**文件：**

- `src/client/model-picker.ts`
- `src/client/ui.ts`
- `tests/model-picker.spec.ts`
- `tests/ui-regressions.spec.ts`

**已实现：**

- provider grouping；
- route deduplication；
- provider/model 大小写不敏感搜索；
- current route stale escape hatch；
- additional persisted route escape hatch；
- single-select / multi-select；
- 搜索框 Enter 选择第一个 filtered route；
- ArrowUp / ArrowDown 初始焦点方向；
- Enter / Space / Escape；
- outside pointer dismissal；
- outside focus dismissal；
- `relatedTarget === null` 的 focusout dismissal；
- Escape 和 selection 后恢复 trigger focus；
- listbox / option ARIA 结构；
- `aria-selected`；
- `aria-controls` 指向实际 listbox；
- picker option 使用 `tabIndex: -1`；
- trigger label 包含当前 route 或 selected count；
- open 状态下再次 Enter/Space 可关闭 trigger。

### Task C — Compact UI primitives

**文件：**

- `src/client/ui.ts`

**已实现：**

- `SettingRow`；
- `CompactSelect`；
- `InlineNumberEditor`；
- `DisclosureRow`；
- `ChevronDownIcon`；
- `ChevronRightIcon`；
- `CheckIcon`；
- `openingOptionIndex()`；
- `popupCloseRestoresFocus()`；
- `shouldCloseTriggerOnKey()`；
- Inline number editor exactly-once commit/cancel guard；
- Escape / selection focus restoration；
- `TextInput.inputRef` 支持 picker 搜索焦点；
- 保留旧的 `Dropdown` / `Field` / `Disclosure` / `NumberInput` / `TextInput` aliases。

### Task D — Provider/model capability parsing 与 mutation

**文件：**

- `src/client/ops.ts`
- `src/client/save-helpers.ts`
- `src/client/compat-state.ts`

**已实现：**

- provider default input；
- provider default reasoning；
- provider context window；
- provider max tokens；
- thinking budgets；
- model input；
- model reasoning efforts / wire values；
- model context window；
- model max tokens；
- provider compat；
- model compat；
- precise leaf `set` / `unset` operations；
- empty/inherit value 的 unset semantics；
- `models[]` entry clone + owned field merge；
- `modelOverrides` leaf path operations；
- 不替换整个 `compat` object；
- 不替换整个 `modelOverrides.<model>` object；
- unknown model entry fields 保留；
- unknown compat fields 保留；
- catalog-only route 不物化为 `models[]` entry；
- mixed declared / override-only route ownership 测试；
- provider-only save 不应发送 model array；
- model reasoning UI dirty fields 归一为 `reasoningEfforts`；
- 保存期间编辑会显示 pending-save 状态；
- in-flight save guard 防止重复 mutation；
- provider/model field-level dirty maps 用于 rebase 时仅保留用户真正修改的字段。

### Task E — Runtime schema capability separation

**文件：**

- `src/client/runtime-capabilities.ts`
- `tests/runtime-capabilities.spec.ts`

**已实现：**

- `RuntimeCapabilities.modelCompatFields`；
- provider compat schema path：

```text
providers.inner.compat
```

- model `models[]` compat schema path：

```text
providers.inner.models.inner.compat
```

- model override compat schema path：

```text
providers.inner.modelOverrides.inner.compat
```

- provider/model compat field separation 测试；
- schema object keys traversal；
- serialized schema reference traversal；
- enum value extraction 基础逻辑。

### Task F — Compat UI

**文件：**

- `src/client/compat-ui.ts`
- `src/client/compat-state.ts`

**已实现：**

- compat metadata registry-driven rendering；
- 普通字段 visible description；
- JSON field disclosure；
- JSON field visible description；
- unsupported existing JSON field disabled textarea；
- unsupported existing JSON field clear action；
- unsupported boolean/enum field限制为 inherit/current value；
- existing unsupported fields 仍可清除；
- reset/inherit 产生精确 unset。

### Task G — Subagent settings

**文件：**

- `src/client/subagent-ui.ts`
- `src/subagent/capabilities.ts`
- `tests/subagent-ui.spec.ts`

**已实现：**

- Legacy fixed model picker；
- Native allowed-model multi-picker；
- Native namespace writable guard；
- `enableModelSelection()` control writable guard；
- per-provider unsupported agentOptions apply 基础拦截；
- mutation response revision extraction；
- local legacy/native revision tracking；
- successful mutation 后 parent `onApplied` 回调；
- legacy tuning 在切换 inherit 时保留；
- stale persisted native route 显示。

### Task H — 本轮 P1/P2 修复（2026-08-29）

**文件：**

- `src/client/runtime-capabilities.ts`
- `src/client/index.ts`
- `src/client/subagent-ui.ts`
- `src/client/ops.ts`
- `src/client/save-helpers.ts`
- `src/client/compat-ui.ts`
- `src/client/ui.ts`
- `src/client/model-picker.ts`

**已修复：**

- P1: `subagentRuntimeFactsFromValue()` 从 `value.runtime` 解包 effectiveVersion / toolSubagentSchemaFields / agentOptionsSchemaFields / modelSelectionSettings / providers；缺失时 fail closed。
- P1: Legacy Apply 增加 global `supportsAgentOptions` guard；固定 route 的 provider snapshot 缺失时 fail closed；inherit/unset 仍允许；新增 `subagent.agentOptionsUnsupported` 文案；Apply 按钮 disabled 与 mutation guard 一致。
- P1: Subagent draft lifecycle：`applySuccessOutcome()` 只在 apply 期间无新编辑时清除 dirty；无 revision 响应保留最新 revision；parent props 更新只刷新非 dirty namespace；`onApplied` 在清理 dirty 后触发。
- P1: `protocolsForModel()` 按 selected model 的 catalog api / provider api / entry-override api / group fallback 解析；model compat 与 Anthropic reasoning wire 均按 model protocol；`collectOpsForModels()` 支持 per-model anthropic resolver。
- P2: `collectEnumOptions()` 提取 `cacheControlFormat`（连同 maxTokensField / thinkingFormat）并接入 enumOptions state。
- P2: `CompactSelect` trigger aria-label 现在包含当前选中值（`label: value`）。
- P2: unsupported boolean/enum compat 控件 disabled 且只显示 current/inherit，另提供 clear-only 按钮；mutation 层用 runtime provider compat fields 限制写入，非 inherit 的 unsupported 值不产生 set op，clear 产生精确 unset。
- P2: `declaredModelIds()` / `catalogModelIds()` 明确主 Model Settings 只编辑声明 models[] + modelOverrides；catalog-only route 不物化、不显示为可编辑 draft。
- P2: popup 增加 `computePopupPlacement()` 纯几何 helper，open 期间 scroll/resize 重算方向与 maxHeight；menu overflow hidden、listbox flex:1/min-height:0、groups 滚动、search 不随大 catalog 滚走。
- P2: ModelRouteOption metadata 保持现有 `providerLabel/modelLabel/custom/reasoningEfforts/contextWindow`，不扩大范围；主设置页已排除 catalog-only route，因此不会出现“可编辑但无法保存”的 route。

**新增/修改测试：**

- `tests/runtime-capabilities.spec.ts`：nested runtime facts、provider supportsAgentOptions、fail closed、model protocol resolution、collectEnumOptions。
- `tests/subagent-ui.spec.ts`：global/per-provider/read-only/missing-snapshot guard、draft lifecycle（apply 期间编辑、sequential revision、parent dirty preserve）。
- `tests/ops.spec.ts`：`declaredModelIds`/`catalogModelIds`、`isAnthropicModel`。
- `tests/ops-extended.spec.ts`：per-model anthropic wire defaults。
- `tests/compat-ui.spec.ts`（新增）：unsupported compat select 为 disabled/clear-only。
- `tests/ui-regressions.spec.ts`：CompactSelect 动态 aria label、commitOnce、unsupported provider compat 不写 set / clear 写 unset。
- `tests/model-picker.spec.ts`：popup placement 上下方向与 maxHeight clamp、custom route metadata。

---

## 4. 验证记录

最近一次完整源码验证执行（本轮 2026-08-29）：

```bash
npm run typecheck
npm run typecheck:client
npm test
npm run build
npm run build:client
git diff --check
git status --short
```

结果：

```text
npm run typecheck          PASS
npm run typecheck:client   PASS
npm test                   PASS
Test Files                 14 passed
Tests                      192 passed
npm run build              PASS（本地 fallback：DSH checkout 未配置，host-only build）
npm run build:client       PASS
git diff --check           PASS
```

当前测试文件数量：

```text
14 test files
192 tests
```

已执行过的 build：

```bash
npm run build
npm run build:client
```

已知结果：

- host build 使用本地 fallback，因为当前工作目录不是 DSH checkout；
- client build 成功；
- 生成的 `lib/client.js` 成功生成；
- client bundle 本轮记录：`170.65 kB`，gzip `35.44 kB`。

已执行过插件热重载（本轮）：

```text
dev_reload_package(packageName = "dsh-llm-pi-ai-capabilities")
```

结果：

```text
client ✓ (lib/client.js)
fiber before: active
after: active
```

GUI endpoint 检查（本轮）：

```text
HTTP 200, size=17098
http://127.0.0.1:57829
```

注意：以上只是页面 HTTP 加载确认，不是视觉/DOM 验证；本轮没有可用的浏览器截图工具，未声称完成真实 GUI 视觉验证。

---

## 5. 剩余问题与执行要求

### 本轮已全部修复的 P1

- P1-1 Subagent runtime facts 层级错误 — 已修复：`subagentRuntimeFactsFromValue()` 从 `value.runtime` 解包并传入 capability detection，providers 保留 `supportsAgentOptions`，缺失时 fail closed。
- P1-2 Legacy Apply 缺少 global `supportsAgentOptions` guard — 已修复：`canApplyLegacyRoute()` 同时要求 controlWritable、global capability、provider snapshot；固定 route 的 provider snapshot 缺失 fail closed；inherit/unset 允许；按钮与 mutation guard 一致；新增 unsupported 文案。
- P1-3 Subagent draft lifecycle — 已修复：`applySuccessOutcome()` 版本快照比较、无 revision 保留最新 revision、parent props 只刷新非 dirty namespace、apply 成功且无新编辑才清 dirty；冲突失败保留本地 draft。
- P1-4 Model protocol 按 selected model 解析 — 已修复：`protocolsForModel()` 按 catalog model api → provider api → entry/override api → group fallback；model compat 与 Anthropic reasoning wire 按 model protocol；混合 catalog 不互相显示错误字段。

### 本轮已完成的 P2

- P2-1 `cacheControlFormat` enum 已接入（`collectEnumOptions()` + enumOptions state + compat renderer）。
- P2-2 CompactSelect 动态 accessible name 已实现（`label: value`），保留 listbox ARIA 结构。
- P2-3 Unsupported compat 普通 boolean/enum 控件已 disabled/clear-only；mutation 层以 runtime compat fields 限制写入，unsupported non-inherit 不产生 set op，clear 产生精确 unset；JSON 行为一致。
- P2-4 Declared models[] 与 catalog-only route：主 Model Settings 只使用 `declaredModelIds()`（models[] + modelOverrides）；catalog-only route 不显示为可编辑 draft，Subagent picker 仍可显示 catalog models。
- P2-5 Popup viewport placement：`computePopupPlacement()` 纯几何 helper + scroll/resize 重算；menu overflow hidden、listbox flex:1/min-height:0、groups 滚动、search 不滚走。
- P2-6 ModelRouteOption metadata：保持现有 `providerLabel/modelLabel/custom/reasoningEfforts/contextWindow`，不扩大范围；主设置页已排除 catalog-only route，因此不存在“可编辑但无法保存”的 route。

### 仍待办（不阻塞完成标准，但需如实记录）

- 真实 mounted DOM 交互测试：当前 Vitest 为 node 环境，没有 jsdom/react-test-renderer；本轮以纯 helper 等价回归覆盖（openingOptionIndex、shouldCloseTriggerOnKey、popupCloseRestoresFocus、compactSelectAccessibleLabel、commitOnce、applySuccessOutcome、modelRouteForEnter、toggleModelRoute 等），未声称完成真实 DOM 验证。
- GUI 视觉验证：仅确认 `http://127.0.0.1:57829` HTTP 200 页面加载；没有浏览器截图工具，未做视觉/交互验证。
- 可选扩展：ModelRouteOption 显示 custom/stale/unsupported 徽标、reasoning/capability summary、context window 详情；本轮未扩大范围。

## 6. 工作区与文件记录

当前已修改或新增的主要文件：

```text
README.md

src/client/compat-state.ts
src/client/compat-ui.ts
src/client/index.ts
src/client/model-picker.ts
src/client/ops.ts
src/client/runtime-capabilities.ts
src/client/save-helpers.ts
src/client/subagent-ui.ts
src/client/ui.ts

tests/compat-ui.spec.ts
tests/model-picker.spec.ts
tests/ops-extended.spec.ts
tests/ops.spec.ts
tests/runtime-capabilities.spec.ts
tests/subagent-ui.spec.ts
tests/ui-regressions.spec.ts
```

已检查的审计临时文件：

```text
audit-*
baseline-*
```

当前未发现这些临时文件。

当前没有 commit。

---

## 7. 本轮执行结果（2026-08-29）

已按 Round 1 → Round 2 → Round 3 顺序执行完毕：

- Round 1：P1 四项全部修复并补回归测试；
- Round 2：P2 六项全部完成（含 ModelRouteOption metadata 理由记录）；
- Round 3：`npm run build` / `npm run build:client` 通过，`dev_reload_package("dsh-llm-pi-ai-capabilities")` 成功，`http://127.0.0.1:57829` 返回 HTTP 200 页面加载。

未启动 replacement server；没有新建 worktree；没有 reset/checkout 覆盖现有工作；没有创建设计文档。

---

## 8. 完成标准

以下条目均已满足（除了注明“仅等价/HTTP 确认”的项）：

- [x] P1 runtime nested facts 修复；
- [x] P1 global/per-provider agentOptions guard 修复；
- [x] P1 subagent draft lifecycle 修复；
- [x] P1 per-model protocol applicability 修复；
- [x] P2 cacheControlFormat enum 接入；
- [x] P2 CompactSelect dynamic aria label；
- [x] P2 unsupported compat disabled/clear-only；
- [x] P2 declared models[] catalog-only route 不再造成虚假 Saved；
- [x] 关键 picker popup/focus 行为有等价回归覆盖（未真实 mount DOM，已如实记录）；
- [x] `npm run typecheck` 通过；
- [x] `npm run typecheck:client` 通过；
- [x] `npm test` 全部通过（14 files / 192 tests）；
- [x] `npm run build` 通过（本地 fallback）；
- [x] `npm run build:client` 通过；
- [x] `git diff --check` 通过；
- [x] 插件重新热重载成功（dev_reload_package）；
- [x] 现有 DSH GUI 刷新后确认页面加载（HTTP 200；视觉验证未执行，已如实说明）；
- [x] 没有 audit/baseline/review*.diff 临时文件；
- [x] 没有无关替换 server 或 worktree 污染。
