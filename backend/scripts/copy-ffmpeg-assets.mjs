import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(scriptDir, '..')
const sourceDir = path.join(backendDir, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm')
const targetDir = path.join(backendDir, 'dist', 'ffmpeg')

await mkdir(targetDir, { recursive: true })

for (const filename of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  await copyFile(path.join(sourceDir, filename), path.join(targetDir, filename))
}
