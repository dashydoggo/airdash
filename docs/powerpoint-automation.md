# airDash PowerPoint and MSFS video automation

The PowerPoint automation produces the Microsoft Flight Simulator 2024 press-start video from a PowerPoint template. When the pilot has an active or booked assignment, the video shows the assignment details on slide 5. Mission assignments add a runtime-generated mission briefing slide immediately after it; recovery ferries show zero passengers, zero cargo, and normal XP. When no assignment exists, the video shows the idle message on slide 4. The automation runs on the Windows PC `dashydomain` and reads flight data from the public airDash API.

## Components

| Component | Location | Purpose |
|---|---|---|
| Template | `D:\Creations\AirDash\Logos\airDash.pptx` | The eight-slide source presentation. Never modified by automation. |
| Exporter | `D:\Creations\AirDash\Scripts\Update-AirDashPressStartVideo.ps1` | Reads flight data, builds a working copy, fills slide 5 or hides it, exports the video, and replaces the MSFS file atomically. |
| Launcher | `D:\Creations\AirDash\Scripts\Start-AirDashMSFS2024.ps1` | Runs the exporter, then starts MSFS through Steam only when the export succeeded. |
| Desktop shortcut | `C:\Users\Dashy\Desktop\Start airDash MSFS 2024.lnk` | Invokes the launcher from the interactive desktop. |
| Generated directory | `D:\Creations\AirDash\Generated\` | Holds the generated presentation, previous versions, logs, and `last-export.json`. |
| Output video | `D:\SteamLibrary\steamapps\common\MSFS2024\VIDEOS\PressStartVideo-4K.mp4` | The file MSFS plays at startup. |
| Data source | `https://air.dashydoggo.com/api/live` | Public endpoint listing booked, active, and report-submitted flights. |

The source copies of the PowerShell scripts are kept in the project at `scripts/` on the Linux host. The Windows copies are the ones that run. When you change a script, edit the project copy, copy it to Windows, and confirm the SHA-256 hashes match.

## Slide mapping

The template contains eight slides. Slides 1 through 3 and 6 through 8 are shared scenes that always appear. Slide 4 and slide 5 are alternatives; exactly one of them is shown.

| Slide | Role | Shown when |
|---|---|---|
| 4 | Idle message: `No current assignments.` | The pilot has no assignment. |
| 5 | Current assignment details | The pilot has a `BOOKED`, `ACTIVE`, or `PIREP_SUBMITTED` assignment. |

Slide 5 text boxes are addressed by their PowerPoint shape names. The names are visible in PowerPoint's Selection Pane (Home tab, Select, Selection Pane).

| Shape name | Content written by the exporter | Example |
|---|---|---|
| `TextBox 4` | Origin airport | `KATL` |
| `TextBox 11` | Destination airport | `KDEN` |
| `TextBox 13` | Flight number with `AIR` prefix | `AIR101` |
| `TextBox 15` | Gate text | `Gate A32 to A26` |
| `TextBox 17` | Aircraft registration | `N574AD` |
| `TextBox 20` | Greeting, formatted with two colors | `Hi, Dashy!` |
| `TextBox 22` | Pilot number | `AD0001` |

**Important:** If you rename, delete, or replace one of these shapes in the template, the exporter fails with a message naming the missing shape. Keep the shape names when editing the template's design.

### Greeting formatting

`TextBox 20` is handled by a dedicated routine because it mixes two colors and sits beside the profile picture. The routine:

1. Fixes the box position and width so it starts to the right of `Picture 18` and cannot expand over it.
2. Sets left alignment and shrink-text-to-fit so a long name shrinks instead of overflowing.
3. Writes `Hi, ` in white and the pilot name with exclamation mark in the accent color `#08DDE8`.

The other text boxes receive plain text replacement and inherit the template's existing formatting.

## Data flow

1. The exporter requests `https://air.dashydoggo.com/api/live`.
2. It selects the flight whose `discord_id` equals the configured pilot ID (default `860900952097030184`).
3. If a flight is found, it builds slide 5 text from `flight_number`, `origin`, `destination`, `departure_gate`, `arrival_gate`, `registration`, `pilot`, and `pilot_number`.
4. If no flight is found, it selects slide 4.

The `/live` endpoint is public and requires no credentials, which is why the automation stores no password or token. The `departure_gate`, `arrival_gate`, and `pilot_number` fields were added to that endpoint specifically for this automation; see [Add a field to an existing API response](change-recipes.md#add-a-field-to-an-existing-api-response).

## Export sequence

When the exporter runs in normal mode it performs these steps in order:

1. Validates that the template exists and contains every required shape name, by reading the Open XML package directly without starting PowerPoint.
2. Fetches flight data and builds the render plan.
3. Refuses to continue if the session is not the interactive Windows desktop, if PowerPoint is already open, or if another export is running.
4. Copies the template to a working file under `D:\Creations\AirDash\Generated\.airdash-work\`.
5. Opens the working copy through PowerPoint COM (Component Object Model, the Windows automation interface Office exposes).
6. Unhides all slides, then hides slide 4 or slide 5 according to the plan.
7. Fills the slide 5 text boxes when the plan is active.
8. Saves the working copy.
9. Calls `CreateVideo` with the configured duration, resolution, frame rate, and quality, writing to a temporary file beside the output.
10. Polls `CreateVideoStatus` every two seconds until PowerPoint reports done (`3`) or failed (`4`).
11. Waits for the temporary video file size to stop changing.
12. Closes the presentation and quits PowerPoint.
13. Copies the previous generated presentation and previous video to `.previous.*` files.
14. Atomically renames the working presentation to `airDash-current.pptx` and the temporary video to `PressStartVideo-4K.mp4`.
15. Writes `last-export.json` describing the export.

The atomic rename is the reason a failed export never leaves a half-written video in the MSFS directory. Either the old file remains, or the complete new file replaces it.

## Export parameters

| Parameter | Default | Meaning |
|---|---|---|
| `-SlideDurationSeconds` | `6` | Seconds each slide is shown before its transition. |
| `-VerticalResolution` | `2160` | Output height. `2160` produces 3840×2160. |
| `-FramesPerSecond` | `60` | Output frame rate. |
| `-Quality` | `100` | PowerPoint quality setting, 1 to 100. |
| `-TimeoutMinutes` | `45` | Maximum time to wait for PowerPoint to finish. |
| `-OutputPath` | MSFS `PressStartVideo-4K.mp4` | Where the final video is written. |
| `-GeneratedPresentationPath` | `Generated\airDash-current.pptx` | Where the filled presentation is kept. |
| `-FlightDataPath` | none | A JSON file to use instead of the live API. Used for demonstrations. |
| `-ForceIdle` | off | Ignore flight data and produce the idle video. |
| `-DryRun` | off | Print the plan and template validation without starting PowerPoint. |

The template contains two-second Morph transitions between slides. Seven slides at six seconds plus transitions produce a video of roughly 42 to 56 seconds depending on how PowerPoint counts transition time at the chosen settings. The original MSFS video was 42 seconds at 3840×2160.

## Running the automation

### Normal use

Double-click the desktop shortcut `Start airDash MSFS 2024`. The launcher:

1. Refuses to run if MSFS or PowerPoint is already open.
2. Runs the exporter with default parameters.
3. Starts Steam app `2537590` (Microsoft Flight Simulator 2024) only if the export succeeded.
4. Appends a line to `D:\Creations\AirDash\Generated\airDash-launcher.log`.

If the export fails, MSFS does not start and the log records the reason. The previous video remains in place.

### Dry run from Linux

A dry run validates the template and shows what would be written, without opening PowerPoint. It is safe to run over SSH at any time:

```bash
ssh dashydomain 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File D:\Creations\AirDash\Scripts\Update-AirDashPressStartVideo.ps1 -DryRun'
```

The output includes `Plan.Mode` (`Active` or `Idle`), `Plan.SelectedSlide`, `Plan.Text` with every value that would be written, and `TemplateValidation` confirming the required shapes exist.

### Produce a sample without touching MSFS

To render a test video to a separate location:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\Creations\AirDash\Scripts\Update-AirDashPressStartVideo.ps1 `
  -GeneratedPresentationPath D:\Creations\AirDash\Generated\airDash-sample.pptx `
  -OutputPath D:\Creations\AirDash\Generated\PressStartVideo-sample.mp4 `
  -VerticalResolution 1080 -FramesPerSecond 30 -Quality 90
```

Run this in a PowerShell window on the Windows desktop, not over SSH. To preview specific values, write a JSON file in the shape of the `/live` response and pass it with `-FlightDataPath`. The project file `scripts/powerpoint-demo-flight.json` is an example.

## Interactive session requirement

Office COM automation is only reliable in the interactive desktop session (Windows session 1, where Explorer runs). Processes started over SSH run in session 0 and PowerPoint fails there with misleading errors, including `OutOfMemoryException` when opening the template.

The exporter therefore checks the session before starting PowerPoint and exits with this message when run from SSH or a service:

```text
PowerPoint export must run from the interactive Windows desktop. Current session 0 is not an Explorer desktop session. Use the 'Start airDash MSFS 2024' desktop shortcut; Office COM is not supported over SSH or as a service.
```

`-DryRun` is exempt from this check because it does not start PowerPoint.

To run a real export from Linux, the accepted method is a temporary Windows scheduled task registered with the logged-in user's SID and `LogonType` 3 (interactive token), which executes in session 1. Delete the task afterward. Do not register a persistent task without confirming with Dashy, because it creates a background automation that starts PowerPoint unattended.

## Updating a script

1. Edit the source copy in `scripts/` on the Linux host.
2. Copy it to Windows:

```bash
scp scripts/Update-AirDashPressStartVideo.ps1 'dashydomain:D:/Creations/AirDash/Scripts/Update-AirDashPressStartVideo.ps1'
```

3. Verify the hashes match:

```bash
sha256sum scripts/Update-AirDashPressStartVideo.ps1
ssh dashydomain 'powershell.exe -NoProfile -Command "(Get-FileHash D:\Creations\AirDash\Scripts\Update-AirDashPressStartVideo.ps1).Hash.ToLower()"'
```

4. Parse-check on Windows without executing:

```bash
ssh dashydomain 'powershell.exe -NoProfile -Command "$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile(\"D:\Creations\AirDash\Scripts\Update-AirDashPressStartVideo.ps1\",[ref]$t,[ref]$e);if($e){$e.Message}else{\"syntax ok\"}"'
```

5. Run a `-DryRun` to confirm the plan is still correct.

## Updating the template

You may edit the design of `airDash.pptx` in PowerPoint freely, subject to these rules:

- Keep the shape names listed in [Slide mapping](#slide-mapping). Renaming a text box breaks the exporter.
- Keep slide 4 as the idle slide and slide 5 as the assignment slide. Inserting a slide before them shifts the numbers; if you must, update the `Slide` numbers in the `$script:ShapeMap` table at the top of the exporter.
- Keep `Picture 18` as the profile picture on slide 5 if you keep the greeting beside it; the greeting routine positions itself relative to that layout.
- Save and close PowerPoint before running the exporter.

After editing, run a `-DryRun`. `TemplateValidation` reports `Valid: true` for both modes when the shapes are intact.

## Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `PowerPoint is open. Save and close it before running this exporter.` | PowerPoint is running. | Close PowerPoint completely, including background windows. |
| `PowerPoint export must run from the interactive Windows desktop.` | Run over SSH or from a service. | Use the desktop shortcut or an interactive scheduled task. |
| `Slide 5 is missing required shape(s): TextBox 20` | A text box was renamed or deleted in the template. | Restore the shape name in PowerPoint's Selection Pane. |
| `Microsoft Flight Simulator 2024 is already running.` | The launcher was started while MSFS was open. | Close MSFS, then use the shortcut. |
| `Another airDash PowerPoint export is already running.` | A previous export has not finished. | Wait, or check Task Manager for a stuck `POWERPNT.EXE` and end it only if no unsaved work exists. |
| `Insufficient memory to continue the execution of the program.` at `Presentations.Open` | Almost always the session-0 problem, not real memory pressure. | Run from the desktop session. |
| Video exported but MSFS shows the old one | MSFS caches or was open during export. | Restart MSFS. The launcher prevents this by refusing to run while MSFS is open. |
| Export reports failed status `4` | PowerPoint's media encoder failed. | Check that no other application is writing to the output directory, then retry. |
| Greeting overlaps the profile picture | The greeting routine was bypassed or the template layout changed. | Confirm `TextBox 20` and `Picture 18` exist and rerun. |

Logs and state:

```text
D:\Creations\AirDash\Generated\airDash-launcher.log
D:\Creations\AirDash\Generated\last-export.json
D:\Creations\AirDash\Generated\airDash-current.previous.pptx
D:\SteamLibrary\steamapps\common\MSFS2024\VIDEOS\PressStartVideo-4K.previous.mp4
```

## Restoring the previous video

If a generated video is wrong, the previous one is beside it:

```powershell
Copy-Item 'D:\SteamLibrary\steamapps\common\MSFS2024\VIDEOS\PressStartVideo-4K.previous.mp4' `
          'D:\SteamLibrary\steamapps\common\MSFS2024\VIDEOS\PressStartVideo-4K.mp4' -Force
```

Only one previous version is kept. The original Asobo video was replaced during initial setup; if you want it back, restore it from Steam by verifying the game files, which re-downloads any file that differs from the store version.

## Future options

The launcher is the only trigger installed. A change-detection watcher that polls `/api/live` and re-exports when the assignment changes is possible but was not installed, because it would run PowerPoint unattended in the background and must defer whenever MSFS or PowerPoint is open. Discuss the tradeoffs with Dashy before adding one.

## Mission briefing slides

The source template remains eight slides. For any live record whose `source` is `MISSION`, the exporter duplicates the filled assignment slide at runtime and inserts the duplicate as generated slide 6. The generated presentation therefore contains nine physical slides, with eight visible slides after the idle alternative is hidden. Board and schedule assignments retain the original seven visible slides.

A standard mission slide identifies the route, aircraft, block time, and bonus XP policy. A recovery mission slide identifies `RECOVERY FERRY`, `0 PAX / 0 CARGO`, and `NORMAL XP`. The runtime slide uses the existing assignment shapes, so the source template does not require a manually maintained ninth slide.

`/api/live` must provide `source`, `mission_type`, `recovery_of_assignment_id`, `booked_at`, `started_at`, and `expires_at`. The same fields support estimated movement on the advanced pilot network map.

## Replacement verification

Before atomic replacement, the exporter calculates the temporary video's SHA-256 hash. After `MoveFileEx` publishes the video, it hashes the destination and requires an exact match. `last-export.json` records `PreviousOutputSha256`, `OutputSha256`, and `ReplacementVerified`.

The launcher refuses to start MSFS unless `last-export.json` confirms that the verified destination is exactly `PressStartVideo-4K.mp4`. It logs the published hash, byte size, and visible slide count. Launcher failures also appear in a desktop message box. MSFS must be closed before the exporter runs; if it is already open, the launcher intentionally leaves the current video unchanged.

## Hidden desktop launcher

The desktop shortcut targets `wscript.exe`, which runs `Launch-AirDashMSFS2024.vbs`. The wrapper starts `Start-AirDashMSFS2024.ps1` with window style `Hidden` and waits for its exit code, so no terminal window appears.

`Install-AirDashMSFSShortcut.ps1` creates the shortcut reproducibly and sets its icon to `FlightSimulator2024.exe,0`. The PowerShell launcher displays a native Windows tray notification using that executable icon while the video is being prepared and another notification immediately before Steam starts MSFS. Errors remain visible through the existing message box.

Starting MSFS directly from Steam bypasses the exporter. The supported sequence remains the **Start airDash MSFS 2024** desktop shortcut, which completes and verifies video replacement before sending Steam the launch request.
