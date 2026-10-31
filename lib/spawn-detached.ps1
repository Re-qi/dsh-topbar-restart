<#
.SYNOPSIS
  Creates the restart helper outside the process tree it is about to stop.

.DESCRIPTION
  Called by the Host (index.js) as a short-lived child; it restarts nothing
  itself. It asks WMI's provider host to create lib/restart.cmd, so the helper's
  parent is WmiPrvSE.exe instead of the DSH process tree. `taskkill /T` on the
  application's main process therefore cannot reach the helper, which is what
  makes "stop the app, then start it again" possible from inside the app.

  The helper is a batch file, not another PowerShell script: Windows blocks
  powershell.exe when it is launched through WMI on machines with a HIPS /
  script-guard (measured here: `Access is denied` before the script runs), while
  a batch file built from taskkill/tasklist/start passes.

  Win32_Process.Create would give that cmd.exe a visible console window for the
  two or three seconds the restart takes, so it is created with
  Win32_ProcessStartup.ShowWindow = 0 (SW_HIDE): the console exists but is never
  shown, and nothing flashes on screen.

  This file must stay PURE ASCII with CRLF line endings, like restart.cmd:
  Windows PowerShell 5.1 reads a .ps1 as ANSI when it carries no BOM, so a stray
  UTF-8 byte can corrupt the parse. scripts/check-lib-encoding.mjs enforces it.

  Exit code 0 means the helper process exists, not merely that it was asked for.
  Anything else is reported to the page as a failed restart.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$MainPid,
  [Parameter(Mandatory = $true)][string]$AppExe
)

$ErrorActionPreference = 'Stop'

$helper = Join-Path -Path $PSScriptRoot -ChildPath 'restart.cmd'
if (-not (Test-Path -LiteralPath $helper)) {
  [Console]::Error.WriteLine("restart helper missing: $helper")
  exit 4
}

# Win32_Process.Create takes one raw command line, so the batch path and the
# application path each carry their own quotes, and the whole thing is wrapped
# once more for `cmd /c`.
$inner = '""{0}" "{1}" "{2}""' -f $helper, $MainPid, $AppExe
$commandLine = 'cmd.exe /c ' + $inner

$created = $null
$channel = $null

# 1. Preferred: CIM create with SW_HIDE startup information.
try {
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 } -ErrorAction Stop
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $commandLine
    ProcessStartupInformation = $startup
  } -ErrorAction Stop
  $channel = 'cim-hidden'
} catch {
  $created = $null
}

# 2. Same thing through the WMI type accelerator, for hosts where the CIM
#    cmdlets cannot build an embedded Win32_ProcessStartup instance.
if ($null -eq $created) {
  try {
    $legacyStartup = ([wmiclass]'Win32_ProcessStartup').CreateInstance()
    $legacyStartup.ShowWindow = 0
    $created = ([wmiclass]'Win32_Process').Create($commandLine, $null, $legacyStartup)
    $channel = 'wmi-hidden'
  } catch {
    $created = $null
  }
}

# 3. Last resort: a visible console window is worse than nothing, but a restart
#    that works beats a silent failure.
if ($null -eq $created) {
  try {
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine } -ErrorAction Stop
    $channel = 'cim-visible'
  } catch {
    [Console]::Error.WriteLine("Win32_Process.Create failed: $($_.Exception.Message)")
    exit 5
  }
}

if ($null -eq $created -or $created.ReturnValue -ne 0) {
  $code = if ($null -eq $created) { 'null' } else { $created.ReturnValue }
  [Console]::Error.WriteLine("Win32_Process.Create returned $code")
  exit 6
}

[Console]::Out.WriteLine("detached restart helper pid=$($created.ProcessId) channel=$channel")
exit 0
