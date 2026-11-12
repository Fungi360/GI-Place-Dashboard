# app.py
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import geopandas as gpd
import math
from pathlib import Path
from step1_processor import run_step1_analysis

# Serve frontend/ at the site root so index.html's relative paths
# (css/styles.css, js/main.js, data/fl_counties.js) resolve correctly.
app = Flask(__name__, static_folder='frontend', static_url_path='',
            template_folder='frontend')
CORS(app)

ROOT_DIR = Path(__file__).resolve().parent
INPUT_DIR = ROOT_DIR / "Inputs"
INPUT_DIR.mkdir(parents=True, exist_ok=True)
BOUNDARY_FILE = INPUT_DIR / "project_boundary.shp"


@app.route('/')
def index():
    """Serves the main frontend dashboard page."""
    return send_from_directory('frontend', 'index.html')


@app.route('/run-step1', methods=['POST'])
def run_step1():
    try:
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({"status": "error", "message": "Request body must be a JSON object."}), 400
        user_polygon = data.get('boundary')
        thresholds = data.get('thresholds', {})
        if not isinstance(thresholds, dict):
            return jsonify({"status": "error", "message": "Thresholds must be a JSON object."}), 400

        print("=== Received Step 1 Execution Request ===")

        # 1. Save user-drawn polygon and reproject to EPSG:2882
        if user_polygon:
            gdf = gpd.GeoDataFrame.from_features(
                [user_polygon], crs="EPSG:4326")
            gdf = gdf.to_crs("EPSG:2882")

            for ext in [".shp", ".shx", ".dbf", ".prj", ".cpg"]:
                p = BOUNDARY_FILE.with_suffix(ext)
                if p.exists():
                    p.unlink()

            gdf.to_file(BOUNDARY_FILE, driver="ESRI Shapefile")

        # 2. Extract thresholds
        try:
            rip_buf = float(thresholds.get('riparianBuffer', 100))
            drain_buf = float(thresholds.get('drainageBuffer', 100))
            tree_thresh = float(thresholds.get('treeCanopy', 50))
            steep_thresh = float(thresholds.get('steepSlope', 25))
        except (TypeError, ValueError):
            return jsonify({"status": "error", "message": "All thresholds must be numeric."}), 400
        if not all(math.isfinite(value) for value in (rip_buf, drain_buf, tree_thresh, steep_thresh)):
            return jsonify({"status": "error", "message": "All thresholds must be finite numbers."}), 400
        if rip_buf < 0 or drain_buf < 0:
            return jsonify({"status": "error", "message": "Buffer distances cannot be negative."}), 400
        if not (0 <= tree_thresh <= 100 and 0 <= steep_thresh <= 100):
            return jsonify({"status": "error", "message": "Tree canopy and steep slope thresholds must be between 0 and 100%."}), 400

        # 3. Execute GIS workflow
        result = run_step1_analysis(
            rip_buf, drain_buf, tree_thresh, steep_thresh)

        # Keep the full characterization-layer contract stable. Layers not yet
        # produced by the processor are represented as null and skipped by Leaflet.
        expected_layers = ("riparian", "trees", "groundwater",
                           "steep", "drainage", "residual")
        result["layers"] = {
            name: (result.get("layers") or {}).get(name)
            for name in expected_layers
        }

        return jsonify(result)

    except Exception as e:
        print(f"Backend Error: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/outputs/<path:filename>')
def serve_output_file(filename):
    return send_from_directory(ROOT_DIR / "Outputs", filename)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
