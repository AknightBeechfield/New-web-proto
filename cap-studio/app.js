// Cap Studio prototype — taxonomy QA tool
// No scoring, no inferred tags. Filters are factual equality against workbook fields.

const state = {
  products: [],
  filters: {},          // filter groups -> array of {value, source, notes, casing_duplicate_of?}
  scenarios: [],
  fieldDefs: {},        // field name -> {description, notes}
  active: {},           // group -> Set of selected values
  view: "browse",       // "browse" | "scenario"
  scenarioId: null,
  sort: "code",
  visibleProducts: [],
};

// Maps filter group names to product field names. Same in most cases.
const GROUP_TO_FIELD = {
  "Market": "Market",
  "Product Category": "Product Category",
  "Product Type": "Product Type",
  "Crown Profile": "Crown Profile",
  "Structure / Buckram": "Structure / Buckram",
  "Peak": "Peak",
  "Closure": "Simplified Closure", // brief lists "Closure" as a group; Simplified Closure is the cleaner field
};

// Boolean-style toggles pulled directly from Product_Master.
const EXTRA_TOGGLES = [
  { group: "Has Sustainability / Certification", field: "Sustainability / Certification", match: "any" },
  { group: "In Cap Classification", field: "In Cap Classification", match: "Yes" },
  { group: "In Falk Export", field: "In Falk Export", match: "Yes" },
  { group: "In Sales Data", field: "In Sales Data", match: "Yes" },
];

// Optional categorical filter generated from Product_Master, not Filter_Reference.
const COLOUR_BAND_GROUP = "Colour Band";

const VISIBLE_FIELDS = [
  "Source Product Code", "Product Name", "Brand", "Product Category", "Market", "Product Type",
  "Crown Profile", "Structure / Buckram", "Panel Count", "Peak", "Simplified Closure",
  "Fabric Website", "Colour Count", "Colour List", "Sustainability / Certification",
  "Decoration", "Data Gap Notes"
];

async function loadData() {
  const [products, filters, scenarios, fieldDefs] = await Promise.all([
    fetch("data/products.json").then(r => r.json()),
    fetch("data/filters.json").then(r => r.json()),
    fetch("data/scenarios.json").then(r => r.json()),
    fetch("data/field_definitions.json").then(r => r.json()),
  ]);
  state.products = products;
  state.filters = filters;
  state.scenarios = scenarios;
  state.fieldDefs = Object.fromEntries(fieldDefs.map(d => [d.Field, d]));
}

function init() {
  buildFilterUI();
  buildScenarioOptions();
  flagDataQAIssues();
  wireUpControls();
  applyFilters();
  refreshFeedbackCount();
}

function buildFilterUI() {
  const root = document.getElementById("filter-list");
  root.innerHTML = "";

  // Filter_Reference groups, in the order the brief lists them.
  const refOrder = ["Market", "Product Category", "Product Type", "Crown Profile", "Structure / Buckram", "Peak", "Closure"];
  for (const group of refOrder) {
    if (!state.filters[group]) continue;
    root.appendChild(renderFilterGroup(group, state.filters[group]));
  }

  // Colour Band from Product_Master (Low / Med / High / Very High)
  const colourBands = uniqueProductValues("Colour Band");
  if (colourBands.length) {
    root.appendChild(renderFilterGroup(
      COLOUR_BAND_GROUP,
      colourBands.map(v => ({ value: v }))
    ));
  }

  // Boolean toggles
  const togglesWrap = document.createElement("div");
  togglesWrap.className = "filter-group";
  togglesWrap.innerHTML = `<h3>Source presence / sustainability</h3>`;
  for (const t of EXTRA_TOGGLES) {
    const id = "tog_" + t.group.replace(/\W+/g, "_");
    const label = document.createElement("label");
    label.className = "filter-option";
    label.innerHTML = `
      <input type="checkbox" id="${id}" data-toggle-group="${t.group}">
      <span>${t.group}</span>
    `;
    togglesWrap.appendChild(label);
  }
  root.appendChild(togglesWrap);
}

function renderFilterGroup(group, items) {
  const wrap = document.createElement("div");
  wrap.className = "filter-group";
  wrap.innerHTML = `<h3>${group}</h3>`;
  // Count products per value against currently-active *other* filters? Keep it simple: count against all.
  const field = GROUP_TO_FIELD[group] || group;
  for (const item of items) {
    const value = item.value;
    const cnt = state.products.filter(p => valueMatches(p[field], value)).length;
    const warn = item.casing_duplicate_of ? ` <span class="casing-warn" title="Casing-only duplicates in workbook: ${item.casing_duplicate_of.join(', ')}">⚠ casing dup</span>` : "";
    const label = document.createElement("label");
    label.className = "filter-option";
    label.innerHTML = `
      <input type="checkbox" data-group="${escapeAttr(group)}" data-value="${escapeAttr(value)}">
      <span>${escapeHtml(String(value))}${warn}</span>
      <span class="count">${cnt}</span>
    `;
    wrap.appendChild(label);
  }
  return wrap;
}

function valueMatches(productValue, filterValue) {
  if (productValue == null) return false;
  return String(productValue).trim() === String(filterValue).trim();
}

function uniqueProductValues(field) {
  const s = new Set();
  for (const p of state.products) {
    const v = p[field];
    if (v != null && String(v).trim() !== "") s.add(String(v).trim());
  }
  return Array.from(s).sort();
}

function buildScenarioOptions() {
  const sel = document.getElementById("scenario-select");
  for (const s of state.scenarios) {
    const opt = document.createElement("option");
    opt.value = s["Scenario ID"];
    opt.textContent = `${s["Scenario ID"]} · ${s["Scenario Name"]}`;
    sel.appendChild(opt);
  }
}

function flagDataQAIssues() {
  const dupGroups = [];
  for (const [group, items] of Object.entries(state.filters)) {
    if (items.some(it => it.casing_duplicate_of)) dupGroups.push(group);
  }
  if (dupGroups.length) {
    const el = document.getElementById("qa-warn");
    el.style.display = "block";
    el.innerHTML = `<b>Taxonomy QA flag:</b> Filter_Reference contains casing-only duplicates in: ${dupGroups.join(", ")}. Surfaced as ⚠ in the filter list.`;
  }
}

function wireUpControls() {
  document.getElementById("filter-list").addEventListener("change", e => {
    const t = e.target;
    if (t.matches('input[type="checkbox"][data-group]')) {
      const group = t.dataset.group;
      const value = t.dataset.value;
      if (!state.active[group]) state.active[group] = new Set();
      if (t.checked) state.active[group].add(value);
      else state.active[group].delete(value);
      if (state.active[group].size === 0) delete state.active[group];
      applyFilters();
    } else if (t.matches('input[data-toggle-group]')) {
      const group = t.dataset.toggleGroup;
      if (t.checked) state.active[group] = new Set(["__toggle__"]);
      else delete state.active[group];
      applyFilters();
    }
  });

  document.getElementById("clear-filters").addEventListener("click", clearFilters);
  document.getElementById("sort").addEventListener("change", e => {
    state.sort = e.target.value;
    applyFilters();
  });

  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  document.getElementById("scenario-select").addEventListener("change", e => loadScenario(e.target.value));

  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  document.getElementById("drawer-bg").addEventListener("click", closeDrawer);

  document.getElementById("fb-submit").addEventListener("click", saveFeedback);
  document.getElementById("fb-export-csv").addEventListener("click", () => exportFeedback("csv"));
  document.getElementById("fb-export-json").addEventListener("click", () => exportFeedback("json"));
  document.getElementById("fb-clear").addEventListener("click", () => {
    if (confirm("Clear all locally-stored feedback entries?")) {
      localStorage.removeItem("capStudioFeedback");
      refreshFeedbackCount();
    }
  });
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.getElementById("scenarios-panel").classList.toggle("hidden", view !== "scenario");
  if (view === "browse") {
    state.scenarioId = null;
    document.getElementById("fb-scenario").value = "";
  }
}

function loadScenario(id) {
  state.scenarioId = id || null;
  document.getElementById("fb-scenario").value = id || "";
  if (!id) {
    document.getElementById("scenario-body").innerHTML = "";
    return;
  }
  const s = state.scenarios.find(x => x["Scenario ID"] === id);
  if (!s) return;
  // Apply scenario filters
  clearFilters({ silent: true });
  for (const v of s["Market Filter(s) Array"] || []) addActive("Market", v);
  for (const v of s["Product Category Filter(s) Array"] || []) addActive("Product Category", v);
  for (const v of s["Product Type Filter(s) Array"] || []) addActive("Product Type", v);
  syncCheckboxesFromState();
  applyFilters();

  document.getElementById("scenario-body").innerHTML = `
    <p><em>${escapeHtml(s["Primary Question"] || "")}</em></p>
    <p><b>Tech hints:</b> ${escapeHtml(s["Technical Filter Hints"] || "")}</p>
    <p><b>Expected:</b> ${escapeHtml(s["Expected Product Type Notes"] || "")}</p>
    <p><b>Feedback prompt:</b> ${escapeHtml(s["Feedback Prompt"] || "")}</p>
  `;
}

function addActive(group, value) {
  if (!state.active[group]) state.active[group] = new Set();
  state.active[group].add(value);
}

function syncCheckboxesFromState() {
  document.querySelectorAll('input[type="checkbox"][data-group]').forEach(cb => {
    const g = cb.dataset.group, v = cb.dataset.value;
    cb.checked = !!(state.active[g] && state.active[g].has(v));
  });
  document.querySelectorAll('input[data-toggle-group]').forEach(cb => {
    cb.checked = !!state.active[cb.dataset.toggleGroup];
  });
}

function clearFilters(opts = {}) {
  state.active = {};
  syncCheckboxesFromState();
  if (!opts.silent) applyFilters();
}

function applyFilters() {
  const active = state.active;
  const groups = Object.keys(active);

  const filtered = state.products.filter(p => {
    for (const group of groups) {
      const selected = active[group];
      if (!selected || selected.size === 0) continue;

      // Boolean toggle group?
      const toggle = EXTRA_TOGGLES.find(t => t.group === group);
      if (toggle) {
        const v = p[toggle.field];
        if (toggle.match === "any") {
          if (v == null || String(v).trim() === "") return false;
        } else {
          if (!v || String(v).trim().toLowerCase() !== String(toggle.match).toLowerCase()) return false;
        }
        continue;
      }

      // Colour band
      if (group === COLOUR_BAND_GROUP) {
        const v = p["Colour Band"];
        if (!v || ![...selected].includes(String(v).trim())) return false;
        continue;
      }

      // Standard equality filter (OR within group, AND across groups)
      const field = GROUP_TO_FIELD[group] || group;
      const pv = p[field];
      let any = false;
      for (const wanted of selected) {
        if (valueMatches(pv, wanted)) { any = true; break; }
      }
      if (!any) return false;
    }
    return true;
  });

  if (state.sort === "sales") {
    filtered.sort((a, b) => (parseFloat(b["L12M Sales"]) || 0) - (parseFloat(a["L12M Sales"]) || 0));
  } else {
    filtered.sort((a, b) => String(a["Source Product Code"] || "").localeCompare(String(b["Source Product Code"] || "")));
  }

  state.visibleProducts = filtered;
  renderResults(filtered);
  renderChips();
}

function renderChips() {
  const wrap = document.getElementById("active-chips");
  wrap.innerHTML = "";
  if (state.scenarioId) {
    const chip = document.createElement("span");
    chip.className = "chip scenario";
    chip.innerHTML = `Scenario: ${escapeHtml(state.scenarioId)} <span class="x" title="Clear scenario">×</span>`;
    chip.querySelector(".x").addEventListener("click", () => {
      document.getElementById("scenario-select").value = "";
      loadScenario("");
    });
    wrap.appendChild(chip);
  }
  for (const group of Object.keys(state.active)) {
    for (const value of state.active[group]) {
      const chip = document.createElement("span");
      chip.className = "chip";
      const label = (value === "__toggle__") ? group : `${group}: ${value}`;
      chip.innerHTML = `${escapeHtml(label)} <span class="x">×</span>`;
      chip.querySelector(".x").addEventListener("click", () => {
        state.active[group].delete(value);
        if (state.active[group].size === 0) delete state.active[group];
        syncCheckboxesFromState();
        applyFilters();
      });
      wrap.appendChild(chip);
    }
  }
}

function renderResults(list) {
  document.getElementById("count").textContent = list.length;
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  // Cap render at 300 to keep DOM responsive; show note if truncated.
  const cap = 300;
  for (const p of list.slice(0, cap)) {
    frag.appendChild(renderCard(p));
  }
  grid.appendChild(frag);
  if (list.length > cap) {
    const note = document.createElement("div");
    note.style.cssText = "grid-column: 1/-1; color: var(--muted); font-size: 12px; padding: 12px;";
    note.textContent = `Showing first ${cap} of ${list.length} matches — refine filters to narrow.`;
    grid.appendChild(note);
  }
}

function renderCard(p) {
  const card = document.createElement("div");
  card.className = "card";
  const code = p["Source Product Code"] || "(no code)";
  const name = p["Product Name"] || "";
  const gaps = p["Data Gap Notes"];

  const metaPairs = [
    ["Market", p["Market"]],
    ["Category", p["Product Category"]],
    ["Type", p["Product Type"]],
    ["Crown", p["Crown Profile"]],
    ["Structure", p["Structure / Buckram"]],
    ["Panels", p["Panel Count"]],
    ["Peak", p["Peak"]],
    ["Closure", p["Simplified Closure"] || p["Closure / Adjuster"]],
    ["Fabric", p["Fabric Website"]],
    ["Colours", p["Colour Count"]],
    ["Cert.", p["Sustainability / Certification"]],
  ];

  const metaHtml = metaPairs.map(([k, v]) => `<div><b>${escapeHtml(k)}:</b> ${v == null || v === "" ? '<span class="gap-flag">—</span>' : escapeHtml(String(v))}</div>`).join("");

  card.innerHTML = `
    <div class="code">${escapeHtml(String(code))}</div>
    <div class="name">${escapeHtml(String(name))}</div>
    <div class="meta">${metaHtml}</div>
    ${gaps ? `<div class="gap-flag">⚠ Data gap: ${escapeHtml(String(gaps))}</div>` : ""}
    <div class="why ${whyClass(p)}">${whyText(p)}</div>
    <div class="card-actions">
      <button data-action="debug">Debug view</button>
    </div>
  `;
  card.querySelector('[data-action="debug"]').addEventListener("click", () => openDrawer(p));
  return card;
}

function whyText(p) {
  const parts = [];
  for (const group of Object.keys(state.active)) {
    if (EXTRA_TOGGLES.find(t => t.group === group)) {
      parts.push(group);
      continue;
    }
    if (group === COLOUR_BAND_GROUP) {
      parts.push(`Colour Band = ${p["Colour Band"]}`);
      continue;
    }
    const field = GROUP_TO_FIELD[group] || group;
    parts.push(`${group} = ${p[field]}`);
  }
  if (parts.length === 0) return "No active filters — showing the full master list.";
  return "Appears because: " + parts.join("; ") + ".";
}

function whyClass(p) {
  return Object.keys(state.active).length === 0 ? "empty" : "";
}

function openDrawer(p) {
  document.getElementById("drawer-title").textContent = `${p["Source Product Code"]} · ${p["Product Name"] || ""}`;
  const body = document.getElementById("drawer-body");
  body.innerHTML = "";
  const dl = document.createElement("dl");
  // Render all fields in workbook order; we lost order via JSON.parse, so use the keys as-is.
  for (const k of Object.keys(p)) {
    if (k === "Colour List Array" || k === "Size List Array") continue;
    const dt = document.createElement("dt");
    dt.textContent = k;
    const def = state.fieldDefs[k];
    if (def && def.Description) {
      dt.classList.add("has-def");
      dt.title = def.Description + (def.Notes ? `\n\nNotes: ${def.Notes}` : "");
    }
    const dd = document.createElement("dd");
    const v = p[k];
    if (v == null || v === "") {
      dd.classList.add("empty");
      dd.textContent = "missing";
    } else {
      dd.textContent = String(v);
    }
    dl.appendChild(dt); dl.appendChild(dd);
  }
  body.appendChild(dl);
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawer-bg").classList.add("open");
}

function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawer-bg").classList.remove("open");
}

/* ---------- Feedback ---------- */

function getFeedback() {
  try { return JSON.parse(localStorage.getItem("capStudioFeedback") || "[]"); }
  catch (e) { return []; }
}
function setFeedback(arr) {
  localStorage.setItem("capStudioFeedback", JSON.stringify(arr));
  refreshFeedbackCount();
}
function refreshFeedbackCount() {
  const n = getFeedback().length;
  document.getElementById("fb-count").textContent = `${n} entr${n === 1 ? "y" : "ies"} stored`;
  updateAutoSummary();
}

function updateAutoSummary() {
  const filtersSummary = Object.entries(state.active).map(([g, vs]) =>
    `${g} = ${[...vs].filter(v => v !== "__toggle__").join("|") || "(on)"}`
  ).join("; ") || "(none)";
  const codes = state.visibleProducts.slice(0, 60).map(p => p["Source Product Code"]).join(", ");
  const moreNote = state.visibleProducts.length > 60 ? ` … +${state.visibleProducts.length - 60} more` : "";
  document.getElementById("fb-auto").textContent =
    `Auto-captured on save → Filters: ${filtersSummary} · Products shown: ${state.visibleProducts.length} (${codes}${moreNote})`;
}

function saveFeedback() {
  const entry = {
    "Timestamp": new Date().toISOString(),
    "Tester Name": document.getElementById("fb-tester").value || "",
    "Scenario ID": state.scenarioId || "",
    "Filters Selected": Object.entries(state.active).map(([g, vs]) =>
      `${g} = ${[...vs].filter(v => v !== "__toggle__").join("|") || "(on)"}`
    ).join("; "),
    "Products Shown": state.visibleProducts.map(p => p["Source Product Code"]).join("; "),
    "Overall Rating": document.getElementById("fb-rating").value,
    "Expected Products Missing": document.getElementById("fb-missing").value || "",
    "Unexpected Products Shown": document.getElementById("fb-unexpected").value || "",
    "Market Label Feedback": document.getElementById("fb-market").value || "",
    "Product Category Feedback": document.getElementById("fb-category").value || "",
    "Technical Data Feedback": document.getElementById("fb-technical").value || "",
    "Notes": document.getElementById("fb-notes").value || "",
    "Action Required": document.getElementById("fb-action").value || "",
    "Owner": "",
    "Status": "Open"
  };
  if (!entry["Tester Name"]) {
    alert("Add a tester name before saving.");
    return;
  }
  const all = getFeedback();
  all.push(entry);
  setFeedback(all);
  // Reset narrative fields, keep tester name for next entry
  for (const id of ["fb-missing", "fb-unexpected", "fb-market", "fb-category", "fb-technical", "fb-notes", "fb-action"]) {
    document.getElementById(id).value = "";
  }
  alert("Feedback saved locally. Use the export buttons to send it onwards.");
}

function exportFeedback(format) {
  const entries = getFeedback();
  if (!entries.length) { alert("No feedback entries to export yet."); return; }
  const COLS = ["Timestamp", "Tester Name", "Scenario ID", "Filters Selected", "Products Shown",
    "Overall Rating", "Expected Products Missing", "Unexpected Products Shown",
    "Market Label Feedback", "Product Category Feedback", "Technical Data Feedback",
    "Notes", "Action Required", "Owner", "Status"];
  let blob, name;
  if (format === "json") {
    blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    name = `cap-studio-feedback-${ymd()}.json`;
  } else {
    const head = COLS.join(",");
    const rows = entries.map(e => COLS.map(c => csvCell(e[c])).join(","));
    blob = new Blob([head + "\n" + rows.join("\n")], { type: "text/csv" });
    name = `cap-studio-feedback-${ymd()}.csv`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function ymd() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// Refresh auto summary whenever filters change
const origApplyFilters = applyFilters;
// (already calls renderResults / renderChips; just update summary at the end)
const _appendAutoUpdate = () => updateAutoSummary();
document.addEventListener("change", _appendAutoUpdate, true);
document.addEventListener("click", _appendAutoUpdate, true);

loadData().then(init).catch(err => {
  document.getElementById("grid").innerHTML =
    `<div style="color:var(--red);padding:20px;">Failed to load data: ${escapeHtml(err.message)}<br>` +
    `If you opened this file directly, serve it via <code>python3 -m http.server</code> from the repo root.</div>`;
});
