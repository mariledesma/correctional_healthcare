
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  ZoomControl,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./FacilityMap.css";

const API_URL = "http://127.0.0.1:8000";

// ==========================================
// RISK COLORS
// ==========================================

function getRiskColor(score) {
  if (
    score === null ||
    score === undefined ||
    !Number.isFinite(Number(score))
  ) {
    return "#9ca3af";
  }

  const risk = Math.max(0, Math.min(100, Number(score)));

  const hue = 40 * (1 - risk / 100);
  const lightness = 86 - 55 * (risk / 100);

  return `hsl(${hue}, 90%, ${lightness}%)`;
}

function formatRisk(score) {
  if (score === null || score === undefined) {
    return "N/A";
  }

  return `${Number(score).toFixed(1)}%`;
}

// ==========================================
// AUTOMATIC MAP ZOOM
// ==========================================

// This component controls the Leaflet map viewport.
// Whenever state, county, or search results change,
// the map automatically adjusts to the visible facilities.

function MapAutoZoom({
  facilities,
  selectedState,
  selectedCounty,
}) {
  const map = useMap();

  useEffect(() => {
    // Return to the national view when all filters are reset.
    if (
      selectedState === "ALL" &&
      selectedCounty === "ALL" &&
      facilities.length > 0
    ) {
      // If there are filtered search results,
      // zoom to those results instead.
      const coordinates = facilities.map((facility) => [
        Number(facility.latitude),
        Number(facility.longitude),
      ]);

      if (facilities.length === 1) {
        map.setView(coordinates[0], 11, {
          animate: true,
        });
      } else if (facilities.length < 100) {
        map.fitBounds(coordinates, {
          padding: [40, 40],
          maxZoom: 11,
          animate: true,
        });
      } else {
        map.setView([39.5, -98.35], 4, {
          animate: true,
        });
      }

      return;
    }

    if (!facilities.length) {
      return;
    }

    const coordinates = facilities.map((facility) => [
      Number(facility.latitude),
      Number(facility.longitude),
    ]);

    // One matching facility: zoom directly to it.
    if (coordinates.length === 1) {
      map.setView(coordinates[0], 11, {
        animate: true,
      });
      return;
    }

    // Multiple facilities: calculate bounds that include all.
    map.fitBounds(coordinates, {
      padding: [40, 40],
      maxZoom: 11,
      animate: true,
    });
  }, [map, facilities, selectedState, selectedCounty]);

  return null;
}

// ==========================================
// FACILITY MAP
// ==========================================

export default function FacilityMap({
  riskByFacility = {},
}) {
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedState, setSelectedState] =
    useState("ALL");

  const [selectedCounty, setSelectedCounty] =
    useState("ALL");

  const [search, setSearch] = useState("");

  // ========================================
  // LOAD FACILITIES
  // ========================================

  useEffect(() => {
    const controller = new AbortController();

    async function loadFacilities() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/facilities`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error(
            "Unable to retrieve facility locations."
          );
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          throw new Error(
            "Unexpected facility response."
          );
        }

        if (!controller.signal.aborted) {
          setFacilities(data);
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadFacilities();

    return () => controller.abort();
  }, []);

  // ========================================
  // STATE FILTER OPTIONS
  // ========================================

  const states = useMemo(() => {
    return [
      ...new Set(
        facilities
          .map((facility) => facility.state)
          .filter(Boolean)
          .map((state) => String(state).trim())
      ),
    ].sort();
  }, [facilities]);

  // ========================================
  // COUNTY FILTER OPTIONS
  // ========================================

  const counties = useMemo(() => {
    return [
      ...new Set(
        facilities
          .filter(
            (facility) =>
              selectedState === "ALL" ||
              String(facility.state).trim() ===
                selectedState
          )
          .map((facility) => facility.county)
          .filter(Boolean)
          .map((county) => String(county).trim())
      ),
    ].sort();
  }, [facilities, selectedState]);

  // ========================================
  // FILTER FACILITIES
  // ========================================

  const filteredFacilities = useMemo(() => {
    const query = search.trim().toLowerCase();

    return facilities.filter((facility) => {
      const matchesState =
        selectedState === "ALL" ||
        String(facility.state).trim() === selectedState;

      const matchesCounty =
        selectedCounty === "ALL" ||
        String(facility.county).trim() === selectedCounty;

      const searchableText = [
        facility.facility_id,
        facility.facility_name,
        facility.county,
        facility.state,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query || searchableText.includes(query);

      return (
        matchesState &&
        matchesCounty &&
        matchesSearch
      );
    });
  }, [
    facilities,
    selectedState,
    selectedCounty,
    search,
  ]);

  // ========================================
  // VALID COORDINATES
  // ========================================

  const mappedFacilities = useMemo(() => {
    return filteredFacilities.filter((facility) => {
      if (
        facility.latitude === null ||
        facility.latitude === undefined ||
        facility.longitude === null ||
        facility.longitude === undefined
      ) {
        return false;
      }

      const lat = Number(facility.latitude);
      const lng = Number(facility.longitude);

      return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180 &&
        !(lat === 0 && lng === 0)
      );
    });
  }, [filteredFacilities]);

  // ========================================
  // RISK SUMMARY
  // ========================================

  const riskSummary = useMemo(() => {
    let assessed = 0;
    let highRisk = 0;
    let unknown = 0;

    mappedFacilities.forEach((facility) => {
      const record =
        riskByFacility[String(facility.facility_id)];

      const score = record?.risk_pct;

      if (
        score === null ||
        score === undefined ||
        !Number.isFinite(Number(score))
      ) {
        unknown += 1;
      } else {
        assessed += 1;

        if (Number(score) >= 75) {
          highRisk += 1;
        }
      }
    });

    return { assessed, highRisk, unknown };
  }, [mappedFacilities, riskByFacility]);

  // ========================================
  // RESET FILTERS
  // ========================================

  function resetFilters() {
    setSelectedState("ALL");
    setSelectedCounty("ALL");
    setSearch("");
  }

  // ========================================
  // RENDER
  // ========================================

  return (
    <div className="facility-map-page">

      {/* MAP HEADER */}

      <section className="facility-map-header">
        <div>
          <h1>Facility Risk Map</h1>

          <p>
            Geographic distribution of correctional healthcare
            facilities and their calculated operational
            risk percentages.
          </p>
        </div>
      </section>

      {/* MAP SUMMARY */}

      <section className="facility-map-summary">

        <div className="facility-map-stat">
          <span>Mapped Facilities</span>

          <h2>
            {mappedFacilities.length.toLocaleString()}
          </h2>
        </div>

        <div className="facility-map-stat">
          <span>Assessed Facilities</span>

          <h2>
            {riskSummary.assessed.toLocaleString()}
          </h2>
        </div>

        <div className="facility-map-stat">
          <span>High Risk (75%+)</span>

          <h2>
            {riskSummary.highRisk.toLocaleString()}
          </h2>
        </div>

        <div className="facility-map-stat">
          <span>Risk Unavailable</span>

          <h2>
            {riskSummary.unknown.toLocaleString()}
          </h2>
        </div>

      </section>

      {/* FILTERS */}

      <section className="facility-map-filters">

        <div className="facility-map-filter-field">

          <label htmlFor="map-search">
            Search Facility
          </label>

          <input
            id="map-search"
            type="text"
            placeholder="Facility name or ID..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />

        </div>

        <div className="facility-map-filter-field">

          <label htmlFor="map-state">
            State
          </label>

          <select
            id="map-state"
            value={selectedState}
            onChange={(event) => {
              setSelectedState(event.target.value);
              setSelectedCounty("ALL");
            }}
          >
            <option value="ALL">All States</option>

            {states.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>

        </div>

        <div className="facility-map-filter-field">

          <label htmlFor="map-county">
            County
          </label>

          <select
            id="map-county"
            value={selectedCounty}
            onChange={(event) =>
              setSelectedCounty(event.target.value)
            }
          >
            <option value="ALL">All Counties</option>

            {counties.map((county) => (
              <option key={county} value={county}>
                {county}
              </option>
            ))}
          </select>

        </div>

        <button
          type="button"
          className="facility-map-reset"
          onClick={resetFilters}
        >
          Reset Filters
        </button>

      </section>

      {/* ERRORS */}

      {error && (
        <div className="facility-map-error">
          {error}
        </div>
      )}

      {/* LEAFLET MAP */}

      <section className="facility-map-container">

        {loading && (
          <p className="facility-map-status">
            Loading facility locations...
          </p>
        )}

        <MapContainer
          center={[39.5, -98.35]}
          zoom={4}
          minZoom={3}
          scrollWheelZoom={true}
          zoomControl={false}
          className="facility-leaflet-map"
        >

          <TileLayer
            attribution={
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <ZoomControl position="topright" />

          {/* AUTOMATIC STATE / COUNTY ZOOM */}

          <MapAutoZoom
            facilities={mappedFacilities}
            selectedState={selectedState}
            selectedCounty={selectedCounty}
          />

          {/* SMALL COLORED FACILITY DOTS */}

          {mappedFacilities.map((facility) => {
            const facilityId =
              String(facility.facility_id);

            const risk = riskByFacility[facilityId];
            const score = risk?.risk_pct ?? null;

            const partial =
              risk &&
              score !== null &&
              risk.risk_coverage < 3;

            const color = getRiskColor(score);

            return (
              <CircleMarker
                key={facilityId}
                center={[
                  Number(facility.latitude),
                  Number(facility.longitude),
                ]}
                radius={5}
                pathOptions={{
                  fillColor: color,
                  fillOpacity: 0.85,
                  color: "#ffffff",
                  weight: 1,
                }}
              >
                <Popup>

                  <div className="facility-map-popup">

                    <h3>
                      {facility.facility_name}
                    </h3>

                    <p>
                      <strong>Facility ID:</strong>{" "}
                      {facility.facility_id}
                    </p>

                    <p>
                      <strong>County:</strong>{" "}
                      {facility.county || "N/A"}
                    </p>

                    <p>
                      <strong>State:</strong>{" "}
                      {facility.state || "N/A"}
                    </p>

                    <hr />

                    <div
                      className="facility-map-risk"
                      style={{
                        backgroundColor: color,
                        color:
                          score !== null && score >= 60
                            ? "#ffffff"
                            : "#332211",
                      }}
                    >
                      Overall Risk: {formatRisk(score)}
                    </div>

                    {partial && (
                      <p className="facility-map-partial">
                        Partial assessment: some risk
                        categories are unavailable.
                      </p>
                    )}

                    <p>
                      <strong>Compliance:</strong>{" "}
                      {formatRisk(
                        risk?.compliance_risk_pct
                      )}
                    </p>

                    <p>
                      <strong>Hospital:</strong>{" "}
                      {formatRisk(
                        risk?.hospital_risk_pct
                      )}
                    </p>

                    <p>
                      <strong>Staffing:</strong>{" "}
                      {formatRisk(
                        risk?.staffing_risk_pct
                      )}
                    </p>

                    <hr />

                    <p>
                      <strong>Violations:</strong>{" "}
                      {risk?.total_violations ?? "N/A"}
                    </p>

                    <p>
                      <strong>Hospital Visits:</strong>{" "}
                      {risk?.hospital_visits ?? "N/A"}
                    </p>

                    <p>
                      <strong>Staffing Records:</strong>{" "}
                      {risk?.staffing_records ?? "N/A"}
                    </p>

                  </div>

                </Popup>

              </CircleMarker>
            );
          })}

        </MapContainer>

      </section>

      {/* RISK LEGEND */}

      <section className="facility-map-legend">

        <div>
          <h3>Facility Risk Scale</h3>

          <p>
            Darker dots represent higher operational
            risk scores.
          </p>
        </div>

        <div className="facility-map-legend-scale">

          <div className="facility-map-gradient" />

          <div className="facility-map-legend-labels">
            <span>0% — Lower Risk</span>
            <span>100% — Higher Risk</span>
          </div>

          <div className="facility-map-unknown">
            <span className="facility-map-gray-dot" />
            Gray indicates unavailable risk data.
          </div>

        </div>

      </section>

      <p className="facility-map-disclaimer">
        Risk percentages are demonstration operational
        indices based on available compliance, hospital,
        and staffing records. They are not validated
        predictions of violations or patient outcomes.
      </p>

    </div>
  );
}
