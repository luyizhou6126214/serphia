[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Installer,
    [string] $ReportPath,
    [switch] $RequireOffline
)

$ErrorActionPreference = 'Stop'
$installerFile = (Get-Item -LiteralPath $Installer).FullName
$defaultRoutes = @(Get-NetRoute -PolicyStore ActiveStore -ErrorAction Stop |
    Where-Object { $_.DestinationPrefix -in @('0.0.0.0/0', '::/0') })
if ($RequireOffline -and $defaultRoutes.Count -ne 0) {
    throw 'Run this acceptance test in a Windows guest with networking disabled.'
}
$existingInstalls = @(Get-ItemProperty -Path @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
) -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'serphia*' })
if ($existingInstalls.Count -or (Get-Process -Name serphia -ErrorAction SilentlyContinue)) {
    throw 'Use a clean Windows installation or guest. An existing Serphia install or process was found.'
}

$validationRoot = Join-Path ([IO.Path]::GetTempPath()) ('Serphia subagents ' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $validationRoot
$installDir = Join-Path $validationRoot 'Installed app'
$userData = Join-Path $validationRoot 'user-data'
$agentDir = Join-Path $validationRoot 'pi-agent'
$reportFile = Join-Path $userData 'packaged-startup-check.json'
$originalPath = $env:Path
$originalAgentDir = $env:PI_CODING_AGENT_DIR

function Invoke-ValidationProcess([string] $Executable, [string] $Arguments, [int] $TimeoutMs) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $validationRoot -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit($TimeoutMs)) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        throw "Validation timed out: $Executable"
    }
    return $process.ExitCode
}

try {
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
    $env:PI_CODING_AGENT_DIR = $agentDir
    if (Get-Command -Name pi, npm, node -ErrorAction SilentlyContinue) {
        throw 'The validation PATH unexpectedly exposes Pi, npm, or Node.'
    }
    $installExit = Invoke-ValidationProcess $installerFile "/S /D=$installDir" 180000
    if ($installExit -ne 0) { throw "NSIS installer exited with code $installExit." }
    $app = Join-Path $installDir 'serphia.exe'
    $appArguments = '--validate-packaged-subagents --user-data-dir="{0}" --disable-gpu' -f $userData
    $appExit = Invoke-ValidationProcess $app $appArguments 90000
    if (-not (Test-Path -LiteralPath $reportFile)) { throw "No packaged startup report. App exit code: $appExit" }
    $startup = Get-Content -LiteralPath $reportFile -Raw | ConvertFrom-Json
    if ($appExit -ne 0 -or -not $startup.ok -or -not $startup.runtimeModules.bundledSubagentsRoundTrip) {
        throw "Packaged subagents validation failed: $($startup.error)"
    }
    $report = [ordered]@{
        ok = $true
        offline = $defaultRoutes.Count -eq 0
        cleanAppProfile = $true
        externalPiNpmNodeOnPath = $false
        installerSha256 = (Get-FileHash -LiteralPath $installerFile).Hash
        startup = $startup
    } | ConvertTo-Json -Depth 8
    if ($ReportPath) { Set-Content -LiteralPath $ReportPath -Value $report -Encoding UTF8 }
    $report
} finally {
    try {
        $uninstaller = @(Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue)
        if ($uninstaller.Count -eq 1) {
            $uninstallExit = Invoke-ValidationProcess $uninstaller[0].FullName '/currentuser /S' 120000
            if ($uninstallExit -ne 0) { throw "NSIS uninstaller exited with code $uninstallExit." }
        }
    } finally {
        $env:Path = $originalPath
        $env:PI_CODING_AGENT_DIR = $originalAgentDir
    }
}
