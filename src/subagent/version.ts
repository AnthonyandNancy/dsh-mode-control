/**
 * Minimal semver handling for the subagent version gate.
 *
 * Only the comparison shape DSH needs is implemented (major.minor.patch with
 * an optional prerelease). It intentionally avoids pulling in a full semver
 * dependency; the rules follow https://semver.org precedence.
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Dot-separated prerelease identifiers (e.g. `['rc', '2']`). */
  prerelease: string[]
}

const PRERELEASE_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Parse a semver string; returns `undefined` when unparseable. */
export function parseVersion(version: string | undefined): ParsedVersion | undefined {
  if (typeof version !== 'string') return undefined
  const match = PRERELEASE_PATTERN.exec(version.trim())
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdentifier(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined
  if (leftNumber !== undefined && rightNumber !== undefined) {
    return leftNumber - rightNumber
  }
  if (leftNumber !== undefined) return -1 // numeric identifiers sort lower
  if (rightNumber !== undefined) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function comparePrerelease(left: string[], right: string[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) return -1 // a larger set of fields wins
    if (rightPart === undefined) return 1
    const result = compareIdentifier(leftPart, rightPart)
    if (result !== 0) return result
  }
  return 0
}

/** Compare two semver strings: negative when `left < right`, zero, or positive. */
export function compareSemver(left: string | undefined, right: string | undefined): number {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)
  if (parsedLeft === undefined || parsedRight === undefined) {
    throw new Error(`compareSemver: cannot compare "${String(left)}" and "${String(right)}"`)
  }
  if (parsedLeft.major !== parsedRight.major) return parsedLeft.major - parsedRight.major
  if (parsedLeft.minor !== parsedRight.minor) return parsedLeft.minor - parsedRight.minor
  if (parsedLeft.patch !== parsedRight.patch) return parsedLeft.patch - parsedRight.patch
  if (parsedLeft.prerelease.length === 0 && parsedRight.prerelease.length === 0) return 0
  if (parsedLeft.prerelease.length === 0) return 1 // release > prerelease
  if (parsedRight.prerelease.length === 0) return -1
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
}

/** Minimum subagent version that may expose the subagent settings UI. */
export const SUBAGENT_VISIBLE_MIN = '0.1.1-rc.2'

/** Version gate: only `>= 0.1.1-rc.2` may show the subagent settings card. */
export function isSubagentVisible(version: string | undefined): boolean {
  if (parseVersion(version) === undefined) return false
  return compareSemver(version, SUBAGENT_VISIBLE_MIN) >= 0
}
