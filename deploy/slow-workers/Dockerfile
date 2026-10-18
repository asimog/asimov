# One persistent container for both Python engines (docs/24 3.1): BettaFish worker on 7410, MiroShark backend on 7411.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /srv
COPY services/bettafish/engine/requirements.txt bettafish/requirements.txt
RUN uv venv /venv/bettafish && VIRTUAL_ENV=/venv/bettafish uv pip install --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu -r bettafish/requirements.txt
COPY services/miroshark/engine/backend/pyproject.toml services/miroshark/engine/backend/uv.lock miroshark/backend/
RUN cd miroshark/backend && UV_PROJECT_ENVIRONMENT=/venv/miroshark uv sync --frozen --no-install-project
COPY services/bettafish/engine bettafish
COPY services/miroshark/engine/backend miroshark/backend
COPY deploy/slow-workers/run.sh /srv/run.sh
CMD ["sh", "/srv/run.sh"]
