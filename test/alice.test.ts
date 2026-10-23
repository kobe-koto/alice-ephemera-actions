import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AliceClient, AliceApiError } from '../src/alice.js'

type FetchArgs = { url: string; init: RequestInit }

/** Install a fake global fetch that records calls and returns `responder`. */
function withFetch (
  responder: (args: FetchArgs) => Response,
  fn: (calls: FetchArgs[]) => Promise<void>
): Promise<void> {
  const calls: FetchArgs[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return responder({ url, init })
  }) as typeof fetch
  return fn(calls).finally(() => {
    globalThis.fetch = original
  })
}

function jsonResponse (body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

test('client sends bearer auth and unwraps the data envelope', async () => {
  await withFetch(
    () => jsonResponse({ status: 200, data: [{ id: 1 }, { id: 2 }] }),
    async (calls) => {
      const client = new AliceClient('cid', 'secret')
      const instances = await client.listInstances()
      assert.deepEqual(instances, [{ id: 1 }, { id: 2 }])
      assert.equal(calls.length, 1)
      assert.match(calls[0]!.url, /\/evo\/instances$/)
      const headers = calls[0]!.init.headers as Record<string, string>
      assert.equal(headers.Authorization, 'Bearer cid:secret')
    }
  )
})

test('deployInstance posts the mapped payload', async () => {
  await withFetch(
    () => jsonResponse({ status: 200, data: { id: 42, ipv4: '1.2.3.4' } }),
    async (calls) => {
      const client = new AliceClient('cid', 'secret')
      const instance = await client.deployInstance({
        productId: 7,
        osId: 11,
        time: 2,
        sshKeyId: 3,
        bootScript: 'YmFzZTY0'
      })
      assert.equal(instance.id, 42)
      assert.equal(instance.ipv4, '1.2.3.4')
      assert.equal(calls[0]!.init.method, 'POST')
      const body = JSON.parse(calls[0]!.init.body as string)
      assert.deepEqual(body, {
        product_id: 7,
        os_id: 11,
        time: 2,
        ssh_key_id: 3,
        boot_script: 'YmFzZTY0'
      })
    }
  )
})

test('deployInstance omits optional fields when not provided', async () => {
  await withFetch(
    () => jsonResponse({ data: { id: 1 } }),
    async (calls) => {
      const client = new AliceClient('cid', 'secret')
      await client.deployInstance({ productId: 1, osId: 2, time: 1 })
      const body = JSON.parse(calls[0]!.init.body as string)
      assert.deepEqual(body, { product_id: 1, os_id: 2, time: 1 })
    }
  )
})

test('non-2xx responses throw AliceApiError with the API message', async () => {
  await withFetch(
    () => jsonResponse({ status: 400, message: 'no permission' }, 400),
    async () => {
      const client = new AliceClient('cid', 'secret')
      await assert.rejects(client.listPlans(), (err: unknown) => {
        assert.ok(err instanceof AliceApiError)
        assert.equal(err.status, 400)
        assert.match(err.message, /no permission/)
        return true
      })
    }
  )
})

test('constructor requires credentials', () => {
  assert.throws(() => new AliceClient('', ''), /Client ID and a Secret/)
})
