// Builds native/bin/hargan-ps-core.exe. Needs CMake, Ninja and llvm-mingw's clang on PATH;
// falls back to the Ninja that ships with Visual Studio.
// With --test it builds and runs the DualSense byte-format tests instead.
// On macOS it builds native/bin/hargan-ps-core from the phone apps' core instead
// (native/ps-core/mobile, sidecar.c); needs Xcode's command line tools and CMake.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

if (process.platform === 'darwin') {
  const macBuild = path.join(root, 'native', 'build-mac')
  const arch = process.env.HC_MAC_ARCH || process.arch
  const run = (...args) => execFileSync('cmake', args, { stdio: 'inherit' })
  run('-S', path.join(root, 'native', 'ps-core', 'mobile'), '-B', macBuild, '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_OSX_ARCHITECTURES=${arch === 'x64' ? 'x86_64' : 'arm64'}`, '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0')
  run('--build', macBuild, '--target', 'hargan-ps-core', '-j', '8')
  mkdirSync(path.join(root, 'native', 'bin'), { recursive: true })
  copyFileSync(path.join(macBuild, 'hargan-ps-core'), path.join(root, 'native', 'bin', 'hargan-ps-core'))
  process.exit(0)
}
const source = path.join(root, 'native', 'ps-core')
const build = path.join(root, 'native', 'build')
const test = process.argv.includes('--test')

const vsNinja = 'C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja'
const env = { ...process.env }
if (existsSync(vsNinja)) env.PATH = `${vsNinja}${path.delimiter}${env.PATH}`

const run = (...args) => execFileSync('cmake', args, { stdio: 'inherit', env })
run('-S', source, '-B', build, '-G', 'Ninja', '-DCMAKE_C_COMPILER=clang', '-DCMAKE_BUILD_TYPE=Release')
if (test) {
  run('--build', build, '--target', 'hargan-ds-test')
  // Exits non-zero on any failed check, which fails this script too.
  execFileSync(path.join(build, 'diag', 'hargan-ds-test.exe'), { stdio: 'inherit' })
} else {
  run('--build', build)
}
