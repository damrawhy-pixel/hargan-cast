// Screenshots and replay clips of a stream, saved where Windows keeps the user's
// pictures and videos, in a "Hargan Cast" folder of each.
import { app, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { log } from './log'
import { captureName } from './names'

const FOLDER = 'Hargan Cast'
const MAX_CLIP_BYTES = 1024 * 1024 * 1024

const folder = (kind: 'pictures' | 'videos') => path.join(app.getPath(kind), FOLDER)

async function write(kind: 'pictures' | 'videos', name: string, data: Buffer) {
  const dir = folder(kind)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await fs.writeFile(file, data)
  log(`capture saved: ${kind} ${data.length} bytes`)
  return file
}

/** What the window shows right now, as a PNG. */
export async function saveScreenshot(win: BrowserWindow, title: unknown) {
  const image = await win.webContents.capturePage()
  return write('pictures', `${captureName(String(title))}.png`, image.toPNG())
}

/** A finished MP4 from the page's replay buffer. */
export async function saveClip(title: unknown, data: unknown) {
  const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : undefined
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_CLIP_BYTES) throw new Error('clip')
  return write('videos', `${captureName(String(title))}.mp4`, Buffer.from(bytes))
}

/** Shows a saved capture in Explorer; nothing outside the two capture folders. */
export function showCapture(file: unknown) {
  if (typeof file !== 'string') return
  const resolved = path.resolve(file)
  const inside = [folder('pictures'), folder('videos')].some((dir) => resolved.startsWith(dir + path.sep))
  if (inside) shell.showItemInFolder(resolved)
}
