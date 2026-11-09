Secret files mounted ONLY into the worker container at /run/secrets/<name>.
Never commit them. Create with `scripts/init-secrets.sh`, then fill in what you need:

| File                      | Used when                                       |
|---------------------------|-------------------------------------------------|
| ansible_ssh_password      | ANSIBLE_AUTH_MODE=password  (-k)                |
| ansible_become_password   | sudo password (-K); falls back to ssh password  |
| ansible_ssh_key           | ANSIBLE_AUTH_MODE=key                           |
| ansible_vault_password    | your playbook uses ansible-vault                |

Unused files may stay empty. The worker runs as UID 1000:
    sudo chown 1000:1000 secrets/ansible_* && chmod 600 secrets/ansible_*
