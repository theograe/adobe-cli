// An Adobe app's windows at the modal-panel level (8), where Premiere's and After Effects' alerts and modal dialogs
// sit; `on` says whether it is on screen (a dialog on another desktop Space isn't, and neither are the apps' hidden
// helpers at that level). Needs no permission.
//   osascript -l JavaScript mac.js <pid | pr | ae | au>             ->  [{"id":…, "on":…, "name":…, "width":…, "height":…}]
//   osascript -l JavaScript mac.js <app> ids                         ->  "12,34" (the baseline, before sending a script)
//   osascript -l JavaScript mac.js <app> blocking [baseline ids]     ->  the dialogs: on screen, or new since the baseline
ObjC.import("AppKit");
ObjC.import("CoreGraphics");
var APPS = { pr: "Adobe Premiere Pro", ae: "Adobe After Effects", au: "Adobe Audition" };
function run(argv) {
  var want = argv[0], pid = Number(want);
  if (!pid) {
    var apps = ObjC.unwrap($.NSWorkspace.sharedWorkspace.runningApplications);
    for (var i = 0; i < apps.length && !pid; i++) {
      var url = apps[i].bundleURL, p = url && url.path ? String(url.path.js) : "";
      // The app itself: its own bundle and a Dock icon (helpers such as TeamProjectsLocalHub report the same bundle).
      var name = p.split("/").pop();
      if (name.indexOf(APPS[want]) === 0 && name.indexOf("Render Engine") < 0 && Number(apps[i].activationPolicy) === 0) pid = Number(apps[i].processIdentifier);
    }
  }
  if (!pid) return argv[1] === "ids" ? "" : "[]";
  var mode = argv[1] || "", baseline = {};
  String(argv[2] || "").split(",").forEach(function (id) { if (id) baseline[id] = true; });
  var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0))) || [];
  var found = list.filter(function (w) {
    return w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 8 && w.kCGWindowAlpha > 0;
  }).map(function (w) { var b = w.kCGWindowBounds || {}; return { id: w.kCGWindowNumber, on: !!w.kCGWindowIsOnscreen, name: w.kCGWindowName || "", width: b.Width, height: b.Height }; });
  if (mode === "ids") return found.map(function (w) { return w.id; }).join(",");
  if (mode === "blocking") found = found.filter(function (w) { return w.on || (argv.length > 2 && !baseline[w.id]); });
  return JSON.stringify(found);
}
