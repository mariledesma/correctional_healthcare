
/* =========================================
   1. API CONFIGURATION
========================================= */

// FastAPI backend address
const API_URL = "http://127.0.0.1:8000";

// Store the data loaded from the database
let facilities = [];
let complianceChecks = [];
let allFacilities = [];

// Track whether the form is adding or editing
let editingCheckId = null;


/* =========================================
   2. HTML ELEMENTS
========================================= */

// Summary cards
const totalFacilitiesEl = document.getElementById("total-facilities");
const totalChecksEl = document.getElementById("total-checks");
const totalViolationsEl = document.getElementById("total-violations");

// Table bodies
const facilitiesTable = document.getElementById("facilities-table");
const complianceTable = document.getElementById("compliance-table");

// Status message
const statusMessage = document.getElementById("status-message");

// Modal and form
const modal = document.getElementById("check-modal");
const modalTitle = document.getElementById("modal-title");
const checkForm = document.getElementById("check-form");

const checkIdInput = document.getElementById("check-id");
const facilityIdInput = document.getElementById("facility-id");
const violationCountInput = document.getElementById("violation-count");


/* =========================================
   3. HELPER FUNCTIONS
========================================= */

// Safely display database text inside HTML
function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}


// Display a success or error message
function showMessage(message, type = "success") {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;

    // Hide the message after a few seconds
    setTimeout(() => {
        statusMessage.className = "status-message";
        statusMessage.textContent = "";
    }, 5000);
}


// Send a request to FastAPI and handle errors
async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers
        }
    });

    // Read the response body
    const data = await response.json().catch(() => null);

    // Show an error if the request failed
    if (!response.ok) {
        const message =
            data?.detail || `Request failed with status ${response.status}`;

        throw new Error(message);
    }

    return data;
}


/* =========================================
   4. LOAD DATABASE DATA
========================================= */

// Fetch facilities and compliance checks
async function loadDashboard() {
    facilitiesTable.innerHTML =
        '<tr><td colspan="5">Loading facilities...</td></tr>';

    complianceTable.innerHTML =
        '<tr><td colspan="5">Loading compliance checks...</td></tr>';

    try {
        // Request both tables from FastAPI
        const [facilityData, checkData] = await Promise.all([
            apiRequest("/facilities"),
            apiRequest("/compliance-checks")
        ]);

        facilities = facilityData;
        allFacilities = facilityData;
        complianceChecks = checkData;
        populateStateFilter();
        populateCountyFilter();

        // Update the dashboard
        updateSummaryCards();
        renderFacilities();
        renderComplianceChecks();

    } catch (error) {
        facilitiesTable.innerHTML =
            '<tr><td colspan="5">Unable to load facilities.</td></tr>';

        complianceTable.innerHTML =
            '<tr><td colspan="5">Unable to load compliance checks.</td></tr>';

        showMessage(error.message, "error");
    }
}


/* =========================================
   5. UPDATE SUMMARY CARDS
========================================= */

function updateSummaryCards() {
    // Count the facilities
    totalFacilitiesEl.textContent = facilities.length;

    // Count the compliance records
    totalChecksEl.textContent = complianceChecks.length;

    // Add the violation counts
    const totalViolations = complianceChecks.reduce(
        (total, check) => total + Number(check.violation_count || 0),
        0
    );

    totalViolationsEl.textContent = totalViolations;
}
//func to filter by state on front page
function populateStateFilter() {
    const stateFilter = document.getElementById("stateFilter");

    const states = [...new Set(
        allFacilities
            .map(facility => facility.state)
            .filter(Boolean)
    )].sort();

    stateFilter.innerHTML = '<option value="ALL">All States</option>';

    states.forEach(state => {
        const option = document.createElement("option");
        option.value = state;
        option.textContent = state;
        stateFilter.appendChild(option);
    });
}

function populateCountyFilter(selectedState = "ALL") {
    const countyFilter = document.getElementById("countyFilter");

    let availableFacilities = allFacilities;

    if (selectedState !== "ALL") {
        availableFacilities = allFacilities.filter(
            facility => String(facility.state).trim() === selectedState
        );
    }

    const counties = [...new Set(
        availableFacilities
            .map(facility => facility.county)
            .filter(Boolean)
            .map(county => String(county).trim())
    )].sort();

    countyFilter.innerHTML = '<option value="ALL">All Counties</option>';

    counties.forEach(county => {
        const option = document.createElement("option");
        option.value = county;
        option.textContent = county;
        countyFilter.appendChild(option);
    });
}

/* =========================================
   6. DISPLAY FACILITIES
========================================= */

function renderFacilities() {
    if (facilities.length === 0) {
        facilitiesTable.innerHTML =
            '<tr><td colspan="5">No facilities found.</td></tr>';
        return;
    }

    facilitiesTable.innerHTML = facilities.map(facility => `
        <tr>
            <td>${escapeHTML(facility.facility_id)}</td>
            <td>${escapeHTML(facility.facility_name)}</td>
            <td>${escapeHTML(facility.county)}</td>
            <td>${escapeHTML(facility.state)}</td>
            <td>
                <button
                    class="edit-btn"
                    data-facility-id="${escapeHTML(facility.facility_id)}"
                    onclick="viewFacilityCompliance(this.dataset.facilityId)">
                    View Checks
                </button>
            </td>
        </tr>
    `).join("");
}


/* =========================================
   7. DISPLAY COMPLIANCE CHECKS
========================================= */

function renderComplianceChecks() {
    if (complianceChecks.length === 0) {
        complianceTable.innerHTML =
            '<tr><td colspan="5">No compliance checks found.</td></tr>';
        return;
    }

    complianceTable.innerHTML = complianceChecks.map(check => `
        <tr>
            <td>${escapeHTML(check.check_id)}</td>
            <td>${escapeHTML(check.facility_id)}</td>
            <td>${escapeHTML(check.violation_count)}</td>
            <td>
                <button
                    class="edit-btn"
                    data-check-id="${escapeHTML(check.check_id)}"
                    onclick="openEditModal(this.dataset.checkId)">
                    Edit
                </button>

                <button
                    class="delete-btn"
                    data-check-id="${escapeHTML(check.check_id)}"
                    onclick="deleteComplianceCheck(this.dataset.checkId)">
                    Delete
                </button>
            </td>
        </tr>
    `).join("");
}


/* =========================================
   8. VIEW FACILITY COMPLIANCE
========================================= */

// Show compliance checks for a selected facility
function viewFacilityCompliance(facilityId) {
    const matchingChecks = complianceChecks.filter(
        check => String(check.facility_id) === String(facilityId)
    );

    if (matchingChecks.length === 0) {
        showMessage("No compliance checks found for this facility.", "error");
        return;
    }

    // Scroll to the compliance table
    document.getElementById("compliance").scrollIntoView({
        behavior: "smooth"
    });

    // Display only this facility's checks
    complianceTable.innerHTML = matchingChecks.map(check => `
        <tr>
            <td>${escapeHTML(check.check_id)}</td>
            <td>${escapeHTML(check.facility_id)}</td>
            <td>${escapeHTML(check.violation_count)}</td>
            <td>
                <button
                    class="edit-btn"
                    data-check-id="${escapeHTML(check.check_id)}"
                    onclick="openEditModal(this.dataset.checkId)">
                    Edit
                </button>

                <button
                    class="delete-btn"
                    data-check-id="${escapeHTML(check.check_id)}"
                    onclick="deleteComplianceCheck(this.dataset.checkId)">
                    Delete
                </button>
            </td>
        </tr>
    `).join("");

    showMessage(`Showing compliance checks for facility ${facilityId}.`);
}


/* =========================================
   9. OPEN ADD MODAL
========================================= */

function openAddModal() {
    // Reset the form for a new record
    checkForm.reset();

    editingCheckId = null;

    modalTitle.textContent = "Add Compliance Check";
    checkIdInput.disabled = false;

    modal.classList.remove("hidden");
}


/* =========================================
   10. OPEN EDIT MODAL
========================================= */

function openEditModal(checkId) {
    // Find the selected compliance record
    const check = complianceChecks.find(
        item => String(item.check_id) === String(checkId)
    );

    if (!check) {
        showMessage("Compliance check not found.", "error");
        return;
    }

    // Store the original ID
    editingCheckId = check.check_id;

    // Fill in the existing record
    modalTitle.textContent = "Edit Compliance Check";

    checkIdInput.value = check.check_id;
    checkIdInput.disabled = true;

    facilityIdInput.value = check.facility_id;
    violationCountInput.value = check.violation_count;

    modal.classList.remove("hidden");
}


/* =========================================
   11. CLOSE MODAL
========================================= */

function closeModal() {
    modal.classList.add("hidden");
    checkForm.reset();

    editingCheckId = null;
    checkIdInput.disabled = false;
}


/* =========================================
   12. ADD OR UPDATE COMPLIANCE CHECK
========================================= */

checkForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    // Read the form values
    const checkId = checkIdInput.value.trim();
    const facilityId = facilityIdInput.value.trim();
    const violationCount = Number(violationCountInput.value);

    // Validate the input
    if (!checkId || !facilityId) {
        showMessage("Please fill in all required fields.", "error");
        return;
    }

    if (
        violationCountInput.value === "" ||
        !Number.isInteger(violationCount) ||
        violationCount < 0
    ) {
        showMessage("Enter a valid non-negative whole number.", "error");
        return;
    }

    // Build the request body
    const requestBody = {
        facility_id: facilityId,
        violation_count: violationCount
    };

    try {
        if (editingCheckId !== null) {
            // PUT: Update an existing compliance check
            await apiRequest(
                `/compliance-checks/${encodeURIComponent(editingCheckId)}`,
                {
                    method: "PUT",
                    body: JSON.stringify(requestBody)
                }
            );

            showMessage("Compliance check updated successfully.");

        } else {
            // POST: Create a new compliance check
            await apiRequest("/compliance-checks", {
                method: "POST",
                body: JSON.stringify({
                    check_id: checkId,
                    ...requestBody
                })
            });

            showMessage("Compliance check created successfully.");
        }

        // Close the form and reload database data
        closeModal();
        await loadDashboard();

    } catch (error) {
        showMessage(error.message, "error");
    }
});


/* =========================================
   13. DELETE COMPLIANCE CHECK
========================================= */

async function deleteComplianceCheck(checkId) {
    // Ask before deleting a database record
    const confirmed = confirm(
        `Are you sure you want to delete compliance check ${checkId}?`
    );

    if (!confirmed) {
        return;
    }

    try {
        // DELETE: Remove the selected compliance check
        await apiRequest(
            `/compliance-checks/${encodeURIComponent(checkId)}`,
            {
                method: "DELETE"
            }
        );

        showMessage("Compliance check deleted successfully.");

        // Reload the dashboard
        await loadDashboard();

    } catch (error) {
        showMessage(error.message, "error");
    }
}


/* =========================================
   14. BUTTON EVENT LISTENERS
========================================= */

// Open the add form
document.getElementById("add-check-btn").addEventListener("click", openAddModal);

// Close the modal
document.getElementById("close-modal-btn").addEventListener("click", closeModal);
document.getElementById("cancel-btn").addEventListener("click", closeModal);

// Refresh the dashboard
document.getElementById("refresh-btn").addEventListener("click", loadDashboard);


/* =========================================
   15. INITIALIZE DASHBOARD
========================================= */

// Load the database data when the page opens
loadDashboard();
document.getElementById("stateFilter").addEventListener("change", function () {
    const selectedState = this.value;

    populateCountyFilter(selectedState);

    if (selectedState === "ALL") {
        facilities = [...allFacilities];
    } else {
        facilities = allFacilities.filter(
            facility => String(facility.state).trim() === selectedState
        );
    }

    renderFacilities();
});
document.getElementById("countyFilter").addEventListener("change", function () {
    const selectedState = document.getElementById("stateFilter").value;
    const selectedCounty = this.value;

    facilities = allFacilities.filter(facility => {
        const matchesState =
            selectedState === "ALL" ||
            String(facility.state).trim() === selectedState;

        const matchesCounty =
            selectedCounty === "ALL" ||
            String(facility.county).trim() === selectedCounty;

        return matchesState && matchesCounty;
    });

    renderFacilities();
});

//back to top button
const backToTopButton = document.getElementById("back-to-top");

window.addEventListener("scroll", function () {
    if (window.scrollY > 400) {
        backToTopButton.style.display = "block";
    } else {
        backToTopButton.style.display = "none";
    }
});

backToTopButton.addEventListener("click", function () {
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
});