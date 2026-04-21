#!/bin/bash
# One-time setup to wire ACR Tasks CD for openclaw.
# Replaces the broken GitHub Actions CI/CD (Anyrouter232 private repo on Free
# plan can't run Actions without a payment method).
#
# Usage:
#   1. brew install azure-cli
#   2. az login           # opens browser, sign in as 25-61253-1@student.aiub.edu
#   3. az account set --subscription "Azure for Students"
#   4. bash az-setup.sh

set -euo pipefail

REGISTRY="openclawbd"
RESOURCE_GROUP="openclaw-rg"
CONTAINER_APP="openclaw"
TASK_NAME="openclaw-build"
GITHUB_REPO_URL="https://github.com/Anyrouter232/openclaw-render.git#main"
GITHUB_PAT="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"

echo "==> 1. Creating ACR Task '$TASK_NAME' on registry '$REGISTRY'"
az acr task create \
  --registry "$REGISTRY" \
  --name "$TASK_NAME" \
  --context "$GITHUB_REPO_URL" \
  --file acr-task.yaml \
  --git-access-token "$GITHUB_PAT" \
  --commit-trigger-enabled true \
  --pull-request-trigger-enabled false \
  --assign-identity "[system]" \
  --only-show-errors

echo "==> 2. Getting task's managed identity principal ID"
PRINCIPAL_ID=$(az acr task show \
  --registry "$REGISTRY" \
  --name "$TASK_NAME" \
  --query identity.principalId \
  -o tsv)
echo "    Principal ID: $PRINCIPAL_ID"

echo "==> 3. Getting Container App resource ID"
APP_ID=$(az containerapp show \
  --name "$CONTAINER_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  -o tsv)
echo "    App ID: $APP_ID"

echo "==> 4. Granting 'Contributor' on the Container App to task identity"
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Contributor" \
  --scope "$APP_ID" \
  --only-show-errors

echo "==> 5. Granting 'AcrPush' on the registry to task identity (for push step)"
REGISTRY_ID=$(az acr show --name "$REGISTRY" --query id -o tsv)
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "AcrPush" \
  --scope "$REGISTRY_ID" \
  --only-show-errors

echo "==> 6. Triggering first build manually"
az acr task run --registry "$REGISTRY" --name "$TASK_NAME" --only-show-errors

echo ""
echo "Done. From now on, every push to main on Anyrouter232/openclaw-render"
echo "will auto-build via ACR Tasks and deploy a new Container App revision."
echo ""
echo "Check task status:    az acr task list-runs --registry $REGISTRY -o table"
echo "Tail live build log:  az acr task logs --registry $REGISTRY"
