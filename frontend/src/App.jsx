import { useEffect, useState } from "react";
import "./App.css";
import FacilityMap from "./pages/FacilityMap";

const API_URL = "http://127.0.0.1:8000";

function App() {
  /* =====================================================
     PAGE NAVIGATION
  ===================================================== */

  const [activePage, setActivePage] = useState("dashboard");

  /* =====================================================
     DASHBOARD DATA
  ===================================================== */

  const [allFacilities, setAllFacilities] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [complianceChecks, setComplianceChecks] = useState([]);

  const [selectedState, setSelectedState] = useState("ALL");
  const [selectedCounty, setSelectedCounty] = useState("ALL");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* =====================================================
     LOAD DATA
  ===================================================== */

  async function loadDashboard() {
    try {
      setLoading(true);
      setError("");

      const [facilityResponse, complianceResponse] = await Promise.all([
        fetch(`${API_URL}/facilities`),
        fetch(`${API_URL}/compliance-checks`),
      ]);

      if (!facilityResponse.ok) {
        throw new Error("Could not load facilities.");
      }

      if (!complianceResponse.ok) {
        throw new Error("Could not load compliance checks.");
      }

      const facilityData = await facilityResponse.json();
      const complianceData = await complianceResponse.json();

      setAllFacilities(facilityData);
      setFacilities(facilityData);
      setComplianceChecks(complianceData);

      setSelectedState("ALL");
      setSelectedCounty("ALL");
    } catch (err) {
      console.error(err);
      setError("Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  /* =====================================================
     DASHBOARD NAVIGATION
  ===================================================== */

  function showDashboard() {
    setActivePage("dashboard");

    setTimeout(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }, 50);
  }

  function showFacilities() {
    setActivePage("dashboard");

    setTimeout(() => {
      const section = document.getElementById("facilities");

      if (section) {
        section.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 50);
  }

  function showCompliance() {
    setActivePage("dashboard");

    setTimeout(() => {
      const section = document.getElementById("compliance");

      if (section) {
        section.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 50);
  }

  function showMap() {
    console.log("Opening Facility Map");

    setActivePage("map");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  /* =====================================================
     FILTER OPTIONS
  ===================================================== */

  const states = [
    ...new Set(
      allFacilities
        .map((facility) => facility.state)
        .filter(Boolean)
        .map((state) => String(state).trim())
    ),
  ].sort();

  const counties = [
    ...new Set(
      allFacilities
        .filter(
          (facility) =>
            selectedState === "ALL" ||
            String(facility.state).trim() === selectedState
        )
        .map((facility) => facility.county)
        .filter(Boolean)
        .map((county) => String(county).trim())
    ),
  ].sort();

  /* =====================================================
     STATE FILTER
  ===================================================== */

  function handleStateChange(event) {
    const state = event.target.value;

    setSelectedState(state);
    setSelectedCounty("ALL");

    if (state === "ALL") {
      setFacilities(allFacilities);
      return;
    }

    const filtered = allFacilities.filter(
      (facility) =>
        String(facility.state).trim() === state
    );

    setFacilities(filtered);
  }

  /* =====================================================
     COUNTY FILTER
  ===================================================== */

  function handleCountyChange(event) {
    const county = event.target.value;

    setSelectedCounty(county);

    const filtered = allFacilities.filter((facility) => {
      const matchesState =
        selectedState === "ALL" ||
        String(facility.state).trim() === selectedState;

      const matchesCounty =
        county === "ALL" ||
        String(facility.county).trim() === county;

      return matchesState && matchesCounty;
    });

    setFacilities(filtered);
  }

  /* =====================================================
     TOTAL VIOLATIONS
  ===================================================== */

  const totalViolations = complianceChecks.reduce(
    (sum, check) =>
      sum + Number(check.violation_count || 0),
    0
  );

  /* =====================================================
     APP
  ===================================================== */

  return (
    <div className="app">

      {/* SIDEBAR */}

      <aside className="sidebar">

        <div className="logo">

          <img
            src="/sun.png"
            alt="Sunrise Care logo"
            className="sidebar-logo"
          />

          <h2>Sunrise Care</h2>

          <p>
            Correctional Healthcare
          </p>

        </div>

        <nav>

          <button
            type="button"
            className="sidebar-link"
            onClick={showDashboard}
          >
            Dashboard
          </button>

          <button
            type="button"
            className="sidebar-link"
            onClick={showFacilities}
          >
            Facilities
          </button>

          <button
            type="button"
            className="sidebar-link"
            onClick={showCompliance}
          >
            Compliance Checks
          </button>

          <button
            type="button"
            className="sidebar-link"
            onClick={showMap}
          >
            Facility Map
          </button>

        </nav>

      </aside>

      {/* MAIN CONTENT */}

      <main className="main-content">

        {activePage === "map" ? (

          /* =========================================
             FACILITY MAP PAGE
          ========================================= */

          <FacilityMap />

        ) : (

          /* =========================================
             DASHBOARD PAGE
          ========================================= */

          <>

            <section
              id="dashboard"
              className="page-header"
            >

              <div>

                <h1>
                  Operational Dashboard
                </h1>

                <p>
                  Facility compliance monitoring and healthcare
                  risk management.
                </p>

              </div>

              <button
                type="button"
                className="refresh-button"
                onClick={loadDashboard}
              >
                Refresh Data
              </button>

            </section>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            {/* SUMMARY */}

            <section className="summary-grid">

              <div className="summary-card">

                <p>
                  Total Facilities
                </p>

                <h2>
                  {allFacilities.length.toLocaleString()}
                </h2>

              </div>

              <div className="summary-card">

                <p>
                  Total Compliance Checks
                </p>

                <h2>
                  {complianceChecks.length.toLocaleString()}
                </h2>

              </div>

              <div className="summary-card">

                <p>
                  Total Violations
                </p>

                <h2>
                  {totalViolations.toLocaleString()}
                </h2>

              </div>

            </section>

            {/* FACILITIES */}

            <section
              id="facilities"
              className="content-section"
            >

              <div className="section-header">

                <div>

                  <h2>
                    Facilities
                  </h2>

                  <p>
                    View facilities registered in the database
                    by state and county.
                  </p>

                </div>

                <div className="facility-filters">

                  <select
                    value={selectedState}
                    onChange={handleStateChange}
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

                  <select
                    value={selectedCounty}
                    onChange={handleCountyChange}
                  >

                    <option value="ALL">
                      All Counties
                    </option>

                    {counties.map((county) => (
                      <option
                        key={county}
                        value={county}
                      >
                        {county}
                      </option>
                    ))}

                  </select>

                </div>

              </div>

              <div className="table-container">

                <table>

                  <thead>

                    <tr>
                      <th>Facility ID</th>
                      <th>Facility Name</th>
                      <th>County</th>
                      <th>State</th>
                    </tr>

                  </thead>

                  <tbody>

                    {loading ? (

                      <tr>
                        <td colSpan="4">
                          Loading facilities...
                        </td>
                      </tr>

                    ) : facilities.length === 0 ? (

                      <tr>
                        <td colSpan="4">
                          No facilities found.
                        </td>
                      </tr>

                    ) : (

                      facilities.map((facility) => (

                        <tr
                          key={facility.facility_id}
                        >

                          <td>
                            {facility.facility_id}
                          </td>

                          <td>
                            {facility.facility_name}
                          </td>

                          <td>
                            {facility.county || "—"}
                          </td>

                          <td>
                            {facility.state}
                          </td>

                        </tr>

                      ))

                    )}

                  </tbody>

                </table>

              </div>

            </section>

            {/* COMPLIANCE */}

            <section
              id="compliance"
              className="content-section"
            >

              <div className="section-header">

                <div>

                  <h2>
                    Compliance Checks
                  </h2>

                  <p>
                    Review compliance records and reported
                    violations.
                  </p>

                </div>

              </div>

              <div className="table-container">

                <table>

                  <thead>

                    <tr>
                      <th>Check ID</th>
                      <th>Facility ID</th>
                      <th>Violations</th>
                    </tr>

                  </thead>

                  <tbody>

                    {loading ? (

                      <tr>
                        <td colSpan="3">
                          Loading compliance checks...
                        </td>
                      </tr>

                    ) : complianceChecks.length === 0 ? (

                      <tr>
                        <td colSpan="3">
                          No compliance checks found.
                        </td>
                      </tr>

                    ) : (

                      complianceChecks.map((check) => (

                        <tr
                          key={check.check_id}
                        >

                          <td>
                            {check.check_id}
                          </td>

                          <td>
                            {check.facility_id}
                          </td>

                          <td>
                            {check.violation_count}
                          </td>

                        </tr>

                      ))

                    )}

                  </tbody>

                </table>

              </div>

            </section>

            <button
              type="button"
              className="back-to-top"
              onClick={() =>
                window.scrollTo({
                  top: 0,
                  behavior: "smooth",
                })
              }
            >
              ↑ Back to Top
            </button>

          </>

        )}

      </main>

    </div>
  );
}

export default App;