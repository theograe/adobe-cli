// Shared by Premiere Pro and After Effects. ExtendScript is ES3: var only, no arrow functions, no
// forEach/map, no Object.keys. Commands are functions on ADOBECLI.cmd that take an args object and
// return something JSON-able; throwing an Error becomes {"ok": false, "error": "..."}.

// The JSON polyfill checks itself: a broken JSON left behind by another script stays for the whole
// session, so replace it whenever it fails the self-test.
if (typeof JSON !== "object") { JSON = {}; }
if (!JSON.stringify || JSON.stringify(String.fromCharCode(34, 10)) !== String.fromCharCode(34, 92, 34, 92, 110, 34)) {
  JSON.stringify = function s(v) {
    var t = typeof v, i, o;
    if (v === null || v === undefined || t === "function") return "null";
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return String(v);
    if (t === "string") {
      o = [];
      for (i = 0; i < v.length; i++) {
        var n = v.charCodeAt(i), e = v.charAt(i);
        if (n === 34) e = "\\\""; else if (n === 92) e = "\\\\"; else if (n === 10) e = "\\n"; else if (n === 13) e = "\\r";
        else if (n < 32 || n > 126) e = "\\u" + ("0000" + n.toString(16)).slice(-4);
        o.push(e);
      }
      return "\"" + o.join("") + "\"";
    }
    if (v instanceof Array) { o = []; for (i = 0; i < v.length; i++) o.push(s(v[i])); return "[" + o.join(",") + "]"; }
    o = [];
    for (i in v) if (v.hasOwnProperty(i) && typeof v[i] !== "function" && v[i] !== undefined) o.push(s(String(i)) + ":" + s(v[i]));
    return "{" + o.join(",") + "}";
  };
}
if (!JSON.parse) { JSON.parse = function (text) { return eval("(" + text + ")"); }; }

var ADOBECLI = ADOBECLI || {};
ADOBECLI.cmd = ADOBECLI.cmd || {};

ADOBECLI.ready = function () {
  var names = [];
  for (var k in ADOBECLI.cmd) if (ADOBECLI.cmd.hasOwnProperty(k)) names.push(k);
  return names.length + " commands";
};

// The project / sequence / comp a request names (--project, --sequence, --comp); each host resolves it lazily.
ADOBECLI.target = {};

ADOBECLI.run = function (name, argsJson) {
  var r, quiet = typeof app.beginSuppressDialogs === "function";
  if (quiet) { try { app.beginSuppressDialogs(); } catch (ignore) {} }
  try {
    var fn = ADOBECLI.cmd[name];
    if (!fn) throw new Error("this app has no command '" + name + "'");
    var args = JSON.parse(argsJson);
    ADOBECLI.target = { project: args.project, sequence: args.sequence, comp: args.comp };
    if (ADOBECLI.useTarget) ADOBECLI.useTarget(name);
    if (/"-?\d+f"/.test(argsJson)) args = ADOBECLI.frameTimes(args, ADOBECLI.frameSeconds(args));
    var value = fn(args);
    r = { ok: true, result: value === undefined ? null : value };
  } catch (e) {
    r = { ok: false, error: String(e && e.message ? e.message : e) };
    if (e && typeof e.evalLine === "number") r.line = e.evalLine;
    else if (e && typeof e.line === "number") r.line = e.line;
  }
  ADOBECLI.target = {};
  if (quiet) { try { app.endSuppressDialogs(false); } catch (ignore) {} }
  try { return JSON.stringify(r); } catch (serialError) { return JSON.stringify({ ok: true, result: String(r.result) }); }
};

// Any time can be given as a frame number: "149f" is frame 149 of the sequence (Premiere) or comp (After
// Effects). Frames become exact seconds here; each host defines ADOBECLI.frameSeconds(args).
ADOBECLI.TIME_KEYS = { at: 1, "in": 1, out: 1, start: 1, end: 1, duration: 1 };
ADOBECLI.frameTimes = function (value, frame) {
  if (value instanceof Array) { for (var i = 0; i < value.length; i++) value[i] = ADOBECLI.frameTimes(value[i], frame); return value; }
  if (value && typeof value === "object") {
    for (var k in value) {
      if (!value.hasOwnProperty(k)) continue;
      var m = typeof value[k] === "string" ? /^(-?\d+)f$/.exec(value[k]) : null;
      if (m && ADOBECLI.TIME_KEYS[k]) value[k] = Number(m[1]) * frame;
      else value[k] = ADOBECLI.frameTimes(value[k], frame);
    }
  }
  return value;
};

// eval: the code is the body of a function, so `return x` hands x back. Each host binds its target to names the
// code can use (ADOBECLI.evalScope: Premiere `project` and `sequence`, After Effects `project` and `comp`). Error
// lines count from the code's first line.
ADOBECLI.cmd["eval"] = function (a) {
  var scope = ADOBECLI.evalScope ? ADOBECLI.evalScope(a) : {}, names = [], values = [];
  for (var k in scope) if (scope.hasOwnProperty(k)) { names.push(k); values.push(scope[k]); }
  var fn;
  try { fn = eval("(function(" + names.join(",") + "){\n" + a.code + "\n})"); }
  catch (syntax) { ADOBECLI.rethrow(syntax); }
  try { return fn.apply(null, values); }
  catch (e) { ADOBECLI.rethrow(e); }
};

ADOBECLI.rethrow = function (e) {
  var err = new Error(String(e && e.message ? e.message : e));
  if (e && typeof e.line === "number") err.evalLine = e.line - 1;
  throw err;
};

// The resolved target, for callers (and plug-ins) that want to know where a command will act.
ADOBECLI.cmd["target"] = function () { return ADOBECLI.describeTarget ? ADOBECLI.describeTarget() : null; };

ADOBECLI.round = function (n, places) {
  var f = Math.pow(10, places === undefined ? 3 : places);
  return Math.round(Number(n) * f) / f;
};

ADOBECLI.hexColor = function (hex) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) throw new Error("colors look like #FFD400, got " + hex);
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
};

ADOBECLI.arrayContains = function (list, value) {
  for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
  return false;
};
