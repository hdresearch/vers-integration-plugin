#!/bin/bash
# Check if Vers is authenticated and provide guidance if not

set -e

# Check if vers CLI is available
if ! command -v vers &> /dev/null; then
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Vers CLI not found. Install with: curl -fsSL https://vers.sh/install.sh | sh\n\nAfter installation, run: vers auth login"
  }
}
EOF
    exit 0
fi

# Check authentication status
if ! vers auth status &> /dev/null; then
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Vers plugin loaded but not authenticated. Run /vers-setup to configure your account, or manually run: vers auth login"
  }
}
EOF
    exit 0
fi

# Check if we're in a Vers project
if [ -f "vers-integration.yaml" ] || [ -f "vers.toml" ]; then
    PROJECT_NAME=$(grep -m1 "^name:" vers-integration.yaml 2>/dev/null | cut -d: -f2 | tr -d ' "' || echo "unknown")
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Vers integration project detected: ${PROJECT_NAME}. Use /vers-integration-up to start services."
  }
}
EOF
else
    cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Vers authenticated. Use /vers-integration-init <name> to create a new integration testing project."
  }
}
EOF
fi
