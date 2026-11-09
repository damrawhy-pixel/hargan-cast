// Mobile builds keep no log file; callers never pass secrets either way.
export function log(_message: string) {}

export function safeUrl(url: string) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return 'invalid-url'
  }
}
