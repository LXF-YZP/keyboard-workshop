#!/bin/bash
set -euo pipefail
TASK_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_APP="$TASK_DIR/build/键盘工坊.app"
mkdir -p "$TASK_APP/Contents/MacOS" "$TASK_APP/Contents/Resources"
swiftc -O -parse-as-library -target "$(uname -m)-apple-macosx13.0" \
  "$TASK_DIR/Sources/FirmwareExport.swift" "$TASK_DIR/Sources/GitHubFirmware.swift" "$TASK_DIR/Sources/GitHubController.swift" "$TASK_DIR/Sources/Vision.swift" "$TASK_DIR/Sources/AssistantController.swift" "$TASK_DIR/Sources/AssistantWorkflowController.swift" "$TASK_DIR/Sources/App.swift" \
  -o "$TASK_APP/Contents/MacOS/KeyboardWorkshop" -framework AppKit -framework WebKit -framework Vision -framework Security
cp "$TASK_DIR/Info.plist" "$TASK_APP/Contents/Info.plist"
# Only generated bundle resources are replaced; user projects live outside the app.
rm -rf "$TASK_APP/Contents/Resources/Web"
mkdir -p "$TASK_APP/Contents/Resources/Web"
cp "$TASK_DIR/Web/"* "$TASK_APP/Contents/Resources/Web/"
cp "$TASK_DIR/示例/42键-TPS65.kle.json" "$TASK_APP/Contents/Resources/"
if [ -f "$TASK_DIR/AppIcon.icns" ]; then cp "$TASK_DIR/AppIcon.icns" "$TASK_APP/Contents/Resources/"; fi
codesign --force --sign - --identifier local.yuezhiping.keyboard-workshop "$TASK_APP"
printf '%s\n' "$TASK_APP"
