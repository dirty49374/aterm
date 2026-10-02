#!/bin/sh
set -eu
node /opt/aterm/bootstrap.mjs
exec /opt/aterm/node_modules/.bin/aterm --home /data/.aterm "$@"
