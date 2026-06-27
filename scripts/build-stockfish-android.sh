#!/usr/bin/env bash
#
# Cross-compile Stockfish for Android and drop the binaries where the native
# UciEngine plugin looks for them (jniLibs/<abi>/libstockfish.so).
#
# Stockfish builds with the NNUE net embedded, so the resulting executable is
# self-contained — no separate net file to bundle.
#
# Usage:
#   scripts/build-stockfish-android.sh            # arm64-v8a (real devices)
#   ABIS="arm64-v8a x86_64" scripts/build-stockfish-android.sh   # + emulator
#
# Requires: Android NDK (auto-detected under $ANDROID_HOME/ndk), git, make.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JNILIBS="$REPO_ROOT/android/app/src/main/jniLibs"
SF_TAG="${SF_TAG:-sf_17.1}"           # pin a Stockfish release; override with SF_TAG=...
ABIS="${ABIS:-arm64-v8a}"             # space-separated list
API="${API:-24}"                      # must match android minSdkVersion

# --- locate the NDK -------------------------------------------------------
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
NDK="${ANDROID_NDK_HOME:-}"
if [ -z "$NDK" ]; then
  NDK="$(ls -d "$SDK"/ndk/* 2>/dev/null | sort -V | tail -1 || true)"
fi
[ -n "$NDK" ] && [ -d "$NDK" ] || { echo "❌ Android NDK not found (set ANDROID_NDK_HOME)"; exit 1; }
HOST="$(ls "$NDK/toolchains/llvm/prebuilt/" | head -1)"
TOOLS="$NDK/toolchains/llvm/prebuilt/$HOST/bin"
export PATH="$TOOLS:$PATH"
echo "▶ NDK: $NDK"
echo "▶ toolchain: $TOOLS"

# ABI → Stockfish ARCH + NDK target triple.
# armv8-dotprod enables ARM Int8 dot-product NEON (-DUSE_NEON_DOTPROD), which
# massively speeds up NNUE eval. Supported by ~all phones from 2018+ (incl.
# Pixel). Devices without it would SIGILL — fall back to ARCH=armv8 via
# `SF_ARCH=armv8 scripts/build-stockfish-android.sh` if you need wider support.
abi_arch() { case "$1" in
  arm64-v8a)   echo "${SF_ARCH:-armv8-dotprod}" ;;
  armeabi-v7a) echo "armv7" ;;
  x86_64)      echo "x86-64" ;;
  *) echo "❌ unsupported ABI: $1" >&2; exit 1 ;;
esac }
abi_triple() { case "$1" in
  arm64-v8a)   echo "aarch64-linux-android" ;;
  armeabi-v7a) echo "armv7a-linux-androideabi" ;;
  x86_64)      echo "x86_64-linux-android" ;;
esac }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "▶ cloning Stockfish $SF_TAG…"
git clone --depth 1 --branch "$SF_TAG" https://github.com/official-stockfish/Stockfish "$WORK/sf" \
  || git clone --depth 1 https://github.com/official-stockfish/Stockfish "$WORK/sf"

for ABI in $ABIS; do
  ARCH="$(abi_arch "$ABI")"
  TRIPLE="$(abi_triple "$ABI")"
  CXX="$TOOLS/${TRIPLE}${API}-clang++"
  echo "▶ building $ABI (ARCH=$ARCH, CXX=$(basename "$CXX"))…"
  make -C "$WORK/sf/src" clean >/dev/null 2>&1 || true
  # KERNEL=Linux stops the Makefile from adding macOS-host flags
  # (-mdynamic-no-pic / -mmacosx-version-min) to the Android cross-compile.
  make -C "$WORK/sf/src" -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)" build \
    ARCH="$ARCH" COMP=ndk KERNEL=Linux CXX="$CXX"
  mkdir -p "$JNILIBS/$ABI"
  cp "$WORK/sf/src/stockfish" "$JNILIBS/$ABI/libstockfish.so"
  "$TOOLS/llvm-strip" "$JNILIBS/$ABI/libstockfish.so" 2>/dev/null || true
  echo "✅ $JNILIBS/$ABI/libstockfish.so"
done

echo "Done. Rebuild the app: npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)"
