const path = require('node:path')
const fs = require('node:fs')

const rootDir = path.resolve(__dirname, '..')
loadEnvFile(path.join(rootDir, '.env'))

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function readPositiveNumber(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readPort() {
  const value = Number(process.env.PORT)
  return Number.isInteger(value) && value >= 0 && value <= 65535 ? value : 3000
}

module.exports = {
  port: readPort(),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  maxUploadBytes: readPositiveNumber('MAX_UPLOAD_MB', 200) * 1024 * 1024,
  maxOutputBytes: readPositiveNumber('MAX_OUTPUT_MB', 10) * 1024 * 1024,
  maxDurationSeconds: readPositiveNumber('MAX_DURATION_SECONDS', 30),
  maxConcurrentJobs: Math.max(1, Math.floor(readPositiveNumber('MAX_CONCURRENT_JOBS', 1))),
  maxPendingJobs: Math.max(1, Math.floor(readPositiveNumber('MAX_PENDING_JOBS', 8))),
  jobTtlMs: readPositiveNumber('JOB_TTL_MINUTES', 60) * 60 * 1000,
  corsOrigins: (process.env.CORS_ORIGINS || 'https://b1ank-7.github.io')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  tempDir: path.join(rootDir, 'tmp')
}
