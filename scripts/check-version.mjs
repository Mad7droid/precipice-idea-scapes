// The app version has one source of truth: package.json.
//
// `src-tauri/tauri.conf.json` reads it directly ("version": "../package.json"), so the bundled
// CFBundleShortVersionString follows package.json. The Rust crate version cannot reference another
// file, so this check fails the build when it drifts instead of letting two versions ship.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8')

const pkg = JSON.parse(read('package.json')).version
const cargo = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const tauri = JSON.parse(read('src-tauri/tauri.conf.json')).version

const problems = []
if (tauri !== '../package.json') {
  problems.push(`src-tauri/tauri.conf.json version should be "../package.json", found ${JSON.stringify(tauri)}`)
}
if (cargo !== pkg) {
  problems.push(`src-tauri/Cargo.toml version ${cargo} does not match package.json ${pkg}`)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(`Version ${pkg} is consistent across package.json, Cargo.toml, and tauri.conf.json.`)
