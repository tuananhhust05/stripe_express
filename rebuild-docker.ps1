# PowerShell script to clean Docker cache and rebuild
Write-Host "Cleaning Docker build cache..." -ForegroundColor Yellow
docker builder prune -f

Write-Host "Removing old images..." -ForegroundColor Yellow
docker-compose down
docker rmi source_stripe_macos-app 2>$null

Write-Host "Building fresh images..." -ForegroundColor Green
docker-compose build --no-cache

Write-Host "Done! You can now run: docker-compose up" -ForegroundColor Green

