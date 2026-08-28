/**
 * Generic compat draft state and precise mutation helpers.
 *
 * This module is the single place that knows how a compat field draft maps to
 * `set`/`unset` settings ops. Provider and model compat editors both consume
 * it, so a future compat field does not require a second parser/mutation
 * implementation.
 */

import { COMPAT_FIELDS, COMPAT_FIELD_BY_KEY } from './compat-fields.ts'
import type { InheritBooleanMode } from '../types.ts'

export interface SettingsOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

export type CompatDraftValue =
  | { kind: 'boolean'; mode: InheritBooleanMode }
  | { kind: 'enum'; value: string }
  | { kind: 'json'; text: string }

export type CompatDrafts = Record<string, CompatDraftValue>

/** `undefined → inherit`, `true → enabled`, `false → disabled`. */
export function parseInheritBoolean(value: unknown): InheritBooleanMode {
  if (value === true) return 'enabled'
  if (value === false) return 'disabled'
  return 'inherit'
}

/**
 * Collect the precise ops for one optional boolean:
 * - `inherit` unsets only when the field already exists (no op otherwise)
 * - `enabled` sets `true`
 * - `disabled` sets `false`
 */
export function collectOptionalBooleanOp(
  path: string[],
  fieldExists: boolean,
  mode: InheritBooleanMode,
): SettingsOp[] {
  if (mode === 'enabled') return [{ op: 'set', path, value: true }]
  if (mode === 'disabled') return [{ op: 'set', path, value: false }]
  return fieldExists ? [{ op: 'unset', path }] : []
}

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

/**
 * Parse JSON text for an object-only compat field. Empty text means inherit /
 * unset. Arrays, scalars, and `null` are rejected.
 */
export function parseJsonCompat(text: string): JsonParseResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: undefined }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'expected a JSON object' }
  }
  return { ok: true, value: parsed }
}

function jsonTextOf(value: unknown): string {
  if (value === null || typeof value !== 'object') return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function fieldKind(key: string): 'boolean' | 'enum' | 'json' {
  return COMPAT_FIELD_BY_KEY.get(key)?.kind ?? 'boolean'
}

/**
 * Parse an existing `compat` object into editable drafts.
 *
 * Unknown/future keys are intentionally not represented — the mutation layer
 * never touches them, so they survive any save. Fields with no metadata still
 * parse as booleans so the existing-value escape hatch can render them.
 */
export function parseCompatDrafts(compat: unknown): CompatDrafts {
  if (compat === null || typeof compat !== 'object' || Array.isArray(compat)) return {}
  const source = compat as Record<string, unknown>
  const drafts: CompatDrafts = {}
  // Only metadata-known fields are managed. Unknown/future keys are left out
  // of the draft so an unrelated save never touches them.
  for (const field of COMPAT_FIELDS) {
    const value = source[field.key]
    const kind = fieldKind(field.key)
    if (kind === 'boolean') {
      drafts[field.key] = { kind: 'boolean', mode: parseInheritBoolean(value) }
    } else if (kind === 'enum') {
      drafts[field.key] = { kind: 'enum', value: typeof value === 'string' ? value : '' }
    } else {
      drafts[field.key] = { kind: 'json', text: jsonTextOf(value) }
    }
  }
  return drafts
}

/**
 * Build precise `set`/`unset` ops for managed compat fields.
 *
 * Never replaces the whole `compat` object: every op addresses
 * `...basePath, fieldKey`.
 *
 * @throws when a JSON draft is invalid or not an object (local validation
 *   failure; the caller must block saving).
 */
export function collectOpsForCompat(
  basePath: string[],
  existingCompat: unknown,
  drafts: CompatDrafts,
): SettingsOp[] {
  const existing = existingCompat !== null && typeof existingCompat === 'object' && !Array.isArray(existingCompat)
    ? existingCompat as Record<string, unknown>
    : {}
  const ops: SettingsOp[] = []
  for (const [key, draft] of Object.entries(drafts)) {
    const path = [...basePath, key]
    const exists = Object.prototype.hasOwnProperty.call(existing, key)
    const current = existing[key]
    if (draft.kind === 'boolean') {
      if (draft.mode === 'enabled') {
        if (current !== true) ops.push({ op: 'set', path, value: true })
      } else if (draft.mode === 'disabled') {
        if (current !== false) ops.push({ op: 'set', path, value: false })
      } else if (exists) {
        ops.push({ op: 'unset', path })
      }
      continue
    }
    if (draft.kind === 'enum') {
      if (draft.value === '') {
        if (exists) ops.push({ op: 'unset', path })
      } else if (current !== draft.value) {
        ops.push({ op: 'set', path, value: draft.value })
      }
      continue
    }
    // json
    const result = parseJsonCompat(draft.text)
    if (!result.ok) {
      throw new Error(`${key}: ${result.error}`)
    }
    if (result.value === undefined) {
      if (exists) ops.push({ op: 'unset', path })
    } else if (JSON.stringify(current) !== JSON.stringify(result.value)) {
      ops.push({ op: 'set', path, value: result.value })
    }
  }
  return ops
}

/**
 * Apply compat drafts onto an existing compat object without ever replacing
 * unknown keys.
 *
 * Used by the `models[]` branch where the whole entry is cloned and written
 * back. `value` is `undefined` when no compat fields remain.
 */
export function mergeCompatDrafts(
  existing: unknown,
  drafts: CompatDrafts,
): { value: Record<string, unknown> | undefined; changed: boolean } {
  const merged: Record<string, unknown> = {}
  if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
    Object.assign(merged, existing as Record<string, unknown>)
  }
  let changed = false
  for (const [key, draft] of Object.entries(drafts)) {
    const exists = Object.prototype.hasOwnProperty.call(merged, key)
    if (draft.kind === 'boolean') {
      if (draft.mode === 'enabled') {
        if (merged[key] !== true) changed = true
        merged[key] = true
      } else if (draft.mode === 'disabled') {
        if (merged[key] !== false) changed = true
        merged[key] = false
      } else if (exists) {
        delete merged[key]
        changed = true
      }
      continue
    }
    if (draft.kind === 'enum') {
      if (draft.value === '') {
        if (exists) {
          delete merged[key]
          changed = true
        }
      } else if (merged[key] !== draft.value) {
        merged[key] = draft.value
        changed = true
      }
      continue
    }
    const result = parseJsonCompat(draft.text)
    if (!result.ok) throw new Error(`${key}: ${result.error}`)
    if (result.value === undefined) {
      if (exists) {
        delete merged[key]
        changed = true
      }
    } else if (JSON.stringify(merged[key]) !== JSON.stringify(result.value)) {
      merged[key] = result.value
      changed = true
    }
  }
  const value = Object.keys(merged).length > 0 ? merged : undefined
  return { value, changed }
}

export { COMPAT_FIELDS, COMPAT_FIELD_BY_KEY }
