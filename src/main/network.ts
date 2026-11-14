// A short connection check for the settings page: how fast and how steady the
// services answer, and whether the PC is on cable or Wi-Fi. Cloud streams suffer
// from jitter and Wi-Fi far more than from raw bandwidth.
import { net } from 'electron'
import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { connect } from 'node:net'
import type { NetworkProbe, NetworkReport } from '../shared/types'

const SAMPLES = 6
const TIMEOUT_MS = 3000

// A TCP handshake takes one round trip and no server work, so its time is the
// network's latency, unlike an HTTP request, which also waits on the server.
function handshake(address: string, port: number) {
  return new Promise<number>((resolve, reject) => {
    const started = performance.now()
    const socket = connect({ host: address, port, timeout: TIMEOUT_MS })
    socket.once('connect', () => {
      resolve(performance.now() - started)
      socket.destroy()
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error('timeout'))
    })
    socket.once('error', reject)
  })
}

export async function probe(name: string, url: string): Promise<NetworkProbe> {
  const { host, hostname, port } = new URL(url)
  try {
    const { address } = await lookup(hostname)
    const times: number[] = []
    for (let i = 0; i < SAMPLES; i++) times.push(await handshake(address, Number(port) || 443))
    // The first connection can wait on ARP or a cold route; the rest are steady state.
    const steady = times.slice(1)
    const sorted = [...steady].sort((x, y) => x - y)
    const median = sorted[Math.floor(sorted.length / 2)]
    const jitter = steady.slice(1).reduce((sum, t, i) => sum + Math.abs(t - steady[i]), 0) / Math.max(1, steady.length - 1)
    return { name, host, rttMs: Math.round(median), jitterMs: Math.round(jitter * 10) / 10 }
  } catch {
    return { name, host, failed: true }
  }
}

// The adapter behind the default route. PowerShell's property names are the same in
// every Windows language, unlike netsh's output.
const ADAPTER_SCRIPT =
  "$r = Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1; " +
  'if ($r) { Get-NetAdapter -InterfaceIndex $r.ifIndex | Select-Object InterfaceDescription,PhysicalMediaType,LinkSpeed | ConvertTo-Json -Compress }'

function adapter(): Promise<NetworkReport['adapter']> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ADAPTER_SCRIPT], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      if (error) return resolve(undefined)
      try {
        const found = JSON.parse(stdout) as { InterfaceDescription?: string; PhysicalMediaType?: string; LinkSpeed?: string }
        const media = found.PhysicalMediaType ?? ''
        resolve({
          name: found.InterfaceDescription ?? '',
          kind: /802\.11|wireless|wi-?fi/i.test(media) ? 'wifi' : /802\.3/.test(media) ? 'wired' : 'other',
          linkSpeed: found.LinkSpeed,
        })
      } catch {
        resolve(undefined)
      }
    })
  })
}

// Download speed: a few parallel downloads of filler data from Cloudflare's speed
// test service, long enough to leave TCP slow start, cut off at a time limit. Only
// run when the user starts the test (docs/privacy.md).
const SPEED_URL = 'https://speed.cloudflare.com/__down?bytes='
const SPEED_STREAMS = 4
const SPEED_BYTES = 25_000_000
const SPEED_LIMIT_MS = 8000
const SPEED_WARMUP_MS = 1000

async function downloadMbps(): Promise<number | undefined> {
  const controller = new AbortController()
  const started = performance.now()
  let counted = 0
  let countFrom = 0
  const timer = setTimeout(() => controller.abort(), SPEED_LIMIT_MS)
  const one = async () => {
    const res = await net.fetch(SPEED_URL + SPEED_BYTES, { cache: 'no-store', signal: controller.signal })
    const reader = res.body?.getReader()
    if (!reader) return
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      // Bytes from the first second, while TCP ramps up, would understate the line.
      if (performance.now() - started >= SPEED_WARMUP_MS) {
        if (!countFrom) countFrom = performance.now()
        counted += value.byteLength
      }
    }
  }
  try {
    await Promise.allSettled(Array.from({ length: SPEED_STREAMS }, one))
  } finally {
    clearTimeout(timer)
  }
  const seconds = (performance.now() - countFrom) / 1000
  return countFrom && seconds > 0.5 ? Math.round((counted * 8) / seconds / 1e6) : undefined
}

export async function networkTest(targets: [string, string][]): Promise<NetworkReport> {
  // Latency first: a download running at the same time would inflate it.
  const [found, ...probes] = await Promise.all([adapter(), ...targets.map(([name, url]) => probe(name, url))])
  return { adapter: found, probes, downloadMbps: await downloadMbps().catch(() => undefined) }
}
