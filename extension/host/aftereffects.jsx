// After Effects commands. Times are seconds, positions are comp pixels, colors are #RRGGBB.

var AE = {
  // A comp by name, or by id as "#123"; without one, the active comp (or the only comp).
  comp: function (name) {
    var i, item, id = /^#(\d+)$/.exec(String(name || ""));
    if (id) {
      item = app.project.itemByID(Number(id[1]));
      if (!(item instanceof CompItem)) throw new Error("no comp with id " + id[1]);
      return item;
    }
    if (name) {
      for (i = 1; i <= app.project.numItems; i++) { item = app.project.item(i); if (item instanceof CompItem && item.name === name) return item; }
      throw new Error("no comp named '" + name + "'");
    }
    if (app.project.activeItem instanceof CompItem) return app.project.activeItem;
    var comps = AE.comps();
    if (comps.length === 1) return comps[0];
    throw new Error("say which comp with --comp (no comp is active)");
  },

  comps: function () {
    var out = [];
    for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i) instanceof CompItem) out.push(app.project.item(i));
    return out;
  },

  layer: function (comp, ref) {
    var n = Number(ref), layer = null;
    if (String(ref) !== "" && !isNaN(n)) { if (n < 1 || n > comp.numLayers) throw new Error(comp.name + " has no layer " + ref); layer = comp.layer(n); }
    else layer = comp.layer(String(ref));
    if (!layer) throw new Error(comp.name + " has no layer called '" + ref + "'");
    return layer;
  },

  // A footage item for a file (imported on first use) or an existing item's name.
  item: function (source) {
    var f = new File(source), i, item;
    if (f.exists) {
      for (i = 1; i <= app.project.numItems; i++) {
        item = app.project.item(i);
        if (item instanceof FootageItem && item.file && item.file.fsName === f.fsName) return item;
      }
      return app.project.importFile(new ImportOptions(f));
    }
    for (i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === source) return app.project.item(i);
    throw new Error("no file or project item called '" + source + "'");
  },

  compInfo: function (c) {
    return { name: c.name, id: c.id, width: c.width, height: c.height, fps: ADOBECLI.round(c.frameRate), duration: ADOBECLI.round(c.duration), layers: c.numLayers };
  },

  layerInfo: function (l) {
    var p = l.property("ADBE Transform Group").property("ADBE Position").value;
    return { layer: l.index, name: l.name, start: ADOBECLI.round(l.inPoint), end: ADOBECLI.round(l.outPoint), position: [ADOBECLI.round(p[0], 1), ADOBECLI.round(p[1], 1)] };
  },

  PROPS: { position: "ADBE Position", scale: "ADBE Scale", opacity: "ADBE Opacity", rotation: "ADBE Rotate Z", anchor: "ADBE Anchor Point" },

  // How many ease values a property's keyframes take: one for spatial and 1D properties, else one per dimension.
  easeCount: function (prop) {
    var t = prop.propertyValueType;
    if (t === PropertyValueType.TwoD) return 2;
    if (t === PropertyValueType.ThreeD) return 3;
    return 1;
  },

  // 100 for scale means [100, 100]; a 2-number position is fine for a 3D value too.
  shape: function (prop, value) {
    var current = prop.value;
    if (!(current instanceof Array)) { if (value instanceof Array) throw new Error(prop.name + " takes one number"); return value; }
    if (!(value instanceof Array)) { var v = []; for (var i = 0; i < current.length; i++) v.push(i < 2 ? value : current[i]); return v; }
    return value;
  },

  ease: function (prop, index, kind) {
    if (kind === "linear") { prop.setInterpolationTypeAtKey(index, KeyframeInterpolationType.LINEAR); return; }
    if (kind === "hold") { prop.setInterpolationTypeAtKey(index, KeyframeInterpolationType.HOLD); return; }
    if (kind !== "easy" && kind !== "in" && kind !== "out") throw new Error("--ease is linear, easy, in, out or hold");
    prop.setInterpolationTypeAtKey(index, KeyframeInterpolationType.BEZIER);
    var n = AE.easeCount(prop), easeIn = [], easeOut = [], oldIn = prop.keyInTemporalEase(index), oldOut = prop.keyOutTemporalEase(index);
    for (var i = 0; i < n; i++) {
      easeIn.push(kind === "out" ? oldIn[i] : new KeyframeEase(0, 75));
      easeOut.push(kind === "in" ? oldOut[i] : new KeyframeEase(0, 75));
    }
    prop.setTemporalEaseAtKey(index, easeIn, easeOut);
  },

  // Seconds to the nearest whole frame of the comp.
  snap: function (comp, seconds) { return Math.round(Number(seconds) / comp.frameDuration) * comp.frameDuration; },

  unsavedWork: function () {
    if (app.project.numItems === 0) return false;
    return app.project.dirty !== false; // unknown counts as unsaved
  }
};

var C = ADOBECLI.cmd;

C["status"] = function () {
  var out = { app: "After Effects", version: app.version, project: { path: app.project.file ? app.project.file.fsName : null, items: app.project.numItems } };
  if (app.project.activeItem instanceof CompItem) out.comp = AE.compInfo(app.project.activeItem);
  return out;
};

C["project-new"] = function (a) {
  if (!/\.aep$/i.test(a.path)) a.path += ".aep";
  if (new File(a.path).exists) throw new Error(a.path + " already exists; pick a new name or use project-open");
  if (AE.unsavedWork()) throw new Error("the open project may have unsaved changes; save it (project-save) or close it (project-close --save/--discard) first");
  app.newProject();
  app.project.save(new File(a.path));
  return { path: app.project.file.fsName };
};

C["project-open"] = function (a) {
  if (AE.unsavedWork()) throw new Error("the open project may have unsaved changes; save or close it first");
  app.open(new File(a.path));
  return { path: app.project.file ? app.project.file.fsName : null };
};

C["project-save"] = function (a) {
  if (a.path) { if (!/\.aep$/i.test(a.path)) a.path += ".aep"; app.project.save(new File(a.path)); }
  else if (app.project.file) app.project.save();
  else throw new Error("the project has never been saved; give --path");
  return { path: app.project.file.fsName };
};

C["project-close"] = function (a) {
  if (!a.save && !a.discard) throw new Error("say --save or --discard (unsaved changes are lost with --discard)");
  var path = app.project.file ? app.project.file.fsName : null;
  app.project.close(a.save ? CloseOptions.SAVE_CHANGES : CloseOptions.DO_NOT_SAVE_CHANGES);
  return { closed: path };
};

C["import"] = function (a) {
  var out = [];
  for (var i = 0; i < a.files.length; i++) { var item = AE.item(a.files[i]); out.push({ name: item.name, id: item.id }); }
  return out;
};

C["items"] = function () {
  var out = [];
  for (var i = 1; i <= app.project.numItems; i++) {
    var it = app.project.item(i), row = { name: it.name, id: it.id, type: it.typeName };
    if (it instanceof FootageItem && it.file) row.path = it.file.fsName;
    out.push(row);
  }
  return out;
};

C["comp-new"] = function (a) {
  var comp = app.project.items.addComp(a.name, a.width, a.height, 1, a.duration, a.fps);
  if (a.color) comp.bgColor = ADOBECLI.hexColor(a.color);
  comp.openInViewer();
  return AE.compInfo(comp);
};

C["comps"] = function () {
  var out = [], comps = AE.comps();
  for (var i = 0; i < comps.length; i++) out.push(AE.compInfo(comps[i]));
  return out;
};

C["layers"] = function (a) {
  var comp = AE.comp(a.comp), out = [];
  for (var i = 1; i <= comp.numLayers; i++) out.push(AE.layerInfo(comp.layer(i)));
  return { comp: comp.name, layers: out };
};

C["layer-add"] = function (a) {
  var comp = AE.comp(a.comp), layer = comp.layers.add(AE.item(a.source));
  layer.startTime = AE.snap(comp, a.at);
  return AE.layerInfo(layer);
};

C["solid"] = function (a) {
  var comp = AE.comp(a.comp), layer = comp.layers.addSolid(ADOBECLI.hexColor(a.color), a.name, comp.width, comp.height, 1);
  return AE.layerInfo(layer);
};

C["text"] = function (a) {
  var comp = AE.comp(a.comp), layer = comp.layers.addText(a.text), source = layer.property("ADBE Text Properties").property("ADBE Text Document");
  var doc = source.value;
  doc.resetCharStyle();
  doc.fontSize = a.size;
  doc.applyFill = true;
  doc.fillColor = ADOBECLI.hexColor(a.color);
  if (a.font) doc.font = a.font;
  if (a.stroke && a["stroke-width"] > 0) {
    doc.applyStroke = true;
    doc.strokeColor = ADOBECLI.hexColor(a.stroke);
    doc.strokeWidth = a["stroke-width"];
    doc.strokeOverFill = false;
  }
  var just = { left: ParagraphJustification.LEFT_JUSTIFY, center: ParagraphJustification.CENTER_JUSTIFY, right: ParagraphJustification.RIGHT_JUSTIFY }[a.justify];
  if (!just) throw new Error("--justify is left, center or right");
  doc.justification = just;
  source.setValue(doc);
  if (a.name) layer.name = a.name;
  // Anchor at the middle of the text box, so --x/--y place the text's center.
  var box = layer.sourceRectAtTime(0, false), tr = layer.property("ADBE Transform Group");
  tr.property("ADBE Anchor Point").setValue([box.left + box.width / 2, box.top + box.height / 2]);
  tr.property("ADBE Position").setValue([a.x !== undefined ? a.x : comp.width / 2, a.y !== undefined ? a.y : comp.height / 2]);
  if (a.start !== undefined) layer.inPoint = AE.snap(comp, a.start);
  if (a.duration !== undefined) layer.outPoint = layer.inPoint + AE.snap(comp, a.duration);
  var info = AE.layerInfo(layer);
  info.font = source.value.font;
  return info;
};

C["keyframe"] = function (a) {
  var comp = AE.comp(a.comp), layer = AE.layer(comp, a.layer), match = AE.PROPS[String(a.prop).toLowerCase()];
  if (!match) throw new Error("--prop is position, scale, opacity, rotation or anchor");
  var prop = layer.property("ADBE Transform Group").property(match);
  var keys = a.keys || [{ at: a.at, value: a.value }], out = [];
  for (var i = 0; i < keys.length; i++) {
    if (typeof keys[i].at !== "number" || keys[i].value === undefined) throw new Error("each keyframe needs at (seconds) and value");
    keys[i].at = AE.snap(comp, keys[i].at);
    prop.setValueAtTime(keys[i].at, AE.shape(prop, keys[i].value));
  }
  for (i = 0; i < keys.length; i++) {
    var idx = prop.nearestKeyIndex(keys[i].at);
    AE.ease(prop, idx, keys[i].ease || a.ease);
    out.push({ at: keys[i].at, value: prop.keyValue(idx) });
  }
  return { layer: layer.name, prop: a.prop, keys: out };
};

C["effect"] = function (a) {
  var comp = AE.comp(a.comp), layer = AE.layer(comp, a.layer), parade = layer.property("ADBE Effect Parade");
  if (!parade.canAddProperty(a.name)) throw new Error("After Effects has no effect called '" + a.name + "' (use its English name or match name)");
  var fx = parade.addProperty(a.name), set = {}, controls = [];
  for (var k in (a.props || {})) {
    if (!a.props.hasOwnProperty(k)) continue;
    var p = fx.property(k);
    if (!p) throw new Error(fx.name + " has no control '" + k + "'");
    p.setValue(a.props[k]);
    set[k] = p.value;
  }
  for (var i = 1; i <= fx.numProperties; i++) controls.push(fx.property(i).name);
  return { layer: layer.name, effect: fx.name, matchName: fx.matchName, set: set, controls: controls };
};

C["precompose"] = function (a) {
  var comp = AE.comp(a.comp), parts = String(a.layers).split(","), idx = [];
  for (var i = 0; i < parts.length; i++) idx.push(AE.layer(comp, parts[i]).index);
  var made = comp.layers.precompose(idx, a.name, true);
  return AE.compInfo(made);
};

C["render"] = function (a) {
  var comp = AE.comp(a.comp), rq = app.project.renderQueue, paused = [], i;
  // Render only this comp: pause anything else that was queued and put it back afterwards.
  for (i = 1; i <= rq.numItems; i++) if (rq.item(i).status === RQItemStatus.QUEUED) { rq.item(i).render = false; paused.push(rq.item(i)); }
  var item = rq.items.add(comp), om = item.outputModule(1), templates = om.templates, template = a.template;
  if (!template) {
    for (i = 0; i < templates.length && !template; i++) if (/^H\.264 - Match Render Settings/.test(templates[i])) template = templates[i];
    for (i = 0; i < templates.length && !template; i++) if (/H\.264/.test(templates[i])) template = templates[i];
    if (!template) template = "High Quality";
  }
  if (!ADOBECLI.arrayContains(templates, template)) throw new Error("no output module template '" + template + "'; have: " + templates.join(", "));
  om.applyTemplate(template);
  om.file = new File(a.out);
  try { rq.render(); } finally {
    for (i = 0; i < paused.length; i++) try { paused[i].render = true; } catch (e) {}
  }
  var out = om.file.fsName, status = item.status;
  try { item.remove(); } catch (e) {}
  if (status !== RQItemStatus.DONE) throw new Error("render did not finish (status " + status + ")");
  return { out: out, comp: comp.name, template: template };
};

C["frame"] = function (a) {
  var comp = AE.comp(a.comp), out = String(a.out);
  if (!/\.png$/i.test(out)) out += ".png";
  comp.saveFrameToPng(AE.snap(comp, a.at), new File(out));
  return { out: out, comp: comp.name, at: a.at };
};

ADOBECLI.frameSeconds = function (a) { return AE.comp(a && a.comp).frameDuration; };

// --project: After Effects holds one project, so a command for another one saves the open project and opens it.
// An Untitled project with work in it is never closed.
ADOBECLI.useTarget = function (name) {
  var want = ADOBECLI.target.project;
  if (!want || name === "project-new" || name === "project-open") return;
  var f = new File(want);
  if (app.project.file && app.project.file.fsName === f.fsName) return;
  if (!f.exists) throw new Error("no project at " + want);
  if (!app.project.file && app.project.numItems > 0) throw new Error("After Effects has an Untitled project with work in it; save it (project-save --path …) before a command opens " + f.name);
  if (app.project.file) app.project.save();
  app.open(f);
  if (!app.project.file || app.project.file.fsName !== f.fsName) throw new Error("After Effects did not open " + want);
};

// eval's `project` and `comp` (null without --comp).
ADOBECLI.evalScope = function (a) { return { project: app.project, comp: a.comp ? AE.comp(a.comp) : null }; };

ADOBECLI.describeTarget = function () {
  var c = ADOBECLI.target.comp;
  return { project: { path: app.project.file ? app.project.file.fsName : null, items: app.project.numItems }, comp: c ? AE.compInfo(AE.comp(c)) : null };
};
