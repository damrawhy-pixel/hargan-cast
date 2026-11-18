// The Android app on an emulator (see .github/workflows/mobile.yml): Playwright
// drives the app's own WebView over adb, so these run against the real APK with
// the real Capacitor bridge. No accounts: they check that the app starts, its
// screens open, and the picture path the PlayStation stream uses works there.
import { _android as android, expect, test, type AndroidDevice, type Page } from '@playwright/test'

const PACKAGE = 'app.hargan.cast'

let device: AndroidDevice
let page: Page
const errors: string[] = []

test.beforeAll(async () => {
  test.setTimeout(180_000)
  ;[device] = await android.devices()
  if (!device) throw new Error('no Android device: start an emulator first')
  await device.shell(`am force-stop ${PACKAGE}`)
  await device.shell(`am start -n ${PACKAGE}/.MainActivity`)
  const webView = await device.webView({ pkg: PACKAGE }, { timeout: 120_000 })
  page = await webView.page()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector('.topbar', { timeout: 120_000 })
})

test.afterAll(async () => {
  await device?.close()
})

test('the app starts on the home screen without errors', async () => {
  await expect(page.getByRole('heading', { name: 'Hoş geldin' })).toBeVisible()
  await device.screenshot({ path: 'test-results/android/home.png' })
  expect(errors).toEqual([])
})

test('every settings section opens', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  const sections = page.locator('.settings-nav button')
  const count = await sections.count()
  expect(count).toBeGreaterThan(5)
  for (let i = 0; i < count; i++) {
    await sections.nth(i).click()
    await expect(page.locator('.settings-body h2')).toBeVisible()
  }
  await device.screenshot({ path: 'test-results/android/settings.png' })
  expect(errors).toEqual([])
})

// What the PlayStation picture path needs from the WebView: H.264 decoding through
// WebCodecs (encoded right here, so no stream is needed), and whether HEVC, 10-bit
// HEVC and the <video> surface are available.
test('the WebView decodes video the way the stream worker does', async () => {
  const report = await page.evaluate(async () => {
    const supported = async (codec: string, hardwareAcceleration: HardwareAcceleration) => {
      try {
        return (await VideoDecoder.isConfigSupported({ codec, hardwareAcceleration })).supported === true
      } catch {
        return false
      }
    }
    const width = 640
    const height = 360
    const chunks: EncodedVideoChunk[] = []
    let config: VideoDecoderConfig | undefined
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig) config = meta.decoderConfig
        chunks.push(chunk)
      },
      error: () => {},
    })
    encoder.configure({ codec: 'avc1.42E01E', width, height, bitrate: 2_000_000, framerate: 30, avc: { format: 'annexb' } })
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `hsl(${i * 12} 80% 50%)`
      ctx.fillRect(0, 0, width, height)
      const frame = new VideoFrame(canvas, { timestamp: i * 33_333 })
      encoder.encode(frame, { keyFrame: i === 0 })
      frame.close()
    }
    await encoder.flush()
    let decoded = 0
    let decodeError = ''
    const decoder = new VideoDecoder({
      output: (frame) => {
        decoded++
        frame.close()
      },
      error: (e) => {
        decodeError = e.message
      },
    })
    decoder.configure({ codec: config?.codec ?? 'avc1.42E01E', optimizeForLatency: true })
    for (const chunk of chunks) decoder.decode(chunk)
    await decoder.flush().catch(() => {})
    return {
      userAgent: navigator.userAgent,
      encoded: chunks.length,
      decoded,
      decodeError,
      h264Hardware: await supported('avc1.640033', 'prefer-hardware'),
      hevc: await supported('hev1.1.6.L153.B0', 'no-preference'),
      hevc10: await supported('hev1.2.4.L153.B0', 'no-preference'),
      videoSurface: typeof (globalThis as { MediaStreamTrackGenerator?: unknown }).MediaStreamTrackGenerator === 'function',
      webgl2: Boolean(new OffscreenCanvas(1, 1).getContext('webgl2')),
    }
  })
  console.log(`android picture path: ${JSON.stringify(report)}`)
  test.info().annotations.push({ type: 'picture path', description: JSON.stringify(report) })
  expect(report.decodeError).toBe('')
  expect(report.decoded).toBe(report.encoded)
  expect(report.webgl2).toBe(true)
})

// The native picture path (NativeVideo.java): MediaCodec decodes the same kind of
// clip, through the real plugin, as it would a stream.
test('the phone decoder takes the stream format through the native path', async () => {
  const result = await page.evaluate(() => (window as unknown as { hc: { ps: { nativeVideo?: { test(): Promise<unknown> } } } }).hc.ps.nativeVideo?.test())
  console.log(`android native video: ${JSON.stringify(result)}`)
  test.info().annotations.push({ type: 'native video', description: JSON.stringify(result) })
  // A decoder may hold back its last frame or two at the end of a clip.
  expect((result as { decoded: number }).decoded).toBeGreaterThanOrEqual(25)
  expect((result as { error?: string }).error).toBeUndefined()
})
