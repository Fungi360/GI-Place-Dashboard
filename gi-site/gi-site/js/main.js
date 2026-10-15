// main.js - connects the panel, the preview map, the picker and the geometry logic.
//
//  applied = the site shown in the panel (what the rest of the dashboard will use)
//  draft   = the shape being drawn inside the open picker (not applied yet)

const counties = window.FL_COUNTIES;
let applied = null;   // { geojson, result } | null
let draft = null;     // { geojson, result } | null
let picker = null;    // created the first time the overlay opens

initCountyDropdown(counties);
const mini = createMiniMap(counties);

/* ----- open / close the picker ----- */
function openPicker() {
  $("overlay").classList.add("open");
  $("overlay").setAttribute("aria-hidden", "false");

  if (!picker) {
    picker = createPickerMap(counties, function (geojson) {
      draft = geojson ? { geojson, result: analyzePolygon(geojson, counties) } : null;
      showDraft(draft && draft.result);
    });
  }
  picker.map.invalidateSize();               // map was hidden when created
  picker.load(applied ? applied.geojson : null);
  draft = applied;                           // start from what is already applied
  showDraft(draft && draft.result);
}

function closePicker() {
  $("overlay").classList.remove("open");
  $("overlay").setAttribute("aria-hidden", "true");
  $("customToggle").checked = !!applied;     // keep the toggle in sync
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
  if (!draft) return;
  applied = draft;
  showResult(applied.result);
  mini.show(applied.geojson);
  closePicker();
});

// Custom boundary switch: ON opens the picker, OFF clears the applied site
$("customToggle").addEventListener("change", (e) => {
  if (e.target.checked) { openPicker(); }
  else { applied = null; draft = null; clearResult(); mini.reset(); }
});
