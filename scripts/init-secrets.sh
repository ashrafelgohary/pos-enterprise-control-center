#!/usr/bin/env bash
# Creates empty secret files and a .env with random credentials if missing.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
for f in ansible_ssh_password ansible_become_password ansible_ssh_key ansible_vault_password; do
  [ -f "secrets/$f" ] || : > "secrets/$f"
done
if [ ! -f .env ]; then
  cp .env.example .env
  rnd() { python3 -c "import secrets;print(secrets.token_urlsafe($1))"; }
  sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$(rnd 48)|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rnd 24)|" .env
  sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(rnd 24)|" .env
  sed -i "s|^INITIAL_ADMIN_PASSWORD=.*|INITIAL_ADMIN_PASSWORD=Adm1n!$(rnd 12)|" .env
  chmod 600 .env
  echo ">> .env created. Initial admin password:"; grep ^INITIAL_ADMIN_PASSWORD .env
fi
echo ">> Fill secrets/ansible_* then run: sudo chown 1000:1000 secrets/ansible_*"
