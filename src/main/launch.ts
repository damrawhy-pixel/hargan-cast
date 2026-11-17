// --- starting a game straight away ---------------------------------------------
// A shortcut, Steam entry or link names a game ("xbox:<titleId>", "ps:<productId>")
// or a console ("console:ps:<id>", "console:xbox:<serverId>"):
//   HarganCast.exe --play=xbox:9NBLGGH4R315    hargancast://play/xbox:9NBLGGH4R315
export const PROTOCOL = 'hargancast'
export const LAUNCH = /^(?:(?:xbox|ps):[\w.-]{1,120}|console:(?:ps|xbox):[\w.:-]{1,120})$/

export function launchTarget(argv: string[]): string | undefined {
  for (const arg of argv) {
    let value: string | undefined
    if (arg.startsWith('--play=')) value = arg.slice('--play='.length)
    else if (arg.toLowerCase().startsWith(`${PROTOCOL}://`)) {
      try {
        const url = new URL(arg)
        value = decodeURIComponent(url.host + url.pathname).replace(/^play\//, '').replace(/^console\//, 'console:').replace(/\/$/, '')
      } catch {}
    }
    if (value && LAUNCH.test(value)) return value
  }
  return undefined
}
