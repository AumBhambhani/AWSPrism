@echo off
echo ========================================
echo Compliance App Setup
echo ========================================
echo.

echo Checking if containers are running...
docker-compose ps

echo.
echo Running database migrations...
docker-compose exec -T db psql -U compliance -d compliance < migrations.sql

if %errorlevel% neq 0 (
    echo Migration failed. Make sure Docker containers are running.
    echo If this is a fresh install, migrations will run automatically.
    exit /b 1
)

echo.
echo Rebuilding API container...
docker-compose up -d --build api

echo.
echo Verifying database schema...
timeout /t 3 /nobreak > nul
docker-compose exec -T db psql -U compliance -d compliance -c "\d evidence" | findstr "ai_"

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Make sure to configure .env with your credentials:
echo - Database passwords
echo - JWT_SECRET
echo - Azure OpenAI credentials (if using AI features)
echo - SMTP settings (if using email notifications)
echo.
echo ========================================
