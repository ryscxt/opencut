#!/bin/sh
# Starts the web server of the Docker image built by the Dockerfile at the repository root
# (see README.md there, "Keeping projects on the server").
#
# OPENCUT_UPLOAD_SECRET turns on PUT /upload/<user>/<project id>/<name>: files land in
# OPENCUT_UPLOAD_DIR (default /mnt/sdc1/Rinku/OpenCut), where a volume is expected.
# Without the secret the address answers 404 and nothing is ever written.
set -eu

store="${OPENCUT_UPLOAD_DIR:-/mnt/sdc1/Rinku/OpenCut}"
secret="${OPENCUT_UPLOAD_SECRET:-}"

if [ -n "$secret" ]; then
    case "$secret" in
        *[!A-Za-z0-9_-]*) echo 'OPENCUT_UPLOAD_SECRET may hold only letters, digits, "_" and "-"' >&2; exit 1 ;;
    esac
    if [ "${#secret}" -lt 32 ]; then
        echo 'OPENCUT_UPLOAD_SECRET needs at least 32 characters' >&2
        exit 1
    fi
fi

# A volume mounted from the host arrives owned by root; the server writes as nextjs. Where the
# volume's filesystem keeps no owners (FAT, exFAT, NTFS: chown changes nothing there), only root
# can write, so the server runs as root instead.
if [ "$(id -u)" = 0 ]; then
    mkdir -p "$store/.incoming"
    chown nextjs:nodejs "$store" "$store/.incoming" 2>/dev/null || true
    if su-exec nextjs sh -c "touch '$store/.incoming/.writable' && rm -f '$store/.incoming/.writable'" 2>/dev/null; then
        exec su-exec nextjs "$@"
    fi
    echo "opencut-web: $store is not writable by nextjs; the server runs as root" >&2
fi

exec "$@"
