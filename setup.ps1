Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Compliance App Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Checking if containers are running..." -ForegroundColor Yellow
docker-compose ps

Write-Host ""
Write-Host "Running database migrations..." -ForegroundColor Yellow
Get-Content migrations.sql | docker-compose exec -T db psql -U compliance -d compliance

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Migration failed. Make sure Docker containers are running." -ForegroundColor Red
    Write-Host "If this is a fresh install, migrations will run automatically." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Rebuilding API container..." -ForegroundColor Yellow
docker-compose up -d --build api

Write-Host ""
Write-Host "Verifying database schema..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
docker-compose exec -T db psql -U compliance -d compliance -c "\d evidence" | Select-String "ai_"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Make sure to configure .env with your credentials:" -ForegroundColor Yellow
Write-Host "- Database passwords" -ForegroundColor White
Write-Host "- JWT_SECRET" -ForegroundColor White
Write-Host "- Azure OpenAI credentials (if using AI features)" -ForegroundColor White
Write-Host "- SMTP settings (if using email notifications)" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
