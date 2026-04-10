@echo off
title DiscordOptimizer Installer
color 0B
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo    DiscordOptimizer - Vencord Plugin Installer
echo  ============================================
echo.

set "FOUND="

for %%D in (
    "%USERPROFILE%\Vencord\src"
    "%USERPROFILE%\Desktop\Vencord\src"
    "%USERPROFILE%\Documents\Vencord\src"
    "%USERPROFILE%\Downloads\Vencord\src"
    "C:\Vencord\src"
    "D:\Vencord\src"
) do (
    if not defined FOUND (
        if exist %%D (
            set "VENCORD=%%~D"
            set "FOUND=1"
        )
    )
)

if not defined FOUND (
    echo  [!] Could not find Vencord automatically.
    echo.
    echo  Please enter the full path to your Vencord folder
    echo  Example: C:\Users\YourName\Vencord
    echo.
    set /p "MANUAL_PATH=  Path: "
    if exist "!MANUAL_PATH!\src" (
        set "VENCORD=!MANUAL_PATH!\src"
        set "FOUND=1"
    ) else (
        echo.
        echo  [X] Invalid path - no src folder found at that location.
        echo  Make sure you have Vencord built from source.
        echo.
        pause
        exit /b 1
    )
)

echo  [+] Found Vencord at: %VENCORD%
echo.

if not exist "%VENCORD%\userplugins" (
    echo  [+] Creating userplugins folder...
    mkdir "%VENCORD%\userplugins"
)

set "DEST=%VENCORD%\userplugins\discordOptimizer"

if exist "%DEST%" (
    echo  [!] discordOptimizer already exists at:
    echo      %DEST%
    echo.
    set /p "OVERWRITE=  Overwrite? (y/n): "
    if /i "!OVERWRITE!" neq "y" (
        echo.
        echo  [*] Cancelled. No changes made.
        pause
        exit /b 0
    )
    rmdir /s /q "%DEST%"
)

mkdir "%DEST%"

set "SCRIPT_DIR=%~dp0"

copy "%SCRIPT_DIR%index.tsx" "%DEST%\index.tsx" >nul 2>&1
if errorlevel 1 (
    echo  [X] Failed to copy index.tsx
    echo  Make sure index.tsx is in the same folder as this installer.
    pause
    exit /b 1
)

echo.
echo  [+] Installed to: %DEST%
echo.
echo  ============================================
echo    Installation complete!
echo  ============================================
echo.
echo  Next steps:
echo    1. Open a terminal in your Vencord folder
echo    2. Run: pnpm build
echo    3. Restart Discord (Ctrl+R)
echo    4. Enable DiscordOptimizer in Settings
echo       -^> Vencord -^> Plugins
echo.

set /p "BUILD_NOW=  Run pnpm build now? (y/n): "
if /i "!BUILD_NOW!"=="y" (
    echo.
    echo  [+] Building Vencord...
    echo.
    cd /d "%VENCORD%\.."
    pnpm build
    if errorlevel 1 (
        echo.
        echo  [!] Build failed. Make sure pnpm and Node.js are installed.
        echo  Install pnpm: npm i -g pnpm
    ) else (
        echo.
        echo  [+] Build successful! Restart Discord to activate the plugin.
    )
)

echo.
pause
exit /b 0
