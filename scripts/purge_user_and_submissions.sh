#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  purge_user_and_submissions.sh <user_id> [--container NAME] [--db NAME] [--yes]

Options:
  --container NAME   Mongo container name (default: vpinplay_mongo)
  --db NAME          Mongo database name (default: vpinplay_db)
  --yes              Skip confirmation prompt
  -h, --help         Show this help

Example:
  ./scripts/purge_user_and_submissions.sh superhac --yes
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

USER_ID=""
MONGO_CONTAINER="vpinplay_mongo"
DB_NAME="vpinplay_db"
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --container)
      MONGO_CONTAINER="${2:-}"
      shift 2
      ;;
    --db)
      DB_NAME="${2:-}"
      shift 2
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$USER_ID" ]]; then
        USER_ID="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$USER_ID" ]]; then
  echo "Missing required <user_id>." >&2
  usage
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not found in PATH." >&2
  exit 1
fi

USER_NORMALIZED="$(printf '%s' "$USER_ID" | tr '[:upper:]' '[:lower:]' | xargs)"

echo "Target user: $USER_NORMALIZED"
echo "Mongo container: $MONGO_CONTAINER"
echo "Database: $DB_NAME"

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "This will delete this user and related submitted table records. Continue? [y/N] " REPLY
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

JS="
const user = '$USER_NORMALIZED';
const escapeRegex = (value) => value.replace(/[.*+?^\\\\\${}()|[\\]\\\\]/g, '\\\\$&');
const userFilter = {
  \$or: [
    { userIdNormalized: user },
    { userId: { \$regex: '^' + escapeRegex(user) + '\$', \$options: 'i' } },
  ],
};

const before = {
  clientRegistry: db.client_registry.countDocuments(userFilter),
  userTableState: db.user_table_state.countDocuments(userFilter),
  userTableStateDeltas: db.user_table_state_deltas.countDocuments(userFilter),
  userTableRatings: db.user_table_ratings.countDocuments(userFilter),
  tablesWithOwnershipTag: db.tables.countDocuments({
    submittedByUserIdsNormalized: { \$regex: '^' + escapeRegex(user) + '\$', \$options: 'i' },
  }),
};

const deleted = {
  clientRegistry: db.client_registry.deleteMany(userFilter).deletedCount,
  userTableState: db.user_table_state.deleteMany(userFilter).deletedCount,
  userTableStateDeltas: db.user_table_state_deltas.deleteMany(userFilter).deletedCount,
  userTableRatings: db.user_table_ratings.deleteMany(userFilter).deletedCount,
};

const tableRowsOwnedByUser = db.tables
  .find(
    {
      submittedByUserIdsNormalized: { \$regex: '^' + escapeRegex(user) + '\$', \$options: 'i' },
    },
    { _id: 1 }
  )
  .toArray()
  .map((doc) => doc._id);

const ownershipRemoved = db.tables.updateMany(
  {
    submittedByUserIdsNormalized: { \$regex: '^' + escapeRegex(user) + '\$', \$options: 'i' },
  },
  {
    \$pull: {
      submittedByUserIdsNormalized: {
        \$regex: '^' + escapeRegex(user) + '\$',
        \$options: 'i',
      },
    },
  }
).modifiedCount;

const tableRowsWithoutSubmittersDeleted = db.tables.deleteMany({
  _id: { \$in: tableRowsOwnedByUser },
  \$or: [
    { submittedByUserIdsNormalized: { \$exists: false } },
    { submittedByUserIdsNormalized: { \$size: 0 } },
  ],
}).deletedCount;

const activeVpsIds = db.user_table_state.distinct('vpsId');
const orphanedTableRowsDeleted = db.tables.deleteMany({
  vpsId: { \$nin: activeVpsIds },
}).deletedCount;

printjson({
  userId: user,
  before,
  deleted,
  tables: {
    ownershipRemoved,
    tableRowsWithoutSubmittersDeleted,
    orphanedTableRowsDeleted,
    activeVpsIdCount: activeVpsIds.length,
  },
});
"

docker exec -i "$MONGO_CONTAINER" mongosh "$DB_NAME" --quiet --eval "$JS"
