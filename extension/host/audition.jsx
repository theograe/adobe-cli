// Audition commands. Audition's script DOM (26.5, found by reflection): app.transport (record, stop, pause,
// play; isRecording, isRecordEnabled, isPaused, isPlaying, loop), app.documents / app.activeDocument
// (WaveDocument: displayName, path, duration and playheadPosition in samples, sampleRate, dirty, isBusy,
// markers, addMarker, saveAs, exportDocument, closeDocument), app.openDocument(DocumentOpenParameter) and
// app.invokeCommand(name). There is no scripting access to input meters, peak/clip state or the input device.

var AU = {
  doc: function () {
    var d = app.activeDocument;
    if (!d) throw new Error("no file is open in Audition (adobe au open --path take.wav)");
    return d;
  },

  docInfo: function (d) {
    var rate = Number(d.sampleRate) || 48000;
    return { name: d.displayName, path: String(d.path || "") || null, seconds: ADOBECLI.round(Number(d.duration) / rate),
      playhead: ADOBECLI.round(Number(d.playheadPosition) / rate), sampleRate: rate, unsaved: !!d.dirty, busy: !!d.isBusy };
  },

  transport: function () {
    var t = app.transport;
    return { recording: !!t.isRecording, playing: !!t.isPlaying, paused: !!t.isPaused, canRecord: !!t.isRecordEnabled, loop: !!t.loop };
  }
};

var C = ADOBECLI.cmd;

C["status"] = function () {
  var out = { app: "Audition", version: app.version, transport: AU.transport(), files: [] };
  for (var i = 0; i < app.documents.length; i++) out.files.push(AU.docInfo(app.documents[i]));
  if (app.activeDocument) out.active = app.activeDocument.displayName;
  return out;
};

C["open"] = function (a) {
  var p = new DocumentOpenParameter();
  p.path = a.path;
  if (!app.openDocument(p)) throw new Error("Audition could not open " + a.path);
  return AU.docInfo(AU.doc());
};

// What the transport is doing, plus the active file's length and playhead (during a recording these are
// how far it has got).
C["transport"] = function () {
  var out = AU.transport();
  if (app.activeDocument) out.file = AU.docInfo(app.activeDocument);
  return out;
};

C["record-start"] = function (a) {
  var d = AU.doc(), t = app.transport;
  if (a.file && d.displayName !== a.file) throw new Error("the active file is '" + d.displayName + "', not '" + a.file + "'");
  if (t.isRecording) throw new Error("Audition is already recording");
  if (!t.isRecordEnabled) throw new Error("Audition can't record right now (check the input in Preferences > Audio Hardware)");
  if (!t.record()) throw new Error("Audition did not start recording");
  var out = AU.transport();
  out.file = AU.docInfo(d);
  return out;
};

C["record-stop"] = function () {
  var t = app.transport;
  if (!t.isRecording && !t.isPaused) throw new Error("Audition isn't recording");
  if (!t.stop()) throw new Error("Audition did not stop");
  var out = AU.transport();
  if (app.activeDocument) out.file = AU.docInfo(app.activeDocument);
  return out;
};

C["pause"] = function () {
  if (!app.transport.pause()) throw new Error("Audition did not pause or resume");
  return AU.transport();
};

C["play"] = function () {
  if (!app.transport.play()) throw new Error("Audition did not play");
  return AU.transport();
};

C["stop"] = function () {
  app.transport.stop();
  return AU.transport();
};

C["marker"] = function (a) {
  var d = AU.doc(), rate = Number(d.sampleRate);
  if (!d.addMarker(Math.round(a.at * rate), Math.round((a.duration || 0) * rate), a.name, "Cue", a.comment)) throw new Error("Audition did not add the marker");
  return { at: a.at, name: a.name };
};

C["save"] = function (a) {
  var d = AU.doc();
  if (!d.saveAs(a.path, false)) throw new Error("Audition did not save " + a.path);
  return AU.docInfo(d);
};

ADOBECLI.frameSeconds = function () { throw new Error("Audition takes times in seconds"); };
