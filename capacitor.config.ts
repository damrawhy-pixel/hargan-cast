import type { CapacitorConfig } from '@capacitor/cli'

// The phone and tablet apps: the same interface as the desktop, served from
// dist-mobile, with the native projects kept under mobile/.
const config: CapacitorConfig = {
  appId: 'app.hargan.cast',
  appName: 'Hargan Cast',
  webDir: 'dist-mobile',
  backgroundColor: '#05060b',
  android: { path: 'mobile/android' },
  ios: { path: 'mobile/ios', contentInset: 'never' },
  plugins: {
    // Store and streaming APIs do not allow browser origins; requests go through the native stack.
    CapacitorHttp: { enabled: true },
  },
}

export default config
