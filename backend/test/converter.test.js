const test = require('node:test')
const assert = require('node:assert/strict')
const {
  GIF_FRAME_RATE,
  buildProfiles,
  calculateTargetFrameCount,
  parseFfmpegProbe
} = require('../src/converter')

test('buildProfiles lowers resolution and color count', () => {
  const profiles = buildProfiles(8, 1920)
  assert.deepEqual(profiles[0], { width: 320, colors: 128 })
  assert.ok(profiles.some((profile) => profile.width === 64 && profile.colors === 8))
})

test('buildProfiles never upscales a small source', () => {
  const profiles = buildProfiles(3, 120)
  assert.ok(profiles.every((profile) => profile.width <= 120))
})

test('50fps frame plan preserves the source timeline', () => {
  assert.equal(GIF_FRAME_RATE, 50)
  assert.equal(calculateTargetFrameCount(0.53), 26)
  assert.equal(calculateTargetFrameCount(2.5), 125)
})

test('parseFfmpegProbe reads duration and dimensions from ffmpeg output', () => {
  const stderr = [
    '  Duration: 00:00:02.50, start: 0.000000, bitrate: 350 kb/s',
    '  Stream #0:0: Video: h264, yuv420p, 640x360, 30 fps'
  ].join('\n')

  assert.deepEqual(parseFfmpegProbe(stderr), {
    width: 640,
    height: 360,
    duration: 2.5
  })
})
