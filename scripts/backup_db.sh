#!/usr/bin/env bash
# Nightly SQLite backup for the barangay portal backend.
#
# Usage:  ./scripts/backup_db.sh
# Cron:   0 2 * * * /workspaces/KOLABTINGON/scripts/backup_db.sh
#
# Keeps the 14 most recent backups in backups/. Copy that directory off-host
# (object storage / NAS) — a backup on the same disk is not a backup.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
python3 - <<EOF
import sqlite3
src = sqlite3.connect('storage.db')
dst = sqlite3.connect('backups/storage-${STAMP}.db')
with dst:
    src.backup(dst)
dst.close()
src.close()
EOF

# Prune everything past the 14 newest.
ls -t backups/storage-*.db 2>/dev/null | tail -n +15 | xargs -r rm --
echo "backup written: backups/storage-${STAMP}.db"
