# @deepseek-ai/dsh-llm-pi-ai-capabilities

DSH 模型能力 + Reasoning 能力 + Wire Compatibility + Subagent Model Control
配置界面。

This plugin is **not** a second LLM provider and does **not** replace
`PiAiAdapter`. It is a settings/UI bridge over native DSH settings
namespaces. It never patches `node_modules`, never monkey-patches `fetch`,
never wraps/replaces `PiAiAdapter`, and never keeps a second runtime config
source.

## Version support matrix

### dsh-llm-pi-ai capability surface

| dsh-llm-pi-ai | Mode                   | Adapter Patch    |
| ------------- | ---------------------- | ---------------- |
| `0.1.0-rc.6`  | Legacy Compatibility   | rc.6 patch       |
| `0.1.0-rc.7`  | Legacy Compatibility   | rc.7 patch       |
| `0.1.0-rc.8`  | Native Mode            | Forbidden        |
| `> rc.8`      | Native / Unverified    | Never auto-apply |

The UI detects the running mode from `api.host.describe().version` and falls
back to the serialized `llm-pi-ai` settings schema.

### dsh-tool-subagent visibility policy

| `@deepseek-ai/dsh-tool-subagent` | Subagent area |
| -------------------------------- | ------------- |
| Canonical loader entry missing    | Hidden        |
| Entry present, version unknown    | Visible + unverified warning |
| Entry present, `< 0.1.1-rc.2`    | Visible + legacy warning |
| Entry present, `>= 0.1.1-rc.2`   | Visible + confirmed |

Subagent UI is entry/schema driven; the version is advisory only:

- **Host**: the `dsh-mode-control.subagent` settings namespace is registered
  whenever a canonical `tool-subagent` loader entry exists. The version is
  recorded in the runtime snapshot for warnings.
- **Client**: `SubagentSettingsCard` returns `null` only when
  `runtimeCaps.subagent.visible` is false (entry missing).

Unverified or older versions remain visible with a lightweight warning; the
writable controls are still decided by the detected Schemastery schema, so no
unsupported field is ever written blindly.

## Feature overview

- **Provider capabilities**: `defaultInput`, `defaultContextWindow`,
  `defaultMaxTokens`, `defaultReasoning`, `thinkingBudgets`, Anthropic
  adaptive thinking.
- **Model capabilities**: `input`, `contextWindow`, `maxTokens`,
  `reasoningEfforts`, per-model wire values.
- **Interface Compatibility**: generic metadata-driven UI over the `compat`
  object. The field list lives in `src/client/compat-fields.ts`; adding a
  future pi-ai compat field is one registry entry + i18n strings.
- **Subagent Model Control**: legacy fixed model (`agentOptions`) and native
  dynamic selection (`subagent-model-selection.enabled/allowedModels`).
- **InheritBooleanMode**: `inherit` / `enabled` / `disabled` tri-states with
  `parseInheritBoolean()` and `collectOptionalBooleanOp()`.
- **Runtime schema detection**: the UI walks the serialized Schemastery
  schema (`uid/refs`, `dict`, `inner`, union `list`) to decide which fields
  exist and which enum values are legal.

## Reasoning Level ≠ Wire Value

In `reasoningEfforts`, the left side is the DSH canonical reasoning level, and
the right side is the actual effort value sent to the upstream API:

```text
off / minimal / low / medium / high / xhigh / max
```

A normal generic Custom mapping keeps canonical identity:

```yaml
reasoningEfforts:
  high: high
  xhigh: xhigh
  max: max
```

A gateway may spell the same canonical level differently, for example:

```yaml
reasoningEfforts:
  high: high
  max: xhigh
```

This plugin keeps the saved right-side wire values across unrelated edits.
Inherit mode does not fabricate a mapping from the catalog; the Custom UI
shows and edits each canonical level's wire value explicitly.

For OpenAI Responses, pi-ai converts the configured wire value through its
`thinkingLevelMap` into the request body:

```json
{
  "reasoning": {
    "effort": "<wire value>"
  }
}
```

## Three-layer responsibility

```text
dsh-mode-control
→ UI / Settings / capability declaration

dsh-llm-pi-ai
→ compat schema / resolver

pi-ai
→ thinking.type = "adaptive"
→ output_config.effort
→ HTTP request
```

`dsh-mode-control` itself does **not** send Anthropic Messages requests.

## Scope and constraints

The plugin writes only these namespaces:

- `llm-pi-ai` — provider/model capabilities and `compat`.
- `dsh-mode-control.subagent` — auditable bridge surface for legacy
  `agentOptions` and the native tool-instance toggle.
- `subagent-model-selection` — official native allowed-model list, when the
  namespace exists.

It never:

- replaces a whole `compat` object
- replaces a whole `modelOverrides.<model>` object
- string-edits `cordis.yml`
- patches `node_modules`
- implements a second LLM provider
- wraps `PiAiAdapter` or monkey-patches `fetch`

## Anthropic Adaptive Thinking

Provider Defaults includes an **Anthropic Reasoning Effort** tri-state
dropdown:

- `inherit` — no `forceAdaptiveThinking` field is written; existing field is
  removed if present.
- `enabled` — writes `providers.<id>.compat.forceAdaptiveThinking: true`.
- `disabled` — writes `providers.<id>.compat.forceAdaptiveThinking: false`.

`inherit` is **not** the same as `disabled`. The plugin does not maintain a
second current-reasoning state: it continues to use DSH's native
`GenerateOptions.reasoningEffort ?? profile.reasoning` mechanism.

When the UI auto-generates `reasoningEfforts` for an Anthropic Messages
provider, it uses the minimal mapping:

```text
minimal → low
low     → low
medium  → medium
high    → high
xhigh   → xhigh
max     → max
```

It never auto-generates `minimal: minimal` for Anthropic Adaptive Thinking.

## Persistence

Saves use the DSH Settings API with precise path ops:

```ts
api.settings.mutate({ ns: 'llm-pi-ai', ops, expectedRevision })
```

Compat tri-state example:

```ts
{ op: 'set', path: ['providers', provider, 'compat', 'supportsStore'], value: true }
// inherit (only when the field exists)
{ op: 'unset', path: ['providers', provider, 'compat', 'supportsStore'] }
```

The plugin never sets `providers.<id>.compat` or `modelOverrides.<model>` as
a whole object.

## modelOverrides safety

For catalog routes the plugin writes only:

```text
modelOverrides.<model>.input
modelOverrides.<model>.reasoningEfforts
modelOverrides.<model>.contextWindow
modelOverrides.<model>.maxTokens
modelOverrides.<model>.compat.<field>
```

It never sets or unsets the whole `modelOverrides.<model>` object. Unknown
fields survive unchanged.

## Compat metadata registry

`src/client/compat-fields.ts` defines:

- `CompatFieldDefinition` — `key`, `kind` (`boolean|enum|json`), `group`
  (`common|openai|anthropic|advanced`), `protocols`, label/description keys.
- `isCompatFieldApplicable(field, protocols)` — protocol filtering.
- Existing-value escape hatch — a configured field stays visible and editable
  even when protocol detection says the current protocol does not use it.

The UI renders these fields from metadata in both Provider and Model cards, so
there is no per-field JSX duplication. `chatTemplateKwargs` /
`chatTemplateArgs` are JSON textareas; `maxTokensField` / `thinkingFormat`
are enums sourced from the runtime schema.

## Subagent model control

The subagent card appears whenever the canonical `tool-subagent` entry is
detected. The version is advisory: unverified or older versions stay visible
with a warning while the writable controls remain schema-driven.

- **Legacy Static** (`agentOptions`): provider / model / maxTokens, plus
  `reasoningEffort` when the runtime `agentOptions` schema supports it.
  `Inherit` removes the managed `agentOptions` entirely.
- **Native Selection** (official `subagent-model-selection`):
  - `enabled` toggle.
  - allowed-model pool picker with duplicate / empty validation.
  - writes `enabled` and `allowedModels` through the official namespace.
- The tool-instance toggle (`modelSelectionSettings`) is applied through the
  plugin's own namespace and forwarded to the tool-subagent loader entry via
  the official `Entry.update()` API. Unknown `agentOptions` fields survive.

Allowed-model validation:

- `enabled: true` with an empty pool is rejected.
- duplicate `provider/model` routes are rejected.
- incomplete routes (empty provider or model) are rejected.

## Runtime schema detection

The client resolves the serialized Schemastery envelope and produces:

```ts
interface RuntimeCapabilities {
  compatFields: Set<string>
  providerFields: Set<string>
  modelFields: Set<string>
  subagent: SubagentRuntimeCapabilities
}
```

Provider/model fields (`defaultContextWindow`, `contextWindow`, `maxTokens`,
…) are only rendered when the runtime schema declares them, so the UI stays
compatible with older and future DSH schemas.

## Runtime boundaries

The plugin does **not**:

- modify `node_modules` at runtime
- auto-apply adapter patches at startup
- monkey-patch `globalThis.fetch`
- intercept HTTP requests
- wrap or replace `PiAiAdapter`
- implement its own Anthropic provider
- construct `/v1/messages` requests
- keep a second current-reasoning state

## i18n

The page follows the DSH locale service:

- `zh` → 模型能力
- `en` → Model Capabilities

No separate i18n framework is used.

## Build

```bash
npm install
npm run build
npm run build:client
```

## Tests

```bash
npm test
```

Pure logic modules are unit-tested: semver parsing, subagent capability
detection, compat metadata, compat state/merge, provider/model ops, subagent
drafts, and runtime schema introspection.

## Install

Add the plugin to the Harness profile and mount it as a normal DSH plugin.
The client half registers a **Model Capabilities** section in Settings.

The Model Capabilities settings UI follows DSH's selector-first interaction model.
Model catalogs and subagent model pools are opened on demand through
provider-grouped searchable pickers instead of permanent lists. Settings use
compact rows and progressive disclosure so advanced compatibility, JSON, wire
values, and thinking budgets appear only when opened.

模型能力设置界面遵循 DSH 的 selector-first 交互模型。模型目录和子代理模型池
通过按提供方分组、支持搜索的选择器按需打开，而不是永久展示列表；高级兼容性、
JSON、wire values 与推理预算使用渐进式折叠，页面默认保持紧凑。
