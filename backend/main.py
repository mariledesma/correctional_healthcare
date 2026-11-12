from datetime import date
from decimal import Decimal

from collections import defaultdict
from sqlalchemy import func, case

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy import Column, Text, Integer, Date, Numeric, ForeignKey
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Facility, ComplianceCheck, HospitalUtilization, StaffingRisk


# ----------------------------
# Pydantic request models
# ----------------------------

class ComplianceCheckCreate(BaseModel):
    check_id: str
    facility_id: str
    violation_count: int = Field(ge=0)


class ComplianceCheckUpdate(BaseModel):
    facility_id: str
    violation_count: int = Field(ge=0)


class HospitalCreate(BaseModel):
    visit_id: str
    facility_id: str
    visit_date: date | None = None
    service_type: str | None = None
    reason_category: str | None = None
    length_of_stay_days: int | None = Field(default=None, ge=0)
    estimated_cost_usd: Decimal | None = Field(default=None, ge=0)
    transfer_outcome: str | None = None
    data_type: str | None = None


class HospitalUpdate(BaseModel):
    facility_id: str | None = None
    visit_date: date | None = None
    service_type: str | None = None
    reason_category: str | None = None
    length_of_stay_days: int | None = Field(default=None, ge=0)
    estimated_cost_usd: Decimal | None = Field(default=None, ge=0)
    transfer_outcome: str | None = None
    data_type: str | None = None


class StaffingCreate(BaseModel):
    staffing_record_id: str
    facility_id: str
    snapshot_date: date | None = None
    staff_category: str | None = None
    target_staff_count: int | None = Field(default=None, ge=0)
    actual_staff_count: int | None = Field(default=None, ge=0)
    vacancy_count: int | None = Field(default=None, ge=0)
    overtime_hours_monthly: int | None = Field(default=None, ge=0)
    staffing_shortage_flag: str | None = None
    data_type: str | None = None


class StaffingUpdate(BaseModel):
    facility_id: str | None = None
    snapshot_date: date | None = None
    staff_category: str | None = None
    target_staff_count: int | None = Field(default=None, ge=0)
    actual_staff_count: int | None = Field(default=None, ge=0)
    vacancy_count: int | None = Field(default=None, ge=0)
    overtime_hours_monthly: int | None = Field(default=None, ge=0)
    staffing_shortage_flag: str | None = None
    data_type: str | None = None


# ----------------------------
# FastAPI application
# ----------------------------

app = FastAPI(title="Correctional Healthcare API")

# Local development CORS settings. Restrict allowed origins before deployment.
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


def require_facility(db: Session, facility_id: str):
    if not facility_id or not db.get(Facility, facility_id):
        raise HTTPException(status_code=404, detail="Facility not found")


def save_record(db: Session, record):
    """Commit one new or updated record, and rollback on constraint failure."""
    try:
        db.commit()
        db.refresh(record)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Database constraint violation")
    return jsonable_encoder(record)


def delete_record(db: Session, record):
    try:
        db.delete(record)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Record cannot be deleted")


# ----------------------------
# Health and facilities
# ----------------------------

@app.get("/")
def root():
    return {"message": "Correctional Healthcare API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/facilities")
def get_facilities(db: Session = Depends(get_db)):
    return jsonable_encoder(db.query(Facility).all())


# ----------------------------
# Compliance CRUD
# ----------------------------

@app.get("/compliance-checks")
def get_compliance_checks(db: Session = Depends(get_db)):
    return jsonable_encoder(db.query(ComplianceCheck).all())


@app.get("/facilities/{facility_id}/compliance")
def get_facility_compliance(facility_id: str, db: Session = Depends(get_db)):
    result = (
        db.query(
            Facility.facility_id,
            Facility.facility_name,
            Facility.state,
            ComplianceCheck.check_id,
            ComplianceCheck.violation_count,
        )
        .join(
            ComplianceCheck,
            Facility.facility_id == ComplianceCheck.facility_id,
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
            "violation_count": row.violation_count,
        }
        for row in result
    ]


@app.post("/compliance-checks", status_code=201)
def create_compliance_check(
    check: ComplianceCheckCreate, db: Session = Depends(get_db)
):
    require_facility(db, check.facility_id)
    if db.get(ComplianceCheck, check.check_id):
        raise HTTPException(status_code=409, detail="Compliance check ID already exists")

    record = ComplianceCheck(
        check_id=check.check_id,
        facility_id=check.facility_id,
        violation_count=check.violation_count,
    )
    db.add(record)
    return save_record(db, record)


@app.put("/compliance-checks/{check_id}")
def update_compliance_check(
    check_id: str, check: ComplianceCheckUpdate, db: Session = Depends(get_db)
):
    record = db.get(ComplianceCheck, check_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Compliance check not found")

    require_facility(db, check.facility_id)
    record.facility_id = check.facility_id
    record.violation_count = check.violation_count
    return save_record(db, record)


@app.delete("/compliance-checks/{check_id}")
def delete_compliance_check(check_id: str, db: Session = Depends(get_db)):
    record = db.get(ComplianceCheck, check_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Compliance check not found")
    delete_record(db, record)
    return {"message": "Compliance check deleted successfully", "check_id": check_id}


@app.get("/facilities/{facility_id}/summary")
def get_facility_summary(facility_id: str, db: Session = Depends(get_db)):
    facility = db.get(Facility, facility_id)
    if facility is None:
        raise HTTPException(status_code=404, detail="Facility not found")

    summary = (
        db.query(
            func.count(ComplianceCheck.check_id).label("total_checks"),
            func.coalesce(func.sum(ComplianceCheck.violation_count), 0).label(
                "total_violations"
            ),
        )
        .filter(ComplianceCheck.facility_id == facility_id)
        .first()
    )
    return {
        "facility_id": facility.facility_id,
        "facility_name": facility.facility_name,
        "state": facility.state,
        "total_checks": summary.total_checks,
        "total_violations": summary.total_violations,
    }


# ----------------------------
# Hospital Utilization CRUD
# ----------------------------

@app.get("/hospital-utilization")
def get_hospital_records(
    facility_id: str | None = None, db: Session = Depends(get_db)
):
    query = db.query(HospitalUtilization)
    if facility_id is not None:
        query = query.filter(HospitalUtilization.facility_id == facility_id)
    return jsonable_encoder(
        query.order_by(HospitalUtilization.visit_date.desc()).all()
    )


@app.get("/hospital-utilization/{visit_id}")
def get_hospital_record(visit_id: str, db: Session = Depends(get_db)):
    record = db.get(HospitalUtilization, visit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Hospital record not found")
    return jsonable_encoder(record)


@app.post("/hospital-utilization", status_code=201)
def create_hospital_record(data: HospitalCreate, db: Session = Depends(get_db)):
    require_facility(db, data.facility_id)
    if db.get(HospitalUtilization, data.visit_id):
        raise HTTPException(status_code=409, detail="Visit ID already exists")
    record = HospitalUtilization(**data.dict())
    db.add(record)
    return save_record(db, record)


@app.put("/hospital-utilization/{visit_id}")
def update_hospital_record(
    visit_id: str, data: HospitalUpdate, db: Session = Depends(get_db)
):
    record = db.get(HospitalUtilization, visit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Hospital record not found")

    changes = data.dict(exclude_unset=True)
    if "facility_id" in changes:
        if not changes["facility_id"]:
            raise HTTPException(status_code=422, detail="Facility ID cannot be empty")
        require_facility(db, changes["facility_id"])
    for field, value in changes.items():
        setattr(record, field, value)
    return save_record(db, record)


@app.delete("/hospital-utilization/{visit_id}")
def delete_hospital_record(visit_id: str, db: Session = Depends(get_db)):
    record = db.get(HospitalUtilization, visit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Hospital record not found")
    delete_record(db, record)
    return {"message": "Hospital record deleted", "visit_id": visit_id}


# ----------------------------
# Staffing Risk CRUD
# ----------------------------

@app.get("/staffing-risk")
def get_staffing_records(
    facility_id: str | None = None, db: Session = Depends(get_db)
):
    query = db.query(StaffingRisk)
    if facility_id is not None:
        query = query.filter(StaffingRisk.facility_id == facility_id)
    return jsonable_encoder(query.order_by(StaffingRisk.snapshot_date.desc()).all())


@app.get("/staffing-risk/{record_id}")
def get_staffing_record(record_id: str, db: Session = Depends(get_db)):
    record = db.get(StaffingRisk, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Staffing record not found")
    return jsonable_encoder(record)


@app.post("/staffing-risk", status_code=201)
def create_staffing_record(data: StaffingCreate, db: Session = Depends(get_db)):
    require_facility(db, data.facility_id)
    if db.get(StaffingRisk, data.staffing_record_id):
        raise HTTPException(status_code=409, detail="Staffing record ID already exists")
    record = StaffingRisk(**data.dict())
    db.add(record)
    return save_record(db, record)


@app.put("/staffing-risk/{record_id}")
def update_staffing_record(
    record_id: str, data: StaffingUpdate, db: Session = Depends(get_db)
):
    record = db.get(StaffingRisk, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Staffing record not found")

    changes = data.dict(exclude_unset=True)
    if "facility_id" in changes:
        if not changes["facility_id"]:
            raise HTTPException(status_code=422, detail="Facility ID cannot be empty")
        require_facility(db, changes["facility_id"])
    for field, value in changes.items():
        setattr(record, field, value)
    return save_record(db, record)


@app.delete("/staffing-risk/{record_id}")
def delete_staffing_record(record_id: str, db: Session = Depends(get_db)):
    record = db.get(StaffingRisk, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Staffing record not found")
    delete_record(db, record)
    return {"message": "Staffing record deleted", "record_id": record_id}


# =====================================================
# FACILITY RISK SCORES
# =====================================================

@app.get("/facility-risks")
def get_facility_risks(db: Session = Depends(get_db)):
    """
    Calculate demonstration risk indices for all facilities.

    Compliance: % of checks with violations.
    Hospital: % of measured stays >= 5 days.
    Staffing: vacancy % relative to a 30% reference.
    Overall: 40/30/30 weighted average of available scores.
    """

    # 1. Aggregate compliance records by facility.
    # This prevents duplicate counts from multi-table joins.
    compliance_rows = (
        db.query(
            ComplianceCheck.facility_id,
            func.count(ComplianceCheck.check_id).label("checks"),
            func.sum(
                case(
                    (ComplianceCheck.violation_count > 0, 1),
                    else_=0
                )
            ).label("flagged_checks"),
            func.coalesce(
                func.sum(ComplianceCheck.violation_count), 0
            ).label("violations"),
        )
        .group_by(ComplianceCheck.facility_id)
        .all()
    )

    compliance_data = {
        row.facility_id: {
            "checks": int(row.checks),
            "flagged": int(row.flagged_checks or 0),
            "violations": int(row.violations or 0),
        }
        for row in compliance_rows
    }

    # 2. Aggregate hospital visits.
    # Only stays with known duration enter the long-stay rate.
    hospital_rows = (
        db.query(
            HospitalUtilization.facility_id,
            func.count(HospitalUtilization.visit_id).label("visits"),
            func.count(
                HospitalUtilization.length_of_stay_days
            ).label("measured_stays"),
            func.sum(
                case(
                    (
                        HospitalUtilization.length_of_stay_days >= 5,
                        1
                    ),
                    else_=0
                )
            ).label("long_stays"),
        )
        .group_by(HospitalUtilization.facility_id)
        .all()
    )

    hospital_data = {
        row.facility_id: {
            "visits": int(row.visits),
            "measured": int(row.measured_stays),
            "long_stays": int(row.long_stays or 0),
        }
        for row in hospital_rows
    }

    # 3. Read staffing records.
    # Multiple staffing snapshots may exist per facility.
    staffing_rows = (
        db.query(StaffingRisk)
        .order_by(
            StaffingRisk.facility_id,
            StaffingRisk.staff_category,
            StaffingRisk.snapshot_date.desc().nullslast(),
            StaffingRisk.staffing_record_id.desc()
        )
        .all()
    )

    staffing_record_counts = defaultdict(int)
    latest_staffing = {}

    for record in staffing_rows:
        staffing_record_counts[record.facility_id] += 1

        key = (
            record.facility_id,
            record.staff_category
        )

        # First row is the latest for this facility/category.
        if key not in latest_staffing:
            latest_staffing[key] = record

    staffing_data = defaultdict(
        lambda: {
            "target": 0,
            "vacancies": 0,
            "shortage": False,
        }
    )

    # Only use the latest staffing snapshot for each category.
    for record in latest_staffing.values():
        item = staffing_data[record.facility_id]

        target = record.target_staff_count
        actual = record.actual_staff_count
        vacancy = record.vacancy_count

        flag = str(
            record.staffing_shortage_flag or ""
        ).strip().lower()

        if flag in ("yes", "true", "1", "y"):
            item["shortage"] = True

        if target is None or target <= 0:
            continue

        if vacancy is None and actual is not None:
            vacancy = max(0, target - actual)

        if vacancy is None:
            continue

        vacancy = max(0, min(vacancy, target))

        item["target"] += target
        item["vacancies"] += vacancy

        if vacancy > 0:
            item["shortage"] = True

    # 4. Calculate scores for every facility.
    results = []

    for facility in db.query(Facility).all():
        facility_id = facility.facility_id

        c = compliance_data.get(facility_id)
        h = hospital_data.get(facility_id)
        s = staffing_data.get(facility_id)

        compliance_score = None
        hospital_score = None
        staffing_score = None

        if c and c["checks"] > 0:
            compliance_score = (
                100 * c["flagged"] / c["checks"]
            )

        if h and h["measured"] > 0:
            hospital_score = (
                100 * h["long_stays"] / h["measured"]
            )

        if s and s["target"] > 0:
            vacancy_pct = (
                100 * s["vacancies"] / s["target"]
            )

            # The 30% reference is a configurable
            # demonstration threshold, not an official rule.
            staffing_score = min(
                100, vacancy_pct / 30 * 100
            )

        components = [
            (0.40, compliance_score),
            (0.30, hospital_score),
            (0.30, staffing_score),
        ]
        available = [
            (weight, score)
            for weight, score in components
            if score is not None
        ]
        if available:
            weighted_sum = sum(
                weight * score
                for weight, score in available
            )
            total_weight = sum(
                weight for weight, score in available
            )
            overall_risk = round(
                weighted_sum / total_weight, 1
            )
        else:
            overall_risk = None

        results.append({
            "facility_id": facility_id,
            "facility_name": facility.facility_name,

            "compliance_checks": (
                c["checks"] if c else 0
            ),
            "total_violations": (
                c["violations"] if c else 0
            ),
            "hospital_visits": (
                h["visits"] if h else 0
            ),
            "staffing_records": staffing_record_counts.get(
                facility_id, 0
            ),
            "staffing_vacancies": (
                s["vacancies"] if s else 0
            ),
            "has_staffing_shortage": (
                s["shortage"] if s else False
            ),

            "compliance_risk_pct": (
                round(compliance_score, 1)
                if compliance_score is not None
                else None
            ),
            "hospital_risk_pct": (
                round(hospital_score, 1)
                if hospital_score is not None
                else None
            ),
            "staffing_risk_pct": (
                round(staffing_score, 1)
                if staffing_score is not None
                else None
            ),
            "risk_pct": overall_risk,
            "risk_coverage": len(available),
        })

    return results
