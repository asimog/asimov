#!/bin/sh
# Starts both engines and restarts either if it exits. Each binds inside the container; compose maps them to 127.0.0.1 only.
set -u
export PYTHONUTF8=1
run() { while true; do "$@"; echo "exited ($?), restarting in 5 s: $*"; sleep 5; done; }
cd /srv/bettafish && run /venv/bettafish/bin/python asimog_worker.py --host 0.0.0.0 --port 7412 &
cd /srv/miroshark/backend && run /venv/miroshark/bin/python asimog_worker.py --host 0.0.0.0 --port 7411 &
wait
