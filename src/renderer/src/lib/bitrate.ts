// What the connection test suggests for PlayStation streams.

// PlayStation bit rates the settings offer, kb/s.
const PS_RATES = [5000, 10000, 15000, 20000, 30000, 40000, 50000, 75000, 100000]
// A stream needs headroom over its average for key frames and other traffic.
const BITRATE_SHARE = 0.7

/** The highest offered PS bit rate a measured line carries with headroom; 0 if none. */
export function suggestedPsBitrate(downloadMbps: number) {
  const budget = downloadMbps * 1000 * BITRATE_SHARE
  return PS_RATES.filter((r) => r <= budget).at(-1) ?? 0
}
