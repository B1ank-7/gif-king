import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  applyGifTiming,
  buildProfiles,
  calculateTargetFrameCount,
  distributeFrameDelays,
  isWithinOutputLimit
} from '../public/gif-timing.mjs'

function graphicControlExtension(delay = 10) {
  return Uint8Array.from([0x21, 0xf9, 0x04, 0x00, delay, 0x00, 0x00, 0x00])
}

function joinBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

test('browser timing keeps the selected video duration', () => {
  const header = joinBytes(
    new TextEncoder().encode('GIF89a'),
    Uint8Array.from([0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00])
  )
  const gif = joinBytes(
    header,
    graphicControlExtension(),
    graphicControlExtension(),
    graphicControlExtension(),
    graphicControlExtension(),
    Uint8Array.from([0x3b])
  )
  const result = applyGifTiming(gif, 0.09)

  assert.equal(result.frameCount, 4)
  assert.deepEqual(result.delays, [2, 2, 2, 3])
  assert.equal(result.duration, 0.09)
})

test('browser profiles preserve 50fps intent and enforce the output limit', () => {
  assert.equal(calculateTargetFrameCount(0.53), 26)
  assert.equal(distributeFrameDelays(26, 0.53).reduce((sum, delay) => sum + delay, 0), 53)
  assert.ok(buildProfiles(5, 1920).length > 1)
  assert.equal(isWithinOutputLimit(10 * 1024 * 1024), true)
  assert.equal(isWithinOutputLimit(10 * 1024 * 1024 + 1), false)
})

test('published browser code has no cloud conversion endpoint', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /tcloudbase|express-k0co|api\/jobs|XMLHttpRequest/)
  assert.match(source, /minterpolate/)
  assert.match(source, /@ffmpeg\/ffmpeg/)
})
