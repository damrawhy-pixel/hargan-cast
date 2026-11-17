// File names for what the app saves: what Windows allows, and a time stamp.

export function safeName(title: string) {
  // Windows forbids these in file names, along with control characters.
  const allowed = [...String(title)].filter((c) => c.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(c)).join('')
  return allowed.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Hargan Cast'
}

// "Halo: Infinite" on 17.11.2026 at 21:05:09 -> "Halo Infinite 2026-11-17 21-05-09".
export function captureName(title: string, date = new Date()) {
  const clean = safeName(title)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `${clean} ${stamp}`
}
