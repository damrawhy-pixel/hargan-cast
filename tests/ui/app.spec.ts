import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The test runner's own environment, minus anything that would point the app at
// a dev server, plus the throwaway profile.
function testEnv() {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RENDERER_URL') env[k] = v
  env.HC_USER_DATA = profile
  return env
}

let app: ElectronApplication
let page: Page
let profile: string

test.beforeEach(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-ui-'))
  app = await electron.launch({
    args: ['--lang=tr-TR', path.join(__dirname, '../../out/main/index.js')],
    env: testEnv(),
  })
  page = await app.firstWindow()
  await page.waitForSelector('.topbar')
})

test.afterEach(async () => {
  await app.close()
  fs.rmSync(profile, { recursive: true, force: true })
})

const shot = (name: string) => page.screenshot({ path: `test-results/screens/${name}.png` })

test('a fresh profile greets and offers both services', async () => {
  await expect(page.getByRole('heading', { name: 'Hoş geldin' })).toBeVisible()
  await expect(page.getByRole('button', { name: "PlayStation'a bağlan" })).toBeVisible()
  await expect(page.getByRole('button', { name: "Xbox'a bağlan" })).toBeVisible()
  await shot('home-tr')
})

test('PlayStation sign-in offers the browser fallback', async () => {
  await page.getByRole('tab', { name: 'PlayStation' }).click()
  await expect(page.getByRole('button', { name: 'PlayStation ile giriş yap' })).toBeVisible()
  await page.getByText('Pencere çalışmıyor mu? Tarayıcıyla bağlan').click()
  await page.getByPlaceholder('NPSSO').fill('not-a-token')
  await page.getByRole('button', { name: 'Bağlan', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('NPSSO')
})

test('settings switch the whole interface to English and back', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await page.getByRole('combobox', { name: 'Dil' }).selectOption('en')
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible()
  await shot('settings-en')
  await page.getByRole('combobox', { name: 'Language' }).selectOption('tr')
  await expect(page.getByRole('tab', { name: 'Ana Sayfa' })).toBeVisible()
})

test('a bad region address is refused with a message', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await page.getByRole('button', { name: 'Xbox', exact: true }).click()
  await page.getByRole('combobox', { name: 'Bölge' }).selectOption('custom')
  const field = page.getByRole('textbox', { name: 'Özel IP' })
  await field.fill('not an ip')
  await field.press('Enter')
  await expect(page.getByRole('alert')).toContainText('IP')
})

test('every settings section opens', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  const sections = page.locator('.settings-nav button')
  const count = await sections.count()
  expect(count).toBeGreaterThan(5)
  for (let i = 0; i < count; i++) {
    await sections.nth(i).click()
    await expect(page.locator('.settings-body h2')).toBeVisible()
  }
})

test('settings survive a restart', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await page.getByRole('switch', { name: 'İmleci gizle' }).click()
  await app.close()
  app = await electron.launch({
    args: ['--lang=tr-TR', path.join(__dirname, '../../out/main/index.js')],
    env: testEnv(),
  })
  page = await app.firstWindow()
  await page.waitForSelector('.topbar')
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await expect(page.getByRole('switch', { name: 'İmleci gizle' })).toHaveAttribute('aria-checked', 'false')
})
