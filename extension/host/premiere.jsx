// Premiere Pro commands. Times in and out are seconds; tracks are named V1, V2… and A1, A2….

var PR = {
  TICKS: 254016000000,

  time: function (seconds) { var t = new Time(); t.ticks = String(Math.round(Number(seconds) * PR.TICKS)); return t; },
  ticks: function (seconds) { return String(Math.round(Number(seconds) * PR.TICKS)); },
  sec: function (t) { return ADOBECLI.round(Number(typeof t === "object" ? t.ticks : t) / PR.TICKS); },
  ticksOf: function (t) { return Number(typeof t === "object" ? t.ticks : t); },

  // Seconds to the nearest whole frame of the sequence, as ticks (a string, which Premiere reads exactly).
  snap: function (seq, seconds) {
    var frame = Number(seq.timebase);
    return String(Math.round(Number(seconds) * PR.TICKS / frame) * frame);
  },
  snapTime: function (seq, seconds) { var t = new Time(); t.ticks = PR.snap(seq, seconds); return t; },
  frameOf: function (seq, t) { return Math.round(PR.ticksOf(t) / Number(seq.timebase)); },

  // The project a command acts on: --project (found among the open projects by path, opened if it isn't), the
  // project of --sequence, or the front project.
  project: function () {
    var t = ADOBECLI.target;
    if (t.proj) return t.proj;
    if (t.project) {
      var p = PR.openProject(t.project);
      if (!p) {
        if (!new File(t.project).exists) throw new Error("no project at " + t.project);
        app.openDocument(t.project, true, true, true, true);
        p = PR.openProject(t.project);
        if (!p) throw new Error("Premiere could not open " + t.project);
      }
      return (t.proj = p);
    }
    if (t.sequence && t.sequence.length) { PR.sequence(); return t.proj; }
    if (!app.project || !app.project.rootItem) throw new Error("no project is open (adobe pr project-new --path …)");
    return app.project;
  },

  openProject: function (file) {
    for (var i = 0; i < app.projects.numProjects; i++) if (PR.samePath(app.projects[i].path, file)) return app.projects[i];
    return null;
  },

  // The sequence a command acts on: --sequence (a list of names, the first that exists; in --project, else in any
  // open project, refused when two projects have it), else the target project's only sequence, else the active one.
  sequence: function () {
    var t = ADOBECLI.target, seq, i, n;
    if (t.seq) return t.seq;
    if (t.sequence && t.sequence.length) {
      var projects = [];
      if (t.project) projects.push(PR.project());
      else for (i = 0; i < app.projects.numProjects; i++) projects.push(app.projects[i]);
      for (n = 0; n < t.sequence.length && !seq; n++) {
        var hits = [];
        for (i = 0; i < projects.length; i++) {
          var found = PR.namedSequence(projects[i], t.sequence[n]);
          if (found) hits.push({ seq: found, project: projects[i] });
        }
        if (hits.length > 1) throw new Error("a sequence named '" + t.sequence[n] + "' is in " + hits.length + " open projects; add --project");
        if (hits.length) { seq = hits[0].seq; if (!t.proj) t.proj = hits[0].project; }
      }
      if (!seq) throw new Error("no sequence named " + t.sequence.join(" / ") + (t.project ? " in " + t.project : " in the open projects"));
      return (t.seq = seq);
    }
    var proj = PR.project();
    if (t.project && !PR.samePath(proj.path, app.project.path)) {
      if (proj.sequences.numSequences === 1) return (t.seq = proj.sequences[0]);
      throw new Error(proj.name + " isn't the front project and has " + proj.sequences.numSequences + " sequences: say which with --sequence");
    }
    seq = proj.activeSequence;
    if (!seq) throw new Error("no active sequence (adobe pr seq-new or seq-open, or --sequence)");
    // With several projects open, Premiere can report another project's sequence as active.
    if (!PR.sequenceIds(proj)[String(seq.sequenceID)]) throw new Error("the active sequence '" + seq.name + "' belongs to another open project; open one of " + proj.name + "'s sequences (seq-open) first");
    return (t.seq = seq);
  },

  namedSequence: function (proj, name) {
    for (var s = 0; s < proj.sequences.numSequences; s++) if (proj.sequences[s].name === name) return proj.sequences[s];
    return null;
  },

  // QE only knows the front project's active sequence: bring the target forward first (its tab opens). A copy of a
  // project keeps its sequences' IDs, so the front project must be the target's too.
  qeSequence: function (seq) {
    seq = seq || PR.sequence();
    var proj = PR.project();
    function front() { return app.project.activeSequence && PR.samePath(app.project.path, proj.path) && app.project.activeSequence.sequenceID === seq.sequenceID; }
    if (!front()) {
      proj.openSequence(seq.sequenceID);
      if (!front()) throw new Error("Premiere did not bring " + seq.name + " (" + proj.name + ") forward");
    }
    app.enableQE();
    return qe.project.getActiveSequence();
  },

  track: function (seq, name) {
    var m = /^([VA])(\d+)$/i.exec(String(name || ""));
    if (!m) throw new Error("tracks are named like V1 or A2, got '" + name + "'");
    var video = m[1].toUpperCase() === "V", index = Number(m[2]) - 1, list = video ? seq.videoTracks : seq.audioTracks;
    if (index < 0 || index >= list.numTracks) throw new Error("the sequence has no track " + name.toUpperCase() + " (it has " + list.numTracks + " " + (video ? "video" : "audio") + " tracks)");
    return { track: list[index], video: video, index: index, name: m[1].toUpperCase() + (index + 1) };
  },

  samePath: function (a, b) {
    return a && b && new File(a).fsName === new File(b).fsName;
  },

  walk: function (bin, visit) {
    for (var i = 0; i < bin.children.numItems; i++) {
      var item = bin.children[i];
      visit(item);
      if (item.type === ProjectItemType.BIN) PR.walk(item, visit);
    }
  },

  findByPath: function (file) {
    var found = null;
    PR.walk(PR.project().rootItem, function (item) {
      if (found || item.type === ProjectItemType.BIN) return;
      var p = "";
      try { p = item.getMediaPath(); } catch (e) {}
      if (PR.samePath(p, file)) found = item;
    });
    return found;
  },

  findByName: function (name) {
    var found = null;
    PR.walk(PR.project().rootItem, function (item) { if (!found && item.name === name && item.type !== ProjectItemType.BIN) found = item; });
    return found;
  },

  bin: function (name) {
    var root = PR.project().rootItem;
    if (!name) return root;
    for (var i = 0; i < root.children.numItems; i++) if (root.children[i].type === ProjectItemType.BIN && root.children[i].name === name) return root.children[i];
    return root.createBin(name);
  },

  // A project item for a file path (imported on first use) or an existing item's name.
  item: function (source, binName) {
    if (new File(source).exists) {
      var item = PR.findByPath(source);
      if (item) return item;
      if (!PR.project().importFiles([source], true, PR.bin(binName), false)) throw new Error("Premiere could not import " + source);
      item = PR.findByPath(source);
      if (!item) throw new Error("imported " + source + " but can't find it in the project");
      return item;
    }
    var named = PR.findByName(source);
    if (!named) throw new Error("no file or project item called '" + source + "'");
    return named;
  },

  clipInfo: function (clip, index) {
    var info = { clip: index + 1, name: clip.name, start: PR.sec(clip.start), end: PR.sec(clip.end), "in": PR.sec(clip.inPoint), out: PR.sec(clip.outPoint) };
    try { var seq = PR.sequence(); info.startFrame = PR.frameOf(seq, clip.start); info.endFrame = PR.frameOf(seq, clip.end); } catch (e) {}
    try { if (clip.projectItem) info.media = clip.projectItem.getMediaPath(); } catch (e) {}
    return info;
  },

  // The clips a command acts on: --all, --clip N (1 = first) or --at seconds.
  clips: function (a) {
    var seq = PR.sequence(), t = PR.track(seq, a.track), list = [], i;
    for (i = 0; i < t.track.clips.numItems; i++) {
      var c = t.track.clips[i], s = PR.sec(c.start), e = PR.sec(c.end);
      if (a.all || (a.clip && a.clip === i + 1) || (!a.clip && a.at !== undefined && s <= a.at && a.at < e)) list.push({ clip: c, index: i });
    }
    if (!a.all && a.clip === undefined && a.at === undefined) throw new Error("say which clip: --clip N, --at seconds or --all");
    if (!list.length) throw new Error("no clip on " + t.name + " matches");
    return { seq: seq, track: t, list: list };
  },

  clipAt: function (track, startSeconds) {
    for (var i = 0; i < track.clips.numItems; i++) if (Math.abs(PR.sec(track.clips[i].start) - startSeconds) < 0.01) return { clip: track.clips[i], index: i };
    return null;
  },

  // Put source [in, out] at timeline time `at`. Video goes to vIndex, its audio to aIndex. Times go to the
  // nearest whole frame of the sequence; returns the placed length in seconds.
  place: function (item, a, vIndex, aIndex) {
    var seq = PR.sequence();
    var snap = function (s) { return PR.snap(seq, s); };
    if (a.conform) PR.conform(item, seq);
    var inT = a["in"] !== undefined ? snap(a["in"]) : null, outT = a.out !== undefined ? snap(a.out) : null;
    if (inT !== null) item.setInPoint(inT, 4);
    if (outT !== null) item.setOutPoint(outT, 4);
    var at = new Time(); at.ticks = snap(a.at);
    try {
      if (a.mode === "insert") seq.insertClip(item, at, vIndex, aIndex);
      else seq.overwriteClip(item, at, vIndex, aIndex);
    } finally {
      try { item.clearInPoint(); item.clearOutPoint(); } catch (e) {}
    }
    return inT !== null && outT !== null ? (Number(outT) - Number(inT)) / PR.TICKS : null;
  },

  fps: function (seq) { return ADOBECLI.round(PR.TICKS / Number(seq.timebase), 3); },

  // Interpret the file at the sequence frame rate, so every source frame is one sequence frame (29.97 fps
  // B-roll in a 30 fps sequence plays 0.1% faster). Applies to every use of the file in the project.
  conform: function (item, seq) {
    var fps = PR.TICKS / Number(seq.timebase);
    try { item.setOverrideFrameRate(fps); } catch (e) { throw new Error("Premiere could not conform " + item.name + " to " + PR.fps(seq) + " fps: " + e); }
  },

  qeTrack: function (t) {
    var qs = PR.qeSequence();
    return t.video ? qs.getVideoTrackAt(t.index) : qs.getAudioTrackAt(t.index);
  },

  // The QE twin of a timeline clip (QE has effects and transitions the regular DOM lacks).
  qeClip: function (t, clip) {
    var qt = PR.qeTrack(t), want = PR.ticksOf(clip.start);
    for (var i = 0; i < qt.numItems; i++) {
      var it = qt.getItemAt(i);
      if (String(it.type) === "Clip" && Math.abs(Number(it.start.ticks) - want) < 1) return it;
    }
    throw new Error("can't find " + clip.name + " in Premiere's QE timeline");
  },

  frameSize: function (projectItem) {
    var meta = "";
    try { meta = projectItem.getProjectMetadata(); } catch (e) {}
    var m = /VideoInfo>\s*(\d+)\s*x\s*(\d+)/.exec(meta);
    if (!m) throw new Error("can't read the frame size of " + projectItem.name);
    return { width: Number(m[1]), height: Number(m[2]) };
  },

  component: function (clip, matchNames, displayName) {
    for (var i = 0; i < clip.components.numItems; i++) {
      var c = clip.components[i];
      if (ADOBECLI.arrayContains(matchNames, String(c.matchName)) || c.displayName === displayName) return c;
    }
    throw new Error(clip.name + " has no " + displayName + " effect");
  },

  param: function (component, name) {
    for (var i = 0; i < component.properties.numItems; i++) if (component.properties[i].displayName === name) return component.properties[i];
    throw new Error(component.displayName + " has no " + name + " control");
  },

  timecode: function (seq, seconds) {
    var frame = Math.round(Number(seconds) * PR.TICKS / Number(seq.timebase));
    var t = new Time(); t.ticks = String(frame * Number(seq.timebase));
    var fr = new Time(); fr.ticks = String(seq.timebase);
    return t.getFormatted(fr, seq.getSettings().videoDisplayFormat);
  },

  seqInfo: function (seq) {
    return { name: seq.name, id: seq.sequenceID, width: Number(seq.frameSizeHorizontal), height: Number(seq.frameSizeVertical),
      fps: PR.fps(seq), duration: PR.sec(seq.end), videoTracks: seq.videoTracks.numTracks, audioTracks: seq.audioTracks.numTracks };
  },

  sequenceIds: function (proj) {
    var ids = {};
    proj = proj || PR.project();
    for (var i = 0; i < proj.sequences.numSequences; i++) ids[String(proj.sequences[i].sequenceID)] = true;
    return ids;
  }
};

var C = ADOBECLI.cmd;

C["status"] = function () {
  var out = { app: "Premiere Pro", version: app.version, project: null, projects: [] };
  for (var i = 0; i < app.projects.numProjects; i++) out.projects.push(app.projects[i].path);
  if (app.project && app.project.rootItem) {
    out.project = { name: app.project.name, path: app.project.path, sequences: app.project.sequences.numSequences };
    if (app.project.activeSequence && PR.sequenceIds()[String(app.project.activeSequence.sequenceID)]) out.sequence = PR.seqInfo(app.project.activeSequence);
  }
  return out;
};

C["project-new"] = function (a) {
  if (!/\.prproj$/i.test(a.path)) a.path += ".prproj";
  if (new File(a.path).exists) throw new Error(a.path + " already exists; pick a new name or use project-open");
  if (!app.newProject(a.path)) throw new Error("Premiere could not create " + a.path);
  if (!PR.samePath(app.project.path, a.path)) {
    for (var i = 0; i < app.projects.numProjects; i++) if (PR.samePath(app.projects[i].path, a.path)) { app.projects[i].activate && app.projects[i].activate(); }
  }
  return { path: app.project.path, name: app.project.name };
};

C["project-open"] = function (a) {
  if (!app.openDocument(a.path, true, true, true, true)) throw new Error("Premiere could not open " + a.path);
  return { path: app.project.path, name: app.project.name };
};

C["project-save"] = function (a) {
  var p = PR.project();
  if (a.path) { if (!/\.prproj$/i.test(a.path)) a.path += ".prproj"; p.saveAs(a.path); return { path: a.path }; }
  p.save();
  return { path: p.path };
};

C["project-close"] = function (a) {
  if (!a.save && !a.discard) throw new Error("say --save or --discard (unsaved changes are lost with --discard)");
  var p = PR.project(), path = p.path;
  p.closeDocument(a.save ? 1 : 0, 0);
  return { closed: path };
};

C["import"] = function (a) {
  var out = [];
  for (var i = 0; i < a.files.length; i++) { var item = PR.item(a.files[i], a.bin); out.push({ name: item.name, path: a.files[i] }); }
  return out;
};

C["items"] = function () {
  var out = [];
  PR.walk(PR.project().rootItem, function (item) {
    var row = { name: item.name, type: item.type === ProjectItemType.BIN ? "bin" : "item", bin: item.treePath };
    try { var p = item.getMediaPath(); if (p) row.path = p; } catch (e) {}
    try { if (item.isSequence()) row.type = "sequence"; } catch (e) {}
    out.push(row);
  });
  return out;
};

C["seq-new"] = function (a) {
  var proj = PR.project(), before = PR.sequenceIds(proj);
  // QE makes the sequence in the front project: bring the target forward through one of its sequences.
  if (!PR.samePath(proj.path, app.project.path)) {
    if (!proj.sequences.numSequences) throw new Error(proj.name + " isn't the front project; bring it forward in Premiere first");
    PR.qeSequence(proj.sequences[0]);
  }
  app.enableQE();
  qe.project.newSequence(a.name, a.preset);
  var seq = app.project.activeSequence;
  if (!seq || before[String(seq.sequenceID)]) {
    seq = null;
    for (var i = 0; i < proj.sequences.numSequences; i++) if (!before[String(proj.sequences[i].sequenceID)]) seq = proj.sequences[i];
    if (!seq) throw new Error("Premiere did not create the sequence");
    proj.openSequence(seq.sequenceID);
  }
  var s = seq.getSettings(), rate = new Time();
  // NTSC rates are exact fractions: 29.97 is 30000/1001.
  var exact = { "23.976": 24000 / 1001, "29.97": 30000 / 1001, "59.94": 60000 / 1001 }[String(a.fps)] || a.fps;
  rate.ticks = String(Math.round(PR.TICKS / exact));
  s.videoFrameWidth = a.width;
  s.videoFrameHeight = a.height;
  s.videoFrameRate = rate;
  seq.setSettings(s);
  if (Number(seq.frameSizeHorizontal) !== a.width || Number(seq.frameSizeVertical) !== a.height) throw new Error("Premiere did not take the frame size " + a.width + "x" + a.height);
  return PR.seqInfo(seq);
};

C["seq-list"] = function () {
  var proj = PR.project(), out = [], seqs = proj.sequences, active = proj.activeSequence;
  for (var i = 0; i < seqs.numSequences; i++) { var info = PR.seqInfo(seqs[i]); info.active = !!active && PR.samePath(proj.path, app.project.path) && active.sequenceID === seqs[i].sequenceID; out.push(info); }
  return out;
};

C["seq-open"] = function (a) {
  var proj = PR.project(), seqs = proj.sequences;
  for (var i = 0; i < seqs.numSequences; i++) if (seqs[i].name === a.name) { proj.openSequence(seqs[i].sequenceID); return PR.seqInfo(seqs[i]); }
  throw new Error("no sequence named '" + a.name + "'");
};

C["xml-import"] = function (a) {
  var proj = PR.project(), before = PR.sequenceIds(proj);
  if (!proj.importFiles([a.path], true, proj.rootItem, false)) throw new Error("Premiere could not import " + a.path);
  var made = [], seqs = proj.sequences;
  for (var i = 0; i < seqs.numSequences; i++) if (!before[String(seqs[i].sequenceID)]) made.push(PR.seqInfo(seqs[i]));
  if (made.length) proj.openSequence(made[made.length - 1].id);
  return { sequences: made };
};

C["tracks"] = function () {
  var seq = PR.sequence(), out = { sequence: PR.seqInfo(seq), tracks: [] };
  var kinds = [["V", seq.videoTracks], ["A", seq.audioTracks]];
  for (var k = 0; k < kinds.length; k++) for (var t = 0; t < kinds[k][1].numTracks; t++) {
    var track = kinds[k][1][t], row = { track: kinds[k][0] + (t + 1), clips: [] };
    for (var c = 0; c < track.clips.numItems; c++) row.clips.push(PR.clipInfo(track.clips[c], c));
    out.tracks.push(row);
  }
  return out;
};

C["place"] = function (a) {
  var seq = PR.sequence(), t = PR.track(seq, a.track), item = PR.item(a.source);
  var vIndex = t.video ? t.index : 0, aIndex = t.video ? t.index : t.index;
  if (a["audio-track"]) aIndex = PR.track(seq, a["audio-track"]).index;
  if (a["video-only"]) return C["broll"](a);
  if (!t.video) return C["audio"](a);
  PR.place(item, a, vIndex, aIndex);
  var placed = PR.clipAt(t.track, a.at);
  return placed ? PR.clipInfo(placed.clip, placed.index) : { placed: true };
};

// B-roll: video only. The source's audio is placed on a scratch audio track below everything and removed,
// so no existing audio is overwritten.
C["broll"] = function (a) {
  var seq = PR.sequence(), t = PR.track(seq, a.track), item = PR.item(a.source);
  if (!t.video) throw new Error("B-roll goes on a video track (V2, V3…)");
  var spare = PR.spareTrack(seq, false, a);
  PR.place(item, a, t.index, spare);
  PR.removeAt(seq.audioTracks[spare], a.at);
  var placed = PR.clipAt(t.track, a.at);
  return placed ? PR.clipInfo(placed.clip, placed.index) : { placed: true };
};

// A track index (video or audio) with nothing on it between at and at+length; adds one if every track is busy.
// Used to park the half of a source we don't want (B-roll audio, a music file's video) so nothing is overwritten.
PR.spareTrack = function (seq, video, a) {
  var list = video ? seq.videoTracks : seq.audioTracks;
  var from = a.at, to = a.at + ((a.out !== undefined && a["in"] !== undefined) ? a.out - a["in"] : 36000);
  for (var t = list.numTracks - 1; t >= 0; t--) {
    var free = true, clips = list[t].clips;
    for (var c = 0; c < clips.numItems; c++) if (PR.sec(clips[c].start) < to && PR.sec(clips[c].end) > from) free = false;
    if (free) return t;
  }
  var before = list.numTracks;
  // QE addTracks(videoCount, videoAfter, audioCount, audioType, audioAfter, submixCount, submixType)
  if (video) PR.qeSequence(seq).addTracks(1, before, 0, 1, 0, 0, 0);
  else PR.qeSequence(seq).addTracks(0, 0, 1, 1, before, 0, 0);
  if (list.numTracks === before) throw new Error("every " + (video ? "video" : "audio") + " track is busy there and Premiere could not add one");
  return list.numTracks - 1;
};

PR.removeAt = function (track, at) {
  for (var i = track.clips.numItems - 1; i >= 0; i--) if (Math.abs(PR.sec(track.clips[i].start) - at) < 0.02) track.clips[i].remove(0, 1);
};

C["audio"] = function (a) {
  var seq = PR.sequence(), t = PR.track(seq, a.track), item = PR.item(a.source);
  if (t.video) throw new Error("music and sound effects go on an audio track (A2, A3…)");
  // A file with video would also drop its picture on a video track: park it on an empty one and remove it.
  var spare = PR.spareTrack(seq, true, a);
  PR.place(item, a, spare, t.index);
  PR.removeAt(seq.videoTracks[spare], a.at);
  var placed = PR.clipAt(t.track, a.at);
  if (!placed) throw new Error("Premiere did not place the audio");
  if (a.db !== undefined) PR.setDb(placed.clip, a.db);
  var info = PR.clipInfo(placed.clip, placed.index);
  if (a.db !== undefined) info.db = a.db;
  return info;
};

C["cut"] = function (a) {
  var seq = PR.sequence(), t = PR.track(seq, a.track), at = a.at, out = [];
  if (!(a.cuts instanceof Array) || !a.cuts.length) throw new Error("--cuts must be a list of {source, in, out}");
  for (var i = 0; i < a.cuts.length; i++) {
    var cut = a.cuts[i], source = cut.source || a.source;
    if (!source) throw new Error("cut " + (i + 1) + " has no source (add \"source\" or pass --source)");
    if (typeof cut["in"] !== "number" || typeof cut.out !== "number" || cut.out <= cut["in"]) throw new Error("cut " + (i + 1) + " needs numbers in < out");
    var length = PR.place(PR.item(source), { "in": cut["in"], out: cut.out, at: at }, t.index, t.index);
    out.push({ cut: i + 1, at: ADOBECLI.round(at), "in": cut["in"], out: cut.out });
    at += length;
  }
  return { clips: out, end: ADOBECLI.round(at), sequence: PR.seqInfo(seq) };
};

C["razor"] = function (a) {
  var seq = PR.sequence(), tc = PR.timecode(seq, a.at), names = [], t;
  var qs = PR.qeSequence(seq);
  if (a.track) {
    t = PR.track(seq, a.track);
    (t.video ? qs.getVideoTrackAt(t.index) : qs.getAudioTrackAt(t.index)).razor(tc);
    names.push(t.name);
  } else {
    for (t = 0; t < seq.videoTracks.numTracks; t++) { qs.getVideoTrackAt(t).razor(tc); names.push("V" + (t + 1)); }
    for (t = 0; t < seq.audioTracks.numTracks; t++) { qs.getAudioTrackAt(t).razor(tc); names.push("A" + (t + 1)); }
  }
  return { at: a.at, timecode: tc, tracks: names };
};

C["trim"] = function (a) {
  if (a.start === undefined && a.end === undefined) throw new Error("give --start and/or --end (timeline seconds)");
  var pick = PR.clips(a).list[0], clip = pick.clip;
  var newStart = a.start !== undefined ? a.start : PR.sec(clip.start), newEnd = a.end !== undefined ? a.end : PR.sec(clip.end);
  if (newEnd <= newStart) throw new Error("the clip would end before it starts (" + newStart + " to " + newEnd + ")");
  if (PR.sec(clip.inPoint) + (newStart - PR.sec(clip.start)) < 0) throw new Error("the source has no media before its first frame");
  var seq = PR.sequence();
  if (a.start !== undefined) {
    var startT = PR.snapTime(seq, a.start), shift = PR.ticksOf(startT) - PR.ticksOf(clip.start);
    var inT = new Time(); inT.ticks = String(PR.ticksOf(clip.inPoint) + shift);
    clip.inPoint = inT;
    clip.start = startT;
  }
  if (a.end !== undefined) {
    var endT = PR.snapTime(seq, a.end), change = PR.ticksOf(endT) - PR.ticksOf(clip.end);
    var outT = new Time(); outT.ticks = String(PR.ticksOf(clip.outPoint) + change);
    clip.outPoint = outT;
    clip.end = endT;
  }
  return PR.clipInfo(clip, pick.index);
};

C["delete"] = function (a) {
  var picked = PR.clips(a), removed = [];
  for (var i = picked.list.length - 1; i >= 0; i--) { removed.push(PR.clipInfo(picked.list[i].clip, picked.list[i].index)); picked.list[i].clip.remove(a.ripple ? 1 : 0, 1); }
  return { removed: removed, ripple: !!a.ripple };
};

C["transform"] = function (a) {
  var picked = PR.clips(a), seq = picked.seq, W = Number(seq.frameSizeHorizontal), H = Number(seq.frameSizeVertical), out = [];
  for (var i = 0; i < picked.list.length; i++) {
    var clip = picked.list[i].clip, motion = PR.component(clip, ["AE.ADBE Motion"], "Motion");
    var scaleP = PR.param(motion, "Scale"), posP = PR.param(motion, "Position");
    var scale = a.scale, src = null;
    if (a.fill || a.fit || a.focus !== undefined) src = PR.frameSize(clip.projectItem);
    if (a.fill) scale = Math.max(W / src.width, H / src.height) * 100;
    if (a.fit) scale = Math.min(W / src.width, H / src.height) * 100;
    if (scale !== undefined) scaleP.setValue(scale, true);
    var pos = posP.getValue(), x = a.x !== undefined ? a.x : pos[0], y = a.y !== undefined ? a.y : pos[1];
    if (a.focus !== undefined) {
      // Put the point `focus` (0..1 across the source) at the frame center, without showing edges.
      var shown = src.width * Number(scaleP.getValue()) / 100, px = W / 2 + (0.5 - a.focus) * shown;
      if (shown >= W) px = Math.max(W - shown / 2, Math.min(shown / 2, px));
      x = px / W;
    }
    if (a.x !== undefined || a.y !== undefined || a.focus !== undefined) posP.setValue([x, y], true);
    if (a.rotation !== undefined) PR.param(motion, "Rotation").setValue(a.rotation, true);
    var after = posP.getValue();
    out.push({ clip: picked.list[i].index + 1, scale: ADOBECLI.round(scaleP.getValue(), 2), x: ADOBECLI.round(after[0], 4), y: ADOBECLI.round(after[1], 4) });
  }
  return out;
};

// Effect controls by name. Some effects repeat names (Lumetri has "Contrast" in Basic Correction and in
// HSL Secondary): "Group/Name" means the first Name after the control called Group.
PR.isGroup = function (props, i) {
  return i + 1 < props.numItems && props[i + 1].displayName === "Active" && /\S/.test(props[i].displayName);
};

PR.qualified = function (props, i) {
  for (var g = i - 1; g >= 0; g--) if (PR.isGroup(props, g)) return props[g].displayName + "/" + props[i].displayName;
  return props[i].displayName;
};

PR.control = function (comp, key, value) {
  var props = comp.properties, parts = String(key).split("/"), from = 0, i, j, found = [];
  for (j = 0; j < parts.length - 1; j++) {
    for (i = from; i < props.numItems && props[i].displayName !== parts[j]; i++) {}
    if (i >= props.numItems) throw new Error(comp.displayName + " has no control group '" + parts[j] + "'");
    from = i + 1;
  }
  var name = parts[parts.length - 1];
  for (i = from; i < props.numItems; i++) {
    if (props[i].displayName !== name) continue;
    var current; try { current = props[i].getValue(); } catch (e) { continue; }
    if (typeof value === "number" && typeof current === "boolean") continue; // a section checkbox with the same name
    found.push(i);
    if (parts.length > 1) break;
  }
  if (!found.length) throw new Error(comp.displayName + " has no control '" + key + "'");
  if (found.length > 1) {
    var names = [];
    for (i = 0; i < found.length; i++) names.push(PR.qualified(props, found[i]));
    throw new Error("'" + key + "' is in " + comp.displayName + " more than once; say which: " + names.join(", "));
  }
  return props[found[0]];
};

PR.controls = function (comp) {
  var out = [], props = comp.properties;
  for (var i = 0; i < props.numItems; i++) {
    var v; try { v = props[i].getValue(); } catch (e) { continue; }
    if (!/\S/.test(props[i].displayName) || (typeof v !== "number" && typeof v !== "boolean")) continue;
    out.push(PR.qualified(props, i));
  }
  return out;
};

// Premiere's Level control is linear amplitude with 0 dB stored as 0.1778 (10^(-15/20)); verified on 26.5.
PR.setDb = function (clip, db) {
  var level = PR.param(PR.component(clip, ["AE.ADBE Volume", "ADBE Volume"], "Volume"), "Level");
  level.setValue(Math.pow(10, (db - 15) / 20), true);
  return ADOBECLI.round(20 * Math.log(Number(level.getValue())) / Math.LN10 + 15, 2);
};

C["volume"] = function (a) {
  var picked = PR.clips(a), out = [];
  if (picked.track.video) throw new Error("volume works on audio tracks (A1, A2…)");
  for (var i = 0; i < picked.list.length; i++) out.push({ clip: picked.list[i].index + 1, db: PR.setDb(picked.list[i].clip, a.db) });
  return out;
};

C["marker"] = function (a) {
  var seq = PR.sequence(), at = PR.ticksOf(PR.snap(seq, a.at)) / PR.TICKS;
  var m = seq.markers.createMarker(at);
  m.name = a.name;
  m.comments = a.comment;
  if (a.duration > 0) m.end = PR.snapTime(seq, a.at + a.duration);
  a.at = ADOBECLI.round(at);
  return { at: a.at, name: a.name, comment: a.comment, duration: a.duration };
};

C["markers"] = function () {
  var out = [], markers = PR.sequence().markers, m = markers.getFirstMarker();
  while (m) { out.push({ at: PR.sec(m.start), end: PR.sec(m.end), name: m.name, comment: m.comments }); m = markers.getNextMarker(m); }
  return out;
};

C["captions"] = function (a) {
  var seq = PR.sequence(), item = PR.item(a.srt);
  // Premiere 26 doesn't list caption tracks to scripts; check the result with `adobe pr frame`.
  seq.createCaptionTrack(item, a.at, Sequence.CAPTION_FORMAT_SUBTITLE);
  return { created: true, srt: a.srt, at: a.at };
};

C["frame"] = function (a) {
  var seq = PR.sequence(), base = String(a.out).replace(/\.png$/i, "");
  PR.qeSequence(seq).exportFramePNG(PR.timecode(seq, a.at), base);
  return { out: base + ".png", at: a.at };
};

C["export"] = function (a) {
  var seq = PR.sequence(), range = a["work-area"] ? app.encoder.ENCODE_WORKAREA : app.encoder.ENCODE_ENTIRE;
  if (a.ame) {
    app.encoder.launchEncoder();
    var job = app.encoder.encodeSequence(seq, a.out, a.preset, range, 1);
    if (!job) throw new Error("Media Encoder did not accept the export");
    app.encoder.startBatch();
    return { out: a.out, via: "Media Encoder", job: String(job), preset: a.preset };
  }
  var result = seq.exportAsMediaDirect(a.out, a.preset, range);
  if (!new File(a.out).exists) throw new Error("Premiere did not write " + a.out + (result ? " (" + result + ")" : ""));
  return { out: a.out, via: "Premiere", preset: a.preset };
};

C["effect"] = function (a) {
  var picked = PR.clips(a), t = picked.track, out = [];
  app.enableQE();
  var fx = t.video ? qe.project.getVideoEffectByName(a.name) : qe.project.getAudioEffectByName(a.name);
  if (!fx) throw new Error("Premiere has no " + (t.video ? "video" : "audio") + " effect called '" + a.name + "' (use the name in the Effects panel)");
  for (var i = 0; i < picked.list.length; i++) {
    var clip = picked.list[i].clip, before = clip.components.numItems, qc = PR.qeClip(t, clip);
    if (t.video) qc.addVideoEffect(fx); else qc.addAudioEffect(fx);
    if (clip.components.numItems <= before) throw new Error("Premiere did not add " + a.name + " to " + clip.name);
    var comp = clip.components[clip.components.numItems - 1], set = {};
    try {
      for (var k in (a.props || {})) {
        if (!a.props.hasOwnProperty(k)) continue;
        var p = PR.control(comp, k, a.props[k]);
        p.setValue(a.props[k], true);
        set[k] = p.getValue();
      }
    } catch (e) {
      try { qc.getComponentAt(qc.numComponents - 1).remove(); } catch (ignore) {} // don't leave a half-set effect behind
      throw e;
    }
    out.push({ clip: picked.list[i].index + 1, effect: comp.displayName, set: set });
  }
  return { track: t.name, applied: out, controls: PR.controls(clip.components[clip.components.numItems - 1]) };
};

// A transition on the edit at --at (the nearest clip edge within half a frame). On a lone clip edge it sits at
// that end of the clip.
C["transition"] = function (a) {
  var seq = PR.sequence(), t = PR.track(seq, a.track), at = Number(PR.snap(seq, a.at)), half = Number(seq.timebase) / 2;
  var incoming = null, outgoing = null;
  for (var i = 0; i < t.track.clips.numItems; i++) {
    var c = t.track.clips[i];
    if (Math.abs(PR.ticksOf(c.start) - at) <= half) incoming = c;
    if (Math.abs(PR.ticksOf(c.end) - at) <= half) outgoing = c;
  }
  if (!incoming && !outgoing) throw new Error("no clip starts or ends at " + a.at + "s on " + t.name);
  app.enableQE();
  var tr = t.video ? qe.project.getVideoTransitionByName(a.name) : qe.project.getAudioTransitionByName(a.name);
  if (!tr) throw new Error("Premiere has no " + (t.video ? "video" : "audio") + " transition called '" + a.name + "'");
  var frames = Math.max(1, Math.round(a.duration * PR.TICKS / Number(seq.timebase))), fps = Math.round(PR.TICKS / Number(seq.timebase));
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var tc = pad(Math.floor(frames / (fps * 3600))) + ":" + pad(Math.floor(frames / (fps * 60)) % 60) + ":" + pad(Math.floor(frames / fps) % 60) + ":" + pad(frames % fps);
  var before = t.track.transitions.numItems;
  // On an edit between two clips, centered on the cut; alone, at the clip's own edge.
  var target = incoming || outgoing;
  PR.qeClip(t, target).addTransition(tr, !!incoming, tc, "0", incoming && outgoing ? 0.5 : (incoming ? 0 : 1), !(incoming && outgoing), true);
  if (t.track.transitions.numItems <= before) throw new Error("Premiere did not add the transition (the clips may have no spare media past the cut for a centered transition)");
  var added = t.track.transitions[t.track.transitions.numItems - 1];
  return { track: t.name, name: a.name, start: PR.sec(added.start), end: PR.sec(added.end), frames: frames };
};

// Effects on clips, on audio tracks, and (Node reads them from a copy of the sequence) on the mix bus.
C["effects"] = function (a) {
  var seq = PR.sequence(), out = { clips: [], tracks: [] }, builtIn = { "Opacity": 1, "Motion": 1, "Volume": 1, "Channel Volume": 1, "Panner": 1, "Time Remapping": 1 };
  var kinds = [["V", seq.videoTracks], ["A", seq.audioTracks]];
  for (var k = 0; k < kinds.length; k++) for (var t = 0; t < kinds[k][1].numTracks; t++) {
    var clips = kinds[k][1][t].clips;
    for (var c = 0; c < clips.numItems; c++) {
      var names = [];
      for (var n = 0; n < clips[c].components.numItems; n++) {
        var name = clips[c].components[n].displayName;
        if (a.all || !builtIn[name]) names.push(name);
      }
      if (names.length) out.clips.push({ track: kinds[k][0] + (t + 1), clip: c + 1, name: clips[c].name, start: PR.sec(clips[c].start), effects: names });
    }
  }
  var qs = PR.qeSequence(seq);
  for (t = 0; t < seq.audioTracks.numTracks; t++) {
    var qt = qs.getAudioTrackAt(t), fx = [];
    for (n = 0; n < qt.numComponents; n++) { var label = String(qt.getComponentAt(n).name), m = /^Fx Slot \d+: (.*)$/.exec(label); if (m) fx.push(m[1]); }
    out.tracks.push({ track: "A" + (t + 1), name: seq.audioTracks[t].name, effects: fx });
  }
  seq.exportAsProject(a.copy);
  out.copy = a.copy;
  return out;
};

// Shot changes: Premiere hands Node each clip's media and range; Node runs ffmpeg on the source frames.
C["shots"] = function (a) {
  var seq = PR.sequence(), out = { timebase: Number(seq.timebase), fps: PR.TICKS / Number(seq.timebase), clips: [] };
  var tracks = a.track ? [PR.track(seq, a.track)] : [PR.track(seq, "V1")];
  for (var i = 0; i < tracks.length; i++) {
    var clips = tracks[i].track.clips;
    for (var c = 0; c < clips.numItems; c++) {
      var path = ""; try { path = clips[c].projectItem.getMediaPath(); } catch (e) {}
      out.clips.push({ track: tracks[i].name, clip: c + 1, name: clips[c].name, media: path,
        start: PR.ticksOf(clips[c].start), end: PR.ticksOf(clips[c].end), inPoint: PR.ticksOf(clips[c].inPoint), outPoint: PR.ticksOf(clips[c].outPoint) });
    }
  }
  return out;
};

ADOBECLI.frameSeconds = function () { return Number(PR.sequence().timebase) / PR.TICKS; };

// eval's `project` and `sequence`: the target's (sequence is null when none applies and none was named).
ADOBECLI.evalScope = function () {
  var t = ADOBECLI.target, seq = null;
  if (t.sequence && t.sequence.length) seq = PR.sequence();
  else { try { seq = PR.sequence(); } catch (e) {} }
  return { project: PR.project(), sequence: seq };
};

ADOBECLI.describeTarget = function () {
  var proj = PR.project(), seq = null, t = ADOBECLI.target;
  if (t.sequence && t.sequence.length) seq = PR.sequence();
  else { try { seq = PR.sequence(); } catch (e) {} }
  return { project: { name: proj.name, path: proj.path, front: PR.samePath(proj.path, app.project.path), sequences: proj.sequences.numSequences },
    sequence: seq ? PR.seqInfo(seq) : null };
};
