#!/bin/bash
# =============================================================================
# pre_first_deploy.sh — One-time setup for GrooveScribe on autoamp
# =============================================================================
# Run this once before the first deploy to set up the deploy key and git config.

set -e

REMOTE=fons@autoamp
REMOTE_DIR=GrooveScribe
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_KEY="$SCRIPT_DIR/credentials/deploy-key"

if [[ ! -f "$DEPLOY_KEY" ]]; then
    echo "❌ Deploy key not found at $DEPLOY_KEY"
    echo "Generate one with: ssh-keygen -t ed25519 -f credentials/deploy-key -N '' -C 'groovescribe-bot'"
    exit 1
fi

echo "📦 Setting up GrooveScribe deploy key on autoamp..."

# Ensure credentials directory exists
ssh "$REMOTE" "mkdir -p ~/$REMOTE_DIR/credentials"

# Copy deploy key
scp "$DEPLOY_KEY" "$REMOTE:~/$REMOTE_DIR/credentials/deploy-key"
ssh "$REMOTE" "chmod 600 ~/$REMOTE_DIR/credentials/deploy-key"
echo "   ✅ Deploy key copied"

# Configure git user for groovescribe-bot
ssh "$REMOTE" "cd ~/$REMOTE_DIR && \
    git config user.name 'groovescribe-bot' && \
    git config user.email 'groovescribe-bot@users.noreply.github.com'"
echo "   ✅ Git user configured as groovescribe-bot"

# Verify SSH access to GitHub
echo ""
echo "🔑 Verifying GitHub access..."
ssh "$REMOTE" "ssh -i ~/$REMOTE_DIR/credentials/deploy-key -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true"

echo ""
echo "✅ Pre-deploy setup complete. You can now run ./deploy.sh"
