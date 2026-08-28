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
import { registerSubagentSettings } from './subagent/config-service.ts'

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
  // The subagent model control service registers its auditable settings
  // namespace only when the version gate passes. It uses the official loader
  // Entry.update() API, never direct file/JS surgery.
  void registerSubagentSettings(_ctx).catch((error: unknown) => {
    _ctx.logger?.warn?.('[dsh-mode-control] subagent settings registration failed: %s', String(error))
  })
}

export default { name, apply }
