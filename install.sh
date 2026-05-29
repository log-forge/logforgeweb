#!/bin/sh
set -eu

REPO_URL="https://github.com/log-forge/logforge.git"
TARGET_DIR="logforge"
EXPECTED_UNICRON_IMAGE="logforge/unicron:latest"
DEFAULT_UNICRON_APP_PORT="8444"
DEFAULT_UNICRON_AGENT_MTLS_PORT="9443"
UNICRON_APP_PORT_SELECTED="$DEFAULT_UNICRON_APP_PORT"
UNICRON_AGENT_MTLS_PORT_SELECTED="$DEFAULT_UNICRON_AGENT_MTLS_PORT"

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Error: %s is required but was not found in PATH.\n' "$1" >&2
        exit 1
    fi
}

docker_desktop_error() {
    printf 'Error: Docker is installed, but the Docker daemon is not responding.\n' >&2
    printf 'Start or restart Docker Desktop, enable WSL integration if you are using WSL, then rerun this installer.\n' >&2
    exit 1
}

rerun_after_failure() {
    printf 'The ./%s checkout was left intact. You can rerun this installer after fixing the problem.\n' "$TARGET_DIR" >&2
}

check_docker() {
    printf 'Checking Docker...\n'

    require_command docker

    if command -v timeout >/dev/null 2>&1; then
        if ! timeout 20 docker info >/dev/null 2>&1; then
            docker_desktop_error
        fi
    elif ! docker info >/dev/null 2>&1; then
        docker_desktop_error
    fi

    if ! docker compose version >/dev/null 2>&1; then
        printf 'Error: Docker Compose is required but `docker compose` is not available.\n' >&2
        exit 1
    fi
}

central_compose() {
    docker compose -f docker-compose.yml "$@"
}

verify_existing_checkout() {
    if [ ! -d "$TARGET_DIR/.git" ]; then
        printf 'Error: ./%s already exists but is not a Git repository.\n' "$TARGET_DIR" >&2
        printf 'Move it aside or run this installer from another directory.\n' >&2
        exit 1
    fi

    origin_url="$(git -C "$TARGET_DIR" remote get-url origin 2>/dev/null || true)"
    if [ "$origin_url" != "$REPO_URL" ]; then
        if [ -n "$origin_url" ]; then
            printf 'Error: ./%s already exists but its origin is %s.\n' "$TARGET_DIR" "$origin_url" >&2
        else
            printf 'Error: ./%s already exists but it does not have an origin remote.\n' "$TARGET_DIR" >&2
        fi
        printf 'Expected origin: %s\n' "$REPO_URL" >&2
        printf 'Move it aside or run this installer from another directory.\n' >&2
        exit 1
    fi
}

validate_central_compose_image() {
    printf 'Validating Docker Compose image...\n'

    if [ ! -f docker-compose.yml ]; then
        printf 'Error: ./%s/docker-compose.yml was not found.\n' "$TARGET_DIR" >&2
        rerun_after_failure
        exit 1
    fi

    if ! images="$(central_compose config --images)"; then
        printf 'Error: Docker Compose could not resolve images from docker-compose.yml.\n' >&2
        rerun_after_failure
        exit 1
    fi

    images="$(printf '%s\n' "$images" | awk 'NF { print }')"
    if [ "$images" != "$EXPECTED_UNICRON_IMAGE" ]; then
        printf 'Error: docker-compose.yml must resolve to exactly %s, but found:\n' "$EXPECTED_UNICRON_IMAGE" >&2
        if [ -n "$images" ]; then
            printf '%s\n' "$images" >&2
        else
            printf '(no images)\n' >&2
        fi
        rerun_after_failure
        exit 1
    fi
}

pull_unicron_image() {
    printf 'The first pull may download roughly 700 MB.\n'
    printf 'Pulling image %s...\n' "$EXPECTED_UNICRON_IMAGE"
    if ! docker pull "$EXPECTED_UNICRON_IMAGE"; then
        rerun_after_failure
        exit 1
    fi
}

get_env_file_value() {
    var="$1"

    if [ ! -f .env ]; then
        return 0
    fi

    awk -v var="$var" '
        $0 ~ "^[[:space:]]*" var "=" {
            sub("^[[:space:]]*" var "=", "")
            value = $0
        }
        END {
            if (value != "") {
                print value
            }
        }
    ' .env
}

set_env_file_value() {
    var="$1"
    value="$2"
    tmp=".env.tmp.$$"

    if [ -f .env ]; then
        awk -v var="$var" -v value="$value" '
            BEGIN { updated = 0 }
            $0 ~ "^[[:space:]]*" var "=" {
                if (!updated) {
                    print var "=" value
                    updated = 1
                }
                next
            }
            { print }
            END {
                if (!updated) {
                    print var "=" value
                }
            }
        ' .env > "$tmp"
    else
        printf '%s=%s\n' "$var" "$value" > "$tmp"
    fi

    mv "$tmp" .env
}

validate_port() {
    var="$1"
    port="$2"

    case "$port" in
        ''|*[!0-9]*)
            printf 'Error: %s must be a TCP port number between 1 and 65535; got "%s".\n' "$var" "$port" >&2
            exit 1
            ;;
    esac

    if [ "${#port}" -gt 5 ] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        printf 'Error: %s must be a TCP port number between 1 and 65535; got "%s".\n' "$var" "$port" >&2
        exit 1
    fi
}

find_port_checker() {
    if command -v ss >/dev/null 2>&1; then
        printf 'ss\n'
    elif command -v lsof >/dev/null 2>&1; then
        printf 'lsof\n'
    elif command -v netstat >/dev/null 2>&1; then
        printf 'netstat\n'
    else
        return 1
    fi
}

port_in_use() {
    port="$1"

    case "$PORT_CHECKER" in
        ss)
            ss -ltn 2>/dev/null | awk -v port="$port" '
                NR > 1 {
                    local_address = $4
                    if (local_address ~ "(^|[^0-9])" port "$") {
                        found = 1
                    }
                }
                END { exit found ? 0 : 1 }
            '
            ;;
        lsof)
            lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
            ;;
        netstat)
            netstat -ltn 2>/dev/null | awk -v port="$port" '
                NR > 1 {
                    local_address = $4
                    if (local_address ~ "(^|[^0-9])" port "$") {
                        found = 1
                    }
                }
                END { exit found ? 0 : 1 }
            '
            ;;
        *)
            return 1
            ;;
    esac
}

next_available_port() {
    candidate="$(($1 + 1))"
    reserved_port="$2"

    while [ "$candidate" -le 65535 ]; do
        if [ "$candidate" != "$reserved_port" ]; then
            if [ -z "$PORT_CHECKER" ] || ! port_in_use "$candidate"; then
                printf '%s\n' "$candidate"
                return 0
            fi
        fi

        candidate="$((candidate + 1))"
    done

    return 1
}

fail_explicit_port_in_use() {
    var="$1"
    port="$2"

    printf 'Error: %s is explicitly set to %s, but that port is already in use.\n' "$var" "$port" >&2
    printf 'Unset %s or choose a free value, then rerun this installer.\n' "$var" >&2
    exit 1
}

fail_duplicate_ports() {
    port="$1"

    printf 'Error: UNICRON_APP_PORT and UNICRON_AGENT_MTLS_PORT both resolve to %s.\n' "$port" >&2
    printf 'Choose distinct ports, then rerun this installer.\n' >&2
    exit 1
}

resolve_configured_ports() {
    if [ "${UNICRON_APP_PORT+x}" = "x" ]; then
        app_port="$UNICRON_APP_PORT"
        app_port_source="environment"
    else
        app_port="$(get_env_file_value UNICRON_APP_PORT)"
        if [ -n "$app_port" ]; then
            app_port_source="env_file"
        else
            app_port="$DEFAULT_UNICRON_APP_PORT"
            app_port_source="default"
        fi
    fi

    if [ "${UNICRON_AGENT_MTLS_PORT+x}" = "x" ]; then
        agent_mtls_port="$UNICRON_AGENT_MTLS_PORT"
        agent_mtls_port_source="environment"
    else
        agent_mtls_port="$(get_env_file_value UNICRON_AGENT_MTLS_PORT)"
        if [ -n "$agent_mtls_port" ]; then
            agent_mtls_port_source="env_file"
        else
            agent_mtls_port="$DEFAULT_UNICRON_AGENT_MTLS_PORT"
            agent_mtls_port_source="default"
        fi
    fi

    validate_port UNICRON_APP_PORT "$app_port"
    validate_port UNICRON_AGENT_MTLS_PORT "$agent_mtls_port"
}

existing_compose_containers() {
    containers="$(central_compose ps -a -q unicron 2>/dev/null || true)"
    [ -n "$containers" ]
}

pick_replacement_port() {
    current_port="$1"
    reserved_port="$2"
    label="$3"

    if ! replacement_port="$(next_available_port "$current_port" "$reserved_port")"; then
        printf 'Error: could not find a free port for %s after %s.\n' "$label" "$current_port" >&2
        exit 1
    fi

    printf '%s\n' "$replacement_port"
}

configure_ports() {
    updated_env=0

    resolve_configured_ports

    printf 'Checking host ports...\n'

    UNICRON_APP_PORT_SELECTED="$app_port"
    UNICRON_AGENT_MTLS_PORT_SELECTED="$agent_mtls_port"
    export UNICRON_APP_PORT="$UNICRON_APP_PORT_SELECTED"
    export UNICRON_AGENT_MTLS_PORT="$UNICRON_AGENT_MTLS_PORT_SELECTED"

    if existing_compose_containers; then
        printf 'Existing LogForge Compose containers detected; keeping configured ports.\n'
        return 0
    fi

    PORT_CHECKER="$(find_port_checker || true)"
    if [ -z "$PORT_CHECKER" ]; then
        printf 'Port preflight is unavailable because ss, lsof, and netstat were not found; Docker Compose will report any bind conflicts.\n'
    fi

    if [ -n "$PORT_CHECKER" ] && [ "$app_port_source" = "environment" ] && port_in_use "$app_port"; then
        fail_explicit_port_in_use UNICRON_APP_PORT "$app_port"
    fi

    if [ -n "$PORT_CHECKER" ] && [ "$agent_mtls_port_source" = "environment" ] && port_in_use "$agent_mtls_port"; then
        fail_explicit_port_in_use UNICRON_AGENT_MTLS_PORT "$agent_mtls_port"
    fi

    if [ "$app_port" = "$agent_mtls_port" ]; then
        if [ "$app_port_source" = "environment" ] && [ "$agent_mtls_port_source" = "environment" ]; then
            fail_duplicate_ports "$app_port"
        elif [ "$agent_mtls_port_source" = "environment" ]; then
            new_app_port="$(pick_replacement_port "$app_port" "$agent_mtls_port" "LogForge dashboard")"
            printf 'Port %s is already selected for LogForge agent mTLS; using %s for LogForge dashboard.\n' "$app_port" "$new_app_port"
            app_port="$new_app_port"
            set_env_file_value UNICRON_APP_PORT "$app_port"
            updated_env=1
        else
            new_agent_mtls_port="$(pick_replacement_port "$agent_mtls_port" "$app_port" "LogForge agent mTLS")"
            printf 'Port %s is already selected for LogForge dashboard; using %s for LogForge agent mTLS.\n' "$agent_mtls_port" "$new_agent_mtls_port"
            agent_mtls_port="$new_agent_mtls_port"
            set_env_file_value UNICRON_AGENT_MTLS_PORT "$agent_mtls_port"
            updated_env=1
        fi
    fi

    if [ -n "$PORT_CHECKER" ] && port_in_use "$app_port"; then
        new_app_port="$(pick_replacement_port "$app_port" "$agent_mtls_port" "LogForge dashboard")"
        printf 'Port %s is already in use; using %s for LogForge dashboard.\n' "$app_port" "$new_app_port"
        app_port="$new_app_port"
        set_env_file_value UNICRON_APP_PORT "$app_port"
        updated_env=1
    fi

    if [ -n "$PORT_CHECKER" ] && port_in_use "$agent_mtls_port"; then
        new_agent_mtls_port="$(pick_replacement_port "$agent_mtls_port" "$app_port" "LogForge agent mTLS")"
        printf 'Port %s is already in use; using %s for LogForge agent mTLS.\n' "$agent_mtls_port" "$new_agent_mtls_port"
        agent_mtls_port="$new_agent_mtls_port"
        set_env_file_value UNICRON_AGENT_MTLS_PORT "$agent_mtls_port"
        updated_env=1
    fi

    if [ "$app_port" = "$agent_mtls_port" ]; then
        fail_duplicate_ports "$app_port"
    fi

    if [ "$updated_env" -eq 1 ]; then
        printf 'Updated ./%s/.env with selected ports.\n' "$TARGET_DIR"
    fi

    UNICRON_APP_PORT_SELECTED="$app_port"
    UNICRON_AGENT_MTLS_PORT_SELECTED="$agent_mtls_port"
    export UNICRON_APP_PORT="$UNICRON_APP_PORT_SELECTED"
    export UNICRON_AGENT_MTLS_PORT="$UNICRON_AGENT_MTLS_PORT_SELECTED"
}

require_command git

if [ -e "$TARGET_DIR" ]; then
    verify_existing_checkout
fi

check_docker

if [ -e "$TARGET_DIR" ]; then
    printf 'Updating ./%s...\n' "$TARGET_DIR"
    if ! git -C "$TARGET_DIR" pull --ff-only; then
        rerun_after_failure
        exit 1
    fi
else
    printf 'Cloning %s into ./%s...\n' "$REPO_URL" "$TARGET_DIR"
    if ! git clone "$REPO_URL" "$TARGET_DIR"; then
        rerun_after_failure
        exit 1
    fi
fi

cd "$TARGET_DIR"

configure_ports
validate_central_compose_image
pull_unicron_image

printf 'Starting LogForge containers...\n'
if ! central_compose up -d unicron; then
    rerun_after_failure
    exit 1
fi

printf 'LogForge containers:\n'
if ! central_compose ps unicron; then
    rerun_after_failure
    exit 1
fi

printf '\nLogForge is ready at https://localhost:%s/unicron\n' "$UNICRON_APP_PORT_SELECTED"
