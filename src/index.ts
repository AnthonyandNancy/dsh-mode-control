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

import {
  CapabilityValidationError,
  compileCapabilities,
  toReasoningEfforts,
  validateCapabilities,
} from './compile.ts'

export * from './types.ts'
export {
  CapabilityValidationError,
  compileCapabilities,
  toReasoningEfforts,
  validateCapabilities,
}

export const name = '@deepseek-ai/dsh-llm-pi-ai-capabilities'

/** Host plugin body; the runtime effect is delivered through the client settings page. */
export function apply(_ctx: any): void {
  // Intentionally empty: the host half owns no runtime state and touches no
  // settings namespace. Every writable surface is delivered by the client
  // settings editor through the native DSH settings API.
}

export default { name, apply }
