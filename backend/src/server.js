const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const express = require('express')
const multer = require('multer')
const config = require('./config')
const { convertToGif } = require('./converter')

const app = express()
const jobs = new Map()
const pendingJobs = []
let activeJobCount = 0

const publicDir = path.resolve(__dirname, '..', 'public')
fs.mkdirSync(config.tempDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (request, file, callback) => callback(null, request.jobDir),
  filename: (request, file, callback) => callback(null, 'source-video')
})

const upload = multer({
  storage,
  limits: { files: 1, fileSize: config.maxUploadBytes },
  fileFilter: (request, file, callback) => {
    const allowed = file.mimetype.startsWith('video/') || file.mimetype === 'application/octet-stream'
    callback(allowed ? null : new Error('请选择有效的视频文件'), allowed)
  }
})

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
app.use((request, response, next) => {
  response.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  })
  const requestOrigin = String(request.headers.origin || '')
  if (isAllowedOrigin(requestOrigin)) {
    response.set({
      'Access-Control-Allow-Origin': requestOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Job-Token',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    })
  }
  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }
  next()
})
app.use(express.static(publicDir, {
  etag: true,
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}))

app.get('/health', (request, response) => {
  response.set('Cache-Control', 'no-store').json({ ok: true, service: 'gif-web' })
})

app.post('/api/jobs', async (request, response, next) => {
  if (pendingJobs.length >= config.maxPendingJobs) {
    response.status(503).json({ error: '现在使用的人有点多，请稍后再试' })
    return
  }

  const jobId = crypto.randomUUID()
  const jobDir = path.join(config.tempDir, jobId)
  request.jobId = jobId
  request.jobDir = jobDir

  try {
    await fsp.mkdir(jobDir, { recursive: true })
  } catch (error) {
    next(error)
    return
  }

  upload.single('video')(request, response, (error) => {
    if (error) {
      fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {})
      next(error)
      return
    }
    if (!request.file) {
      fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {})
      response.status(400).json({ error: '没有收到视频文件' })
      return
    }

    const job = {
      id: jobId,
      accessToken: crypto.randomBytes(24).toString('hex'),
      dir: jobDir,
      inputPath: request.file.path,
      status: 'queued',
      progress: 8,
      message: '视频已收到，正在准备',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    jobs.set(jobId, job)
    response.status(202).json({
      jobId,
      token: job.accessToken,
      status: job.status
    })
    enqueueJob(job)
  })
})

app.get('/api/jobs/:id', (request, response) => {
  const job = jobs.get(request.params.id)
  if (!job) {
    response.status(404).json({ error: '这次转换已经结束，请重新上传视频' })
    return
  }
  if (!canAccessJob(request, job)) {
    response.status(403).json({ error: '无法访问这次转换' })
    return
  }

  const payload = {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message
  }
  if (job.status === 'done') payload.resultUrl = `/api/jobs/${job.id}/result`
  if (job.status === 'failed') payload.error = job.error
  response.set('Cache-Control', 'no-store').json(payload)
})

app.get('/api/jobs/:id/result', (request, response) => {
  const job = jobs.get(request.params.id)
  if (!job || job.status !== 'done' || !job.result) {
    response.status(404).json({ error: 'GIF 还没有生成，或者已经过期' })
    return
  }
  if (!canAccessJob(request, job)) {
    response.status(403).json({ error: '无法访问这次转换' })
    return
  }

  response.set({
    'Content-Type': 'image/gif',
    'Content-Length': String(job.result.size),
    'Cache-Control': 'private, max-age=300',
    'Content-Disposition': `attachment; filename="nobody-knows-gif-better-${job.id.slice(0, 8)}.gif"`
  })
  response.sendFile(path.resolve(job.result.outputPath))
})

app.post('/api/jobs/:id/cleanup', async (request, response, next) => {
  const job = jobs.get(request.params.id)
  if (!job) {
    response.json({ ok: true })
    return
  }
  if (!canAccessJob(request, job)) {
    response.status(403).json({ error: '无法访问这次转换' })
    return
  }
  if (job.status === 'processing' || job.status === 'queued') {
    response.status(409).json({ error: '转换还在进行中' })
    return
  }

  try {
    jobs.delete(job.id)
    await fsp.rm(job.dir, { recursive: true, force: true })
    response.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.use('/api', (request, response) => {
  response.status(404).json({ error: '接口不存在' })
})

app.get('*', (request, response) => {
  response.set('Cache-Control', 'no-cache')
  response.sendFile(path.join(publicDir, 'index.html'))
})

app.use((error, request, response, next) => {
  console.error(error)
  if (response.headersSent) return next(error)
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: '这个视频有点大，请换一段更短的视频' })
    return
  }
  const isClientError = error.message === '请选择有效的视频文件'
  response.status(isClientError ? 400 : 500).json({
    error: isClientError ? error.message : '服务暂时开小差了，请稍后再试'
  })
})

async function processJob(job) {
  try {
    job.status = 'processing'
    job.message = '正在理解视频里的每一个动作'
    job.updatedAt = Date.now()
    const result = await convertToGif({
      inputPath: job.inputPath,
      outputDir: job.dir,
      config,
      onProgress: ({ progress, message }) => {
        job.progress = Math.max(job.progress, progress)
        job.message = message
        job.updatedAt = Date.now()
      }
    })
    job.result = result
    job.status = 'done'
    job.progress = 100
    job.message = 'GIF 已经做好了'
    job.updatedAt = Date.now()
  } catch (error) {
    job.status = 'failed'
    job.progress = 100
    job.error = cleanError(error)
    job.message = job.error
    job.updatedAt = Date.now()
  } finally {
    await fsp.rm(job.inputPath, { force: true }).catch(() => {})
  }
}

function canAccessJob(request, job) {
  const suppliedToken = String(request.headers['x-job-token'] || request.query.token || '')
  if (!suppliedToken || suppliedToken.length !== job.accessToken.length) return false
  return crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(job.accessToken))
}

function isAllowedOrigin(origin) {
  if (!origin) return false
  if (config.corsOrigins.includes(origin)) return true
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function enqueueJob(job) {
  pendingJobs.push(job)
  drainQueue()
}

function drainQueue() {
  while (activeJobCount < config.maxConcurrentJobs && pendingJobs.length > 0) {
    const job = pendingJobs.shift()
    activeJobCount += 1
    processJob(job)
      .catch((error) => console.error(`[${job.id}]`, error))
      .finally(() => {
        activeJobCount -= 1
        drainQueue()
      })
  }
}

function cleanError(error) {
  const message = error && error.message ? error.message : '转换失败'
  const expectedMessages = [
    '视频不能超过',
    '视频处理超时',
    '文件中没有可读取的视频画面',
    '完整视频即使使用最低画质仍超过'
  ]
  if (expectedMessages.some((expected) => message.includes(expected))) return message
  console.error(error)
  return '暂时无法处理这段视频，请换一个视频再试'
}

async function cleanupExpiredJobs() {
  const expiresBefore = Date.now() - config.jobTtlMs
  for (const [jobId, job] of jobs.entries()) {
    if (job.updatedAt >= expiresBefore || job.status === 'processing' || job.status === 'queued') continue
    jobs.delete(jobId)
    await fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {})
  }
}

setInterval(cleanupExpiredJobs, Math.min(config.jobTtlMs, 10 * 60 * 1000)).unref()

const server = app.listen(config.port, () => {
  console.log(`GIF web service listening on port ${server.address().port}`)
})

module.exports = { app, server }
