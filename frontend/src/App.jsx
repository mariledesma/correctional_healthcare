import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";

function App() {
  const [allFacilities, setAllFacilities] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [complianceChecks, setComplianceChecks] = useState([]);

  const [selectedState, setSelectedState] = useState("ALL");
  const [selectedCounty, setSelectedCounty] = useState("ALL");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  function handleStateChange(event) {
    const state = event.target.value;

    setSelectedState(state);
    setSelectedCounty("ALL");

    const filtered =
      state === "ALL"
        ? allFacilities
        : allFacilities.filter(
            (facility) => String(facility.state).trim() === state
          );

    setFacilities(filtered);
  }

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

  const totalViolations = complianceChecks.reduce(
    (sum, check) => sum + Number(check.violation_count || 0),
    0
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <img src="/sun.png" alt="Sunrise Care logo" className="sidebar-logo" />

          <h2>Sunrise Care</h2>
          <p>Correctional Healthcare</p>
        </div>

        <nav>
          <a href="#dashboard">Dashboard</a>
          <a href="#facilities">Facilities</a>
          <a href="#compliance">Compliance Checks</a>
        </nav>
      </aside>

      <main className="main-content">
        <section id="dashboard" className="page-header">
          <div>
            <h1>Operational Dashboard</h1>
            <p>
              Facility compliance monitoring and healthcare risk management.
            </p>
          </div>

          <button className="refresh-button" onClick={loadDashboard}>
            Refresh Data
          </button>
        </section>

        {error && <div className="error-message">{error}</div>}

        <section className="summary-grid">
          <div className="summary-card">
            <p>Total Facilities</p>
            <h2>{allFacilities.length.toLocaleString()}</h2>
          </div>

          <div className="summary-card">
            <p>Total Compliance Checks</p>
            <h2>{complianceChecks.length.toLocaleString()}</h2>
          </div>

          <div className="summary-card">
            <p>Total Violations</p>
            <h2>{totalViolations.toLocaleString()}</h2>
          </div>
        </section>

        <section id="facilities" className="content-section">
          <div className="section-header">
            <div>
              <h2>Facilities</h2>
              <p>
                View facilities registered in the database by state and county.
              </p>
            </div>

            <div className="facility-filters">
              <select value={selectedState} onChange={handleStateChange}>
                <option value="ALL">All States</option>

                {states.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>

              <select value={selectedCounty} onChange={handleCountyChange}>
                <option value="ALL">All Counties</option>

                {counties.map((county) => (
                  <option key={county} value={county}>
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
                    <td colSpan="4">Loading facilities...</td>
                  </tr>
                ) : facilities.length === 0 ? (
                  <tr>
                    <td colSpan="4">No facilities found.</td>
                  </tr>
                ) : (
                  facilities.map((facility) => (
                    <tr key={facility.facility_id}>
                      <td>{facility.facility_id}</td>
                      <td>{facility.facility_name}</td>
                      <td>{facility.county || "—"}</td>
                      <td>{facility.state}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section id="compliance" className="content-section">
          <div className="section-header">
            <div>
              <h2>Compliance Checks</h2>
              <p>Review compliance records and reported violations.</p>
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
                    <td colSpan="3">Loading compliance checks...</td>
                  </tr>
                ) : complianceChecks.length === 0 ? (
                  <tr>
                    <td colSpan="3">No compliance checks found.</td>
                  </tr>
                ) : (
                  complianceChecks.map((check) => (
                    <tr key={check.check_id}>
                      <td>{check.check_id}</td>
                      <td>{check.facility_id}</td>
                      <td>{check.violation_count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <button
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
      </main>
    </div>
  );
}

export default App;