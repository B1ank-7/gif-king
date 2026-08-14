const EMBEDDED_BROWSER_PATTERN = /MicroMessenger|QQ\/|Weibo|FBAN|FBAV|Instagram|Line\/|; wv\)/i

export function isEmbeddedMobileBrowser(userAgent = '') {
  return EMBEDDED_BROWSER_PATTERN.test(String(userAgent))
}

export async function requestMobileGifSave({
  blob,
  filename = 'video.gif',
  userAgent = '',
  FileClass = globalThis.File,
  canShare = globalThis.navigator?.canShare?.bind(globalThis.navigator),
  share = globalThis.navigator?.share?.bind(globalThis.navigator)
} = {}) {
  if (!blob) return { status: 'unavailable', reason: 'missing-blob' }
  if (isEmbeddedMobileBrowser(userAgent)) {
    return { status: 'guide', reason: 'embedded-browser' }
  }
  if (typeof FileClass !== 'function' || typeof canShare !== 'function' || typeof share !== 'function') {
    return { status: 'guide', reason: 'share-unsupported' }
  }

  let file
  try {
    file = new FileClass([blob], filename, { type: 'image/gif' })
    if (!canShare({ files: [file] })) {
      return { status: 'guide', reason: 'file-share-unsupported' }
    }
  } catch (error) {
    return { status: 'guide', reason: error?.name || 'share-check-failed' }
  }

  try {
    await share({ files: [file], title: filename })
    return { status: 'shared' }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { status: 'cancelled' }
    }
    return { status: 'guide', reason: error?.name || 'share-failed' }
  }
}
