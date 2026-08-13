const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')

process.env.PORT = '0'
const { server } = require('../src/server')

test('website and API report a ready service', async (context) => {
  context.after(() => new Promise((resolve) => server.close(resolve)))
  if (!server.listening) await once(server, 'listening')

  const { port } = server.address()
  const response = await fetch(`http://127.0.0.1:${port}/health`)
  const data = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(data, { ok: true, service: 'gif-web' })

  const website = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(website.status, 200)
  assert.match(await website.text(), /没人比我更懂GIF/)

  const missingVideo = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
    method: 'POST',
    body: new FormData()
  })
  assert.equal(missingVideo.status, 400)

  const missingJob = await fetch(`http://127.0.0.1:${port}/api/jobs/not-a-job`)
  assert.equal(missingJob.status, 404)

  const preflight = await fetch(`http://127.0.0.1:${port}/api/jobs/example`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://b1ank-7.github.io',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'x-job-token'
    }
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://b1ank-7.github.io')
})
