const panels = [...document.querySelectorAll('[data-panel]')]
const videoInput = document.querySelector('#video-input')
const dropZone = document.querySelector('#drop-zone')
const videoPreview = document.querySelector('#video-preview')
const gifPreview = document.querySelector('#gif-preview')
const processingMessage = document.querySelector('#processing-message')
const errorMessage = document.querySelector('#error-message')
const saveButton = document.querySelector('#save-button')
const apiBaseUrl = String(window.GIF_WEB_CONFIG?.apiBaseUrl || '').replace(/\/$/, '')

let selectedFile = null
let previewUrl = ''
let currentJob = null
let runVersion = 0

const processingCopy = [
  '正在理解视频里的每一个动作',
  '正在让画面自然地动起来',
  '正在整理最后的画面'
]

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
  if (!file.type.startsWith('video/')) {
    showError('请选择一段有效的视频')
    return
  }

  releasePreview()
  selectedFile = file
  previewUrl = URL.createObjectURL(file)
  videoPreview.src = previewUrl
  videoPreview.load()
  showPanel('selected')
}

function releasePreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = ''
  videoPreview.removeAttribute('src')
}

function showError(message) {
  errorMessage.textContent = friendlyError(message)
  showPanel('error')
}

function friendlyError(message = '') {
  if (message.includes('太大') || message.includes('超过')) return '这段视频有点长，换一段短一点的试试'
  if (message.includes('格式') || message.includes('有效') || message.includes('画面')) return '没有读懂这段视频，换一个视频试试'
  if (message.includes('人有点多')) return '现在使用的人有点多，稍后再试一次'
  return '暂时无法处理这段视频，请重新试一次'
}

async function startConversion() {
  if (!selectedFile) return

  const version = ++runVersion
  processingMessage.textContent = processingCopy[0]
  showPanel('processing')

  try {
    const job = await uploadVideo(selectedFile, version)
    if (version !== runVersion) return
    currentJob = job
    await pollJob(job, version)
  } catch (error) {
    if (version === runVersion) showError(error.message)
  }
}

function uploadVideo(file, version) {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('video', file)

    const request = new XMLHttpRequest()
    request.open('POST', apiUrl('/api/jobs'))
    request.responseType = 'json'
    request.timeout = 10 * 60 * 1000

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || version !== runVersion) return
      processingMessage.textContent = event.loaded < event.total
        ? '正在接住你的视频'
        : processingCopy[0]
    })

    request.addEventListener('load', () => {
      const data = request.response || {}
      if (request.status >= 200 && request.status < 300 && data.jobId && data.token) {
        resolve({ id: data.jobId, token: data.token })
        return
      }
      reject(new Error(data.error || '上传没有完成'))
    })
    request.addEventListener('error', () => reject(new Error('网络连接中断了')))
    request.addEventListener('timeout', () => reject(new Error('上传等待太久了')))
    request.send(formData)
  })
}

async function pollJob(job, version) {
  while (version === runVersion) {
    const response = await fetch(apiUrl(`/api/jobs/${job.id}`), {
      headers: { 'x-job-token': job.token },
      cache: 'no-store'
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || '无法读取转换进度')

    processingMessage.textContent = copyForProgress(data.progress)
    if (data.status === 'done') {
      showResult(job, data.resultUrl)
      return
    }
    if (data.status === 'failed') throw new Error(data.error || '转换没有完成')
    await wait(1100)
  }
}

function copyForProgress(progress) {
  if (progress < 30) return processingCopy[0]
  if (progress < 78) return processingCopy[1]
  return processingCopy[2]
}

function showResult(job, resultUrl) {
  const securedUrl = `${apiUrl(resultUrl)}?token=${encodeURIComponent(job.token)}`
  gifPreview.src = securedUrl
  saveButton.href = securedUrl
  showPanel('done')
  releasePreview()
  selectedFile = null
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function apiUrl(pathname) {
  return `${apiBaseUrl}${pathname}`
}

async function resetConverter() {
  runVersion += 1
  releasePreview()
  selectedFile = null
  gifPreview.removeAttribute('src')
  saveButton.href = '#'

  const job = currentJob
  currentJob = null
  showPanel('idle')
  if (!job) return

  fetch(apiUrl(`/api/jobs/${job.id}/cleanup?token=${encodeURIComponent(job.token)}`), {
    method: 'POST',
    keepalive: true
  }).catch(() => {})
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

window.addEventListener('pagehide', () => releasePreview())
