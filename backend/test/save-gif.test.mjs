import test from 'node:test'
import assert from 'node:assert/strict'
import { isEmbeddedMobileBrowser, requestMobileGifSave } from '../public/save-gif.mjs'

class FakeFile {
  constructor(parts, name, options) {
    this.parts = parts
    this.name = name
    this.type = options.type
  }
}

const gifBlob = new Blob(['GIF89a'], { type: 'image/gif' })

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

test('supported mobile browsers receive a GIF file through the native share menu', async () => {
  let sharedData
  const result = await requestMobileGifSave({
    blob: gifBlob,
    filename: 'result.gif',
    userAgent: 'Mobile Safari',
    FileClass: FakeFile,
    canShare: ({ files }) => files[0].type === 'image/gif',
    share: async (data) => { sharedData = data }
  })
  assert.deepEqual(result, { status: 'shared' })
  assert.equal(sharedData.files[0].name, 'result.gif')
  assert.equal(sharedData.files[0].type, 'image/gif')
})

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
