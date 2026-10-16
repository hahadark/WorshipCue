@echo off
rem Run WorshipCue from the current source code (no build needed)
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
