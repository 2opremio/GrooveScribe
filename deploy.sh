#!/bin/bash
# =============================================================================
# deploy.sh — Deploy GrooveScribe to autoamp
# =============================================================================
# Node.js server behind Caddy reverse proxy, managed by supervisor.

set -e

REMOTE=fons@autoamp
REMOTE_DIR=GrooveScribe
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GS_DIR="$SCRIPT_DIR"

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

# --- Step 2: Supervisor config ---
echo ""
echo "🔄 Step 2: Updating supervisor configuration..."
scp -q "$GS_DIR/supervisor/groovescribe.conf" "$REMOTE:/tmp/groovescribe.conf"
ssh -A "$REMOTE" "sudo mv /tmp/groovescribe.conf /etc/supervisor/conf.d/groovescribe.conf && \
    sudo supervisorctl reread && \
    sudo supervisorctl update && \
    sudo supervisorctl restart groovescribe"
echo "   ✅ Supervisor updated, groovescribe restarted"

# --- Step 3: Caddy config ---
echo ""
echo "🔄 Step 3: Updating Caddy configuration..."
AUTOAMP_DIR="$(cd "$GS_DIR/../autoamp" 2>/dev/null && pwd || cd "$GS_DIR/../../autoamp" 2>/dev/null && pwd || echo "")"
if [[ -n "$AUTOAMP_DIR" && -f "$AUTOAMP_DIR/caddy/Caddyfile" ]]; then
    scp -q "$AUTOAMP_DIR/caddy/Caddyfile" "$REMOTE:/tmp/Caddyfile"
    ssh -A "$REMOTE" "sudo mv /tmp/Caddyfile /etc/caddy/Caddyfile && \
        sudo systemctl reload caddy"
    echo "   ✅ Caddy reloaded"
else
    echo "   ⚠️  autoamp repo not found — skipping Caddy config update"
    echo "   Update Caddyfile manually if needed"
fi

# --- Step 4: Backup script ---
echo ""
echo "📋 Step 4: Updating backup script..."
if [[ -n "$AUTOAMP_DIR" && -f "$AUTOAMP_DIR/backup/backup.sh" ]]; then
    scp -q "$AUTOAMP_DIR/backup/backup.sh" "$REMOTE:/tmp/backup.sh"
    ssh -A "$REMOTE" "mv /tmp/backup.sh ~/backup.sh && chmod +x ~/backup.sh"
    echo "   ✅ Backup script updated"
else
    echo "   ⚠️  autoamp repo not found — skipping backup script update"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅ GrooveScribe deployed!               ║"
echo "╚══════════════════════════════════════════╝"
echo ""
