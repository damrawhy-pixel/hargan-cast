// The PlayStation picture path end to end, without Sony: the page encodes a short
// H.264 clip (tests/e2e/stub.js), the diagnostic build of the real core replays it
// through its media server, and the real stream worker decodes and paints it.
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

const root = path.join(__dirname, '../..')
const core = path.join(root, 'native/build/diag/hargan-ps-core-diag.exe')
const HARNESS = 'http://127.0.0.1:4871/'

test.skip(!fs.existsSync(core), 'needs the diagnostic core: cmake --build native/build --target hargan-ps-core-diag')

let server: ChildProcess
let app: ElectronApplication

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join(root, 'tests/e2e/server.mjs'), path.join(root, 'out/renderer'), core, path.join(root, 'tests/e2e/stub.js')], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise<void>((resolve, reject) => {
    server.stdout!.on('data', (d) => String(d).includes('harness ready') && resolve())
    server.once('exit', (code) => reject(new Error(`harness exited ${code}`)))
  })
})

test.afterEach(async () => {
  await app?.close()
})

test.afterAll(() => {
  server?.kill()
})

for (const [name, picture] of [
  ['app canvas, lowest latency', { upscaler: 'shader', framePacing: 'latency' }],
  ['graphics card video, smoothest', { upscaler: 'system', framePacing: 'smooth' }],
] as const) {
test(`a replayed PlayStation stream is decoded, shown and ends cleanly (${name})`, async () => {
  app = await electron.launch({ args: [path.join(__dirname, 'media/main.cjs')] })
  const page = await app.firstWindow()
  const settings = { ...DEFAULT_SETTINGS, ...picture, language: 'tr', psPremium: true, showStats: true, psFsr: true, psDeband: false, fullscreenOnStream: false }
  await page.addInitScript((s) => ((window as unknown as { __hcSettings: unknown }).__hcSettings = s), settings)
  await page.goto(HARNESS)

  await page.getByRole('tab', { name: 'PlayStation' }).click()
  await page.locator('.library .grid button').first().click()
  await page.getByRole('button', { name: 'Oyna' }).click()

  // The veil lifts on the first painted frame.
  await expect(page.locator('.stream-veil')).toBeHidden({ timeout: 30_000 })
  const stats = page.locator('.stream-stats')
  await expect(stats).toContainText('1280×720', { timeout: 10_000 })
  const fps = Number((await stats.textContent())?.match(/(\d+)\s*kare\/sn/)?.[1] ?? 0)
  // CI machines have no GPU; a software decoder still has to keep a few frames a second.
  expect(fps).toBeGreaterThan(5)
  await expect(page.locator(picture.upscaler === 'system' ? 'video.stream-surface' : 'canvas.stream-surface')).toBeVisible()
  await page.screenshot({ path: `test-results/screens/ps-stream-${picture.upscaler}.png` })

  // The core sends its reset when the clip is over; the page leaves without an error.
  await expect(page.locator('.stream')).toBeHidden({ timeout: 30_000 })
  await expect(page.locator('.toast')).toHaveCount(0)
  const log: string[] = await page.evaluate(() => (window as unknown as { __hcLog?: string[] }).__hcLog ?? [])
  expect(log.some((line) => /^stream playstation .*fps avg/.test(line))).toBe(true)
  const errors: string[] = await page.evaluate(() => (window as unknown as { __hcErrors?: string[] }).__hcErrors ?? [])
  expect(errors).toEqual([])
})
}

// The same clip over a bad network: frames go missing and arrive unevenly. The
// stream has to keep painting, count the losses and end without an error.
test('a stream on a lossy, jittery network keeps playing and ends cleanly', async () => {
  app = await electron.launch({ args: [path.join(__dirname, 'media/main.cjs')] })
  const page = await app.firstWindow()
  const settings = { ...DEFAULT_SETTINGS, upscaler: 'shader', framePacing: 'smooth', language: 'tr', psPremium: true, showStats: true, psFsr: true, psDeband: false, fullscreenOnStream: false }
  await page.addInitScript(
    ([s, impair]) => {
      const w = window as unknown as { __hcSettings: unknown; __hcImpair: unknown }
      w.__hcSettings = s
      w.__hcImpair = impair
    },
    [settings, { loss: 8, jitter: 40 }] as const,
  )
  await page.goto(HARNESS)
  await page.getByRole('tab', { name: 'PlayStation' }).click()
  await page.locator('.library .grid button').first().click()
  await page.getByRole('button', { name: 'Oyna' }).click()

  await expect(page.locator('.stream-veil')).toBeHidden({ timeout: 30_000 })
  const stats = page.locator('.stream-stats')
  await expect(stats).toContainText('1280×720', { timeout: 10_000 })
  await expect.poll(async () => Number((await stats.textContent())?.match(/kayıp\s*(\d+)/)?.[1] ?? 0), { timeout: 15_000 }).toBeGreaterThan(0)
  // Frames keep coming through the losses; CI machines decode in software, so a few a second is enough.
  await expect.poll(async () => Number((await stats.textContent())?.match(/(\d+)\s*kare\/sn/)?.[1] ?? 0), { timeout: 10_000 }).toBeGreaterThan(0)

  await expect(page.locator('.stream')).toBeHidden({ timeout: 40_000 })
  await expect(page.locator('.toast')).toHaveCount(0)
  const errors: string[] = await page.evaluate(() => (window as unknown as { __hcErrors?: string[] }).__hcErrors ?? [])
  expect(errors).toEqual([])
})
