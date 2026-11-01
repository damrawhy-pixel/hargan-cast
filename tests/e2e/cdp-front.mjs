// Runs a script with the page forced visible, so requestAnimationFrame keeps ticking.
import fs from 'node:fs'

const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('hargan://'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const waiting = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) waiting.get(m.id)(m) }
const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })

await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
const state = await send('Runtime.evaluate', { expression: 'JSON.stringify({vis:document.visibilityState,stream:!!document.querySelector(".stream")})', returnByValue: true })
console.log(state.result.result.value)
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 70000)
const { result } = await send('Runtime.evaluate', { expression: fs.readFileSync(process.argv[2], 'utf8'), awaitPromise: true, returnByValue: true })
clearTimeout(timer)
console.log(result.exceptionDetails ? 'EXC ' + JSON.stringify(result.exceptionDetails).slice(0, 500) : JSON.stringify(result.result.value, null, 1))
ws.close()
process.exit(0)
