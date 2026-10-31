/**
 * Pre-pack guard for the two helper scripts the Host runs on Windows.
 *
 * Why this exists: cmd.exe reads a `.cmd` through the OEM code page (GBK on a
 * Chinese Windows). A single UTF-8 byte outside ASCII can be taken as a
 * double-byte lead and swallow the following newline, after which the batch
 * parser desynchronises: comment text gets executed as a command and a `goto`
 * can loop forever. That shipped once (1.0.0 / 1.0.1 carried an em dash in a
 * comment) and produced an endless
 *   'dsh-topbar-restart' is not recognized as an internal or external command
 * window. PowerShell 5.1 has the same ANSI-without-BOM hazard for `.ps1`.
 *
 * So: both helpers must be pure ASCII, and line endings must be CRLF.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILES = ['../lib/restart.cmd', '../lib/spawn-detached.ps1']

let failed = false
for (const relative of FILES) {
  const path = fileURLToPath(new URL(relative, import.meta.url))
  const bytes = readFileSync(path)
  const problems = []

  const nonAscii = []
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] > 0x7f) nonAscii.push(i)
  }
  if (nonAscii.length > 0) {
    problems.push(`${nonAscii.length} non-ASCII byte(s), first at offset ${nonAscii[0]} (0x${bytes[nonAscii[0]].toString(16)})`)
  }

  let crlf = 0
  let loneLf = 0
  let loneCr = 0
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0d) {
      if (bytes[i + 1] === 0x0a) crlf += 1
      else loneCr += 1
    } else if (bytes[i] === 0x0a && bytes[i - 1] !== 0x0d) {
      loneLf += 1
    }
  }
  if (loneLf > 0) problems.push(`${loneLf} LF line ending(s) without CR`)
  if (loneCr > 0) problems.push(`${loneCr} lone CR byte(s)`)
  if (crlf === 0) problems.push('no CRLF line endings at all')

  if (problems.length === 0) {
    console.log(`ok   ${relative} (${bytes.length} bytes, ${crlf} CRLF)`)
    continue
  }
  failed = true
  console.error(`FAIL ${relative}: ${problems.join('; ')}`)
}

if (failed) {
  console.error('\nWindows helpers must be pure ASCII with CRLF line endings. Fix the bytes before packing.')
  process.exit(1)
}
