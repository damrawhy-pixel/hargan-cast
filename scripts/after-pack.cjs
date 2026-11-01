// Stamps the Hargan Cast icon and identity into the packaged executable.
const path = require('node:path')
const rcedit = require('rcedit')

exports.default = async function afterPack(context) {
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  await rcedit(exe, {
    icon: path.join(context.packager.projectDir, 'build', 'icon.ico'),
    'file-version': context.packager.appInfo.version,
    'product-version': context.packager.appInfo.version,
    'version-string': {
      CompanyName: 'Hargan Cast',
      FileDescription: 'Hargan Cast',
      ProductName: 'Hargan Cast',
      InternalName: 'Hargan Cast',
      OriginalFilename: 'Hargan Cast.exe',
      LegalCopyright: '© 2026 Hargan Cast',
    },
  })
}
