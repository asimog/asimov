# One persistent container for both Python engines (docs/24 3.1): BettaFish worker on 7410, MiroShark backend on 7411.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /srv
COPY services/bettafish/engine/requirements-asimog.txt bettafish/requirements-asimog.txt
RUN uv venv /venv/bettafish && VIRTUAL_ENV=/venv/bettafish uv pip install --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu -r bettafish/requirements-asimog.txt
COPY services/miroshark/engine/backend/pyproject.toml services/miroshark/engine/backend/uv.lock miroshark/backend/
# the lock pins CUDA torch on Linux: install the same set with CPU torch instead (no GPU here, several GB smaller)
RUN cd miroshark/backend && uv export --frozen --no-hashes --no-emit-project -o /tmp/ms.txt  && grep -vE '^(torch|nvidia-|triton)' /tmp/ms.txt > /tmp/ms-cpu.txt  && uv venv /venv/miroshark && VIRTUAL_ENV=/venv/miroshark uv pip install --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/ms-cpu.txt torch
COPY services/bettafish/engine bettafish
COPY services/miroshark/engine/backend miroshark/backend
COPY deploy/slow-workers/run.sh /srv/run.sh
CMD ["sh", "/srv/run.sh"]
