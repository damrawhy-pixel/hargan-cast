// Drives the real UI through a simulated standard gamepad.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) }
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] })
  const press = async (...ids) => {
    ids.forEach((i) => (pad.buttons[i].pressed = true))
    await wait(60)
    ids.forEach((i) => (pad.buttons[i].pressed = false))
    await wait(120)
  }
  const [A, B, LB, RB, UP, DOWN, LEFT, RIGHT, VIEW, MENU] = [0, 1, 4, 5, 12, 13, 14, 15, 8, 9]
  const tabOn = () => document.querySelector('[data-tab][aria-selected=true]')?.getAttribute('data-tab')
  const focus = () => { const e = document.activeElement; return `${e.tagName}:${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 26)}` }
  const out = {}

  document.querySelector('[data-tab=home]').click()
  await wait(500)
  await press(RB); out.rb1 = tabOn()
  await press(RB); out.rb2 = tabOn()
  await press(RB); out.rb3 = tabOn()

  // Settings: reach a section, change a dropdown, put it back.
  await press(DOWN); out.firstFocus = focus()
  await press(DOWN); out.secondFocus = focus()
  await press(A); await wait(250)
  out.section = document.querySelector('.settings h2')?.textContent
  await press(RIGHT); out.intoBody = focus()
  const before = (await window.hc.settings.get()).videoFormat
  await press(RIGHT); await wait(200)
  const changed = (await window.hc.settings.get()).videoFormat
  await press(LEFT); await wait(200)
  out.dropdown = { before, changed, restored: (await window.hc.settings.get()).videoFormat }

  // Library filters.
  await press(LB); out.lb = tabOn()
  await press(UP); await press(UP); await press(UP)
  out.topOfLibrary = focus()

  // PlayStation without Premium must not launch.
  document.querySelector('[data-tab=home]').click()
  await wait(500)
  const psRow = [...document.querySelectorAll('.home .shelf')].find((r) => r.textContent.includes('PlayStation'))
  psRow.querySelector('.tile').click()
  await wait(400)
  out.psBlocked = { stream: !!document.querySelector('.stream'), toast: document.querySelector('.toast')?.textContent?.slice(0, 44) }
  await wait(600)
  out.heroButton = document.querySelector('.launch-play')?.textContent

  // Stream menu with no keyboard at all.
  const row = [...document.querySelectorAll('.home .shelf')].find((r) => r.textContent.includes('Xbox'))
  row.querySelector('.tile').click()
  await wait(1800)
  pad.buttons[VIEW].pressed = pad.buttons[MENU].pressed = true
  await wait(1100)
  pad.buttons[VIEW].pressed = pad.buttons[MENU].pressed = false
  await wait(200)
  out.menuOpened = !!document.querySelector('.stream-menu')
  out.menuFirst = focus()
  await press(DOWN); out.menuSecond = focus()
  await press(B); await wait(100)
  out.menuClosedByB = !document.querySelector('.stream-menu')
  pad.buttons[VIEW].pressed = pad.buttons[MENU].pressed = true
  await wait(1100)
  pad.buttons[VIEW].pressed = pad.buttons[MENU].pressed = false
  await wait(200)
  await press(UP); out.onEnd = focus()
  await press(A); await wait(2500)
  out.leftStream = !document.querySelector('.stream')
  delete navigator.getGamepads
  return out
})()
