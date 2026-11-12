# step1_processor.py
from pathlib import Path
import time
import numpy as np
import geopandas as gpd
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.mask import mask
from rasterio.shutil import copy as copy_raster
from rasterio.features import shapes
from rasterio.transform import Affine, array_bounds
from rasterio.warp import calculate_default_transform, reproject, transform_bounds
from shapely.geometry import box, mapping, shape

SQ_METRES_PER_ACRE = 4046.8564224

# Leaflet's map is in Web Mercator. Overlay PNGs are warped onto an EPSG:3857
# grid so that L.imageOverlay's linear stretch between two lat/lon corners is
# exact (no skew from the EPSG:2882 State Plane grid).
WEB_MERCATOR = "EPSG:3857"

# landcover_NAIP_Coded1.tif class codes (0 = NoData). Verified against
# building footprints, NWI water bodies and Tree_Canopy_Final.tif:
#   1 -> 18% building overlap, 9.5% mean canopy  (impervious)
#   2 -> 48% mean canopy                         (trees / dense vegetation)
#   3 -> 46% NWI open-water overlap, 0% canopy   (open water)
#   4 -> remaining pervious                      (grass / bare soil)
LC_IMPERVIOUS, LC_TREES, LC_WATER, LC_GRASS = 1, 2, 3, 4
LC_PERVIOUS = (LC_TREES, LC_GRASS)

# Hydrologic soil groups treated as groundwater recharge zones ("hy" field of
# Soil_HSG.shp). PLACE defines recharge as HSG A and B. Dual groups (A/D, B/D)
# are D in their undrained state and are excluded by default; add "A/D" and
# "B/D" here to count them by their drained group (~85% of Lee County soils).
RECHARGE_HSG = {"A", "B"}

# FEMA flood zones added to the riparian source features ("optional FEMA
# Zone A" in PLACE). Add "AE" to include detailed-study floodplains as well.
FEMA_RIPARIAN_ZONES = {"A"}

# Output file stems; riparian/groundwater/drainage/residual match the names
# used by the PLACE Step 1 notebook so downstream steps can find them.
LAYER_FILES = {
    "riparian": "riparian_areas",
    "trees": "trees_forests",
    "groundwater": "groundwater_recharge_zones",
    "steep": "steep_slopes",
    "drainage": "natural_drainage_pathways_buffer",
    "residual": "pervious_areas",
}

# RGB per characterization layer; keep in sync with frontend/css/styles.css
LAYER_COLORS = {
    "riparian": (0, 119, 182),
    "trees": (35, 155, 86),
    "groundwater": (72, 202, 228),
    "steep": (158, 61, 31),
    "drainage": (106, 76, 147),
    "residual": (233, 196, 106),
}


def run_step1_analysis(rip_buf, drain_buf, tree_thresh, steep_thresh):
    start_time = time.perf_counter()

    # Explicit path management pointing to root Inputs folder
    ROOT_DIR = Path(__file__).resolve().parent
    DATA_DIR = ROOT_DIR / "Inputs"
    OUT_DIR = ROOT_DIR / "Outputs"
    STEP1_DIR = OUT_DIR / "Step1_Existing_Condition_Characterization"
    LAYER_DIR = STEP1_DIR / "Layers"
    LAYER_DIR.mkdir(parents=True, exist_ok=True)

    BOUNDARY_SHP = DATA_DIR / "project_boundary.shp"
    DEM_TIF = DATA_DIR / "DEM.tif"
    SLOPE_TIF = DATA_DIR / "Slope.tif"
    LANDCOVER_TIF = DATA_DIR / "landcover_NAIP_Coded1.tif"
    PCT_TREE_TIF = DATA_DIR / "Tree_Canopy_Final.tif"
    WETLANDS_SHP = DATA_DIR / "wetlands.shp"
    FEMA_SHP = DATA_DIR / "fema_floodplains.shp"
    DRAIN_LINES_SHP = DATA_DIR / "Natural_Drain_Line_300000.shp"
    SOIL_HSG_SHP = DATA_DIR / "Soil_HSG.shp"

    # Verify input existence
    if not BOUNDARY_SHP.exists():
        raise FileNotFoundError(
            f"Project boundary file not found at {BOUNDARY_SHP}")
    if not DEM_TIF.exists():
        raise FileNotFoundError(
            f"DEM raster not found at {DEM_TIF} inside Inputs folder")

    def clip_raster_in_memory(src_path, boundary_geom):
        with rasterio.open(src_path) as src:
            out_img, out_transform = mask(
                src, [mapping(boundary_geom)], crop=True, filled=True, nodata=src.nodata)
            return out_img[0], out_transform, src.crs, src.nodata

    def align_raster_to_dem(src_path, boundary_geom, dem_shape, dem_transform, dem_crs, resampling=Resampling.nearest, dst_dtype="float32", dst_nodata=0):
        if src_path is None or not Path(src_path).exists():
            return None
        src_arr, src_transform, src_crs, src_nodata = clip_raster_in_memory(
            src_path, boundary_geom)
        destination = np.full(dem_shape, dst_nodata, dtype=np.dtype(dst_dtype))
        reproject(
            source=src_arr, destination=destination, src_transform=src_transform, src_crs=src_crs,
            dst_transform=dem_transform, dst_crs=dem_crs, resampling=resampling, src_nodata=src_nodata, dst_nodata=dst_nodata
        )
        return destination

    def write_geotiff(path, array, transform, crs, nodata=0, dtype="uint8"):
        profile = {"driver": "GTiff", "height": array.shape[0], "width": array.shape[1], "count": 1,
                   "dtype": dtype, "crs": crs, "transform": transform, "nodata": nodata, "compress": "lzw"}
        path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(path, "w", **profile) as dst:
            dst.write(array.astype(dtype), 1)

    def mercator_grid(height, width, transform, crs):
        """Web Mercator grid covering the analysis grid, plus its Leaflet bounds.

        The bounds are derived from the *output grid* (not the boundary polygon),
        so they line up with the PNG pixels exactly.
        """
        src_bounds = array_bounds(height, width, transform)
        dst_transform, dst_width, dst_height = calculate_default_transform(
            crs, WEB_MERCATOR, width, height, *src_bounds)
        west, south, east, north = transform_bounds(
            WEB_MERCATOR, "EPSG:4326",
            *array_bounds(dst_height, dst_width, dst_transform))
        return {
            "transform": dst_transform,
            "shape": (dst_height, dst_width),
            "leaflet_bounds": [[south, west], [north, east]],
        }

    def write_overlay_png(path, mask_array, color, transform, crs, grid):
        # Warp the 0/1 mask onto the Web Mercator grid (nearest keeps it binary).
        # Leave src_nodata/dst_nodata at their defaults: passing
        # src_nodata=None, dst_nodata=0 explicitly fills nearly the whole grid with 1.
        merc_mask = np.zeros(grid["shape"], dtype=np.uint8)
        reproject(
            source=mask_array.astype(np.uint8), destination=merc_mask,
            src_transform=transform, src_crs=crs,
            dst_transform=grid["transform"], dst_crs=WEB_MERCATOR,
            resampling=Resampling.nearest)

        rgba = np.zeros((4, *merc_mask.shape), dtype=np.uint8)
        for band, channel in enumerate(color):
            rgba[band] = channel
        rgba[3] = np.where(merc_mask > 0, 210, 0).astype(np.uint8)
        profile = {
            "driver": "GTiff",
            "height": merc_mask.shape[0],
            "width": merc_mask.shape[1],
            "count": 4,
            "dtype": "uint8",
            "transform": grid["transform"],
            "crs": WEB_MERCATOR
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        with MemoryFile() as memory_file:
            with memory_file.open(**profile) as dst:
                dst.write(rgba)
                dst.colorinterp = (
                    ColorInterp.red, ColorInterp.green,
                    ColorInterp.blue, ColorInterp.alpha
                )
            with memory_file.open() as source:
                copy_raster(source, path, driver="PNG")

    # 1. Read boundary and DEM grid setup
    boundary_gdf = gpd.read_file(BOUNDARY_SHP)
    boundary_geom = boundary_gdf.geometry.union_all()
    good_crs = boundary_gdf.crs

    dem_clip, dem_transform, _, _ = clip_raster_in_memory(
        DEM_TIF, boundary_geom)
    height, width = dem_clip.shape
    dem_crs = rasterio.crs.CRS.from_user_input(good_crs)

    # One Web Mercator display grid shared by every overlay; its corners (in
    # lat/lon) are the bounds Leaflet's L.imageOverlay needs.
    overlay_grid = mercator_grid(height, width, dem_transform, dem_crs)
    leaflet_bounds = overlay_grid["leaflet_bounds"]

    boundary_mask = rasterize([(mapping(boundary_geom), 1)], out_shape=(
        height, width), transform=dem_transform, fill=0, dtype="uint8").astype(np.uint8)

    # ---- Grid / unit helpers -------------------------------------------------
    cell_size = abs(dem_transform.a)
    _, metres_per_unit = dem_crs.linear_units_factor   # EPSG:2882 -> US survey ft
    cell_acres = abs(dem_transform.a * dem_transform.e) * \
        metres_per_unit ** 2 / SQ_METRES_PER_ACRE

    def ft_to_crs(feet):
        """Thresholds arrive in international feet; convert to CRS linear units."""
        return feet * 0.3048 / metres_per_unit

    def read_vector(path, clip_geom):
        """Features from path that intersect clip_geom, in the analysis CRS."""
        if not path.exists():
            return None
        bbox = gpd.GeoSeries([box(*clip_geom.bounds)], crs=boundary_gdf.crs)
        gdf = gpd.read_file(path, bbox=bbox)
        if gdf.empty:
            return gdf
        if gdf.crs != boundary_gdf.crs:
            gdf = gdf.to_crs(boundary_gdf.crs)
        return gdf[gdf.geometry.notna() & gdf.intersects(clip_geom)]

    def burn(geoms, all_touched=False):
        """Rasterize geometries onto the DEM analysis grid as a 0/1 mask."""
        geoms = [g for g in geoms if g is not None and not g.is_empty]
        if not geoms:
            return np.zeros((height, width), dtype=np.uint8)
        return rasterize(((mapping(g), 1) for g in geoms), out_shape=(height, width),
                         transform=dem_transform, fill=0, dtype="uint8",
                         all_touched=all_touched)

    def buffered_mask(geoms, buffer_ft):
        """Source features plus a buffer of buffer_ft feet, as a 0/1 mask.

        Buffering is done in vector space (exact distances, no scipy needed);
        sources just outside the site still contribute their buffer inside it.
        """
        geoms = gpd.GeoSeries(list(geoms), crs=boundary_gdf.crs)
        if buffer_ft > 0:
            return burn(geoms.buffer(ft_to_crs(buffer_ft), resolution=8))
        # Zero buffer: keep thin features (drainage lines) visible.
        return burn(geoms, all_touched=True)

    # ---- 2. Characterization layers -----------------------------------------
    layer_urls = {name: None for name in LAYER_FILES}
    layer_acres = {name: None for name in LAYER_FILES}
    layer_masks = {}

    def save_layer(name, layer_mask):
        """Clip to the site, then write <stem>.tif (analysis) + <stem>.png (map)."""
        layer_mask = ((layer_mask > 0) & (boundary_mask == 1)).astype(np.uint8)
        stem = LAYER_FILES[name]
        write_geotiff(LAYER_DIR / f"{stem}.tif", layer_mask, dem_transform, dem_crs)
        png_path = LAYER_DIR / f"{stem}.png"
        write_overlay_png(png_path, layer_mask, LAYER_COLORS[name],
                          dem_transform, dem_crs, overlay_grid)
        layer_masks[name] = layer_mask
        layer_urls[name] = png_path
        layer_acres[name] = round(float(layer_mask.sum()) * cell_acres, 1)

    # Land cover is read once on a grid padded by the riparian buffer, so open
    # water just outside the site can still buffer into it. The padded grid is
    # an integer-pixel shift of the DEM grid, so the site grid is a plain slice.
    rip_reach = ft_to_crs(rip_buf) + 2 * cell_size
    rip_clip = boundary_geom.buffer(rip_reach)
    pad = int(np.ceil(rip_reach / cell_size))
    pad_transform = dem_transform * Affine.translation(-pad, -pad)
    landcover_pad = align_raster_to_dem(
        LANDCOVER_TIF, rip_clip, (height + 2 * pad, width + 2 * pad),
        pad_transform, dem_crs, Resampling.mode, "uint8", 0)
    landcover = (landcover_pad[pad:pad + height, pad:pad + width]
                 if landcover_pad is not None else None)

    # Trees / forests: percent canopy above threshold.
    tree_canopy = align_raster_to_dem(PCT_TREE_TIF, boundary_geom, (
        height, width), dem_transform, dem_crs, Resampling.nearest, "float32", 0)
    if tree_canopy is not None:
        save_layer("trees", tree_canopy > tree_thresh)

    # Steep slopes: percent slope above threshold.
    slope = align_raster_to_dem(SLOPE_TIF, boundary_geom, (height, width),
                                dem_transform, dem_crs, Resampling.nearest, "float32", 0)
    if slope is not None:
        save_layer("steep", slope > steep_thresh)

    # Riparian areas: NAIP open water + NWI wetlands (+ FEMA Zone A), buffered.
    riparian_sources = []
    have_riparian_input = False
    if landcover_pad is not None:
        have_riparian_input = True
        water = (landcover_pad == LC_WATER).astype(np.uint8)
        riparian_sources += [shape(geom) for geom, _ in shapes(
            water, mask=water.astype(bool), transform=pad_transform)]
    wetlands = read_vector(WETLANDS_SHP, rip_clip)
    if wetlands is not None:
        have_riparian_input = True
        riparian_sources += list(wetlands.geometry)
    floodplains = read_vector(FEMA_SHP, rip_clip)
    if floodplains is not None and "FLD_ZONE" in floodplains:
        riparian_sources += list(floodplains.loc[
            floodplains["FLD_ZONE"].isin(FEMA_RIPARIAN_ZONES)].geometry)
    if have_riparian_input:
        save_layer("riparian", buffered_mask(riparian_sources, rip_buf))

    # Drainage pathways: natural drainage lines, buffered.
    drain_clip = boundary_geom.buffer(ft_to_crs(drain_buf) + 2 * cell_size)
    drain_lines = read_vector(DRAIN_LINES_SHP, drain_clip)
    if drain_lines is not None:
        save_layer("drainage", buffered_mask(drain_lines.geometry, drain_buf))

    # Groundwater recharge: HSG A/B soils on pervious (non-impervious,
    # non-water) land cover.
    soils = read_vector(SOIL_HSG_SHP, boundary_geom)
    if soils is not None and landcover is not None and "hy" in soils:
        recharge_soils = soils.loc[soils["hy"].isin(RECHARGE_HSG)].geometry
        save_layer("groundwater",
                   (burn(recharge_soils) == 1) & np.isin(landcover, LC_PERVIOUS))

    # Residual pervious: pervious land cover not claimed by any other layer.
    if landcover is not None:
        claimed = np.zeros((height, width), dtype=bool)
        for other in layer_masks.values():
            claimed |= other.astype(bool)
        save_layer("residual", np.isin(landcover, LC_PERVIOUS) & ~claimed)

    print(
        f"Step 1 analysis completed in {time.perf_counter() - start_time:.2f}s")

    # Site-relative URLs consumed by Leaflet's L.imageOverlay. The ?v= query
    # changes on every run so the browser never shows a cached overlay from a
    # previous analysis (the PNG file names are reused).
    run_version = int(time.time() * 1000)
    layer_urls = {
        name: (f"/outputs/{path.relative_to(OUT_DIR).as_posix()}?v={run_version}"
               if path else None)
        for name, path in layer_urls.items()
    }

    return {
        "status": "success",
        "bounds": leaflet_bounds,
        "layers": layer_urls,
        "acres": layer_acres
    }
