// ============================================================
// Garage Organizer
// ============================================================

const SVG_NS = "http://www.w3.org/2000/svg";

const CATEGORIES = [
  { id: "storage-box",  label: "Storage Box",   color: "#a06236" },
  { id: "tools",        label: "Tools",         color: "#d44c4c" },
  { id: "equipment",    label: "Equipment",     color: "#e08a3a" },
  { id: "workbench",    label: "Workbench",     color: "#7a7f8c" },
  { id: "shelves",      label: "Shelves",       color: "#4a8fd6" },
  { id: "temporary",    label: "Temp Storage",  color: "#d6c14a" },
  { id: "going-out",    label: "Going Out",     color: "#5cb85c" },
  { id: "donation",     label: "Donation",      color: "#9b59b6" }
];

const DEFAULT_STATE = {
  version: 1,
  garage: { width: 30, height: 20, gridSize: 28 },
  containers: []
};

const STORAGE_KEY = "garage-organizer-v1";
const REMOTE_FILE = "garage.json";

// ============================================================
// State
// ============================================================

let state = clone(DEFAULT_STATE);
let view = "2d";
let selectedId = null;
let saveTimer = null;
let lastSavedJson = "";

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
}

function setSaveStatus(s) {
  const el = document.getElementById("saveStatus");
  el.classList.remove("saving", "saved", "error");
  el.classList.add(s);
  el.textContent = s === "saving" ? "Saving…" : s === "saved" ? "Saved" : "Error";
}

async function loadInitial() {
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

function ensureStateShape() {
  if (!state.garage) state.garage = clone(DEFAULT_STATE.garage);
  if (typeof state.garage.gridSize !== "number") state.garage.gridSize = 28;
  if (!Array.isArray(state.containers)) state.containers = [];
  for (const c of state.containers) {
    if (!c.id) c.id = uid();
    if (!c.contents) c.contents = [];
    if (typeof c.height3d !== "number") c.height3d = 1;
    if (!c.notes) c.notes = "";
  }
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

function render2D() {
  const vp = document.getElementById("viewport");
  vp.innerHTML = "";
  const { width: gw, height: gh, gridSize: cell } = state.garage;
  const W = gw * cell;
  const H = gh * cell;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // Grid background
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", 0); bg.setAttribute("y", 0);
  bg.setAttribute("width", W); bg.setAttribute("height", H);
  bg.setAttribute("fill", "#1f232c");
  svg.appendChild(bg);

  // Grid lines
  for (let x = 0; x <= gw; x++) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x * cell); line.setAttribute("y1", 0);
    line.setAttribute("x2", x * cell); line.setAttribute("y2", H);
    line.setAttribute("stroke", x % 5 === 0 ? "#404a60" : "#2f3645");
    line.setAttribute("stroke-width", x % 5 === 0 ? 1 : 0.5);
    svg.appendChild(line);
  }
  for (let y = 0; y <= gh; y++) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", 0); line.setAttribute("y1", y * cell);
    line.setAttribute("x2", W); line.setAttribute("y2", y * cell);
    line.setAttribute("stroke", y % 5 === 0 ? "#404a60" : "#2f3645");
    line.setAttribute("stroke-width", y % 5 === 0 ? 1 : 0.5);
    svg.appendChild(line);
  }

  // Containers
  const sortedIds = state.containers.map(c => c.id);
  for (const c of state.containers) {
    const cat = getCategory(c.category);
    const color = c.color || cat.color;
    const x = c.x * cell;
    const y = c.y * cell;
    const w = c.w * cell;
    const h = c.h * cell;

    const g = document.createElementNS(SVG_NS, "g");
    g.dataset.id = c.id;

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("fill", color);
    rect.setAttribute("stroke", c.id === selectedId ? "#fff" : "rgba(0,0,0,0.4)");
    rect.setAttribute("stroke-width", c.id === selectedId ? 2 : 1);
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

  vp.appendChild(svg);
}

// 2D drag & resize
let dragState = null;

function onContainerMouseDown(e, c) {
  e.stopPropagation();
  selectedId = c.id;
  const role = e.target.dataset?.role;
  const cell = state.garage.gridSize;
  const svg = e.currentTarget.ownerSVGElement;
  const pt = svgPoint(svg, e);

  if (role === "resize") {
    dragState = {
      mode: "resize",
      id: c.id,
      startW: c.w,
      startH: c.h,
      startPx: pt
    };
  } else {
    dragState = {
      mode: "move",
      id: c.id,
      startX: c.x,
      startY: c.y,
      offsetX: pt.x - c.x * cell,
      offsetY: pt.y - c.y * cell
    };
  }
  render();
  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseup", onDocMouseUp);
}

function onDocMouseMove(e) {
  if (!dragState) return;
  const c = findContainer(dragState.id);
  if (!c) return;
  const cell = state.garage.gridSize;
  const svg = document.querySelector("#viewport svg");
  if (!svg) return;
  const pt = svgPoint(svg, e);

  if (dragState.mode === "move") {
    let nx = Math.round((pt.x - dragState.offsetX) / cell);
    let ny = Math.round((pt.y - dragState.offsetY) / cell);
    nx = clamp(nx, 0, state.garage.width - c.w);
    ny = clamp(ny, 0, state.garage.height - c.h);
    if (nx !== c.x || ny !== c.y) {
      c.x = nx; c.y = ny;
      render2D();
      renderSidebar();
    }
  } else if (dragState.mode === "resize") {
    let nw = Math.max(1, Math.round((pt.x - c.x * cell) / cell));
    let nh = Math.max(1, Math.round((pt.y - c.y * cell) / cell));
    nw = Math.min(nw, state.garage.width - c.x);
    nh = Math.min(nh, state.garage.height - c.y);
    if (nw !== c.w || nh !== c.h) {
      c.w = nw; c.h = nh;
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
  const { width: gw, height: gh, gridSize } = state.garage;
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

  // Sort containers back-to-front for proper occlusion
  const sorted = [...state.containers].sort((a, b) => {
    const sa = (a.x + a.w/2) + (a.y + a.h/2);
    const sb = (b.x + b.w/2) + (b.y + b.h/2);
    return sa - sb;
  });

  for (const c of sorted) {
    const cat = getCategory(c.category);
    const color = c.color || cat.color;
    const totalStoreys = c.stack ? c.stack.length : (c.height3d || 1);

    drawIsoBox(svg, c, color, totalStoreys, ox, oy, isoX, isoY, HEIGHT_PX, cell);
  }

  vp.appendChild(svg);
}

function drawIsoBox(svg, c, color, storeys, ox, oy, isoX, isoY, HEIGHT_PX, cell) {
  const g = document.createElementNS(SVG_NS, "g");
  g.dataset.id = c.id;
  g.style.cursor = "pointer";

  const x1 = c.x, y1 = c.y, x2 = c.x + c.w, y2 = c.y + c.h;
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
    const top = document.createElementNS(SVG_NS, "polygon");
    top.setAttribute("points", `${tlf[0]},${tlf[1]} ${trf[0]},${trf[1]} ${trb[0]},${trb[1]} ${tlb[0]},${tlb[1]}`);
    top.setAttribute("fill", storeyColor);
    top.setAttribute("stroke", c.id === selectedId ? "#fff" : "rgba(0,0,0,0.5)");
    top.setAttribute("stroke-width", c.id === selectedId ? 2 : 0.7);
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
  if (!selectedId) {
    sb.innerHTML = `
      <div class="sidebar-empty">
        <h3>Click a container</h3>
        <p>Select a container in the garage to view or edit its contents, size, position, or stack.</p>
        <p class="hint">Tip: drag to move, drag corner to resize. Right-click for quick actions.</p>
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
  setTimeout(() => document.getElementById("addName").focus(), 50);
}

function closeAddModal() { document.getElementById("modalAdd").classList.add("hidden"); }

function submitAddModal() {
  const name = document.getElementById("addName").value.trim() || "Untitled";
  const category = document.getElementById("addCategory").value;
  const w = clamp(parseInt(document.getElementById("addW").value) || 2, 1, 40);
  const h = clamp(parseInt(document.getElementById("addH").value) || 2, 1, 40);
  const h3 = clamp(parseInt(document.getElementById("addH3").value) || 1, 1, 10);
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
  document.getElementById("modalGarage").classList.remove("hidden");
}

function closeGarageModal() { document.getElementById("modalGarage").classList.add("hidden"); }

function submitGarageModal() {
  const w = clamp(parseInt(document.getElementById("garageW").value) || 30, 5, 100);
  const h = clamp(parseInt(document.getElementById("garageH").value) || 20, 5, 100);
  const cell = clamp(parseInt(document.getElementById("garageCell").value) || 28, 10, 80);
  state.garage.width = w;
  state.garage.height = h;
  state.garage.gridSize = cell;
  // Clamp existing containers
  for (const c of state.containers) {
    if (c.x + c.w > w) c.x = Math.max(0, w - c.w);
    if (c.y + c.h > h) c.y = Math.max(0, h - c.h);
    if (c.w > w) c.w = w;
    if (c.h > h) c.h = h;
  }
  scheduleSave();
  closeGarageModal();
  render();
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
  document.querySelectorAll(".view-toggle button").forEach(btn => {
    btn.addEventListener("click", () => {
      view = btn.dataset.view;
      document.querySelectorAll(".view-toggle button").forEach(b => b.classList.toggle("active", b === btn));
      render();
    });
  });
  document.getElementById("addContainerBtn").addEventListener("click", openAddModal);
  document.getElementById("garageSettingsBtn").addEventListener("click", openGarageModal);
  document.getElementById("exportBtn").addEventListener("click", exportJson);
  document.getElementById("syncRepoBtn").addEventListener("click", () => tryFetchRemote(true).then(ok => { if (ok) { selectedId = null; render(); } }));
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", e => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = "";
  });

  document.getElementById("addCancel").addEventListener("click", closeAddModal);
  document.getElementById("addOk").addEventListener("click", submitAddModal);
  document.getElementById("garageCancel").addEventListener("click", closeGarageModal);
  document.getElementById("garageOk").addEventListener("click", submitGarageModal);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeAddModal();
      closeGarageModal();
      hideContextMenu();
    }
    if (e.key === "Delete" && selectedId && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      const c = findContainer(selectedId);
      if (c) confirmDialog(`Delete "${c.name}"?`, "This container will be removed.", () => {
        state.containers = state.containers.filter(x => x.id !== c.id);
        selectedId = null;
        scheduleSave(); render();
      });
    }
  });
}

async function init() {
  setupTopbar();
  await loadInitial();
  setSaveStatus("saved");
  render();
}

init();
