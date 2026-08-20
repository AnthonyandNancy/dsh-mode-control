# dsh-llm-pi-ai 0.1.0-rc.7 Adapter Patch

**Mode: Legacy Compatibility**

This patch adds the missing `forceAdaptiveThinking` configuration bridge to
`@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.7`. It is generated from the real npm
tarball and must be applied explicitly by the Harness install / deploy flow.

Installing `dsh-mode-control` alone is **not** the same as applying this
patch. The plugin never auto-applies patches and never modifies
`node_modules` at runtime.

## What it changes

- Adds `forceAdaptiveThinking?: boolean` to `PiAiCompatProfile`.
- Adds `forceAdaptiveThinking` to the compat schema (`compatProfile`).
- Extends `resolveModelCompat()` so Anthropic Messages models receive
  `compat.forceAdaptiveThinking` while OpenAI compat fields remain scoped to
  `openai-completions`.
- Splits route compat validation:
  - OpenAI compat (`thinkingFormat`, `supportsReasoningEffort`) requires at
    least one `openai-completions` model on the route.
  - Anthropic compat (`forceAdaptiveThinking`) requires at least one
    `anthropic-messages` model on the route.
- Preserves model-over-route precedence and `false`-over-`true` via `??`.

## Files

- `manifest.json` — npm package, `dist.integrity`, target file hashes, patched hashes.
- `adapter.patch` — unified diff against the published tarball.
- `verify.mjs` — fail-closed verification against the real tarball.

## Verify

```bash
node patches/dsh-llm-pi-ai/0.1.0-rc.7/verify.mjs
```

The verifier downloads the exact npm tarball, checks `dist.integrity` and
target hashes, applies the patch with `git apply`, checks the patched hashes,
and rejects rc.8 / unknown versions.

## rc.8 note

`@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.8` is **Native Mode**: it already
supports `compat.forceAdaptiveThinking` and must never receive this patch.
