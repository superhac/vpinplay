# VPinPlay Table Metadata Sync Service

A Python REST API service for syncing VPinPlay table metadata using MongoDB as the backend.

## Prerequisites

- Docker and Docker Compose

## Quick Start

### 1. Clone and setup environment

```bash
cp .env.example .env
```

### 2. Start with Docker Compose

```bash
docker-compose up --build
```

This will start:
- **API Server**: http://localhost:8888
- **MongoDB**: mongodb://localhost:27017

### 3. Access the API

- **Health check**: http://localhost:8888/health
- **API root**: http://localhost:8888/

## API Endpoints

### Sync submission
- `POST /api/v1/sync` - Submit full table state snapshot from a client
- `GET /api/v1/sync/last` - Get the most recent successful sync across all users

### Table queries
- `GET /api/v1/tables` - Get all table variation rows (paginated, default 50)
- `GET /api/v1/tables/count` - Get total table counts (`totalTableRows` and `uniqueVpsIdCount`)
- `GET /api/v1/tables/by-filehash/{filehash}` - Resolve a matching `vpsId` from `vpxFile.filehash`; also returns `altvpsid` if set on any matching table row (returns `vpsId: null` when no match exists)
- `GET /api/v1/tables/{vpsId}` - Get canonical table metadata
- `GET /api/v1/tables/top-rated` - Get top tables by average rating across all users (paginated via `limit` + `offset`, max 100 per request, default limit 5)
- `GET /api/v1/tables/top-play-time` - Get top tables by cumulative `runTime` across all users (highest first, paginated via `limit` + `offset`, max 100 per request, default limit 5)
- `GET /api/v1/tables/top-variants` - Get top tables by total variant count (highest first, paginated via `limit` + `offset`, max 100 per request, default limit 5)
- `GET /api/v1/tables/activity-weekly` - Get cumulative global play activity from sync deltas for trailing N days (default `days=7`)
- `GET /api/v1/tables/{vpsId}/rating-summary` - Get cumulative average rating + rating count for a specific table
- `GET /api/v1/tables/{vpsId}/cumulative-rating` - Get cumulative average rating (`cumulativeRating`) + rating count for a specific table
- `GET /api/v1/tables/newly-added` - Get cumulatively new tables seen globally (first time each `vpsId` was observed, paginated via `limit` + `offset`)
- `GET /api/v1/vpsdb/{vpsId}` - Get cached VPS DB selected fields for a specific `vpsId`
- `GET /api/v1/vpsdb/status` - Get VPS DB background sync status

### User state queries
- `GET /api/v1/users` - Get all registered userIds (paginated via `limit` + `offset`, max 100 per request)
- `GET /api/v1/users/count` - Get total number of registered users
- `GET /api/v1/users/top-activity` - Get top users by trailing N-day activity from sync deltas (`metric=startCountPlayed|runTimePlayed`, `days`, `limit`, `offset`; max 100 per request)
- `GET /api/v1/users/{userId}/available` - Check if userId is available for registration
- `GET /api/v1/users/{userId}/last-sync` - Get the user's last successful sync timestamp
- `GET /api/v1/users/{userId}/tables/{vpsId}` - Get user state for a table
- `GET /api/v1/users/{userId}/tables` - Get all tables for a user (paginated via `limit` + `offset`, max 100 per request)
- `GET /api/v1/users/{userId}/tables/count` - Get total synced table count for a user (includes variations from last full sync, also returns unique canonical count)
- `GET /api/v1/users/{userId}/tables/runtime-sum` - Get total runTime across all tables for a user
- `GET /api/v1/users/{userId}/tables/runtime-weekly` - Get runtime played over trailing N days from sync deltas (default `days=7`)
- `GET /api/v1/users/{userId}/tables/start-count-sum` - Get total startCount across all tables for a user
- `GET /api/v1/users/{userId}/tables/start-count-weekly` - Get plays over trailing N days from sync deltas (default `days=7`)
- `GET /api/v1/users/{userId}/tables/top-rated` - Get top N highest-rated tables for a user (paginated via `limit` + `offset`, max 100 per request)
- `GET /api/v1/users/{userId}/tables/recently-played` - Get most recently played tables for a user by `lastRun` (newest first, paginated via `limit` + `offset`, max 100 per request)
- `GET /api/v1/users/{userId}/tables/top-play-time` - Get top tables for a user by `runTime` (highest first, paginated via `limit` + `offset`, max 100 per request)
- `GET /api/v1/users/{userId}/tables/most-played` - Get most played tables for a user by `startCount` (highest first, paginated via `limit` + `offset`, max 100 per request)
- `GET /api/v1/users/{userId}/tables/newly-added` - Get newest tables added for a user by first-seen timestamp (paginated via `limit` + `offset`, max 100 per request)

All query responses that include `vpsId` now include a `vpsdb` object from the VPS DB cache when available. By default, it includes `name`, `authors`, `manufacturer`, and `year`.

Weekly runtime/play analytics are derived from per-sync `runTime` and `startCount` deltas and only count positive increments. Data is available from when this tracking is active onward.

Global `tables` variation rows now track submitting users via `submittedByUserIdsNormalized`. This enables per-user global cleanup without wiping all table metadata. Variations created before this provenance field existed cannot be attributed retroactively until they are seen again in a sync.

## Project Structure

```
.
├── Dockerfile              # Docker container definition
├── docker-compose.yml      # Compose config for API + MongoDB
├── requirements.txt        # Python dependencies
├── .dockerignore           # Files to exclude from Docker build
├── .env.example            # Environment variables template
├── design_doc.md           # Design specification
└── app/
    ├── main.py             # FastAPI app and setup
    ├── models.py           # Pydantic request/response models
    ├── dependencies.py     # Database dependencies and utilities
    ├── response_enrichment.py # Shared response enrichment helpers
    ├── vpsdb.py            # VPS DB sync and cache helpers
    └── routers/
        ├── sync.py         # POST /api/v1/sync endpoint
        ├── tables.py       # GET /api/v1/tables/* + vpsdb endpoints
        └── users.py        # GET /api/v1/users/* endpoints
```

## Development

### Run locally (without Docker)

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Run tests

Tests can be added to a `tests/` directory and run with:

```bash
pytest
```

## Configuration

Environment variables (see `.env.example`):

- `MONGO_URL` - MongoDB connection string (default: `mongodb://localhost:27017`)
- `MONGO_DB_NAME` - Database name (default: `vpinplay_db`)
- `VPSDB_URL` - Source JSON URL (default: official VPS DB raw JSON URL)
- `VPSDB_SYNC_INTERVAL_SECONDS` - Refresh interval for VPS DB sync loop (default: `3600` = 1 hour)
- `VPSDB_SELECTED_FIELDS` - Comma-separated VPS DB keys to cache/enrich (default: `name,authors,manufacturer,year`)

## API Example

Submit a full sync:

```bash
curl -X POST http://localhost:8888/api/v1/sync \
  -H "Content-Type: application/json" \
  -d @sync_payload.json
```

Query a table:

```bash
curl http://localhost:8888/api/v1/tables/lkSumsrF
```

Query user table state:

```bash
curl http://localhost:8888/api/v1/users/cabinet_1/tables/lkSumsrF
```

Check if userId is available:

```bash
curl http://localhost:8888/api/v1/users/cabinet_1/available
# Returns: {"available": false}
```

Delete a user and their submitted records (maintenance script):

```bash
./scripts/purge_user_and_submissions.sh cabinet_1 --yes
```

## Testing

### Web Interface

Open `test.html` in your browser for a complete web interface to test all API endpoints:

- Check API health
- Test user availability
- Submit sample sync data with 3 test tables
- View table metadata and user states
- Browse all user tables in a formatted table

### Manual Testing

Use the curl commands above or any HTTP client to test the endpoints directly.

## Design Documentation

See [design_doc.md](design_doc.md) for the full specification including:
- Data model and collections
- Merge and sync rules
- Validation rules
- Future extensions
