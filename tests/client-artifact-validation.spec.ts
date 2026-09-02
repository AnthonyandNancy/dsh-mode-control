import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
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
      registrationId: '@deepseek-ai/dsh-llm-pi-ai-capabilities',
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

  it('defines one canonical build and pack pipeline', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(packageJson.scripts.clean).toBe('node scripts/clean-build.mjs')
    expect(packageJson.scripts['build:host']).toBe('bash scripts/build.sh')
    expect(packageJson.scripts.build).toBe('npm run clean && npm run build:host && npm run build:client && npm run validate:client')
    expect(packageJson.scripts['validate:client']).toBe('node scripts/validate-client.mjs')
    expect(packageJson.scripts.prepack).toBe('npm run build')
  })
})
