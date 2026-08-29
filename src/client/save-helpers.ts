import { collectOpsForModels, collectOpsForProvider, isAnthropicModel, type ModelDraft, type ProviderDraft } from './ops.ts'

function compatFieldsFor(dirtyFields?: ReadonlySet<string>): ReadonlySet<string> | undefined {
  if (dirtyFields === undefined || dirtyFields.has('compat')) return undefined
  const fields = new Set<string>()
  for (const field of dirtyFields) if (field.startsWith('compat:')) fields.add(field.slice('compat:'.length))
  return fields
}

/**
 * Restrict provider compat writes to fields the runtime schema declares.
 * Inherit/empty drafts are still allowed so existing unsupported values can be
 * cleared with exact `unset` ops.
 */
function providerCompatAllowedFields(
  dirtyFields: ReadonlySet<string> | undefined,
  runtimeProviderCompatFields: ReadonlySet<string> | undefined,
): ReadonlySet<string> | undefined {
  const dirty = compatFieldsFor(dirtyFields)
  if (runtimeProviderCompatFields === undefined) return dirty
  if (dirty === undefined) return runtimeProviderCompatFields
  return new Set([...dirty].filter(field => runtimeProviderCompatFields.has(field)))
}

/** Collect one native llm-pi-ai mutation batch for all dirty providers. */
export function collectOpsForAllProviders(
  providerNames: string[],
  providers: Record<string, unknown>,
  providerDrafts: Record<string, ProviderDraft>,
  modelDrafts: Record<string, Record<string, ModelDraft>>,
  dirtyProviders: ReadonlySet<string> = new Set(providerNames),
  catalogGroups: unknown[] = [],
  modelCompatFields?: ReadonlySet<string>,
  dirtyProviderFields?: ReadonlyMap<string, ReadonlySet<string>>,
  dirtyModelFields?: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>,
  providerCompatFields?: ReadonlySet<string>,
): ReturnType<typeof collectOpsForProvider> {
  const ops: ReturnType<typeof collectOpsForProvider> = []
  for (const provider of providerNames) {
    if (!dirtyProviders.has(provider)) continue
    const providerConfig = providers[provider]
    const providerDraft = providerDrafts[provider]
    if (!providerDraft) continue
    const providerFields = dirtyProviderFields === undefined ? undefined : (dirtyProviderFields.get(provider) ?? new Set<string>())
    const modelFields = dirtyModelFields === undefined ? undefined : (dirtyModelFields.get(provider) ?? new Map<string, ReadonlySet<string>>())
    ops.push(...collectOpsForProvider(provider, providerConfig, providerDraft, providerFields, providerCompatAllowedFields(providerFields, providerCompatFields)))
    ops.push(...collectOpsForModels(
      provider,
      providerConfig,
      modelDrafts[provider] ?? {},
      (model: string) => isAnthropicModel(provider, model, providerConfig, catalogGroups),
      modelCompatFields,
      modelFields,
    ))
  }
  return ops
}
