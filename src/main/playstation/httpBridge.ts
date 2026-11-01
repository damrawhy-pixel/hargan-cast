import { net, session, type Session } from 'electron'

export interface CoreHttpRequest {
  rid: number
  method: string
  url: string
  headers: string[]
  body?: string
  follow: boolean
  timeout: number
}

export interface CoreHttpReply {
  rid: number
  status: number
  error?: string
  headers?: string
  redirect?: string
  body?: string
}

interface Exchange {
  request: CoreHttpRequest
  headers: Record<string, string>
  raw: string
  finish(reply: Omit<CoreHttpReply, 'rid'>): void
}

interface Slot {
  ses: Session
  exchange?: Exchange
}

function parseHeaders(lines: string[]) {
  const out: Record<string, string> = {}
  for (const line of lines) {
    const at = line.indexOf(':')
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

function rawHeaders(status: number, headers: Record<string, string[]> = {}) {
  const lines = [`HTTP/1.1 ${status}`]
  for (const [name, values] of Object.entries(headers)) for (const v of values) lines.push(`${name}: ${v}`)
  return `${lines.join('\r\n')}\r\n`
}

// Runs the sidecar's HTTP on Chromium's stack. Each slot of the core's request
// table owns one throwaway session, because the cookie jar has two sharp edges:
// Chromium hides Set-Cookie from every API except the jar, and anything left in
// the jar would replace the Cookie header the core set. So a slot's jar starts
// empty for each request and is read back and wiped when the response ends.
export class HttpBridge {
  private slots = new Map<number, Slot>()

  private slot(rid: number) {
    const existing = this.slots.get(rid)
    if (existing) return existing

    const slot: Slot = { ses: session.fromPartition(`ps-core-http-${rid}`) }
    this.slots.set(rid, slot)

    slot.ses.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, ...slot.exchange?.headers } })
    })

    // Last point that still sees a redirect to a custom scheme such as gaikai://,
    // which Chromium would refuse to follow.
    slot.ses.webRequest.onHeadersReceived((details, callback) => {
      const exchange = slot.exchange
      if (!exchange) return callback({})

      exchange.raw = rawHeaders(details.statusCode, details.responseHeaders)
      const location = Object.entries(details.responseHeaders ?? {}).find(([k]) => k.toLowerCase() === 'location')?.[1]?.[0]
      const redirect = details.statusCode >= 300 && details.statusCode < 400 && location !== undefined

      if (redirect && !exchange.request.follow) {
        exchange.finish({ status: details.statusCode, headers: exchange.raw, redirect: location, body: '' })
        return callback({ cancel: true })
      }
      callback({})
    })
    return slot
  }

  private async jarAsHeaders(ses: Session) {
    const cookies = await ses.cookies.get({})
    return cookies.map((c) => `Set-Cookie: ${c.name}=${c.value}; Path=${c.path ?? '/'}\r\n`).join('')
  }

  perform(request: CoreHttpRequest) {
    const slot = this.slot(request.rid)

    return new Promise<CoreHttpReply>((resolve) => {
      let settled = false
      const finish = (reply: Omit<CoreHttpReply, 'rid'>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        slot.exchange = undefined
        void slot.ses.clearStorageData({ storages: ['cookies'] }).finally(() => resolve({ rid: request.rid, ...reply }))
      }
      const fail = (error: Error) => finish({ status: 0, error: error.message })
      const timer = setTimeout(() => {
        req.abort()
        fail(new Error('timeout'))
      }, request.timeout)

      const exchange: Exchange = { request, headers: parseHeaders(request.headers), raw: '', finish }
      slot.exchange = exchange

      const req = net.request({
        method: request.method,
        url: request.url,
        session: slot.ses,
        redirect: 'follow',
        useSessionCookies: true,
        cache: 'no-store',
      })
      req.on('response', (response) => {
        const parts: Buffer[] = []
        response.on('data', (d) => parts.push(d))
        response.on('end', () => {
          void this.jarAsHeaders(slot.ses).then((cookies) =>
            finish({
              status: response.statusCode,
              headers: `${exchange.raw}${cookies}\r\n`,
              body: Buffer.concat(parts).toString('utf8'),
            }),
          )
        })
        response.on('error', fail)
      })
      req.on('error', fail)
      if (request.body !== undefined) req.write(request.body)
      req.end()
    })
  }
}
