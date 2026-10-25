#!/bin/bash
set -euo pipefail
TASK_DIR="$(cd "$(dirname "$0")" && pwd)"
TASK_SOURCE="$TASK_DIR/build/键盘工坊.app"
TASK_DEST="$HOME/Applications/键盘工坊.app"
if [ "${1:-}" != "--no-build" ]; then bash "$TASK_DIR/build.sh"; fi
if pgrep -x KeyboardWorkshop >/dev/null; then
  printf '%s\n' '键盘工坊正在运行，请先从菜单栏退出，再运行安装程序。'
  exit 1
fi
mkdir -p "$HOME/Applications"
if [ -e "$TASK_DEST" ]; then
  TASK_ID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$TASK_DEST/Contents/Info.plist")
  if [ "$TASK_ID" != 'local.yuezhiping.keyboard-workshop' ]; then
    printf '%s\n' '目标位置已有其他应用，请先修改安装路径。'
    exit 1
  fi
  mkdir -p "$TASK_DIR/build/previous"
  mv "$TASK_DEST" "$TASK_DIR/build/previous/键盘工坊-$(date +%Y%m%d-%H%M%S).app"
fi
ditto "$TASK_SOURCE" "$TASK_DEST"
codesign --verify --deep --strict "$TASK_DEST"
open "$TASK_DEST"
printf '已安装并打开：%s\n' "$TASK_DEST"
