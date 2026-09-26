[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$StablePort = 3100,

  [ValidateRange(1, 65535)]
  [int]$DevPort = 3101,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$projectRoot = $PSScriptRoot

if ($StablePort -eq $DevPort) {
  throw 'StablePort and DevPort must be different.'
}

function Stop-OutpaintServerOnPort {
  param([int]$ServerPort)

  $listener = Get-NetTCPConnection -LocalPort $ServerPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) {
    return
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $commandLine = $process.CommandLine
  $isThisProject = $commandLine -and
    $commandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine.IndexOf('\node_modules\', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine.IndexOf('next', [StringComparison]::OrdinalIgnoreCase) -ge 0

  if (-not $isThisProject) {
    throw "Port $ServerPort is occupied by another process (PID $($listener.OwningProcess))."
  }

  Write-Host "Stopping server on port $ServerPort (PID $($listener.OwningProcess))..."
  Stop-Process -Id $listener.OwningProcess -Force
  try {
    Wait-Process -Id $listener.OwningProcess -Timeout 5 -ErrorAction Stop
  } catch {
    if (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue) {
      throw "Failed to stop server on port $ServerPort."
    }
  }
}

function Test-OutpaintServerOnPort {
  param([int]$ServerPort)

  $listener = Get-NetTCPConnection -LocalPort $ServerPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) {
    return $false
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  $commandLine = $process.CommandLine
  return [bool]($commandLine -and
    $commandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine.IndexOf('\node_modules\', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine.IndexOf('next', [StringComparison]::OrdinalIgnoreCase) -ge 0)
}

function Remove-BuildDirectory {
  param([string]$DirectoryName)

  $directory = Join-Path $projectRoot $DirectoryName
  if (-not (Test-Path -LiteralPath $directory)) {
    return
  }

  $resolvedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')
  $resolvedDirectory = [System.IO.Path]::GetFullPath($directory)
  if (-not $resolvedDirectory.StartsWith("$resolvedProjectRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe Next.js build path: $resolvedDirectory"
  }

  Write-Host "Cleaning $DirectoryName..."
  Remove-Item -LiteralPath $resolvedDirectory -Recurse -Force
}

function Wait-ForServer {
  param(
    [int]$ServerPort,
    [System.Diagnostics.Process]$ServerProcess
  )

  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if ($ServerProcess.HasExited) {
      throw "Server process for port $ServerPort exited with code $($ServerProcess.ExitCode)."
    }

    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ServerPort/" -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 400
    }
  }

  throw "Server on port $ServerPort did not start in time."
}

$pathBytes = [Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())
$pathHashBytes = [Security.Cryptography.SHA256]::Create().ComputeHash($pathBytes)
$pathHash = ([BitConverter]::ToString($pathHashBytes)).Replace('-', '').Substring(0, 16)
$startMutex = New-Object Threading.Mutex($false, "Local\OutpaintStudioStart-$pathHash")
$mutexAcquired = $false

try {
  try {
    $mutexAcquired = $startMutex.WaitOne([TimeSpan]::FromMinutes(2))
  } catch [Threading.AbandonedMutexException] {
    $mutexAcquired = $true
  }

  if (-not $mutexAcquired) {
    throw 'Timed out waiting for another launcher process.'
  }

  $stableRunning = Test-OutpaintServerOnPort -ServerPort $StablePort
  $devRunning = Test-OutpaintServerOnPort -ServerPort $DevPort
  if (-not $Force -and $stableRunning -and $devRunning) {
    Write-Host 'Outpaint Studio is already running. Reusing existing servers.'
    Write-Host "Stable: http://localhost:$StablePort"
    Write-Host "Dev:    http://localhost:$DevPort"
    return
  }

  Stop-OutpaintServerOnPort -ServerPort $StablePort
  Stop-OutpaintServerOnPort -ServerPort $DevPort

  foreach ($directoryName in @('.next', '.next-local', '.next-stable', '.next-dev')) {
    Remove-BuildDirectory -DirectoryName $directoryName
  }

  Write-Host 'Building stable Outpaint Studio...'
  $env:OUTPAINT_DIST_DIR = '.next-stable'
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Stable build failed with code $LASTEXITCODE."
  }

  Write-Host 'Starting stable and dev servers...'
  $env:OUTPAINT_DIST_DIR = '.next-stable'
  $stableProcess = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'start', '--', '-p', "$StablePort") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru

  $env:OUTPAINT_DIST_DIR = '.next-dev'
  $devProcess = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'dev', '--', '-p', "$DevPort") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru

  Wait-ForServer -ServerPort $StablePort -ServerProcess $stableProcess
  Wait-ForServer -ServerPort $DevPort -ServerProcess $devProcess

  Write-Host ''
  Write-Host "Stable: http://localhost:$StablePort"
  Write-Host "Dev:    http://localhost:$DevPort"
} finally {
  Remove-Item Env:OUTPAINT_DIST_DIR -ErrorAction SilentlyContinue
  if ($mutexAcquired) {
    $startMutex.ReleaseMutex()
  }
  $startMutex.Dispose()
}
