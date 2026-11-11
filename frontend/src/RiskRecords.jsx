
import { useEffect, useMemo, useState } from "react";
import "./RiskRecords.css";

// FastAPI backend
const API_URL = "http://127.0.0.1:8000";

// Configuration for both CRUD sections
const CONFIG = {
  hospital: {
    title: "Hospital Utilization",
    endpoint: "/hospital-utilization",
    idField: "visit_id",
    idLabel: "Visit ID",
    fields: [
      { key: "visit_date", label: "Visit Date", type: "date" },
      { key: "service_type", label: "Service Type", type: "text" },
      { key: "reason_category", label: "Reason Category", type: "text" },
      {
        key: "length_of_stay_days",
        label: "Length of Stay (Days)",
        type: "number",
        step: "1",
      },
      {
        key: "estimated_cost_usd",
        label: "Estimated Cost (USD)",
        type: "number",
        step: "0.01",
      },
      {
        key: "transfer_outcome",
        label: "Transfer Outcome",
        type: "text",
      },
      { key: "data_type", label: "Data Type", type: "text" },
    ],
  },
  staffing: {
    title: "Staffing Risk",
    endpoint: "/staffing-risk",
    idField: "staffing_record_id",
    idLabel: "Staffing Record ID",
    fields: [
      { key: "snapshot_date", label: "Snapshot Date", type: "date" },
      { key: "staff_category", label: "Staff Category", type: "text" },
      {
        key: "target_staff_count",
        label: "Target Staff Count",
        type: "number",
        step: "1",
      },
      {
        key: "actual_staff_count",
        label: "Actual Staff Count",
        type: "number",
        step: "1",
      },
      {
        key: "vacancy_count",
        label: "Vacancy Count",
        type: "number",
        step: "1",
      },
      {
        key: "overtime_hours_monthly",
        label: "Monthly Overtime Hours",
        type: "number",
        step: "1",
      },
      {
        key: "staffing_shortage_flag",
        label: "Staffing Shortage",
        type: "select",
        options: ["Yes", "No"],
      },
      { key: "data_type", label: "Data Type", type: "text" },
    ],
  },
};

function emptyForm(config) {
  const values = { [config.idField]: "" };

  config.fields.forEach((field) => {
    values[field.key] =
      field.key === "data_type" ? "synthetic" : "";
  });

  return values;
}

// Convert HTTP errors into readable messages
async function readResponse(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.detail;

    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg).join("; ")
      : typeof detail === "string"
      ? detail
      : `Request failed: HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}

export default function RiskRecords() {
  const [category, setCategory] = useState("hospital");
  const [facilities, setFacilities] = useState([]);
  const [facilityId, setFacilityId] = useState("");
  const [facilitySearch, setFacilitySearch] = useState("");

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(
    () => emptyForm(CONFIG.hospital)
  );

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const config = CONFIG[category];

  // Retrieve facilities when the component opens
  useEffect(() => {
    const controller = new AbortController();

    async function loadFacilities() {
      try {
        const response = await fetch(`${API_URL}/facilities`, {
          signal: controller.signal,
        });

        const data = await readResponse(response);
        setFacilities(data);
      } catch (err) {
        if (err.name !== "AbortError") {
          setError(`Unable to load facilities: ${err.message}`);
        }
      }
    }

    loadFacilities();

    return () => controller.abort();
  }, []);

  // Search facilities by name, ID, state, or county
  const matchingFacilities = useMemo(() => {
    const query = facilitySearch.toLowerCase().trim();

    const matches = facilities.filter((facility) => {
      const text = [
        facility.facility_id,
        facility.facility_name,
        facility.state,
        facility.county,
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(query);
    });

    // Limit dropdown size for thousands of facilities
    const visible = matches.slice(0, 50);

    // Always keep the selected facility in the dropdown
    const selected = facilities.find(
      (facility) => facility.facility_id === facilityId
    );

    if (
      selected &&
      !visible.some((f) => f.facility_id === facilityId)
    ) {
      visible.unshift(selected);
    }

    return { visible, count: matches.length };
  }, [facilities, facilitySearch, facilityId]);

  // Retrieve records for the selected facility
  useEffect(() => {
    if (!facilityId) {
      setRecords([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError("");

      try {
        const url =
          `${API_URL}${config.endpoint}` +
          `?facility_id=${encodeURIComponent(facilityId)}`;

        const response = await fetch(url, {
          signal: controller.signal,
        });

        const data = await readResponse(response);

        if (!controller.signal.aborted) {
          setRecords(data);
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

    load();

    return () => controller.abort();
  }, [category, facilityId, config.endpoint]);

  // Refresh table after a successful mutation
  async function refreshRecords() {
    const url =
      `${API_URL}${config.endpoint}` +
      `?facility_id=${encodeURIComponent(facilityId)}`;

    const response = await fetch(url);
    const data = await readResponse(response);
    setRecords(data);
  }

  function changeCategory(nextCategory) {
    setCategory(nextCategory);
    setForm(emptyForm(CONFIG[nextCategory]));
    setEditingId(null);
    setShowForm(false);
    setError("");
    setMessage("");
    setRecords([]);
  }

  function changeFacility(id) {
    setFacilityId(id);
    setEditingId(null);
    setShowForm(false);
    setError("");
    setMessage("");
    setRecords([]);
  }

  function startCreate() {
    setForm(emptyForm(config));
    setEditingId(null);
    setShowForm(true);
    setError("");
    setMessage("");
  }

  function startEdit(record) {
    const values = {
      [config.idField]: record[config.idField],
    };

    config.fields.forEach((field) => {
      values[field.key] = record[field.key] ?? "";
    });

    setForm(values);
    setEditingId(record[config.idField]);
    setShowForm(true);
    setError("");
    setMessage("");
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm(config));
    setError("");
  }

  function updateField(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  // CREATE or UPDATE
  async function handleSubmit(event) {
    event.preventDefault();

    if (!facilityId) {
      setError("Please select a facility.");
      return;
    }

    if (!editingId && !String(form[config.idField]).trim()) {
      setError(`${config.idLabel} is required.`);
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const payload = {
      facility_id: facilityId,
    };

    if (!editingId) {
      payload[config.idField] =
        String(form[config.idField]).trim();
    }

    config.fields.forEach((field) => {
      const raw = form[field.key];

      if (raw === "" || raw === null || raw === undefined) {
        payload[field.key] = null;
      } else if (field.type === "number") {
        payload[field.key] = Number(raw);
      } else {
        payload[field.key] = raw;
      }
    });

    const isEditing = editingId !== null;
    const method = isEditing ? "PUT" : "POST";

    const url = isEditing
      ? `${API_URL}${config.endpoint}/${encodeURIComponent(editingId)}`
      : `${API_URL}${config.endpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      await readResponse(response);
      await refreshRecords();

      setMessage(
        isEditing
          ? "Record updated successfully."
          : "Record created successfully."
      );

      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm(config));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // DELETE
  async function handleDelete(record) {
    const recordId = record[config.idField];

    const confirmed = window.confirm(
      `Delete ${config.title} record ${recordId}?\n\n` +
      "This will permanently remove the record from PostgreSQL."
    );

    if (!confirmed) return;

    setDeletingId(recordId);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}${config.endpoint}/${encodeURIComponent(recordId)}`,
        { method: "DELETE" }
      );

      await readResponse(response);
      await refreshRecords();

      setMessage(`Record ${recordId} deleted successfully.`);

      if (editingId === recordId) {
        cancelForm();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  function displayValue(record, field) {
    const value = record[field.key];

    if (value === null || value === undefined || value === "") {
      return "—";
    }

    if (field.key === "estimated_cost_usd") {
      return Number(value).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
    }

    return String(value);
  }

  return (
    <div className="rr-page">
      <div className="rr-header">
        <h1>Hospital & Staffing Management</h1>
        <p>
          Manage facility healthcare utilization and staffing records
          through the PostgreSQL database.
        </p>
      </div>

      {/* Category tabs */}
      <div className="rr-tabs">
        <button
          type="button"
          className={category === "hospital" ? "active" : ""}
          onClick={() => changeCategory("hospital")}
        >
          Hospital Utilization
        </button>

        <button
          type="button"
          className={category === "staffing" ? "active" : ""}
          onClick={() => changeCategory("staffing")}
        >
          Staffing Risk
        </button>
      </div>

      {/* Facility selection */}
      <section className="rr-card">
        <h2>Select Facility</h2>

        <div className="rr-facility-grid">
          <label className="rr-field">
            <span>Search Facilities</span>
            <input
              type="text"
              placeholder="Name, ID, state, or county..."
              value={facilitySearch}
              onChange={(e) => setFacilitySearch(e.target.value)}
            />
          </label>

          <label className="rr-field">
            <span>Facility</span>
            <select
              value={facilityId}
              onChange={(e) => changeFacility(e.target.value)}
            >
              <option value="">Choose a facility</option>

              {matchingFacilities.visible.map((facility) => (
                <option
                  key={facility.facility_id}
                  value={facility.facility_id}
                >
                  {facility.facility_name} ({facility.state}) —{" "}
                  {facility.facility_id}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="rr-hint">
          {matchingFacilities.count} matching facilities.
          {matchingFacilities.count > 50 &&
            " Showing the first 50; refine your search."}
        </p>
      </section>

      {/* Notifications */}
      {error && (
        <div className="rr-alert rr-error" role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className="rr-alert rr-success" role="status">
          {message}
        </div>
      )}

      {/* Records table */}
      <section className="rr-card">
        <div className="rr-section-header">
          <div>
            <h2>{config.title} Records</h2>
            <p>
              {facilityId
                ? `${records.length} records for selected facility`
                : "Select a facility to view its records"}
            </p>
          </div>

          <button
            type="button"
            className="rr-button rr-primary"
            onClick={startCreate}
            disabled={!facilityId}
          >
            + Add Record
          </button>
        </div>

        {loading ? (
          <p className="rr-empty">Loading records...</p>
        ) : !facilityId ? (
          <p className="rr-empty">
            Choose a facility above to get started.
          </p>
        ) : records.length === 0 ? (
          <p className="rr-empty">
            No {config.title.toLowerCase()} records found for this
            facility.
          </p>
        ) : (
          <div className="rr-table-scroll">
            <table className="rr-table">
              <thead>
                <tr>
                  <th>{config.idLabel}</th>
                  {config.fields.map((field) => (
                    <th key={field.key}>{field.label}</th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {records.map((record) => {
                  const id = record[config.idField];

                  return (
                    <tr key={id}>
                      <td className="rr-record-id">{id}</td>

                      {config.fields.map((field) => (
                        <td key={field.key}>
                          {displayValue(record, field)}
                        </td>
                      ))}

                      <td>
                        <div className="rr-actions">
                          <button
                            type="button"
                            className="rr-button rr-edit"
                            onClick={() => startEdit(record)}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="rr-button rr-delete"
                            disabled={deletingId === id}
                            onClick={() => handleDelete(record)}
                          >
                            {deletingId === id
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create / Edit form */}
      {showForm && facilityId && (
        <section className="rr-card rr-form-card">
          <div className="rr-section-header">
            <div>
              <h2>
                {editingId
                  ? `Edit ${config.title} Record`
                  : `Add ${config.title} Record`}
              </h2>
              <p>
                Changes are saved to PostgreSQL through FastAPI.
              </p>
            </div>

            <button
              type="button"
              className="rr-button"
              onClick={cancelForm}
            >
              Close
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="rr-form-grid">
              <label className="rr-field">
                <span>{config.idLabel} *</span>
                <input
                  type="text"
                  value={form[config.idField] ?? ""}
                  disabled={editingId !== null}
                  required
                  onChange={(e) =>
                    updateField(
                      config.idField,
                      e.target.value
                    )
                  }
                />
              </label>

              <label className="rr-field">
                <span>Facility ID</span>
                <input
                  type="text"
                  value={facilityId}
                  disabled
                />
              </label>

              {config.fields.map((field) => (
                <label className="rr-field" key={field.key}>
                  <span>{field.label}</span>

                  {field.type === "select" ? (
                    <select
                      value={form[field.key] ?? ""}
                      onChange={(e) =>
                        updateField(field.key, e.target.value)
                      }
                    >
                      <option value="">Not specified</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      min={
                        field.type === "number"
                          ? "0"
                          : undefined
                      }
                      step={field.step}
                      value={form[field.key] ?? ""}
                      onChange={(e) =>
                        updateField(field.key, e.target.value)
                      }
                    />
                  )}
                </label>
              ))}
            </div>

            <div className="rr-form-actions">
              <button
                type="button"
                className="rr-button"
                onClick={cancelForm}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="rr-button rr-primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId
                  ? "Save Changes"
                  : "Create Record"}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
