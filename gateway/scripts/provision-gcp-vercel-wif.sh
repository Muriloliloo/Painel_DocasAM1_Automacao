#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-meli-bi-data}"
SA_ID="${SA_ID:-painel-docas-am1-gateway}"
POOL_ID="${POOL_ID:-vercel-painel-docas}"
PROVIDER_ID="${PROVIDER_ID:-vercel-production}"
VERCEL_OWNER="${VERCEL_OWNER:-muriloliloos-projetos}"
VERCEL_PROJECT="${VERCEL_PROJECT:-painel-docas-am1-gateway}"
VERCEL_ENVIRONMENT="${VERCEL_ENVIRONMENT:-production}"
VERCEL_SUBJECT="owner:${VERCEL_OWNER}:project:${VERCEL_PROJECT}:environment:${VERCEL_ENVIRONMENT}"

echo "== Painel Docas AM1 / GCP Workload Identity =="
echo "Projeto: $PROJECT_ID"
echo "Vercel owner: $VERCEL_OWNER"
echo "Vercel project: $VERCEL_PROJECT"
echo "Ambiente: $VERCEL_ENVIRONMENT"
echo

gcloud config set project "$PROJECT_ID" >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
if [[ -z "$PROJECT_NUMBER" ]]; then
  echo "ERRO: nao foi possivel obter PROJECT_NUMBER de $PROJECT_ID." >&2
  exit 1
fi

SA_EMAIL="${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "[1/6] Habilitando APIs necessarias..."
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  bigquery.googleapis.com \
  --project="$PROJECT_ID"

echo "[2/6] Criando/verificando Service Account..."
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_ID" \
    --project="$PROJECT_ID" \
    --display-name="Painel Docas AM1 Gateway" \
    --description="Somente leitura BigQuery para o gateway cloud do Painel Docas AM1"
fi

echo "[3/6] Concedendo somente criacao de jobs BigQuery..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/bigquery.jobUser" \
  --condition=None \
  --quiet >/dev/null

echo "[4/6] Concedendo leitura somente nas tabelas usadas pelo SQL rich..."
TABLES=(
  BT_CYCLE_SUMMARY_LM
  BT_LOADING_ZONES_PROCESS_LM
  BT_YMS_JOURNEY_PLANNER
  BT_PRECHECKIN_TRACEABILITY_LM
  BT_CYCLE_ROUTE
  BT_YMS_PLANIFICATION_OPERATIVE_LM
  BT_YMS_LOADING_ZONES_EVENTS
  BT_SHP_MT_FACILITY_RESOURCE
)

for table in "${TABLES[@]}"; do
  echo "  - WHOWNER.$table"
  bq add-iam-policy-binding \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/bigquery.dataViewer" \
    --table=true \
    "${PROJECT_ID}:WHOWNER.${table}" >/dev/null
done

echo "[5/6] Criando/verificando Workload Identity Pool..."
if ! gcloud iam workload-identity-pools describe "$POOL_ID" \
    --project="$PROJECT_ID" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --display-name="Vercel Painel Docas"
fi

echo "[6/6] Criando/verificando provider OIDC Vercel..."
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then

  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$POOL_ID" \
    --display-name="Vercel production Painel Docas" \
    --issuer-uri="https://oidc.vercel.com/${VERCEL_OWNER}" \
    --attribute-mapping="google.subject=assertion.sub" \
    --attribute-condition="assertion.sub == '${VERCEL_SUBJECT}'"
fi

echo "Concedendo impersonacao somente ao projeto Vercel aprovado..."
PRINCIPAL="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/subject/${VERCEL_SUBJECT}"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="$PRINCIPAL" \
  --quiet >/dev/null

echo
echo "=============================================="
echo "CONFIGURACAO GCP CONCLUIDA"
echo "=============================================="
echo "GCP_PROJECT_NUMBER=$PROJECT_NUMBER"
echo "GCP_SERVICE_ACCOUNT_EMAIL=$SA_EMAIL"
echo "GCP_WORKLOAD_IDENTITY_POOL_ID=$POOL_ID"
echo "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=$PROVIDER_ID"
echo "GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
echo "BIGQUERY_LOCATION=US"
echo
echo "Nenhuma chave JSON foi criada."
echo "A Service Account possui jobUser no projeto e dataViewer somente nas 8 tabelas listadas."
echo "OIDC restrito ao subject: $VERCEL_SUBJECT"
