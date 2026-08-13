const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { applyGifTiming } = require('./gif-delay')

const GIF_FRAME_RATE = 50

function run(command, args, { timeoutMs = 10 * 60 * 1000, allowNonZero = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGKILL')
      settled = true
      reject(new Error('视频处理超时，请缩短视频后重试'))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-12000)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`无法启动 ${path.basename(command)}：${error.message}`))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0 || allowNonZero) resolve({ stdout, stderr, code })
      else reject(new Error(`${path.basename(command)} 处理失败：${stderr.slice(-900)}`))
    })
  })
}

async function probeVideo(inputPath, config) {
  try {
    const { stdout } = await run(config.ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      inputPath
    ], { timeoutMs: 30000 })

    const metadata = parseFfprobeJson(stdout)
    if (metadata) return metadata
  } catch (error) {
    // Some portable FFmpeg distributions omit ffprobe. Fall back to ffmpeg metadata.
  }

  const { stderr } = await run(config.ffmpegPath, [
    '-hide_banner', '-i', inputPath
  ], { timeoutMs: 30000, allowNonZero: true })
  const metadata = parseFfmpegProbe(stderr)
  if (!metadata) throw new Error('文件中没有可读取的视频画面')
  return metadata
}

function parseFfprobeJson(stdout) {
  let data
  try {
    data = JSON.parse(stdout)
  } catch (error) {
    return null
  }

  const stream = data.streams && data.streams[0]
  const duration = Number(data.format && data.format.duration)
  if (!stream || !stream.width || !stream.height || !Number.isFinite(duration)) {
    return null
  }

  return { width: stream.width, height: stream.height, duration }
}

function parseFfmpegProbe(stderr) {
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const videoLine = stderr.split(/\r?\n/).find((line) => line.includes('Video:')) || ''
  const sizeMatch = videoLine.match(/(?:^|,\s)(\d{2,5})x(\d{2,5})(?:[\s,]|$)/)
  if (!durationMatch || !sizeMatch) return null

  const duration =
    Number(durationMatch[1]) * 3600 +
    Number(durationMatch[2]) * 60 +
    Number(durationMatch[3])
  return { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]), duration }
}

function buildProfiles(duration, sourceWidth) {
  const initialWidth = duration <= 3 ? 480
    : duration <= 6 ? 400
      : duration <= 10 ? 320
        : duration <= 15 ? 280
          : 240
  const widths = [initialWidth, 320, 280, 240, 200, 160, 128, 96, 72, 64]
    .filter((width, index, all) => width <= sourceWidth && all.indexOf(width) === index)
  if (widths.length === 0) widths.push(Math.max(32, Math.floor(sourceWidth / 2) * 2))

  const profiles = []
  for (const width of widths) {
    const colors = width >= 320 ? 128 : width >= 200 ? 96 : width >= 128 ? 64 : width >= 96 ? 32 : 16
    profiles.push({ width, colors })
    if (width <= 200) profiles.push({ width, colors: Math.max(8, Math.floor(colors / 2)) })
  }
  return profiles
}

async function encodeGif(inputPath, outputPath, profile, duration, config) {
  const safeDuration = Math.max(0.01, duration).toFixed(6)
  const targetFrameCount = calculateTargetFrameCount(duration)
  const filter = [
    `[0:v]scale='min(iw,${profile.width})':-2:flags=lanczos,format=yuv420p,` +
      'tpad=stop_mode=clone:stop_duration=0.1,' +
      `minterpolate=fps=${GIF_FRAME_RATE}:mi_mode=mci:mc_mode=obmc:me_mode=bilat:me=epzs:vsbmc=1,` +
      `trim=end_frame=${targetFrameCount},setpts=PTS-STARTPTS,split[v0][v1]`,
    `[v0]palettegen=max_colors=${profile.colors}:stats_mode=diff[p]`,
    '[v1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle'
  ].join(';')

  await run(config.ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-filter_complex', filter,
    '-an', '-loop', '0',
    '-gifflags', '+transdiff',
    '-y', outputPath
  ])

  const gif = await fs.readFile(outputPath)
  const patched = applyGifTiming(gif, Number(safeDuration))
  if (patched.frameCount === 0) throw new Error('生成的 GIF 中没有有效画面')
  await fs.writeFile(outputPath, patched.buffer)

  const stat = await fs.stat(outputPath)
  return {
    size: stat.size,
    frameCount: patched.frameCount,
    encodedDuration: patched.duration
  }
}

function calculateTargetFrameCount(duration) {
  return Math.max(1, Math.floor(Math.max(0.01, Number(duration)) * GIF_FRAME_RATE + 1e-9))
}

async function convertToGif({ inputPath, outputDir, config, onProgress = () => {} }) {
  const metadata = await probeVideo(inputPath, config)
  if (metadata.duration <= 0) throw new Error('视频时长无效')
  if (metadata.duration > config.maxDurationSeconds + 0.5) {
    throw new Error(`视频不能超过 ${config.maxDurationSeconds} 秒`)
  }

  const profiles = buildProfiles(metadata.duration, metadata.width)
  const attemptPath = path.join(outputDir, 'result.gif')
  let lastResult = null

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index]
    const progress = 30 + Math.round((index / profiles.length) * 62)
    onProgress({
      progress,
      message: index === 0 ? '正在让画面自然地动起来' : '正在整理最后的画面'
    })

    const encoded = await encodeGif(inputPath, attemptPath, profile, metadata.duration, config)
    lastResult = { ...encoded, ...profile }
    if (encoded.size <= config.maxOutputBytes) {
      return {
        outputPath: attemptPath,
        size: encoded.size,
        width: profile.width,
        colors: profile.colors,
        frameRate: Math.round(encoded.frameCount / encoded.encodedDuration),
        targetFrameRate: GIF_FRAME_RATE,
        duration: encoded.encodedDuration,
        sourceDuration: metadata.duration,
        frameCount: encoded.frameCount
      }
    }
  }

  throw new Error(
    lastResult
      ? '完整视频即使使用最低画质仍超过 10MB，请缩短视频后重试'
      : '无法生成 GIF，请更换视频后重试'
  )
}

module.exports = {
  GIF_FRAME_RATE,
  probeVideo,
  parseFfmpegProbe,
  buildProfiles,
  calculateTargetFrameCount,
  convertToGif
}
