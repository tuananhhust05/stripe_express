#!/bin/bash
# Bash script to clean Docker cache and rebuild

echo "Cleaning Docker build cache..."
docker builder prune -f

echo "Removing old images..."
docker-compose down
docker rmi source_stripe_macos-app 2>/dev/null

echo "Building fresh images..."
docker-compose build --no-cache

echo "Done! You can now run: docker-compose up"

