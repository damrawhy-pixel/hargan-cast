// The app's own native plugin (mobile/plugins/ps-core), registered once and
// shared by the PlayStation service and the account vault.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface PsCorePlugin {
  start(): Promise<{ port: number; token: string }>
  command(options: { line: string }): Promise<void>
  signIn(options: { url: string; redirect: string; session: string }): Promise<{ npsso: string }>
  signOut(): Promise<void>
  streaming(options: { on: boolean }): Promise<void>
  /** Rumble on the paired controller; strengths 0-1. */
  rumble(options: { left: number; right: number; durationMs: number }): Promise<void>
  /** The paired controller's motion sensors, fed to the PlayStation stream. */
  controllerMotion(options: { on: boolean }): Promise<void>
  /** The account vault, decrypted by Android Keystore or read from the iOS Keychain. */
  vaultLoad(): Promise<{ data?: string }>
  vaultSave(options: { data: string }): Promise<void>
  addListener(event: 'line', listener: (e: { line: string }) => void): Promise<PluginListenerHandle>
}

export const PsCore = registerPlugin<PsCorePlugin>('PsCore')
