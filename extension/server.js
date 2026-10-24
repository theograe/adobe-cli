// Runs inside Premiere Pro / After Effects / Audition (CEP, Node enabled). Listens on 127.0.0.1 and turns each
// `adobe pr|ae|au <command> --flags` request into ExtendScript in the app: one request at a time, in arrival order
// (the queue), with holds for callers that need several steps in a row, and a watch for dialogs that block the app.
// Plug-ins listed in ~/.adobe-cli/plugins add their own commands (`adobe <app> <plugin> <command>`).

var http = require("http");
var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");
var querystring = require("querystring");
var url = require("url");
var commands = require("./commands.js");
var windows = require("./windows.js");

var PORTS = { PPRO: 47651, AEFT: 47652, AUDT: 47653 };
var HOST_SCRIPTS = { PPRO: "premiere.jsx", AEFT: "aftereffects.jsx", AUDT: "audition.jsx" };
var CLI_NAMES = { PPRO: "pr", AEFT: "ae", AUDT: "au" };
var LABELS = { PPRO: "Premiere Pro", AEFT: "After Effects", AUDT: "Audition" };
var HOME = path.join(os.homedir(), ".adobe-cli");
var HOLD_IDLE_MS = 30000;   // a hold ends this long after its holder's last request (X-Adobe-CLI-Hold-Idle: up to 600 s)
var STALL_MS = 3000;        // a request this long without an answer gets its dialog check

var state = {
  app: "", version: "", root: "", table: null, log: "", plugins: {}, offset: 0,
  engine: Promise.resolve(),   // evalScript calls, in order
  waiting: [], running: null, hold: null, blocked: null
};

exports.start = function (root, show) {
  show = show || function () {};
  var env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
  state.app = env.appName;
  state.version = env.appVersion;
  state.root = root;
  state.table = commands[state.app];
  // A development copy (extension id ending in .dev) answers 10 ports up, beside the installed one.
  try { state.offset = /\.dev$/.test(window.__adobe_cep__.getExtensionId()) ? 10 : 0; } catch (e) {}
  state.log = path.join(HOME, state.app.toLowerCase() + (state.offset ? "-dev" : "") + ".log");
  if (!state.table) return;
  mkdirp(HOME);
  var token = readToken();
  loadPlugins();
  loadHostScripts().then(function (out) { log("host scripts loaded: " + out); });

  var server = http.createServer(function (req, res) { handle(req, res, token); });
  var port = PORTS[state.app] + state.offset;
  var cli = "<b>adobe " + CLI_NAMES[state.app] + "</b>";
  server.on("error", function (e) {
    if (e.code === "EADDRINUSE") return show("Ready: " + cli + " is answered by the background copy of Adobe CLI.");
    log("server error: " + e.message);
    show("Error: " + e.message);
  });
  server.listen(port, "127.0.0.1", function () {
    log("listening on 127.0.0.1:" + port + " for " + state.app + " " + state.version);
    show("Ready: " + cli + " commands run in this app.");
  });
};

// A shared secret so web pages can't drive the app through localhost (they can't read this file).
function readToken() {
  var file = path.join(HOME, "token");
  try { var t = fs.readFileSync(file, "utf8").trim(); if (t) return t; } catch (e) {}
  var fresh = crypto.randomBytes(24).toString("hex");
  try { fs.writeFileSync(file, fresh + "\n", { mode: 384 }); } catch (e) {}
  try { return fs.readFileSync(file, "utf8").trim(); } catch (e) { return fresh; } // another app may have won the race
}

function log(line) {
  try { fs.appendFileSync(state.log, new Date().toISOString() + " " + line + "\n"); } catch (e) {}
}

// ---- HTTP

function handle(req, res, token) {
  var host = String(req.headers.host || "");
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return reply(res, 403, { ok: false, error: "forbidden host" });
  var u = url.parse(req.url, true);
  if (u.pathname === "/ping") return reply(res, 200, { ok: true, app: state.app, version: state.version, plugins: Object.keys(state.plugins) });
  if (req.headers["x-adobe-cli-token"] !== token) return reply(res, 401, { ok: false, error: "wrong or missing token (~/.adobe-cli/token)" });
  if (u.pathname === "/queue") return reply(res, 200, queueStatus());
  if (u.pathname === "/has") return reply(res, hasCommand(u.query.plugin, u.query.command) ? 200 : 404, { ok: true });
  if (req.method !== "POST") return reply(res, 404, { ok: false, error: "not found" });
  if (u.pathname === "/release") {
    var id = String(req.headers["x-adobe-cli-hold"] || "");
    if (state.hold && state.hold.id === id) { state.hold = null; pump(); }
    return reply(res, 200, { ok: true });
  }
  if (u.pathname !== "/run") return reply(res, 404, { ok: false, error: "not found" });
  var body = "";
  req.on("data", function (chunk) { body += chunk; });
  req.on("end", function () {
    var form = querystring.parse(body);
    var argv = form.a === undefined ? [] : [].concat(form.a);
    var idle = Math.min(600, Number(req.headers["x-adobe-cli-hold-idle"]) || 0) * 1000 || HOLD_IDLE_MS;
    var job = { argv: argv, cwd: String(form.cwd || os.homedir()), hold: String(req.headers["x-adobe-cli-hold"] || ""), idle: idle,
      label: String(req.headers["x-adobe-cli-label"] || argv.slice(0, 2).join(" ")), queued: Date.now(), res: res, done: false };
    // Help and argument errors answer at once; everything that touches the app takes its turn.
    var early = prepare(job);
    if (early) return finish(job, early);
    if (state.blocked) return finish(job, blockedAnswer());
    res.on("close", function () {  // the caller gave up while waiting: drop its turn
      var at = state.waiting.indexOf(job);
      if (!job.done && at >= 0) { job.done = true; state.waiting.splice(at, 1); }
    });
    state.waiting.push(job);
    pump();
  });
}

function reply(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2) + "\n");
}

function finish(job, out) {
  if (job.done) return;
  job.done = true;
  if (job.internal) job.settle(out); else reply(job.res, out.status, out.body);
}

// Work a plug-in queues for later (importing a render once it finishes): it waits its turn like a request.
function enqueue(plugin, label, fn) {
  return new Promise(function (resolve, reject) {
    var job = { argv: [], label: label, hold: "", queued: Date.now(), done: false, internal: fn, plugin: plugin,
      settle: function (out) { if (out.body.ok) resolve(out.body.result); else reject(new Error(out.body.error)); } };
    if (state.blocked) return finish(job, blockedAnswer());
    state.waiting.push(job);
    pump();
  });
}

function queueStatus() {
  var now = Date.now(), busy = state.running || state.hold, summary = "";
  if (busy) summary = (state.running ? "" : "held by ") + busy.label.replace(/["\\\n]/g, "'") + " (" + Math.round((now - (busy.started || busy.since)) / 1000) + "s)" +
    (state.waiting.length ? ", " + state.waiting.length + " waiting" : "");
  return {
    summary: summary,
    ok: true, app: state.app,
    running: state.running ? { label: state.running.label, seconds: Math.round((now - state.running.started) / 1000) } : null,
    hold: state.hold ? { label: state.hold.label, seconds: Math.round((now - state.hold.since) / 1000) } : null,
    waiting: state.waiting.map(function (j) { return { label: j.label, seconds: Math.round((now - j.queued) / 1000), reason: j.reason || "" }; }),
    blocked: state.blocked ? state.blocked.error : null
  };
}

// ---- the queue

// The next request that may run: the hold's own requests while a hold lasts, else the oldest; a plug-in guard
// can make a request wait without holding up the ones behind it.
function pump() {
  if (state.running || state.blocked) return;
  if (state.hold && Date.now() > state.hold.until) { log("hold " + state.hold.label + " ended (idle)"); state.hold = null; }
  var next = null, retry = false;
  for (var i = 0; i < state.waiting.length; i++) {
    var job = state.waiting[i];
    if (state.hold && job.hold !== state.hold.id) continue;
    var reason = guarded(job);
    job.reason = reason || "";
    if (reason) { retry = true; continue; }
    next = job;
    break;
  }
  if (state.hold && !next) setTimeout(pump, Math.max(50, state.hold.until - Date.now() + 10));
  if (retry && !next) setTimeout(pump, 5000);
  if (!next) return;
  state.waiting.splice(state.waiting.indexOf(next), 1);
  if (next.hold) {
    if (!state.hold) state.hold = { id: next.hold, label: next.label, since: Date.now() };
    state.hold.idle = next.idle;
    state.hold.until = Date.now() + next.idle;
  }
  next.started = Date.now();
  state.running = next;
  watch(next);
  execute(next).then(function (out) {
    if (state.hold && state.hold.id === next.hold) state.hold.until = Date.now() + state.hold.idle;
    if (next.blockedAnswered) log(next.label + " finished after its dialog was dismissed: " + JSON.stringify(out.body).slice(0, 500));
    finish(next, out);
  }).then(function () {
    state.running = null;
    if (state.blocked) { log("unblocked: " + state.blocked.error); state.blocked = null; }
    pump();
  });
}

function guarded(job) {
  for (var name in state.plugins) {
    var guard = state.plugins[name].guard;
    if (typeof guard !== "function") continue;
    try { var why = guard({ app: state.app, argv: job.argv, args: job.args || {}, label: job.label }); if (why) return String(why); }
    catch (e) { log("guard of " + name + " failed: " + e.message); }
  }
  return "";
}

// ---- dialogs

// A request that hasn't answered after STALL_MS: when the app shows a dialog (windows.js) on two checks in a row,
// the request and every later one answer "blocked" at once; nothing is retried. After Effects freezes this page while
// it runs a script, so there the caller's own watch (bin/adobe, OS5's client) reports it instead.
var CLI_KEYS = { PPRO: "pr", AEFT: "ae", AUDT: "au" };
function watch(job) {
  var seen = 0;
  function check() {
    if (job.done || state.running !== job) return;
    windows.dialogs(CLI_KEYS[state.app]).then(function (found) {
      if (job.done || state.running !== job) return;
      seen = found && found.length ? seen + 1 : 0;
      if (seen < 2) return setTimeout(check, 1500);
      var w = found[0], what = w.name ? "'" + w.name + "'" : "a " + w.width + "×" + w.height + " dialog";
      state.blocked = { since: Date.now(), error: LABELS[state.app] + " is blocked on a dialog (" + what + ", while running " + job.label +
        "). Someone has to dismiss it in the app; nothing was retried. The script continues once it is dismissed." };
      log("blocked: " + state.blocked.error);
      job.blockedAnswered = true;
      finish(job, blockedAnswer());
      state.waiting.splice(0).forEach(function (j) { finish(j, blockedAnswer()); });
    });
  }
  setTimeout(check, STALL_MS);
}

function blockedAnswer() {
  return { status: 409, body: { ok: false, blocked: true, error: state.blocked.error } };
}

// ---- commands

// The command table a request names: the app's own, or a plug-in's (`grae render …`).
function lookup(argv) {
  var plugin = state.plugins[argv[0]];
  if (plugin) {
    var table = (plugin.apps[state.app] || {}).commands || {};
    return { plugin: plugin, prefix: argv[0], table: table, name: argv[1], rest: argv.slice(2) };
  }
  return { plugin: null, prefix: "", table: state.table, name: argv[0], rest: argv.slice(1) };
}

function hasCommand(plugin, name) {
  var p = state.plugins[plugin];
  if (!p || !p.apps[state.app]) return false;
  return !name || !!p.apps[state.app].commands[name];
}

// Parses and checks a request. Returns an answer when it needs no turn in the app (help, bad arguments).
function prepare(job) {
  var argv = job.argv, found = lookup(argv), name = found.name;
  if (!name || name === "help" || name === "--help" || name === "-h") return { status: 200, body: overview(found) };
  if (name === "reload" && !found.plugin) return null;
  var spec = found.table[name];
  if (!spec) return { status: 400, body: { ok: false, error: "unknown command '" + (found.prefix ? found.prefix + " " : "") + name + "'", commands: Object.keys(found.table) } };
  if (found.rest.indexOf("--help") >= 0 || found.rest.indexOf("-h") >= 0) return { status: 200, body: describe(name, spec) };
  try {
    job.args = parseArgs(found.rest, withTargets(spec), job.cwd);
    if (spec.before) spec.before(job.args);
    if (spec.after && job.args.out) { try { fs.unlinkSync(job.args.out); } catch (e) {} }
  } catch (e) {
    return { status: 400, body: { ok: false, error: e.message, problems: e.problems, usage: describe(name, spec) } };
  }
  job.spec = spec;
  job.found = found;
  return null;
}

// Every Premiere and After Effects command can name its project, Premiere ones their sequence too.
function withTargets(spec) {
  if (state.app === "AUDT" || spec.args.project) return spec;
  var args = {};
  for (var k in spec.args) args[k] = spec.args[k];
  args.project = { type: "file", help: "the project to act on (opened if it isn't); default: the front one" };
  if (state.app === "PPRO" && !args.sequence) args.sequence = { type: "names", help: "sequence name, or a JSON list of names (the first that exists)" };
  return { help: spec.help, args: args, before: spec.before, after: spec.after, run: spec.run, host: spec.host, example: spec.example };
}

function execute(job) {
  var started = Date.now();
  if (job.argv[0] === "reload") {
    [require.resolve("./commands.js"), require.resolve("./audio-effects.json")].forEach(function (f) { delete require.cache[f]; });
    commands = require("./commands.js");
    state.table = commands[state.app];
    loadPlugins();
    return loadHostScripts().then(function (out) { return { status: 200, body: { ok: true, result: out, plugins: Object.keys(state.plugins) } }; });
  }
  if (job.internal) {
    return Promise.resolve().then(function () { return job.internal(pluginApi(job.plugin, {})); }).then(function (value) {
      return { status: 200, body: { ok: true, result: value === undefined ? null : value } };
    }, function (e) { log(job.label + " failed: " + e.message); return { status: 500, body: { ok: false, error: e.message } }; });
  }
  var spec = job.spec, args = job.args, name = job.found.name;
  var work = job.found.plugin ? runPlugin(job.found.plugin, spec, args) : evalHost(name, args);
  return work.then(function (payload) {
    if (!payload.ok || !spec.after) return payload;
    return Promise.resolve(spec.after(payload.result, args)).then(function (result) { return { ok: true, result: result }; });
  }).then(function (payload) {
    payload.seconds = Math.round((Date.now() - started) / 100) / 10;
    if (!payload.ok) log(job.label + " failed: " + payload.error);
    return { status: payload.ok ? 200 : 500, body: payload };
  }, function (e) {
    log(job.label + " failed: " + e.message);
    return { status: 500, body: { ok: false, error: e.message } };
  });
}

// What plug-in code gets: host(fn, args) and eval(code) in the app (inside its turn), command(name, args) for a core
// command, queued(label, fn) for later work that takes its own turn, log, dir and the resolved target.
function pluginApi(plugin, args) {
  return {
    dir: plugin.dir, app: state.app, target: null,
    log: function (line) { log("[" + plugin.name + "] " + line); },
    host: function (fn, list) { return hostCall(fn, list || []); },
    eval: function (code) { return evalHost("eval", { code: code, project: args.project, sequence: args.sequence, comp: args.comp }).then(unwrap); },
    command: function (name, a) {
      var full = {}, k;
      for (k in a) full[k] = a[k];
      ["project", "sequence"].forEach(function (key) { if (full[key] === undefined && args[key] !== undefined) full[key] = args[key]; });
      return evalHost(name, full).then(unwrap);
    },
    queued: function (label, fn) { return enqueue(plugin, label, fn); }
  };
}

// A plug-in command: its own Node `run` with a small API, or the host function it names. The target
// (--project, --sequence, --comp) is resolved first, so the plug-in acts on it.
function runPlugin(plugin, spec, args) {
  var api = pluginApi(plugin, args);
  var target = args.project || args.sequence || args.comp ? evalHost("target", { project: args.project, sequence: args.sequence, comp: args.comp }) : Promise.resolve({ ok: true, result: null });
  return target.then(function (t) {
    if (!t.ok) return t;
    api.target = t.result;
    var work = spec.run ? spec.run(args, api) : api.host(spec.host, (spec.hostArgs || function () { return []; })(args));
    return Promise.resolve(work).then(function (value) {
      if (value && typeof value === "object" && value.ok === false) return { ok: false, error: value.error || "failed", result: value };
      return { ok: true, result: value === undefined ? null : value };
    });
  });
}

function unwrap(payload) {
  if (!payload.ok) { var e = new Error(payload.error); e.line = payload.line; throw e; }
  return payload.result;
}

// --flag value pairs, checked against the command's argument list.
function parseArgs(tokens, spec, cwd) {
  var args = {}, i = 0;
  while (i < tokens.length) {
    var tok = tokens[i];
    if (tok === "--json") { i++; continue; } // output is always JSON; accepted for habit
    if (tok.slice(0, 2) !== "--") throw commands.usage("unexpected '" + tok + "' (arguments look like --name value)");
    var key = tok.slice(2), def = spec.args[key];
    if (!def) throw commands.usage("unknown option --" + key);
    if (def.type === "bool") { args[key] = true; i++; continue; }
    if (def.type === "files") {
      var list = [];
      for (i++; i < tokens.length && tokens[i].slice(0, 2) !== "--"; i++) list.push(existing(tokens[i], cwd));
      if (!list.length) throw commands.usage("--" + key + " needs at least one file");
      args[key] = list;
      continue;
    }
    if (i + 1 >= tokens.length) throw commands.usage("--" + key + " needs a value");
    args[key] = convert(key, def, tokens[i + 1], cwd);
    i += 2;
  }
  for (var k in spec.args) {
    if (args[k] === undefined && spec.args[k]["default"] !== undefined) args[k] = spec.args[k]["default"];
    if (args[k] === undefined && spec.args[k].required) throw commands.usage("--" + k + " is required");
  }
  return args;
}

function convert(key, def, raw, cwd) {
  switch (def.type) {
    case "number":
      var n = Number(raw);
      if (raw === "" || !isFinite(n)) throw commands.usage("--" + key + " must be a number, got '" + raw + "'");
      return n;
    case "time":
      if (/^-?\d+f$/.test(raw)) return raw; // a frame number; the app turns it into seconds
      var t = Number(raw);
      if (raw === "" || !isFinite(t)) throw commands.usage("--" + key + " is seconds (2.5) or a frame number (149f), got '" + raw + "'");
      return t;
    case "file": return existing(raw, cwd);
    case "path": return resolve(raw, cwd);
    case "out":
      var out = resolve(raw, cwd);
      mkdirp(path.dirname(out));
      return out;
    case "names":
      if (/^\s*\[/.test(raw)) { try { return JSON.parse(raw).map(String); } catch (e) { throw commands.usage("--" + key + " is a name or a JSON list of names"); } }
      return [raw];
    case "json":
      var text = /^\s*[\[{]/.test(raw) ? raw : fs.readFileSync(existing(raw, cwd), "utf8");
      try { return resolveSources(JSON.parse(text), cwd); } catch (e) { throw commands.usage("--" + key + " is not valid JSON: " + e.message); }
    case "value":
      if (/^\s*[\[{]/.test(raw)) return JSON.parse(raw);
      var parts = raw.split(",").map(Number);
      for (var i = 0; i < parts.length; i++) if (!isFinite(parts[i])) throw commands.usage("--" + key + " must be numbers like 100 or 540,960");
      return parts.length === 1 ? parts[0] : parts;
    default:
      // "source" may be a file path or a project item name; resolve it when it is a file.
      if (key === "source") { var p = resolve(raw, cwd); if (fs.existsSync(p)) return p; }
      return raw;
  }
}

// Cut lists may name sources relative to where `adobe` ran.
function resolveSources(value, cwd) {
  if (value instanceof Array) for (var i = 0; i < value.length; i++) {
    var src = value[i] && value[i].source;
    if (typeof src === "string") { var p = resolve(src, cwd); if (fs.existsSync(p)) value[i].source = p; }
  }
  return value;
}

// mkdir -p (CEP 9's Node has no recursive option).
function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  fs.mkdirSync(dir);
}

function resolve(p, cwd) {
  if (p === "~" || p.indexOf("~/") === 0) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(cwd, p);
}

function existing(p, cwd) {
  var full = resolve(p, cwd);
  if (!fs.existsSync(full)) throw commands.usage("file not found: " + full);
  return full;
}

function overview(found) {
  var list = {};
  for (var k in found.table) list[k] = found.table[k].help;
  var usage = "adobe " + CLI_NAMES[state.app] + " " + (found.prefix ? found.prefix + " " : "") + "<command> --option value …  (add --help after a command for its options)";
  var out = { ok: true, app: state.app, usage: usage, commands: list };
  if (!found.prefix) {
    out.plugins = {};
    for (var p in state.plugins) if (state.plugins[p].apps[state.app]) out.plugins[p] = state.plugins[p].help || "";
  }
  return out;
}

function describe(name, spec) {
  var opts = {}, all = withTargets(spec).args;
  for (var k in all) {
    var a = all[k];
    opts["--" + k] = a.type + (a.required ? ", required" : "") + (a["default"] !== undefined ? ", default " + JSON.stringify(a["default"]) : "") + (a.help ? " — " + a.help : "");
  }
  return { ok: true, command: name, help: spec.help, options: opts, example: spec.example };
}

// ---- ExtendScript

function evalScript(script) {
  var job = state.engine.then(function () {
    return new Promise(function (resolve) { window.__adobe_cep__.evalScript(script, resolve); });
  });
  state.engine = job.then(null, function () {});
  return job;
}

function evalHost(name, args) {
  var call = "ADOBECLI.run(" + jsString(name) + "," + jsString(JSON.stringify(args)) + ")";
  return evalScript(call).then(function (raw) {
    if (raw === "EvalScript error." || raw === undefined || raw === "") {
      return { ok: false, error: "the app could not run the command (ExtendScript engine error); try `adobe " + CLI_NAMES[state.app] + " reload`" };
    }
    try { return JSON.parse(raw); } catch (e) { return { ok: false, error: "unreadable answer from the app: " + String(raw).slice(0, 300) }; }
  });
}

// fn("arg", "arg") in the app, every argument a string (JSON for objects). Answers parsed JSON when it is JSON.
function hostCall(fn, list) {
  var call = "typeof " + fn + "===\"function\"?" + fn + "(" + list.map(function (a) { return jsString(typeof a === "string" ? a : JSON.stringify(a)); }).join(",") + "):\"__ADOBECLI_MISSING__\"";
  return evalScript(call).then(function (raw) {
    if (raw === "__ADOBECLI_MISSING__") throw new Error("the app has no host function " + fn + " (is the plug-in's host script loaded? `adobe " + CLI_NAMES[state.app] + " reload`)");
    if (raw === "EvalScript error.") throw new Error(fn + " failed in the app (ExtendScript engine error)");
    try { return JSON.parse(raw); } catch (e) { return raw; }
  });
}

// Top-level $.evalFile so the definitions become globals (inside a function they'd stay local). Plug-in host
// scripts load after the core's.
function loadHostScripts() {
  var dir = path.join(state.root, "host"), files = ["common.jsx", HOST_SCRIPTS[state.app]].map(function (f) { return path.join(dir, f); });
  for (var name in state.plugins) {
    var app = state.plugins[name].apps[state.app];
    (app && app.host || []).forEach(function (f) { files.push(path.resolve(state.plugins[name].dir, f)); });
  }
  return evalScript(files.map(function (f) { return "$.evalFile(" + jsString(f.replace(/\\/g, "/")) + ");"; }).join("") + "ADOBECLI.ready()");
}

// ~/.adobe-cli/plugins: one "<name>\t<folder>" per line; the folder has adobe-plugin.js.
function loadPlugins() {
  var lines = [];
  try { lines = fs.readFileSync(path.join(HOME, "plugins"), "utf8").split(/\r?\n/); } catch (e) {}
  state.plugins = {};
  lines.forEach(function (line) {
    var m = /^([a-z][a-z0-9-]*)\t(.+)$/.exec(line.trim().replace(/^(\S+)\s+/, "$1\t"));
    if (!m) return;
    var file = path.join(m[2], "adobe-plugin.js");
    try {
      delete require.cache[require.resolve(file)];
      var p = require(file);
      p.name = m[1];
      p.dir = m[2];
      p.apps = p.apps || {};
      state.plugins[m[1]] = p;
    } catch (e) { log("plug-in " + m[1] + " (" + file + ") did not load: " + e.message); }
  });
}

// A JSON string literal that ExtendScript reads safely (non-ASCII as \u escapes).
function jsString(s) {
  return JSON.stringify(String(s)).replace(/[\u007f-￿]/g, function (c) { return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4); });
}
