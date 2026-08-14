import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import {
  applyGifTiming,
  buildProfiles,
  calculateTargetFrameCount,
  isWithinOutputLimit
} from './gif-timing.mjs'

const TARGET_FRAME_RATE = 100
const MOTION_FRAME_RATE = 50
const MOBILE_MAX_PROCESSING_WIDTH = 320
const MAX_DURATION_SECONDS = 30
const MAX_INPUT_BYTES = 200 * 1024 * 1024

const panels = [...document.querySelectorAll('[data-panel]')]
const videoInput = document.querySelector('#video-input')
const dropZone = document.querySelector('#drop-zone')
const videoPreview = document.querySelector('#video-preview')
const gifPreview = document.querySelector('#gif-preview')
const processingMessage = document.querySelector('#processing-message')
const progressLine = document.querySelector('.progress-line')
const progressBar = document.querySelector('#progress-bar')
const errorMessage = document.querySelector('#error-message')
const saveButton = document.querySelector('#save-button')

let selectedFile = null
let previewUrl = ''
let resultUrl = ''
let resultBlob = null
let resultFilename = ''
let ffmpeg = null
let ffmpegLoaded = false
let runVersion = 0
let progressValue = 0
let attemptProgressStart = 0
let attemptProgressSpan = 0
let activeConversion = false

function showPanel(name) {
  for (const panel of panels) {
    const active = panel.dataset.panel === name
    panel.hidden = !active
    panel.classList.toggle('is-active', active)
  }
}

function openFilePicker() {
  videoInput.value = ''
  videoInput.click()
}

function selectVideo(file) {
  if (!file) return
  const looksLikeVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name)
  if (!looksLikeVideo) {
    showError('请选择一段有效的视频')
    return
  }
  if (file.size > MAX_INPUT_BYTES) {
    showError('视频文件太大，请选择更短的视频')
    return
  }

  releaseVideoPreview()
  releaseResult()
  selectedFile = file
  previewUrl = URL.createObjectURL(file)
  videoPreview.src = previewUrl
  videoPreview.load()
  showPanel('selected')
}

function releaseVideoPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = ''
  videoPreview.removeAttribute('src')
  videoPreview.load()
}

function releaseResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl)
  resultUrl = ''
  resultBlob = null
  resultFilename = ''
  gifPreview.removeAttribute('src')
  saveButton.href = '#'
}

function showError(message) {
  errorMessage.textContent = friendlyError(message)
  showPanel('error')
}

function friendlyError(message = '') {
  const normalized = String(message)
  if (/memory|内存|out of bounds|Array buffer/i.test(normalized)) {
    return '设备内存不够，换一段更短的视频试试'
  }
  if (/超过|太大|太长|30 秒|10MB/i.test(normalized)) {
    return '这段视频有点长，换一段短一点的试试'
  }
  if (/格式|有效|画面|demux|decode|Invalid data/i.test(normalized)) {
    return '没有读懂这段视频，换一个视频试试'
  }
  if (/WebAssembly|SharedArrayBuffer|浏览器/i.test(normalized)) {
    return '当前浏览器暂不支持本地转换，请换最新版浏览器试试'
  }
  return '暂时无法处理这段视频，请重新试一次'
}

async function startConversion() {
  if (!selectedFile || activeConversion) return

  const version = ++runVersion
  activeConversion = true
  resetProgress()
  updateProgress(1, '正在准备本地转换工具')
  showPanel('processing')

  let inputName = ''
  try {
    const metadata = await readVideoMetadata(videoPreview)
    if (metadata.duration <= 0 || !Number.isFinite(metadata.duration)) {
      throw new Error('视频时长无效')
    }
    if (metadata.duration > MAX_DURATION_SECONDS + 0.05) {
      throw new Error(`视频不能超过 ${MAX_DURATION_SECONDS} 秒`)
    }

    const engine = await loadFfmpeg()
    if (version !== runVersion) return

    inputName = `input-${version}.${fileExtension(selectedFile.name)}`
    updateProgress(16, '正在读取你的视频')
    await engine.writeFile(inputName, await fetchFile(selectedFile))
    updateProgress(24, '正在理解视频里的每一个动作')

    const result = await convertWithProfiles(engine, inputName, metadata, version)
    if (version !== runVersion) return
    showResult(result.buffer, selectedFile.name)
  } catch (error) {
    console.error(error)
    if (version === runVersion) showError(error?.message || String(error))
  } finally {
    activeConversion = false
    if (ffmpeg && inputName) await safeDelete(inputName)
  }
}

async function loadFfmpeg() {
  if (!('WebAssembly' in window) || typeof Worker === 'undefined') {
    throw new Error('当前浏览器不支持 WebAssembly')
  }

  if (!ffmpeg) {
    ffmpeg = new FFmpeg()
    ffmpeg.on('progress', ({ progress }) => {
      if (!activeConversion || !Number.isFinite(progress)) return
      const normalized = Math.min(1, Math.max(0, progress))
      updateProgress(attemptProgressStart + normalized * attemptProgressSpan)
    })
  }

  if (!ffmpegLoaded) {
    updateProgress(4, '第一次使用，正在准备转换工具')
    const appBaseUrl = new URL('.', document.baseURI).href
    await ffmpeg.load({
      coreURL: await toBlobURL(`${appBaseUrl}ffmpeg/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${appBaseUrl}ffmpeg/ffmpeg-core.wasm`, 'application/wasm')
    })
    ffmpegLoaded = true
    updateProgress(14, '转换工具准备好了')
  }

  return ffmpeg
}

async function convertWithProfiles(engine, inputName, metadata, version) {
  const processingWidth = isMobileDevice()
    ? Math.min(metadata.width, MOBILE_MAX_PROCESSING_WIDTH)
    : metadata.width
  const profiles = buildProfiles(metadata.duration, processingWidth)
  const targetFrameCount = calculateTargetFrameCount(metadata.duration, TARGET_FRAME_RATE)
  let lastSize = 0

  for (let index = 0; index < profiles.length; index += 1) {
    if (version !== runVersion) throw new Error('转换已取消')

    const profile = profiles[index]
    const outputName = `result-${version}-${index}.gif`
    attemptProgressStart = 25 + (index / profiles.length) * 70
    attemptProgressSpan = 70 / profiles.length
    updateProgress(
      attemptProgressStart,
      index === 0 ? '正在让画面自然地动起来' : '正在整理最后的画面'
    )

    const exitCode = await engine.exec(buildFfmpegArgs(inputName, outputName, profile, targetFrameCount))
    if (exitCode !== 0) {
      await safeDelete(outputName)
      throw new Error('本地视频转换失败')
    }

    const encoded = await engine.readFile(outputName)
    await safeDelete(outputName)
    const normalized = applyGifTiming(copyUint8Array(encoded), metadata.duration)
    if (normalized.frameCount === 0) throw new Error('生成的 GIF 中没有有效画面')

    lastSize = normalized.buffer.byteLength
    if (isWithinOutputLimit(lastSize)) {
      updateProgress(100, '已经做好了')
      return normalized
    }
  }

  throw new Error(lastSize > 0
    ? '完整视频即使使用最低画质仍超过 10MB，请缩短视频后重试'
    : '无法生成 GIF')
}

function buildFfmpegArgs(inputName, outputName, profile, targetFrameCount) {
  const filter = [
    `[0:v]scale='min(iw,${profile.width})':-2:flags=lanczos,format=yuv420p,` +
      `minterpolate=fps=${MOTION_FRAME_RATE}:mi_mode=mci:mc_mode=obmc:` +
      'me_mode=bilat:me=epzs:search_param=8:vsbmc=1,' +
      'tpad=stop_mode=clone:stop_duration=0.1,' +
      `minterpolate=fps=${TARGET_FRAME_RATE}:mi_mode=blend,` +
      'tpad=stop_mode=clone:stop_duration=0.1,' +
      `trim=end_frame=${targetFrameCount},setpts=PTS-STARTPTS,split[v0][v1]`,
    `[v0]palettegen=max_colors=${profile.colors}:stats_mode=diff[p]`,
    '[v1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle'
  ].join(';')

  return [
    '-hide_banner', '-loglevel', 'error',
    '-i', inputName,
    '-filter_complex', filter,
    '-an', '-loop', '0',
    '-gifflags', '+transdiff',
    '-y', outputName
  ]
}

function readVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    let timeoutId
    const finish = () => {
      cleanup()
      resolve({
        duration: Number(video.duration),
        width: Number(video.videoWidth) || 480,
        height: Number(video.videoHeight) || 270
      })
    }
    const fail = () => {
      cleanup()
      reject(new Error('文件中没有可读取的视频画面'))
    }
    const cleanup = () => {
      clearTimeout(timeoutId)
      video.removeEventListener('loadedmetadata', finish)
      video.removeEventListener('error', fail)
    }

    if (video.readyState >= 1 && Number.isFinite(video.duration)) {
      finish()
      return
    }
    video.addEventListener('loadedmetadata', finish, { once: true })
    video.addEventListener('error', fail, { once: true })
    timeoutId = setTimeout(fail, 15000)
  })
}

function showResult(buffer, sourceName) {
  releaseResult()
  const blob = new Blob([buffer], { type: 'image/gif' })
  resultBlob = blob
  resultFilename = `${baseName(sourceName)}.gif`
  resultUrl = URL.createObjectURL(blob)
  gifPreview.src = resultUrl
  saveButton.href = resultUrl
  saveButton.download = resultFilename
  showPanel('done')
  releaseVideoPreview()
  selectedFile = null
}

async function saveResult(event) {
  if (!resultBlob || !resultUrl || !isMobileDevice()) return

  event.preventDefault()
  const file = typeof File === 'function'
    ? new File([resultBlob], resultFilename || 'video.gif', { type: 'image/gif' })
    : null

  if (file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: resultFilename || 'GIF'
        })
        return
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
      console.warn('Unable to open the native share sheet', error)
    }
  }

  const opened = window.open(resultUrl, '_blank')
  if (opened) {
    opened.opener = null
    return
  }
  window.location.assign(resultUrl)
}

function isMobileDevice() {
  return window.matchMedia?.('(pointer: coarse)').matches === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

function updateProgress(nextValue, message) {
  progressValue = Math.max(progressValue, Math.min(100, Math.round(Number(nextValue) || 0)))
  progressBar.style.width = `${progressValue}%`
  progressLine.setAttribute('aria-valuenow', String(progressValue))
  if (message) processingMessage.textContent = message
}

function resetProgress() {
  progressValue = 0
  attemptProgressStart = 0
  attemptProgressSpan = 0
  progressBar.style.width = '0%'
  progressLine.setAttribute('aria-valuenow', '0')
}

async function resetConverter() {
  runVersion += 1
  releaseVideoPreview()
  releaseResult()
  selectedFile = null
  resetProgress()
  showPanel('idle')
}

async function safeDelete(pathname) {
  try {
    await ffmpeg.deleteFile(pathname)
  } catch (error) {
    // A failed cleanup must not turn a successful conversion into an error.
  }
}

function copyUint8Array(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  }
  return new Uint8Array(value)
}

function fileExtension(filename) {
  const match = String(filename).match(/\.([a-z0-9]{1,8})$/i)
  return match ? match[1].toLowerCase() : 'bin'
}

function baseName(filename) {
  const value = String(filename || 'video').replace(/\.[^.]+$/, '').trim()
  return value || 'video'
}

dropZone.addEventListener('click', openFilePicker)
videoInput.addEventListener('change', () => selectVideo(videoInput.files[0]))
document.querySelector('#convert-button').addEventListener('click', startConversion)
document.querySelector('#change-button').addEventListener('click', openFilePicker)
document.querySelector('#again-button').addEventListener('click', resetConverter)
document.querySelector('#retry-button').addEventListener('click', () => {
  resetConverter()
  openFilePicker()
})
saveButton.addEventListener('click', saveResult)

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropZone.classList.add('is-dragging')
  })
}

for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropZone.classList.remove('is-dragging')
  })
}

dropZone.addEventListener('drop', (event) => selectVideo(event.dataTransfer.files[0]))

window.addEventListener('pagehide', () => {
  releaseVideoPreview()
  releaseResult()
  if (ffmpeg) ffmpeg.terminate()
})
