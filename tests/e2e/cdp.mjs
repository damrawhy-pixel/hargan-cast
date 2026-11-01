// Drives the running Electron renderer over the DevTools protocol.
import fs from 'node:fs'

const [, , action, arg] = process.argv
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('hargan://'))
if (!page) throw new Error('no page: ' + JSON.stringify(targets.map((t) => t.url)))

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const waiting = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (waiting.has(m.id)) waiting.get(m.id)(m)
}
const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })

if (action === 'shot') {
  const { result } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(arg, Buffer.from(result.data, 'base64'))
  console.log('saved', arg)
} else {
  const expression = action === 'file' ? fs.readFileSync(arg, 'utf8') : arg
  const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) console.log('EXC', JSON.stringify(result.exceptionDetails).slice(0, 800))
  else console.log(JSON.stringify(result.result.value, null, 1))
}
ws.close()
process.exit(0)
