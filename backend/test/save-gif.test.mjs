import test from 'node:test'
import assert from 'node:assert/strict'
import {
  blobToGifDataUrl,
  isEmbeddedMobileBrowser,
  requestMobileGifSave
} from '../public/save-gif.mjs'

class FakeFile {
  constructor(parts, name, options) {
    this.parts = parts
    this.name = name
    this.type = options.type
  }
}

const gifBlob = new Blob(['GIF89a'], { type: 'image/gif' })

class FakeFileReader {
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

test('converts the preview into a complete GIF data URL for native long-press saving', async () => {
  const dataUrl = await blobToGifDataUrl(gifBlob, FakeFileReader)
  assert.match(dataUrl, /^data:image\/gif;base64,/)
  const decoded = Buffer.from(dataUrl.split(',')[1], 'base64')
  assert.equal(decoded.toString('ascii'), 'GIF89a')
})

test('a maximum-size output remains below the 25MB embedded-browser collection limit', async () => {
  const maxOutput = new Blob([new Uint8Array(8 * 1024 * 1024)], { type: 'image/gif' })
  const dataUrl = await blobToGifDataUrl(maxOutput, FakeFileReader)
  assert.ok(dataUrl.length < 25 * 1024 * 1024)
  assert.ok(dataUrl.length * 2 < 25 * 1024 * 1024)
})

test('recognizes the WeChat embedded browser', () => {
  assert.equal(isEmbeddedMobileBrowser('Mozilla/5.0 MicroMessenger/8.0.50'), true)
  assert.equal(isEmbeddedMobileBrowser('Mozilla/5.0 iPhone Safari/605.1.15'), false)
})

test('embedded browsers receive a long-press guide without a silent share attempt', async () => {
  let shareCalls = 0
  const result = await requestMobileGifSave({
    blob: gifBlob,
    userAgent: 'Mozilla/5.0 MicroMessenger/8.0.50',
    FileClass: FakeFile,
    canShare: () => true,
    share: async () => { shareCalls += 1 }
  })
  assert.deepEqual(result, { status: 'guide', reason: 'embedded-browser' })
  assert.equal(shareCalls, 0)
})

for (const profile of [
  {
    name: 'iOS Safari',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
  },
  {
    name: 'Android Chrome',
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36'
  }
]) {
  test(`${profile.name} receives a GIF file through the native share menu`, async () => {
    let sharedData
    const result = await requestMobileGifSave({
      blob: gifBlob,
      filename: 'result.gif',
      userAgent: profile.userAgent,
      FileClass: FakeFile,
      canShare: ({ files }) => files[0].type === 'image/gif',
      share: async (data) => { sharedData = data }
    })
    assert.deepEqual(result, { status: 'shared' })
    assert.equal(sharedData.files[0].name, 'result.gif')
    assert.equal(sharedData.files[0].type, 'image/gif')
  })
}

test('unsupported or rejected file sharing falls back to the visible guide', async () => {
  const unsupported = await requestMobileGifSave({
    blob: gifBlob,
    userAgent: 'Android Mobile',
    FileClass: FakeFile,
    canShare: () => false,
    share: async () => {}
  })
  assert.deepEqual(unsupported, { status: 'guide', reason: 'file-share-unsupported' })

  const rejected = await requestMobileGifSave({
    blob: gifBlob,
    userAgent: 'Android Mobile',
    FileClass: FakeFile,
    canShare: () => true,
    share: async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }) }
  })
  assert.deepEqual(rejected, { status: 'guide', reason: 'NotAllowedError' })
})

test('cancelling the native share menu returns an explicit cancelled state', async () => {
  const result = await requestMobileGifSave({
    blob: gifBlob,
    userAgent: 'iPhone Mobile Safari',
    FileClass: FakeFile,
    canShare: () => true,
    share: async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) }
  })
  assert.deepEqual(result, { status: 'cancelled' })
})
