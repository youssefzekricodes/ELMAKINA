#!/usr/bin/env bash
# Build ELMEKINA, put it on a device, and start it. One command, no shell setup.
#
# Prefers a real phone if one is plugged in; otherwise boots an emulator and waits for it. Nothing
# here needs JAVA_HOME, ANDROID_HOME or adb on your PATH — the fallbacks below supply all three,
# because none of them are set on a normal macOS shell and every one of them fails confusingly.
#
#   npm run android              # first available AVD
#   AVD=Medium_Phone_API_35 npm run android
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMU="$ANDROID_HOME/emulator/emulator"
PKG=com.elmekina.game

[ -x "$ADB" ] || { echo "adb not found at $ADB — is the Android SDK installed?" >&2; exit 1; }

# A device already attached (phone or running emulator) is always preferred: booting a second
# emulator when one is right there is a minute of waiting for nothing.
if [ -z "$("$ADB" devices | awk 'NR>1 && $2=="device"')" ]; then
  avd="${AVD:-$("$EMU" -list-avds 2>/dev/null | head -1)}"
  [ -n "$avd" ] || { echo "No device attached and no emulator configured. Create an AVD, or plug in a phone with USB debugging on." >&2; exit 1; }
  echo "==> booting emulator: $avd"
  # Detached with its own log: the emulator never exits on its own, so holding the script open on it
  # would mean this command never finishes.
  "$EMU" -avd "$avd" > /tmp/mekina-emulator.log 2>&1 &
  "$ADB" wait-for-device
  echo "==> waiting for Android to finish booting"
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi

echo "==> building"
npm run apk

echo "==> installing"
"$ADB" install -r android/app/build/outputs/apk/debug/app-debug.apk

echo "==> starting"
"$ADB" shell am start -n "$PKG/.MainActivity" > /dev/null
echo "==> ELMEKINA is running. Logs:  $ADB logcat --pid=\$($ADB shell pidof $PKG)"
