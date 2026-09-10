$ErrorActionPreference = 'Stop'
$exporter = 'D:\Creations\AirDash\Scripts\Update-AirDashPressStartVideo.ps1'
$generated = 'D:\Creations\AirDash\Generated'
$presentation = Join-Path $generated 'airDash-sample.pptx'
$video = Join-Path $generated 'PressStartVideo-sample.mp4'
$statusPath = Join-Path $generated 'sample-export-status.json'
$logPath = Join-Path $generated 'sample-export.log'

New-Item -ItemType Directory -Path $generated -Force | Out-Null
Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f [datetime]::Now.ToString('s'), $Message
    Add-Content -LiteralPath $logPath -Value $line
}

try {
    Write-Log "Starting interactive sample export in session $((Get-Process -Id $PID).SessionId)."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $exporter `
        -GeneratedPresentationPath $presentation `
        -OutputPath $video `
        -VerticalResolution 1080 `
        -FramesPerSecond 30 `
        -Quality 90 `
        -TimeoutMinutes 30 | Add-Content -LiteralPath $logPath
    if ($LASTEXITCODE -ne 0) { throw "Exporter exited with code $LASTEXITCODE." }
    if (-not (Test-Path -LiteralPath $video -PathType Leaf)) { throw 'Sample video was not created.' }

    Write-Log 'Sample export completed. Opening the video.'
    $player = Start-Process -FilePath $video -PassThru
    $status = [pscustomobject][ordered]@{
        Success = $true
        CompletedUtc = [datetime]::UtcNow.ToString('o')
        SessionId = (Get-Process -Id $PID).SessionId
        PresentationPath = $presentation
        PresentationBytes = (Get-Item -LiteralPath $presentation).Length
        VideoPath = $video
        VideoBytes = (Get-Item -LiteralPath $video).Length
        PlayerProcessId = if ($player) { $player.Id } else { $null }
    }
    $status | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Write-Log "Video player started with process ID $($status.PlayerProcessId)."
}
catch {
    $status = [pscustomobject][ordered]@{
        Success = $false
        FailedUtc = [datetime]::UtcNow.ToString('o')
        SessionId = (Get-Process -Id $PID).SessionId
        Error = $_.Exception.Message
    }
    $status | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
