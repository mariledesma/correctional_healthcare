
from sqlalchemy import Column, Text, Integer, Date, Numeric, ForeignKey
from sqlalchemy.orm import declarative_base

Base = declarative_base()


# ==========================================
# FACILITY MODEL
# ==========================================

class Facility(Base):
    __tablename__ = "facility"

    facility_id = Column(Text, primary_key=True)
    facility_name = Column(Text)
    county = Column(Text)
    state = Column(Text)
    latitude = Column(Numeric(10, 8))
    longitude = Column(Numeric(11, 8))


# ==========================================
# COMPLIANCE CHECK MODEL
# ==========================================

class ComplianceCheck(Base):
    __tablename__ = "compliance_check"

    check_id = Column(Text, primary_key=True)
    facility_id = Column(
        Text,
        ForeignKey("facility.facility_id")
    )
    violation_count = Column(Integer)


# ==========================================
# HOSPITAL UTILIZATION MODEL
# ==========================================

class HospitalUtilization(Base):
    __tablename__ = "hospital_utilization"

    visit_id = Column(Text, primary_key=True)
    facility_id = Column(
        Text,
        ForeignKey("facility.facility_id"),
        nullable=False
    )
    visit_date = Column(Date)
    service_type = Column(Text)
    reason_category = Column(Text)
    length_of_stay_days = Column(Integer)
    estimated_cost_usd = Column(Numeric(12, 2))
    transfer_outcome = Column(Text)
    data_type = Column(Text)


# ==========================================
# STAFFING RISK MODEL
# ==========================================

class StaffingRisk(Base):
    __tablename__ = "staffing_risk"

    staffing_record_id = Column(Text, primary_key=True)
    facility_id = Column(
        Text,
        ForeignKey("facility.facility_id"),
        nullable=False
    )
    snapshot_date = Column(Date)
    staff_category = Column(Text)
    target_staff_count = Column(Integer)
    actual_staff_count = Column(Integer)
    vacancy_count = Column(Integer)
    overtime_hours_monthly = Column(Integer)
    staffing_shortage_flag = Column(Text)
    data_type = Column(Text)
