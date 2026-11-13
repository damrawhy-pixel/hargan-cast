// Daily check that the public Microsoft and Sony endpoints the app reads still
// answer in the shape it expects. Run by .github/workflows/canary.yml; a failure
// there means an upstream change, usually before any user notices.
import assert from 'node:assert/strict'

const SIGLS = 'https://catalog.gamepass.com/sigls/v2?id=f13cf6b4-57e6-4459-89df-6aec18cf0538&market=US&language=en-US'
const PRODUCTS = 'https://catalog.gamepass.com/v3/products?market=US&language=en-US&hydration=RemoteLowJade0'
const DISPLAY = 'https://displaycatalog.mp.microsoft.com/v7.0/products?market=US&languages=en-US&bigIds='
const SONY_SIGN_IN =
  'https://ca.account.sony.com/api/authz/v3/oauth/authorize?client_id=ba495a24-818c-472b-b12d-ff231c1b5745' +
  '&redirect_uri=https%3A%2F%2Fremoteplay.dl.playstation.net%2Fremoteplay%2Fredirect&response_type=code' +
  '&scope=psn%3Aclientapp&service_entity=urn%3Aservice-entity%3Apsn&layout_type=popup'

const checks = {
  async 'Game Pass cloud list'() {
    const list = await (await fetch(SIGLS)).json()
    assert.ok(Array.isArray(list) && list.length > 10, 'list is an array of entries')
    const ids = list.filter((e) => e.id).map((e) => e.id)
    assert.ok(ids.length > 10, 'entries carry product ids')
    return ids.slice(0, 3)
  },
  async 'Game Pass product details'(ids) {
    const res = await fetch(PRODUCTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'calling-app-name': 'Xbox Cloud Gaming Web', 'calling-app-version': '24.17.63', 'ms-cv': '0' },
      body: JSON.stringify({ Products: ids }),
    })
    assert.equal(res.status, 200)
    const products = Object.values((await res.json()).Products ?? {})
    assert.ok(products.length > 0, 'products come back')
    for (const p of products) assert.ok(p.ProductTitle && p.Image_Tile?.URL, 'title and tile art present')
  },
  async 'Microsoft Store listing'(ids) {
    const data = await (await fetch(DISPLAY + encodeURIComponent(ids[0]))).json()
    assert.ok(data.Products?.[0]?.LocalizedProperties?.[0]?.ProductTitle, 'localized title present')
  },
  async 'Sony sign-in client'() {
    const res = await fetch(SONY_SIGN_IN, { redirect: 'manual' })
    // A retired client id answers 400; a live one shows the page or redirects to it.
    assert.ok(res.status < 400, `sign-in answered ${res.status}`)
  },
}

let ids = []
let failed = 0
for (const [name, check] of Object.entries(checks)) {
  try {
    // One retry: a single dropped connection is not an upstream change.
    const result = await check(ids).catch(async () => {
      await new Promise((r) => setTimeout(r, 5000))
      return check(ids)
    })
    if (Array.isArray(result)) ids = result
    console.log(`ok    ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${name}: ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
