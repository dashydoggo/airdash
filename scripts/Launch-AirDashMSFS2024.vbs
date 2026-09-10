Option Explicit

Dim shell, command, exitCode
Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\Creations\AirDash\Scripts\Start-AirDashMSFS2024.ps1"""
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
