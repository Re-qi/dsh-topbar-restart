# Changelog

## 1.0.3 — 2026-11-01

体验：重启全程**不闪控制台窗口**。

- `lib/spawn-detached.ps1` 创建助手时带 `Win32_ProcessStartup.ShowWindow = 0`（SW_HIDE）：
  `Win32_Process.Create` 默认会给助手开一个可见的 cmd 窗口，点一次按钮就闪一下；现在控制台存在但从不显示。
- 三级降级：CIM（`cim-hidden`）→ WMI 类型加速器（`wmi-hidden`）→ 无 startup 信息（`cim-visible`，
  宁可闪窗也要能重启）；启动器把实际用的通道写进 stdout，便于排查。
- 实测：替身进程树上采样 8 秒，launcher 与 helper 全程零可见窗口，杀树与拉起均正常。

## 1.0.2 — 2026-10-31

修复：助手批处理在中文（GBK）控制台下可能解析错乱。

- `lib/restart.cmd` / `lib/spawn-detached.ps1` 改为**纯 ASCII + CRLF**。原来注释里各有一个 em dash（UTF-8
  `E2 80 94`），cmd.exe 按 OEM 代码页读取时 `0x94` 会被当作双字节前导、吞掉换行；行边界错乱后注释文字
  会被当成命令执行（`'dsh-topbar-restart' 不是内部或外部命令`），`goto` 还可能死循环。
- 新增 `scripts/check-lib-encoding.mjs` 并挂到 `prepack`：发布前强制校验两个脚本是纯 ASCII + CRLF，
  这类字节问题不会再发出去。
- 重启链路逻辑与 1.0.1 一致。

## 1.0.1 — 2026-10-31

- 发布到 npm：`dsh-topbar-restart`，市场走 registry 通道读清单并安装。
- README 补齐安装方式（市场 / 命令行 / 手动 link）与徽章；`.gitignore` 忽略 `.npmrc`。
- 代码与 1.0.0 一致。

## 1.0.0 — 2026-10-31

首个版本。

- 标题栏（最小化按钮左侧）新增 `⏻ 重启` 按钮，只在 Windows 桌面客户端渲染。
- 点击后结束整棵 DSH 进程树，并自动重新启动同一个可执行文件。
- 助手进程通过 `Win32_Process.Create` 在进程树之外创建（父进程 `WmiPrvSE.exe`），
  因此不会被自己发出的 `taskkill /T` 杀掉。
- 每一步写入 `%TEMP%\dsh-topbar-restart.log`；路由提供 `GET` 探针与 `?dry=1` 计划预览。
- 中英文案跟随 DSH 语言设置；失败原因直接显示在按钮上，20 秒超时后退回可点状态。
