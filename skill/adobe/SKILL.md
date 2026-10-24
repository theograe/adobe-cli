---
name: adobe
description: Edit in Premiere Pro and After Effects, and run Audition's recorder, from the terminal with the `adobe` command (Adobe CLI). Use when the user wants Claude to build a sequence or rough cut, place clips, B-roll, music, captions or markers, reframe to 9:16, export, or make and render After Effects comps with text and keyframes.
---

# Adobe CLI

`adobe pr …` drives Premiere Pro and `adobe ae …` drives After Effects. Every answer is JSON:
`{"ok": true, "result": …}` or `{"ok": false, "error": "…"}`. Exit codes: 0 ok, 1 the app refused,
2 bad arguments, 3 the app isn't reachable.

## Before you start

1. `adobe status` shows which apps answer. If one doesn't: the user opens the app and a project, then
   Window > Extensions > Adobe CLI (once; it stays in the workspace).
2. `adobe pr` / `adobe ae` lists the commands; `adobe pr <command> --help` lists its options.
3. `adobe pr status` / `adobe ae status` shows the open project. Premiere can have several projects
   open: without `--project` commands act on the front one. Give `--project <file>` (and `--sequence <name>` in
   Premiere, `--comp <name|#id>` in After Effects) whenever the user has other work open.

## Rules

- Times are seconds (2.5) or frame numbers (149f) and round to the nearest frame. `--in/--out` are source
  times, `--at` is timeline time. Tracks are V1, V2… A1, A2….
- Cut on shot changes with `adobe pr shots` (exact first frame of each new shot), not by eye.
- Before judging loudness, run `adobe pr effects`: compressors or limiters on tracks or the mix bus change it.
- Never save over or close the user's projects unless they ask. Work in a project you created
  (`project-new`) when experimenting.
- After editing, check the result: `adobe pr tracks` for the timeline, `adobe pr frame --at 2 --out f.png`
  (then look at the PNG) for the picture.
- `eval --code` runs raw ExtendScript (ES3: `var`, no arrow functions) when no command fits;
  `return` a value to get it back. It refuses ES3 traps; fix the script rather than adding `--force`.
- One request runs at a time per app; "queued" on stderr is normal. For several steps in a row, set
  `ADOBE_CLI_HOLD=<id>` and finish with `adobe <app> release`.
- Exit 3 with `"blocked": true` means the app shows a dialog: tell the user (or dismiss it if you can see the
  screen), never retry in a loop.
- Plug-ins add commands under their name (`adobe grae …`); `adobe pr` / `adobe ae` list them.

## Premiere Pro

```bash
adobe pr project-new --path ~/Videos/short/short.prproj
adobe pr seq-new --name "Short 1" --width 1080 --height 1920 --fps 30
adobe pr cut --source interview.mp4 --cuts cuts.json     # [{"in":2,"out":4.5},…] back to back on V1/A1
adobe pr transform --track V1 --all --fill --focus 0.45  # fill 9:16, center what sits 45% across
adobe pr broll --source dunk.mp4 --in 3 --out 5 --at 8   # V2, video only
adobe pr audio --source song.mp3 --at 0 --out 30 --track A2 --db -18
adobe pr captions --srt captions.srt
adobe pr marker --at 2.5 --name Hook
adobe pr razor --at 4 / trim --track V1 --clip 2 --end 6 / delete --track V1 --clip 3 --ripple
adobe pr volume --track A1 --all --db -3
adobe pr shots --track V1                                # first frame of every new camera shot
adobe pr effect --track V1 --all --name "Lumetri Color" --props '{"Basic Correction/Saturation":115}'
adobe pr transition --at 2.5 --name Push --duration 10f  # Cross Dissolve, Dip to Black…; audio: Constant Power
adobe pr effects                                         # clip, track and mix-bus effects
adobe pr broll --source b.mp4 --in 0 --out 2 --at 4 --conform   # 29.97 B-roll on 30 fps frames
adobe pr frame --at 2 --out frame.png
adobe pr export --out short.mp4            # add --ame to render through Media Encoder
adobe pr xml-import --path edit.xml        # Premiere / FCP7 XML
adobe pr tracks / items / seq-list / seq-open --name … / markers / project-save / project-close --save
```

## After Effects

```bash
adobe ae project-new --path ~/Videos/title/title.aep
adobe ae comp-new --name Title --width 1080 --height 1920 --fps 30 --duration 5
adobe ae text --text "GAME WINNER" --size 140 --color #FFD400 --stroke #000000 --stroke-width 8
adobe ae keyframe --layer 1 --prop scale --keys '[{"at":0,"value":0},{"at":0.4,"value":100}]' --ease easy
adobe ae keyframe --layer 1 --prop opacity --at 4.5 --value 100 / --prop position --value 540,960
adobe ae effect --layer 1 --name "Gaussian Blur" --props '{"Blurriness":20}'
adobe ae precompose --layers 1,2 --name Group
adobe ae render --comp Title --out title.mp4
adobe ae frame --comp Title --at 1 --out title.png
adobe ae import / layer-add / solid / comps / layers / items / project-save / project-close --save
```

## Audition

```bash
adobe au status                          # open files + recording/playing/paused
adobe au transport                       # same, plus the active file's length/playhead in seconds
adobe au record-start --file "Take 1"    # records into the active file; --file guards against the wrong one
adobe au record-stop / pause / play / stop
adobe au marker --at 12.5 --name Retake / save --path take1.wav / open --path take.wav
```

Audition's scripting has no input meters, peak/clip state or input device: don't promise levels.
