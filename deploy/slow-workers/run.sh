#!/bin/sh
# Starts both engines and restarts either if it exits. Each binds inside the container; compose maps them to 127.0.0.1 only.
set -u
run() { while true; do "$@"; echo "exited ($?), restarting in 5 s: $*"; sleep 5; done; }
cd /srv/bettafish && run /venv/bettafish/bin/python asimog_worker.py --port 7410 &
cd /srv/miroshark/backend && FLASK_PORT=7411 run /venv/miroshark/bin/python run.py &
wait
