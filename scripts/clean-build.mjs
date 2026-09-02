import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

await rm(resolve(process.cwd(), 'lib'), { recursive: true, force: true })
console.log('cleaned build output: lib')
