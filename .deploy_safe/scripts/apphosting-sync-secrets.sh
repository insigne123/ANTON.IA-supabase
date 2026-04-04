#!/usr/bin/env bash

set -euo pipefail

SOURCE_PROJECT="${SOURCE_PROJECT:-leadflowai-3yjcy}"
TARGET_PROJECT="${TARGET_PROJECT:-studio-6624658482-61b7b}"
BACKEND="${BACKEND:-studio}"
LOCATION="${LOCATION:-us-central1}"

copy_secret() {
  local name="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  trap 'rm -f "$tmp_file"' RETURN

  echo "[sync] copying ${name} from ${SOURCE_PROJECT} to ${TARGET_PROJECT}"
  gcloud secrets versions access latest --secret="${name}" --project="${SOURCE_PROJECT}" > "${tmp_file}"
  firebase apphosting:secrets:set "${name}" -P "${TARGET_PROJECT}" --data-file "${tmp_file}" -f

  rm -f "${tmp_file}"
  trap - RETURN
}

ensure_env_secret() {
  local name="$1"
  local value="${!name:-}"
  if [[ -n "$value" ]]; then
    return
  fi

  read -rsp "Enter value for ${name}: " value
  echo
  if [[ -z "$value" ]]; then
    echo "[error] ${name} is required" >&2
    exit 1
  fi
  export "$name=$value"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[error] missing required command: $1" >&2
    exit 1
  fi
}

require_cmd firebase
require_cmd gcloud

ensure_env_secret VANE_AUTH_HEADER_VALUE
ensure_env_secret LEAD_RESEARCH_WORKER_SECRET

for secret_name in \
  APOLLO_API_KEY \
  AZURE_AD_CLIENT_SECRET \
  GOOGLE_CLIENT_SECRET \
  SUPABASE_SERVICE_ROLE_KEY \
  TRACKING_WEBHOOK_SECRET \
  ANTONIA_TICK_SECRET
do
  copy_secret "$secret_name"
done

printf '%s' "$VANE_AUTH_HEADER_VALUE" | \
  firebase apphosting:secrets:set VANE_AUTH_HEADER_VALUE -P "$TARGET_PROJECT" --data-file - -f

printf '%s' "$LEAD_RESEARCH_WORKER_SECRET" | \
  firebase apphosting:secrets:set LEAD_RESEARCH_WORKER_SECRET -P "$TARGET_PROJECT" --data-file - -f

firebase apphosting:secrets:grantaccess \
  APOLLO_API_KEY,AZURE_AD_CLIENT_SECRET,GOOGLE_CLIENT_SECRET,SUPABASE_SERVICE_ROLE_KEY,VANE_AUTH_HEADER_VALUE,LEAD_RESEARCH_WORKER_SECRET,ANTONIA_TICK_SECRET,TRACKING_WEBHOOK_SECRET \
  -P "$TARGET_PROJECT" \
  -b "$BACKEND" \
  -l "$LOCATION"

firebase deploy --only apphosting -P "$TARGET_PROJECT"

echo
echo "[done] app hosting secrets synced and deploy triggered for ${TARGET_PROJECT}/${BACKEND}"
