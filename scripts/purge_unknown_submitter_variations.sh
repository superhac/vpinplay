#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  purge_unknown_submitter_variations.sh [--submitter NAME] [--container NAME] [--db NAME] [--yes]

Options:
  --submitter NAME   Submitter tag to purge (default: Unknown)
  --container NAME   Mongo container name (default: vpinplay_mongo)
  --db NAME          Mongo database name (default: vpinplay_db)
  --yes              Skip confirmation prompt
  -h, --help         Show this help

Example:
  ./scripts/purge_unknown_submitter_variations.sh --yes
EOF
}

SUBMITTER="Unknown"
MONGO_CONTAINER="vpinplay_mongo"
DB_NAME="vpinplay_db"
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --submitter)
      SUBMITTER="${2:-}"
      shift 2
      ;;
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
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SUBMITTER" ]]; then
  echo "--submitter cannot be empty." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not found in PATH." >&2
  exit 1
fi

SUBMITTER_NORMALIZED="$(printf '%s' "$SUBMITTER" | tr '[:upper:]' '[:lower:]' | xargs)"

if [[ -z "$SUBMITTER_NORMALIZED" ]]; then
  echo "Submitter cannot be empty after normalization." >&2
  exit 1
fi

echo "Target submitter: $SUBMITTER_NORMALIZED"
echo "Mongo container: $MONGO_CONTAINER"
echo "Database: $DB_NAME"

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "This will permanently delete table variations submitted by '$SUBMITTER_NORMALIZED'. Continue? [y/N] " REPLY
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

JS="
const submitter = '$SUBMITTER_NORMALIZED';
const escapeRegex = (value) => value.replace(/[.*+?^\\\\\${}()|[\\]\\\\]/g, '\\\\$&');
const submitterFilter = {
  submittedByUserIdsNormalized: {
    \$regex: '^' + escapeRegex(submitter) + '\$',
    \$options: 'i',
  },
};

const before = {
  matchingTableVariations: db.tables.countDocuments(submitterFilter),
};

const deleted = {
  tableVariations: db.tables.deleteMany(submitterFilter).deletedCount,
};

printjson({
  submitter,
  before,
  deleted,
});
"

docker exec -i "$MONGO_CONTAINER" mongosh "$DB_NAME" --quiet --eval "$JS"
