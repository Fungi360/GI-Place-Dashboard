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

document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById('parameters-container');

    // 1. Define the relationship mapping (Slide 11 logic)
    const bmpMapping = {
        "Roof": ["Green roof", "Bioretention", "Rainwater harvesting", "Trees"],
        "Parking/Road": ["Bioswales", "Bioretention", "Trees", "Infiltration trench", "Pervious pavement"],
        "Pervious surface": ["Bioswales", "Trees", "Infiltration trench", "Constructed wetland", "Dry pond", "Infiltration basin", "Wet pond"]
    };

    // 2. Build the HTML structure dynamically
    container.innerHTML = `
        <div class="field mt-2">
            <label for="runoff-source">1. Runoff Source</label>
            <select id="runoff-source" class="form-control">
                <option value="" disabled selected>Select runoff source...</option>
                <option value="Roof">Roof</option>
                <option value="Parking/Road">Parking / Road</option>
                <option value="Pervious surface">Pervious surface</option>
            </select>
        </div>

        <div class="field mt-2">
            <label for="bmp-type">2. BMP Type</label>
            <select id="bmp-type" class="form-control" disabled>
                <option value="" disabled selected>Select runoff source first...</option>
            </select>
        </div>

        <div class="field mt-2">
            <label for="storm-event">3. Storm Event</label>
            <select id="storm-event" class="form-control" disabled>
                <option value="" disabled selected>Select BMP type first...</option>
                <option value="10-year (24-hr)">10-year (24-hr)</option>
                <option value="25-year (24-hr)">25-year (24-hr)</option>
                <option value="100-year (24-hr)">100-year (24-hr)</option>
            </select>
        </div>

        <div id="feasibility-settings" class="settings-box disabled-section mt-3">
            <h4>Step 2: Feasibility Settings</h4>
            <div class="field mt-2">
                <label>Max slope (%): <span id="slope-val">5</span></label>
                <input type="range" id="max-slope" min="1" max="20" value="5" disabled class="form-control-range" />
            </div>
            <div class="field mt-2">
                <label>Min groundwater depth (ft): <span id="gw-val">3</span></label>
                <input type="range" id="min-gw" min="1" max="10" value="3" disabled class="form-control-range" />
            </div>
        </div>

        <button id="apply-analysis-btn" class="btn primary mt-3" style="width: 100%;" disabled>Apply Analysis</button>
    `;

    // 3. Attach your event listeners for the sequential logic right after generation
    const runoffSourceSelect = document.getElementById('runoff-source');
    const bmpTypeSelect = document.getElementById('bmp-type');
    const stormEventSelect = document.getElementById('storm-event');
    const maxSlopeSlider = document.getElementById('max-slope');
    const minGwSlider = document.getElementById('min-gw');
    const feasibilityBox = document.getElementById('feasibility-settings');
    const applyBtn = document.getElementById('apply-analysis-btn');

    runoffSourceSelect.addEventListener('change', function() {
        const selectedSource = this.value;
        bmpTypeSelect.innerHTML = '<option value="" disabled selected>Select BMP type...</option>';
        stormEventSelect.selectedIndex = 0;
        stormEventSelect.disabled = true;
        feasibilityBox.classList.add('disabled-section');
        maxSlopeSlider.disabled = true;
        minGwSlider.disabled = true;
        applyBtn.disabled = true;

        if (selectedSource && bmpMapping[selectedSource]) {
            bmpTypeSelect.disabled = false;
            bmpMapping[selectedSource].forEach(bmp => {
                const opt = document.createElement('option');
                opt.value = bmp;
                opt.textContent = bmp;
                bmpTypeSelect.appendChild(opt);
            });
        }
    });

    bmpTypeSelect.addEventListener('change', () => { if(bmpTypeSelect.value) stormEventSelect.disabled = false; });
    stormEventSelect.addEventListener('change', () => { 
        if(stormEventSelect.value) {
            feasibilityBox.classList.remove('disabled-section');
            maxSlopeSlider.disabled = false;
            minGwSlider.disabled = false;
            applyBtn.disabled = false;
        }
    });

    maxSlopeSlider.addEventListener('input', (e) => document.getElementById('slope-val').textContent = e.target.value);
    minGwSlider.addEventListener('input', (e) => document.getElementById('gw-val').textContent = e.target.value);
});