#!/usr/bin/env python3
"""Restore official accounts (and everything else) from a JSON snapshot.

Snapshots are written automatically next to the database on every backend
boot (`backups/boot-*.json`), and nightly full copies by `backup_db.sh`.
Use this after the database file was wiped — fresh clone, host redeploy
without a persistent disk, or an accidental delete.

Usage:
    python3 scripts/restore_data.py backups/boot-20260101-120000.json
    python3 scripts/restore_data.py <snapshot> --db /data/storage.db

Safe by design: keys are UPSERTED, nothing is ever deleted, so restoring
cannot remove accounts created after the snapshot was taken.
"""

import argparse
import json
import os
import sqlite3
import sys

try:
    from dotenv import load_dotenv  # keep parity with backend.py env handling
    load_dotenv()
except ImportError:
    pass

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resolve_db(explicit):
    raw = explicit or os.environ.get('STORAGE_DB_PATH', '') or os.path.join(BASE_DIR, 'storage.db')
    return raw if os.path.isabs(raw) else os.path.join(BASE_DIR, raw)


def main():
    parser = argparse.ArgumentParser(description='Restore a JSON snapshot into storage.db (upsert only).')
    parser.add_argument('snapshot', help='Snapshot JSON file (backups/boot-*.json)')
    parser.add_argument('--db', default='', help='Database path (default: STORAGE_DB_PATH or ./storage.db)')
    args = parser.parse_args()

    with open(args.snapshot, 'r', encoding='utf-8') as fh:
        snap = json.load(fh)
    data = snap.get('data', {})
    if not isinstance(data, dict) or not data:
        sys.exit('Snapshot holds no data — nothing to restore.')

    db_path = resolve_db(args.db)
    conn = sqlite3.connect(db_path, timeout=30)
    conn.execute('PRAGMA busy_timeout = 5000')
    with conn:
        conn.execute('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        conn.executemany(
            'INSERT INTO kv_store (key, value) VALUES (?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [(k, v if isinstance(v, str) else json.dumps(v)) for k, v in data.items()],
        )
    conn.close()
    print(f'restored {len(data)} keys into {db_path} (existing keys kept where not in snapshot)')


if __name__ == '__main__':
    main()
