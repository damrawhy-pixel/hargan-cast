// "Add to Steam": a non-Steam game entry that starts one game straight away, so it
// shows in Steam's library and Big Picture with its own name. Steam keeps these in
// userdata/<account>/config/shortcuts.vdf, a small binary key-value file.
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { crc32 } from 'node:zlib'

type Vdf = { [key: string]: Vdf | string | number }

const MAP = 0x00
const STRING = 0x01
const INT = 0x02
const END = 0x08

export function parseVdf(data: Buffer): Vdf {
  let at = 0
  const text = () => {
    const end = data.indexOf(0, at)
    if (end < 0) throw new Error('vdf')
    const value = data.toString('utf8', at, end)
    at = end + 1
    return value
  }
  const map = (): Vdf => {
    const out: Vdf = {}
    while (at < data.length) {
      const type = data[at++]
      if (type === END) return out
      const key = text()
      if (type === MAP) out[key] = map()
      else if (type === STRING) out[key] = text()
      else if (type === INT) {
        out[key] = data.readInt32LE(at)
        at += 4
      } else throw new Error('vdf')
    }
    return out
  }
  return map()
}

export function writeVdf(value: Vdf): Buffer {
  const parts: Buffer[] = []
  const text = (s: string) => parts.push(Buffer.from(s, 'utf8'), Buffer.from([0]))
  const map = (v: Vdf) => {
    for (const [key, item] of Object.entries(v)) {
      if (typeof item === 'object') {
        parts.push(Buffer.from([MAP]))
        text(key)
        map(item)
        parts.push(Buffer.from([END]))
      } else if (typeof item === 'number') {
        parts.push(Buffer.from([INT]))
        text(key)
        const n = Buffer.alloc(4)
        n.writeInt32LE(item | 0)
        parts.push(n)
      } else {
        parts.push(Buffer.from([STRING]))
        text(key)
        text(item)
      }
    }
  }
  map(value)
  parts.push(Buffer.from([END]))
  return Buffer.concat(parts)
}

/** Steam's id for a non-Steam game: a CRC of its target and name, top bit set. */
export function shortcutAppId(exe: string, name: string) {
  return (crc32(exe + name) | 0x80000000) | 0
}

function steamPath(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      const found = !error && stdout.match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1]?.trim()
      resolve(found ? path.normalize(found) : undefined)
    })
  })
}

/**
 * Adds the entry for every Steam account on this PC. Steam reads the file when it
 * starts, so the game shows up after Steam is restarted.
 */
export async function addToSteam(entry: { name: string; exe: string; launchOptions: string; icon?: string }) {
  const root = await steamPath()
  if (!root) throw new Error('steam')
  const users = await fs.readdir(path.join(root, 'userdata')).catch(() => [] as string[])
  let added = 0
  for (const user of users.filter((u) => /^\d+$/.test(u) && u !== '0')) {
    const config = path.join(root, 'userdata', user, 'config')
    const file = path.join(config, 'shortcuts.vdf')
    const existing = await fs.readFile(file).catch(() => undefined)
    const vdf = existing ? parseVdf(existing) : { shortcuts: {} }
    const list = (vdf.shortcuts ?? {}) as Vdf
    const exe = `"${entry.exe}"`
    // The same game again replaces its old entry instead of doubling it.
    const kept = Object.values(list).filter((s) => typeof s === 'object' && !(s.Exe === exe && s.LaunchOptions === entry.launchOptions)) as Vdf[]
    kept.push({
      appid: shortcutAppId(exe, entry.name),
      AppName: entry.name,
      Exe: exe,
      StartDir: `"${path.dirname(entry.exe)}"`,
      icon: entry.icon ?? '',
      ShortcutPath: '',
      LaunchOptions: entry.launchOptions,
      IsHidden: 0,
      AllowDesktopConfig: 1,
      AllowOverlay: 1,
      OpenVR: 0,
      Devkit: 0,
      DevkitGameID: '',
      DevkitOverrideAppID: 0,
      LastPlayTime: 0,
      FlatpakAppID: '',
      tags: {},
    })
    vdf.shortcuts = Object.fromEntries(kept.map((s, i) => [String(i), s]))
    await fs.mkdir(config, { recursive: true })
    if (existing) await fs.writeFile(`${file}.hargan-backup`, existing)
    await fs.writeFile(file, writeVdf(vdf))
    added++
  }
  if (!added) throw new Error('steam')
  return added
}
