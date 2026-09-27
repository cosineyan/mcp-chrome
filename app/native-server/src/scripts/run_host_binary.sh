#!/usr/bin/env bash
# Thin launcher for the standalone mcp-chrome-bridge binary.
# Chrome launches native messaging hosts with a minimal environment,
# so we set up PATH and source user env vars before exec-ing the binary.
# Unlike run_host.sh, this does NOT need Node.js installed.

# Configuration
ENABLE_LOG_ROTATION="true"
LOG_RETENTION_COUNT=5

# Setup paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="${SCRIPT_DIR}/mcp-chrome-bridge"

# Setup log directory
if [ "$(uname)" = "Darwin" ]; then
    LOG_DIR="${HOME}/Library/Logs/mcp-chrome-bridge"
else
    LOG_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/mcp-chrome-bridge/logs"
fi

if ! mkdir -p "${LOG_DIR}" 2>/dev/null; then
    LOG_DIR="${SCRIPT_DIR}/logs"
    mkdir -p "${LOG_DIR}" 2>/dev/null || true
fi

# Log rotation
if [ "${ENABLE_LOG_ROTATION}" = "true" ]; then
    ls -tp "${LOG_DIR}/native_host_wrapper_"* 2>/dev/null | tail -n +$((LOG_RETENTION_COUNT + 1)) | xargs -I {} rm -- {}
    ls -tp "${LOG_DIR}/native_host_stderr_"* 2>/dev/null | tail -n +$((LOG_RETENTION_COUNT + 1)) | xargs -I {} rm -- {}
fi

# Logging setup
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
WRAPPER_LOG="${LOG_DIR}/native_host_wrapper_unix_${TIMESTAMP}.log"
STDERR_LOG="${LOG_DIR}/native_host_stderr_unix_${TIMESTAMP}.log"

{
    echo "--- Binary launcher called at $(date) ---"
    echo "SCRIPT_DIR: ${SCRIPT_DIR}"
    echo "BINARY: ${BINARY}"
} > "${WRAPPER_LOG}"

# Ensure a usable PATH (Chrome provides almost nothing)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin${PATH:+:${PATH}}"

# Load user environment variables (same logic as run_host.sh)
{
    echo "Loading user environment..." >> "${WRAPPER_LOG}"

    if [ -f "${HOME}/.mcp-chrome-bridge.env" ]; then
        # shellcheck disable=SC1091
        source "${HOME}/.mcp-chrome-bridge.env" 2>/dev/null || true
        echo "Loaded ${HOME}/.mcp-chrome-bridge.env" >> "${WRAPPER_LOG}"
    fi

    if [ -f "${HOME}/.zshenv" ] && [ -z "${MCP_BRIDGE_ENV_LOADED:-}" ]; then
        # shellcheck disable=SC1091
        source "${HOME}/.zshenv" 2>/dev/null || true
        echo "Loaded ~/.zshenv" >> "${WRAPPER_LOG}"
    fi

    if [ -z "${ANTHROPIC_BASE_URL:-}" ] || [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
        USER_SHELL_NAME="$(basename "${SHELL:-/bin/bash}")"
        RC_FILE=""
        case "${USER_SHELL_NAME}" in
            zsh)  RC_FILE="${HOME}/.zshrc" ;;
            bash) RC_FILE="${HOME}/.bash_profile" ;;
        esac

        if [ -n "${RC_FILE}" ] && [ -f "${RC_FILE}" ]; then
            EXTRACTED_VARS="$("${SHELL:-/bin/bash}" -i -c 'env' 2>/dev/null | grep -E '^(ANTHROPIC_|CLAUDE_CODE_OAUTH)' || true)"
            if [ -n "${EXTRACTED_VARS}" ]; then
                while IFS='=' read -r key value; do
                    [ -n "${key}" ] && export "${key}=${value}"
                done <<< "${EXTRACTED_VARS}"
                echo "Extracted ANTHROPIC/CLAUDE vars from ${USER_SHELL_NAME}" >> "${WRAPPER_LOG}"
            fi
        fi
    fi
} 2>> "${WRAPPER_LOG}"

# Verify binary exists
if [ ! -x "${BINARY}" ]; then
    echo "ERROR: Binary not found or not executable: ${BINARY}" >> "${WRAPPER_LOG}"
    exit 1
fi

echo "Executing: ${BINARY}" >> "${WRAPPER_LOG}"

exec "${BINARY}" 2>> "${STDERR_LOG}"
