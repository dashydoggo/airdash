param(
    [string]$ShortcutPath = 'C:\Users\Dashy\Desktop\Start airDash MSFS 2024.lnk',
    [string]$WrapperPath = 'D:\Creations\AirDash\Scripts\Launch-AirDashMSFS2024.vbs',
    [string]$MsfsExecutablePath = 'D:\SteamLibrary\steamapps\common\MSFS2024\FlightSimulator2024.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $WrapperPath -PathType Leaf)) { throw "Hidden launcher wrapper not found: $WrapperPath" }
if (-not (Test-Path -LiteralPath $MsfsExecutablePath -PathType Leaf)) { throw "MSFS executable not found: $MsfsExecutablePath" }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = "$env:WINDIR\System32\wscript.exe"
$shortcut.Arguments = "`"$WrapperPath`""
$shortcut.WorkingDirectory = Split-Path -Parent $WrapperPath
$shortcut.IconLocation = "$MsfsExecutablePath,0"
$shortcut.Description = 'Prepare the airDash loading video, then start Microsoft Flight Simulator 2024.'
$shortcut.WindowStyle = 7
$shortcut.Save()

[pscustomobject]@{
    ShortcutPath = $ShortcutPath
    TargetPath = $shortcut.TargetPath
    Arguments = $shortcut.Arguments
    IconLocation = $shortcut.IconLocation
    WindowStyle = $shortcut.WindowStyle
} | ConvertTo-Json
