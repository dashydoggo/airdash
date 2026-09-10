[CmdletBinding()]
param(
    [string]$TemplatePath = 'D:\Creations\AirDash\Logos\airDash.pptx',
    [string]$GeneratedPresentationPath = 'D:\Creations\AirDash\Generated\airDash-current.pptx',
    [string]$OutputPath = 'D:\SteamLibrary\steamapps\common\MSFS2024\VIDEOS\PressStartVideo-4K.mp4',
    [string]$ApiUrl = 'https://air.dashydoggo.com/api/live',
    [string]$PilotDiscordId = '860900952097030184',
    [string]$DefaultPilotNumber = 'AD0001',
    [int]$SlideDurationSeconds = 6,
    [int]$VerticalResolution = 2160,
    [int]$FramesPerSecond = 60,
    [ValidateRange(1, 100)]
    [int]$Quality = 100,
    [ValidateRange(1, 240)]
    [int]$TimeoutMinutes = 45,
    [string]$FlightDataPath,
    [switch]$ForceIdle,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:ShapeMap = [ordered]@{
    Idle = [ordered]@{
        Slide = 4
        RequiredShapes = @('TextBox 1')
    }
    Active = [ordered]@{
        Slide = 5
        RequiredShapes = @('TextBox 1', 'TextBox 4', 'TextBox 11', 'TextBox 13', 'TextBox 15', 'TextBox 17', 'TextBox 20', 'TextBox 22')
    }
    Mission = [ordered]@{
        Slide = 5
        RequiredShapes = @('TextBox 1', 'TextBox 4', 'TextBox 11', 'TextBox 13', 'TextBox 15', 'TextBox 17', 'TextBox 20', 'TextBox 22')
    }
}

function Get-ObjectProperty {
    param([object]$Value, [string]$Name)
    if ($null -eq $Value) { return $null }
    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-TextOrDefault {
    param([object]$Value, [string]$Default)
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return $Default }
    return $text.Trim()
}

function Get-LiveFlight {
    if ($ForceIdle) { return $null }

    if ($FlightDataPath) {
        if (-not (Test-Path -LiteralPath $FlightDataPath -PathType Leaf)) {
            throw "Flight data fixture not found: $FlightDataPath"
        }
        $payload = Get-Content -LiteralPath $FlightDataPath -Raw | ConvertFrom-Json
    }
    else {
        $payload = Invoke-RestMethod -Uri $ApiUrl -Method Get -TimeoutSec 20 -Headers @{ Accept = 'application/json' }
    }

    $matches = @($payload.flights | Where-Object { [string]$_.discord_id -eq $PilotDiscordId } | Select-Object -First 1)
    if ($matches.Count -eq 0) { return $null }
    return $matches[0]
}

function New-RenderPlan {
    param([object]$Flight)

    if ($null -eq $Flight) {
        return [pscustomobject][ordered]@{
            Mode = 'Idle'
            SelectedSlide = 4
            HiddenSlide = 5
            IncludeMissionSlide = $false
            VisibleSlideCount = 7
            AssignmentSignature = 'idle'
            Text = [ordered]@{}
            MissionText = [ordered]@{}
        }
    }

    $flightNumber = 'AIR{0:D3}' -f [int](Get-ObjectProperty $Flight 'flight_number')
    $origin = Get-TextOrDefault (Get-ObjectProperty $Flight 'origin') 'TBD'
    $destination = Get-TextOrDefault (Get-ObjectProperty $Flight 'destination') 'TBD'
    $registration = Get-TextOrDefault (Get-ObjectProperty $Flight 'registration') 'TBD'
    $departureGate = Get-TextOrDefault (Get-ObjectProperty $Flight 'departure_gate') 'TBD'
    $arrivalGate = Get-TextOrDefault (Get-ObjectProperty $Flight 'arrival_gate') 'TBD'
    $pilot = Get-TextOrDefault (Get-ObjectProperty $Flight 'pilot') 'Pilot'
    $pilotNumber = Get-TextOrDefault (Get-ObjectProperty $Flight 'pilot_number') $DefaultPilotNumber
    $status = Get-TextOrDefault (Get-ObjectProperty $Flight 'status') 'UNKNOWN'
    $source = (Get-TextOrDefault (Get-ObjectProperty $Flight 'source') 'BOARD').ToUpperInvariant()
    $missionType = (Get-TextOrDefault (Get-ObjectProperty $Flight 'mission_type') 'STANDARD').ToUpperInvariant()
    $blockMinutesValue = Get-ObjectProperty $Flight 'block_minutes'
    $blockMinutes = if ($null -eq $blockMinutesValue) { 0 } else { [int]$blockMinutesValue }
    $includeMissionSlide = $source -eq 'MISSION'
    $isRecovery = $includeMissionSlide -and $missionType -eq 'RECOVERY'

    $text = [ordered]@{
        'TextBox 4' = $origin
        'TextBox 11' = $destination
        'TextBox 13' = $flightNumber
        'TextBox 15' = "Gate $departureGate to $arrivalGate"
        'TextBox 17' = $registration
        'TextBox 20' = "Hi, $pilot!"
        'TextBox 22' = $pilotNumber
    }

    $missionText = [ordered]@{}
    if ($includeMissionSlide) {
        $missionText = [ordered]@{
            'TextBox 1' = if ($isRecovery) { "recovery`nmission" } else { "mission`nbriefing" }
            'TextBox 4' = $origin
            'TextBox 11' = $destination
            'TextBox 13' = $flightNumber
            'TextBox 15' = if ($isRecovery) { '0 PAX / 0 CARGO' } elseif ($blockMinutes -gt 0) { "$blockMinutes MIN BLOCK" } else { 'MISSION FLIGHT' }
            'TextBox 17' = if ($isRecovery) { 'RECOVERY FERRY' } else { 'STANDARD MISSION' }
            'TextBox 20' = if ($isRecovery) { 'Operations recovery' } else { 'Mission accepted' }
            'TextBox 22' = if ($isRecovery) { 'NORMAL XP' } else { 'BONUS XP' }
        }
    }

    return [pscustomobject][ordered]@{
        Mode = 'Active'
        SelectedSlide = 5
        HiddenSlide = 4
        IncludeMissionSlide = $includeMissionSlide
        VisibleSlideCount = if ($includeMissionSlide) { 8 } else { 7 }
        AssignmentSignature = @(
            [string](Get-ObjectProperty $Flight 'id'),
            $status,
            $source,
            $missionType,
            $flightNumber,
            $origin,
            $destination,
            $registration,
            $departureGate,
            $arrivalGate,
            $pilotNumber
        ) -join '|'
        Status = $status
        Source = $source
        MissionType = $missionType
        Text = $text
        MissionText = $missionText
    }
}

function Get-SlideShapeNames {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [int]$SlideNumber
    )

    $entry = $Archive.GetEntry("ppt/slides/slide$SlideNumber.xml")
    if ($null -eq $entry) { throw "Template does not contain slide $SlideNumber." }

    $stream = $entry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    try {
        [xml]$xml = $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }

    $namespaces = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $namespaces.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
    return @($xml.SelectNodes('//p:cNvPr', $namespaces) | ForEach-Object { $_.name })
}

function Test-TemplateShapeMap {
    if (-not (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) {
        throw "PowerPoint template not found: $TemplatePath"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($TemplatePath)
    try {
        $result = [ordered]@{}
        foreach ($mode in @('Idle', 'Active', 'Mission')) {
            $definition = $script:ShapeMap[$mode]
            $actual = Get-SlideShapeNames -Archive $archive -SlideNumber $definition.Slide
            $missing = @($definition.RequiredShapes | Where-Object { $_ -notin $actual })
            if ($missing.Count -gt 0) {
                throw "Slide $($definition.Slide) is missing required shape(s): $($missing -join ', ')"
            }
            $result[$mode] = [ordered]@{
                Slide = $definition.Slide
                RequiredShapes = $definition.RequiredShapes
                Valid = $true
            }
        }
        return $result
    }
    finally {
        $archive.Dispose()
    }
}

function Release-ComObject {
    param([object]$Value)
    if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)
    }
}

function Set-ShapeText {
    param(
        [object]$Slide,
        [string]$ShapeName,
        [string]$Value
    )

    $shape = $null
    try {
        $shape = $Slide.Shapes.Item($ShapeName)
        if ([int]$shape.HasTextFrame -ne -1) {
            throw "Shape '$ShapeName' does not have a text frame."
        }
        $shape.TextFrame.TextRange.Text = $Value
    }
    finally {
        Release-ComObject $shape
    }
}

function Set-GreetingText {
    param(
        [object]$Slide,
        [string]$Value
    )

    $shape = $null
    $textFrame = $null
    $textFrame2 = $null
    $range = $null
    $nameRange = $null
    try {
        $shape = $Slide.Shapes.Item('TextBox 20')
        if ([int]$shape.HasTextFrame -ne -1) {
            throw "Shape 'TextBox 20' does not have a text frame."
        }

        # Fixed geometry prevents centered shape-to-fit text from expanding left over Picture 18.
        $shape.Left = 86
        $shape.Top = 452.4
        $shape.Width = 240
        $shape.Height = 53

        $textFrame2 = $shape.TextFrame2
        $textFrame2.AutoSize = 2
        $textFrame2.WordWrap = 0

        $textFrame = $shape.TextFrame
        $range = $textFrame.TextRange
        $range.Text = $Value
        $range.ParagraphFormat.Alignment = 1
        $range.Font.Name = 'Space Grotesk'
        $range.Font.Size = 28
        $range.Font.Bold = -1
        $range.Font.Color.RGB = 16777215

        $prefixLength = 4
        if ($Value.Length -gt $prefixLength) {
            $nameRange = $range.Characters($prefixLength + 1, $Value.Length - $prefixLength)
            $nameRange.Font.Color.RGB = 15260936
        }
    }
    finally {
        Release-ComObject $nameRange
        Release-ComObject $range
        Release-ComObject $textFrame
        Release-ComObject $textFrame2
        Release-ComObject $shape
    }
}

function Wait-ForStableFile {
    param([string]$Path, [datetime]$Deadline)

    $previousSize = -1L
    $stableChecks = 0
    while ([datetime]::UtcNow -lt $Deadline) {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $size = (Get-Item -LiteralPath $Path).Length
            if ($size -gt 0 -and $size -eq $previousSize) { $stableChecks++ } else { $stableChecks = 0 }
            if ($stableChecks -ge 2) { return }
            $previousSize = $size
        }
        Start-Sleep -Seconds 1
    }
    throw "Exported file did not become stable before timeout: $Path"
}

function Initialize-NativeMove {
    if ($null -eq ('AirDash.NativeMethods' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace AirDash {
    public static class NativeMethods {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool MoveFileEx(string existingFileName, string newFileName, int flags);
    }
}
'@
    }
}

function Move-FileAtomic {
    param([string]$Source, [string]$Destination)

    Initialize-NativeMove
    $replaceExisting = 0x1
    $writeThrough = 0x8
    if (-not [AirDash.NativeMethods]::MoveFileEx($Source, $Destination, ($replaceExisting -bor $writeThrough))) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw (New-Object ComponentModel.Win32Exception($errorCode, "Atomic replacement failed: $Destination"))
    }
}

$templateValidation = Test-TemplateShapeMap
$flight = Get-LiveFlight
$plan = New-RenderPlan -Flight $flight

if ($DryRun) {
    [pscustomobject][ordered]@{
        DryRun = $true
        TemplatePath = $TemplatePath
        OutputPath = $OutputPath
        GeneratedPresentationPath = $GeneratedPresentationPath
        SlideCountAfterSelection = [int]$plan.VisibleSlideCount
        SlideDurationSeconds = $SlideDurationSeconds
        ExpectedDurationSeconds = [int]$plan.VisibleSlideCount * $SlideDurationSeconds
        Resolution = "3840x$VerticalResolution"
        FramesPerSecond = $FramesPerSecond
        Plan = $plan
        TemplateValidation = $templateValidation
    } | ConvertTo-Json -Depth 8
    return
}

$currentSessionId = (Get-Process -Id $PID).SessionId
$desktopSessionIds = @(Get-Process -Name explorer -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SessionId -Unique)
if (-not [Environment]::UserInteractive -or $currentSessionId -notin $desktopSessionIds) {
    throw "PowerPoint export must run from the interactive Windows desktop. Current session $currentSessionId is not an Explorer desktop session. Use the 'Start airDash MSFS 2024' desktop shortcut; Office COM is not supported over SSH or as a service."
}

if (Get-Process -Name POWERPNT -ErrorAction SilentlyContinue) {
    throw 'PowerPoint is open. Save and close it before running this exporter. The script will never force-close PowerPoint.'
}

if (-not (Test-Path -LiteralPath $OutputPath)) {
    $outputDirectory = Split-Path -Parent $OutputPath
}
else {
    $outputDirectory = (Get-Item -LiteralPath $OutputPath).DirectoryName
}
$generatedDirectory = Split-Path -Parent $GeneratedPresentationPath
$workDirectory = Join-Path $generatedDirectory '.airdash-work'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $generatedDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

$mutex = New-Object Threading.Mutex($false, 'Local\AirDashPowerPointVideoExport')
$hasMutex = $false
$powerPoint = $null
$presentation = $null
$workPresentation = Join-Path $workDirectory ("airDash-{0}.pptx" -f [guid]::NewGuid().ToString('N'))
$tempVideo = Join-Path $outputDirectory (".{0}.airdash-{1}.mp4" -f [IO.Path]::GetFileNameWithoutExtension($OutputPath), [guid]::NewGuid().ToString('N'))
$deadline = [datetime]::UtcNow.AddMinutes($TimeoutMinutes)
$presentationMoved = $false
$videoMoved = $false
$previousOutputSha256 = $null
$tempVideoSha256 = $null
$outputSha256 = $null
$replacementVerified = $false

try {
    $hasMutex = $mutex.WaitOne(0)
    if (-not $hasMutex) { throw 'Another airDash PowerPoint export is already running.' }

    Copy-Item -LiteralPath $TemplatePath -Destination $workPresentation -Force

    $powerPoint = New-Object -ComObject PowerPoint.Application
    $presentation = $powerPoint.Presentations.Open($workPresentation, $false, $false, $false)

    if ([int]$presentation.Slides.Count -ne 8) {
        throw "Expected 8 template slides, found $($presentation.Slides.Count)."
    }

    for ($index = 1; $index -le $presentation.Slides.Count; $index++) {
        $slide = $null
        $transition = $null
        try {
            $slide = $presentation.Slides.Item($index)
            $transition = $slide.SlideShowTransition
            $transition.Hidden = 0
        }
        finally {
            Release-ComObject $transition
            Release-ComObject $slide
        }
    }

    $hiddenSlide = $null
    $hiddenTransition = $null
    try {
        $hiddenSlide = $presentation.Slides.Item([int]$plan.HiddenSlide)
        $hiddenTransition = $hiddenSlide.SlideShowTransition
        $hiddenTransition.Hidden = -1
    }
    finally {
        Release-ComObject $hiddenTransition
        Release-ComObject $hiddenSlide
    }

    if ($plan.Mode -eq 'Active') {
        $activeSlide = $null
        try {
            $activeSlide = $presentation.Slides.Item(5)
            foreach ($entry in $plan.Text.GetEnumerator()) {
                if ([string]$entry.Key -ne 'TextBox 20') {
                    Set-ShapeText -Slide $activeSlide -ShapeName ([string]$entry.Key) -Value ([string]$entry.Value)
                }
            }
            Set-GreetingText -Slide $activeSlide -Value ([string]$plan.Text['TextBox 20'])
        }
        finally {
            Release-ComObject $activeSlide
        }
    }

    if ([bool]$plan.IncludeMissionSlide) {
        $missionSource = $null
        $missionRange = $null
        $missionSlide = $null
        try {
            $missionSource = $presentation.Slides.Item(5)
            $missionRange = $missionSource.Duplicate()
            $missionSlide = $missionRange.Item(1)
            $missionSlide.MoveTo(6)
            foreach ($entry in $plan.MissionText.GetEnumerator()) {
                Set-ShapeText -Slide $missionSlide -ShapeName ([string]$entry.Key) -Value ([string]$entry.Value)
            }
        }
        finally {
            Release-ComObject $missionSlide
            Release-ComObject $missionRange
            Release-ComObject $missionSource
        }
    }

    $expectedPresentationSlides = if ([bool]$plan.IncludeMissionSlide) { 9 } else { 8 }
    if ([int]$presentation.Slides.Count -ne $expectedPresentationSlides) {
        throw "Expected $expectedPresentationSlides slides after mission selection, found $($presentation.Slides.Count)."
    }

    $presentation.Save()
    $presentation.CreateVideo($tempVideo, $false, $SlideDurationSeconds, $VerticalResolution, $FramesPerSecond, $Quality)

    do {
        Start-Sleep -Seconds 2
        $status = [int]$presentation.CreateVideoStatus
        Write-Progress -Activity 'Exporting airDash press-start video' -Status "PowerPoint media status $status"
        if ($status -eq 4) { throw 'PowerPoint reported that video export failed.' }
        if ([datetime]::UtcNow -ge $deadline) { throw "PowerPoint video export exceeded $TimeoutMinutes minutes." }
    } while ($status -ne 3)
    Write-Progress -Activity 'Exporting airDash press-start video' -Completed

    Wait-ForStableFile -Path $tempVideo -Deadline $deadline
    $tempVideoSha256 = (Get-FileHash -LiteralPath $tempVideo -Algorithm SHA256).Hash.ToLowerInvariant()

    $presentation.Close()
    Release-ComObject $presentation
    $presentation = $null

    if ($powerPoint.Presentations.Count -eq 0) { $powerPoint.Quit() }
    Release-ComObject $powerPoint
    $powerPoint = $null
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()

    $previousPresentation = [IO.Path]::ChangeExtension($GeneratedPresentationPath, '.previous.pptx')
    if (Test-Path -LiteralPath $GeneratedPresentationPath) {
        Copy-Item -LiteralPath $GeneratedPresentationPath -Destination $previousPresentation -Force
    }
    Move-FileAtomic -Source $workPresentation -Destination $GeneratedPresentationPath
    $presentationMoved = $true

    $previousVideo = Join-Path $outputDirectory ("{0}.previous.mp4" -f [IO.Path]::GetFileNameWithoutExtension($OutputPath))
    if (Test-Path -LiteralPath $OutputPath) {
        $previousOutputSha256 = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Copy-Item -LiteralPath $OutputPath -Destination $previousVideo -Force
    }
    Move-FileAtomic -Source $tempVideo -Destination $OutputPath
    $videoMoved = $true
    $outputSha256 = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($outputSha256 -ne $tempVideoSha256) {
        throw "Published video hash does not match the completed export: $OutputPath"
    }
    $replacementVerified = $true

    $state = [pscustomobject][ordered]@{
        GeneratedAtUtc = [datetime]::UtcNow.ToString('o')
        Mode = $plan.Mode
        AssignmentSignature = $plan.AssignmentSignature
        SelectedSlide = $plan.SelectedSlide
        HiddenSlide = $plan.HiddenSlide
        SlideCount = [int]$plan.VisibleSlideCount
        SlideDurationSeconds = $SlideDurationSeconds
        ExpectedDurationSeconds = [int]$plan.VisibleSlideCount * $SlideDurationSeconds
        IncludeMissionSlide = [bool]$plan.IncludeMissionSlide
        MissionType = Get-ObjectProperty $plan 'MissionType'
        VerticalResolution = $VerticalResolution
        FramesPerSecond = $FramesPerSecond
        GeneratedPresentationPath = $GeneratedPresentationPath
        OutputPath = $OutputPath
        OutputBytes = (Get-Item -LiteralPath $OutputPath).Length
        PreviousOutputSha256 = $previousOutputSha256
        OutputSha256 = $outputSha256
        ReplacementVerified = $replacementVerified
        Text = $plan.Text
        MissionText = $plan.MissionText
    }
    $statePath = Join-Path $generatedDirectory 'last-export.json'
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statePath -Encoding UTF8
    $state | ConvertTo-Json -Depth 6
}
finally {
    if ($null -ne $presentation) {
        try { $presentation.Close() } catch {}
        Release-ComObject $presentation
    }
    if ($null -ne $powerPoint) {
        try {
            if ($powerPoint.Presentations.Count -eq 0) { $powerPoint.Quit() }
        }
        catch {}
        Release-ComObject $powerPoint
    }
    if (-not $presentationMoved -and (Test-Path -LiteralPath $workPresentation)) {
        Remove-Item -LiteralPath $workPresentation -Force -ErrorAction SilentlyContinue
    }
    if (-not $videoMoved -and (Test-Path -LiteralPath $tempVideo)) {
        Remove-Item -LiteralPath $tempVideo -Force -ErrorAction SilentlyContinue
    }
    if ($hasMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
