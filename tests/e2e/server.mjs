// Test harness: serves the built renderer with a stubbed window.hc, drives the real
// sidecar's capture-replay and relays its events. No accounts, no services involved.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const [, , rendererDir, coreExe, stubFile] = process.argv
const capture = path.join(os.tmpdir(), `hc-capture-${process.pid}.bin`)

const core = spawn(coreExe, [], { stdio: ['pipe', 'pipe', 'inherit'] })
let hello
const events = []
readline.createInterface({ input: core.stdout }).on('line', (l) => {
  const m = JSON.parse(l)
  if (m.ev === 'hello') hello = m
  else events.push(m)
})

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
http.createServer(async (req, res) => {
  if (req.url === '/__hello') return res.end(JSON.stringify(hello))
  if (req.url === '/__events') return res.end(JSON.stringify(events))
  if (req.url.startsWith('/__capture')) {
    const hevc = req.url.includes('hevc=1')
    const body = []
    for await (const c of req) body.push(c)
    fs.writeFileSync(capture, Buffer.concat(body))
    core.stdin.write(JSON.stringify({ cmd: 'diag', file: capture, hevc }) + '\n')
    return res.end('ok')
  }
  const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]).slice(1)
  if (rel === '__stub.js') return res.setHeader('content-type', 'text/javascript').end(fs.readFileSync(stubFile))
  try {
    let data = fs.readFileSync(path.join(rendererDir, rel))
    if (rel === 'index.html') data = data.toString().replace('<head>', '<head><script src="/__stub.js"></script>')
    res.setHeader('content-type', mime[path.extname(rel)] ?? 'application/octet-stream')
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end()
  }
}).listen(4871, '127.0.0.1', () => console.log('harness ready'))
