# Changelog

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
