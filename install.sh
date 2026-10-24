#!/usr/bin/env bash
# Install Adobe CLI: the extension Premiere Pro and After Effects load at startup, and the `adobe` command.
#
#   ./install.sh              install (safe to run again)
#   ./install.sh --uninstall  remove it
#
# Mac, and Windows through Git Bash.
set -e
cd "$(dirname "$0")"
REPO="$(pwd)"
ID="com.adobecli.bridge"

case "$(uname -s)" in
  Darwin) OS=mac; CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions" ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows; CEP_DIR="$APPDATA/Adobe/CEP/extensions" ;;
  *) echo "Adobe CLI runs on macOS or Windows (Git Bash)."; exit 1 ;;
esac
BIN_DIR="$HOME/.local/bin"
SKILL_DIR="$HOME/.claude/skills/adobe"

if [ "${1:-}" = "--uninstall" ]; then
  rm -rf "$CEP_DIR/$ID" "$BIN_DIR/adobe" "$SKILL_DIR"
  echo "Removed the extension, the adobe command and the Claude skill. Restart Premiere Pro / After Effects."
  exit 0
fi

# 1. The extension. A symlink on Mac, so `git pull` updates it; a copy on Windows.
mkdir -p "$CEP_DIR"
rm -rf "$CEP_DIR/$ID"
if [ "$OS" = mac ]; then ln -s "$REPO/extension" "$CEP_DIR/$ID"; else cp -R "$REPO/extension" "$CEP_DIR/$ID"; fi
echo "✓ extension installed in $CEP_DIR/$ID"

# 2. Let the apps load an extension that isn't signed (Adobe's "PlayerDebugMode"), for every CEP version.
for v in 9 10 11 12 13; do
  if [ "$OS" = mac ]; then defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
  else reg add "HKCU\\Software\\Adobe\\CSXS.$v" /v PlayerDebugMode /t REG_SZ /d 1 /f >/dev/null; fi
done
echo "✓ unsigned extensions allowed (PlayerDebugMode, CSXS 9–13)"

# 3. The `adobe` command.
mkdir -p "$BIN_DIR"
chmod +x "$REPO/bin/adobe"
ln -sf "$REPO/bin/adobe" "$BIN_DIR/adobe"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    rc="$HOME/.zshrc"; [ "$(basename "${SHELL:-}")" = bash ] && rc="$HOME/.bashrc"
    grep -qs 'adobe-cli: PATH' "$rc" || printf '\n# adobe-cli: PATH\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    echo "  (added ~/.local/bin to PATH in $rc; open a new terminal or run: export PATH=\"\$HOME/.local/bin:\$PATH\")" ;;
esac
echo "✓ adobe command installed in $BIN_DIR"

# 4. A Claude Code skill, so Claude knows the commands without reading this repo.
mkdir -p "$(dirname "$SKILL_DIR")"
rm -rf "$SKILL_DIR"
ln -s "$REPO/skill/adobe" "$SKILL_DIR" 2>/dev/null || cp -R "$REPO/skill/adobe" "$SKILL_DIR"
echo "✓ Claude Code skill installed in $SKILL_DIR"

# 5. Check. Apps load extensions when they start, so a running app needs a restart once.
echo
for pair in "47651:Premiere Pro:Adobe Premiere Pro" "47652:After Effects:After Effects" "47653:Audition:Adobe Audition"; do
  port="${pair%%:*}"; rest="${pair#*:}"; label="${rest%%:*}"; proc="${rest#*:}"
  if curl -s --max-time 3 "http://127.0.0.1:$port/ping" | grep -q '"ok": true'; then
    echo "✓ $label is answering"
  elif pgrep -f "$proc" >/dev/null 2>&1; then
    echo "• $label is open but not answering: quit and reopen it, open a project, then Window > Extensions > Adobe CLI"
  else
    echo "• $label isn't open: start it, open a project, then Window > Extensions > Adobe CLI (once; it stays in your workspace)"
  fi
done
