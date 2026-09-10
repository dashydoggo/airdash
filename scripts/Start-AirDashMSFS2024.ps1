[CmdletBinding()]
param(
    [string]$ExporterPath = 'D:\Creations\AirDash\Scripts\Update-AirDashPressStartVideo.ps1',
    [string]$SteamPath = 'C:\Program Files (x86)\Steam\steam.exe',
    [string]$AppId = '2537590',
    [string]$ExpectedOutputPath = 'D:\SteamLibrary\steamapps\common\MSFS2024\VIDEOS\PressStartVideo-4K.mp4',
    [string]$MsfsExecutablePath = 'D:\SteamLibrary\steamapps\common\MSFS2024\FlightSimulator2024.exe',
    [string]$ExportStatePath = 'D:\Creations\AirDash\Generated\last-export.json',
    [string]$LogPath = 'D:\Creations\AirDash\Generated\airDash-launcher.log'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:LauncherNotifyIcon = $null
$script:LauncherNotificationIcon = $null

function Show-LauncherNotification {
    param([string]$Title, [string]$Message)
    if (-not [Environment]::UserInteractive) { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        if ($null -eq $script:LauncherNotifyIcon) {
            $script:LauncherNotifyIcon = New-Object Windows.Forms.NotifyIcon
            if (Test-Path -LiteralPath $MsfsExecutablePath -PathType Leaf) {
                $script:LauncherNotificationIcon = [Drawing.Icon]::ExtractAssociatedIcon($MsfsExecutablePath)
                $script:LauncherNotifyIcon.Icon = $script:LauncherNotificationIcon
            }
            else {
                $script:LauncherNotifyIcon.Icon = [Drawing.SystemIcons]::Application
            }
            $script:LauncherNotifyIcon.Visible = $true
        }
        $script:LauncherNotifyIcon.BalloonTipTitle = $Title
        $script:LauncherNotifyIcon.BalloonTipText = $Message
        $script:LauncherNotifyIcon.BalloonTipIcon = [Windows.Forms.ToolTipIcon]::Info
        $script:LauncherNotifyIcon.ShowBalloonTip(7000)
    }
    catch {}
}

function Close-LauncherNotification {
    if ($null -ne $script:LauncherNotifyIcon) {
        $script:LauncherNotifyIcon.Visible = $false
        $script:LauncherNotifyIcon.Dispose()
        $script:LauncherNotifyIcon = $null
    }
    if ($null -ne $script:LauncherNotificationIcon) {
        $script:LauncherNotificationIcon.Dispose()
        $script:LauncherNotificationIcon = $null
    }
}

function Write-LauncherLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f [datetime]::Now.ToString('s'), $Message
    New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
    Add-Content -LiteralPath $LogPath -Value $line
    Write-Host $line
}

function Show-LauncherError {
    param([string]$Message)
    if (-not [Environment]::UserInteractive) { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][Windows.Forms.MessageBox]::Show($Message, 'airDash video update failed', [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error)
    }
    catch {}
}

try {
    if (-not (Test-Path -LiteralPath $ExporterPath -PathType Leaf)) {
        throw "Exporter not found: $ExporterPath"
    }
    if (-not (Test-Path -LiteralPath $SteamPath -PathType Leaf)) {
        throw "Steam executable not found: $SteamPath"
    }
    if (Get-Process -Name FlightSimulator2024 -ErrorAction SilentlyContinue) {
        throw 'Microsoft Flight Simulator 2024 is already running. Close it before refreshing the press-start video.'
    }
    if (Get-Process -Name POWERPNT -ErrorAction SilentlyContinue) {
        throw 'PowerPoint is open. Save and close it before refreshing the press-start video.'
    }

    Show-LauncherNotification -Title 'airDash' -Message 'Preparing MSFS. Updating and verifying the loading video before launch.'
    Write-LauncherLog 'Starting airDash PowerPoint export.'
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $ExporterPath
    if ($LASTEXITCODE -ne 0) {
        throw "The PowerPoint exporter exited with code $LASTEXITCODE. MSFS was not started."
    }
    if (-not (Test-Path -LiteralPath $ExportStatePath -PathType Leaf)) {
        throw "Exporter state file was not created: $ExportStatePath"
    }
    $state = Get-Content -LiteralPath $ExportStatePath -Raw | ConvertFrom-Json
    if (-not [bool]$state.ReplacementVerified) {
        throw 'Exporter did not verify the production video replacement.'
    }
    if ([IO.Path]::GetFullPath([string]$state.OutputPath) -ne [IO.Path]::GetFullPath($ExpectedOutputPath)) {
        throw "Exporter wrote an unexpected output path: $($state.OutputPath)"
    }
    if (-not (Test-Path -LiteralPath $ExpectedOutputPath -PathType Leaf)) {
        throw "Production video is missing after export: $ExpectedOutputPath"
    }
    $publishedHash = (Get-FileHash -LiteralPath $ExpectedOutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($publishedHash -ne [string]$state.OutputSha256) {
        throw 'Production video hash does not match the verified exporter state.'
    }
    Write-LauncherLog "Verified production video replacement: $publishedHash ($($state.OutputBytes) bytes, $($state.SlideCount) slides)."

    Write-LauncherLog "Video export completed. Starting Steam app $AppId."
    Show-LauncherNotification -Title 'airDash' -Message 'Loading video ready. Starting Microsoft Flight Simulator 2024.'
    Start-Process -FilePath $SteamPath -ArgumentList '-applaunch', $AppId
    Write-LauncherLog 'Steam launch request submitted.'
}
catch {
    Write-LauncherLog "ERROR: $($_.Exception.Message)"
    Show-LauncherError -Message $_.Exception.Message
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
finally {
    Close-LauncherNotification
}
