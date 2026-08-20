/**
 * Verify the rc.6/rc.7 adapter patch against the real npm tarball.
 *
 * Fail-closed checks:
 * 1. The tarball's dist.integrity matches the manifest.
 * 2. Every target file hash matches the manifest.
 * 3. The unified diff applies cleanly and reproduces the patched hashes.
 * 4. Static resolver/schema markers exist (unit-level verification only; this
 *    script does NOT make HTTP requests).
 *
 * rc.8 is rejected here: it is Native Mode and must never receive this patch.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
const version = manifest.version

if (version === '0.1.0-rc.8') {
  throw new Error('rc.8 is Native Mode; adapter patch is forbidden')
}
if (!version.startsWith('0.1.0-rc.6') && !version.startsWith('0.1.0-rc.7')) {
  throw new Error(`Unknown dsh-llm-pi-ai version "${version}"; refusing to auto-apply a legacy patch`)
}

const isWin = process.platform === 'win32'
const npmExec = isWin ? 'cmd.exe' : 'npm'
const npmArgs = isWin ? ['/c', 'npm'] : []
const tmp = mkdtempSync(join(tmpdir(), `dsh-pi-patch-${version}-`))
try {
  const packOutput = execFileSync(
    npmExec,
    [...npmArgs, 'pack', `${manifest.package}@${version}`, '--silent', '--pack-destination', tmp],
    { encoding: 'utf8' },
  ).trim().split(/\r?\n/).pop()
  const tgz = join(tmp, packOutput)
  const tgzBuffer = readFileSync(tgz)
  const distHash = `sha512-${createHash('sha512').update(tgzBuffer).digest('base64')}`
  if (distHash !== manifest.dist.integrity) {
    throw new Error(`dist.integrity mismatch: got ${distHash}, expected ${manifest.dist.integrity}`)
  }

  const tarArgs = isWin ? ['--force-local', '-xzf', tgz, '-C', tmp] : ['-xzf', tgz, '-C', tmp]
  execFileSync('tar', tarArgs, { stdio: 'inherit' })
  const pkgDir = join(tmp, 'package')

  for (const target of manifest.targets) {
    const file = join(pkgDir, target.path)
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
    if (hash !== target.sha256) {
      throw new Error(`${target.path} sha256 mismatch: got ${hash}, expected ${target.sha256}`)
    }
  }

  execFileSync('git', ['init', '-q'], { cwd: tmp, stdio: 'inherit' })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: tmp, stdio: 'inherit' })
  const patchPath = join(here, manifest.patch)
  execFileSync('git', ['apply', '--check', '--unsafe-paths', '--directory=package', patchPath], { cwd: tmp, stdio: 'inherit' })
  execFileSync('git', ['apply', '--unsafe-paths', '--directory=package', patchPath], { cwd: tmp, stdio: 'inherit' })

  for (const target of manifest.patchedHashes) {
    const file = join(pkgDir, target.path)
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
    if (hash !== target.sha256) {
      throw new Error(`${target.path} patched sha256 mismatch: got ${hash}, expected ${target.sha256}`)
    }
  }

  const js = readFileSync(join(pkgDir, 'lib/index.js'), 'utf8')
  const dts = readFileSync(join(pkgDir, 'lib/types/catalog.d.ts'), 'utf8')
  if (!js.includes('forceAdaptiveThinking: z.boolean()')) {
    throw new Error('patched lib/index.js is missing the forceAdaptiveThinking schema field')
  }
  if (!js.includes('routeAnthropicCompatDefined')) {
    throw new Error('patched lib/index.js is missing the Anthropic route compat validation')
  }
  if (js.includes('const routeCompatDefined')) {
    throw new Error('patched lib/index.js still contains the old combined routeCompatDefined')
  }
  if (!js.includes('entry.compat?.forceAdaptiveThinking ?? route?.forceAdaptiveThinking')) {
    throw new Error('patched resolver does not use model-over-route ?? precedence')
  }
  if (js.includes('entry.compat?.forceAdaptiveThinking || route?.forceAdaptiveThinking')) {
    throw new Error('patched resolver uses || instead of ?? for forceAdaptiveThinking')
  }
  if (!dts.includes('forceAdaptiveThinking?: boolean')) {
    throw new Error('patched lib/types/catalog.d.ts is missing forceAdaptiveThinking')
  }

  console.log(`PASS ${version}: dist integrity, target hashes, patch apply, and static resolver checks`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
