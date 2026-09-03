#!/usr/bin/env bash

set -e

# public/ is a build artefact of the frontend, so it is built before it is
# published rather than being whatever happens to be committed
cd "$(dirname "$0")/../../frontend"

npm run build

cd ../backend

firebase deploy --only hosting