/**
 * dsh-topbar-restart — browser half.
 *
 * One button in the Windows caption strip, immediately left of the native
 * minimise/maximise/close buttons. Clicking it asks the Host route
 * (/__dsh-topbar-restart/restart, see index.js) to stop the desktop application
 * and start it again; this half never touches a process itself.
 *
 * Placement: `shell.overlay` is the frame-wide floating layer, so an entry here
 * sits above every column. Electron's `titleBarOverlay` draws the three native
 * caption buttons over the page: 46 DIP each, 138 DIP in total, pinned to the
 * right edge of the 40 px strip that the desktop preload announces as
 * `--dsh-windows-titlebar-height`. The button keeps clear of that band and opts
 * out of the strip's drag region so a click reaches it instead of the window.
 */
window.__ModuleLoader__.load({
  id: 'dsh-topbar-restart',
  factory(require) {
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    /** Host route; kept identical to RESTART_ROUTE in index.js. */
    var ROUTE = '/__dsh-topbar-restart/restart'
    /** Cross-origin pages cannot send this header without a preflight the route
     * never answers, so it doubles as the request's CSRF gate. */
    var GATE_HEADERS = { 'x-dsh-topbar-restart': 'restart' }
    /** Width of Electron's three native caption buttons, in CSS px. */
    var CAPTION_BUTTONS_WIDTH = 138
    /** Breathing room between this button and the minimise button. */
    var CAPTION_GAP = 8
    /** How long the button stays disabled waiting for the app to go down. */
    var ACCEPTED_TIMEOUT_MS = 20000
    /** How long a failure stays readable in the caption before it clears. */
    var FAILURE_LINGER_MS = 8000
    var NS = 'topbarRestart'

    var zh = {
      'button.label': '重启',
      'button.title': '重启 DSH（关闭后自动重新拉起）',
      'button.busy': '正在重启…',
      'button.accepted': '已请求重启，应用即将关闭并自动重新打开。',
      'button.failed': '重启失败',
      'button.timeout': '重启没有生效：应用仍在运行。',
      'reason.unsupported-platform': '只有 Windows 桌面版可以一键重启。',
      'reason.unsupported-host': '当前不是桌面客户端，无法重启进程。',
      'reason.development-host': '开发模式下的 Electron 不支持一键重启。',
      'reason.app-missing': '找不到应用可执行文件。',
      'reason.launcher-missing': '重启脚本缺失，请重新安装插件。',
      'reason.unknown-owner': '无法确定桌面主进程，重启已取消。',
      'reason.forbidden': '请求被拒绝。',
      'reason.bad-remote': '请求来源不可信，已拒绝。',
      'reason.bad-host': '请求主机不匹配，已拒绝。',
      'reason.cross-origin': '请求来源不匹配，已拒绝。',
      'reason.spawn-failed': '无法启动重启脚本（PowerShell）。',
      'reason.launcher-failed': '重启脚本启动失败。',
      'reason.launcher-timeout': '重启脚本没有响应。',
      'reason.request-failed': '连不上 DSH 后台，重启没有执行。',
    }
    var en = {
      'button.label': 'Restart',
      'button.title': 'Restart DSH (closes the app, then starts it again)',
      'button.busy': 'Restarting…',
      'button.accepted': 'Restart requested. The app will close and reopen by itself.',
      'button.failed': 'Restart failed',
      'button.timeout': 'The restart did not happen: the app is still running.',
      'reason.unsupported-platform': 'One-click restart is Windows desktop only.',
      'reason.unsupported-host': 'Not a desktop client: there is no process to restart.',
      'reason.development-host': 'Electron in development mode cannot restart this way.',
      'reason.app-missing': 'The application executable was not found.',
      'reason.launcher-missing': 'Restart script missing; reinstall the plugin.',
      'reason.unknown-owner': 'Could not identify the desktop main process.',
      'reason.forbidden': 'The request was refused.',
      'reason.bad-remote': 'Refused: the request did not come from this machine.',
      'reason.bad-host': 'Refused: the request host does not match.',
      'reason.cross-origin': 'Refused: the request origin does not match.',
      'reason.spawn-failed': 'Could not start the restart script (PowerShell).',
      'reason.launcher-failed': 'The restart script failed to start.',
      'reason.launcher-timeout': 'The restart script did not answer.',
      'reason.request-failed': 'Could not reach the DSH backend; nothing was restarted.',
    }

    var CSS = [
      '.dshtr_btn{position:fixed;top:calc((var(--dsh-windows-titlebar-height,40px) - 28px) / 2);z-index:30;',
      'display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;min-width:28px;',
      'padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);',
      'font-family:inherit;font-size:13px;line-height:1;white-space:nowrap;cursor:pointer;-webkit-app-region:no-drag}',
      '.dshtr_btn:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);',
      'color:var(--dsw-alias-label-primary)}',
      '.dshtr_btn:active{background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent)}',
      '.dshtr_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      ".dshtr_btn[data-busy='true']{cursor:progress;color:var(--dsw-alias-label-secondary);",
      'background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent)}',
      ".dshtr_btn[data-phase='error']{color:var(--dsw-alias-state-error-primary)}",
      '.dshtr_btn svg{display:block;flex:none}',
      '.dshtr_spin{animation:dshtr_spin .9s linear infinite}',
      '@keyframes dshtr_spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.dshtr_spin{animation:none}}',
    ].join('')

    /**
     * The Windows caption strip only exists in the desktop shell: the preload
     * marks the root with `data-windows-titlebar` (and `data-fullscreen` while
     * the window is fullscreen, when the native buttons are gone).
     * @returns {{ visible: boolean, fullscreen: boolean }} current strip state.
     */
    function readCaptionState() {
      var root = document.documentElement
      if (root === null) return { visible: false, fullscreen: false }
      return {
        visible: root.dataset.platform === 'win32' && root.hasAttribute('data-windows-titlebar'),
        fullscreen: root.hasAttribute('data-fullscreen'),
      }
    }

    /**
     * Follow the strip state, so the button appears on a desktop load and moves
     * back from the (now empty) caption band when the window goes fullscreen.
     * @returns {{ visible: boolean, fullscreen: boolean }} live state.
     */
    function useCaptionState() {
      var state = useState(readCaptionState)
      var caption = state[0]
      var setCaption = state[1]
      useEffect(function () {
        var root = document.documentElement
        if (root === null) return undefined
        var sync = function () { setCaption(readCaptionState()) }
        sync()
        var observer = new MutationObserver(sync)
        observer.observe(root, {
          attributes: true,
          attributeFilter: ['data-platform', 'data-windows-titlebar', 'data-fullscreen'],
        })
        return function () { observer.disconnect() }
      }, [])
      return caption
    }

    /** @returns {object} the restart glyph (a power cycle: circle + switch bar). */
    function icon(spinning) {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': 'true',
          className: spinning ? 'dshtr_spin' : undefined,
        },
        h('path', {
          d: 'M4.7 4.2a5 5 0 1 0 6.6 0',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M8 2.2v4.6',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * @param {string} reason - route reason code.
     * @param {string} detail - optional technical detail.
     * @param {(key: string) => string} t - translator.
     * @returns {string} user-facing failure text.
     */
    function failureText(reason, detail, t) {
      var known = typeof reason === 'string' && reason !== '' ? t('reason.' + reason) : ''
      var text = known !== '' && known !== 'reason.' + reason ? known : t('button.failed')
      if (typeof detail === 'string' && detail !== '') return text + ' (' + detail + ')'
      if (typeof reason === 'string' && reason !== '' && text === t('button.failed')) return text + ' (' + reason + ')'
      return text
    }

    /**
     * The caption button itself.
     * @param {{ t: (key: string) => string }} props - slot props (locale seat).
     * @returns {object | null} the button, or null outside the desktop shell.
     */
    function RestartButton(props) {
      // The slot hands over a translator bound to this namespace; keep a local
      // fallback so a build without the locale seat still renders English
      // instead of raw keys.
      var t = typeof props.t === 'function'
        ? props.t
        : function (key) { return en[key] !== undefined ? en[key] : key }
      var caption = useCaptionState()
      var phaseState = useState('idle')
      var phase = phaseState[0]
      var setPhase = phaseState[1]
      var detailState = useState('')
      var detail = detailState[0]
      var setDetail = detailState[1]

      var busy = phase === 'sending' || phase === 'requested'

      // The page dies with the app it asked to restart, so a "requested" state
      // that outlives the app means the restart never happened: give the button
      // back instead of leaving a dead control in the caption. A failure text is
      // transient for the same reason — the strip is not a log.
      useEffect(function () {
        var timer
        if (phase === 'requested') {
          timer = setTimeout(function () {
            setPhase('error')
            setDetail(t('button.timeout'))
          }, ACCEPTED_TIMEOUT_MS)
        } else if (phase === 'error') {
          timer = setTimeout(function () {
            setPhase('idle')
            setDetail('')
          }, FAILURE_LINGER_MS)
        }
        return function () { if (timer !== undefined) clearTimeout(timer) }
      }, [phase])

      if (!caption.visible) return null

      var restart = function () {
        if (busy) return
        setPhase('sending')
        setDetail('')
        var request
        try {
          request = fetch(ROUTE, {
            method: 'POST',
            headers: GATE_HEADERS,
            body: '{}',
            cache: 'no-store',
          })
        } catch (error) {
          setPhase('error')
          setDetail(failureText('request-failed', String(error && error.message ? error.message : error), t))
          return
        }
        request.then(function (response) {
          return response.json().then(
            function (body) { return { response: response, body: body } },
            function () { return { response: response, body: null } },
          )
        }).then(function (result) {
          var body = result.body
          if (result.response.ok && body && body.ok === true) {
            setPhase('requested')
            setDetail(t('button.accepted'))
            return
          }
          setPhase('error')
          setDetail(failureText(body && body.reason, body && body.detail, t))
        }, function () {
          setPhase('error')
          setDetail(failureText('request-failed', '', t))
        })
      }

      var label = phase === 'error' ? detail : busy ? t('button.busy') : t('button.title')
      var captionText = phase === 'error' ? t('button.failed') : busy ? t('button.busy') : t('button.label')
      return h(
        React.Fragment,
        null,
        h('style', { key: 'style' }, CSS),
        h(
          'button',
          {
            key: 'button',
            type: 'button',
            className: 'dshtr_btn',
            'data-phase': phase,
            'data-busy': busy ? 'true' : 'false',
            'aria-label': t('button.title'),
            'aria-busy': busy ? 'true' : undefined,
            title: label,
            style: { right: (caption.fullscreen ? 12 : CAPTION_BUTTONS_WIDTH + CAPTION_GAP) + 'px' },
            onClick: restart,
          },
          icon(busy),
          h('span', null, captionText),
        ),
      )
    }

    var exports = {}
    exports.inject = ['slots', 'locale']
    exports.apply = function (ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-topbar-restart: dictionaries')
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({
          name: 'shell.overlay',
          id: 'topbar-restart',
          order: 100,
          locale: NS,
        }, RestartButton)
      })
    }
    return exports
  },
})
