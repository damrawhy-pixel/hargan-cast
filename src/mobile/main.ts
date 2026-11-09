// Entry point of the phone and tablet apps: install window.hc, then start the
// same interface the desktop runs.
import { installBridge } from './bridge'

installBridge()
void import('../renderer/src/main')
