from typing import Optional, List, Union, Any
from datetime import datetime
from pydantic import BaseModel, Field, field_validator, ConfigDict
from app.userid import normalize_user_id


# Info section models
class TableInfoPayload(BaseModel):
    vpsId: str = Field(..., description="Canonical table identity")
    rom: Optional[str] = Field(None, description="ROM name")


# VPX File section models
class VPXFilePayload(BaseModel):
    filename: str
    filehash: str
    version: str
    releaseDate: Optional[str] = None
    saveDate: Optional[str] = None
    saveRev: Optional[str] = None
    manufacturer: Optional[str] = None
    year: Optional[str] = None
    type: Optional[str] = None
    vbsHash: str
    rom: str
    detectNfozzy: bool = False
    detectFleep: bool = False
    detectSSF: bool = False
    detectLUT: bool = False
    detectScorebit: bool = False
    detectFastflips: bool = False
    detectFlex: bool = False


# User section models
class UserStatePayload(BaseModel):
    rating: Optional[int] = Field(None, ge=0, le=5, description="Rating 0-5")
    lastRun: Optional[Union[str, int]] = None
    startCount: int = 0
    runTime: int = 0

    @field_validator('lastRun', mode='before')
    @classmethod
    def convert_unix_timestamp(cls, v):
        if v is None:
            return None
        if isinstance(v, int):
            # Convert Unix timestamp to ISO string
            return datetime.fromtimestamp(v).isoformat()
        return v


# VPinPlay section models
class VPinPlayPayload(BaseModel):
    alttitle: Optional[str] = None
    altvpsid: Optional[str] = None


# Source info section
class SourceInfo(BaseModel):
    program: str
    programVersion: str


# Client info section
class ClientInfo(BaseModel):
    userId: str
    machineId: str = Field(..., min_length=64, max_length=64, description="64-character machine identifier")

    @field_validator('userId', mode='before')
    @classmethod
    def normalize_user_id_value(cls, v):
        if isinstance(v, str):
            return normalize_user_id(v)
        return v


# Individual table in sync payload
class TableSyncPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    info: TableInfoPayload
    user: UserStatePayload
    vpxFile: VPXFilePayload
    vpinfe: VPinPlayPayload
    score: Optional[dict[str, Any]] = Field(None, alias="Score")


# Full sync request
class FullSyncRequest(BaseModel):
    source: SourceInfo
    client: ClientInfo
    sentAt: str
    tables: List[TableSyncPayload]


# Global table document (returned from GET)
class GlobalTableResponse(BaseModel):
    vpsId: str
    rom: Optional[str] = None
    vpxFile: VPXFilePayload
    submittedByUserIdsNormalized: Optional[List[str]] = None
    firstSeenByUserIdNormalized: Optional[str] = None
    alttitle: Optional[str] = None
    altvpsid: Optional[str] = None
    vpsdb: Optional[dict[str, Any]] = None
    createdAt: Optional[datetime] = None
    updatedAt: datetime
    lastSeenAt: datetime


# User table state document (returned from GET)
class UserTableStateResponse(BaseModel):
    userId: str
    vpsId: str
    rating: Optional[int] = None
    lastRun: Optional[str] = None
    startCount: int
    runTime: int
    score: Optional[dict[str, Any]] = None
    alttitle: Optional[str] = None
    altvpsid: Optional[str] = None
    vpsdb: Optional[dict[str, Any]] = None
    createdAt: Optional[datetime] = None
    updatedAt: datetime
    lastSeenAt: datetime


# Sync response
class SyncSummary(BaseModel):
    tablesReceived: int
    tablesCreated: int
    tablesUpdated: int
    userStatesCreated: int
    userStatesUpdated: int
    unchanged: int
    errors: int


class SyncResponse(BaseModel):
    status: str
    receivedAt: datetime
    summary: SyncSummary
