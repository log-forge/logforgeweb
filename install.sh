#!/bin/sh
set -eu

REPO_URL="https://github.com/log-forge/logforge.git"
TARGET_DIR="logforge"
DASHBOARD_URL="https://localhost:8444"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Error: %s is required but was not found in PATH.\n' "$1" >&2
        exit 1
    fi
}

require_command git
require_command docker

if ! docker compose version >/dev/null 2>&1; then
    printf 'Error: Docker Compose is required but `docker compose` is not available.\n' >&2
    exit 1
fi

if [ -e "$TARGET_DIR" ]; then
    if [ ! -d "$TARGET_DIR/.git" ]; then
        printf 'Error: ./%s already exists but is not a Git repository.\n' "$TARGET_DIR" >&2
        printf 'Move it aside or run this installer from another directory.\n' >&2
        exit 1
    fi

    printf 'Updating ./%s...\n' "$TARGET_DIR"
    git -C "$TARGET_DIR" pull --ff-only
else
    printf 'Cloning %s into ./%s...\n' "$REPO_URL" "$TARGET_DIR"
    git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

printf 'Pulling Docker Compose images...\n'
docker compose pull

printf 'Starting LogForge...\n'
docker compose up -d

printf 'LogForge containers:\n'
docker compose ps

printf '\nLogForge is ready at %s\n' "$DASHBOARD_URL"
