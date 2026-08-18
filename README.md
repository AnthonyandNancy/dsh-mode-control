# @deepseek-ai/dsh-llm-pi-ai-capabilities

Model capability editor for `llm-pi-ai`: configure input modalities and
reasoning efforts per provider/model.

This plugin is **not** a second LLM provider and does **not** replace
`PiAiAdapter`. It is a settings/UI bridge over the native `llm-pi-ai`
capability vocabulary.

## Scope

This version only uses capabilities that the installed `llm-pi-ai` schema and
runtime already support:

- Model `input`: `text`, `image`
- Model `reasoningEfforts`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`
- Provider `defaultInput`
- Provider `reasoning` (single default reasoning effort)

The following are intentionally **not** implemented because `llm-pi-ai` does
not support them yet:

- Custom input modalities (`audio`, `video`, `document`, `file`)
- Custom reasoning efforts (`ultra`, `deep`, ...)
- Provider-level reasoning effort sets
- Per-model default reasoning effort
- Wire value editing UI

## Data source

The page reads providers from the `llm-pi-ai` settings namespace:

```text
settings.describe
  → llm-pi-ai
  → value.providers
```

The model list is scoped to the selected provider:

```text
providers[provider].models          → configured model ids
providers[provider].modelOverrides  → override keys
api.llm.models groups[provider]     → catalog fallback for catalog routes
```

It never merges the global model catalog into every provider.

## Persistence

The page saves through the DSH Settings API:

```text
api.settings.mutate({
  ns: "llm-pi-ai",
  ops,
  expectedRevision,
})
```

The plugin never reads or writes `settings.yaml` directly.

## i18n

The page follows the DSH locale service:

- `zh` → 模型能力增强
- `en` → Model Capabilities

No separate i18n framework is used.

## Build

```bash
npm install
npx tsc -p tsconfig.json     # host lib
npm run build:client         # client bundle (lib/client.js)
```

## Install

Add the plugin to the Harness profile and mount it as a normal DSH plugin.
The client half registers a **Model Capabilities** section in Settings.

## Tests

```bash
npm test
```
