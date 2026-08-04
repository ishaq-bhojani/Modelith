import { describe, it, expect, vi } from 'vitest'
import { CheckOnlyBackend, NullBackend, FakeUpdaterBackend } from '../../src/main/updater/backend.js'
import { UpdateError } from '../../src/main/updater/policy.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('CheckOnlyBackend', () => {
  it('reports the latest version from the release tag', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.3.0' }))
    const backend = new CheckOnlyBackend(fetchImpl as unknown as typeof fetch)
    expect(await backend.check()).toEqual({ version: '0.3.0' })
  })

  it('requests the hardcoded repo endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.3.0' }))
    await new CheckOnlyBackend(fetchImpl as unknown as typeof fetch).check()
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.github.com/repos/ishaq-bhojani/Modelith/releases/latest',
    )
  })

  it('treats 404 (no release yet) as "no update", not an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    expect(await new CheckOnlyBackend(fetchImpl as unknown as typeof fetch).check()).toBeNull()
  })

  it('raises a rate-limited UpdateError on 403 and 429', async () => {
    for (const status of [403, 429]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }))
      const backend = new CheckOnlyBackend(fetchImpl as unknown as typeof fetch)
      await expect(backend.check()).rejects.toMatchObject({ code: 'rate-limited' })
    }
  })

  it('raises an error carrying only the status code, never the response body', async () => {
    // mockImplementation (not mockResolvedValue): a Response body can only be
    // consumed once, so each call needs its own instance.
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('secret-token-abc123', { status: 500 })))
    const backend = new CheckOnlyBackend(fetchImpl as unknown as typeof fetch)
    const err = await backend.check().catch((e: unknown) => e)
    expect(String(err)).toMatch(/500/)
    expect(String(err)).not.toContain('secret-token-abc123')
  })

  it('returns null when the payload has no usable tag', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 42 }))
    expect(await new CheckOnlyBackend(fetchImpl as unknown as typeof fetch).check()).toBeNull()
  })

  it('refuses to download, since this platform cannot install automatically', async () => {
    const backend = new CheckOnlyBackend(vi.fn() as unknown as typeof fetch)
    await expect(backend.download()).rejects.toBeInstanceOf(UpdateError)
  })
})

describe('NullBackend', () => {
  it('never reports an update, so unpackaged builds stay idle', async () => {
    expect(await new NullBackend().check()).toBeNull()
  })

  it('refuses to download', async () => {
    await expect(new NullBackend().download()).rejects.toBeInstanceOf(UpdateError)
  })
})

describe('FakeUpdaterBackend', () => {
  it('reports a far-future version so e2e always sees an update', async () => {
    expect(await new FakeUpdaterBackend().check()).toEqual({ version: '99.0.0' })
  })

  it('emits progress then downloaded when asked to download', async () => {
    const backend = new FakeUpdaterBackend()
    const events: string[] = []
    backend.on('progress', () => events.push('progress'))
    backend.on('downloaded', () => events.push('downloaded'))
    await backend.download()
    expect(events).toEqual(['progress', 'downloaded'])
  })
})
