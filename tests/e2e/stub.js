// Stand-in for the preload bridge. Library data is synthetic; the stream path is real.
(() => {
  const art = (i, hue) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="hsl(${hue} 55% 32%)"/><text x="20" y="210" font-size="44" fill="#fff" font-family="Segoe UI">#${i}</text></svg>`)
  const names = ['Şafak Muhafızı', 'Gölge Yolu', 'Demir Lejyon', 'Kızıl Ufuk', 'Son Kale', 'Yıldız Avcısı', 'Buz Vadisi', 'Çelik Ruh']
  const games = Array.from({ length: 1500 }, (_, i) => ({
    productId: 'P' + i, name: `${names[i % 8]} ${i}`, imageUrl: art(i, (i * 37) % 360), landscapeImageUrl: '',
    category: 'streamable', platform: ['ps5', 'ps4', 'ps3'][i % 3], isOwned: i % 11 === 0,
    streamServiceType: i % 3 === 0 ? 'pscloud' : 'psnow', streamIdentifier: 'G' + i, plusCatalog: i % 2 === 0,
  }))

  const listeners = new Set()
  const fire = (e) => listeners.forEach((l) => l(e))

  const split = (bytes) => {
    // Find the first slice NAL so parameter sets can be delivered separately, as Chiaki does.
    for (let i = 0; i + 4 < bytes.length; i++) {
      if (bytes[i] || bytes[i + 1] || bytes[i + 2] !== 1) continue
      const t = bytes[i + 3] & 0x1f
      if (t >= 1 && t <= 5) {
        const start = i > 0 && bytes[i - 1] === 0 ? i - 1 : i
        return [bytes.subarray(0, start), bytes.subarray(start)]
      }
    }
    return [new Uint8Array(), bytes]
  }

  const makeCapture = async () => {
    const chunks = []
    const enc = new VideoEncoder({ output: (c) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); chunks.push({ key: c.type === 'key', d }) }, error: console.error })
    enc.configure({ codec: 'avc1.640033', width: 1280, height: 720, bitrate: 8e6, framerate: 60, avc: { format: 'annexb' }, latencyMode: 'realtime' })
    const canvas = new OffscreenCanvas(1280, 720)
    const ctx = canvas.getContext('2d')
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = `hsl(${i * 2} 70% 40%)`
      ctx.fillRect(0, 0, 1280, 720)
      ctx.fillStyle = '#fff'
      ctx.font = '64px sans-serif'
      ctx.fillText(`kare ${i}`, 60 + i * 5, 360)
      const f = new VideoFrame(canvas, { timestamp: i * 16667 })
      enc.encode(f, { keyFrame: i % 75 === 0 })
      f.close()
    }
    await enc.flush()

    const samples = []
    chunks.forEach((c, i) => {
      if (c.key) {
        const [params, slices] = split(c.d)
        if (i === 0) samples.push(params)
        samples.push(slices)
      } else samples.push(c.d)
    })
    const total = samples.reduce((n, s) => n + s.length + 4, 0)
    const out = new Uint8Array(total)
    const view = new DataView(out.buffer)
    let p = 0
    for (const s of samples) { view.setUint32(p, s.length, true); p += 4; out.set(s, p); p += s.length }
    window.__capture = { samples: samples.length, keys: chunks.filter((c) => c.key).length, bytes: total }
    return out
  }

  window.hc = {
    platform: { fullscreen() {}, toggleFullscreen() {}, streaming() {}, openExternal() {}, openLicenses() {}, log: (t) => (window.__hcLog ??= []).push(t), reportError: (t) => (window.__hcErrors ??= []).push(t) },
    // A test may hand over full settings in window.__hcSettings (see tests/ui/media.spec.ts);
    // without them the page keeps its built-in defaults.
    settings: {
      get: () => (window.__hcSettings ? Promise.resolve(window.__hcSettings) : new Promise(() => {})),
      set: async (patch) => (window.__hcSettings = { ...window.__hcSettings, ...patch }),
      reset: async () => window.__hcSettings ?? {},
    },
    xbox: {
      status: async () => ({ state: 'signedIn', hasCloud: true, gamertag: 'TestGamer' }),
      titles: async () => games.slice(0, 400).map((g, i) => ({ titleId: 'T' + i, productId: g.productId, name: g.name, poster: g.imageUrl, categories: [], recent: i < 12 })),
      library: async () => [], info: async () => ({ screenshots: [] }), activeSessions: async () => [], signIn: async () => {},
      onStatus: () => () => {}, signOut: async () => {},
    },
    ps: {
      status: async () => ({ state: 'signedIn' }),
      catalog: async () => ({ games, warning: '', nativeMode: true }),
      onStatus: () => () => {},
      onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
      stop: async () => {}, signOut: async () => {}, datacenters: async () => [], signIn: async () => {}, signInWithToken: async () => {},
      info: async () => ({ screenshots: [] }), testHaptics: async () => false, routeSpeaker: async () => false,
      stream: async () => {
        fire({ ev: 'progress', stage: 'Test kaydı hazırlanıyor' })
        const capture = await makeCapture()
        const hello = await (await fetch('/__hello')).json()
        setTimeout(() => fetch('/__capture?hevc=0', { method: 'POST', body: capture }), 400)
        return { url: `ws://127.0.0.1:${hello.port}/${hello.token}`, codec: 'h264', width: 1280, height: 720 }
      },
    },
  }
})()
