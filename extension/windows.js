// Whether an Adobe app is showing a dialog, from outside it: dialogs/mac.js (macOS window list, modal-panel level)
// or dialogs/win.ps1 (Windows owned windows). Needs no permission. The `adobe` command and OS5's client run the same
// scripts while they wait for an answer: After Effects freezes this page while it runs a script or shows a dialog,
// so only Premiere and Audition can be watched from in here.

var childProcess = require("child_process");
var path = require("path");

// The dialogs the app (a pid, or pr / ae / au) shows: [{id, on, name, width, height}], or null when unreadable.
exports.dialogs = function (app) {
  var mac = process.platform !== "win32", script = path.join(__dirname, "dialogs", mac ? "mac.js" : "win.ps1");
  var cmd = mac ? "/usr/bin/osascript" : "powershell.exe";
  var argv = mac ? ["-l", "JavaScript", script, String(app), "blocking"] : ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, String(app), "blocking"];
  return new Promise(function (resolve) {
    childProcess.execFile(cmd, argv, { timeout: 20000, windowsHide: true }, function (err, stdout) {
      try { resolve(err ? null : JSON.parse(String(stdout).trim() || "[]")); } catch (e) { resolve(null); }
    });
  });
};
