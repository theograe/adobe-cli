# Adobe CLI

Let Claude Code (or any AI agent, or you) edit in **Premiere Pro** and **After Effects**, and run
**Audition**'s recorder, by typing commands in the terminal:

```bash
adobe pr seq-new --name "Short 1" --width 1080 --height 1920 --fps 30
adobe pr cut --source interview.mp4 --cuts cuts.json
adobe pr captions --srt captions.srt
adobe pr export --out short.mp4
```

It is two small pieces:

- an **extension** that runs inside Premiere Pro and After Effects and does the editing, and
- the **`adobe` command**, which sends it your request and prints the answer as JSON.

Nothing leaves your computer: the two talk over `127.0.0.1` with a private key stored in
`~/.adobe-cli/token`.

## Install (Mac)

You need Premiere Pro and/or After Effects (2021 or newer; tested on Premiere 2026) and `git`.

```bash
git clone https://github.com/theograe/adobe-cli.git ~/adobe-cli
```

```bash
~/adobe-cli/install.sh
```

`install.sh` links the extension into Adobe's extensions folder, allows unsigned extensions
(Adobe's "PlayerDebugMode" setting), puts `adobe` in `~/.local/bin`, and installs a Claude Code skill
so Claude knows every command. Run it again any time; `./install.sh --uninstall` removes it all.

Then, once:

1. Open Premiere Pro (or After Effects) and open or create any project.
2. Choose **Window > Extensions > Adobe CLI**. A small panel says "Ready". Dock it anywhere; it stays
   in your workspace, so next time it starts by itself.
3. In a terminal: `adobe status`.

Windows: run `install.sh` from Git Bash. It copies the extension to `%APPDATA%\Adobe\CEP\extensions`
and sets the same registry keys. Untested so far.

## Use it with Claude Code

Paste this into Claude Code:

> Clone https://github.com/theograe/adobe-cli into ~/adobe-cli and run its install.sh. Then tell me to
> open Premiere and choose Window > Extensions > Adobe CLI, and check `adobe status` until Premiere answers.

After that you can just ask: *"Make a 9:16 sequence from interview.mp4 with these cuts, center the
speaker, add the captions from captions.srt and export it."* The installed skill
(`~/.claude/skills/adobe/SKILL.md`) tells Claude the commands and the rules (check `status` first,
look at a frame after editing, never close your projects unless asked).

If you'd rather put it in a project's `CLAUDE.md`, this is enough:

```markdown
## Premiere Pro / After Effects
Use the `adobe` command (Adobe CLI). `adobe pr` and `adobe ae` list the commands, `adobe pr <command> --help`
shows options. Answers are JSON. Run `adobe pr status` before editing and `adobe pr frame` afterwards to
look at the result. Times are seconds; tracks are V1, V2, A1, A2.
```

## Commands

Every command prints `{"ok": true, "result": …}` or `{"ok": false, "error": "…"}`.
Exit codes: `0` ok, `1` the app refused, `2` bad arguments, `3` the app isn't reachable or is blocked on a dialog.

### Which project, which sequence

Every Premiere and After Effects command takes `--project <file>`, and Premiere commands `--sequence <name>` (or a
JSON list of names: the first that exists), so a command runs where you mean even when another project is in front:

```bash
adobe pr tracks --project ~/edits/short.prproj --sequence "Short 1"
adobe pr target --project ~/edits/short.prproj                 # where it would act, without changing anything
adobe ae layers --project ~/edits/title.aep --comp Title       # --comp takes a name or "#<id>"
```

Premiere opens the project if it isn't open and leaves your view alone, except for the few steps its scripting can
only do on the front sequence (razor, frame, effects, transitions, adding tracks, new sequences): those bring it
forward. After Effects holds one project, so `--project` saves the open one and opens the other; it refuses when the
open project is an Untitled one with work in it. `--sequence` without `--project` looks in every open project and
refuses a name that two of them have.

### One at a time

Each app runs one request at a time, in arrival order, whoever sends it. A call that has to wait prints
`adobe: Premiere Pro is busy (…); queued` on stderr and then runs; `adobe queue` shows what runs and what waits.
To keep an app for several commands in a row (nobody else's script lands in between), give them one hold id:

```bash
export ADOBE_CLI_HOLD=my-task ADOBE_CLI_LABEL="title card for Short 1"
adobe ae comp-new --name Title && adobe ae text --text "GAME WINNER" && adobe ae render --comp Title --out t.mp4
adobe ae release        # or it ends by itself 30 s after your last command
```

### Dialogs

If the app shows a dialog while a command waits (a script's alert, an error, one already up), the command answers within
about 5 seconds with `"blocked": true` and exit 3; nothing is retried, and the script carries on once someone dismisses
the dialog. The caller watches for it (`adobe` and any client can run `extension/dialogs/mac.js` / `win.ps1`): After
Effects freezes the extension while it runs a script or shows a dialog, so the extension can't answer then. A dialog
is a window at the system's modal-panel level (macOS) or an owned top-level window (Windows); reading that needs no
permission. When After Effects is in the background it may not draw its alert until someone switches to it; then
the command waits like any long one. `eval` refuses ES3 traps that cause such dialogs (`let`, arrow functions, `alert`, reserved words as keys,
`.forEach`…) before they reach the app; `--force` skips that check.
Times are **seconds** (`2.5`) or **frame numbers** (`149f`, frames of the sequence or comp), and always go
to the nearest whole frame. `--in`/`--out` are times in the source file, `--at` is a time on the timeline.
Relative file paths are read from the folder you're in. `--help` after any command lists its options.

### Premiere Pro (`adobe pr …`)

| Command | What it does | Example |
| --- | --- | --- |
| `status` | Version, open projects, active sequence | `adobe pr status` |
| `project-new` | Create and open a project | `adobe pr project-new --path edit/short.prproj` |
| `project-open` | Open a project | `adobe pr project-open --path edit/short.prproj` |
| `project-save` | Save (or `--path` to save a copy) | `adobe pr project-save` |
| `project-close` | Close it; you must say `--save` or `--discard` | `adobe pr project-close --save` |
| `import` | Import files, optionally into a bin | `adobe pr import --files a.mp4 b.mp3 --bin Media` |
| `items` | List the project panel | `adobe pr items` |
| `seq-new` | New sequence (default 1080×1920, 30 fps) | `adobe pr seq-new --name "Short 1" --fps 30` |
| `seq-list` / `seq-open` | List sequences / make one active | `adobe pr seq-open --name "Short 1"` |
| `xml-import` | Import a Premiere / Final Cut Pro 7 XML | `adobe pr xml-import --path edit.xml` |
| `tracks` | Every track and clip with times | `adobe pr tracks` |
| `place` | Put a source range on a track (`--mode insert` to push clips) | `adobe pr place --source game.mp4 --in 12 --out 15 --at 0 --track V1` |
| `cut` | Rough cut: a list of ranges back to back on V1/A1 | `adobe pr cut --source interview.mp4 --cuts cuts.json` |
| `broll` | B-roll on V2, picture only (no audio is overwritten); `--conform` plays it at the sequence frame rate so its edges land on sequence frames | `adobe pr broll --source dunk.mp4 --in 3 --out 5 --at 8` |
| `audio` | Music or a sound effect on an audio track, with a level | `adobe pr audio --source song.mp3 --out 30 --track A2 --db -18` |
| `razor` | Cut through all tracks (or `--track V1`) | `adobe pr razor --at 4` |
| `trim` | Move a clip's start/end on the timeline | `adobe pr trim --track V1 --clip 2 --end 6` |
| `delete` | Remove a clip (`--ripple` closes the gap) | `adobe pr delete --track V1 --clip 3 --ripple` |
| `transform` | Scale/position; `--fill` covers the frame, `--focus` centers a point | `adobe pr transform --all --fill --focus 0.45` |
| `volume` | Clip level in dB | `adobe pr volume --track A1 --all --db -3` |
| `marker` / `markers` | Add / list sequence markers | `adobe pr marker --at 2.5 --name Hook` |
| `effect` | Apply a video/audio effect to clips and set controls; repeated names as `"Group/Name"` | `adobe pr effect --track V1 --all --name "Lumetri Color" --props '{"Basic Correction/Contrast":15}'` |
| `effects` | Effects on every clip, every audio track, and the mix bus | `adobe pr effects` |
| `transition` | Transition on the edit at a time (Cross Dissolve, Push, Dip to Black…) | `adobe pr transition --at 2.5 --name Push --duration 10f` |
| `shots` | Frame-accurate camera/shot changes inside a track's clips (needs ffmpeg) | `adobe pr shots --track V1` |
| `captions` | Import an `.srt` as a caption track | `adobe pr captions --srt captions.srt` |
| `frame` | Save a frame as PNG | `adobe pr frame --at 2 --out frame.png` |
| `export` | Export the sequence (H.264 by default; `--ame` uses Media Encoder, `--preset` any `.epr`) | `adobe pr export --out short.mp4` |
| `target` | Where `--project` / `--sequence` point (opens the project if needed) | `adobe pr target --project a.prproj` |
| `eval` | Run your own ExtendScript; `return` a value; `project` and `sequence` are the target's | `adobe pr eval --code "return sequence.name"` |
| `reload` | Reload the commands and plug-ins after updating this repo (`git pull`) | `adobe pr reload` |

A cut list is JSON, either a file or inline:

```json
[
  { "in": 2.0, "out": 4.5 },
  { "in": 8.0, "out": 10.0 },
  { "source": "other-angle.mp4", "in": 15.25, "out": 18.0 }
]
```

`shots` reads every source frame of each clip with ffmpeg and gives the first sequence frame of each new
shot, so a cut placed there leaves no stray frame of the old shot. Install ffmpeg with `brew install ffmpeg`.

Effects with repeated control names (Lumetri has "Contrast" in Basic Correction and in HSL Secondary) take
`"Group/Name"`; if a name is ambiguous the error lists the choices, and nothing is left applied.

`--focus` is where the subject sits across the source frame, from 0 (left edge) to 1 (right edge).
With `--fill`, a speaker at 40% across a 16:9 shot ends up centered in the 9:16 frame, and the picture
never slides past the frame edge.

### After Effects (`adobe ae …`)

| Command | What it does | Example |
| --- | --- | --- |
| `status` | Version, project, active comp | `adobe ae status` |
| `project-new` | New project saved at `--path` (refuses if the open one has unsaved work) | `adobe ae project-new --path title/title.aep` |
| `project-open` / `project-save` / `project-close` | Same as Premiere | `adobe ae project-close --save` |
| `import` / `items` | Import files / list the project | `adobe ae import --files logo.png` |
| `comp-new` | New comp (default 1080×1920, 30 fps, 10 s) | `adobe ae comp-new --name Title --duration 5` |
| `comps` / `layers` | List comps / a comp's layers | `adobe ae layers --comp Title` |
| `layer-add` | Add a file or project item as a layer | `adobe ae layer-add --source logo.png` |
| `solid` | Add a solid | `adobe ae solid --color #101010` |
| `text` | Text layer: font, size, fill, stroke, position | `adobe ae text --text "GAME WINNER" --size 140 --color #FFD400 --stroke #000000 --stroke-width 8` |
| `keyframe` | Keys on position/scale/opacity/rotation/anchor with `--ease easy\|in\|out\|linear\|hold` | `adobe ae keyframe --layer 1 --prop scale --keys '[{"at":0,"value":0},{"at":0.4,"value":100}]'` |
| `effect` | Apply an effect and set its controls | `adobe ae effect --layer 1 --name "Gaussian Blur" --props '{"Blurriness":20}'` |
| `precompose` | Precompose layers | `adobe ae precompose --layers 1,2 --name Group` |
| `render` | Render a comp through the render queue (H.264 template) | `adobe ae render --comp Title --out title.mp4` |
| `frame` | Save a comp frame as PNG | `adobe ae frame --comp Title --at 1 --out title.png` |
| `target` | Where `--project` / `--comp` point | `adobe ae target --comp "#12"` |
| `eval` | Run your own ExtendScript; `comp` is `--comp`'s | `adobe ae eval --code "return comp.numLayers" --comp Title` |

`--comp` defaults to the active comp; `--layer` takes a number or a name.

### Audition (`adobe au …`)

Audition loads the extension when it starts, so restart it once after installing, then
Window > Extensions > Adobe CLI.

| Command | What it does | Example |
| --- | --- | --- |
| `status` | Version, open files, transport state | `adobe au status` |
| `open` | Open an audio file | `adobe au open --path take.wav` |
| `transport` | Recording / playing / paused, plus the active file's length and playhead in seconds | `adobe au transport` |
| `record-start` | Record into the active file (`--file` checks it's the right one) | `adobe au record-start --file "Take 1"` |
| `record-stop` | Stop recording | `adobe au record-stop` |
| `pause` / `play` / `stop` | Transport | `adobe au pause` |
| `marker` | Cue marker on the active file | `adobe au marker --at 12.5 --name "Retake"` |
| `save` | Save the active file as | `adobe au save --path take1.wav` |
| `eval` | Run your own ExtendScript | `adobe au eval --code "return app.transport.isRecording"` |

What Audition's scripting exposes (26.5): the transport (`record`, `stop`, `pause`, `play`, and whether it
is recording, playing or paused), open files with their length, playhead, sample rate and path, markers,
open/save/export, and `app.invokeCommand`. It does **not** expose input meters, peak or clip state, or the
input device, so `adobe au` can't report levels.

## Plug-ins

A plug-in adds its own commands under its name, like `git lfs`: `adobe <plugin> <command>` runs in the app whose
table has the command (`adobe ae <plugin> …` names the app). Register one with `adobe plugins add <folder>` (it writes
`<name>\t<folder>` to `~/.adobe-cli/plugins`), then `adobe pr reload` / `adobe ae reload` in open apps.

The folder has `adobe-plugin.js`:

```js
module.exports = {
  name: "demo",
  help: "what it adds",
  apps: {
    AEFT: {
      host: ["host.jsx"],                 // ExtendScript loaded into the app after the core's
      commands: {
        hello: {
          help: "Say hello from After Effects.",
          args: { who: { type: "string", required: true } },  // same types as the core's commands
          run: function (args, api) { return api.host("demoHello", [args.who]); }
        }
      }
    }
  },
  guard: function (request) { return null; }  // optional: a reason string makes the request wait its turn
};
```

`run` gets `api.host(fn, args)` (a host function; JSON answers come back parsed), `api.eval(code)`,
`api.command(name, args)` (a core command), `api.queued(label, fn)` (later work that takes its own turn in the queue),
`api.target` (the resolved `--project` / `--sequence` / `--comp`), `api.log` and `api.dir`. Plug-in code runs in the
extension's page, so it has Node and a browser (canvas, WebAssembly). Every plug-in command takes `--project` like the
core's.

## The HTTP API

`adobe` is one client; anything can talk to the extension the same way (OS5 does from Python).

- `POST http://127.0.0.1:47651/run` (Premiere; After Effects 47652, Audition 47653), form fields `cwd` and one `a`
  per argument (`a=tracks&a=--sequence&a=Short 1`). Headers: `X-Adobe-CLI-Token` (the contents of
  `~/.adobe-cli/token`), optional `X-Adobe-CLI-Label` (who you are, shown in the queue), `X-Adobe-CLI-Hold` (a hold
  id) and `X-Adobe-CLI-Hold-Idle` (seconds the hold outlives your last request, up to 600). Answers 200 ok, 400 bad
  arguments, 409 blocked on a dialog, 500 failed, all with the JSON above.
- `GET /queue` (token): `{running, hold, waiting, blocked, summary}`. `POST /release` (token, hold header) ends a hold.
- `GET /ping`: `{ok, app, version, plugins}`, no token. `GET /has?plugin=&command=` (token): 200 when this app has it.

## When something goes wrong

- **`adobe status`** says for each app whether it answers, and the fix when it doesn't.
- **"isn't answering"**: open a project, then Window > Extensions > Adobe CLI. If the menu item is
  missing, run `install.sh` again and restart the app.
- **"blocked on a dialog"**: dismiss the dialog in the app; the next command runs normally.
- **A command waits**: `adobe queue` shows what the app is running (a render, another session's script).
- **"the active sequence belongs to another open project"**: Premiere has several projects open; open one of
  the active project's sequences with `seq-open`, or switch projects in Premiere.
- The extension writes a log to `~/.adobe-cli/ppro.log` / `aeft.log`.

## How it works

`adobe` (a short bash script, needs only `curl`) posts your arguments to the extension on
`127.0.0.1:47651` (Premiere) or `47652` (After Effects). The extension checks them against
[extension/commands.js](extension/commands.js), waits for its turn in the app's queue
([extension/server.js](extension/server.js)) and runs one ExtendScript function from
[host/premiere.jsx](extension/host/premiere.jsx) or [host/aftereffects.jsx](extension/host/aftereffects.jsx). While a
request runs, [extension/windows.js](extension/windows.js) watches the app's window list (macOS CGWindowList, Windows
EnumWindows: no extra permission) for a dialog.
Long jobs (exports, renders, frames) are waited for in Node until the file is finished, so when `adobe`
returns, the file is there. Requests need the key in `~/.adobe-cli/token` and a `127.0.0.1` host, so a web
page can't drive your apps.

## Status

Checked on Premiere Pro 26.5.2 (macOS): new project, 9:16 sequence, rough cut from a cut list, fill and
center, B-roll, music with level, captions from SRT, razor, markers, frame export, nearest-frame times and
`149f` frame numbers, `--conform`, `shots` (exact on 30 fps and 29.97 fps sources), Lumetri with grouped
controls, Push / Cross Dissolve transitions, effects on clips and the mix bus. Audition 26.5: the DOM above was
read by reflection and opening a file works; `record-start`/`record-stop` and the `adobe au` panel itself have
not been run yet. Not yet run on the real apps: the MP4 export, audio placement from video files and the dB
scale fix, After Effects, and Windows.

## Credits

Built after reading these open-source projects (all MIT), and borrowing from them:

- [leancoderkavy/premiere-pro-mcp](https://github.com/leancoderkavy/premiere-pro-mcp): sequences are created
  from a `.sqpreset` through the QE DOM (the scripted New Sequence dialog would block Premiere), timecode
  for QE razor/frame export, `exportFramePNG` appending `.png` itself.
- [hetpatel-11/Adobe_Premiere_Pro_MCP](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP) and
  [antipaster/Adobe-Premiere-Pro-MCP](https://github.com/antipaster/Adobe-Premiere-Pro-MCP): the CEP bridge
  pattern. Their file queue needs a shared temp folder and a "Start" button, and their WebSocket server fights
  over one port when several agent windows run; here the app owns the port, so the CLI is a stateless client.
- [morim3/mcp_adobe_premiere](https://github.com/morim3/mcp_adobe_premiere) (UXP + WebSocket) and
  [Dakkshin/after-effects-mcp](https://github.com/Dakkshin/after-effects-mcp) (a polling ScriptUI panel for
  After Effects): the command set for After Effects layers, text and effects.

MIT license.
