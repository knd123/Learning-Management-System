#!/usr/bin/env bash
# Deploys Abugida LMS to Google Cloud:
#   Cloud Run (app) + Firestore (database) + Cloud Storage (files)
#   + Secret Manager (secrets) + Cloud Scheduler (reminders, quizzes, reports).
# Safe to re-run: existing resources are kept and the app is redeployed.
#
# Who deploys (pick one):
#   - Your own Google account: run `gcloud auth login` first. The script creates the
#     project if needed and links your billing account (BILLING_ACCOUNT=… if you have
#     several).
#   - A service account: set GOOGLE_SA_KEY to its key (the downloaded JSON file's
#     contents, or base64 of it). It needs the Owner role on an existing project.
#
# Other credentials (environment variables; never commit them):
#   SMTP_APP_PASSWORD  Optional. Password for info@abugidaeducation.com on SMTP_HOST (a Google
#                      app password for Gmail). Without it emails are only recorded in
#                      Admin → Emails.
#   GEMINI_API_KEY     Optional. Turns on AI quizzes, homework drafts and report writing.
#   GOOGLE_CLIENT_ID   Optional. OAuth client ID (Web application) for "Sign in with Google".
#                      Not a secret. When not given, the one already on the service is kept.
#   ADMIN_USERNAME     Optional. The one Abugida team sign-in (default "admin"). Its password is
#                      the lms-admin-password secret. When not given, the one on the service is kept.
#
# Settings (environment variables with defaults):
#   PROJECT=abugida-lms (or the key's project)  REGION=us-east4  DOMAIN=learn.abugidaeducation.com
#   SERVICE=abugida-lms     COMPANY_EMAIL=info@abugidaeducation.com
#   ORG_TIMEZONE=America/New_York
#   SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  SMTP_SECURE=false
#     (GoDaddy mail: SMTP_HOST=smtpout.secureserver.net SMTP_PORT=465 SMTP_SECURE=true)
#   DRY_RUN=1  prints the commands without touching Google Cloud.
set -euo pipefail

REGION="${REGION:-us-east4}"
DOMAIN="${DOMAIN:-learn.abugidaeducation.com}"
SERVICE="${SERVICE:-abugida-lms}"
COMPANY_EMAIL="${COMPANY_EMAIL:-info@abugidaeducation.com}"
ORG_TIMEZONE="${ORG_TIMEZONE:-America/New_York}"
SMTP_HOST="${SMTP_HOST:-smtp.gmail.com}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_SECURE="${SMTP_SECURE:-false}"
DRY_RUN="${DRY_RUN:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
run() {
  echo "+ $*"
  [ -n "$DRY_RUN" ] || "$@"
}
# True when a resource already exists (always false in a dry run).
exists() { [ -z "$DRY_RUN" ] && "$@" >/dev/null 2>&1; }
# IAM changes can fail for a few seconds after a service account is created.
retry() {
  local i
  for i in 1 2 3 4 5 6; do
    if run "$@"; then return 0; fi
    [ -n "$DRY_RUN" ] && return 0
    note "Retrying in $((i * 5))s…"
    sleep $((i * 5))
  done
  return 1
}
random() { node -e "console.log(require('crypto').randomBytes($1).toString('$2'))"; }

# --- 1. Sign in ---------------------------------------------------------------
step "Signing in"
KEY_FILE="$(mktemp)"
COOKIES="$(mktemp)"
trap 'rm -f "$KEY_FILE" "$COOKIES"' EXIT
# A placeholder token in some environments would override real credentials.
unset CLOUDSDK_AUTH_ACCESS_TOKEN
keyfield() { node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))[process.argv[2]] || '')" "$KEY_FILE" "$1"; }
if [ -n "${GOOGLE_SA_KEY:-}" ]; then
  MODE=service-account
  if printf '%s' "$GOOGLE_SA_KEY" | grep -q '"private_key"'; then
    printf '%s' "$GOOGLE_SA_KEY" >"$KEY_FILE"
  else
    printf '%s' "$GOOGLE_SA_KEY" | base64 -d >"$KEY_FILE"
  fi
  PROJECT="${PROJECT:-$(keyfield project_id)}"
  DEPLOYER="$(keyfield client_email)"
  run gcloud auth activate-service-account "$DEPLOYER" --key-file="$KEY_FILE" --quiet
else
  MODE=user
  PROJECT="${PROJECT:-abugida-lms}"
  DEPLOYER="$([ -n "$DRY_RUN" ] && echo you@example.com || gcloud config get-value account 2>/dev/null || true)"
  if [ -z "$DEPLOYER" ]; then
    echo "Sign in to Google Cloud first:  gcloud auth login   (or set GOOGLE_SA_KEY)" >&2
    exit 1
  fi
  if ! exists gcloud projects describe "$PROJECT"; then
    run gcloud projects create "$PROJECT" --name="Abugida LMS" --quiet
  fi
fi
run gcloud config set project "$PROJECT" --quiet
note "Project: $PROJECT   Region: $REGION   Deploying as: $DEPLOYER"

# --- 2. APIs and billing -------------------------------------------------------
step "Turning on Google Cloud services"
run gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com cloudbilling.googleapis.com iam.googleapis.com --quiet
BILLING="$([ -n "$DRY_RUN" ] && echo True || gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || echo unknown)"
if [ "$BILLING" != "True" ] && [ "$MODE" = user ]; then
  ACCOUNTS="${BILLING_ACCOUNT:-$(gcloud billing accounts list --filter=open=true --format='value(name.basename())' 2>/dev/null || true)}"
  if [ "$(printf '%s\n' "$ACCOUNTS" | grep -c .)" = 1 ]; then
    run gcloud billing projects link "$PROJECT" --billing-account="$ACCOUNTS" --quiet
    BILLING=True
  else
    echo "Choose the billing account to use and run again with BILLING_ACCOUNT=<id>. Your open billing accounts:" >&2
    gcloud billing accounts list --filter=open=true >&2 || true
    exit 1
  fi
fi
if [ "$BILLING" = "False" ]; then
  echo "Billing is not turned on for $PROJECT. Link a billing account (Console → Billing → Link a billing account) and run this again." >&2
  exit 1
fi
[ "$BILLING" = "True" ] || note "Couldn't confirm billing; continuing (the next step fails if it's off)."
run gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
  drive.googleapis.com --quiet

# --- 3. Database and file storage ---------------------------------------------
step "Database (Firestore, $REGION)"
if exists gcloud firestore databases describe --database='(default)'; then
  note "Firestore database already exists."
else
  run gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --quiet
fi
run gcloud firestore databases update --database='(default)' --enable-pitr --quiet
if [ -z "$DRY_RUN" ] && [ -n "$(gcloud firestore backups schedules list --database='(default)' --format='value(name)' 2>/dev/null)" ]; then
  note "Daily backups already scheduled."
else
  run gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d --quiet
fi

BUCKET="${PROJECT}-lms-files"
step "File storage (gs://$BUCKET)"
if exists gcloud storage buckets describe "gs://$BUCKET"; then
  note "Bucket already exists."
else
  run gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention --quiet
fi

# --- 4. Secrets ---------------------------------------------------------------
step "Secrets"
# Creates a secret once (generated values are never rotated by re-running).
ensure_secret() {
  local name="$1" value="$2"
  if exists gcloud secrets describe "$name"; then
    note "$name already exists."
  else
    echo "+ gcloud secrets create $name (value hidden)"
    [ -n "$DRY_RUN" ] || printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --replication-policy=user-managed --locations="$REGION" --quiet
  fi
}
# Stores a value you provided, adding a new version when it changed.
put_secret() {
  local name="$1" value="$2"
  if exists gcloud secrets describe "$name"; then
    if [ -z "$DRY_RUN" ] && [ "$(gcloud secrets versions access latest --secret="$name" 2>/dev/null)" = "$value" ]; then
      note "$name is up to date."
      return
    fi
    echo "+ gcloud secrets versions add $name (value hidden)"
    [ -n "$DRY_RUN" ] || printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --quiet
  else
    ensure_secret "$name" "$value"
  fi
}
ensure_secret lms-session-secret "$(random 32 hex)"
ensure_secret lms-cron-secret "$(random 24 hex)"
ensure_secret lms-admin-password "$(random 15 base64url)"
SECRETS=(lms-session-secret lms-cron-secret lms-admin-password)
SECRET_ENV="SESSION_SECRET=lms-session-secret:latest,CRON_SECRET=lms-cron-secret:latest,ADMIN_PASSWORD=lms-admin-password:latest"
EMAIL_ENV=""
if [ -n "${SMTP_APP_PASSWORD:-}" ]; then
  if [ "$SMTP_HOST" = smtp.gmail.com ]; then
    put_secret lms-smtp-pass "${SMTP_APP_PASSWORD// /}" # Google shows app passwords with spaces
  else
    put_secret lms-smtp-pass "$SMTP_APP_PASSWORD"
  fi
  SECRETS+=(lms-smtp-pass)
  SECRET_ENV+=",SMTP_PASS=lms-smtp-pass:latest"
  EMAIL_ENV="|SMTP_HOST=$SMTP_HOST|SMTP_PORT=$SMTP_PORT|SMTP_SECURE=$SMTP_SECURE|SMTP_USER=$COMPANY_EMAIL"
else
  note "No SMTP_APP_PASSWORD: emails will only be recorded in Admin → Emails."
fi
if [ -n "${GEMINI_API_KEY:-}" ]; then
  put_secret lms-gemini-key "$GEMINI_API_KEY"
  SECRETS+=(lms-gemini-key)
  SECRET_ENV+=",GEMINI_API_KEY=lms-gemini-key:latest"
else
  note "No GEMINI_API_KEY: AI quizzes and homework drafts stay off."
fi

# --- 5. Service accounts --------------------------------------------------------
step "Service accounts"
RUN_SA="lms-runtime@${PROJECT}.iam.gserviceaccount.com"
BUILD_SA="lms-builder@${PROJECT}.iam.gserviceaccount.com"
exists gcloud iam service-accounts describe "$RUN_SA" || run gcloud iam service-accounts create lms-runtime --display-name="Abugida LMS app (Cloud Run)" --quiet
exists gcloud iam service-accounts describe "$BUILD_SA" || run gcloud iam service-accounts create lms-builder --display-name="Abugida LMS builds" --quiet
# The app reads and writes the database, its bucket and its secrets — nothing else.
retry gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUN_SA" --role=roles/datastore.user --condition=None --quiet
retry gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$RUN_SA" --role=roles/storage.objectAdmin --quiet
for s in "${SECRETS[@]}"; do
  retry gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor --quiet
done
# Builds the container image from the Dockerfile.
retry gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILD_SA" --role=roles/run.builder --condition=None --quiet

# --- 6. Build and deploy the app ----------------------------------------------
step "Building and deploying the app (takes a few minutes)"
APP_URL="https://$DOMAIN"
# A plain environment variable already set on the live service ("" when there is none).
live_env() {
  [ -n "$DRY_RUN" ] && return 0
  gcloud run services describe "$SERVICE" --region "$REGION" --format=json 2>/dev/null |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { try { const env = JSON.parse(s).spec.template.spec.containers[0].env || []; console.log((env.find((e) => e.name === process.argv[1]) || {}).value || ""); } catch { console.log(""); } });' "$1" || true
}
# "Sign in with Google": the given client ID, or the one already on the service.
[ -n "${GOOGLE_CLIENT_ID:-}" ] || GOOGLE_CLIENT_ID="$(live_env GOOGLE_CLIENT_ID)"
# The one team sign-in: the given username, the one already on the service, or "admin".
[ -n "${ADMIN_USERNAME:-}" ] || ADMIN_USERNAME="$(live_env ADMIN_USERNAME)"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
GOOGLE_ENV=""
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then
  GOOGLE_ENV="|GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
else
  note "No GOOGLE_CLIENT_ID: the Sign in with Google button stays off."
fi
run gcloud run deploy "$SERVICE" --source "$REPO_ROOT" --region "$REGION" \
  --service-account "$RUN_SA" \
  --build-service-account "projects/$PROJECT/serviceAccounts/$BUILD_SA" \
  --no-invoker-iam-check \
  --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --concurrency 80 --timeout 900 \
  --set-env-vars "^|^NODE_ENV=production|APP_URL=$APP_URL|DATA_BACKEND=firestore|FILE_BACKEND=gcs|STORAGE_BUCKET=$BUCKET|FIREBASE_PROJECT_ID=$PROJECT|ADMIN_USERNAME=$ADMIN_USERNAME|ADMIN_EMAIL=$COMPANY_EMAIL|EMAIL_FROM=Abugida Education <$COMPANY_EMAIL>|INTERNAL_SCHEDULER=false$EMAIL_ENV$GOOGLE_ENV" \
  --set-secrets "$SECRET_ENV" \
  --quiet
RUN_URL="$([ -n "$DRY_RUN" ] && echo "https://$SERVICE-dry-run.a.run.app" || gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
note "App is running at $RUN_URL"
if [ -z "$DRY_RUN" ]; then
  for i in $(seq 1 20); do
    curl -fsS "$RUN_URL/api/health" >/dev/null 2>&1 && break
    sleep 3
  done
  curl -fsS "$RUN_URL/api/health" >/dev/null || { echo "The app did not answer its health check. See: gcloud run services logs read $SERVICE --region $REGION" >&2; exit 1; }
  note "Health check passed."
fi

# --- 7. Reminders, quizzes and reports every 10 minutes -----------------------
step "Scheduled jobs"
CRON_SECRET="$([ -n "$DRY_RUN" ] && echo hidden || gcloud secrets versions access latest --secret=lms-cron-secret)"
SCHEDULE_ARGS=(--location="$REGION" --schedule="*/10 * * * *" --time-zone="Etc/UTC" --uri="$RUN_URL/api/cron/tick" --http-method=POST --attempt-deadline=900s --quiet)
if exists gcloud scheduler jobs describe lms-tick --location="$REGION"; then
  echo "+ gcloud scheduler jobs update http lms-tick … (secret hidden)"
  # The job description includes the secret header, so its output is not shown.
  gcloud scheduler jobs update http lms-tick "${SCHEDULE_ARGS[@]}" --update-headers="x-cron-secret=$CRON_SECRET" >/dev/null
else
  echo "+ gcloud scheduler jobs create http lms-tick … (secret hidden)"
  [ -n "$DRY_RUN" ] || gcloud scheduler jobs create http lms-tick "${SCHEDULE_ARGS[@]}" --headers="x-cron-secret=$CRON_SECRET" >/dev/null
fi

# --- 8. First-time app settings ---------------------------------------------------
step "App settings"
if [ -z "$DRY_RUN" ]; then
  ADMIN_PASSWORD="$(gcloud secrets versions access latest --secret=lms-admin-password)"
  if curl -fsS -c "$COOKIES" -H 'content-type: application/json' -H 'x-abugida-client: 1' \
      -d "$(node -e 'console.log(JSON.stringify({ username: process.argv[1], password: process.argv[2], as: "admin" }))' "$ADMIN_USERNAME" "$ADMIN_PASSWORD")" \
      "$RUN_URL/api/auth/login" >/dev/null 2>&1 &&
    curl -fsS -b "$COOKIES" -X PUT -H 'content-type: application/json' -H 'x-abugida-client: 1' \
      -d "{\"timezone\":\"$ORG_TIMEZONE\",\"adminNotificationEmail\":\"$COMPANY_EMAIL\"}" \
      "$RUN_URL/api/admin/settings" >/dev/null 2>&1; then
    note "Organization timezone set to $ORG_TIMEZONE; Abugida email is $COMPANY_EMAIL."
  else
    note "Could not update settings automatically. Set them in Admin → Settings."
  fi
fi

# --- 9. Custom domain --------------------------------------------------------------
step "Custom domain ($DOMAIN)"
# Domain mappings for fully managed Cloud Run are only in `gcloud beta`.
if exists gcloud beta run domain-mappings describe --domain "$DOMAIN" --region "$REGION"; then
  note "Domain mapping already exists."
elif ! run gcloud beta run domain-mappings create --service "$SERVICE" --domain "$DOMAIN" --region "$REGION" --quiet; then
  cat <<EOF
   The domain couldn't be connected (see the error above). Usually Google needs proof
   that this deployer may use ${DOMAIN#*.}:
     1. Open https://search.google.com/search-console and verify ${DOMAIN#*.} (Domain property) if it isn't yet.
     2. Make sure $DEPLOYER is an Owner of that property (Settings → Users and permissions).
        A service account must be added there by hand; a person who verified the domain already is.
     3. Run this script again.
EOF
  exit 1
fi
if [ -z "$DRY_RUN" ]; then
  note "Add these DNS records at your domain registrar (HTTPS starts working up to a day after they're in place):"
  gcloud beta run domain-mappings describe --domain "$DOMAIN" --region "$REGION" \
    --format='table[box](status.resourceRecords.name:label=NAME,status.resourceRecords.type:label=TYPE,status.resourceRecords.rrdata:label=VALUE)'
fi

step "Done"
note "Working now:     $RUN_URL"
note "Final address:   $APP_URL (after the DNS records are in place)"
note "Team sign-in:    \"Abugida team? Sign in here\" with username '$ADMIN_USERNAME'. Password: Google Cloud console →"
note "                 Security → Secret Manager → lms-admin-password. It is the only team account; to change the"
note "                 password, add a new version of that secret and run this script again."
