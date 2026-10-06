from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field

from database import SessionLocal
from models import Facility, ComplianceCheck


# Request body for creating a compliance check
class ComplianceCheckCreate(BaseModel):
    check_id: str
    facility_id: str
    violation_count: int = Field(ge=0)


# Request body for updating a compliance check
class ComplianceCheckUpdate(BaseModel):
    facility_id: str
    violation_count: int = Field(ge=0)

app = FastAPI(title="Correctional Healthcare API")
# Allow the frontend to communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()


@app.get("/")
def root():
    return {"message": "Correctional Healthcare API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/facilities")
def get_facilities(db: Session = Depends(get_db)):
    facilities = db.query(Facility).all()

    return facilities

@app.get("/compliance-checks")
def get_compliance_checks(db: Session = Depends(get_db)):
    checks = db.query(ComplianceCheck).all()

    return checks

@app.get("/facilities/{facility_id}/compliance")
def get_facility_compliance(
    facility_id: str,
    db: Session = Depends(get_db)
):
    result = (
        db.query(
            Facility.facility_id,
            Facility.facility_name,
            Facility.state,
            ComplianceCheck.check_id,
            ComplianceCheck.violation_count
        )
        .join(
            ComplianceCheck,
            Facility.facility_id == ComplianceCheck.facility_id
        )
        .filter(Facility.facility_id == facility_id)
        .all()
    )

    return [
        {
            "facility_id": row.facility_id,
            "facility_name": row.facility_name,
            "state": row.state,
            "check_id": row.check_id,
            "violation_count": row.violation_count
        }
        for row in result
    ]
# POST: Create a new compliance check
@app.post("/compliance-checks", status_code=201)
def create_compliance_check(
    check: ComplianceCheckCreate,
    db: Session = Depends(get_db)
):
    # Check whether the facility exists
    facility = (
        db.query(Facility)
        .filter(Facility.facility_id == check.facility_id)
        .first()
    )

    if not facility:
        raise HTTPException(
            status_code=404,
            detail="Facility not found"
        )

    # Check whether the compliance check ID already exists
    existing_check = (
        db.query(ComplianceCheck)
        .filter(ComplianceCheck.check_id == check.check_id)
        .first()
    )

    if existing_check:
        raise HTTPException(
            status_code=409,
            detail="Compliance check ID already exists"
        )

    # Create the new compliance check
    new_check = ComplianceCheck(
        check_id=check.check_id,
        facility_id=check.facility_id,
        violation_count=check.violation_count
    )

    # Save the new record
    db.add(new_check)
    db.commit()
    db.refresh(new_check)

    # Return the created record
    return {
        "check_id": new_check.check_id,
        "facility_id": new_check.facility_id,
        "violation_count": new_check.violation_count
    }
# PUT: Update an existing compliance check
@app.put("/compliance-checks/{check_id}")
def update_compliance_check(
    check_id: str,
    check: ComplianceCheckUpdate,
    db: Session = Depends(get_db)
):
    # Find the existing compliance check
    existing_check = (
        db.query(ComplianceCheck)
        .filter(ComplianceCheck.check_id == check_id)
        .first()
    )

    if not existing_check:
        raise HTTPException(
            status_code=404,
            detail="Compliance check not found"
        )

    # Verify that the new facility ID exists
    facility = (
        db.query(Facility)
        .filter(Facility.facility_id == check.facility_id)
        .first()
    )

    if not facility:
        raise HTTPException(
            status_code=404,
            detail="Facility not found"
        )

    # Update the existing record
    existing_check.facility_id = check.facility_id
    existing_check.violation_count = check.violation_count

    # Save the changes
    db.commit()
    db.refresh(existing_check)

    # Return the updated record
    return {
        "check_id": existing_check.check_id,
        "facility_id": existing_check.facility_id,
        "violation_count": existing_check.violation_count
    }
# DELETE: Remove a compliance check
@app.delete("/compliance-checks/{check_id}")
def delete_compliance_check(
    check_id: str,
    db: Session = Depends(get_db)
):
    # Find the compliance check
    existing_check = (
        db.query(ComplianceCheck)
        .filter(ComplianceCheck.check_id == check_id)
        .first()
    )

    # Return an error if the record does not exist
    if not existing_check:
        raise HTTPException(
            status_code=404,
            detail="Compliance check not found"
        )

    # Delete the record
    db.delete(existing_check)
    db.commit()

    # Confirm deletion
    return {
        "message": "Compliance check deleted successfully",
        "check_id": check_id
    }
# GET: Retrieve a facility summary
@app.get("/facilities/{facility_id}/summary")
def get_facility_summary(
    facility_id: str,
    db: Session = Depends(get_db)
):
    # Find the facility
    facility = (
        db.query(Facility)
        .filter(Facility.facility_id == facility_id)
        .first()
    )

    # Return an error if the facility does not exist
    if not facility:
        raise HTTPException(
            status_code=404,
            detail="Facility not found"
        )

    # Calculate the number of checks and total violations
    summary = (
        db.query(
            func.count(ComplianceCheck.check_id).label("total_checks"),
            func.coalesce(
                func.sum(ComplianceCheck.violation_count), 0
            ).label("total_violations")
        )
        .filter(ComplianceCheck.facility_id == facility_id)
        .first()
    )

    # Return the facility summary
    return {
        "facility_id": facility.facility_id,
        "facility_name": facility.facility_name,
        "state": facility.state,
        "total_checks": summary.total_checks,
        "total_violations": summary.total_violations
    }