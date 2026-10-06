from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Facility(Base):
    __tablename__ = "facility"

    facility_id = Column(String, primary_key=True)
    facility_name = Column(String)
    county = Column(String)
    state = Column(String)


class ComplianceCheck(Base):
    __tablename__ = "compliance_check"

    check_id = Column(String, primary_key=True)
    facility_id = Column(String, ForeignKey("facility.facility_id"))
    violation_count = Column(Integer)