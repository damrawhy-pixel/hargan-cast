// Where the Windows build is running. On the Steam Deck (and any Linux PC) it runs
// through Proton, Valve's Wine: there Chromium's OS sandbox cannot start, and the
// Deck's Game Mode wants a full-screen window.
import fs from 'node:fs'

/** Running under Wine/Proton rather than real Windows. */
export const UNDER_WINE =
  process.platform === 'win32' &&
  (Boolean(process.env.WINEPREFIX || process.env.STEAM_COMPAT_DATA_PATH || process.env.WINELOADER) ||
    // Wine maps the Linux root to Z:; a Windows PC has no Z:\usr\bin.
    fs.existsSync('Z:/usr/bin/env'))

/** Steam sets this on the Deck itself. */
export const STEAM_DECK = process.env.SteamDeck === '1'

/** Steam's Game Mode (gamescope) shows one full-screen window and nothing else. */
export const GAME_MODE = STEAM_DECK || process.env.XDG_CURRENT_DESKTOP === 'gamescope' || Boolean(process.env.GAMESCOPE_WAYLAND_DISPLAY)

export const environmentLabel = () => (UNDER_WINE ? `Proton/Wine${STEAM_DECK ? ', Steam Deck' : ''}${GAME_MODE ? ', Game Mode' : ''}` : 'Windows')
