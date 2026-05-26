#!/bin/bash
# Upload Literature + ChromaDB to VPS
# Usage: ./scripts/deploy-data.sh <VPS_HOST> <VPS_USER>

set -e

VPS_HOST="${1:?Usage: $0 <VPS_HOST> <VPS_USER>}"
VPS_USER="${2:-root}"
REMOTE_DIR="/opt/audit-quiz"

echo "Uploading ChromaDB to $VPS_USER@$VPS_HOST:$REMOTE_DIR..."

# Create remote dirs
ssh "$VPS_USER@$VPS_HOST" "mkdir -p $REMOTE_DIR/data/Literature"

# Upload ChromaDB (pre-built index)
rsync -avz --progress backend/chroma_db/ "$VPS_USER@$VPS_HOST:$REMOTE_DIR/chroma_db/"

# Upload Literature for potential re-indexing
rsync -avz --progress ../../Literature/ "$VPS_USER@$VPS_HOST:$REMOTE_DIR/data/Literature/"

echo "✅ Data uploaded. ChromaDB and Literature are on the server."
