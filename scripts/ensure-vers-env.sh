#!/bin/bash
# Ensure Vers environment is ready before executing vers commands

set -e

# Verify vers is available
if ! command -v vers &> /dev/null; then
    echo '{"error": "Vers CLI not found. Please install vers first."}'
    exit 1
fi

# Verify authentication
if ! vers auth status &> /dev/null 2>&1; then
    echo '{"error": "Not authenticated with Vers. Run: vers auth login"}'
    exit 1
fi

# All checks passed - allow command to proceed
exit 0
