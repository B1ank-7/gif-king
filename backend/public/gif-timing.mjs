const MAX_OUTPUT_BYTES = 10 * 1024 * 1024

export function applyGifTiming(input, durationSeconds) {
  const buffer = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input)
  const delayOffsets = []

  if (buffer.length < 13 || ascii(buffer, 0, 3) !== 'GIF') {
    return { buffer, frameCount: 0, duration: 0, delays: [] }
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
      offset += 1
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

export function distributeFrameDelays(frameCount, durationSeconds) {
  if (!Number.isInteger(frameCount) || frameCount <= 0) return []

  const requestedTicks = Math.round(Number(durationSeconds) * 100)
  const fallbackTicks = frameCount
  const totalTicks = Math.max(
    frameCount,
    Number.isFinite(requestedTicks) ? requestedTicks : fallbackTicks
  )
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

export function calculateTargetFrameCount(durationSeconds, frameRate = 100) {
  return Math.max(1, Math.floor(Math.max(0.01, Number(durationSeconds)) * frameRate + 1e-9))
}

export function buildProfiles(durationSeconds, sourceWidth) {
  const duration = Number(durationSeconds)
  const safeSourceWidth = Math.max(32, Number(sourceWidth) || 480)
  const initialWidth = duration <= 3 ? 480
    : duration <= 6 ? 400
      : duration <= 10 ? 320
        : duration <= 15 ? 280
          : 240
  const widths = [initialWidth, 320, 280, 240, 200, 160, 128, 96, 72, 64]
    .filter((width, index, all) => width <= safeSourceWidth && all.indexOf(width) === index)

  if (widths.length === 0) widths.push(Math.max(32, Math.floor(safeSourceWidth / 2) * 2))

  const profiles = []
  for (const width of widths) {
    const colors = width >= 320 ? 128 : width >= 200 ? 96 : width >= 128 ? 64 : width >= 96 ? 32 : 16
    profiles.push({ width, colors })
    if (width <= 200) profiles.push({ width, colors: Math.max(8, Math.floor(colors / 2)) })
  }
  return profiles
}

export function isWithinOutputLimit(byteLength) {
  return Number(byteLength) <= MAX_OUTPUT_BYTES
}

function ascii(buffer, start, end) {
  return String.fromCharCode(...buffer.subarray(start, end))
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
