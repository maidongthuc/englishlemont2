"""Copy data.json into Supabase once. Run: python migrate_data.py

Stops if the database already has sentences, so it can't overwrite newer data by accident.
Pass --force to replace what is in the database with data.json anyway.
"""
import json
import sys
from pathlib import Path

from app import DataError, load_data, save_data

source = Path(__file__).with_name("data.json")
data = json.loads(source.read_text(encoding="utf-8"))

try:
    current = load_data()
    if (current["items"] or current["books"]) and "--force" not in sys.argv:
        sys.exit(f"The database already has {len(current['books'])} notebooks and {len(current['items'])} sentences. "
                 "Nothing copied. Use --force to replace them with data.json.")
    save_data(data)
    saved = load_data()
except DataError as e:
    sys.exit(str(e))

print(f"Copied {len(saved['books'])} notebooks and {len(saved['items'])} sentences to Supabase.")
