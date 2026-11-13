"""Declarative inputs for the ArtemisTwin screening model.

Everything here is an *input*, not a result. Target values are deliberately
called "envelopes": they describe the range a screening exercise wants to stand
in for, not a measurement of one landing site. Earth values come from the ETL
scripts and carry their own provenance in ``provenance.json``.

Scientific guardrails encoded in this file
------------------------------------------
* Absolute elevation is never compared across bodies. ``L1_elevation`` is scored
  on **local relief** inside the same 2 x 2 km footprint on both sides.
* Surface pressure is marked ``excluded`` for Moon and Mars targets: no Earth
  surface site can reproduce 0 kPa or 0.6 kPa. It is reported, never scored.
* Layers whose Earth measurement is an approximation are marked ``proxy`` and
  receive a 0.5 weight multiplier.
* A missing Earth value is never imputed as zero. It lowers Data Completeness
  and is listed by name.
"""
from __future__ import annotations

# --------------------------------------------------------------------------- #
# Catalog sites (ids match site/data/catalog.json so the existing UI can bind)
# --------------------------------------------------------------------------- #
SITES = [
    {
        "site_id": "atacama",
        "site_name": "Atacama Desert",
        "country": "Chile",
        "region": "Atacama",
        "lat": -23.86,
        "lon": -67.98,
        "half_km": 1.0,
        "catalog_id": "atacama",
        "window_label": "2 × 2 km screening window, Atacama Desert",
        "note": "Hyper-arid desert window; catalog region has no official study boundary.",
    },
    {
        "site_id": "haughton",
        "site_name": "Haughton Impact Crater",
        "country": "Canada",
        "region": "Devon Island, Nunavut",
        "lat": 75.38,
        "lon": -75.40,
        "half_km": 1.0,
        "catalog_id": "haughton",
        "window_label": "2 × 2 km screening window, Haughton Crater",
        "note": "Polar desert impact structure; regional catalog entry.",
    },
    {
        "site_id": "svalbard",
        "site_name": "Svalbard (Adventdalen)",
        "country": "Norway",
        "region": "Svalbard",
        "lat": 78.20,
        "lon": 15.83,
        "half_km": 1.0,
        "catalog_id": "svalbard",
        "window_label": "2 × 2 km screening window, Adventdalen",
        "note": "High-Arctic valley floor; regional catalog entry.",
    },
    {
        "site_id": "mcmurdo",
        "site_name": "McMurdo Dry Valleys",
        "country": "Antarctica",
        "region": "Wright Valley",
        "lat": -77.60,
        "lon": 162.60,
        "half_km": 1.0,
        "catalog_id": "mcmurdo",
        "window_label": "2 × 2 km screening window, Wright Valley",
        "note": "Cold desert valley; regional catalog entry.",
    },
    {
        "site_id": "riotinto",
        "site_name": "Rio Tinto basin",
        "country": "Spain",
        "region": "Huelva",
        "lat": 37.69,
        "lon": -6.55,
        "half_km": 1.0,
        "catalog_id": "riotinto",
        "window_label": "2 × 2 km screening window, Rio Tinto",
        "note": "Acid-mine drainage terrain; regional catalog entry.",
    },
    {
        "site_id": "hawaii",
        "site_name": "Hawaiʻi volcanic terrain",
        "country": "USA (Hawaiʻi)",
        "region": "Kīlauea",
        "lat": 19.42,
        "lon": -155.28,
        "half_km": 1.0,
        "catalog_id": "hawaii",
        "window_label": "2 × 2 km screening window, Kīlauea summit area",
        "note": "Basaltic volcanic terrain; regional catalog entry.",
    },
    {
        "site_id": "mauna_ulu_window",
        "site_name": "Mauna Ulu area, Hawaiʻi",
        "country": "USA (Hawaiʻi)",
        "region": "Mauna Ulu",
        "lat": 19.359699,
        "lon": -155.200078,
        "half_km": 1.0,
        "catalog_id": "mauna_ulu_window",
        "window_label": "2 × 2 km bounded study window, Mauna Ulu",
        "note": "Catalog's existing bounded study window, re-used here for continuity.",
    },
]

# --------------------------------------------------------------------------- #
# Layer registry (ids match the brief; one row per published CSV record)
# --------------------------------------------------------------------------- #
LAYERS = [
    {
        "layer_id": "L1",
        "layer_key": "L1_elevation",
        "layer_name": "Relief & elevation",
        "planetary_source": "LRO LOLA / MGS MOLA",
        "earth_source": "AWS Terrain Tiles (Terrarium) composite",
        "unit": "m",
        "category": "Terrain",
        "comparability": "direct",
        "basis": "Local relief (max − min) inside the 2 × 2 km footprint; absolute elevation kept as context only.",
    },
    {
        "layer_id": "L2",
        "layer_key": "L2_slope",
        "layer_name": "Slope",
        "planetary_source": "Derived LOLA / MOLA",
        "earth_source": "Derived from Terrarium DEM (Horn 3×3)",
        "unit": "degrees",
        "category": "Terrain",
        "comparability": "direct",
        "basis": "Mean slope over the footprint at the sampled grid.",
    },
    {
        "layer_id": "L3",
        "layer_key": "L3_roughness",
        "layer_name": "Roughness (TRI)",
        "planetary_source": "Derived LOLA / MOLA",
        "earth_source": "Derived from Terrarium DEM (Riley 1999)",
        "unit": "index",
        "category": "Terrain",
        "comparability": "direct",
        "basis": "Terrain Ruggedness Index, dimensionless (metres of neighbour difference per cell metre).",
    },
    {
        "layer_id": "L4_max",
        "layer_key": "L4_temperature_max",
        "layer_name": "Surface temperature, warm month",
        "planetary_source": "LRO Diviner / THEMIS",
        "earth_source": "NASA POWER Earth skin temperature (TS) climatology",
        "unit": "Celsius",
        "category": "Thermal",
        "comparability": "proxy",
        "basis": "Warmest monthly climatological skin temperature. Air temperature is not surface temperature; flagged as a proxy.",
    },
    {
        "layer_id": "L4_min",
        "layer_key": "L4_temperature_min",
        "layer_name": "Surface temperature, cold month",
        "planetary_source": "LRO Diviner / THEMIS",
        "earth_source": "NASA POWER Earth skin temperature (TS) climatology",
        "unit": "Celsius",
        "category": "Thermal",
        "comparability": "proxy",
        "basis": "Coldest monthly climatological skin temperature; proxy for surface radiant temperature.",
    },
    {
        "layer_id": "L5",
        "layer_key": "L5_solar_illumination",
        "layer_name": "Solar irradiance",
        "planetary_source": "NASA SPICE / Diviner illumination models",
        "earth_source": "NASA POWER ALLSKY_SFC_SW_DWN climatology",
        "unit": "W/m^2",
        "category": "Illumination",
        "comparability": "proxy",
        "basis": "Annual mean all-sky shortwave downward irradiance, converted from kWh/m²/day.",
    },
    {
        "layer_id": "L6",
        "layer_key": "L6_surface_pressure",
        "layer_name": "Surface pressure",
        "planetary_source": "Vacuum / Viking / MSL",
        "earth_source": "NASA POWER PS climatology",
        "unit": "kPa",
        "category": "Atmospheric",
        "comparability": "excluded",
        "basis": "Reported for context. Excluded from the fit because no Earth surface site reproduces a lunar vacuum or the ~0.6 kPa Martian atmosphere.",
    },
    {
        "layer_id": "L7",
        "layer_key": "L7_ice_volatiles",
        "layer_name": "Ice & volatiles",
        "planetary_source": "LEND / SHARAD / MRO",
        "earth_source": "Not acquired (SMAP / MODIS snow not wired in this build)",
        "unit": "VWE %",
        "category": "Volatiles",
        "comparability": "proxy",
        "basis": "Water-equivalent percentage. No Earth value in this build; shown as a named gap.",
    },
    {
        "layer_id": "L8",
        "layer_key": "L8_mineralogy",
        "layer_name": "Mineralogy index",
        "planetary_source": "M3 / CRISM",
        "earth_source": "Not acquired (EMIT / ASTER not wired in this build)",
        "unit": "index",
        "category": "Geology",
        "comparability": "proxy",
        "basis": "Normalised spectral index. No Earth value in this build; shown as a named gap.",
    },
    {
        "layer_id": "L9",
        "layer_key": "L9_dust_hazard",
        "layer_name": "Dust & wind hazard",
        "planetary_source": "PDS dust opacity / MERRA-2",
        "earth_source": "NASA POWER AOD_55 climatology",
        "unit": "index",
        "category": "Atmospheric",
        "comparability": "proxy",
        "basis": "Aerosol optical depth at 550 nm mapped to 0–1 by min(1, AOD/0.8). A haze proxy, not a regolith-abrasion measurement.",
    },
    {
        "layer_id": "L10",
        "layer_key": "L10_rock_abundance",
        "layer_name": "Rock abundance",
        "planetary_source": "LROC / HiRISE",
        "earth_source": "Not acquired (needs field survey or high-resolution imagery)",
        "unit": "% coverage",
        "category": "Hazards",
        "comparability": "proxy",
        "basis": "Percent rock cover. No Earth value in this build; shown as a named gap.",
    },
    {
        "layer_id": "L11",
        "layer_key": "L11_cave_proximity",
        "layer_name": "Cave proximity",
        "planetary_source": "LROC pits / GRAIL",
        "earth_source": "Not acquired (OSM cave entrances not queried)",
        "unit": "km",
        "category": "Subterranean",
        "comparability": "proxy",
        "basis": "Distance to nearest documented cave or lava-tube entrance. No Earth value in this build.",
    },
    {
        "layer_id": "L12",
        "layer_key": "L12_access",
        "layer_name": "Access & operational gates",
        "planetary_source": "N/A",
        "earth_source": "Not acquired (WDPA / OSM not queried)",
        "unit": "km to road",
        "category": "Logistics",
        "comparability": "context",
        "basis": "Context column only; weight 0 in every purpose so logistics never moves the fit score.",
    },
]

LAYER_BY_KEY = {layer["layer_key"]: layer for layer in LAYERS}
SCORED_KEYS = [layer["layer_key"] for layer in LAYERS if layer["comparability"] != "context"]

# CSV column names, kept compatible with the brief's sites.csv layout.
SITE_COLUMNS = {
    "L1_elevation": "L1_relief_m",
    "L2_slope": "L2_slope_mean",
    "L3_roughness": "L3_roughness_mean",
    "L4_temperature_max": "L4_temp_max",
    "L4_temperature_min": "L4_temp_min",
    "L5_solar_illumination": "L5_solar_mean",
    "L6_surface_pressure": "L6_pressure_mean",
    "L7_ice_volatiles": "L7_ice_moisture_mean",
    "L8_mineralogy": "L8_mineral_idx",
    "L9_dust_hazard": "L9_dust_idx",
    "L10_rock_abundance": "L10_rock_abundance",
    "L11_cave_proximity": "L11_cave_dist_km",
    "L12_access": "L12_access_road_km",
}

# --------------------------------------------------------------------------- #
# Target envelopes
# --------------------------------------------------------------------------- #
SOURCE_NOTES = {
    "nssdc_moon": {
        "title": "Moon Fact Sheet",
        "publisher": "NASA NSSDCA",
        "url": "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html",
    },
    "nssdc_mars": {
        "title": "Mars Fact Sheet",
        "publisher": "NASA NSSDCA",
        "url": "https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html",
    },
    "diviner": {
        "title": "Global surface temperatures of the Moon from Diviner (Williams et al., 2017, Icarus 283)",
        "publisher": "NASA JPL / Diviner Lunar Radiometer Experiment",
        "url": "https://doi.org/10.1016/j.icarus.2016.08.012",
    },
    "lola": {
        "title": "Improved LOLA elevation maps for lunar south pole landing sites (Barker et al., 2021)",
        "publisher": "NASA GSFC / PGDA",
        "url": "https://pgda.gsfc.nasa.gov/products/78",
    },
    "mola": {
        "title": "Mars Orbiter Laser Altimeter topography (Smith et al., 2001, JGR)",
        "publisher": "NASA MGS / MOLA",
        "url": "https://pds-geosciences.wustl.edu/missions/mgs/mola.html",
    },
    "arcadia": {
        "title": "Arcadia Planitia ice-plain screening envelope — analyst-set pending study-area review",
        "publisher": "ArtemisTwin team (not a published measurement)",
        "url": "https://www.nasa.gov/mission/artemis/",
    },
    "marius": {
        "title": "Marius Hills pit thermal context — analyst-set envelope from Diviner pit studies",
        "publisher": "ArtemisTwin team (not a published measurement)",
        "url": "https://lroc.im-ldi.com/images/78",
    },
}


def _layer(value, tol, unit, comparability, source, note, basis):
    return {
        "target_val": value,
        "tolerance": tol,
        "unit": unit,
        "comparability": comparability,
        "source": source,
        "note": note,
        "basis": basis,
    }


TARGETS = [
    {
        "target_id": "moon_south_pole_ridge",
        "target_name": "Moon South-Pole Ridge",
        "body": "Moon",
        "catalog_id": "moon_south_pole_ridge",
        "status": "screening envelope, not a site selection",
        "study_area": "Connecting Ridge window context (LOLA south polar stereographic)",
        "envelope_note": "Values describe a south-polar ridge screening envelope. They are not a measurement of one pixel and do not select a landing site.",
        "layers": {
            "L1_elevation": _layer(180, 300, "m", "direct", "lola", "Local relief of the ridge window.", "relief"),
            "L2_slope": _layer(15.0, 10.0, "deg", "direct", "lola", "Ridge flanks and adjacent cratered ground.", "mean slope"),
            "L3_roughness": _layer(0.35, 0.30, "index", "direct", "lola", "Normalised screening roughness envelope.", "TRI/cell"),
            "L4_temperature_max": _layer(-40.0, 35.0, "C", "proxy", "diviner", "Sunlit polar ridge warm-season value.", "warm-month skin temperature"),
            "L4_temperature_min": _layer(-190.0, 40.0, "C", "proxy", "diviner", "Cold-season polar value; PSR floors are colder still.", "cold-month skin temperature"),
            "L5_solar_illumination": _layer(25.0, 30.0, "W/m^2", "proxy", "lola", "Low-Sun polar illumination envelope.", "annual mean irradiance"),
            "L6_surface_pressure": _layer(0.0, 0.1, "kPa", "excluded", "nssdc_moon", "Vacuum. Earth cannot reproduce this at a surface site.", "pressure"),
            "L7_ice_volatiles": _layer(0.05, 0.10, "VWE %", "proxy", "lola", "Possible polar volatiles; no Earth value acquired.", "water-equivalent"),
            "L8_mineralogy": _layer(0.85, 0.25, "index", "proxy", "lola", "Anorthositic highland index; no Earth value acquired.", "spectral index"),
            "L9_dust_hazard": _layer(0.15, 0.30, "index", "proxy", "nssdc_moon", "No aeolian dust; regolith abrasion is a separate hazard.", "AOD-equivalent index"),
            "L10_rock_abundance": _layer(15.0, 15.0, "%", "proxy", "lola", "Screening rock-cover envelope; no Earth value acquired.", "rock cover"),
            "L11_cave_proximity": _layer(10.0, 20.0, "km", "proxy", "lola", "Distance to a candidate pit or tube; no Earth value acquired.", "distance"),
            "L12_access": _layer(0.0, 0.0, "km", "context", "nssdc_moon", "Not a field site; context only.", "access"),
        },
    },
    {
        "target_id": "moon_lava_tube_region",
        "target_name": "Moon Lava-Tube Region",
        "body": "Moon",
        "catalog_id": "moon_lava_tube_region",
        "status": "screening envelope, not a site selection",
        "study_area": "Marius Hills pit context (no bounded study area adopted)",
        "envelope_note": "Pit-interior envelope. The shaded pit floor is thermally buffered; the surrounding mare surface is far hotter.",
        "layers": {
            "L1_elevation": _layer(60.0, 150.0, "m", "direct", "marius", "Pit and surrounding relief envelope.", "relief"),
            "L2_slope": _layer(8.0, 8.0, "deg", "direct", "marius", "Mare surface with pit walls.", "mean slope"),
            "L3_roughness": _layer(0.45, 0.35, "index", "direct", "marius", "Rough mare and pit rim.", "TRI/cell"),
            "L4_temperature_max": _layer(0.0, 40.0, "C", "proxy", "diviner", "Buffered pit-interior warm value.", "warm-month skin temperature"),
            "L4_temperature_min": _layer(-40.0, 40.0, "C", "proxy", "diviner", "Buffered pit-interior cold value.", "cold-month skin temperature"),
            "L5_solar_illumination": _layer(5.0, 20.0, "W/m^2", "proxy", "diviner", "Largely shadowed pit interior.", "annual mean irradiance"),
            "L6_surface_pressure": _layer(0.0, 0.1, "kPa", "excluded", "nssdc_moon", "Vacuum. Earth cannot reproduce this at a surface site.", "pressure"),
            "L7_ice_volatiles": _layer(0.02, 0.05, "VWE %", "proxy", "marius", "Possible cold-trap ice; no Earth value acquired.", "water-equivalent"),
            "L8_mineralogy": _layer(0.70, 0.25, "index", "proxy", "marius", "Basaltic mare index; no Earth value acquired.", "spectral index"),
            "L9_dust_hazard": _layer(0.10, 0.20, "index", "proxy", "nssdc_moon", "No aeolian dust.", "AOD-equivalent index"),
            "L10_rock_abundance": _layer(20.0, 20.0, "%", "proxy", "marius", "Rim and floor rock cover; no Earth value acquired.", "rock cover"),
            "L11_cave_proximity": _layer(1.0, 5.0, "km", "proxy", "marius", "Pit entrance is the target itself; no Earth value acquired.", "distance"),
            "L12_access": _layer(0.0, 0.0, "km", "context", "marius", "Not a field site; context only.", "access"),
        },
    },
    {
        "target_id": "mars_ice_plain",
        "target_name": "Mars Ice Plain (Arcadia Planitia context)",
        "body": "Mars",
        "catalog_id": "mars_ice_plain",
        "status": "screening envelope, not a site selection",
        "study_area": "Mid-latitude plains with buried ice (no bounded study area adopted)",
        "envelope_note": "Mid-latitude ice-plain envelope. It is analyst-set from published mission context; it does not select a landing site.",
        "layers": {
            "L1_elevation": _layer(50.0, 200.0, "m", "direct", "mola", "Plains relief envelope.", "relief"),
            "L2_slope": _layer(3.0, 5.0, "deg", "direct", "mola", "Low-relief plains.", "mean slope"),
            "L3_roughness": _layer(0.10, 0.15, "index", "direct", "mola", "Smooth plain with local ice-related texture.", "TRI/cell"),
            "L4_temperature_max": _layer(-10.0, 25.0, "C", "proxy", "nssdc_mars", "Warm-season surface envelope.", "warm-month skin temperature"),
            "L4_temperature_min": _layer(-95.0, 25.0, "C", "proxy", "nssdc_mars", "Cold-season surface envelope.", "cold-month skin temperature"),
            "L5_solar_illumination": _layer(110.0, 60.0, "W/m^2", "proxy", "nssdc_mars", "Mid-latitude annual mean.", "annual mean irradiance"),
            "L6_surface_pressure": _layer(0.62, 0.2, "kPa", "excluded", "nssdc_mars", "~0.6 kPa. Earth surface sites cannot reproduce it; laboratory or balloon context only.", "pressure"),
            "L7_ice_volatiles": _layer(0.35, 0.30, "VWE %", "proxy", "arcadia", "Buried-ice envelope; no Earth value acquired.", "water-equivalent"),
            "L8_mineralogy": _layer(0.70, 0.25, "index", "proxy", "arcadia", "Dust-covered plains index; no Earth value acquired.", "spectral index"),
            "L9_dust_hazard": _layer(0.60, 0.35, "index", "proxy", "nssdc_mars", "Dust-storm season envelope.", "AOD-equivalent index"),
            "L10_rock_abundance": _layer(8.0, 8.0, "%", "proxy", "arcadia", "Screening rock-cover envelope; no Earth value acquired.", "rock cover"),
            "L11_cave_proximity": _layer(50.0, 50.0, "km", "proxy", "arcadia", "No candidate cave adopted; no Earth value acquired.", "distance"),
            "L12_access": _layer(0.0, 0.0, "km", "context", "arcadia", "Not a field site; context only.", "access"),
        },
    },
]

# --------------------------------------------------------------------------- #
# Purpose weights (the brief's weights, plus cave robotics and L12 = 0)
# --------------------------------------------------------------------------- #
PURPOSES = [
    {
        "purpose_id": "rover_mobility",
        "purpose_name": "Rover Mobility",
        "question": "Can a wheeled rover climb and cross this kind of terrain?",
        "emphasis": ["slope", "roughness"],
        "weights": {
            "L1_elevation": 0.5, "L2_slope": 2.5, "L3_roughness": 2.5,
            "L4_temperature_max": 1.0, "L4_temperature_min": 1.0, "L5_solar_illumination": 0.5,
            "L6_surface_pressure": 0.2, "L7_ice_volatiles": 0.2, "L8_mineralogy": 1.0,
            "L9_dust_hazard": 1.5, "L10_rock_abundance": 2.5, "L11_cave_proximity": 0.2,
            "L12_access": 0.0,
        },
    },
    {
        "purpose_id": "ice_detection",
        "purpose_name": "Ice Detection",
        "question": "Can instruments that look for ice be tested in comparable cold and frozen ground?",
        "emphasis": ["temperature_extremes", "ice_snow_moisture"],
        "weights": {
            "L1_elevation": 0.5, "L2_slope": 1.0, "L3_roughness": 1.0,
            "L4_temperature_max": 2.0, "L4_temperature_min": 2.5, "L5_solar_illumination": 1.5,
            "L6_surface_pressure": 0.5, "L7_ice_volatiles": 3.0, "L8_mineralogy": 2.0,
            "L9_dust_hazard": 0.5, "L10_rock_abundance": 0.5, "L11_cave_proximity": 0.5,
            "L12_access": 0.0,
        },
    },
    {
        "purpose_id": "habitat_thermal_test",
        "purpose_name": "Habitat Thermal Test",
        "question": "Do temperatures swing far enough to test habitat insulation and heating?",
        "emphasis": ["temperature_extremes"],
        "weights": {
            "L1_elevation": 0.5, "L2_slope": 1.0, "L3_roughness": 1.0,
            "L4_temperature_max": 3.0, "L4_temperature_min": 3.0, "L5_solar_illumination": 2.5,
            "L6_surface_pressure": 1.0, "L7_ice_volatiles": 1.0, "L8_mineralogy": 0.5,
            "L9_dust_hazard": 1.5, "L10_rock_abundance": 0.5, "L11_cave_proximity": 1.5,
            "L12_access": 0.0,
        },
    },
    {
        "purpose_id": "cave_robotics",
        "purpose_name": "Cave Robotics",
        "question": "Are there caves or lava tubes with comparable rock for robots to explore?",
        "emphasis": ["caves_lava_tubes", "geology_minerals"],
        "weights": {
            "L1_elevation": 0.5, "L2_slope": 1.5, "L3_roughness": 2.0,
            "L4_temperature_max": 0.5, "L4_temperature_min": 0.5, "L5_solar_illumination": 0.2,
            "L6_surface_pressure": 0.2, "L7_ice_volatiles": 1.0, "L8_mineralogy": 2.0,
            "L9_dust_hazard": 0.5, "L10_rock_abundance": 2.0, "L11_cave_proximity": 3.0,
            "L12_access": 0.5,
        },
    },
]

PURPOSE_BY_ID = {p["purpose_id"]: p for p in PURPOSES}

# --------------------------------------------------------------------------- #
# Conditions Earth cannot reproduce (reported separately, never scored)
# --------------------------------------------------------------------------- #
EARTH_LIMITS = [
    {
        "id": "gravity",
        "label": "Gravity",
        "earth": "9.81 m/s²",
        "moon": "1.62 m/s²",
        "mars": "3.72 m/s²",
        "why_it_matters": "Loads, traction, dust settling and rover dynamics differ. No Earth surface site changes this.",
    },
    {
        "id": "pressure",
        "label": "Surface pressure / vacuum",
        "earth": "~101 kPa at sea level",
        "moon": "effectively 0 kPa",
        "mars": "~0.6 kPa",
        "why_it_matters": "Outgassing, convection, dust lifting and suit/rover sealing cannot be rehearsed in the open at an Earth site.",
    },
    {
        "id": "radiation",
        "label": "Space radiation",
        "earth": "Atmosphere and magnetosphere attenuate most of it",
        "moon": "No atmosphere or global field",
        "mars": "Thin atmosphere, no global field",
        "why_it_matters": "Surface radiation exposure is not reproduced; use the NASA Space Radiation Laboratory or flight opportunities instead.",
    },
    {
        "id": "lighting",
        "label": "True polar lighting",
        "earth": "24 h day cycle and atmospheric scattering",
        "moon": "Long shadows, low Sun, permanently shadowed regions",
        "mars": "Dust-attenuated sunlight, different day length",
        "why_it_matters": "Illumination geometry and shadow behaviour differ even when mean irradiance is similar.",
    },
    {
        "id": "regolith",
        "label": "Regolith & dust",
        "earth": "Weathering, water and biology change surface materials",
        "moon": "Angular, electrostatically charged regolith",
        "mars": "Fine dust with global storms",
        "why_it_matters": "Abrasion, adhesion and dust-storm behaviour are not reproduced by Earth soils or desert dust.",
    },
]

MODEL = {
    "schema_version": "1.0",
    "method_version": "screening-fit-1.0",
    "title": "ArtemisTwin provisional analog screening model",
    "score_label": "Analog Fit (screening model)",
    "monte_carlo_draws": 4000,
    "monte_carlo_seed": 20261111,
    "earth_noise_fraction": 0.10,
    "target_noise_fraction": 0.10,
    "weight_noise_fraction": 0.10,
    "proxy_weight_multiplier": 0.5,
    "notes": [
        "Analog Fit is a weighted similarity between documented Earth measurements and a declared target envelope, 0–100.",
        "It is not a match, a safety rating, an operational ranking, or evidence that a site can substitute for the Moon or Mars.",
        "Absolute elevation is not compared across bodies; L1 uses local relief inside the same footprint.",
        "Pressure is excluded from the fit for Moon and Mars targets because Earth surface sites cannot reproduce it.",
        "Layers marked proxy receive half weight. Missing layers are never imputed as zero; they lower Data Completeness.",
        "The uncertainty band propagates measurement, envelope and weight uncertainty only. It does not cover unmeasured conditions; a separate missing-data sensitivity range is reported.",
    ],
}
