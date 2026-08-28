# Model Capabilities and Compat Enhancement Design

## Goal

Turn `@deepseek-ai/dsh-llm-pi-ai-capabilities` into a schema-driven editor for native `llm-pi-ai` model capabilities, provider defaults, reasoning settings, and per-provider/per-model compatibility overrides without implementing a provider or replacing the native adapter.

## Current Runtime Findings

The running DSH instance was queried through `api.settings.describe()` at `http://127.0.0.1:57829/api/settings.describe`. The current `llm-pi-ai` namespace reports a live schema with:

- Provider fields: `defaultInput`, `defaultContextWindow`, `defaultMaxTokens`, `reasoning`, `thinkingBudgets`, `compat`, and the existing native fields.
- Model entry and model override fields: `input`, `contextWindow`, `maxTokens`, `reasoningEfforts`, and `compat`.
- Current exposed protocols: `openai-completions`, `openai-responses`, and `anthropic-messages`.
- Current compat fields: `supportsStore`, `supportsDeveloperRole`, `supportsReasoningEffort`, `supportsUsageInStreaming`, `maxTokensField`, `requiresToolResultName`, `requiresAssistantAfterToolResult`, `requiresThinkingAsText`, `requiresReasoningContentOnAssistantMessages`, `thinkingFormat`, `chatTemplateKwargs`, `supportsStrictMode`, `cacheControlFormat`, `supportsLongCacheRetention`, `supportsEagerToolInputStreaming`, `supportsCacheControlOnTools`, `supportsTemperature`, `forceAdaptiveThinking`, `allowEmptySignature`, and `supportsStrictTools`.
- `thinkingFormat`, `maxTokensField`, and `cacheControlFormat` are unions whose legal values must be read from the serialized schema.
- `chatTemplateKwargs` is a schema-defined dictionary. The editor validates object JSON locally and only writes values accepted by the runtime schema.
- `chatTemplateArgs` is not present in the current runtime schema and is not written. Future support is schema-gated.

The request's label of “23 fields” does not match either the listed field count or the current runtime schema. Runtime capabilities are authoritative.

## Architecture

### Metadata registry

Add `src/client/compat-fields.ts` with a `CompatFieldDefinition` registry. Each definition contains the settings key, editor kind (`boolean`, `enum`, or `json`), group, supported protocol identifiers, i18n label and description keys, and optional special renderer information. The registry is the source for Provider and Model compat rendering, protocol filtering, grouping, and field ownership.

The common registry includes all fields known to the current upstream/runtime schema. It may include future-known metadata such as `chatTemplateArgs`, but a field is editable only when runtime capability detection confirms that its schema node exists.

Expose one applicability helper:

```ts
isCompatFieldApplicable(field: CompatFieldDefinition, protocols: readonly string[]): boolean
```

Provider protocol sets are derived from resolved catalog metadata, explicit provider `api`, resolved model metadata, and existing values only for the cleanup escape hatch. Provider names never imply protocol.

### Runtime schema capabilities

Add `src/client/compat-state.ts` with pure functions that inspect the serialized Schemastery schema graph returned by `settings.describe()`.

```ts
interface RuntimeCapabilities {
  compatFields: Set<string>
  providerFields: Set<string>
  modelFields: Set<string>
  compatNodes: Record<string, RuntimeSchemaNode>
  providerNodes: Record<string, RuntimeSchemaNode>
  modelNodes: Record<string, RuntimeSchemaNode>
}
```

The resolver follows object `dict` references from the root `providers` node into a probe provider, then into its `compat`, model entry, and model override nodes. It extracts union values for enum controls and preserves enough node metadata to determine whether a value is writable. Missing nodes disable new writes rather than guessing a version. Existing values from unsupported schema fields remain visible as disabled cleanup rows.

### Drafts and mutation

Extend the authoring types in `src/types.ts` with:

```ts
export type InheritBooleanMode = 'inherit' | 'enabled' | 'disabled'
```

`forceAdaptiveThinking` uses this generic authoring mode at the UI layer; persisted compat values remain booleans. Compat authoring supports typed optional booleans, enum strings, and JSON records. Provider defaults add context window, maximum output tokens, and thinking budgets. Model drafts add context window, maximum output tokens, and a compat draft.

Keep `src/client/ops.ts` React-free. Add generic mutation helpers:

- `parseInheritBoolean(value)`
- `collectOptionalBooleanOp(path, current, mode)`
- `collectOptionalScalarOp(path, current, value)`
- `collectOptionalJsonOp(path, current, value)`
- `collectCompatOps(basePath, currentCompat, draftCompat, capabilities)`

All helpers emit field-level `set`/`unset` operations. They never replace a compat object or a model override object. Inherit unsets only when the current exact field exists.

For `models[]`, clone every current entry and its compat object, then update only plugin-owned fields. Unknown entry fields and unknown compat keys survive. For `modelOverrides`, emit exact field paths and never unset or set the whole model key.

JSON editors accept blank as inherit, a valid object as a set value, and reject invalid JSON, arrays, and scalar JSON values before save.

### UI composition

Add `src/client/compat-ui.ts` with reusable React-compatible functions/components:

- Boolean tri-state dropdown
- Developer/System semantic dropdown
- Schema-driven enum dropdown
- JSON textarea editor with local validation
- Compat field row with description, source/unsupported warning, and cleanup action
- Compat section with common fields and disclosure groups

Keep `src/client/index.ts` as the page coordinator: loading settings/catalog/host data, holding drafts, selecting Provider/Model, composing sections, and calling mutation. Move field metadata, state parsing, and compat controls out of the page file.

The Provider page contains:

1. Provider selector.
2. `Provider Defaults` card: input modalities, default context window, default max output tokens.
3. `Reasoning` card: default reasoning, collapsed thinking budgets (`minimal`, `low`, `medium`, `high`), and Anthropic adaptive thinking where applicable.
4. `Interface Compatibility` card: common fields expanded; advanced OpenAI fields and Anthropic fields disclosed by default.
5. Model search/list/detail.
6. Page-level reset/save actions.

The Model detail contains basic input/capacity controls, existing reasoning controls and wire mapping, and a collapsed `Model Compatibility Override` section. Internal copy explains that unset model fields inherit Provider or pi-ai detection.

`supportsDeveloperRole` maps to Auto / Developer / System (`unset`, `true`, `false`). `maxTokensField` maps to Auto / schema enum values. Other enum options come from the runtime schema. Anthropic visibility uses protocol metadata, but any existing value keeps the field visible for reset.

### Styling and localization

Preserve the existing 720px layout, 12px cards, 36px controls, 10px input radius, and DSH semantic tokens. Use disclosure rows rather than nested heavy cards. Do not add a CSS/component library or literal colors. Add Chinese and English labels/descriptions for every new field and state.

### Persistence and errors

Save Provider and selected Model drafts in one `settings.mutate` call with the currently loaded `expectedRevision`. A conflict remains visible and does not silently overwrite remote settings. After success, reload from `settings.describe()` so the UI reflects the host's accepted value.

Unsupported runtime fields are never included in set operations. Existing unsupported fields get an informational disabled row and a precise unset operation. Reset clears only plugin-owned fields and preserves provider credentials, transport, retry, headers, model names, and future fields.

## Testing Strategy

Add pure unit coverage for:

- Boolean parsing and all inherit/set/unset branches.
- Scalar and JSON mutation validation.
- Runtime schema capability extraction and schema enum extraction.
- Protocol applicability for OpenAI Completions, OpenAI Responses, Azure Responses, Codex Responses, Anthropic Messages, and Bedrock Converse Stream metadata.
- Mixed-route Provider visibility and existing-value escape hatch.
- Compat unknown-key preservation at Provider, model override, and declared `models[]` entry levels.
- Context/max token blank, valid, invalid, and placeholder behavior.
- Compat precedence and compile-layer field-by-field merge.
- Existing input, reasoning efforts, wire mapping, and Adaptive Thinking regressions.

Run `npm test`, `npm run build`, and `npm run build:client` before completion. If the web watcher is available, verify the injected Settings section at the existing DSH URL after rebuild; do not start a replacement server.

## Scope Boundaries

The plugin remains a settings/UI bridge. It does not implement an LLM provider, intercept requests, patch `fetch`, wrap `PiAiAdapter`, edit unrelated DSH settings, or add a legacy adapter patch for newly exposed compat fields. rc.6/rc.7 Adaptive Thinking behavior remains unchanged and new controls are enabled only when the native settings schema exposes the relevant field.
