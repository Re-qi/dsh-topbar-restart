/**
 * dsh-topbar-restart — Host half.
 *
 * Owns exactly one loopback route. The Web page (client.js) only *asks* for a
 * restart; every process decision happens here, inside the desktop Host, which
 * is the only process that knows which application it belongs to:
 *
 *   - the executable to start again is `process.execPath` — the desktop Host is
 *     spawned by the Electron main process as
 *     `<app exe> --expose-internals .../dsh-desktop-host/lib/index.js`, so the
 *     two are the same binary;
 *   - the process tree to stop is rooted at `process.ppid`, the Electron main
 *     process that owns the window.
 *
 * Why the stop/start runs in a *detached* helper: the Host is a child of that
 * very tree, so anything it spawns normally (`taskkill /PID <main> /T`) would
 * be killed by its own restart. `lib/spawn-detached.ps1` therefore creates
 * `lib/restart.cmd` through Win32_Process.Create, whose parent is WmiPrvSE —
 * outside the tree — so the helper survives the kill and starts the new
 * instance. The alternative (`app.relaunch()` in the Electron main process) is
 * not reachable from a plugin: the desktop shell exposes no restart IPC, and
 * its own tray entry is development-only.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Route the client half posts to. Kept in one place on both halves. */
export const RESTART_ROUTE = '/__dsh-topbar-restart/restart'

/** Custom request header: a cross-origin page cannot send it without a CORS
 * preflight this route never answers, so the header doubles as the CSRF gate. */
const GATE_HEADER = 'x-dsh-topbar-restart'
const GATE_VALUE = 'restart'

const LAUNCHER_PATH = fileURLToPath(new URL('./lib/spawn-detached.ps1', import.meta.url))
const LAUNCH_TIMEOUT_MS = 20000

/**
 * Strip IPv6 brackets so `[::1]` and `::1` compare equal.
 * @param {string} value - hostname or address.
 * @returns {string} lowercase bare hostname.
 */
function bareHostname(value) {
  return String(value).replace(/^\[|\]$/g, '').toLowerCase()
}

/**
 * @param {string} host - bare hostname or IP address.
 * @returns {boolean} whether the address names this machine's loopback.
 */
function isLoopbackHostname(host) {
  const name = bareHostname(host)
  return name === 'localhost' || name === '::1' || name === '0:0:0:0:0:0:0:1' || /^127\./u.test(name)
}

/**
 * Split a `Host` header into the parts the origin check compares.
 * @param {unknown} header - raw header value.
 * @returns {{ hostname: string, port: string } | null} parsed authority, or null.
 */
function parseHostHeader(header) {
  if (typeof header !== 'string' || header.length === 0) return null
  try {
    const url = new URL(`http://${header}`)
    return { hostname: url.hostname, port: url.port === '' ? '80' : url.port }
  } catch {
    return null
  }
}

/**
 * Refuse a request that did not come from this machine's own page.
 *
 * The desktop shell already rejects a foreign `Origin` before forwarding (and
 * deletes `Origin` on the way in), but this route also answers plain HTTP on
 * the Host port, where a DNS-rebinding page reaches it while looking
 * same-origin. What such a page cannot forge is the peer address or the `Host`
 * header the fetch re-fills from the URL it dialled.
 * @param {import('node:http').IncomingMessage} req - incoming request.
 * @param {string | undefined} bindHost - configured bind address, when known.
 * @returns {string | null} short refusal reason, or null when allowed.
 */
function gateRequest(req, bindHost) {
  const remote = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/iu, '')
  const bindMatches = typeof bindHost === 'string' && bareHostname(bindHost) === bareHostname(remote)
  if (!isLoopbackHostname(remote) && !bindMatches) return 'bad-remote'
  const host = parseHostHeader(req.headers.host)
  if (host === null) return 'bad-host'
  const hostIsLocal = isLoopbackHostname(host.hostname)
    || (typeof bindHost === 'string' && bareHostname(bindHost) === bareHostname(host.hostname))
  if (!hostIsLocal) return 'bad-host'
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin.length === 0) return null
  if (origin === 'dsh-app://app') return null
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return 'cross-origin'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'cross-origin'
  const defaultPort = parsed.protocol === 'https:' ? '443' : '80'
  if (bareHostname(parsed.hostname) !== bareHostname(host.hostname)) return 'cross-origin'
  if ((parsed.port === '' ? defaultPort : parsed.port) !== host.port) return 'cross-origin'
  return null
}

/**
 * Describe what a restart would do, without doing it.
 * @returns {object} plan with `supported`, a `reason` when unsupported, and the
 *   stop/start targets when supported.
 */
export function restartPlan() {
  if (process.platform !== 'win32') return { supported: false, reason: 'unsupported-platform' }
  const electron = process.versions?.electron
  if (typeof electron !== 'string' || electron.length === 0) return { supported: false, reason: 'unsupported-host' }
  const appExe = process.execPath
  const stem = basename(appExe).toLowerCase()
  if (stem === 'electron.exe' || stem === 'electron') return { supported: false, reason: 'development-host' }
  if (!existsSync(appExe)) return { supported: false, reason: 'app-missing' }
  if (!existsSync(LAUNCHER_PATH)) return { supported: false, reason: 'launcher-missing' }
  const mainPid = process.ppid
  if (!Number.isInteger(mainPid) || mainPid <= 0) return { supported: false, reason: 'unknown-owner' }
  return { supported: true, mainPid, appExe, launcher: LAUNCHER_PATH }
}

/**
 * @returns {string} the Windows PowerShell interpreter to spawn.
 */
function powershellPath() {
  const root = typeof process.env.SystemRoot === 'string' && process.env.SystemRoot !== ''
    ? process.env.SystemRoot
    : 'C:\\Windows'
  const candidate = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(candidate) ? candidate : 'powershell.exe'
}

/**
 * Create the detached restart helper and wait until it has been created.
 * The launcher exits as soon as Win32_Process.Create returns, so a zero exit
 * code is real evidence that the helper exists — not merely that it was asked
 * for. The helper then waits about two seconds before stopping the tree, which
 * keeps this response ahead of the connection closing.
 * @param {{ mainPid: number, appExe: string, launcher: string }} plan - targets.
 * @returns {Promise<{ ok: boolean, reason?: string, detail?: string }>} outcome.
 */
export function launchRestart(plan) {
  return new Promise((resolve) => {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      plan.launcher,
      '-MainPid',
      String(plan.mainPid),
      '-AppExe',
      plan.appExe,
    ]
    let child
    try {
      child = spawn(powershellPath(), args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ ok: false, reason: 'spawn-failed', detail: String(error?.message ?? error) })
      return
    }
    let stderr = ''
    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      settle({ ok: false, reason: 'launcher-timeout' })
    }, LAUNCH_TIMEOUT_MS)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.once('error', (error) => {
      settle({ ok: false, reason: 'spawn-failed', detail: String(error?.message ?? error) })
    })
    child.once('close', (code) => {
      if (code === 0) {
        settle({ ok: true })
        return
      }
      const detail = stderr.trim()
      settle({ ok: false, reason: 'launcher-failed', detail: detail === '' ? `exit ${String(code)}` : detail.slice(0, 600) })
    })
  })
}

/**
 * Write one JSON response. Route handlers own the whole response lifecycle.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {object} body - JSON-serialisable payload.
 */
function respond(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Build the route handler: GET reports availability, POST restarts.
 * @param {string | undefined} bindHost - listener bind address, when known.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} handler.
 */
export function createHandler(bindHost) {
  return async function handleRestart(req, res) {
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      respond(res, 405, { ok: false, reason: 'method-not-allowed' })
      return
    }
    const refusal = gateRequest(req, bindHost)
    if (refusal !== null) {
      respond(res, 403, { ok: false, reason: refusal })
      return
    }
    const plan = restartPlan()
    if (method === 'GET' || method === 'HEAD') {
      respond(res, 200, {
        ok: true,
        route: RESTART_ROUTE,
        supported: plan.supported,
        ...plan.supported ? {} : { reason: plan.reason },
        platform: process.platform,
      })
      return
    }
    if (req.headers[GATE_HEADER] !== GATE_VALUE) {
      respond(res, 403, { ok: false, reason: 'forbidden' })
      return
    }
    if (!plan.supported) {
      respond(res, 501, { ok: false, reason: plan.reason })
      return
    }
    const dry = new URL(req.url ?? RESTART_ROUTE, 'http://127.0.0.1').searchParams.get('dry') === '1'
    if (dry) {
      // Diagnostic only: reports the plan, never touches a process.
      req.resume()
      respond(res, 200, { ok: true, dry: true, mainPid: plan.mainPid, appExe: plan.appExe, launcher: plan.launcher })
      return
    }
    const outcome = await launchRestart(plan)
    if (!outcome.ok) {
      respond(res, 502, { ok: false, reason: outcome.reason, detail: outcome.detail ?? null })
      return
    }
    respond(res, 202, { ok: true, accepted: true, mainPid: plan.mainPid })
  }
}

/**
 * Host loader entry: mount the restart route when this composition has a web
 * server, and do nothing at all when it does not.
 * @param {object} ctx - host cordis context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    let bindHost
    try {
      const server = webCtx.webServer
      if (server && typeof server.host === 'string') bindHost = server.host
    } catch {}
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'exact', path: RESTART_ROUTE, handler: createHandler(bindHost) }),
      'dsh-topbar-restart: restart route',
    )
  })
}
