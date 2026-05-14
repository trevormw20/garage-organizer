// ============================================================
// Garage Organizer
// ============================================================

const SVG_NS = "http://www.w3.org/2000/svg";

const CATEGORIES = [
  { id: "storage-box",     label: "Storage Box",      color: "#a06236" },
  { id: "trevor-storage",  label: "Trevor's Storage", color: "#2c5f9e" },
  { id: "niki-storage",    label: "Niki's Storage",   color: "#b94a8a" },
  { id: "kids-storage",    label: "Kids' Storage",    color: "#f2a83a" },
  { id: "tools",           label: "Tools",            color: "#d44c4c" },
  { id: "equipment",       label: "Equipment",        color: "#e08a3a" },
  { id: "workbench",       label: "Workbench",        color: "#7a7f8c" },
  { id: "shelves",         label: "Shelves",          color: "#4a8fd6" },
  { id: "toys",            label: "Toys",             color: "#ff6fb5" },
  { id: "temporary",       label: "Temp Storage",     color: "#d6c14a" },
  { id: "going-out",       label: "Going Out",        color: "#5cb85c" },
  { id: "donation",        label: "Donation",         color: "#9b59b6" }
];

// 1 grid cell = 0.5 ft
const FEET_PER_CELL = 0.5;
function ft(cells) {
  const v = cells * FEET_PER_CELL;
  return Number.isInteger(v) ? `${v} ft` : `${v.toFixed(1)} ft`;
}

const DEFAULT_STATE = {
  version: 1,
  garage: { width: 30, height: 20, gridSize: 28, frontWall: "left" },
  zones: [],
  containers: []
};

const ZONE_COLORS = ["#5cb85c", "#4a8fd6", "#d6c14a", "#9b59b6", "#e07b3a", "#d44c4c", "#3aa6c0", "#c45fa6"];

const WALLS = [
  { id: "top",    label: "Top wall (y=0)" },
  { id: "right",  label: "Right wall (x=max)" },
  { id: "bottom", label: "Bottom wall (y=max)" },
  { id: "left",   label: "Left wall (x=0)" }
];

const STORAGE_KEY = "garage-organizer-v1";
const REMOTE_FILE = "garage.json";

// ============================================================
// State
// ============================================================

let state = clone(DEFAULT_STATE);
let view = "2d";
let selectedId = null;       // selected container id
let selectedZoneId = null;   // selected zone id (mutually exclusive with selectedId)
let saveTimer = null;
let lastSavedJson = "";
let isoRotation = 0; // 0..3 (90° steps, CW)
let categoryFilter = "";     // empty = show all; otherwise category id to highlight

// GitHub cloud sync
const GH_OWNER = "trevormw20";
const GH_REPO = "garage-organizer";
const GH_FILE = "garage.json";
const GH_TOKEN_KEY = "gh-token-v1";
const GH_SHA_KEY = "gh-file-sha-v1";
let ghSha = localStorage.getItem(GH_SHA_KEY) || null;
let cloudSaveTimer = null;
let cloudPullInFlight = false;

function getGhToken() { return localStorage.getItem(GH_TOKEN_KEY) || ""; }

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "c-" + Math.random().toString(36).slice(2, 10);
}
function getCategory(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[0];
}
function findContainer(id) {
  return state.containers.find(c => c.id === id);
}
function findZone(id) {
  return state.zones.find(z => z.id === id);
}

// ============================================================
// Storage
// ============================================================

function scheduleSave() {
  setSaveStatus("saving");
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function saveNow() {
  try {
    const json = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, json);
    lastSavedJson = json;
    setSaveStatus("saved");
  } catch (err) {
    console.error("Save failed:", err);
    setSaveStatus("error");
  }
  scheduleCloudSave();
}

function setSaveStatus(s) {
  const el = document.getElementById("saveStatus");
  el.classList.remove("saving", "saved", "error");
  el.classList.add(s);
  el.textContent = s === "saving" ? "Saving…" : s === "saved" ? "Saved" : "Error";
}

// ----- GitHub Cloud Sync -----

function setCloudStatus(s, hint) {
  const el = document.getElementById("cloudStatus");
  if (!el) return;
  el.dataset.state = s;
  const map = {
    off:      { text: "☁ Local only", title: "Click Cloud to set up GitHub sync" },
    pending:  { text: "☁ Pending…",   title: "Will commit to GitHub shortly" },
    syncing:  { text: "☁ Syncing…",   title: "Pushing to GitHub" },
    synced:   { text: "☁ Synced",     title: "All changes saved to GitHub" },
    pulling:  { text: "☁ Pulling…",   title: "Fetching latest from GitHub" },
    conflict: { text: "☁ Conflict",   title: "Someone else updated — pull latest" },
    error:    { text: "☁ Error",      title: hint || "Cloud sync failed" }
  };
  const cfg = map[s] || map.off;
  el.textContent = cfg.text;
  el.title = cfg.title;
}

function b64encodeUtf8(str) {
  // UTF-8 safe base64 encode for the GitHub API
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decodeUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
}

async function ghPull() {
  const token = getGhToken();
  if (!token) throw new Error("NO_TOKEN");
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store"
  });
  if (res.status === 404) return { state: null, sha: null }; // file not yet created
  if (res.status === 401 || res.status === 403) throw new Error("AUTH");
  if (!res.ok) throw new Error(`PULL_${res.status}`);
  const data = await res.json();
  const decoded = b64decodeUtf8(data.content);
  return { state: JSON.parse(decoded), sha: data.sha };
}

async function ghPush(payload) {
  const token = getGhToken();
  if (!token) throw new Error("NO_TOKEN");
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`;
  const body = {
    message: "Update garage layout",
    content: b64encodeUtf8(JSON.stringify(payload, null, 2))
  };
  if (ghSha) body.sha = ghSha;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 409 || res.status === 422) throw new Error("CONFLICT");
  if (res.status === 401 || res.status === 403) throw new Error("AUTH");
  if (!res.ok) throw new Error(`PUSH_${res.status}`);
  const data = await res.json();
  return data.content.sha;
}

function scheduleCloudSave() {
  if (!getGhToken()) { setCloudStatus("off"); return; }
  setCloudStatus("pending");
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(cloudSaveNow, 3500);
}

async function cloudSaveNow() {
  if (!getGhToken()) { setCloudStatus("off"); return; }
  setCloudStatus("syncing");
  try {
    const newSha = await ghPush(state);
    ghSha = newSha;
    localStorage.setItem(GH_SHA_KEY, ghSha);
    setCloudStatus("synced");
  } catch (e) {
    if (e.message === "CONFLICT") {
      setCloudStatus("conflict");
      toast("Cloud conflict: someone else edited. Click Cloud → Pull latest.", "error");
    } else if (e.message === "AUTH") {
      setCloudStatus("error", "Bad token — open Cloud to fix");
      toast("GitHub token rejected. Open Cloud to update it.", "error");
    } else {
      setCloudStatus("error", e.message);
      console.error("Cloud save failed:", e);
    }
  }
}

async function cloudPull(opts = {}) {
  if (!getGhToken()) return false;
  if (cloudPullInFlight) return false;
  cloudPullInFlight = true;
  setCloudStatus("pulling");
  try {
    const { state: remote, sha } = await ghPull();
    if (!remote) {
      // No remote file yet — keep local
      setCloudStatus("synced");
      return false;
    }
    if (sha === ghSha && !opts.force) {
      // Remote unchanged since our last sync — preserve any local-only edits.
      setCloudStatus("synced");
      return false;
    }
    state = remote;
    ensureStateShape();
    ghSha = sha;
    localStorage.setItem(GH_SHA_KEY, ghSha);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setCloudStatus("synced");
    if (opts.silent !== true) toast("Synced from GitHub", "success");
    return true;
  } catch (e) {
    if (e.message === "AUTH") {
      setCloudStatus("error", "Bad token");
      if (!opts.silent) toast("GitHub token rejected. Open Cloud to update it.", "error");
    } else {
      setCloudStatus("error", e.message);
      if (!opts.silent) toast("Pull failed: " + e.message, "error");
    }
    return false;
  } finally {
    cloudPullInFlight = false;
  }
}

async function loadInitial() {
  // 1) Try GitHub API if a token is set (authoritative source).
  if (getGhToken()) {
    const pulled = await cloudPull({ silent: true });
    if (pulled || state.containers?.length > 0 || state.zones?.length > 0) return;
  }
  // 2) Fall back to localStorage.
  const local = localStorage.getItem(STORAGE_KEY);
  if (local) {
    try {
      const parsed = JSON.parse(local);
      if (parsed && parsed.containers) {
        state = parsed;
        ensureStateShape();
        return;
      }
    } catch (e) { console.warn("Local data corrupted, falling back."); }
  }
  // 3) Fall back to anonymous static fetch.
  await tryFetchRemote(false);
}

async function tryFetchRemote(showToastOnSuccess) {
  try {
    const res = await fetch(REMOTE_FILE, { cache: "no-store" });
    if (!res.ok) throw new Error("not found");
    const data = await res.json();
    if (data && data.containers) {
      state = data;
      ensureStateShape();
      saveNow();
      if (showToastOnSuccess) toast("Loaded garage.json from repo", "success");
      return true;
    }
  } catch (e) {
    if (showToastOnSuccess) toast("No garage.json found on this site", "error");
  }
  return false;
}

function itemOpacity(c) {
  if (!categoryFilter) return 1;
  return c.category === categoryFilter ? 1 : 0.6;
}
function zoneOpacity() {
  return categoryFilter ? 0.6 : 1;
}
function isHighlighted(c) {
  return !!categoryFilter && c.category === categoryFilter;
}
const HIGHLIGHT_STROKE = "#ffd700"; // yellow border for the filtered category

function ensureStateShape() {
  if (!state.garage) state.garage = clone(DEFAULT_STATE.garage);
  if (typeof state.garage.gridSize !== "number") state.garage.gridSize = 28;
  if (!state.garage.frontWall) state.garage.frontWall = "left";
  if (!Array.isArray(state.containers)) state.containers = [];
  if (!Array.isArray(state.zones)) state.zones = [];
  for (const c of state.containers) {
    if (!c.id) c.id = uid();
    if (!c.contents) c.contents = [];
    if (typeof c.height3d !== "number") c.height3d = 1;
    if (!c.notes) c.notes = "";
  }
  for (const z of state.zones) {
    if (!z.id) z.id = uid();
    if (!z.notes) z.notes = "";
    if (!z.color) z.color = ZONE_COLORS[0];
  }
}

// ============================================================
// Rotation helpers (for iso view)
// ============================================================

// Rotate a grid point by k * 90° CW around the garage center.
// Resulting frame has dimensions (gw, gh) for k=0,2 and (gh, gw) for k=1,3.
function rotPoint(x, y, k, gw, gh) {
  switch (((k % 4) + 4) % 4) {
    case 0: return [x, y];
    case 1: return [gh - y, x];
    case 2: return [gw - x, gh - y];
    case 3: return [y, gw - x];
  }
}

// Rotate an axis-aligned box. Returns new {x, y, w, h} in the rotated frame.
function rotBox(b, k, gw, gh) {
  switch (((k % 4) + 4) % 4) {
    case 0: return { x: b.x, y: b.y, w: b.w, h: b.h };
    case 1: return { x: gh - b.y - b.h, y: b.x, w: b.h, h: b.w };
    case 2: return { x: gw - b.x - b.w, y: gh - b.y - b.h, w: b.w, h: b.h };
    case 3: return { x: b.y, y: gw - b.x - b.w, w: b.h, h: b.w };
  }
}

function rotatedGarageDims(k) {
  const { width: gw, height: gh } = state.garage;
  return ((k % 2) === 0) ? { gw, gh } : { gw: gh, gh: gw };
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "garage.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Exported garage.json — commit it to your GitHub repo to sync", "success");
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || !data.containers) throw new Error("invalid file");
      state = data;
      ensureStateShape();
      selectedId = null;
      selectedZoneId = null;
      saveNow();
      render();
      toast("Imported successfully", "success");
    } catch (err) {
      toast("Invalid garage.json file", "error");
    }
  };
  reader.readAsText(file);
}

// ============================================================
// Rendering — Top-level dispatcher
// ============================================================

function render() {
  if (view === "2d") render2D();
  else renderIso();
  renderSidebar();
  renderLegend();
}

function renderLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  for (const cat of CATEGORIES) {
    const d = document.createElement("div");
    d.className = "legend-item";
    d.innerHTML = `<span class="legend-swatch" style="background:${cat.color}"></span>${cat.label}`;
    el.appendChild(d);
  }
}

// ============================================================
// 2D Top-Down View
// ============================================================

function drawWallLabel2D(svg, wallId, x, y, anchor, rotateDeg, isFront) {
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", x);
  t.setAttribute("y", y);
  t.setAttribute("text-anchor", anchor);
  t.setAttribute("dominant-baseline", "middle");
  t.setAttribute("transform", rotateDeg ? `rotate(${rotateDeg} ${x} ${y})` : "");
  t.setAttribute("class", "wall-label" + (isFront ? " front" : ""));
  t.textContent = isFront ? "🚪  Garage Door / Front" : wallId.toUpperCase();
  svg.appendChild(t);
}

function drawDoorTick2D(svg, M, gw, gh, cell, frontWall) {
  // Draw a thicker accent line on the chosen front wall, plus 2 short tick marks marking the door.
  const accent = "#5cb85c";
  let x1, y1, x2, y2;
  switch (frontWall) {
    case "top":    x1 = M;             y1 = M;             x2 = M + gw*cell; y2 = M;             break;
    case "bottom": x1 = M;             y1 = M + gh*cell;   x2 = M + gw*cell; y2 = M + gh*cell;   break;
    case "left":   x1 = M;             y1 = M;             x2 = M;           y2 = M + gh*cell;   break;
    case "right":  x1 = M + gw*cell;   y1 = M;             x2 = M + gw*cell; y2 = M + gh*cell;   break;
  }
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", x1); line.setAttribute("y1", y1);
  line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", accent);
  line.setAttribute("stroke-width", 4);
  line.setAttribute("stroke-linecap", "round");
  svg.appendChild(line);
}

function render2D() {
  const vp = document.getElementById("viewport");
  vp.innerHTML = "";
  const { width: gw, height: gh, gridSize: cell, frontWall } = state.garage;
  const M = 36; // margin for wall labels
  const W = gw * cell + 2 * M;
  const H = gh * cell + 2 * M;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // Grid background
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", M); bg.setAttribute("y", M);
  bg.setAttribute("width", gw * cell); bg.setAttribute("height", gh * cell);
  bg.setAttribute("fill", "#1f232c");
  svg.appendChild(bg);

  // Grid lines
  for (let x = 0; x <= gw; x++) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", M + x * cell); line.setAttribute("y1", M);
    line.setAttribute("x2", M + x * cell); line.setAttribute("y2", M + gh * cell);
    line.setAttribute("stroke", x % 5 === 0 ? "#404a60" : "#2f3645");
    line.setAttribute("stroke-width", x % 5 === 0 ? 1 : 0.5);
    svg.appendChild(line);
  }
  for (let y = 0; y <= gh; y++) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", M); line.setAttribute("y1", M + y * cell);
    line.setAttribute("x2", M + gw * cell); line.setAttribute("y2", M + y * cell);
    line.setAttribute("stroke", y % 5 === 0 ? "#404a60" : "#2f3645");
    line.setAttribute("stroke-width", y % 5 === 0 ? 1 : 0.5);
    svg.appendChild(line);
  }

  // Wall labels (front wall highlighted)
  drawWallLabel2D(svg, "top",    M + (gw * cell) / 2, M - 12,             "middle", 0,   frontWall === "top");
  drawWallLabel2D(svg, "bottom", M + (gw * cell) / 2, M + gh * cell + 22, "middle", 0,   frontWall === "bottom");
  drawWallLabel2D(svg, "left",   M - 14,              M + (gh * cell) / 2, "middle", -90, frontWall === "left");
  drawWallLabel2D(svg, "right",  M + gw * cell + 14,  M + (gh * cell) / 2, "middle", 90,  frontWall === "right");

  // Door tick on front wall
  drawDoorTick2D(svg, M, gw, gh, cell, frontWall);

  // Zone backgrounds (drawn first, behind containers)
  for (const z of state.zones) drawZone2DBg(svg, z, M, cell);

  // Containers
  const sortedIds = state.containers.map(c => c.id);
  for (const c of state.containers) {
    const cat = getCategory(c.category);
    const color = c.color || cat.color;
    const x = M + c.x * cell;
    const y = M + c.y * cell;
    const w = c.w * cell;
    const h = c.h * cell;

    const g = document.createElementNS(SVG_NS, "g");
    g.dataset.id = c.id;
    g.setAttribute("opacity", itemOpacity(c));

    const isSel = c.id === selectedId;
    const hl = isHighlighted(c);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("fill", color);
    rect.setAttribute("stroke", isSel ? "#fff" : hl ? HIGHLIGHT_STROKE : "rgba(0,0,0,0.4)");
    rect.setAttribute("stroke-width", isSel ? 2 : hl ? 2.5 : 1);
    rect.setAttribute("rx", 3);
    rect.classList.add("container-rect");
    g.appendChild(rect);

    // Stack pattern overlay
    if (c.stack) {
      for (let i = 1; i < c.stack.length; i++) {
        const line = document.createElementNS(SVG_NS, "line");
        const offset = (i / c.stack.length) * Math.min(w, h) * 0.35;
        line.setAttribute("x1", x + offset);
        line.setAttribute("y1", y + offset);
        line.setAttribute("x2", x + w - offset);
        line.setAttribute("y2", y + offset);
        line.setAttribute("stroke", "rgba(255,255,255,0.35)");
        line.setAttribute("stroke-width", 1);
        line.setAttribute("pointer-events", "none");
        g.appendChild(line);
      }
      const badge = document.createElementNS(SVG_NS, "text");
      badge.setAttribute("x", x + w - 4);
      badge.setAttribute("y", y + 11);
      badge.setAttribute("text-anchor", "end");
      badge.setAttribute("class", "stack-indicator");
      badge.textContent = `⌷×${c.stack.length}`;
      g.appendChild(badge);
    }

    // Label
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", x + w / 2);
    label.setAttribute("y", y + h / 2 + 4);
    label.setAttribute("class", "container-label");
    label.textContent = c.name || "Untitled";
    g.appendChild(label);

    // Resize handle (bottom right) when selected
    if (c.id === selectedId) {
      const handle = document.createElementNS(SVG_NS, "rect");
      const hs = 10;
      handle.setAttribute("x", x + w - hs);
      handle.setAttribute("y", y + h - hs);
      handle.setAttribute("width", hs);
      handle.setAttribute("height", hs);
      handle.setAttribute("class", "resize-handle");
      handle.dataset.role = "resize";
      handle.dataset.id = c.id;
      g.appendChild(handle);
    }

    // Mouse handlers
    g.addEventListener("mousedown", (e) => onContainerMouseDown(e, c));
    g.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e, c); });

    svg.appendChild(g);
  }

  // Zone labels + resize handles drawn AFTER containers so they stay visible
  for (const z of state.zones) drawZone2DLabel(svg, z, M, cell);

  vp.appendChild(svg);
}

function drawZone2DBg(svg, z, M, cell) {
  const x = M + z.x * cell, y = M + z.y * cell;
  const w = z.w * cell, h = z.h * cell;
  const isSel = z.id === selectedZoneId;
  const op = zoneOpacity();

  const r = document.createElementNS(SVG_NS, "rect");
  if (op !== 1) r.setAttribute("opacity", op);
  r.setAttribute("x", x); r.setAttribute("y", y);
  r.setAttribute("width", w); r.setAttribute("height", h);
  r.setAttribute("fill", z.color);
  r.setAttribute("fill-opacity", "0.08");
  r.setAttribute("stroke", z.color);
  r.setAttribute("stroke-width", isSel ? 3 : 1.8);
  r.setAttribute("stroke-dasharray", "8,5");
  r.setAttribute("rx", 6);
  r.classList.add("zone-rect");
  r.dataset.zoneId = z.id;
  r.addEventListener("mousedown", (e) => onZoneMouseDown(e, z));
  r.addEventListener("contextmenu", (e) => { e.preventDefault(); showZoneContextMenu(e, z); });
  svg.appendChild(r);
}

function drawZone2DLabel(svg, z, M, cell) {
  const x = M + z.x * cell, y = M + z.y * cell;
  const w = z.w * cell, h = z.h * cell;
  const isSel = z.id === selectedZoneId;

  const labelText = z.name || "Zone";
  const fontSize = 12;
  const padX = 8, padY = 4;
  const approxTextW = labelText.length * (fontSize * 0.58) + padX * 2;
  const labelW = Math.min(approxTextW, w - 8);
  const labelH = fontSize + padY * 2;

  const g = document.createElementNS(SVG_NS, "g");
  g.style.cursor = "move";
  g.dataset.zoneId = z.id;
  const opG = zoneOpacity();
  if (opG !== 1) g.setAttribute("opacity", opG);

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", x + 4);
  bg.setAttribute("y", y + 4);
  bg.setAttribute("width", labelW);
  bg.setAttribute("height", labelH);
  bg.setAttribute("rx", 3);
  bg.setAttribute("fill", z.color);
  bg.setAttribute("fill-opacity", "0.92");
  g.appendChild(bg);

  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", x + 4 + padX);
  t.setAttribute("y", y + 4 + labelH - padY - 1);
  t.setAttribute("class", "zone-label");
  t.textContent = labelText;
  g.appendChild(t);

  if (isSel) {
    const handle = document.createElementNS(SVG_NS, "rect");
    const hs = 10;
    handle.setAttribute("x", x + w - hs);
    handle.setAttribute("y", y + h - hs);
    handle.setAttribute("width", hs);
    handle.setAttribute("height", hs);
    handle.setAttribute("class", "resize-handle");
    handle.dataset.role = "resize-zone";
    handle.dataset.id = z.id;
    g.appendChild(handle);
  }

  g.addEventListener("mousedown", (e) => onZoneMouseDown(e, z));
  g.addEventListener("contextmenu", (e) => { e.preventDefault(); showZoneContextMenu(e, z); });
  svg.appendChild(g);
}

// 2D drag & resize
let dragState = null;

function onContainerMouseDown(e, c) {
  e.stopPropagation();
  selectedId = c.id;
  selectedZoneId = null;
  const role = e.target.dataset?.role;
  const cell = state.garage.gridSize;
  const svg = e.currentTarget.ownerSVGElement;
  const pt = svgPoint(svg, e);

  const M = 36;
  if (role === "resize") {
    dragState = {
      kind: "container",
      mode: "resize",
      id: c.id
    };
  } else {
    dragState = {
      kind: "container",
      mode: "move",
      id: c.id,
      offsetX: pt.x - (M + c.x * cell),
      offsetY: pt.y - (M + c.y * cell)
    };
  }
  render();
  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseup", onDocMouseUp);
}

function onZoneMouseDown(e, z) {
  e.stopPropagation();
  selectedZoneId = z.id;
  selectedId = null;
  const role = e.target.dataset?.role;
  const cell = state.garage.gridSize;
  const svg = e.currentTarget.ownerSVGElement || document.querySelector("#viewport svg");
  const pt = svgPoint(svg, e);
  const M = 36;
  if (role === "resize-zone") {
    dragState = { kind: "zone", mode: "resize", id: z.id };
  } else {
    dragState = {
      kind: "zone",
      mode: "move",
      id: z.id,
      offsetX: pt.x - (M + z.x * cell),
      offsetY: pt.y - (M + z.y * cell)
    };
  }
  render();
  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseup", onDocMouseUp);
}

function onDocMouseMove(e) {
  if (!dragState) return;
  const item = dragState.kind === "zone" ? findZone(dragState.id) : findContainer(dragState.id);
  if (!item) return;
  const cell = state.garage.gridSize;
  const M = 36;
  const svg = document.querySelector("#viewport svg");
  if (!svg) return;
  const pt = svgPoint(svg, e);

  if (dragState.mode === "move") {
    let nx = Math.round((pt.x - dragState.offsetX - M) / cell);
    let ny = Math.round((pt.y - dragState.offsetY - M) / cell);
    nx = clamp(nx, 0, state.garage.width - item.w);
    ny = clamp(ny, 0, state.garage.height - item.h);
    if (nx !== item.x || ny !== item.y) {
      item.x = nx; item.y = ny;
      render2D();
      renderSidebar();
    }
  } else if (dragState.mode === "resize") {
    let nw = Math.max(1, Math.round((pt.x - M - item.x * cell) / cell));
    let nh = Math.max(1, Math.round((pt.y - M - item.y * cell) / cell));
    nw = Math.min(nw, state.garage.width - item.x);
    nh = Math.min(nh, state.garage.height - item.y);
    if (nw !== item.w || nh !== item.h) {
      item.w = nw; item.h = nh;
      render2D();
      renderSidebar();
    }
  }
}

function onDocMouseUp() {
  if (dragState) {
    dragState = null;
    scheduleSave();
  }
  document.removeEventListener("mousemove", onDocMouseMove);
  document.removeEventListener("mouseup", onDocMouseUp);
}

function svgPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const inv = ctm.inverse();
  const t = pt.matrixTransform(inv);
  return { x: t.x, y: t.y };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ============================================================
// 2.5D Isometric View
// ============================================================

function renderIso() {
  const vp = document.getElementById("viewport");
  vp.innerHTML = "";
  const { gridSize, frontWall } = state.garage;
  const k = isoRotation;
  const { gw, gh } = rotatedGarageDims(k);
  const cell = Math.max(20, gridSize); // iso looks better with bigger cells
  const COS30 = Math.cos(Math.PI / 6); // 0.866
  const SIN30 = Math.sin(Math.PI / 6); // 0.5
  const HEIGHT_PX = cell * 0.8; // visual height of one "story"

  const isoX = (x, y) => (x - y) * cell * COS30;
  const isoY = (x, y, z = 0) => (x + y) * cell * SIN30 - z * HEIGHT_PX;

  // Compute bounds
  const corners = [[0,0],[gw,0],[0,gh],[gw,gh]];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, isoX(x, y));
    maxX = Math.max(maxX, isoX(x, y));
    minY = Math.min(minY, isoY(x, y));
    maxY = Math.max(maxY, isoY(x, y));
  }
  // Account for tallest container
  const maxStoreys = state.containers.reduce((m, c) => Math.max(m, (c.height3d || 1) + (c.stack ? c.stack.length : 0)), 1);
  minY -= maxStoreys * HEIGHT_PX;
  // Reserve room above for wall label
  minY -= 28;

  const padding = 40;
  const W = (maxX - minX) + padding * 2;
  const H = (maxY - minY) + padding * 2;
  const ox = -minX + padding;
  const oy = -minY + padding;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // Floor
  const floorPts = [
    [isoX(0,0)+ox, isoY(0,0)+oy],
    [isoX(gw,0)+ox, isoY(gw,0)+oy],
    [isoX(gw,gh)+ox, isoY(gw,gh)+oy],
    [isoX(0,gh)+ox, isoY(0,gh)+oy]
  ];
  const floor = document.createElementNS(SVG_NS, "polygon");
  floor.setAttribute("points", floorPts.map(p => p.join(",")).join(" "));
  floor.setAttribute("fill", "#1f232c");
  floor.setAttribute("stroke", "#404a60");
  svg.appendChild(floor);

  // Floor grid lines
  for (let x = 0; x <= gw; x++) {
    const a = [isoX(x,0)+ox, isoY(x,0)+oy];
    const b = [isoX(x,gh)+ox, isoY(x,gh)+oy];
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", a[0]); line.setAttribute("y1", a[1]);
    line.setAttribute("x2", b[0]); line.setAttribute("y2", b[1]);
    line.setAttribute("stroke", x % 5 === 0 ? "#404a60" : "#2a303d");
    line.setAttribute("stroke-width", x % 5 === 0 ? 1 : 0.5);
    svg.appendChild(line);
  }
  for (let y = 0; y <= gh; y++) {
    const a = [isoX(0,y)+ox, isoY(0,y)+oy];
    const b = [isoX(gw,y)+ox, isoY(gw,y)+oy];
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", a[0]); line.setAttribute("y1", a[1]);
    line.setAttribute("x2", b[0]); line.setAttribute("y2", b[1]);
    line.setAttribute("stroke", y % 5 === 0 ? "#404a60" : "#2a303d");
    line.setAttribute("stroke-width", y % 5 === 0 ? 1 : 0.5);
    svg.appendChild(line);
  }

  // Front wall in rotated frame
  const rotatedFrontWall = rotateWallId(frontWall, k);
  drawWallAccentIso(svg, rotatedFrontWall, gw, gh, ox, oy, isoX, isoY);

  // Zone floor outlines (drawn before containers, but after floor)
  for (const z of state.zones) {
    const rb = rotBox({ x: z.x, y: z.y, w: z.w, h: z.h }, k, state.garage.width, state.garage.height);
    drawZoneIso(svg, z, rb, ox, oy, isoX, isoY);
  }

  // Compute rotated containers (each gets a {rb, c} pair where rb is rotated box)
  const rotated = state.containers.map(c => ({ c, rb: rotBox({ x: c.x, y: c.y, w: c.w, h: c.h }, k, state.garage.width, state.garage.height) }));

  // Sort back-to-front for proper occlusion (using rotated coords)
  rotated.sort((a, b) => {
    const sa = (a.rb.x + a.rb.w/2) + (a.rb.y + a.rb.h/2);
    const sb = (b.rb.x + b.rb.w/2) + (b.rb.y + b.rb.h/2);
    return sa - sb;
  });

  for (const { c, rb } of rotated) {
    const cat = getCategory(c.category);
    const color = c.color || cat.color;
    drawIsoBox(svg, c, rb, color, ox, oy, isoX, isoY, HEIGHT_PX, cell);
  }

  // Zone labels rendered AFTER containers so they stay visible
  for (const z of state.zones) {
    const rb = rotBox({ x: z.x, y: z.y, w: z.w, h: z.h }, k, state.garage.width, state.garage.height);
    drawZoneIsoLabel(svg, z, rb, ox, oy, isoX, isoY);
  }

  // Front-wall label rendered LAST so it sits on top
  drawWallLabelIso(svg, rotatedFrontWall, gw, gh, ox, oy, isoX, isoY);

  vp.appendChild(svg);
}

function drawZoneIso(svg, z, rb, ox, oy, isoX, isoY) {
  const corners = [
    [rb.x, rb.y],
    [rb.x + rb.w, rb.y],
    [rb.x + rb.w, rb.y + rb.h],
    [rb.x, rb.y + rb.h]
  ];
  const points = corners.map(([gx, gy]) => `${isoX(gx, gy) + ox},${isoY(gx, gy) + oy}`).join(" ");
  const poly = document.createElementNS(SVG_NS, "polygon");
  poly.setAttribute("points", points);
  poly.setAttribute("fill", z.color);
  poly.setAttribute("fill-opacity", z.id === selectedZoneId ? "0.18" : "0.10");
  poly.setAttribute("stroke", z.color);
  poly.setAttribute("stroke-width", z.id === selectedZoneId ? 2.5 : 1.8);
  poly.setAttribute("stroke-dasharray", "8,5");
  const opP = zoneOpacity();
  if (opP !== 1) poly.setAttribute("opacity", opP);
  poly.style.cursor = "pointer";
  poly.addEventListener("click", (e) => { e.stopPropagation(); selectedZoneId = z.id; selectedId = null; render(); });
  poly.addEventListener("contextmenu", (e) => { e.preventDefault(); showZoneContextMenu(e, z); });
  svg.appendChild(poly);
}

function drawZoneIsoLabel(svg, z, rb, ox, oy, isoX, isoY) {
  const cx = rb.x + rb.w / 2;
  const cy = rb.y + rb.h / 2;
  const px = isoX(cx, cy) + ox;
  const py = isoY(cx, cy) + oy;
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", px);
  t.setAttribute("y", py);
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("class", "zone-label-iso");
  t.setAttribute("fill", z.color);
  const opL = zoneOpacity();
  if (opL !== 1) t.setAttribute("opacity", opL);
  t.style.cursor = "pointer";
  t.textContent = z.name || "Zone";
  t.addEventListener("click", (e) => { e.stopPropagation(); selectedZoneId = z.id; selectedId = null; render(); });
  svg.appendChild(t);
}

// Rotate a wall id by k 90° CW steps. The wall stays attached to the same physical part
// of the garage; this just figures out where it is in the rotated frame.
function rotateWallId(wallId, k) {
  const order = ["top", "right", "bottom", "left"]; // CW order
  const i = order.indexOf(wallId);
  if (i < 0) return wallId;
  return order[(i + k) % 4];
}

function drawWallAccentIso(svg, wallId, gw, gh, ox, oy, isoX, isoY) {
  // 4 floor corners in rotated frame
  const a = wallEndpoints(wallId, gw, gh);
  const p1 = [isoX(a[0][0], a[0][1]) + ox, isoY(a[0][0], a[0][1]) + oy];
  const p2 = [isoX(a[1][0], a[1][1]) + ox, isoY(a[1][0], a[1][1]) + oy];
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", p1[0]); line.setAttribute("y1", p1[1]);
  line.setAttribute("x2", p2[0]); line.setAttribute("y2", p2[1]);
  line.setAttribute("stroke", "#5cb85c");
  line.setAttribute("stroke-width", 4);
  line.setAttribute("stroke-linecap", "round");
  svg.appendChild(line);
}

function drawWallLabelIso(svg, wallId, gw, gh, ox, oy, isoX, isoY) {
  const a = wallEndpoints(wallId, gw, gh);
  const mx = (a[0][0] + a[1][0]) / 2;
  const my = (a[0][1] + a[1][1]) / 2;
  // Push the label outward from the floor center
  const cx = gw / 2, cy = gh / 2;
  const dx = mx - cx, dy = my - cy;
  const len = Math.hypot(dx, dy) || 1;
  const offset = 1.0; // grid units
  const lx = mx + (dx / len) * offset;
  const ly = my + (dy / len) * offset;
  const px = isoX(lx, ly) + ox;
  const py = isoY(lx, ly) + oy;
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("x", px);
  t.setAttribute("y", py);
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("class", "wall-label front iso");
  t.textContent = "🚪  Garage Door / Front";
  svg.appendChild(t);
}

function wallEndpoints(wallId, gw, gh) {
  switch (wallId) {
    case "top":    return [[0, 0],   [gw, 0]];
    case "bottom": return [[0, gh],  [gw, gh]];
    case "left":   return [[0, 0],   [0, gh]];
    case "right":  return [[gw, 0],  [gw, gh]];
  }
  return [[0, 0], [0, 0]];
}

function drawIsoBox(svg, c, rb, color, ox, oy, isoX, isoY, HEIGHT_PX, cell) {
  const g = document.createElementNS(SVG_NS, "g");
  g.dataset.id = c.id;
  g.style.cursor = "pointer";
  g.setAttribute("opacity", itemOpacity(c));

  const x1 = rb.x, y1 = rb.y, x2 = rb.x + rb.w, y2 = rb.y + rb.h;
  const isStack = !!c.stack;

  // Build each storey from bottom up
  const drawStorey = (zBottom, zTop, storeyColor, storeyLabel) => {
    // Bottom corners
    const blf = [isoX(x1, y2) + ox, isoY(x1, y2, zBottom) + oy]; // bottom-left-front
    const brf = [isoX(x2, y2) + ox, isoY(x2, y2, zBottom) + oy]; // bottom-right-front
    const brb = [isoX(x2, y1) + ox, isoY(x2, y1, zBottom) + oy]; // bottom-right-back
    const blb = [isoX(x1, y1) + ox, isoY(x1, y1, zBottom) + oy]; // bottom-left-back

    const tlf = [isoX(x1, y2) + ox, isoY(x1, y2, zTop) + oy];
    const trf = [isoX(x2, y2) + ox, isoY(x2, y2, zTop) + oy];
    const trb = [isoX(x2, y1) + ox, isoY(x2, y1, zTop) + oy];
    const tlb = [isoX(x1, y1) + ox, isoY(x1, y1, zTop) + oy];

    const dark = shade(storeyColor, -0.25);
    const mid = shade(storeyColor, -0.12);

    // Front face (y=y2, facing viewer) — medium shade
    const front = document.createElementNS(SVG_NS, "polygon");
    front.setAttribute("points", `${blf[0]},${blf[1]} ${brf[0]},${brf[1]} ${trf[0]},${trf[1]} ${tlf[0]},${tlf[1]}`);
    front.setAttribute("fill", mid);
    front.setAttribute("stroke", "rgba(0,0,0,0.5)");
    front.setAttribute("stroke-width", 0.5);
    g.appendChild(front);

    // Right face (x=x2) — darker
    const right = document.createElementNS(SVG_NS, "polygon");
    right.setAttribute("points", `${brf[0]},${brf[1]} ${brb[0]},${brb[1]} ${trb[0]},${trb[1]} ${trf[0]},${trf[1]}`);
    right.setAttribute("fill", dark);
    right.setAttribute("stroke", "rgba(0,0,0,0.5)");
    right.setAttribute("stroke-width", 0.5);
    g.appendChild(right);

    // Top face
    const isSel = c.id === selectedId;
    const hl = isHighlighted(c);
    const top = document.createElementNS(SVG_NS, "polygon");
    top.setAttribute("points", `${tlf[0]},${tlf[1]} ${trf[0]},${trf[1]} ${trb[0]},${trb[1]} ${tlb[0]},${tlb[1]}`);
    top.setAttribute("fill", storeyColor);
    top.setAttribute("stroke", isSel ? "#fff" : hl ? HIGHLIGHT_STROKE : "rgba(0,0,0,0.5)");
    top.setAttribute("stroke-width", isSel ? 2 : hl ? 2.5 : 0.7);
    g.appendChild(top);

    if (storeyLabel) {
      const cx = (tlf[0] + trb[0]) / 2;
      const cy = (tlf[1] + trb[1]) / 2 + 3;
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", cx); t.setAttribute("y", cy);
      t.setAttribute("class", "container-label");
      t.textContent = storeyLabel;
      g.appendChild(t);
    }
  };

  if (isStack) {
    // Each bin = 1 storey, drawn bottom up. Stack array order: index 0 = top bin.
    // So bottom bin = stack[stack.length - 1]
    for (let i = c.stack.length - 1; i >= 0; i--) {
      const zBottom = (c.stack.length - 1 - i);
      const zTop = zBottom + 1;
      const tint = i === 0 ? color : shade(color, -0.05 * (c.stack.length - 1 - i));
      drawStorey(zBottom, zTop, tint, i === 0 ? c.name : null);
    }
    // Bin count badge — placed at top
    // (label on top storey already shows name)
  } else {
    drawStorey(0, c.height3d || 1, color, c.name);
  }

  g.addEventListener("click", () => { selectedId = c.id; render(); });
  g.addEventListener("contextmenu", (e) => { e.preventDefault(); showContextMenu(e, c); });
  svg.appendChild(g);
}

function shade(hex, pct) {
  // pct: -1 to 1 (-1 = black, 1 = white)
  const c = hex.replace("#", "");
  let r = parseInt(c.substr(0, 2), 16);
  let gn = parseInt(c.substr(2, 2), 16);
  let b = parseInt(c.substr(4, 2), 16);
  if (pct < 0) {
    r = Math.round(r * (1 + pct));
    gn = Math.round(gn * (1 + pct));
    b = Math.round(b * (1 + pct));
  } else {
    r = Math.round(r + (255 - r) * pct);
    gn = Math.round(gn + (255 - gn) * pct);
    b = Math.round(b + (255 - b) * pct);
  }
  return `#${[r, gn, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

// ============================================================
// Sidebar
// ============================================================

function renderSidebar() {
  const sb = document.getElementById("sidebar");
  if (selectedZoneId) {
    const z = findZone(selectedZoneId);
    if (!z) { selectedZoneId = null; renderSidebar(); return; }
    renderZoneSidebar(sb, z);
    return;
  }
  if (!selectedId) {
    sb.innerHTML = `
      <div class="sidebar-empty">
        <h3>Click a container or zone</h3>
        <p>Select a container or zone to view or edit it.</p>
        <p class="hint">Drag to move, drag corner to resize. Right-click for quick actions.</p>
      </div>`;
    return;
  }
  const c = findContainer(selectedId);
  if (!c) { selectedId = null; renderSidebar(); return; }
  const cat = getCategory(c.category);

  sb.innerHTML = `
    <div class="detail-header">
      <input type="color" class="detail-color" value="${c.color || cat.color}" id="detailColor" />
      <input type="text" class="detail-name" value="${escapeHtml(c.name)}" id="detailName" />
    </div>

    <div class="row">
      <div class="field">
        <label>Category</label>
        <select id="detailCategory">${CATEGORIES.map(k => `<option value="${k.id}" ${k.id === c.category ? "selected" : ""}>${k.label}</option>`).join("")}</select>
      </div>
    </div>

    <div class="row">
      <div class="field"><label>X</label><input type="number" id="detailX" value="${c.x}" min="0" max="${state.garage.width - c.w}" /></div>
      <div class="field"><label>Y</label><input type="number" id="detailY" value="${c.y}" min="0" max="${state.garage.height - c.h}" /></div>
    </div>
    <div class="row">
      <div class="field"><label>Width</label><input type="number" id="detailW" value="${c.w}" min="1" max="40" /></div>
      <div class="field"><label>Depth</label><input type="number" id="detailH" value="${c.h}" min="1" max="40" /></div>
      <div class="field"><label>Tall (2.5D)</label><input type="number" id="detailH3" value="${c.height3d || 1}" min="1" max="10" ${c.stack ? "disabled" : ""} /></div>
    </div>

    <div class="field">
      <label>Notes</label>
      <textarea id="detailNotes" placeholder="Anything special about this container…">${escapeHtml(c.notes || "")}</textarea>
    </div>

    <div class="section">
      ${c.stack ? renderStackUI(c) : renderContentsUI(c)}
    </div>

    <div class="section">
      ${c.stack ? `<button id="convertToSingle">Convert to single (merge bins)</button>` : `<button id="convertToStack">Convert to stack of bins</button>`}
    </div>

    <div class="danger-zone">
      <button class="danger" id="deleteContainer">Delete container</button>
    </div>
  `;

  bindSidebarEvents(c);
}

function renderContentsUI(c) {
  const items = (c.contents || []).map((item, i) => `
    <li>
      <input type="text" data-index="${i}" class="content-input" value="${escapeHtml(item)}" />
      <button class="remove-btn" data-action="remove-item" data-index="${i}" title="Remove">×</button>
    </li>`).join("");
  return `
    <div class="section-header">
      <h4>Contents (${(c.contents || []).length})</h4>
    </div>
    <ul class="contents-list">${items}</ul>
    <div class="add-row">
      <input type="text" id="addItemInput" placeholder="Add an item…" />
      <button id="addItemBtn">Add</button>
    </div>`;
}

function renderStackUI(c) {
  const bins = c.stack.map((bin, i) => {
    const items = (bin.contents || []).map((it, j) => `
      <li>
        <input type="text" data-bin="${i}" data-index="${j}" class="bin-content-input" value="${escapeHtml(it)}" />
        <button class="remove-btn" data-action="remove-bin-item" data-bin="${i}" data-index="${j}" title="Remove">×</button>
      </li>`).join("");
    const positionLabel = i === 0 ? "TOP" : (i === c.stack.length - 1 ? "BOTTOM" : `#${i + 1}`);
    return `
      <li class="stack-bin" data-bin="${i}">
        <div class="stack-bin-header">
          <span class="grip">⋮⋮</span>
          <input type="text" class="bin-name" data-bin="${i}" value="${escapeHtml(bin.name || `Bin ${i + 1}`)}" />
          <span class="pos">${positionLabel}</span>
        </div>
        <ul class="bin-contents contents-list">${items}</ul>
        <div class="add-row">
          <input type="text" class="bin-add-input" data-bin="${i}" placeholder="Add to ${escapeHtml(bin.name || "bin")}…" />
          <button class="bin-add-btn" data-bin="${i}">Add</button>
        </div>
        <div class="bin-actions">
          <button data-action="move-bin-up" data-bin="${i}" ${i === 0 ? "disabled" : ""}>↑ Up</button>
          <button data-action="move-bin-down" data-bin="${i}" ${i === c.stack.length - 1 ? "disabled" : ""}>↓ Down</button>
          <button data-action="remove-bin" data-bin="${i}">Remove bin</button>
        </div>
      </li>`;
  }).join("");
  return `
    <div class="section-header">
      <h4>Stack — ${c.stack.length} bin${c.stack.length === 1 ? "" : "s"} (top → bottom)</h4>
      <button id="addBinBtn">+ Bin</button>
    </div>
    <ul class="stack-list">${bins}</ul>`;
}

function bindSidebarEvents(c) {
  const set = (prop, val) => { c[prop] = val; scheduleSave(); render(); };

  document.getElementById("detailName").addEventListener("input", e => {
    c.name = e.target.value;
    scheduleSave();
    if (view === "2d") render2D(); else renderIso();
  });
  document.getElementById("detailColor").addEventListener("input", e => set("color", e.target.value));
  document.getElementById("detailCategory").addEventListener("change", e => {
    c.category = e.target.value;
    if (!c.color) c.color = getCategory(c.category).color;
    scheduleSave(); render();
  });
  document.getElementById("detailX").addEventListener("change", e => {
    const v = clamp(parseInt(e.target.value) || 0, 0, state.garage.width - c.w);
    set("x", v);
  });
  document.getElementById("detailY").addEventListener("change", e => {
    const v = clamp(parseInt(e.target.value) || 0, 0, state.garage.height - c.h);
    set("y", v);
  });
  document.getElementById("detailW").addEventListener("change", e => {
    const v = clamp(parseInt(e.target.value) || 1, 1, state.garage.width - c.x);
    set("w", v);
  });
  document.getElementById("detailH").addEventListener("change", e => {
    const v = clamp(parseInt(e.target.value) || 1, 1, state.garage.height - c.y);
    set("h", v);
  });
  const h3 = document.getElementById("detailH3");
  if (h3 && !h3.disabled) {
    h3.addEventListener("change", e => set("height3d", clamp(parseInt(e.target.value) || 1, 1, 10)));
  }
  document.getElementById("detailNotes").addEventListener("input", e => {
    c.notes = e.target.value;
    scheduleSave();
  });

  // Contents (non-stack)
  if (!c.stack) {
    document.getElementById("addItemBtn")?.addEventListener("click", () => {
      const inp = document.getElementById("addItemInput");
      const v = inp.value.trim();
      if (!v) return;
      c.contents.push(v);
      scheduleSave(); renderSidebar();
    });
    document.getElementById("addItemInput")?.addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("addItemBtn").click();
    });
    document.querySelectorAll(".content-input").forEach(inp => {
      inp.addEventListener("change", e => {
        const i = parseInt(e.target.dataset.index);
        c.contents[i] = e.target.value;
        scheduleSave();
      });
    });
    document.querySelectorAll('[data-action="remove-item"]').forEach(btn => {
      btn.addEventListener("click", () => {
        c.contents.splice(parseInt(btn.dataset.index), 1);
        scheduleSave(); renderSidebar();
      });
    });
  }

  // Stack
  if (c.stack) {
    document.getElementById("addBinBtn")?.addEventListener("click", () => {
      c.stack.push({ name: `Bin ${c.stack.length + 1}`, contents: [] });
      scheduleSave(); render();
    });
    document.querySelectorAll(".bin-name").forEach(inp => {
      inp.addEventListener("change", e => {
        const i = parseInt(e.target.dataset.bin);
        c.stack[i].name = e.target.value;
        scheduleSave();
      });
    });
    document.querySelectorAll(".bin-content-input").forEach(inp => {
      inp.addEventListener("change", e => {
        const bi = parseInt(e.target.dataset.bin);
        const ii = parseInt(e.target.dataset.index);
        c.stack[bi].contents[ii] = e.target.value;
        scheduleSave();
      });
    });
    document.querySelectorAll(".bin-add-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.bin);
        const inp = document.querySelector(`.bin-add-input[data-bin="${i}"]`);
        const v = inp.value.trim();
        if (!v) return;
        c.stack[i].contents.push(v);
        scheduleSave(); renderSidebar();
      });
    });
    document.querySelectorAll(".bin-add-input").forEach(inp => {
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          const i = parseInt(e.target.dataset.bin);
          document.querySelector(`.bin-add-btn[data-bin="${i}"]`).click();
        }
      });
    });
    document.querySelectorAll('[data-action="remove-bin-item"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const bi = parseInt(btn.dataset.bin);
        const ii = parseInt(btn.dataset.index);
        c.stack[bi].contents.splice(ii, 1);
        scheduleSave(); renderSidebar();
      });
    });
    document.querySelectorAll('[data-action="move-bin-up"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.bin);
        if (i === 0) return;
        [c.stack[i - 1], c.stack[i]] = [c.stack[i], c.stack[i - 1]];
        scheduleSave(); render();
      });
    });
    document.querySelectorAll('[data-action="move-bin-down"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.bin);
        if (i >= c.stack.length - 1) return;
        [c.stack[i], c.stack[i + 1]] = [c.stack[i + 1], c.stack[i]];
        scheduleSave(); render();
      });
    });
    document.querySelectorAll('[data-action="remove-bin"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.bin);
        confirmDialog(`Remove "${c.stack[i].name}"?`, "All items in this bin will be lost.", () => {
          c.stack.splice(i, 1);
          scheduleSave(); render();
        });
      });
    });
  }

  // Convert
  document.getElementById("convertToStack")?.addEventListener("click", () => {
    c.stack = [{ name: "Top bin", contents: c.contents.slice() }];
    c.contents = [];
    scheduleSave(); render();
  });
  document.getElementById("convertToSingle")?.addEventListener("click", () => {
    confirmDialog("Convert to single container?", "All bins will merge into one contents list. The bin names will be lost.", () => {
      c.contents = c.stack.flatMap(b => b.contents);
      c.stack = null;
      scheduleSave(); render();
    });
  });

  document.getElementById("deleteContainer").addEventListener("click", () => {
    confirmDialog(`Delete "${c.name}"?`, "This container and its contents will be removed.", () => {
      state.containers = state.containers.filter(x => x.id !== c.id);
      selectedId = null;
      scheduleSave(); render();
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

// ============================================================
// Zones — sidebar + actions
// ============================================================

function renderZoneSidebar(sb, z) {
  sb.innerHTML = `
    <div class="detail-header">
      <input type="color" class="detail-color" value="${z.color}" id="zoneColor" />
      <input type="text" class="detail-name" value="${escapeHtml(z.name)}" id="zoneName" placeholder="Section name" />
    </div>
    <p class="hint" style="margin-top:0">Zone — a labeled wireframe section (e.g. "Storage", "Tools"). Containers can sit inside zones.</p>

    <div class="row">
      <div class="field"><label>X</label><input type="number" id="zoneX" value="${z.x}" min="0" /></div>
      <div class="field"><label>Y</label><input type="number" id="zoneY" value="${z.y}" min="0" /></div>
    </div>
    <div class="row">
      <div class="field"><label>Width</label><input type="number" id="zoneW" value="${z.w}" min="1" /></div>
      <div class="field"><label>Depth</label><input type="number" id="zoneH" value="${z.h}" min="1" /></div>
    </div>

    <div class="field">
      <label>Notes</label>
      <textarea id="zoneNotes" placeholder="Anything special about this section…">${escapeHtml(z.notes || "")}</textarea>
    </div>

    <div class="danger-zone">
      <button class="danger" id="deleteZone">Delete zone</button>
    </div>
  `;

  document.getElementById("zoneName").addEventListener("input", e => {
    z.name = e.target.value;
    scheduleSave();
    if (view === "2d") render2D(); else renderIso();
  });
  document.getElementById("zoneColor").addEventListener("input", e => {
    z.color = e.target.value;
    scheduleSave();
    render();
  });
  document.getElementById("zoneX").addEventListener("change", e => {
    z.x = clamp(parseInt(e.target.value) || 0, 0, state.garage.width - z.w);
    scheduleSave(); render();
  });
  document.getElementById("zoneY").addEventListener("change", e => {
    z.y = clamp(parseInt(e.target.value) || 0, 0, state.garage.height - z.h);
    scheduleSave(); render();
  });
  document.getElementById("zoneW").addEventListener("change", e => {
    z.w = clamp(parseInt(e.target.value) || 1, 1, state.garage.width - z.x);
    scheduleSave(); render();
  });
  document.getElementById("zoneH").addEventListener("change", e => {
    z.h = clamp(parseInt(e.target.value) || 1, 1, state.garage.height - z.y);
    scheduleSave(); render();
  });
  document.getElementById("zoneNotes").addEventListener("input", e => {
    z.notes = e.target.value;
    scheduleSave();
  });
  document.getElementById("deleteZone").addEventListener("click", () => {
    confirmDialog(`Delete zone "${z.name}"?`, "The zone will be removed (containers inside are not affected).", () => {
      state.zones = state.zones.filter(x => x.id !== z.id);
      selectedZoneId = null;
      scheduleSave(); render();
    });
  });
}

function addZone() {
  const used = new Set(state.zones.map(z => z.color));
  const color = ZONE_COLORS.find(c => !used.has(c)) || ZONE_COLORS[state.zones.length % ZONE_COLORS.length];
  const w = Math.min(8, state.garage.width);
  const h = Math.min(6, state.garage.height);
  const offset = state.zones.length;
  const x = clamp(offset, 0, state.garage.width - w);
  const y = clamp(offset, 0, state.garage.height - h);
  const z = {
    id: uid(),
    name: "New Section",
    color,
    x, y, w, h,
    notes: ""
  };
  state.zones.push(z);
  selectedZoneId = z.id;
  selectedId = null;
  scheduleSave();
  render();
  setTimeout(() => {
    const inp = document.getElementById("zoneName");
    if (inp) { inp.focus(); inp.select(); }
  }, 50);
}

function showZoneContextMenu(e, z) {
  hideContextMenu();
  selectedZoneId = z.id;
  selectedId = null;
  render();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  menu.innerHTML = `
    <button data-act="duplicate-zone">Duplicate zone</button>
    <button data-act="delete-zone" class="danger-item">Delete zone</button>
  `;
  document.body.appendChild(menu);
  ctxMenuEl = menu;
  menu.addEventListener("click", (ev) => {
    const act = ev.target.dataset?.act;
    if (act === "duplicate-zone") {
      const copy = clone(z);
      copy.id = uid();
      copy.name = z.name + " (copy)";
      copy.x = clamp(z.x + 1, 0, state.garage.width - z.w);
      copy.y = clamp(z.y + 1, 0, state.garage.height - z.h);
      state.zones.push(copy);
      selectedZoneId = copy.id;
      scheduleSave(); render();
    } else if (act === "delete-zone") {
      confirmDialog(`Delete zone "${z.name}"?`, "The zone will be removed.", () => {
        state.zones = state.zones.filter(x => x.id !== z.id);
        selectedZoneId = null;
        scheduleSave(); render();
      });
    }
    hideContextMenu();
  });
  setTimeout(() => document.addEventListener("click", hideContextMenu, { once: true }), 0);
}

// ============================================================
// Modals
// ============================================================

function openAddModal() {
  const m = document.getElementById("modalAdd");
  const sel = document.getElementById("addCategory");
  sel.innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  document.getElementById("addName").value = "";
  document.getElementById("addW").value = 2;
  document.getElementById("addH").value = 2;
  document.getElementById("addH3").value = 1;
  document.getElementById("addStack").checked = false;
  m.classList.remove("hidden");
  updateAddFtHints();
  setTimeout(() => document.getElementById("addName").focus(), 50);
}

function updateAddFtHints() {
  const w = parseFloat(document.getElementById("addW").value) || 0;
  const h = parseFloat(document.getElementById("addH").value) || 0;
  document.getElementById("addWft").textContent = "= " + ft(w);
  document.getElementById("addHft").textContent = "= " + ft(h);
}

function updateGarageFtHints() {
  const w = parseFloat(document.getElementById("garageW").value) || 0;
  const h = parseFloat(document.getElementById("garageH").value) || 0;
  document.getElementById("garageWft").textContent = "= " + ft(w);
  document.getElementById("garageHft").textContent = "= " + ft(h);
}

function closeAddModal() { document.getElementById("modalAdd").classList.add("hidden"); }

function submitAddModal() {
  const name = document.getElementById("addName").value.trim() || "Untitled";
  const category = document.getElementById("addCategory").value;
  const w = clamp(parseInt(document.getElementById("addW").value) || 2, 1, 80);
  const h = clamp(parseInt(document.getElementById("addH").value) || 2, 1, 80);
  const h3 = clamp(parseInt(document.getElementById("addH3").value) || 1, 1, 20);
  const isStack = document.getElementById("addStack").checked;

  const cat = getCategory(category);
  // Find first free spot (simple search)
  const pos = findFreeSpot(w, h);

  const c = {
    id: uid(),
    name,
    category,
    color: cat.color,
    x: pos.x, y: pos.y,
    w, h,
    height3d: h3,
    notes: "",
    contents: [],
    stack: isStack ? [{ name: "Top bin", contents: [] }] : null
  };
  state.containers.push(c);
  selectedId = c.id;
  closeAddModal();
  scheduleSave();
  render();
}

function findFreeSpot(w, h) {
  const { width: gw, height: gh } = state.garage;
  for (let y = 0; y <= gh - h; y++) {
    for (let x = 0; x <= gw - w; x++) {
      const overlap = state.containers.some(c =>
        x < c.x + c.w && x + w > c.x &&
        y < c.y + c.h && y + h > c.y
      );
      if (!overlap) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function openGarageModal() {
  document.getElementById("garageW").value = state.garage.width;
  document.getElementById("garageH").value = state.garage.height;
  document.getElementById("garageCell").value = state.garage.gridSize;
  document.getElementById("garageFront").value = state.garage.frontWall || "left";
  document.getElementById("modalGarage").classList.remove("hidden");
  updateGarageFtHints();
}

function closeGarageModal() { document.getElementById("modalGarage").classList.add("hidden"); }

function submitGarageModal() {
  const w = clamp(parseInt(document.getElementById("garageW").value) || 30, 5, 200);
  const h = clamp(parseInt(document.getElementById("garageH").value) || 20, 5, 200);
  const cell = clamp(parseInt(document.getElementById("garageCell").value) || 28, 10, 80);
  const front = document.getElementById("garageFront").value;
  state.garage.width = w;
  state.garage.height = h;
  state.garage.gridSize = cell;
  state.garage.frontWall = front;
  // Clamp existing containers and zones
  for (const c of state.containers) {
    if (c.x + c.w > w) c.x = Math.max(0, w - c.w);
    if (c.y + c.h > h) c.y = Math.max(0, h - c.h);
    if (c.w > w) c.w = w;
    if (c.h > h) c.h = h;
  }
  for (const z of state.zones) {
    if (z.x + z.w > w) z.x = Math.max(0, w - z.w);
    if (z.y + z.h > h) z.y = Math.max(0, h - z.h);
    if (z.w > w) z.w = w;
    if (z.h > h) z.h = h;
  }
  scheduleSave();
  closeGarageModal();
  render();
}

function openCloudModal() {
  const m = document.getElementById("modalCloud");
  const token = getGhToken();
  document.getElementById("ghTokenInput").value = token ? "••••••••••••••••" : "";
  document.getElementById("ghStatus").textContent = token ? "Connected." : "Not connected.";
  document.getElementById("ghDisconnect").style.display = token ? "" : "none";
  document.getElementById("ghPullNow").style.display = token ? "" : "none";
  m.classList.remove("hidden");
  setTimeout(() => document.getElementById("ghTokenInput").focus(), 50);
}
function closeCloudModal() { document.getElementById("modalCloud").classList.add("hidden"); }

async function submitCloudModal() {
  const raw = document.getElementById("ghTokenInput").value.trim();
  if (!raw || raw.startsWith("••")) {
    // No change to token; nothing to do
    closeCloudModal();
    return;
  }
  // Validate by pulling once
  localStorage.setItem(GH_TOKEN_KEY, raw);
  ghSha = null;
  localStorage.removeItem(GH_SHA_KEY);
  setCloudStatus("pulling");
  try {
    const { state: remote, sha } = await ghPull();
    if (remote) {
      state = remote;
      ensureStateShape();
      ghSha = sha;
      localStorage.setItem(GH_SHA_KEY, ghSha);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setCloudStatus("synced");
      toast("Connected — pulled latest from GitHub", "success");
    } else {
      // No remote file yet — push current state
      const newSha = await ghPush(state);
      ghSha = newSha;
      localStorage.setItem(GH_SHA_KEY, ghSha);
      setCloudStatus("synced");
      toast("Connected — uploaded current layout to GitHub", "success");
    }
    closeCloudModal();
    render();
  } catch (e) {
    if (e.message === "AUTH") {
      setCloudStatus("error", "Bad token");
      toast("Token rejected by GitHub. Check the token's repo & permissions.", "error");
      localStorage.removeItem(GH_TOKEN_KEY);
    } else {
      setCloudStatus("error", e.message);
      toast("Failed: " + e.message, "error");
    }
  }
}

function disconnectCloud() {
  localStorage.removeItem(GH_TOKEN_KEY);
  localStorage.removeItem(GH_SHA_KEY);
  ghSha = null;
  setCloudStatus("off");
  closeCloudModal();
  toast("Disconnected from GitHub", "success");
}

function confirmDialog(title, msg, onYes) {
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMsg").textContent = msg;
  const m = document.getElementById("confirmDialog");
  m.classList.remove("hidden");
  const yes = document.getElementById("confirmYes");
  const no = document.getElementById("confirmNo");
  const close = () => m.classList.add("hidden");
  const yesH = () => { close(); cleanup(); onYes(); };
  const noH = () => { close(); cleanup(); };
  const cleanup = () => {
    yes.removeEventListener("click", yesH);
    no.removeEventListener("click", noH);
  };
  yes.addEventListener("click", yesH);
  no.addEventListener("click", noH);
}

// ============================================================
// Context Menu
// ============================================================

let ctxMenuEl = null;
function showContextMenu(e, c) {
  hideContextMenu();
  selectedId = c.id;
  render();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  menu.innerHTML = `
    <button data-act="duplicate">Duplicate</button>
    <button data-act="bring-front">Bring to front</button>
    <button data-act="send-back">Send to back</button>
    <button data-act="delete" class="danger-item">Delete</button>
  `;
  document.body.appendChild(menu);
  ctxMenuEl = menu;
  menu.addEventListener("click", (ev) => {
    const act = ev.target.dataset?.act;
    if (!act) return;
    handleCtx(act, c);
    hideContextMenu();
  });
  setTimeout(() => document.addEventListener("click", hideContextMenu, { once: true }), 0);
}

function hideContextMenu() {
  if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
}

function handleCtx(act, c) {
  if (act === "duplicate") {
    const copy = clone(c);
    copy.id = uid();
    copy.name = c.name + " (copy)";
    const pos = findFreeSpot(c.w, c.h);
    copy.x = pos.x; copy.y = pos.y;
    state.containers.push(copy);
    selectedId = copy.id;
  } else if (act === "bring-front") {
    state.containers = state.containers.filter(x => x.id !== c.id).concat(c);
  } else if (act === "send-back") {
    state.containers = [c, ...state.containers.filter(x => x.id !== c.id)];
  } else if (act === "delete") {
    confirmDialog(`Delete "${c.name}"?`, "This container will be removed.", () => {
      state.containers = state.containers.filter(x => x.id !== c.id);
      if (selectedId === c.id) selectedId = null;
      scheduleSave(); render();
    });
    return;
  }
  scheduleSave(); render();
}

// ============================================================
// Toast
// ============================================================

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  }, 2800);
}

// ============================================================
// Wire up
// ============================================================

function setupTopbar() {
  const rotGroup = document.getElementById("rotateGroup");
  const updateRotateVisibility = () => { rotGroup.hidden = (view !== "iso"); };
  document.querySelectorAll(".view-toggle button").forEach(btn => {
    btn.addEventListener("click", () => {
      view = btn.dataset.view;
      document.querySelectorAll(".view-toggle button").forEach(b => b.classList.toggle("active", b === btn));
      updateRotateVisibility();
      render();
    });
  });
  document.getElementById("rotateCcw").addEventListener("click", () => { isoRotation = (isoRotation + 3) % 4; render(); });
  document.getElementById("rotateCw").addEventListener("click", () => { isoRotation = (isoRotation + 1) % 4; render(); });
  updateRotateVisibility();

  document.getElementById("addContainerBtn").addEventListener("click", openAddModal);
  document.getElementById("addZoneBtn").addEventListener("click", addZone);
  document.getElementById("garageSettingsBtn").addEventListener("click", openGarageModal);
  document.getElementById("exportBtn").addEventListener("click", exportJson);
  document.getElementById("cloudBtn").addEventListener("click", openCloudModal);
  document.getElementById("syncRepoBtn").addEventListener("click", async () => {
    if (getGhToken()) {
      const changed = await cloudPull();
      if (changed) { selectedId = null; selectedZoneId = null; render(); }
    } else {
      const ok = await tryFetchRemote(true);
      if (ok) { selectedId = null; selectedZoneId = null; render(); }
    }
  });
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", e => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = "";
  });

  // Category filter
  const filterSel = document.getElementById("categoryFilter");
  filterSel.innerHTML = '<option value="">All categories</option>' +
    CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
  filterSel.value = categoryFilter;
  filterSel.addEventListener("change", e => {
    categoryFilter = e.target.value;
    render();
  });

  document.getElementById("addCancel").addEventListener("click", closeAddModal);
  document.getElementById("addOk").addEventListener("click", submitAddModal);
  document.getElementById("garageCancel").addEventListener("click", closeGarageModal);
  document.getElementById("garageOk").addEventListener("click", submitGarageModal);

  // Live ft hints in modals
  document.getElementById("addW").addEventListener("input", updateAddFtHints);
  document.getElementById("addH").addEventListener("input", updateAddFtHints);
  document.getElementById("garageW").addEventListener("input", updateGarageFtHints);
  document.getElementById("garageH").addEventListener("input", updateGarageFtHints);

  // Cloud modal wiring
  document.getElementById("ghSave").addEventListener("click", submitCloudModal);
  document.getElementById("ghCancel").addEventListener("click", closeCloudModal);
  document.getElementById("ghDisconnect").addEventListener("click", disconnectCloud);
  document.getElementById("ghPullNow").addEventListener("click", async () => {
    const changed = await cloudPull();
    if (changed) { selectedId = null; selectedZoneId = null; render(); }
    closeCloudModal();
  });

  // Auto-pull when the tab regains focus (handles "open on phone B after edits on phone A")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getGhToken() && !cloudPullInFlight) {
      cloudPull({ silent: true }).then(changed => {
        if (changed) { selectedId = null; selectedZoneId = null; render(); }
      });
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeAddModal();
      closeGarageModal();
      closeCloudModal();
      hideContextMenu();
    }
    if (e.key === "Delete" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      if (selectedZoneId) {
        const z = findZone(selectedZoneId);
        if (z) confirmDialog(`Delete zone "${z.name}"?`, "The zone will be removed.", () => {
          state.zones = state.zones.filter(x => x.id !== z.id);
          selectedZoneId = null;
          scheduleSave(); render();
        });
      } else if (selectedId) {
        const c = findContainer(selectedId);
        if (c) confirmDialog(`Delete "${c.name}"?`, "This container will be removed.", () => {
          state.containers = state.containers.filter(x => x.id !== c.id);
          selectedId = null;
          scheduleSave(); render();
        });
      }
    }
  });
}

async function init() {
  setupTopbar();
  setCloudStatus(getGhToken() ? "synced" : "off");
  await loadInitial();
  setSaveStatus("saved");
  render();
}

init();
