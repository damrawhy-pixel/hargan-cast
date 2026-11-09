// Node's https.request on top of fetch. In the app, Capacitor routes fetch through
// the native HTTP stack, so the store and streaming APIs see no browser origin.

type Listener = (...args: any[]) => void

class Emitter {
  private listeners = new Map<string, Listener[]>()
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }
  once(event: string, listener: Listener) {
    return this.on(event, listener)
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((l) => l(...args))
  }
}

interface Options {
  host?: string
  hostname?: string
  port?: number
  path?: string
  method?: string
  headers?: Record<string, string | number | undefined>
}

// The platform sets these itself and refuses or mangles caller-supplied ones.
const OWNED_HEADERS = new Set(['content-length', 'host', 'connection'])

export function request(options: Options, onResponse?: (res: Emitter & { statusCode: number; headers: Record<string, string> }) => void) {
  const req = new Emitter() as Emitter & {
    write(chunk: string): void
    end(chunk?: string): void
    setTimeout(ms: number, cb: () => void): void
    destroy(error?: Error): void
  }
  let body = ''
  let timeoutMs = 0
  let onTimeout: (() => void) | undefined
  const controller = new AbortController()

  req.write = (chunk: string) => {
    body += chunk
  }
  req.setTimeout = (ms, cb) => {
    timeoutMs = ms
    onTimeout = cb
  }
  req.destroy = (error) => {
    controller.abort()
    if (error) req.emit('error', error)
  }
  req.end = (chunk) => {
    if (chunk) body += chunk
    const host = options.hostname ?? options.host
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(options.headers ?? {})) if (v !== undefined && !OWNED_HEADERS.has(k.toLowerCase())) headers[k] = String(v)
    const timer = timeoutMs ? setTimeout(() => onTimeout?.(), timeoutMs) : undefined
    const method = (options.method ?? 'GET').toUpperCase()
    fetch(`https://${host}${options.path ?? '/'}`, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: controller.signal,
    })
      .then(async (response) => {
        clearTimeout(timer)
        const text = await response.text()
        const res = new Emitter() as Emitter & { statusCode: number; headers: Record<string, string> }
        res.statusCode = response.status
        res.headers = {}
        response.headers.forEach((value, key) => (res.headers[key.toLowerCase()] = value))
        onResponse?.(res)
        // Listeners are attached inside the callback; deliver once it has returned.
        queueMicrotask(() => {
          if (text) res.emit('data', text)
          res.emit('end')
          res.emit('close')
        })
      })
      .catch((error) => {
        clearTimeout(timer)
        if (!controller.signal.aborted) req.emit('error', error)
      })
  }
  return req
}

export default { request }
