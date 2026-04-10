#!/bin/bash
# =============================================================================
# deploy.sh — Deploy GrooveScribe to autoamp
# =============================================================================
# Node.js server behind Caddy reverse proxy, managed by supervisor.

set -e

REMOTE=fons@autoamp
REMOTE_DIR=GrooveScribe
# Resolve symlinks so this works when called via a symlink from another repo
REAL_SCRIPT="$(readlink -f "$0" 2>/dev/null || python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$0")"
GS_DIR="$(cd "$(dirname "$REAL_SCRIPT")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Deploying: GrooveScribe                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# --- Step 1: Code sync ---
HAS_GIT=$(ssh -A "$REMOTE" "test -d ~/$REMOTE_DIR/.git && echo yes || echo no")

if [[ "$HAS_GIT" == "yes" ]]; then
    echo "📦 Step 1: git pull on server..."
    ssh -A "$REMOTE" "cd ~/$REMOTE_DIR && git stash -q 2>/dev/null || true; git pull"

    # Overlay uncommitted local changes if any
    if ! git -C "$GS_DIR" diff --quiet HEAD 2>/dev/null || \
       ! git -C "$GS_DIR" diff --cached --quiet HEAD 2>/dev/null; then
        echo "⚠️  Local has uncommitted changes — rsyncing overlay..."
        rsync -avz --progress \
            --exclude='.git/' --exclude='node_modules/' --exclude='.DS_Store' \
            --exclude='.context/' --exclude='credentials/deploy-key' \
            "$GS_DIR/" "$REMOTE:$REMOTE_DIR/"
    else
        echo "✅ Local is clean — git pull is sufficient"
    fi
else
    echo "📦 Step 1: First deploy — full rsync (including .git/)..."
    ssh -A "$REMOTE" "mkdir -p ~/$REMOTE_DIR"
    rsync -avz --progress \
        --exclude='node_modules/' --exclude='.DS_Store' --exclude='.context/' \
        --exclude='credentials/deploy-key' \
        "$GS_DIR/" "$REMOTE:$REMOTE_DIR/"
fi

# --- Step 2: Supervisor config + restart ---
echo ""
echo "🔄 Step 2: Updating supervisor configuration..."
scp -q "$GS_DIR/supervisor/groovescribe.conf" "$REMOTE:/tmp/groovescribe.conf"
ssh -A "$REMOTE" "sudo mv /tmp/groovescribe.conf /etc/supervisor/conf.d/groovescribe.conf && \
    sudo supervisorctl reread && \
    sudo supervisorctl update && \
    sudo supervisorctl restart groovescribe"
echo "   ✅ Supervisor updated, groovescribe restarted"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅ GrooveScribe deployed!               ║"
echo "╚══════════════════════════════════════════╝"
echo ""
