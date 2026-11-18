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

test('Arabic turns the page right to left and German back', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await page.getByRole('combobox', { name: 'Dil' }).selectOption('ar')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { name: 'عام' })).toBeVisible()
  await shot('settings-ar')
  await page.getByRole('combobox', { name: 'اللغة' }).selectOption('de')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByRole('heading', { name: 'Allgemein' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Sprache' }).selectOption('tr')
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

test('the controller layout editor stores a swap and resets it', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await page.locator('.settings-nav button', { hasText: 'Kol düzeni' }).click()
  await expect(page.locator('.layout-row')).toHaveCount(18)
  // Cross / A now comes from the physical Circle / B button.
  await page.getByRole('combobox', { name: '✕ / A' }).selectOption({ label: '○ / B' })
  await expect(page.locator('.layout-row span.layout-changed')).toHaveCount(1)
  await page.getByRole('switch', { name: 'Sol ve sağ çubuğu değiştir' }).click()
  await page.getByRole('button', { name: 'Standart düzene dön' }).click()
  await expect(page.locator('.layout-row span.layout-changed')).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Sol ve sağ çubuğu değiştir' })).toHaveAttribute('aria-checked', 'false')
  await shot('layout-editor')
})

test('the upscaling method shows only while upscaling is on', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await page.locator('.settings-nav button', { hasText: 'PlayStation' }).click()
  const method = page.getByText('Büyütme yöntemi')
  await expect(method).toBeVisible()
  await page.getByRole('switch', { name: 'Büyütme ve keskinleştirme' }).click()
  await expect(method).toBeHidden()
  await expect(page.getByRole('switch', { name: 'Sıkıştırma izlerini azalt' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kendi konsolun' })).toBeVisible()
})

test('a controller opens the on-screen keyboard on a text field', async () => {
  await page.getByRole('tab', { name: 'PlayStation' }).click()
  await page.getByText('Pencere çalışmıyor mu? Tarayıcıyla bağlan').click()
  // As the pad's A button does: the app marks pad use, then clicks the focused field.
  // (A mouse click clears that mark, as it should, so it cannot stand in here.)
  await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('input[placeholder="NPSSO"]')!
    field.focus()
    document.documentElement.dataset.input = 'pad'
    field.click()
  })
  const keyboard = page.getByRole('dialog', { name: 'Ekran klavyesi' })
  await expect(keyboard).toBeVisible()
  await keyboard.getByRole('button', { name: 'a', exact: true }).click()
  await keyboard.getByRole('button', { name: 'b', exact: true }).click()
  await keyboard.getByRole('button', { name: /^Sil/ }).click()
  await expect(page.getByPlaceholder('NPSSO')).toHaveValue('a')
  await shot('pad-keyboard')
  await keyboard.getByRole('button', { name: /^Kapat/ }).click()
  await expect(keyboard).toBeHidden()
})

test('the home screen offers to fit this computer, once', async () => {
  const card = page.getByText('Bu bilgisayara göre ayarlayalım mı?')
  await expect(card).toBeVisible()
  await page.getByRole('button', { name: 'Şimdi değil' }).click()
  await expect(card).toBeHidden()
})

test('fitting this computer applies settings and says why', async () => {
  test.setTimeout(90_000)
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await page.locator('.settings-body').getByRole('button', { name: 'Bu bilgisayara göre ayarla' }).click()
  await expect(page.locator('.settings-body .autotune-reasons li').first()).toBeVisible({ timeout: 60_000 })
  await shot('autotune')
})

test('stream history starts empty and the accounts page offers nothing to switch to', async () => {
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  await page.locator('.settings-nav button', { hasText: 'Akış geçmişi' }).click()
  await expect(page.getByText('Henüz akış yok.', { exact: false })).toBeVisible()
  await page.locator('.settings-nav button', { hasText: 'Hesaplar' }).click()
  await expect(page.getByText('Kayıtlı diğer hesap')).toHaveCount(0)
})

test('settings fit a phone-sized window', async () => {
  // The desktop window has a minimum size, so the page is given a phone's viewport instead.
  await page.setViewportSize({ width: 400, height: 820 })
  await page.getByRole('button', { name: 'Ayarlar' }).click()
  const sections = page.locator('.settings-nav button')
  const count = await sections.count()
  for (let i = 0; i < count; i++) {
    await sections.nth(i).click()
    await expect(page.locator('.settings-body h2')).toBeVisible()
  }
  // The settings use the window's width, not what a side list would leave.
  const width = await page.locator('.settings-body').evaluate((e) => e.getBoundingClientRect().width)
  expect(width).toBeGreaterThan(360)
  await shot('settings-phone')
})
