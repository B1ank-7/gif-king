const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { applyGifTiming } = require('../src/gif-delay')

const ffmpegPath = process.env.E2E_FFMPEG_PATH || 'ffmpeg'
const shouldRun = process.env.RUN_E2E === '1'

test('browser flow uploads, converts and downloads a duration-preserving GIF', {
  skip: shouldRun ? false : 'Set RUN_E2E=1 to run the real conversion test',
  timeout: 180000
}, async (context) => {
  process.env.PORT = '0'
  process.env.FFMPEG_PATH = ffmpegPath
  process.env.FFPROBE_PATH = 'ffprobe-not-installed'

  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gif-web-e2e-'))
  const sourcePath = path.join(testDir, 'source.mp4')
  const resultPath = path.join(testDir, 'result.gif')
  const { server } = require('../src/server')

  context.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(testDir, { recursive: true, force: true })
  })
  if (!server.listening) await once(server, 'listening')

  await run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=duration=1:size=320x180:rate=24',
    '-c:v', 'mpeg4', '-q:v', '4', '-y', sourcePath
  ])

  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`
  const website = await fetch(`${baseUrl}/`)
  assert.match(await website.text(), /<title>没人比我更懂GIF<\/title>/)

  const form = new FormData()
  form.append('video', new Blob([await fs.readFile(sourcePath)], { type: 'video/mp4' }), 'source.mp4')
  const createResponse = await fetch(`${baseUrl}/api/jobs`, { method: 'POST', body: form })
  assert.equal(createResponse.status, 202)
  const job = await createResponse.json()
  assert.ok(job.jobId)
  assert.ok(job.token)

  let status
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/jobs/${job.jobId}`, {
      headers: { 'x-job-token': job.token }
    })
    status = await response.json()
    if (status.status === 'done') break
    if (status.status === 'failed') assert.fail(status.error)
    await wait(700)
  }
  assert.equal(status.status, 'done')

  const resultResponse = await fetch(`${baseUrl}${status.resultUrl}?token=${job.token}`)
  assert.equal(resultResponse.status, 200)
  const result = Buffer.from(await resultResponse.arrayBuffer())
  await fs.writeFile(resultPath, result)
  assert.match(result.toString('ascii', 0, 6), /^GIF8[79]a$/)
  assert.ok(result.length <= 8 * 1024 * 1024)

  const { blobToGifDataUrl } = await import('../public/save-gif.mjs')
  const previewDataUrl = await blobToGifDataUrl(
    new Blob([result], { type: 'image/gif' }),
    NodeFileReader
  )
  const restoredPreview = Buffer.from(previewDataUrl.split(',')[1], 'base64')
  assert.deepEqual(restoredPreview, result)
  assert.ok(previewDataUrl.length < 25 * 1024 * 1024)

  const timing = applyGifTiming(Buffer.from(result), 1)
  assert.equal(timing.frameCount, 50)
  assert.ok(timing.delays.every((delay) => delay === 2))
  assert.equal(timing.delays.reduce((sum, delay) => sum + delay, 0), 100)
  assert.equal(timing.duration, 1)

  const probe = await run(ffmpegPath, ['-hide_banner', '-i', resultPath, '-f', 'null', '-'], true)
  const duration = probe.stderr.match(/Duration:\s*00:00:(\d+(?:\.\d+)?)/)
  assert.ok(duration)
  assert.ok(Math.abs(Number(duration[1]) - 1) <= 0.02)

  const cleanup = await fetch(`${baseUrl}/api/jobs/${job.jobId}/cleanup?token=${job.token}`, { method: 'POST' })
  assert.equal(cleanup.status, 200)
})

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

class NodeFileReader {
  constructor() {
    this.listeners = new Map()
    this.result = null
    this.error = null
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback)
  }

  async readAsDataURL(blob) {
    try {
      const bytes = Buffer.from(await blob.arrayBuffer())
      this.result = `data:${blob.type};base64,${bytes.toString('base64')}`
      this.listeners.get('load')?.()
    } catch (error) {
      this.error = error
      this.listeners.get('error')?.()
    }
  }
}

function run(command, args, allowNonZero = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || allowNonZero) resolve({ stdout, stderr })
      else reject(new Error(stderr || `Command failed with ${code}`))
    })
  })
}
