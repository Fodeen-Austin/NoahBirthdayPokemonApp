#!/usr/bin/env bash
# Serve the app from this folder so index.html loads at /
cd "$(dirname "$0")"
PORT=5555
echo "Starting server at http://localhost:$PORT/"
echo "Open that URL in your browser. Press Ctrl+C to stop."
python3 -m http.server "$PORT"
