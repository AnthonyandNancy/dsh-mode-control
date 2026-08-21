# @deepseek-ai/dsh-llm-pi-ai-capabilities

Model capability editor for `llm-pi-ai`: configure input modalities, reasoning
efforts, and Anthropic Adaptive Thinking per provider/model.

This plugin is **not** a second LLM provider and does **not** replace
`PiAiAdapter`. It is a settings/UI bridge over the native `llm-pi-ai`
capability vocabulary. It never sends Anthropic requests itself; the request
path stays entirely inside `dsh-llm-pi-ai` + `pi-ai`.

## Version support matrix

| dsh-llm-pi-ai | Mode                   | Adaptive Thinking | Adapter Patch    |
| ------------- | ---------------------- | ----------------- | ---------------- |
| `0.1.0-rc.6`  | Legacy Compatibility   | Patched support   | rc.6 patch       |
| `0.1.0-rc.7`  | Legacy Compatibility   | Patched support   | rc.7 patch       |
| `0.1.0-rc.8`  | Native Mode            | Native support    | Forbidden        |
| `> rc.8`      | Native / Unverified    | Schema-dependent  | Never auto-apply |

The UI detects the running mode from `api.host.describe().version` and falls
back to the `llm-pi-ai` settings schema (`forceAdaptiveThinking` presence =
rc.8 native).

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
Inherit mode does not fabricate a mapping from the catalog; the Custom UI shows
and edits each canonical level's wire value explicitly.

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

## Scope

This version manages one Anthropic compat switch in the UI:
`compat.forceAdaptiveThinking`.

Other rc.8 compat fields (`supportsTemperature`, `supportsStrictTools`,
`supportsLongCacheRetention`, ...) are intentionally **not** exposed as
individual switches. They are preserved byte-for-byte by precise path
mutations; the UI never replaces a whole `compat` object.

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

```text
api.settings.mutate({
  ns: "llm-pi-ai",
  ops,
  expectedRevision,
})
```

Enabled:

```ts
{ op: 'set', path: ['providers', provider, 'compat', 'forceAdaptiveThinking'], value: true }
```

Disabled:

```ts
{ op: 'set', path: ['providers', provider, 'compat', 'forceAdaptiveThinking'], value: false }
```

Inherit (only when the field exists):

```ts
{ op: 'unset', path: ['providers', provider, 'compat', 'forceAdaptiveThinking'] }
```

The plugin never sets `providers.<id>.compat` as a whole object.

## modelOverrides safety

The existing whole-override replacement bug is fixed. For catalog routes the
plugin writes only:

```text
modelOverrides.<model>.input
modelOverrides.<model>.reasoningEfforts
```

It never sets or unsets the whole `modelOverrides.<model>` object. Unknown
fields (`contextWindow`, `maxTokens`, `compat`, ...) survive unchanged.

## Adapter patches

Legacy rc.6 / rc.7 need a version-specific adapter patch to teach the Harness
adapter about `forceAdaptiveThinking`.

```text
patches/
└─ dsh-llm-pi-ai/
   ├─ 0.1.0-rc.6/
   │  ├─ README.md
   │  ├─ manifest.json
   │  ├─ adapter.patch
   │  └─ verify.mjs
   └─ 0.1.0-rc.7/
      ├─ README.md
      ├─ manifest.json
      ├─ adapter.patch
      └─ verify.mjs
```

There is **no** `0.1.0-rc.8/adapter.patch`: rc.8 is Native Mode.

Installing this plugin is **not** the same as applying an adapter patch.
Patches are applied explicitly by the Harness install / deploy flow. The
plugin never modifies `node_modules`, never monkey-patches `fetch`, and never
wraps or replaces `PiAiAdapter`.

Verify a patch against its real npm tarball:

```bash
node patches/dsh-llm-pi-ai/0.1.0-rc.6/verify.mjs
node patches/dsh-llm-pi-ai/0.1.0-rc.7/verify.mjs
```

The verifier fails closed on version mismatch and rejects rc.8.

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

- `zh` → 模型能力增强
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

## Install

Add the plugin to the Harness profile and mount it as a normal DSH plugin.
The client half registers a **Model Capabilities** section in Settings.
