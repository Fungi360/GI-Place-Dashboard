from flask import Flask, request, jsonify
from flask_cors import CORS  # Allows communication between your frontend and backend
import geopandas as gpd
from pathlib import Path

app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing for local development

# Ensure input directories exist matching your project structure
INPUT_DIR = Path("Inputs")
INPUT_DIR.mkdir(parents=True, exist_ok=True)
BOUNDARY_FILE = INPUT_DIR / "PROJECT_BOUNDARY.shp"


@app.route('/run-analysis', methods=['POST'])
def run_analysis():
    try:
        data = request.json
        user_polygon = data.get('boundary')
        params = data.get('parameters', {})

        print("=== Received User Selection from Frontend ===")
        print(f"Parameters: {params}")

        if not user_polygon or not user_polygon.get('geometry'):
            return jsonify({"status": "error", "message": "No valid polygon boundary provided."}), 400

        # 1. Convert incoming Leaflet GeoJSON polygon to a GeoDataFrame
        gdf = gpd.GeoDataFrame.from_features([user_polygon], crs="EPSG:4326")

        # 2. Standardize CRS to EPSG:2882 (Florida West, ftUS) as specified in your PLACE notebook
        gdf = gdf.to_crs("EPSG:2882")

        # 3. Clean and overwrite the study boundary shapefile
        for ext in [".shp", ".shx", ".dbf", ".prj", ".cpg"]:
            p = BOUNDARY_FILE.with_suffix(ext)
            if p.exists():
                p.unlink()

        gdf.to_file(BOUNDARY_FILE, driver="ESRI Shapefile")
        print(
            f"Successfully updated study boundary shapefile at: {BOUNDARY_FILE}")

        # 4. [Next Step]: Trigger your Python data processing / notebook logic here
        # e.g., run_binary_feasibility_screening(params['runoffSource'], params['bmpType'], params['maxSlope'])

        # 5. Return success and a mock/actual output layer response for Leaflet
        return jsonify({
            "status": "success",
            "message": "Boundary clipped and parameter pipeline initiated successfully.",
            "outputLayerUrl": "/get-results/priority-map.geojson"
        })

    except Exception as e:
        print(f"Error handling analysis request: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
