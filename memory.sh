#!/bin/bash
#
# memory.sh
#
# Lists all source files (recursively) except those in node_modules / cache
# and package-lock.json, concatenates each file preceded by a heading
# "### <relative/path>", and copies the result to the macOS clipboard.
set -euo pipefail
# Create a temporary file for concatenated content
temp_file=$(mktemp)
echo "Listing and concatenating files (excluding node_modules, cache, and package-lock.json)…"
total_bytes=0
while IFS= read -r file; do
    size_bytes=$(wc -c < "$file" | tr -d ' ')
    size_kb=$(( (size_bytes + 1023) / 1024 ))
    if [ "$size_bytes" -gt 204800 ]; then
      color="\033[31m"  # red
      echo -e "${color}### $file (too large: ${size_kb} KB), skipping\033[0m"
    else
      if [ "$size_kb" -gt 50 ]; then
        color="\033[31m"  # red
      elif [ "$size_kb" -gt 10 ]; then
        color="\033[33m"  # yellow
      else
        color=""
      fi
      if [ -n "$color" ]; then
        echo -e "${color}### $file (${size_kb} KB)\033[0m"
      else
        echo "### $file (${size_kb} KB)"
      fi
      total_bytes=$((total_bytes + size_bytes))
      {
        echo -e "\n### $file\n" # heading into temp file
        cat "$file"
        echo # trailing newline for separation
      } >> "$temp_file"
    fi
done < <(find . \
  -type f \
  ! -path "*/node_modules/*" \
  ! -path "*/dist/*" \
  ! -path "*/test/*" \
  ! -name "package-lock.json" \
  \( -name "*.ts" -o -name "*.js" -o -name "*.json" -o -name "*.md" \) \
)
echo "Copying concatenated content to clipboard…"
pbcopy < "$temp_file"
# Clean up
rm "$temp_file"
echo "All file contents (with labels) have been copied to the clipboard!"
total_kb=$(( (total_bytes + 1023) / 1024 ))
echo "Total file size copied: ${total_kb} KB"
