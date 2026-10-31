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

  Exit code 0 means the helper process exists, not merely that it was asked
  for. Anything else is reported to the page as a failed restart.
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

try {
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }
} catch {
  [Console]::Error.WriteLine("Win32_Process.Create failed: $($_.Exception.Message)")
  exit 5
}

if ($null -eq $created -or $created.ReturnValue -ne 0) {
  $code = if ($null -eq $created) { 'null' } else { $created.ReturnValue }
  [Console]::Error.WriteLine("Win32_Process.Create returned $code")
  exit 6
}

[Console]::Out.WriteLine("detached restart helper pid=$($created.ProcessId)")
exit 0
