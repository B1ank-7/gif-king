const test = require('node:test')
const assert = require('node:assert/strict')
const { applyGifTiming, distributeFrameDelays } = require('../src/gif-delay')

function graphicControlExtension(delay = 10) {
  return Buffer.from([0x21, 0xf9, 0x04, 0x00, delay, 0x00, 0x00, 0x00])
}

function gifHeader() {
  return Buffer.concat([
    Buffer.from('GIF89a'),
    Buffer.from([0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00])
  ])
}

test('writes player-compatible delays while preserving duration', () => {
  const gif = Buffer.concat([
    gifHeader(),
    graphicControlExtension(),
    graphicControlExtension(),
    graphicControlExtension(),
    graphicControlExtension(),
    Buffer.from([0x3b])
  ])
  const result = applyGifTiming(gif, 0.09)

  assert.equal(result.frameCount, 4)
  assert.deepEqual(
    [result.buffer[17], result.buffer[25], result.buffer[33], result.buffer[41]],
    [2, 2, 2, 3]
  )
  assert.equal(result.duration, 0.09)
})

test('50fps timing stays within GIF precision for a fractional duration', () => {
  const delays = distributeFrameDelays(26, 0.53)
  assert.equal(delays.length, 26)
  assert.ok(delays.every((delay) => delay >= 2))
  assert.equal(delays.reduce((total, delay) => total + delay, 0), 53)
})

test('does not rewrite signature-like bytes inside an extension payload', () => {
  const fakeSignature = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x09, 0x00])
  const gif = Buffer.concat([
    gifHeader(),
    Buffer.from([0x21, 0xfe, fakeSignature.length]),
    fakeSignature,
    Buffer.from([0x00]),
    graphicControlExtension(),
    Buffer.from([0x3b])
  ])

  const result = applyGifTiming(gif, 0.02)
  assert.equal(result.frameCount, 1)
  assert.equal(result.buffer[20], 0x09)
})
