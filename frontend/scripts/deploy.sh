#!/usr/bin/env bash

set -e

# Vite writes straight into ../backend/public (see vite.config.ts)
npm run build

cd ../backend

firebase use remote
firebase deploy --only hosting
firebase use local

cd ../frontend
