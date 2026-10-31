# dsh-topbar-restart · DSH 顶栏一键重启

在 DSH 桌面端（Windows）的标题栏、**最小化按钮左边**加一个 `⏻ 重启` 按钮：点一下，DSH 关闭，
随后自动重新拉起同一个应用。

![标题栏效果](docs/titlebar-right.png)

- **位置**：标题栏 40px 条带内，紧挨原生 最小化 / 最大化 / 关闭 的左侧（8px 间距）；全屏时原生按钮消失，它自动贴到右边 12px。
- **一次点击**：结束整棵进程树（主进程 + Host 子进程 + 渲染/GPU/utility + 插件拉起的子进程）→ 等端口释放 → 重新启动同一个 exe。全程约 4~6 秒。
- 只在 **Windows 桌面客户端**出现；在浏览器里打开同一 Web UI 时不渲染（那里没有标题栏，也没有进程可重启）。
- 文案跟随 DSH 语言设置（中文「重启」/ English "Restart"）。

## 安装

### 1. 插件市场（推荐）

本仓库打了 **`dsh-plugin`** topic，会被 DSH 插件市场（`dsh-plugin-console` 的静态索引，GitHub Actions 每 6 小时重建一轮）
自动收录，**无需申请、无需审核**：

> 设置 → 插件 → 市场 → 搜 `dsh-topbar-restart` → 添加

索引还没轮到本仓库时，市场的**实时搜索**（GitHub 源）也能直接搜到它。

### 2. 手动安装（等价于市场做的事）

市场在没有 npm 包时会自动降级到 **GitHub Release 资产 → git 克隆**，并把包物化到
`~/.dsh/plugin-src/<pkg>`、在 profile 里写 `link:`。手动照做：

```powershell
git clone https://github.com/Re-qi/dsh-topbar-restart.git "$env:USERPROFILE\.dsh\plugins-src\dsh-topbar-restart"
```

然后在 profile（例如 `~/.dsh/profiles/desktop/`）里：

1. `package.json` 的 `dependencies` 加一行
   `"dsh-topbar-restart": "link:C:/Users/<you>/.dsh/plugins-src/dsh-topbar-restart"`
2. 同一个 `package.json` 的 `dsh.profile.bundles` 末尾加 `"dsh-topbar-restart"`
3. 重启 DSH

## 重启是怎么做到的

```
点击 ⏻ 重启
  └─ 页面 POST /__dsh-topbar-restart/restart        （client.js）
       └─ Host 判定：真在桌面客户端？execPath 是应用？ppid 是窗口主进程？   （index.js）
            └─ lib/spawn-detached.ps1 用 Win32_Process.Create 造出 lib/restart.cmd
                 └─ restart.cmd：等 2s → taskkill /PID <主进程> /T /F → 等进程消失 → start 同一个 exe
```

三个关键取舍：

- **为什么绕一层**：插件跑在 Host 里，而 Host 是 Electron 主进程的**子进程**。直接 `taskkill /T` 会把自己也杀掉，
  永远走不到「重新拉起」。所以真正的助手必须在**进程树之外**创建 —— `Win32_Process.Create` 造出来的进程父进程是
  `WmiPrvSE.exe`，`/T` 杀不到它。
- **为什么助手是 `.cmd` 而不是 `.ps1`**：实测在装有 HIPS/脚本防护的机器上，**由 WMI 创建的 PowerShell 会在脚本执行前
  就被拦掉**（`拒绝访问`），而 `taskkill` / `tasklist` / `start` 组成的批处理能正常跑。
- **为什么不用 `app.relaunch()`**：桌面外壳没有向页面开放重启 IPC，它自带的「重启应用与 Host」只存在于开发构建的托盘菜单。

## 诊断

- 每一步都写进 `%TEMP%\dsh-topbar-restart.log`（时间、PID、taskkill 结果、启动目标、失败原因）——
  窗口已经关掉之后仍然可以查。
- 路由自带探针，都不动进程：
  - `GET /__dsh-topbar-restart/restart` → 是否支持、平台；
  - `POST /__dsh-topbar-restart/restart?dry=1`（带头 `x-dsh-topbar-restart: restart`）→ 只返回将要执行的计划。
- 页面侧失败会直接显示在按钮上（如「重启失败 (launcher-failed)」）；20 秒内没关掉就退回可点状态并提示
  「重启没有生效：应用仍在运行」。

## 边界与已知取舍

- 仅 **Windows 桌面客户端**；其他平台 / 浏览器里路由返回 501，按钮不渲染。
- 是**强制结束**（`taskkill /F`），不弹「还有任务在跑」的确认框。已落盘的会话数据不受影响，
  但正在流式写入的最后一条记录可能被截断（与在任务管理器里结束进程相同）。
- 重新拉起只重放可执行文件本身：启动时附加的命令行参数不会重放，`start-dsh.bat` 里的 cookie 清理也不会重跑。
- 按钮位置按 Electron `titleBarOverlay` 的固定几何计算（标题栏 40px、右侧三个原生按钮共占 138px）；
  若上游改了这两项，改 `client.js` 里的两个常量即可。

## 兼容性

DSH `0.2.1-rc.3` 桌面端实测通过。插件只用了三个稳定接口（`webServer.register`、`ctx.slots`、`ctx.locale`）
加一个 `shell.overlay` 槽位，没有读取任何别的插件的 DOM 或样式。

## 目录

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半：重启路由、可用性判定、启动器调用 |
| `client.js` | 浏览器半：标题栏按钮（`shell.overlay`）、文案、状态机 |
| `lib/spawn-detached.ps1` | 用 WMI 在进程树外创建助手 |
| `lib/restart.cmd` | 助手：杀进程树 + 重新拉起 |
| `locale/*.json` | 插件列表里的标题与描述 |
| `icon.svg` | 插件图标 |
| `docs/titlebar*.png` | 标题栏实拍 |

## 卸载

插件页里关掉或卸载 `dsh-topbar-restart` 即可：按钮随客户端模块一起消失，Host 路由注销。

---

## English

A one-click restart button for the DSH desktop client on Windows. It sits in the caption strip,
immediately left of the native minimise button:

- **Click** → the page `POST`s to a loopback Host route → the Host stops the whole application
  process tree (`taskkill /PID <main> /T /F`) and then starts the same executable again.
- The helper that does the stopping must live **outside** that tree: the plugin runs inside the
  Host, which is a *child* of the Electron main process, so a normal `taskkill /T` would kill the
  helper too. `lib/spawn-detached.ps1` therefore creates `lib/restart.cmd` through
  `Win32_Process.Create`, whose parent is `WmiPrvSE.exe` and therefore survives the kill. The
  helper is a batch file rather than PowerShell because WMI-launched PowerShell is blocked by
  HIPS/script-guard software before it can run.
- Windows desktop only. In a plain browser the button is not rendered (no caption strip, no
  process to restart) and the route answers 501.

Install: the repository carries the `dsh-plugin` topic, so the DSH plugin market picks it up
automatically — **Settings → Plugins → Market → search `dsh-topbar-restart`**. Without an npm
package the market falls back to the GitHub Release asset, then to a git clone plus a `link:`
entry.

Diagnostics: `%TEMP%\dsh-topbar-restart.log`, `GET /__dsh-topbar-restart/restart`, and
`POST /__dsh-topbar-restart/restart?dry=1` (header `x-dsh-topbar-restart: restart`) which reports
the plan without touching a process.

Limits: it is a hard kill (no "tasks are still running" confirmation), and only the executable is
replayed — extra CLI arguments are not.

MIT licensed.
