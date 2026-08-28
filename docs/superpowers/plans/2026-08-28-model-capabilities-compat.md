# Model Capabilities and Compat Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a schema-driven, metadata-driven DSH `llm-pi-ai` capability editor with safe Provider and Model Compat mutations, complete current-schema fields, reasoning/capacity controls, i18n, tests, and documentation.

**Architecture:** Keep the pure host compiler and React-free client operations separate from the UI. Add one Compat metadata registry and one serialized Schemastery schema resolver; make Provider and Model UI render both from those shared definitions. All writes use precise leaf path operations, while declared model arrays clone complete entries and merge only owned keys.

**Tech Stack:** TypeScript 5.9, Vitest 3, React 18 externalized through DSH, tsdown, DSH Settings API, serialized Schemastery schema graphs, existing semantic CSS tokens.

## Global Constraints

- Do not implement an LLM Provider.
- Do not intercept HTTP requests or monkey-patch `fetch`.
- Do not replace or wrap `PiAiAdapter`.
- Native fields are written only through the `llm-pi-ai` Settings namespace.
- Never replace `providers.<provider>.compat` as a whole object.
- Never replace `providers.<provider>.modelOverrides.<model>` as a whole object.
- Use precise path mutations for `modelOverrides`.
- Clone complete `models[]` entries and retain unknown fields.
- `inherit`/`automatic` unsets the exact field; it never writes a fabricated default.
- Protocol applicability uses resolved catalog metadata, explicit `api`, resolved model `api`, and existing values only for cleanup visibility; never infer from Provider names.
- Current runtime Schema is authoritative; unsupported new fields are not written, and existing unsupported fields remain removable.
- Do not add Tailwind, Element Plus, MUI, Monaco, or another component library.
- Preserve bilingual `zh`/`en` locale registration and the existing Settings section.
- Preserve 720px layout, DSH semantic tokens, current input/reasoning/wire behavior, and rc.6/rc.7 legacy Adaptive Thinking behavior.

---

### Task 1: Extend authoring types and compile-layer compat vocabulary

**Files:**
- Modify: `src/types.ts`
- Modify: `src/compile.ts`
- Test: `tests/compile.spec.ts`

**Interfaces:**
- Produce `InheritBooleanMode`, typed `CompatCapabilityAuthoring`, provider capacity/thinking budget fields, and model capacity fields.
- Preserve backward-compatible `reasoning.compat` merging, with top-level `ModelCapabilityAuthoring.compat` winning per key.
- Keep compiled compat values as persisted booleans, enum strings, or JSON records; do not use `any` for compat authoring.

- [ ] **Step 1: Write failing compile tests** covering all current compat keys, provider `defaultContextWindow`, `defaultMaxTokens`, `thinkingBudgets`, model `contextWindow`, `maxTokens`, top-level/model compat precedence, and preservation of unknown typed compat keys.
- [ ] **Step 2: Run `npm test -- tests/compile.spec.ts` and confirm failure is caused by missing fields/types or incorrect compile output.
- [ ] **Step 3: Add the shared `InheritBooleanMode` type and explicit compat field types in `src/types.ts`; add provider/model capacity fields and compiled output fields.
- [ ] **Step 4: Update `compile.ts` validation and `compileCapabilities()` to copy capacity values, validate positive integer capacities and budget numbers, and merge compat one key at a time without synthesizing absent fields.
- [ ] **Step 5: Run `npm test -- tests/compile.spec.ts` and then `npm run typecheck`; expected compile tests pass and typecheck exits 0.
- [ ] **Step 6: Commit with `git add src/types.ts src/compile.ts tests/compile.spec.ts && git commit -m "feat: extend capability authoring types"`.

### Task 2: Add Compat metadata registry and schema capability resolver

**Files:**
- Create: `src/client/compat-fields.ts`
- Create: `src/client/compat-state.ts`
- Test: `tests/compat-state.spec.ts`

**Interfaces:**
- `CompatFieldDefinition` includes `key`, `kind`, `group`, `protocols`, `labelKey`, `descriptionKey`, `advanced?`, and special semantic kind where needed.
- Export `COMPAT_FIELD_DEFINITIONS` for all 20 current runtime fields plus future-known `chatTemplateArgs` metadata gated by schema presence.
- Export `isCompatFieldApplicable(field, protocols)` and grouping helpers.
- Export `RuntimeCapabilities`, `detectRuntimeCapabilities(schema)`, `schemaEnumValues(capabilities, field)`, `isRuntimeFieldSupported(capabilities, scope, key)`, and a JSON-shape validator based on schema nodes.

- [ ] **Step 1: Write failing tests for the 20 current field definitions, protocol applicability across OpenAI Completions, Responses, Azure Responses, Codex Responses, Anthropic Messages, and Bedrock Converse Stream, and future field gating.
- [ ] **Step 2: Write a serialized schema fixture matching the live `llm-pi-ai` graph: root `providers` dict, provider dict, provider `compat`, model entry, model override, enum references, and `chatTemplateKwargs` dict. Run `npm test -- tests/compat-state.spec.ts` and confirm failure.
- [ ] **Step 3: Implement the registry with no JSX or hardcoded field checks in render code. Define exact protocol arrays: developer role on four OpenAI protocols, strict mode on four OpenAI protocols plus Bedrock, long cache on four OpenAI protocols plus Anthropic, OpenAI-specific fields on `openai-completions`, and Anthropic fields on `anthropic-messages`.
- [ ] **Step 4: Implement schema graph traversal through `dict` references using a probe provider shape and collect only actual `compat`, provider, and model keys. Extract union `const.value` values recursively for enums.
- [ ] **Step 5: Implement schema-aware JSON validation: accept only object-shaped values permitted by the node; reject arrays and scalar JSON for dictionary compat fields.
- [ ] **Step 6: Run the focused tests and `npm run typecheck`; expected PASS and exit 0. Commit `src/client/compat-fields.ts src/client/compat-state.ts tests/compat-state.spec.ts`.

### Task 3: Refactor pure client operations and precise mutation helpers

**Files:**
- Modify: `src/client/ops.ts`
- Test: `tests/ops.spec.ts`

**Interfaces:**
- Export `parseInheritBoolean(value): InheritBooleanMode`.
- Export `collectOptionalBooleanOp(path, current, mode)`, `collectOptionalScalarOp(path, current, value)`, `collectOptionalJsonOp(path, current, value)`, and `collectCompatOps(basePath, currentCompat, draftCompat, capabilities, protocols?)`.
- Extend `ProviderDraft` with `defaultContextWindow`, `defaultMaxTokens`, `thinkingBudgets`, and Compat draft state.
- Extend `ModelDraft` with `contextWindow`, `maxTokens`, and Compat draft state.
- Retain existing exports and behavior for reasoning wire mapping, `parseModelDraft`, `parseProviderDraft`, `collectOpsForProvider`, `collectOpsForModels`, and Adaptive Thinking compatibility.

- [ ] **Step 1: Add failing tests for `undefined → inherit`, `true → enabled`, `false → disabled`; inherit with absent/present current field; enabled and disabled set operations; scalar blank unset; JSON blank unset; valid object set; invalid/array/string rejection; and no whole-object path.
- [ ] **Step 2: Add failing tests for Provider compat and model override paths, models[] clone/merge behavior, capacity blank/set behavior, and unknown fields surviving a model compat edit.
- [ ] **Step 3: Run `npm test -- tests/ops.spec.ts` and verify the new tests fail for missing helpers/fields.
- [ ] **Step 4: Implement generic helpers with exact leaf paths and schema support checks; do not create field-specific boolean mutation functions.
- [ ] **Step 5: Update parsing to preserve unknown compat fields for display/cleanup, parse typed budgets/capacities without treating placeholders as values, and keep existing wire values.
- [ ] **Step 6: Update `collectOpsForProvider()` to emit precise defaults, budgets, and compat operations; update `collectOpsForModels()` to emit precise override paths and clone `models[]` entries while merging compat keys.
- [ ] **Step 7: Run all operation tests and `npm run typecheck`; expected PASS and exit 0. Commit the pure operations changes.

### Task 4: Build reusable Compat UI controls and styling

**Files:**
- Create: `src/client/compat-ui.ts`
- Modify: `src/client/index.ts`
- Test: `tests/compat-ui.spec.ts` (pure helper portions only; no browser dependency required)

**Interfaces:**
- Export React-compatible `CompatField`, `CompatSection`, `CompatBooleanSelect`, `CompatEnumSelect`, and `JsonCompatEditor` functions/components using the existing `createElement` style and injected `t` function.
- Props include field definition, current mode/value, schema enum values, protocol set, runtime support flag, model/provider inherit label, change callback, and cleanup callback.
- UI components must use the existing custom Dropdown or a single extracted shared dropdown; no native-select/custom-dropdown mixture.

- [ ] **Step 1: Add pure validation tests for JSON editor parsing, enum option fallback, and unsupported-existing-value cleanup decision.
- [ ] **Step 2: Run the focused test and confirm failure.
- [ ] **Step 3: Extract or reuse the existing Dropdown and create the reusable field renderer. Use Auto/Developer/System for `supportsDeveloperRole`; Auto plus schema enum for `maxTokensField` and `thinkingFormat`; tri-state Auto/Enabled/Disabled for optional booleans; compact descriptions for every field.
- [ ] **Step 4: Add disclosure rendering for common, advanced, and Anthropic groups. Display an unsupported warning and only a Reset/Inheritance action when the runtime field is missing but current settings contain it.
- [ ] **Step 5: Add semantic-token CSS for disclosure rows, warnings, textarea, descriptions, disabled state, and responsive layout. Do not add literal colors or nested heavy cards.
- [ ] **Step 6: Run focused tests and `npm run typecheck`; commit reusable UI components and styles.

### Task 5: Integrate Provider defaults/reasoning/compatibility UI

**Files:**
- Modify: `src/client/index.ts`
- Modify: `src/client/ops.ts` as required by integration tests
- Test: `tests/ops.spec.ts`

**Interfaces:**
- The page loads `settings.describe()`, `llm.models()`, and optional host version; calls `detectRuntimeCapabilities(schema)` and never uses presence of `forceAdaptiveThinking` as a complete-mode signal.
- Provider UI cards are `Provider Defaults`, `Reasoning`, and `Interface Compatibility`.
- Provider fields are input, context window, max output tokens, default reasoning, thinking budgets, and registry-driven compat.

- [ ] **Step 1: Add failing operation/state tests for parsing provider capacities and budgets, resetting only plugin-owned provider values, mixed protocol Provider visibility, and existing-incompatible values remaining visible.
- [ ] **Step 2: Run `npm test -- tests/ops.spec.ts` and confirm expected failures.
- [ ] **Step 3: Wire runtime capability state into page state and drafts. Derive Provider protocol sets from catalog group/model `api` and explicit `api`; retain current field visibility for cleanup only.
- [ ] **Step 4: Render Provider Defaults with empty numeric text fields, so placeholders never save; render Thinking Budgets collapsed with minimal/low/medium/high; render Anthropic Adaptive Thinking through the generic boolean mode.
- [ ] **Step 5: Render common compat fields expanded and advanced OpenAI/Anthropic groups disclosed. Use schema enum values and show a concise applicability hint for mixed routes.
- [ ] **Step 6: Wire Provider Reset to unset only default input/context/max/reasoning/budgets and owned compat leaves; preserve credentials, URLs, headers, transport, retry, and unknown fields.
- [ ] **Step 7: Run unit tests and typecheck; commit Provider integration.

### Task 6: Integrate Model capacity and Compat Override UI safely

**Files:**
- Modify: `src/client/index.ts`
- Modify: `src/client/ops.ts`
- Test: `tests/ops.spec.ts`

**Interfaces:**
- Model detail displays Input, Context Window, Max Output Tokens, reasoning support/levels/wire values, and collapsed Model Compatibility Override.
- Model compat fields use the same registry/renderer as Provider but use `Inherit Provider` wording.
- Model reset only unsets input, capacity, reasoning efforts, and owned compat leaves; unknown model entry/override keys survive.

- [ ] **Step 1: Add failing tests for model capacity blank/valid/invalid operations, model compat tri-state, Model Override safety, declared models[] safety, and unknown future compat preservation.
- [ ] **Step 2: Run focused tests and confirm failure.
- [ ] **Step 3: Add model draft parse and update handlers for numeric text editing, schema validation, compat draft editing, and per-model applicability based on resolved model protocol.
- [ ] **Step 4: Render the collapsed Model Compatibility Override disclosure with the required inheritance explanation and cleanup escape hatch.
- [ ] **Step 5: Ensure `collectOpsForModels()` emits leaf paths for modelOverrides and one cloned models array operation preserving every unknown entry/compat field.
- [ ] **Step 6: Run all tests and typecheck; commit Model integration.

### Task 7: Complete localization, documentation, and regression coverage

**Files:**
- Modify: `src/client/index.ts`
- Modify: `README.md`
- Modify: `tests/compile.spec.ts`
- Modify: `tests/ops.spec.ts`
- Create: `tests/fixtures/live-llm-pi-ai-schema.ts` if shared fixture extraction is useful

**Interfaces:**
- Every new field and state has concise `zh` and `en` labels/descriptions.
- README describes capabilities, optional compat overrides, inheritance and precedence, schema-driven availability, legacy rc.6/rc.7 policy, and excludes unrelated Provider Editor fields.

- [ ] **Step 1: Add regression tests for existing input, reasoning, wire mapping, Adaptive Thinking, expectedRevision, and settings conflict behavior.
- [ ] **Step 2: Add protocol and existing-value escape-hatch tests for all six protocol identifiers and the three cross-protocol fields.
- [ ] **Step 3: Update both locale dictionaries with user-facing labels such as `系统提示词角色`, `Store 参数`, `Reasoning Effort 参数`, `推理协议格式`, `长缓存保留`, `Anthropic Strict Tools`, and concise descriptions; do not expose raw variable names as labels.
- [ ] **Step 4: Rewrite README Scope and version strategy sections to remove the rc.8/full-native implication and document Provider/Model precedence and unset semantics.
- [ ] **Step 5: Run `npm test`; expected all tests pass. Commit localization, README, and regression tests.

### Task 8: Build, inspect runtime UI, and final verification

**Files:**
- Modify: generated `lib/*` only through the project build scripts; do not hand-edit generated output.

- [ ] **Step 1: Run `npm test` and record the complete result.
- [ ] **Step 2: Run `npm run build` and inspect exit code and generated host declarations.
- [ ] **Step 3: Run `npm run build:client` and inspect the generated client bundle for successful completion.
- [ ] **Step 4: Check whether `pnpm run dev:web` is already running from the DSH checkout before promising HMR; do not start a replacement server.
- [ ] **Step 5: Inject/reload the built local plugin only if needed through the existing DSH plugin workflow, refresh `http://127.0.0.1:57829`, and verify the Settings section visually at desktop and narrow width. Check first-screen density, disclosure behavior, focus/disabled/error states, no literal colors, and both themes if available.
- [ ] **Step 6: Run `git diff --check`, `git status --short`, and the full test/build commands again after any visual fixes.
- [ ] **Step 7: Read the current goal with `get_goal`, verify every acceptance requirement against tests/build/UI evidence, then mark the goal complete only if all evidence is present; otherwise leave it active with the concrete remaining work.
