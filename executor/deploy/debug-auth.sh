#!/bin/bash
# Debug bearer mismatch without revealing the secret value.
S=$(sudo -n cat /etc/cowork-executor/secret)
echo "shell_len=${#S}"
printf 'direct: '
curl -s -H "Authorization: Bearer $S" http://127.0.0.1:8899/v1/health
echo
echo "--- header bytes node sees ---"
sudo -n node /opt/cowork-executor/debug-header.mjs "$S"
