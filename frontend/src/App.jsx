
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import FacilityMap from "./pages/FacilityMap";
import RiskRecords from "./RiskRecords";

const API_URL = "http://127.0.0.1:8000";

// ----------------------------------------
// Risk percentage formatting and colors
// ----------------------------------------

function formatRisk(score) {
  if (score === null || score === undefined) {
    return "N/A";
  }

  return `${Number(score).toFixed(1)}%`;
}

function getRiskColor(score) {
  if (
    score === null ||
    score === undefined ||
    !Number.isFinite(Number(score))
  ) {
    return "#9ca3af";
  }

  const risk = Math.max(0, Math.min(100, Number(score)));

  // Higher percentages produce darker orange/red colors.
  const hue = 40 * (1 - risk / 100);
  const lightness = 86 - 55 * (risk / 100);

  return `hsl(${hue}, 90%, ${lightness}%)`;
}

function App() {
  // ======================================
  // PAGE NAVIGATION
  // ======================================

  const [activePage, setActivePage] = useState("dashboard");

  // ======================================
  // DASHBOARD DATA
  // ======================================

  const [allFacilities, setAllFacilities] = useState([]);
  const [complianceChecks, setComplianceChecks] = useState([]);
  const [facilityRisks, setFacilityRisks] = useState([]);

  const [selectedState, setSelectedState] = useState("ALL");
  const [selectedCounty, setSelectedCounty] = useState("ALL");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [riskError, setRiskError] = useState("");

  // ======================================
  // LOAD DASHBOARD DATA
  // ======================================

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setRiskError("");

      const [
        facilityResponse,
        complianceResponse,
        riskResponse,
      ] = await Promise.all([
        fetch(`${API_URL}/facilities`),
        fetch(`${API_URL}/compliance-checks`),
        fetch(`${API_URL}/facility-risks`),
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
      setComplianceChecks(complianceData);

      // Risk endpoint is optional until backend is updated.
      if (riskResponse.ok) {
        const riskData = await riskResponse.json();

        setFacilityRisks(
          Array.isArray(riskData) ? riskData : []
        );
      } else {
        setFacilityRisks([]);
        setRiskError(
          "Facility risk scores are unavailable. Check the /facility-risks endpoint."
        );
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh whenever Dashboard or Map is opened.
  useEffect(() => {
    if (
      activePage === "dashboard" ||
      activePage === "map"
    ) {
      loadDashboard();
    }
  }, [activePage, loadDashboard]);

  // ======================================
  // NAVIGATION
  // ======================================

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

  function showRiskRecords() {
    setActivePage("risk-records");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function showMap() {
    setActivePage("map");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  // ======================================
  // FACILITY FILTER OPTIONS
  // ======================================

  const states = useMemo(() => {
    return [
      ...new Set(
        allFacilities
          .map((facility) => facility.state)
          .filter(Boolean)
          .map((state) => String(state).trim())
      ),
    ].sort();
  }, [allFacilities]);

  const counties = useMemo(() => {
    return [
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
  }, [allFacilities, selectedState]);

  const facilities = useMemo(() => {
    return allFacilities.filter((facility) => {
      const matchesState =
        selectedState === "ALL" ||
        String(facility.state).trim() === selectedState;

      const matchesCounty =
        selectedCounty === "ALL" ||
        String(facility.county).trim() === selectedCounty;

      return matchesState && matchesCounty;
    });
  }, [allFacilities, selectedState, selectedCounty]);

  function handleStateChange(event) {
    setSelectedState(event.target.value);
    setSelectedCounty("ALL");
  }

  function handleCountyChange(event) {
    setSelectedCounty(event.target.value);
  }

  // ======================================
  // COMPLIANCE STATISTICS
  // ======================================

  const totalViolations = useMemo(() => {
    return complianceChecks.reduce(
      (sum, check) =>
        sum + Number(check.violation_count || 0),
      0
    );
  }, [complianceChecks]);

  // ======================================
  // FACILITY RISK LOOKUP
  // ======================================

  const riskByFacility = useMemo(() => {
    return Object.fromEntries(
      facilityRisks.map((record) => [
        String(record.facility_id),
        record,
      ])
    );
  }, [facilityRisks]);

  // ======================================
  // HOSPITAL STATISTICS
  // ======================================

  const totalHospitalVisits = useMemo(() => {
    return facilityRisks.reduce(
      (sum, record) =>
        sum + Number(record.hospital_visits || 0),
      0
    );
  }, [facilityRisks]);

  // ======================================
  // STAFFING STATISTICS
  // ======================================

  const totalStaffingRecords = useMemo(() => {
    return facilityRisks.reduce(
      (sum, record) =>
        sum + Number(record.staffing_records || 0),
      0
    );
  }, [facilityRisks]);

  // ======================================
  // AVERAGE FACILITY RISK
  // ======================================

  const assessedFacilities = useMemo(() => {
    return facilityRisks.filter(
      (record) =>
        record.risk_pct !== null &&
        record.risk_pct !== undefined
    );
  }, [facilityRisks]);

  const averageRisk = useMemo(() => {
    if (assessedFacilities.length === 0) {
      return null;
    }

    const total = assessedFacilities.reduce(
      (sum, record) =>
        sum + Number(record.risk_pct),
      0
    );

    return total / assessedFacilities.length;
  }, [assessedFacilities]);

  // ======================================
  // APP
  // ======================================

  return (
    <div className="app">

      {/* ==================================
          SIDEBAR
      ================================== */}

      <aside className="sidebar">

        <div className="logo">
          <img
            src="/sun.png"
            alt="Sunrise Care logo"
            className="sidebar-logo"
          />

          <h2>Sunrise Care</h2>

          <p>Correctional Healthcare</p>
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
            onClick={showRiskRecords}
          >
            Hospital & Staffing
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

      {/* ==================================
          MAIN CONTENT
      ================================== */}

      <main className="main-content">

        {activePage === "map" ? (

          // FACILITY MAP
          <FacilityMap riskByFacility={riskByFacility} />

        ) : activePage === "risk-records" ? (

          // HOSPITAL AND STAFFING CRUD
          <RiskRecords />

        ) : (

          // DASHBOARD
          <>

            {/* ==========================
                DASHBOARD HEADER
            ========================== */}

            <section
              id="dashboard"
              className="page-header"
            >

              <div>
                <h1>Operational Dashboard</h1>

                <p>
                  Facility compliance monitoring and
                  healthcare risk management.
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

            {/* ERRORS */}

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            {riskError && (
              <div className="error-message">
                {riskError}
              </div>
            )}

            {/* ==========================
                DASHBOARD SUMMARY CARDS
            ========================== */}

            <section className="summary-grid">

              {/* TOTAL FACILITIES */}

              <div className="summary-card">
                <p>Total Facilities</p>

                <h2>
                  {allFacilities.length.toLocaleString()}
                </h2>
              </div>

              {/* TOTAL COMPLIANCE CHECKS */}

              <div className="summary-card">
                <p>Total Compliance Checks</p>

                <h2>
                  {complianceChecks.length.toLocaleString()}
                </h2>
              </div>

              {/* TOTAL VIOLATIONS */}

              <div className="summary-card">
                <p>Total Violations</p>

                <h2>
                  {totalViolations.toLocaleString()}
                </h2>
              </div>

              {/* TOTAL HOSPITAL VISITS */}

              <div className="summary-card">
                <p>Total Hospital Visits</p>

                <h2>
                  {facilityRisks.length > 0
                    ? totalHospitalVisits.toLocaleString()
                    : "—"}
                </h2>
              </div>

              {/* TOTAL STAFFING RECORDS */}

              <div className="summary-card">
                <p>Total Staffing Records</p>

                <h2>
                  {facilityRisks.length > 0
                    ? totalStaffingRecords.toLocaleString()
                    : "—"}
                </h2>
              </div>

              {/* AVERAGE FACILITY RISK */}

              <div className="summary-card">
                <p>Average Facility Risk</p>

                <h2>{formatRisk(averageRisk)}</h2>

                <small
                  style={{
                    display: "block",
                    marginTop: "8px",
                    color: "#8b735e",
                  }}
                >
                  Based on{" "}
                  {assessedFacilities.length.toLocaleString()}{" "}
                  assessed facilities
                </small>
              </div>

            </section>

            {/* ==========================
                FACILITIES
            ========================== */}

            <section
              id="facilities"
              className="content-section"
            >

              <div className="section-header">

                <div>
                  <h2>Facilities</h2>

                  <p>
                    View facilities registered in the database
                    by state and county, including their
                    operational risk percentages.
                  </p>
                </div>

                <div className="facility-filters">

                  {/* STATE FILTER */}

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

                  {/* COUNTY FILTER */}

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

              {/* FACILITIES TABLE */}

              <div className="table-container">

                <table>

                  <thead>
                    <tr>
                      <th>Facility ID</th>
                      <th>Facility Name</th>
                      <th>County</th>
                      <th>State</th>
                      <th>Overall Risk</th>
                    </tr>
                  </thead>

                  <tbody>

                    {loading ? (

                      <tr>
                        <td colSpan="5">
                          Loading facilities...
                        </td>
                      </tr>

                    ) : facilities.length === 0 ? (

                      <tr>
                        <td colSpan="5">
                          No facilities found.
                        </td>
                      </tr>

                    ) : (

                      facilities.map((facility) => {

                        const risk =
                          riskByFacility[
                            String(facility.facility_id)
                          ];

                        const riskValue =
                          risk?.risk_pct ?? null;

                        const riskColor =
                          getRiskColor(riskValue);

                        return (
                          <tr key={facility.facility_id}>

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

                            {/* FACILITY RISK PERCENTAGE */}

                            <td>

                              {riskValue === null ? (

                                <span
                                  style={{
                                    color: "#8b735e",
                                  }}
                                >
                                  N/A
                                </span>

                              ) : (

                                <div>

                                  <span
                                    title={
                                      `Compliance: ${formatRisk(
                                        risk.compliance_risk_pct
                                      )}\n` +
                                      `Hospital: ${formatRisk(
                                        risk.hospital_risk_pct
                                      )}\n` +
                                      `Staffing: ${formatRisk(
                                        risk.staffing_risk_pct
                                      )}`
                                    }
                                    style={{
                                      display: "inline-block",
                                      minWidth: "75px",
                                      padding: "7px 12px",
                                      borderRadius: "6px",
                                      textAlign: "center",
                                      fontWeight: "bold",
                                      backgroundColor: riskColor,
                                      color:
                                        riskValue >= 60
                                          ? "#ffffff"
                                          : "#332211",
                                    }}
                                  >
                                    {formatRisk(riskValue)}
                                  </span>

                                  {risk.risk_coverage < 3 && (

                                    <small
                                      style={{
                                        display: "block",
                                        fontSize: "11px",
                                        color: "#8b735e",
                                        marginTop: "4px",
                                      }}
                                    >
                                      Partial assessment
                                    </small>

                                  )}

                                </div>

                              )}

                            </td>

                          </tr>
                        );
                      })

                    )}

                  </tbody>

                </table>

              </div>

            </section>

            {/* ==========================
                COMPLIANCE CHECKS
            ========================== */}

            <section
              id="compliance"
              className="content-section"
            >

              <div className="section-header">

                <div>
                  <h2>Compliance Checks</h2>

                  <p>
                    Review compliance records and
                    reported violations.
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

                        <tr key={check.check_id}>

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

            {/* ==========================
                BACK TO TOP
            ========================== */}

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
