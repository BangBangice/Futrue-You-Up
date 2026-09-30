#!/bin/sh
# A volume mounted at /app/.data (Railway's, or compose's) comes up owned by root, so the unprivileged server could
# not write to it. Starting as root, hand it to the node user, then drop to that user before anything else runs.
set -e
if [ "$(id -u)" = 0 ]; then
  mkdir -p /app/.data
  [ "$(stat -c %U /app/.data)" = node ] || chown -R node:node /app/.data
  exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node USER=node "$@"
fi
exec "$@"
