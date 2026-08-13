/**
 * GIF stores frame delays in centiseconds. Use a 20ms baseline because many
 * players clamp 10ms frames and make a nominal 100fps GIF look like slow motion.
 * The distributed remainder preserves the source duration to GIF's 10ms precision.
 */
function applyGifTiming(buffer, durationSeconds) {
  const delayOffsets = []

  if (buffer.length < 13 || buffer.toString('ascii', 0, 3) !== 'GIF') {
    return { buffer, frameCount: 0 }
  }

  const globalTablePacked = buffer[10]
  const globalTableSize = globalTablePacked & 0x80
    ? 3 * (2 ** ((globalTablePacked & 0x07) + 1))
    : 0
  let offset = 13 + globalTableSize

  while (offset < buffer.length) {
    const marker = buffer[offset]
    offset += 1

    if (marker === 0x3b) break

    if (marker === 0x21) {
      if (offset >= buffer.length) break
      const label = buffer[offset]
      offset += 1

      if (label === 0xf9) {
        if (offset + 6 > buffer.length) break
        const blockSize = buffer[offset]
        offset += 1
        if (blockSize !== 4 || offset + blockSize >= buffer.length) break

        delayOffsets.push(offset + 1)
        offset += blockSize + 1
      } else {
        offset = skipSubBlocks(buffer, offset)
      }
      continue
    }

    if (marker === 0x2c) {
      if (offset + 9 > buffer.length) break
      const localTablePacked = buffer[offset + 8]
      offset += 9
      if (localTablePacked & 0x80) {
        offset += 3 * (2 ** ((localTablePacked & 0x07) + 1))
      }
      if (offset >= buffer.length) break
      offset += 1 // LZW minimum code size
      offset = skipSubBlocks(buffer, offset)
      continue
    }

    break
  }

  const delays = distributeFrameDelays(delayOffsets.length, durationSeconds)
  for (let index = 0; index < delayOffsets.length; index += 1) {
    const delay = delays[index]
    buffer[delayOffsets[index]] = delay & 0xff
    buffer[delayOffsets[index] + 1] = (delay >> 8) & 0xff
  }

  return {
    buffer,
    frameCount: delayOffsets.length,
    duration: delays.reduce((total, delay) => total + delay, 0) / 100,
    delays
  }
}

function distributeFrameDelays(frameCount, durationSeconds) {
  if (!Number.isInteger(frameCount) || frameCount <= 0) return []

  const requestedTicks = Math.round(Number(durationSeconds) * 100)
  const totalTicks = Math.max(frameCount, Number.isFinite(requestedTicks) ? requestedTicks : frameCount * 2)
  const baseDelay = Math.floor(totalTicks / frameCount)
  const remainder = totalTicks - baseDelay * frameCount
  const delays = []
  let accumulator = 0

  for (let index = 0; index < frameCount; index += 1) {
    let delay = baseDelay
    accumulator += remainder
    if (accumulator >= frameCount) {
      delay += 1
      accumulator -= frameCount
    }
    delays.push(Math.max(1, delay))
  }

  return delays
}

function skipSubBlocks(buffer, start) {
  let offset = start
  while (offset < buffer.length) {
    const size = buffer[offset]
    offset += 1
    if (size === 0) return offset
    offset += size
  }
  return buffer.length
}

module.exports = { applyGifTiming, distributeFrameDelays }
