/**
 * @deepseek-ai/dsh-llm-pi-ai-capabilities
 *
 * Host entry.
 *
 * The plugin is primarily a settings/UI bridge over the native llm-pi-ai
 * capability vocabulary. It does not register a second LLM adapter and does
 * not replace PiAiAdapter.
 *
 * The host half is intentionally side-effect free at runtime: the useful
 * surface is the pure compiler/validator exported here plus the client
 * settings editor. This keeps "no configuration = no behavioral change".
 */

import z from 'schemastery'
import {
  CapabilityValidationError,
  compileCapabilities,
  toReasoningEfforts,
  validateCapabilities,
} from './compile.ts'
import { startSubagentSettingsRegistration } from './subagent/config-service.ts'
import { startDynamicSubagentRegistration } from './subagent/registration.ts'
import type { SubAgentModelPolicy } from './subagent/modelResolver.ts'

export const Config = z.object({
  subAgentModelPolicy: z.dict(z.dict(z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  }))).default({}),
})

export type DshModeControlConfig = {
  subAgentModelPolicy?: SubAgentModelPolicy
}

export * from './types.ts'
export {
  CapabilityValidationError,
  compileCapabilities,
  toReasoningEfforts,
  validateCapabilities,
}

export const name = '@deepseek-ai/dsh-llm-pi-ai-capabilities'
export const inject = ['subagents', 'loader']

/** Host plugin body; the runtime effect is delivered through the client settings page. */
export function apply(ctx: any, config?: DshModeControlConfig): void {
  const runtimeCtx = ctx
  runtimeCtx.subagents ??= ctx.inject?.subagents
  runtimeCtx.loader ??= ctx.inject?.loader
  // The subagent model control service registers its auditable settings
  // namespace only when the version gate passes. It uses the official loader
  // Entry.update() API, never direct file/JS surgery. Registration is
  // lifecycle-aware: it retries when the tool-subagent loader entry appears
  // later, and stays idempotent.
  startSubagentSettingsRegistration(runtimeCtx)
  if (Object.keys(config?.subAgentModelPolicy ?? {}).length > 0) {
    startDynamicSubagentRegistration(runtimeCtx, config?.subAgentModelPolicy ?? {})
  }
}

export default { name, apply }
