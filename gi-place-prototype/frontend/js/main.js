// main.js - connects the panel, the preview map, the picker and the geometry logic.
//
//   applied = the site shown in the panel (what the rest of the dashboard will use)
//   draft   = the shape being drawn inside the open picker (not applied yet)

// Report and block any unexpected form submission so it cannot refresh the dashboard.
document.addEventListener("submit", (e) => {
  console.error("Blocked form submission:", {
    form: e.target,
    action: e.target.action,
    method: e.target.method,
    submitter: e.submitter,
    stack: new Error("Form submission trace").stack
  });
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}, true);

// A reload or navigation can happen without a form; log the page state before unload.
window.addEventListener("beforeunload", () => {
  console.warn("Dashboard page is unloading:", {
    url: window.location.href,
    activeElement: document.activeElement,
    stack: new Error("Page unload trace").stack
  });
});

const counties = window.FL_COUNTIES;
let applied = null;   // { geojson, result } | null
let draft = null;     // { geojson, result } | null
let picker = null;    // created the first time the overlay opens

initCountyDropdown(counties);
const mini = createMiniMap(counties);
const outputMap = createOutputMap();

/* ----- Characterization layer toggles ----- */
const layerButtons = document.querySelectorAll(".layer-button[data-layer]");
let layerAcres = {};   // name -> acres from the last /run-step1 response

// Reflect the output map's state on the six sidebar buttons:
//   before a run   -> all clickable, none pressed (click explains what to do)
//   after a run    -> layers the backend produced toggle on/off;
//                     layers it returned as null are disabled
function syncLayerButtons() {
  const hasResults = [...layerButtons].some(btn => outputMap.hasLayer(btn.dataset.layer));
  layerButtons.forEach(btn => {
    const name = btn.dataset.layer;
    const available = outputMap.hasLayer(name);
    btn.disabled = hasResults && !available;
    btn.setAttribute("aria-pressed", String(outputMap.isVisible(name)));
    const acres = Number.isFinite(layerAcres[name]) ? ` (~${fmt(layerAcres[name], 1)} acres)` : "";
    btn.title = !hasResults ? "Run Step 1 Analysis to view this layer"
      : available ? `Show or hide this layer on the output map${acres}`
        : "This layer could not be produced (input data missing)";
  });
}

function clearOutputLayers() {
  layerAcres = {};
  outputMap.clearLayers();
  syncLayerButtons();
}

$("layer-toggles").addEventListener("click", (e) => {
  const btn = e.target.closest(".layer-button[data-layer]");
  if (!btn || btn.disabled) return;
  const name = btn.dataset.layer;
  if (!outputMap.hasLayer(name)) {
    const status = $("analysis-status");
    status.classList.remove("error", "loading");
    status.textContent = "Run Step 1 Analysis first, then use these buttons to show or hide each layer.";
    return;
  }
  outputMap.setVisible(name, !outputMap.isVisible(name));
  syncLayerButtons();
});
syncLayerButtons();

/* ----- open / close the picker ----- */
function openPicker() {
  $("overlay").classList.add("open");
  $("overlay").setAttribute("aria-hidden", "false");

  if (!picker) {
    picker = createPickerMap(counties, function (geojson, error, resetSelection) {
      if (resetSelection) {
        applied = null;
        draft = null;
        mini.reset();
        clearOutputLayers();
        clearResult();
        const runStep1Btn = document.getElementById("run-step1-btn");
        if (runStep1Btn) runStep1Btn.disabled = true;
      }
      if (error) {
        draft = null;
        showDraft({ valid: false, error });
        return;
      }
      draft = geojson ? { geojson, result: analyzePolygon(geojson, counties) } : null;
      showDraft(draft && draft.result);
    });
  }
  picker.map.invalidateSize();                 // map was hidden when created
  picker.load(applied ? applied.geojson : null);
  draft = applied;                             // start from what is already applied
  showDraft(draft && draft.result);
}

function closePicker() {
  $("overlay").classList.remove("open");
  $("overlay").setAttribute("aria-hidden", "true");
  $("customToggle").checked = !!applied;       // keep the toggle in sync
}

/* ----- buttons ----- */
$("thumb").addEventListener("click", openPicker);
$("thumb").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } });

// X (or Esc, or clicking the dark background): leave and throw away the unsaved drawing
$("closeBtn").addEventListener("click", closePicker);
$("overlay").addEventListener("mousedown", (e) => { if (e.target === $("overlay")) closePicker(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("overlay").classList.contains("open")) closePicker();
});

// Clear drawing: empties the shape inside the picker (stay open)
$("clearBtn").addEventListener("click", () => picker && picker.clear());

// Apply: keep the drawing, go back to the panel and fill in county + acres
$("applyBtn").addEventListener("click", () => {
  if (!draft || !draft.result.valid) return;
  applied = draft;
  showResult(applied.result);
  mini.show(applied.geojson);
  closePicker();

  // Unlock the Step 1 Run Analysis button once a boundary is successfully applied
  const runStep1Btn = document.getElementById('run-step1-btn');
  if (runStep1Btn) {
    runStep1Btn.disabled = false;
  }
});

// Custom boundary switch: ON opens the picker, OFF clears the applied site
$("customToggle").addEventListener("change", (e) => {
  if (e.target.checked) { openPicker(); }
  else {
    applied = null;
    draft = null;
    clearResult();
    mini.reset();
    clearOutputLayers();

    // Re-lock the Step 1 Run Analysis button if boundary is cleared
    const runStep1Btn = document.getElementById('run-step1-btn');
    if (runStep1Btn) {
      runStep1Btn.disabled = true;
    }
  }
});

/* ----- Step 1 Backend Integration ----- */
document.addEventListener("DOMContentLoaded", () => {
  const runStep1Btn = document.getElementById("run-step1-btn");
  const status = document.getElementById("analysis-status");
  if (!runStep1Btn) return;
  // Protect against accidental duplicate script initialization.
  if (runStep1Btn.dataset.step1HandlerBound === "true") return;
  runStep1Btn.dataset.step1HandlerBound = "true";

  runStep1Btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (runStep1Btn.disabled) return;
    if (!applied || !applied.geojson) {
      status.textContent = "Select a site within Lee County before running the analysis.";
      status.classList.add("error");
      return;
    }

    const thresholdInputs = {
      riparianBuffer: document.getElementById("rip-buffer"),
      drainageBuffer: document.getElementById("drain-buffer"),
      treeCanopy: document.getElementById("tree-canopy"),
      steepSlope: document.getElementById("steep-slope")
    };
    if (Object.values(thresholdInputs).some((input) => !input)) {
      status.textContent = "One or more Step 1 threshold inputs are missing from the page.";
      status.classList.add("error");
      return;
    }
    const thresholdValues = Object.fromEntries(
      Object.entries(thresholdInputs).map(([key, input]) => [key, Number(input.value)])
    );
    if (Object.values(thresholdValues).some((value) => !Number.isFinite(value))) {
      status.textContent = "Enter a valid number for each Step 1 threshold.";
      status.classList.add("error");
      return;
    }
    const payload = { boundary: applied.geojson, thresholds: thresholdValues };

    runStep1Btn.disabled = true;
    runStep1Btn.setAttribute("aria-busy", "true");
    runStep1Btn.textContent = "Processing GIS layers…";
    status.classList.remove("error");
    status.classList.add("loading");
    status.textContent = "Analysis is running. This may take a few minutes…";

    try {
      // Relative URL: the page is served by Flask, so this hits the same host/port.
      console.log("Step 1 request:", { url: "/run-step1", payload });
      const response = await fetch("/run-step1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      console.log("Step 1 response:", {
        status: response.status,
        ok: response.ok,
        body: result
      });

      if (!response.ok || result.status !== "success") {
        throw new Error(result.message || `Analysis failed (HTTP ${response.status}).`);
      }
      const validBounds = Array.isArray(result.bounds) && result.bounds.length === 2 &&
        result.bounds.every((corner) => Array.isArray(corner) && corner.length === 2 &&
          corner.every((coordinate) => Number.isFinite(Number(coordinate))));
      const layerEntries = Object.entries(result.layers || {}).filter(([, url]) => url);
      if (!validBounds || layerEntries.length === 0) {
        throw new Error("The backend response is missing valid map bounds or available output layers.");
      }
      for (const [name, url] of layerEntries) {
        if (typeof url !== "string" || !url.startsWith("/outputs/")) {
          throw new Error(`The ${name} result layer URL must be a site-relative /outputs/ path.`);
        }
      }

      // showLayers passes each URL and these Leaflet bounds to L.imageOverlay.
      outputMap.showLayers(Object.fromEntries(layerEntries), result.bounds, (message) => {
        status.classList.remove("loading");
        status.classList.add("error");
        status.textContent = message;
      });
      layerAcres = result.acres || {};
      syncLayerButtons();
      status.classList.remove("loading");
      status.textContent = "Analysis complete. Result layers are displayed on the map.";
    } catch (error) {
      console.error("Step 1 analysis failed:", error);
      status.classList.remove("loading");
      status.classList.add("error");
      status.textContent = error.message || "Could not complete Step 1 analysis. Check that the Flask server is running.";
    } finally {
      runStep1Btn.removeAttribute("aria-busy");
      runStep1Btn.textContent = "Run Step 1 Analysis";
      runStep1Btn.disabled = !applied;
    }
  });
});
