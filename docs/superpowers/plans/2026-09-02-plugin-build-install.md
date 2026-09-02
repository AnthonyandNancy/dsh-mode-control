# Plugin Build and GitHub Install Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every GitHub-source build/package regenerate and validate the host and client artifacts before installation, preventing stale or incorrectly registered `lib/client.js` bundles.

**Architecture:** Keep `scripts/build.sh` as the host compiler, add a cross-platform clean-build helper, and make the package `build` script sequence clean → host → client → client validation. A small Node validator reads package metadata and the generated client bundle, validates the loader wrapper and package ID, then executes the wrapper with a mocked loader. `prepack` delegates to the same canonical build so `npm pack` cannot reuse stale output. README documents packing and installing only the newly generated tarball from a GitHub checkout.

**Tech Stack:** Node.js ESM scripts, npm scripts, tsdown, TypeScript, Vitest, Markdown.

## Global Constraints

- Do not modify plugin host/UI behavior or the DSH loader protocol.
- Preserve package name `@deepseek-ai/dsh-llm-pi-ai-capabilities` and `exports["./client"]`.
- The canonical build must compile both host and client artifacts.
- `npm pack` must rebuild and validate before packaging.
- Use Node filesystem APIs for cross-platform clean/validation logic.
- Existing tests must remain green.

---

### Task 1: Add failing client-artifact validation tests

**Files:**
- Create: `tests/client-artifact-validation.spec.ts`
- Create: `scripts/validate-client.mjs` (test target; initially export the API but leave validation behavior incomplete so tests fail)

**Interfaces:**
- Produces `validateClientBundle({ packageJsonPath, clientPath })`, which returns a validation result or throws an actionable `Error`.
- The validator accepts package metadata and an explicit client path so tests do not depend on the working directory.

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateClientBundle } from '../scripts/validate-client.mjs'

async function fixture(client: string) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-validation-'))
  await mkdir(join(root, 'lib'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-llm-pi-ai-capabilities',
    exports: { './client': { default: './lib/client.js' } },
  }))
  const clientPath = join(root, 'lib/client.js')
  await writeFile(clientPath, client)
  return { packageJsonPath: join(root, 'package.json'), clientPath }
}

const valid = `window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-llm-pi-ai-capabilities", factory: (require) => { const module = { exports: {} }; module.exports.apply = () => {}; return module.exports; } });`

describe('validateClientBundle', () => {
  it('accepts one loader registration with the package name', async () => {
    await expect(validateClientBundle(await fixture(valid))).resolves.toMatchObject({
      packageName: '@deepseek-ai/dsh-llm-pi-ai-capabilities',
      clientPath: expect.any(String),
    })
  })

  it('rejects a missing client bundle', async () => {
    const target = await fixture(valid)
    await expect(validateClientBundle({ ...target, clientPath: join(target.clientPath, 'missing') }))
      .rejects.toThrow('client bundle not found')
  })

  it('rejects a registration with the wrong loader ID', async () => {
    const target = await fixture(valid.replace('@deepseek-ai/dsh-llm-pi-ai-capabilities', 'wrong-plugin'))
    await expect(validateClientBundle(target)).rejects.toThrow('registration id')
  })

  it('rejects duplicate loader registrations', async () => {
    const target = await fixture(`${valid}\n${valid}`)
    await expect(validateClientBundle(target)).rejects.toThrow('exactly one')
  })
})
```

- [ ] **Step 2: Run the focused test and verify the expected RED state**

Run: `npm test -- tests/client-artifact-validation.spec.ts`

Expected: FAIL because `scripts/validate-client.mjs` does not yet provide the required validation behavior/export.

- [ ] **Step 3: Commit the red test**

```bash
git add tests/client-artifact-validation.spec.ts
 git commit -m "test: specify client artifact validation contract"
```

### Task 2: Implement client validation and clean build scripts

**Files:**
- Modify: `scripts/validate-client.mjs`
- Create: `scripts/clean-build.mjs`
- Test: `tests/client-artifact-validation.spec.ts`

**Interfaces:**
- `validateClientBundle({ packageJsonPath, clientPath })` reads package metadata, resolves `exports["./client"]` when no explicit client path is provided, and returns `{ packageName, clientPath, registrationId }`.
- `cleanBuild()` removes the repository `lib` directory and all package tarballs matching `*.tgz` only when explicitly requested by the build script; it must not remove source files.

- [ ] **Step 1: Implement the minimum validator**

Implement `scripts/validate-client.mjs` with these exact checks:

```js
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import vm from 'node:vm'

export async function validateClientBundle({ packageJsonPath, clientPath }) {
  const packageFile = resolve(packageJsonPath)
  const packageJson = JSON.parse(await readFile(packageFile, 'utf8'))
  const packageName = packageJson.name
  if (typeof packageName !== 'string' || packageName.length === 0) throw new Error('package name is missing')
  const declared = packageJson.exports?.['./client']
  const relative = typeof declared === 'string' ? declared : declared?.default
  const target = resolve(clientPath ?? dirname(packageFile), clientPath ? '' : relative ?? '')
  if (!relative && !clientPath) throw new Error('exports["./client"] is missing')
  let source
  try { source = await readFile(target, 'utf8') } catch { throw new Error(`client bundle not found: ${target}`) }
  const registrations = [...source.matchAll(/window\.\__ModuleLoader__\.load\s*\(/g)]
  if (registrations.length !== 1) throw new Error(`client bundle must contain exactly one __ModuleLoader__.load registration; found ${registrations.length}`)
  const idMatch = source.match(/window\.\__ModuleLoader__\.load\s*\(\s*\{[\s\S]*?\bid\s*:\s*(["'`])([^"'`]+)\1/)
  if (!idMatch || idMatch[2] !== packageName) throw new Error(`client bundle registration id must equal package name ${packageName}`)
  let captured
  const context = { window: { __ModuleLoader__: { load(value) { captured = value } } } }
  vm.runInNewContext(source, context, { filename: target })
  if (!captured || captured.id !== packageName || typeof captured.factory !== 'function') throw new Error(`client bundle did not register a factory for ${packageName}`)
  const exports = captured.factory((specifier) => {
    if (specifier === 'react') return {}
    throw new Error(`unexpected client external: ${specifier}`)
  })
  if (!exports || typeof exports !== 'object') throw new Error(`client factory for ${packageName} did not return exports`)
  return { packageName, clientPath: target, registrationId: captured.id }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const packageJsonPath = resolve(process.cwd(), 'package.json')
  await validateClientBundle({ packageJsonPath })
  console.log(`client artifact valid: ${packageJsonPath}`)
}
```

Normalize Windows URL paths if needed while preserving the exported API. Keep the CLI failure nonzero through the thrown error.

- [ ] **Step 2: Implement `scripts/clean-build.mjs`**

```js
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

await rm(resolve(process.cwd(), 'lib'), { recursive: true, force: true })
console.log('cleaned build output: lib')
```

- [ ] **Step 3: Run focused tests and verify GREEN**

Run: `npm test -- tests/client-artifact-validation.spec.ts`

Expected: all four tests pass.

- [ ] **Step 4: Commit the validator and clean helper**

```bash
git add scripts/validate-client.mjs scripts/clean-build.mjs tests/client-artifact-validation.spec.ts
git commit -m "feat: validate client loader artifacts before packaging"
```

### Task 3: Make build and pack commands canonical

**Files:**
- Modify: `package.json:27-32`
- Test: `tests/client-artifact-validation.spec.ts`

**Interfaces:**
- `npm run build` performs `clean → build:host → build:client → validate:client`.
- `npm run build:host` runs the existing `bash scripts/build.sh`.
- `npm run prepack` runs the same canonical build before `npm pack`.
- `npm run validate:client` invokes the validator CLI.

- [ ] **Step 1: Add script contract assertions to the test**

Append a test that reads the repository `package.json` and asserts:

```ts
const scripts = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).scripts
expect(scripts['build:host']).toBe('bash scripts/build.sh')
expect(scripts.build).toBe('npm run clean && npm run build:host && npm run build:client && npm run validate:client')
expect(scripts.prepack).toBe('npm run build')
expect(scripts['validate:client']).toBe('node scripts/validate-client.mjs')
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/client-artifact-validation.spec.ts`

Expected: FAIL because the current `package.json` has no `clean`, `build:host`, `validate:client`, or `prepack` scripts and `build` is not canonical.

- [ ] **Step 3: Update package scripts**

Set the scripts block to:

```json
"scripts": {
  "clean": "node scripts/clean-build.mjs",
  "build:host": "bash scripts/build.sh",
  "build:client": "tsdown",
  "validate:client": "node scripts/validate-client.mjs",
  "build": "npm run clean && npm run build:host && npm run build:client && npm run validate:client",
  "prepack": "npm run build",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "typecheck:client": "tsc -p tsconfig.client.json --noEmit",
  "test": "vitest run"
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/client-artifact-validation.spec.ts`

Expected: all validation and script-contract tests pass.

- [ ] **Step 5: Commit the canonical pipeline**

```bash
git add package.json tests/client-artifact-validation.spec.ts
git commit -m "build: rebuild and validate artifacts before pack"
```

### Task 4: Document GitHub-source installation

**Files:**
- Modify: `README.md:299-304`

**Interfaces:**
- Documentation must give an agent-usable sequence for both first install and update from a GitHub checkout.

- [ ] **Step 1: Replace the install section with the forced-rebuild workflow**

Add this exact guidance:

```markdown
## Install from GitHub source

When installing from a GitHub checkout, always rebuild before installing. Do not
install an old `.tgz`, and do not install the source directory before its build
has completed.

PowerShell:

```powershell
cd E:\demo\dsh\dsh-mode-control
Remove-Item -Recurse -Force .\lib -ErrorAction SilentlyContinue
Remove-Item -Force .\*.tgz -ErrorAction SilentlyContinue
npm install
npm run build
$package = npm pack --silent
if ($LASTEXITCODE -ne 0) { throw 'Plugin build/package failed; do not install an old package.' }
# Install $package with the DSH agent's package-install action, then refresh DSH.
```

`npm run build` always rebuilds both host and client artifacts and validates the
`__ModuleLoader__` registration. `npm pack` runs the same build again through
`prepack`, so the tarball contains fresh output. After every source update, run
this sequence again and install only the newly printed tarball path.

For a DSH agent with the development installer available, the equivalent order
is: `dev_build_plugin` for this directory, then `dev_install_package` for the
same directory and `profile="web"`, followed by `dev_plugin_status`. If those
agent tools are unavailable, use the PowerShell sequence above and the agent's
normal local-package installation action.
```

Use a path placeholder in prose rather than presenting the example path as universal.

- [ ] **Step 2: Run documentation-sensitive tests and the full suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md
git commit -m "docs: require fresh build for GitHub installs"
```

### Task 5: Full verification and packaging smoke test

**Files:**
- No source changes expected unless verification finds a defect.

- [ ] **Step 1: Run type checks**

Run: `npm run typecheck && npm run typecheck:client`

Expected: exit code 0.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run the canonical clean build**

Run: `npm run build`

Expected: host and client compilation complete, followed by `client artifact valid`.

- [ ] **Step 4: Run pack and inspect package contents**

Run: `npm pack --dry-run --json`

Expected: exit code 0 and package contents include `lib/index.js`, `lib/client.js`, `lib/client.js.map`, `cordis.patch.yml`, and declaration files.

- [ ] **Step 5: Run a fresh tarball validation**

Run a temporary extraction/consumer check that resolves the root export and `./client`, then runs `validateClientBundle` against the extracted package's `lib/client.js`.

Expected: the extracted tarball's client registration ID is exactly `@deepseek-ai/dsh-llm-pi-ai-capabilities`.

- [ ] **Step 6: Review the final diff and working tree**

Run: `git diff --check; git status --short`

Expected: no whitespace errors; only the intended scripts, package metadata, README, tests, and design/plan documents are changed. Do not claim completion until all fresh verification commands exit successfully.
