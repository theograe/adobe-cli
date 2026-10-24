// Every command the `adobe` CLI knows: its arguments and help text. The work itself happens in
// host/premiere.jsx and host/aftereffects.jsx (a function with the same name), plus an optional `after`
// step here in Node for things ExtendScript can't wait on (files written in the background).
//
// Argument types:
//   string, number, bool   plain values (bool is a bare flag: --ripple)
//   time                   seconds (2.5) or a frame number of the sequence/comp (149f); rounded to the nearest frame
//   file                   an existing file; relative paths are resolved from where you ran `adobe`
//   out                    a file to write; resolved the same way, its folder is created
//   files                  one or more existing files: --files a.mp4 b.mp4
//   json                   inline JSON ('[{"in":1,"out":2}]') or a path to a .json file
//   value                  a number, or numbers separated by commas ("540,960"), or JSON

var fs = require("fs");
var path = require("path");

var PR = {
  "status": { help: "Premiere version, open project, active sequence.", args: {} },

  "project-new": { help: "Create and open a new project (the file must not exist yet).",
    args: { path: { type: "out", required: true, help: "where to save the .prproj" } },
    example: "adobe pr project-new --path ~/Desktop/test/edit.prproj" },
  "project-open": { help: "Open an existing project.",
    args: { path: { type: "file", required: true } } },
  "project-save": { help: "Save the open project, or save a copy with --path.",
    args: { path: { type: "out", help: "save as this file instead" } } },
  "project-close": { help: "Close the open project. Say --save or --discard.",
    args: { save: { type: "bool" }, discard: { type: "bool" } } },

  "import": { help: "Import media (video, audio, images, XML) into the project.",
    args: { files: { type: "files", required: true }, bin: { type: "string", help: "bin name, created if missing" } },
    before: checkStreamStarts,
    example: "adobe pr import --files clip.mp4 music.mp3 --bin Media" },
  "items": { help: "List everything in the project panel.", args: {} },

  "seq-new": { help: "Create a sequence and make it active. Default 1080x1920 (9:16) at 30 fps.",
    args: { name: { type: "string", required: true }, width: { type: "number", "default": 1080 },
      height: { type: "number", "default": 1920 }, fps: { type: "number", "default": 30 },
      preset: { type: "file", help: ".sqpreset to start from (frame size and fps are still applied)" } },
    before: defaultSequencePreset,
    example: "adobe pr seq-new --name \"Short 1\" --width 1080 --height 1920 --fps 30" },
  "seq-list": { help: "List sequences.", args: {} },
  "seq-open": { help: "Open a sequence by name and make it active.", args: { name: { type: "string", required: true } } },
  "xml-import": { help: "Import a Premiere / Final Cut Pro 7 XML; returns the sequences it created.",
    args: { path: { type: "file", required: true } } },

  "tracks": { help: "List every track and clip in the active sequence (times in seconds).", args: {} },
  "place": { help: "Put part of a source on the timeline. --in/--out are source seconds, --at is timeline seconds.",
    args: { source: { type: "string", required: true, help: "file path or project item name" },
      "in": { type: "time" }, out: { type: "time" }, at: { type: "time", "default": 0 },
      track: { type: "string", "default": "V1", help: "V1, V2… or A1, A2…" },
      "audio-track": { type: "string", help: "where the source's audio goes (default: same number as the video track)" },
      mode: { type: "string", "default": "overwrite", help: "overwrite or insert" },
      "video-only": { type: "bool", help: "drop the audio (B-roll)" }, conform: { type: "bool", help: "interpret the file at the sequence frame rate so its frames land on sequence frames (changes its speed by the rate difference)" } },
    before: checkStreamStarts, example: "adobe pr place --source game.mp4 --in 12.5 --out 15 --at 0 --track V1" },
  "cut": { help: "Build a rough cut: place a list of source ranges back to back on V1/A1.",
    args: { cuts: { type: "json", required: true, help: "[{\"source\":\"a.mp4\",\"in\":1.2,\"out\":3.4}, …] (source optional with --source)" },
      source: { type: "string", help: "default source for cuts that don't name one" },
      at: { type: "time", "default": 0 }, track: { type: "string", "default": "V1" }, conform: { type: "bool", help: "interpret the file at the sequence frame rate so its frames land on sequence frames (changes its speed by the rate difference)" } },
    before: checkStreamStarts, example: "adobe pr cut --source interview.mp4 --cuts cuts.json" },
  "broll": { help: "Place a B-roll shot on V2 (video only).",
    args: { source: { type: "string", required: true }, "in": { type: "time" }, out: { type: "time" },
      at: { type: "time", required: true }, track: { type: "string", "default": "V2" }, conform: { type: "bool", help: "interpret the file at the sequence frame rate so its frames land on sequence frames (changes its speed by the rate difference)" } },
    example: "adobe pr broll --source dunk.mp4 --in 3 --out 5 --at 8" },
  "audio": { help: "Place music or a sound effect on an audio track, with an optional level.",
    args: { source: { type: "string", required: true }, "in": { type: "time" }, out: { type: "time" },
      at: { type: "time", "default": 0 }, track: { type: "string", "default": "A2" }, db: { type: "number" } },
    example: "adobe pr audio --source song.mp3 --at 0 --track A2 --db -18" },
  "razor": { help: "Cut through clips at a time (all tracks, or one with --track).",
    args: { at: { type: "time", required: true }, track: { type: "string" } } },
  "trim": { help: "Move a clip's start and/or end on the timeline (trims the media, leaves a gap).",
    args: { track: { type: "string", "default": "V1" }, clip: { type: "number", help: "clip number on the track (1 = first)" },
      at: { type: "time", help: "or: the clip under this time" }, start: { type: "time" }, end: { type: "time" } } },
  "delete": { help: "Remove a clip. --ripple closes the gap.",
    args: { track: { type: "string", "default": "V1" }, clip: { type: "number" }, at: { type: "time" }, all: { type: "bool" }, ripple: { type: "bool" } } },
  "transform": { help: "Scale and position clips. --fill scales to cover the frame; --focus 0.4 centers what sits 40% across the source.",
    args: { track: { type: "string", "default": "V1" }, clip: { type: "number" }, at: { type: "time" },
      all: { type: "bool", help: "every clip on the track" }, fill: { type: "bool" }, fit: { type: "bool" },
      scale: { type: "number", help: "percent" }, x: { type: "number", help: "0..1 across the frame (0.5 = center)" },
      y: { type: "number", help: "0..1 down the frame" }, focus: { type: "number", help: "0..1 across the source to put at the center" },
      rotation: { type: "number" } },
    example: "adobe pr transform --track V1 --all --fill --focus 0.45" },
  "volume": { help: "Set clip audio level in dB.",
    args: { track: { type: "string", "default": "A1" }, clip: { type: "number" }, at: { type: "time" },
      all: { type: "bool" }, db: { type: "number", required: true } } },
  "marker": { help: "Add a sequence marker.",
    args: { at: { type: "time", required: true }, name: { type: "string", "default": "" },
      comment: { type: "string", "default": "" }, duration: { type: "time", "default": 0 } } },
  "markers": { help: "List sequence markers.", args: {} },
  "captions": { help: "Import an .srt and lay it on a caption track.",
    args: { srt: { type: "file", required: true }, at: { type: "time", "default": 0 } },
    example: "adobe pr captions --srt captions.srt" },
  "frame": { help: "Save the sequence frame at a time as a PNG.",
    args: { at: { type: "time", "default": 0 }, out: { type: "out", required: true } },
    after: waitForFile },
  "export": { help: "Export the active sequence. Renders inside Premiere, or queues in Media Encoder with --ame.",
    args: { out: { type: "out", required: true }, preset: { type: "file", help: ".epr preset (default: H.264 Match Source - High bitrate)" },
      ame: { type: "bool", help: "render through Adobe Media Encoder" }, "work-area": { type: "bool" } },
    before: defaultEncoderPreset, after: waitForFile,
    example: "adobe pr export --out short.mp4" },
  "effect": { help: "Apply a video or audio effect to clips and set its controls. Repeated control names: \"Group/Name\".",
    args: { track: { type: "string", "default": "V1" }, clip: { type: "number" }, at: { type: "time" }, all: { type: "bool" },
      name: { type: "string", required: true, help: "as in the Effects panel, e.g. Lumetri Color" },
      props: { type: "json", help: "{\"Basic Correction/Saturation\": 120, \"Basic Correction/Contrast\": 15}" } },
    example: "adobe pr effect --track V1 --all --name \"Lumetri Color\" --props '{\"Basic Correction/Contrast\":15}'" },
  "effects": { help: "List effects on clips, on audio tracks and on the mix bus (built-ins like Motion are skipped unless --all).",
    args: { all: { type: "bool" } }, before: tempCopy, after: mixBusEffects },
  "transition": { help: "Add a transition on the edit at --at (Cross Dissolve, Push, Dip to Black…; audio: Constant Power).",
    args: { track: { type: "string", "default": "V1" }, at: { type: "time", required: true },
      name: { type: "string", "default": "Cross Dissolve" }, duration: { type: "time", "default": 0.5 } },
    example: "adobe pr transition --at 2.5 --name Push --duration 10f" },
  "shots": { help: "Frame-accurate camera/shot changes inside the clips of a track (needs ffmpeg).",
    args: { track: { type: "string", "default": "V1" }, threshold: { type: "number", "default": 0.3, help: "0..1, lower finds softer changes" } },
    after: detectShots, example: "adobe pr shots --track V1" },
  "target": { help: "Where a command with these --project / --sequence would act (opens the project if it isn't).", args: {},
    example: "adobe pr target --project edit.prproj --sequence \"Short 1\"" },
  "eval": { help: "Run your own ExtendScript; `return` a value to get it back as JSON. `project` and `sequence` are the target's.",
    args: { code: { type: "string" }, file: { type: "file" }, force: { type: "bool", help: "skip the ES3 check" } }, before: readScriptFile,
    example: "adobe pr eval --code \"return sequence.name\" --project edit.prproj --sequence \"Short 1\"" }
};

var AE = {
  "status": { help: "After Effects version, open project, active comp.", args: {} },

  "project-new": { help: "Start a new project and save it at --path. Refuses if the open project has unsaved changes.",
    args: { path: { type: "out", required: true, help: "where to save the .aep" } } },
  "project-open": { help: "Open an existing project.", args: { path: { type: "file", required: true } } },
  "project-save": { help: "Save the project, or save it as --path.", args: { path: { type: "out" } } },
  "project-close": { help: "Close the project. Say --save or --discard.", args: { save: { type: "bool" }, discard: { type: "bool" } } },

  "import": { help: "Import files into the project.", args: { files: { type: "files", required: true } } },
  "items": { help: "List project items.", args: {} },

  "comp-new": { help: "Create a comp and open it. Default 1080x1920, 30 fps, 10 s.",
    args: { name: { type: "string", required: true }, width: { type: "number", "default": 1080 },
      height: { type: "number", "default": 1920 }, fps: { type: "number", "default": 30 },
      duration: { type: "time", "default": 10 }, color: { type: "string", help: "background, e.g. #000000" } },
    example: "adobe ae comp-new --name Title --duration 5" },
  "comps": { help: "List comps.", args: {} },
  "layers": { help: "List a comp's layers.", args: { comp: { type: "string", help: "comp name (default: active comp)" } } },
  "layer-add": { help: "Add a project item (or a file) to a comp as a layer.",
    args: { comp: { type: "string" }, source: { type: "string", required: true }, at: { type: "time", "default": 0 } } },
  "solid": { help: "Add a solid layer.",
    args: { comp: { type: "string" }, color: { type: "string", "default": "#000000" }, name: { type: "string", "default": "Solid" } } },
  "text": { help: "Add a text layer.",
    args: { comp: { type: "string" }, text: { type: "string", required: true }, font: { type: "string", help: "PostScript name, e.g. Arial-BoldMT" },
      size: { type: "number", "default": 100 }, color: { type: "string", "default": "#FFFFFF" },
      stroke: { type: "string", help: "stroke color" }, "stroke-width": { type: "number", "default": 0 },
      justify: { type: "string", "default": "center", help: "left, center or right" },
      x: { type: "number", help: "pixels (default: comp center)" }, y: { type: "number" },
      name: { type: "string" }, start: { type: "time" }, duration: { type: "time" } },
    example: "adobe ae text --text \"GAME WINNER\" --size 140 --color #FFD400 --stroke #000000 --stroke-width 8" },
  "keyframe": { help: "Set keyframes on position, scale, opacity, rotation or anchor. One with --at/--value, or many with --keys.",
    args: { comp: { type: "string" }, layer: { type: "string", required: true, help: "layer name or number" },
      prop: { type: "string", required: true }, at: { type: "time" }, value: { type: "value" },
      keys: { type: "json", help: "[{\"at\":0,\"value\":0},{\"at\":0.5,\"value\":100}]" },
      ease: { type: "string", "default": "easy", help: "linear, easy (in and out), in, out, hold" } },
    example: "adobe ae keyframe --layer 1 --prop scale --keys '[{\"at\":0,\"value\":0},{\"at\":0.4,\"value\":100}]'" },
  "effect": { help: "Apply an effect by name or match name, with optional property values.",
    args: { comp: { type: "string" }, layer: { type: "string", required: true }, name: { type: "string", required: true },
      props: { type: "json", help: "{\"Blur Radius\": 20}" } },
    example: "adobe ae effect --layer 1 --name \"Gaussian Blur\" --props '{\"Blurriness\":20}'" },
  "precompose": { help: "Precompose layers into a new comp.",
    args: { comp: { type: "string" }, layers: { type: "string", required: true, help: "layer numbers, e.g. 1,2" },
      name: { type: "string", "default": "Precomp" } } },
  "render": { help: "Add a comp to the render queue and render it (other queued items are skipped).",
    args: { comp: { type: "string" }, out: { type: "out", required: true },
      template: { type: "string", help: "output module template (default: an H.264 template)" } },
    after: waitForFile, example: "adobe ae render --comp Title --out title.mp4" },
  "frame": { help: "Save a comp frame as a PNG.",
    args: { comp: { type: "string" }, at: { type: "time", "default": 0 }, out: { type: "out", required: true } },
    after: waitForPng },
  "target": { help: "Where a command with these --project / --comp would act (opens the project if it isn't).",
    args: { comp: { type: "string", help: "comp name or #id" } } },
  "eval": { help: "Run your own ExtendScript; `return` a value to get it back as JSON. `project` and `comp` are the target's.",
    args: { code: { type: "string" }, file: { type: "file" }, comp: { type: "string", help: "comp name or #id, bound to `comp`" },
      force: { type: "bool", help: "skip the ES3 check" } }, before: readScriptFile }
};

var AU = {
  "status": { help: "Audition version, open files, transport state.", args: {} },
  "open": { help: "Open an audio file.", args: { path: { type: "file", required: true } } },
  "transport": { help: "Recording/playing/paused, and the active file's length and playhead in seconds.", args: {} },
  "record-start": { help: "Start recording into the active file. --file makes sure it's the one you mean.",
    args: { file: { type: "string", help: "the active file's name as Audition shows it" } } },
  "record-stop": { help: "Stop recording.", args: {} },
  "pause": { help: "Pause, or resume, playing or recording.", args: {} },
  "play": { help: "Play from the playhead.", args: {} },
  "stop": { help: "Stop playing or recording.", args: {} },
  "marker": { help: "Add a cue marker to the active file.",
    args: { at: { type: "number", required: true }, name: { type: "string", "default": "" },
      comment: { type: "string", "default": "" }, duration: { type: "number", "default": 0 } } },
  "save": { help: "Save the active file as --path.", args: { path: { type: "out", required: true } } },
  "eval": { help: "Run your own ExtendScript; `return` a value to get it back as JSON.",
    args: { code: { type: "string" }, file: { type: "file" }, force: { type: "bool", help: "skip the ES3 check" } }, before: readScriptFile }
};

// --file or --code, checked for ExtendScript traps unless --force (a mistake there can leave a dialog up).
function readScriptFile(args) {
  var name = args.file || "<code>";
  if (args.file) args.code = fs.readFileSync(args.file, "utf8");
  if (!args.code) throw usage("give --code or --file");
  delete args.file;
  if (args.force) { delete args.force; return; }
  var problems = lint(args.code);
  if (problems.length) {
    var e = usage("the script has ExtendScript (ES3) problems; fix them or pass --force");
    e.problems = problems.map(function (p) { return name + ":" + p.line + ": " + p.message; });
    throw e;
  }
}

// ---- ES3 lint: the traps that broke scripts or raised dialogs in After Effects and Premiere.
var RESERVED = ("break case catch class const continue debugger default delete do else enum export extends false " +
  "finally for function if implements import in instanceof interface let new null package private " +
  "protected public return static super switch this throw true try typeof var void while with yield").split(" ");
var LINT_RULES = [
  [new RegExp("[{,]\\s*(" + RESERVED.filter(function (w) { return w !== "case" && w !== "default"; }).join("|") + ")\\s*:", "g"),
    "reserved word used as an object key ({0}:): ExtendScript is ES3; quote it or rename it"],
  [/,\s*(default)\s*:/g, "reserved word used as an object key ({0}:): quote it or rename it"],
  [new RegExp("(^|[^.])\\.\\s*(" + RESERVED.join("|") + ")\\b", "g"), "reserved word used as a property name (.{0}): use obj[\"{0}\"] or rename it", 2],
  [/(^|[^\w$.])(let|const)\s+[\w$\[{]/g, "'{0}' is not ExtendScript (ES3): use var", 2],
  [/=>/g, "arrow functions are not ExtendScript (ES3): use function () {}"],
  [/`/g, "template literals are not ExtendScript (ES3): concatenate strings"],
  [/\.\.\.[\w$\[]/g, "spread/rest syntax is not ExtendScript (ES3)"],
  [/(^|[^\w$.])(async|await)\s/g, "'{0}' is not ExtendScript (ES3)", 2],
  [/(^|[^\w$.])class\s+[A-Za-z_$]/g, "class syntax is not ExtendScript (ES3)"],
  [/\.(forEach|map|filter|reduce|reduceRight|some|every|find|findIndex|includes|trim|startsWith|endsWith|padStart)\s*\(/g,
    ".{0}() does not exist in ExtendScript (ES3): use a for loop or a helper"],
  [/(^|[^\w$.])(Object\.keys|Object\.assign|Object\.create|Array\.isArray|Array\.from)\s*\(/g, "{0}() does not exist in ExtendScript (ES3)", 2],
  [/(^|[^\w$.])(alert|confirm|prompt)\s*\(/g, "{0}() opens a modal dialog in the app: return the value instead", 2]
];

// Strings and comments blanked (newlines kept), so the rules only see code.
function stripCode(source) {
  var out = [], i = 0, n = source.length;
  while (i < n) {
    var c = source[i];
    if (c === "\"" || c === "'") {
      var j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      var closed = j < n && source[j] === c;
      out.push(c + new Array(Math.max(0, Math.min(j, n) - i)).join(" ") + (closed ? c : ""));
      i = closed ? j + 1 : j;
    } else if (source.substr(i, 2) === "//") {
      var e = source.indexOf("\n", i); e = e < 0 ? n : e;
      out.push(new Array(e - i + 1).join(" ")); i = e;
    } else if (source.substr(i, 2) === "/*") {
      var k = source.indexOf("*/", i + 2); k = k < 0 ? n : k + 2;
      out.push(source.slice(i, k).replace(/[^\n]/g, " ")); i = k;
    } else { out.push(c); i++; }
  }
  return out.join("");
}

function lint(source) {
  var code = stripCode(source), seen = {}, out = [];
  LINT_RULES.forEach(function (rule) {
    var re = rule[0], m, group = rule[2] || 1;
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      var line = code.slice(0, m.index).split("\n").length, word = m[group] !== undefined ? m[group] : m[0];
      var message = rule[1].replace(/\{0\}/g, word), key = line + "|" + message;
      if (!seen[key]) { seen[key] = true; out.push({ line: line, message: message }); }
      if (m[0] === "") re.lastIndex++;
    }
  });
  return out.sort(function (a, b) { return a.line - b.line; });
}

// Files that ship inside Premiere's own app folder (newest Premiere first), on Mac and Windows.
function findInPremiere(parts) {
  var win = process.platform === "win32", root = win ? "C:\\Program Files\\Adobe" : "/Applications", dirs = [];
  try { dirs = fs.readdirSync(root).filter(function (d) { return /^Adobe Premiere Pro/.test(d); }).sort().reverse(); } catch (e) {}
  for (var i = 0; i < dirs.length; i++) {
    var base = win ? path.join(root, dirs[i]) : path.join(root, dirs[i], dirs[i] + ".app", "Contents");
    var file = path.join.apply(path, [base].concat(parts));
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function defaultEncoderPreset(args) {
  if (args.preset) return;
  args.preset = findInPremiere(["MediaIO", "systempresets", "4E49434B_48323634", "01 - Match Source - High bitrate.epr"]);
  if (!args.preset) throw usage("couldn't find Premiere's H.264 preset; pass --preset /path/to/preset.epr");
}

// Scripts can't open the New Sequence dialog, so a sequence always starts from a preset file.
function defaultSequencePreset(args) {
  if (args.preset) return;
  args.preset = findInPremiere(["Settings", "SequencePresets", "Social", "Social Media Portrait 9x16 30 fps.sqpreset"]) ||
    findInPremiere(["Settings", "SequencePresets", "HD 1080p", "HD 1080p 30 fps.sqpreset"]);
  if (!args.preset) throw usage("couldn't find a sequence preset in Premiere's folder; pass --preset /path/to/file.sqpreset");
}

// Exports and frames are written in the background; answer once the file exists and stops growing.
function waitForFile(result, args, timeoutMs) {
  var file = (result && result.out) || args.out;
  return waitUntil(timeoutMs || 3600000, function () {
    try { var a = fs.statSync(file).size; } catch (e) { return false; }
    return a > 0 && sleepSize(file, a);
  }).then(function () { result.bytes = fs.statSync(file).size; return result; });
}

function waitForPng(result, args) {
  var file = (result && result.out) || args.out;
  return waitUntil(120000, function () {
    try { var b = fs.readFileSync(file); } catch (e) { return false; }
    return b.length > 12 && b.slice(-8, -4).toString() === "IEND";
  }).then(function () { result.bytes = fs.statSync(file).size; return result; });
}

var lastSizes = {};
function sleepSize(file, size) {
  // The same size for three polls in a row (a second apart) counts as finished.
  var last = lastSizes[file];
  lastSizes[file] = { size: size, count: last && last.size === size ? last.count + 1 : 1 };
  if (lastSizes[file].count < 3) return false;
  delete lastSizes[file];
  return true;
}

function waitUntil(timeoutMs, test) {
  var deadline = Date.now() + timeoutMs;
  return new Promise(function (resolve, reject) {
    (function poll() {
      if (test()) return resolve();
      if (Date.now() > deadline) return reject(new Error("timed out waiting for the output file"));
      setTimeout(poll, 1000);
    })();
  });
}

// ---- effects: the mix bus is only visible in a project file, so Premiere writes the sequence to a temporary
// copy (the open project is untouched) and we read the master track's effect chain from it.
var os = require("os");
var zlib = require("zlib");
var childProcess = require("child_process");
var AUDIO_EFFECTS = require("./audio-effects.json"); // match name -> name, Premiere's built-in audio effects

function tempCopy(args) {
  args.copy = path.join(os.tmpdir(), "adobe-cli-effects-" + process.pid + "-" + Date.now() + ".prproj");
}

function mixBusEffects(result, args) {
  return waitUntil(30000, function () { try { return fs.statSync(args.copy).size > 0; } catch (e) { return false; } }).then(function () {
    var xml = zlib.gunzipSync(fs.readFileSync(args.copy)).toString("utf8");
    try { fs.unlinkSync(args.copy); } catch (e) {}
    delete result.copy;
    result.mix = filterNames(xml, (/<MasterTrack ObjectRef="(\d+)"/.exec(xml) || [])[1]);
    return result;
  });
}

function xmlObject(xml, id) {
  var m = new RegExp('<(\\w+) ObjectID="' + id + '"[^>]*>([\\s\\S]*?)</\\1>').exec(xml);
  return m ? { type: m[1], body: m[2] } : null;
}

// Track -> component chain -> components; effects are the AudioFilterComponents.
function filterNames(xml, trackId) {
  var names = [], track = trackId && xmlObject(xml, trackId);
  if (!track) return names;
  var refs = track.body.match(/ObjectRef="\d+"/g) || [];
  refs.forEach(function (ref) {
    var chain = xmlObject(xml, ref.replace(/\D/g, ""));
    if (!chain || chain.type !== "AudioComponentChain") return;
    (chain.body.match(/ObjectRef="\d+"/g) || []).forEach(function (cref) {
      var comp = xmlObject(xml, cref.replace(/\D/g, ""));
      var match = comp && comp.type === "AudioFilterComponent" && /<FilterMatchName>([^<]+)</.exec(comp.body);
      if (match) names.push(AUDIO_EFFECTS[match[1]] || match[1]);
    });
  });
  return names;
}

// ---- import, cut, place: refuse a file whose picture and sound don't start together. Premiere counts a clip's time
// from its picture, so in/out points read off the sound (a transcript, a waveform) land on the wrong words. Section
// downloads (yt-dlp --download-sections) start between keyframes and often begin with seconds of sound and no picture.
function firstPts(probe, file, stream) {
  try {
    var out = childProcess.execFileSync(probe, ["-v", "error", "-select_streams", stream, "-show_entries", "packet=pts_time",
      "-read_intervals", "%+#1", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 15000, windowsHide: true }).trim().split(/\r?\n/)[0];
    var t = parseFloat(out);
    return isNaN(t) ? null : t;
  } catch (e) { return null; }
}

function checkStreamStarts(args, cwd) {
  var probe;
  try { probe = ffmpegPath().replace(/ffmpeg(\.exe)?$/i, function (m, exe) { return "ffprobe" + (exe || ""); }); } catch (e) { return; }
  if (!fs.existsSync(probe)) return;
  var files = [].concat(args.files || [], args.source ? [args.source] : [],
    Array.isArray(args.cuts) ? args.cuts.map(function (c) { return c && c.source; }) : []).filter(Boolean);
  var seen = {}, problems = [];
  files.forEach(function (f) {
    var file = path.isAbsolute(f) ? f : path.resolve(cwd || process.cwd(), f);
    if (seen[file] || !fs.existsSync(file)) return;
    seen[file] = true;
    var v = firstPts(probe, file, "v:0"), a = firstPts(probe, file, "a:0");
    if (v === null || a === null || Math.abs(v - a) < 0.05) return;
    problems.push(path.basename(file) + ": the picture starts " + Math.abs(v - a).toFixed(2) + " s " + (v > a ? "after" : "before") +
      " the sound, so cut times read off the sound would land on the wrong words. Make a copy that starts both at the first frame: ffmpeg -ss " +
      Math.max(v, a).toFixed(3) + " -i \"" + path.basename(file) + "\" -vf setpts=PTS-STARTPTS -af asetpts=PTS-STARTPTS <new name>.mp4, then take every time from the copy.");
  });
  if (problems.length) { var e = usage(problems.join(" ")); e.problems = problems; throw e; }
}

// ---- shots: score every frame of each clip's source range against the previous one (ffmpeg's scene score)
// and report the first frame of each new shot as a sequence frame.
function ffmpegPath() {
  var list = [process.env.ADOBE_CLI_FFMPEG, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "C:\\ffmpeg\\bin\\ffmpeg.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe")];
  for (var i = 0; i < list.length; i++) if (list[i] && fs.existsSync(list[i])) return list[i];
  try { return childProcess.execSync(process.platform === "win32" ? "where ffmpeg" : "command -v ffmpeg", { encoding: "utf8" }).split(/\r?\n/)[0].trim(); } catch (e) {}
  throw new Error("shots needs ffmpeg (Mac: brew install ffmpeg; Windows: winget install Gyan.FFmpeg) or ADOBE_CLI_FFMPEG=/path/to/ffmpeg");
}

function detectShots(result, args) {
  var ffmpeg = ffmpegPath(), TICKS = 254016000000, frame = result.timebase, shots = [];
  var jobs = result.clips.filter(function (c) { return c.media; }).map(function (c) {
    return function () {
      var inS = c.inPoint / TICKS, dur = (c.end - c.start) / TICKS;
      return run(ffmpeg, ["-hide_banner", "-nostats", "-ss", String(inS), "-i", c.media, "-t", String(dur), "-an", "-sn",
        "-vf", "scale=320:-2,select=gte(scene\\,0),metadata=print:key=lavfi.scene_score:file=-", "-f", "null", "-"]).then(function (out) {
        var re = /pts_time:([\d.]+)[\s\S]*?lavfi\.scene_score=([\d.]+)/g, m, first = true;
        while ((m = re.exec(out))) {
          var t = Number(m[1]), score = Number(m[2]);
          if (first) { first = false; continue; } // the first frame has nothing before it
          if (score < args.threshold) continue;
          // The first sequence frame whose time reaches the new shot's first source frame.
          var seqFrame = Math.ceil((c.start + t * TICKS) / frame - 0.001);
          if (seqFrame * frame >= c.end) continue;
          shots.push({ frame: seqFrame, time: Math.round(seqFrame * frame / TICKS * 1000) / 1000, track: c.track, clip: c.clip,
            sourceTime: Math.round((inS + t) * 1000) / 1000, score: Math.round(score * 100) / 100 });
        }
      });
    };
  });
  return jobs.reduce(function (p, job) { return p.then(job); }, Promise.resolve()).then(function () {
    return { fps: Math.round(result.fps * 1000) / 1000, threshold: args.threshold, shots: shots,
      edits: result.clips.map(function (c) { return { track: c.track, clip: c.clip, frame: Math.round(c.start / frame), time: Math.round(c.start / TICKS * 1000) / 1000 }; }) };
  });
}

function run(cmd, argv) {
  return new Promise(function (resolve, reject) {
    childProcess.execFile(cmd, argv, { maxBuffer: 256 * 1024 * 1024 }, function (err, stdout, stderr) {
      if (err) return reject(new Error("ffmpeg failed: " + String(stderr).split("\n").slice(-3).join(" ")));
      resolve(stdout);
    });
  });
}

function usage(message) { var e = new Error(message); e.usage = true; return e; }

module.exports = { PPRO: PR, AEFT: AE, AUDT: AU, usage: usage, filterNames: filterNames, lint: lint, checkStreamStarts: checkStreamStarts };
