#!/bin/sh
# Runs as root before nginx starts (nginx image's /docker-entrypoint.d hook):
# the exports folder is a host bind mount, so make it writable for the nginx
# worker user that handles the PUT uploads.
set -e
mkdir -p /srv/exports
chown nginx:nginx /srv/exports
