// Builds native/bin/hargan-ps-core.exe. Needs CMake, Ninja and llvm-mingw's clang on PATH;
// falls back to the Ninja that ships with Visual Studio.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'native', 'ps-core')
const build = path.join(root, 'native', 'build')

const vsNinja = 'C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja'
const env = { ...process.env }
if (existsSync(vsNinja)) env.PATH = `${vsNinja}${path.delimiter}${env.PATH}`

const run = (...args) => execFileSync('cmake', args, { stdio: 'inherit', env })
run('-S', source, '-B', build, '-G', 'Ninja', '-DCMAKE_C_COMPILER=clang', '-DCMAKE_BUILD_TYPE=Release')
run('--build', build)
