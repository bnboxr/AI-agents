@echo off
echo 🚀 HSMC Platform Installer
echo ==========================
echo.
echo 📦 Installing Bun...
powershell -Command "irm bun.sh/install.ps1 | iex"
echo.
echo 📥 Downloading project...
if exist "%USERPROFILE%\hsmc-platform" (
    cd "%USERPROFILE%\hsmc-platform"
    git pull
) else (
    git clone https://github.com/bnboxr/AI-agents.git "%USERPROFILE%\hsmc-platform"
    cd "%USERPROFILE%\hsmc-platform"
)
echo.
echo 📦 Installing dependencies...
bun install
echo.
echo ✅ Done! Start: cd %USERPROFILE%\hsmc-platform && bun run dev
pause
