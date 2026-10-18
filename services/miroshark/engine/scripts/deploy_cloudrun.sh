#!/usr/bin/env bash
# Deploy MiroShark API to Google Cloud Run (europe-west1, project: bazodiac)
set -euo pipefail

PROJECT="bazodiac"
REGION="europe-west1"
SERVICE="miroshark-api"
REPO="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy"
IMAGE="${REPO}/${SERVICE}"
TAG="${1:-latest}"

echo "==> Building and pushing ${IMAGE}:${TAG}"
gcloud builds submit \
  --project="${PROJECT}" \
  --config=cloudbuild.yaml \
  --substitutions="_IMAGE=${IMAGE}:${TAG}" \
  .

echo "==> Deploying ${SERVICE} to Cloud Run"
gcloud run deploy "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --image="${IMAGE}:${TAG}" \
  --port=8080 \
  --memory=4Gi \
  --cpu=2 \
  --min-instances=1 \
  --max-instances=3 \
  --timeout=300 \
  --concurrency=10 \
  --no-allow-unauthenticated \
  --env-vars-file=cloudrun.env.yaml \
  --health-check-http-target-path=/health

echo "==> Done. Service URL:"
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)"
