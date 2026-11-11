import { useEffect, useMemo, useState } from "react";

import {
  MapContainer,
  TileLayer,
  Popup,
  CircleMarker,
  useMap,
} from "react-leaflet";

import L from "leaflet";
import "./FacilityMap.css";

const API_URL = "http://127.0.0.1:8000";

const USA_CENTER = [39.8283, -98.5795];
const USA_ZOOM = 4;

/* =========================================================
   MAP VIEW CONTROLLER
========================================================= */

function MapController({ facilities, selectedState }) {
  const map = useMap();

  useEffect(() => {
    if (selectedState === "ALL") {
      map.setView(USA_CENTER, USA_ZOOM);
      return;
    }

    const points = facilities.map((facility) => [
      Number(facility.latitude),
      Number(facility.longitude),
    ]);

    if (points.length > 0) {
      const bounds = L.latLngBounds(points);

      map.fitBounds(bounds, {
        padding: [45, 45],
        maxZoom: 8,
      });
    }
  }, [facilities, selectedState, map]);

  return null;
}

/* =========================================================
   FACILITY MAP PAGE
========================================================= */

function FacilityMap() {
  const [facilities, setFacilities] = useState([]);
  const [selectedState, setSelectedState] = useState("ALL");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* -------------------------------------------------------
     LOAD FACILITIES
  ------------------------------------------------------- */

  useEffect(() => {
    async function loadFacilities() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(`${API_URL}/facilities`);

        if (!response.ok) {
          throw new Error("Unable to retrieve facility data.");
        }

        const data = await response.json();

        setFacilities(data);
      } catch (err) {
        console.error("Map error:", err);

        setError(
          "Unable to load facility locations from the backend."
        );
      } finally {
        setLoading(false);
      }
    }

    loadFacilities();
  }, []);

  /* -------------------------------------------------------
     STATE LIST
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     FILTER BY STATE
  ------------------------------------------------------- */

  const filteredFacilities = useMemo(() => {
    if (selectedState === "ALL") {
      return facilities;
    }

    return facilities.filter(
      (facility) =>
        String(facility.state).trim() === selectedState
    );
  }, [facilities, selectedState]);

  /* -------------------------------------------------------
     ONLY FACILITIES WITH VALID COORDINATES
  ------------------------------------------------------- */

  const mappedFacilities = useMemo(() => {
    return filteredFacilities.filter((facility) => {
      const latitude = Number(facility.latitude);
      const longitude = Number(facility.longitude);

      return (
        facility.latitude !== null &&
        facility.latitude !== undefined &&
        facility.longitude !== null &&
        facility.longitude !== undefined &&
        !Number.isNaN(latitude) &&
        !Number.isNaN(longitude)
      );
    });
  }, [filteredFacilities]);

  const unmappedCount =
    filteredFacilities.length - mappedFacilities.length;

  function handleReset() {
    setSelectedState("ALL");
  }

  /* -------------------------------------------------------
     SMALLER MARKERS FOR FULL-US VIEW
  ------------------------------------------------------- */

  const markerRadius =
    selectedState === "ALL" ? 3 : 6;

  return (
    <div className="map-page">
      {/* HEADER */}

      <section className="map-page-header">
        <div>
          <h1>Facility Map</h1>

          <p>
            Explore the geographic distribution of correctional
            healthcare facilities across the United States.
          </p>
        </div>

        <div className="map-controls">
          <div className="map-filter">
            <label htmlFor="map-state-filter">
              State
            </label>

            <select
              id="map-state-filter"
              value={selectedState}
              onChange={(event) =>
                setSelectedState(event.target.value)
              }
            >
              <option value="ALL">
                All States
              </option>

              {states.map((state) => (
                <option
                  key={state}
                  value={state}
                >
                  {state}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="map-reset-button"
            onClick={handleReset}
          >
            Reset Map
          </button>
        </div>
      </section>

      {/* SUMMARY */}

      <section className="map-summary">
        <div className="map-summary-card">
          <span>Selected Area</span>

          <strong>
            {selectedState === "ALL"
              ? "United States"
              : selectedState}
          </strong>
        </div>

        <div className="map-summary-card">
          <span>Facilities Displayed</span>

          <strong>
            {mappedFacilities.length.toLocaleString()}
          </strong>
        </div>

        <div className="map-summary-card">
          <span>Total Facilities</span>

          <strong>
            {facilities.length.toLocaleString()}
          </strong>
        </div>
      </section>

      {/* STATUS */}

      <section className="map-status">
        <p>
          Showing{" "}
          <strong>
            {mappedFacilities.length.toLocaleString()}
          </strong>{" "}
          facilities
          {selectedState !== "ALL"
            ? ` in ${selectedState}`
            : " across the United States"}.
        </p>

        {unmappedCount > 0 && (
          <p className="map-note">
            {unmappedCount.toLocaleString()} record
            {unmappedCount !== 1 ? "s" : ""} cannot be mapped
            because coordinates are unavailable.
          </p>
        )}
      </section>

      {/* ERROR */}

      {error && (
        <div className="map-error">
          {error}
        </div>
      )}

      {/* MAP */}

      <section className="map-container-wrapper">
        {loading ? (
          <div className="map-loading">
            Loading facility map...
          </div>
        ) : (
          <MapContainer
            center={USA_CENTER}
            zoom={USA_ZOOM}
            scrollWheelZoom={true}
            className="facility-map"
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapController
              facilities={mappedFacilities}
              selectedState={selectedState}
            />

            {mappedFacilities.map((facility) => (
              <CircleMarker
                key={facility.facility_id}
                center={[
                  Number(facility.latitude),
                  Number(facility.longitude),
                ]}
                radius={markerRadius}
                pathOptions={{
                  color: "#8b5a2b",
                  weight: 1,
                  fillColor: "#e7a24c",
                  fillOpacity: 0.85,
                }}
              >
                <Popup>
                  <div className="facility-popup">
                    <h3>
                      {facility.facility_name}
                    </h3>

                    <p>
                      <strong>Facility ID:</strong>{" "}
                      {facility.facility_id}
                    </p>

                    <p>
                      <strong>County:</strong>{" "}
                      {facility.county || "Not available"}
                    </p>

                    <p>
                      <strong>State:</strong>{" "}
                      {facility.state}
                    </p>

                    <p className="popup-coordinates">
                      Latitude:{" "}
                      {Number(
                        facility.latitude
                      ).toFixed(4)}
                      <br />
                      Longitude:{" "}
                      {Number(
                        facility.longitude
                      ).toFixed(4)}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        )}
      </section>
    </div>
  );
}

export default FacilityMap;