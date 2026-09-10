$ErrorActionPreference = 'Stop'
$exporter = 'D:\Creations\AirDash\Scripts\Update-AirDashPressStartVideo.ps1'
$fixture = 'D:\Creations\AirDash\Scripts\powerpoint-demo-flight.json'
$generated = 'D:\Creations\AirDash\Generated'
$presentation = Join-Path $generated 'airDash-demo-corrected.pptx'
$video = Join-Path $generated 'PressStartVideo-demo-corrected.mp4'
$statusPath = Join-Path $generated 'demo-export-status.json'
$logPath = Join-Path $generated 'demo-export.log'
$player = 'C:\Program Files\Windows Media Player\wmplayer.exe'

New-Item -ItemType Directory -Path $generated -Force | Out-Null
Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue

function Write-Log {
    param([string]$Message)
    Add-Content -LiteralPath $logPath -Value ('[{0}] {1}' -f [datetime]::Now.ToString('s'), $Message)
}

try {
    Write-Log "Starting demo export in interactive session $((Get-Process -Id $PID).SessionId)."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $exporter `
        -FlightDataPath $fixture `
        -GeneratedPresentationPath $presentation `
        -OutputPath $video `
        -VerticalResolution 1080 `
        -FramesPerSecond 30 `
        -Quality 90 `
        -TimeoutMinutes 30 | Add-Content -LiteralPath $logPath
    if ($LASTEXITCODE -ne 0) { throw "Exporter exited with code $LASTEXITCODE." }
    if (-not (Test-Path -LiteralPath $video -PathType Leaf)) { throw 'Demo video was not created.' }

    Write-Log 'Demo export completed. Opening it in Windows Media Player.'
    $playerProcess = Start-Process -FilePath $player -ArgumentList @('/new', ('"{0}"' -f $video)) -PassThru
    [pscustomobject][ordered]@{
        Success = $true
        CompletedUtc = [datetime]::UtcNow.ToString('o')
        SessionId = (Get-Process -Id $PID).SessionId
        PresentationPath = $presentation
        PresentationBytes = (Get-Item -LiteralPath $presentation).Length
        VideoPath = $video
        VideoBytes = (Get-Item -LiteralPath $video).Length
        PlayerProcessId = $playerProcess.Id
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Write-Log "Windows Media Player started with process ID $($playerProcess.Id)."
}
catch {
    [pscustomobject][ordered]@{
        Success = $false
        FailedUtc = [datetime]::UtcNow.ToString('o')
        SessionId = (Get-Process -Id $PID).SessionId
        Error = $_.Exception.Message
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
