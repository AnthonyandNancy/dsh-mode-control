/**
 * Ambient declaration for the optional runtime module `@deepseek-ai/dsh-tool-subagent`.
 *
 * The plugin does not declare a hard dependency on this package: it may or may
 * not be present in the composed host, and capability detection is exactly
 * what decides whether the subagent UI appears. The declaration only keeps
 * TypeScript happy for the dynamic import.
 */
declare module '@deepseek-ai/dsh-tool-subagent' {
  export const Config: any
  export const name: string
  export function apply(ctx: any, config?: any): void
}
