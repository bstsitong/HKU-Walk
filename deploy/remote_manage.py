"""Run a management command using an ignored local JSON file of server variables.

Example: python deploy/remote_manage.py --config .local/cloud-env.json check --deploy
Keep that JSON file private: it contains the database URL and server secrets.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--config", required=True)
parser.add_argument("command", nargs=argparse.REMAINDER)
args = parser.parse_args()
if not args.command:
    parser.error("A Django management command is required.")
config = json.loads(Path(args.config).read_text(encoding="utf-8"))
if not isinstance(config, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in config.items()):
    parser.error("The private configuration must be a JSON object of environment-variable strings.")
root = Path(__file__).resolve().parents[1]
env = {**os.environ, **config, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
env.setdefault("DJANGO_DATA_DIR", str(root / ".local" / "cloud-cli"))
raise SystemExit(subprocess.call([sys.executable, str(root / "server/manage.py"), *args.command], cwd=root, env=env))
