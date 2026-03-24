import asyncio
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient

from app.dependencies import set_db
from app.routers import sync, tables, users
from app.vpsdb import vpsdb_sync_loop

load_dotenv()

# Configuration
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "vpinplay_db")

# MongoDB client
mongo_client = None
db = None
vpsdb_sync_task: asyncio.Task | None = None
vpsdb_stop_event: asyncio.Event | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global mongo_client, db, vpsdb_sync_task, vpsdb_stop_event
    mongo_client = MongoClient(MONGO_URL)
    db = mongo_client[MONGO_DB_NAME]

    # Set database in dependencies
    set_db(db)

    # Create indexes
    await create_indexes()

    # Start VPS DB background sync loop
    vpsdb_stop_event = asyncio.Event()
    vpsdb_sync_task = asyncio.create_task(vpsdb_sync_loop(db, vpsdb_stop_event))

    print("✓ Connected to MongoDB")
    print(f"✓ Using database: {MONGO_DB_NAME}")

    yield

    # Shutdown
    if vpsdb_stop_event is not None:
        vpsdb_stop_event.set()
    if vpsdb_sync_task is not None:
        await vpsdb_sync_task

    mongo_client.close()
    print("✓ Disconnected from MongoDB")


async def create_indexes():
    """Create recommended indexes for collections

    TODO: Collection structure and indexing will be determined based on
    actual usage patterns and performance requirements.
    For now, using default MongoDB indexing.
    """
    # Indexes for client_registry
    db["client_registry"].create_index("userId", unique=True)
    db["client_registry"].create_index("userIdNormalized")
    db["client_registry"].create_index("machineId")

    # Indexes for tables
    db["tables"].create_index("vpsId")
    db["user_table_state"].create_index([("userIdNormalized", 1), ("vpsId", 1)])
    db["user_table_state"].create_index([("userId", 1), ("vpsId", 1)])
    db["user_table_state"].create_index("userIdNormalized")
    db["user_table_state"].create_index("userId")

    # Indexes for user state deltas (analytics)
    db["user_table_state_deltas"].create_index("changedAt")
    db["user_table_state_deltas"].create_index([("userIdNormalized", 1), ("changedAt", -1)])
    db["user_table_state_deltas"].create_index([("userIdNormalized", 1), ("vpsId", 1), ("changedAt", -1)])
    db["user_table_state_deltas"].create_index([("userId", 1), ("changedAt", -1)])
    db["user_table_state_deltas"].create_index([("userId", 1), ("vpsId", 1), ("changedAt", -1)])

    # Indexes for VPS DB cache
    db["vpsdb_aux"].create_index("vpsId")


# Create FastAPI app
app = FastAPI(
    title="VPinPlay Table Metadata Sync Service",
    description="Metadata sync service for VPinPlay tables",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoint
@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "ok"}


# Include routers
app.include_router(sync.router)
app.include_router(tables.router)
app.include_router(users.router)


@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "service": "VPinPlay Table Metadata Sync Service",
        "version": "0.1.0"
    }
