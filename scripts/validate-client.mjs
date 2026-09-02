import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

function clientExportPath(packageJson) {
  const declared = packageJson.exports?.['./client']
  if (typeof declared === 'string') return declared
  if (declared && typeof declared === 'object' && typeof declared.default === 'string') return declared.default
  return undefined
}

export async function validateClientBundle({ packageJsonPath, clientPath } = {}) {
  const packageFile = resolve(packageJsonPath ?? 'package.json')
  let packageJson
  try {
    packageJson = JSON.parse(await readFile(packageFile, 'utf8'))
  } catch (error) {
    throw new Error(`package metadata could not be read: ${packageFile}`, { cause: error })
  }

  const packageName = packageJson.name
  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new Error('package name is missing')
  }

  const relativeClientPath = clientExportPath(packageJson)
  if (!clientPath && !relativeClientPath) {
    throw new Error('exports["./client"] is missing')
  }
  const target = resolve(clientPath ?? resolve(dirname(packageFile), relativeClientPath))

  let source
  try {
    source = await readFile(target, 'utf8')
  } catch (error) {
    throw new Error(`client bundle not found: ${target}`, { cause: error })
  }

  const registrations = [...source.matchAll(/window\.__ModuleLoader__\.load\s*\(/g)]
  if (registrations.length !== 1) {
    throw new Error(`client bundle must contain exactly one __ModuleLoader__.load registration; found ${registrations.length}`)
  }

  let captured
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) {
          captured = value
        },
      },
    },
  }
  try {
    vm.runInNewContext(source, context, { filename: target })
  } catch (error) {
    throw new Error(`client bundle could not execute: ${target}`, { cause: error })
  }

  if (!captured || captured.id !== packageName || typeof captured.factory !== 'function') {
    throw new Error(`client bundle registration id must equal package name ${packageName}`)
  }

  let exports
  try {
    exports = captured.factory((specifier) => {
      if (specifier === 'react') return {}
      throw new Error(`unexpected client external: ${specifier}`)
    })
  } catch (error) {
    throw new Error(`client factory could not materialize for ${packageName}`, { cause: error })
  }
  if (!exports || typeof exports !== 'object') {
    throw new Error(`client factory for ${packageName} did not return exports`)
  }

  return { packageName, clientPath: target, registrationId: captured.id }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await validateClientBundle({ packageJsonPath: resolve(process.cwd(), 'package.json') })
  console.log(`client artifact valid: ${result.clientPath}`)
}
