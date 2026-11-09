# Ansible integration point

Drop your existing automation here **unchanged**:

```
backend/ansible/
├── site.yml            <- your playbook (ANSIBLE_PLAYBOOK, default site.yml)
├── ansible.cfg         <- optional
├── inventory/
│   ├── group_vars/     <- linked into every run (vault files OK)
│   └── host_vars/
└── roles/              <- your roles
```

The worker mounts this directory **read-only** at `/ansible`. See the root README -> "Integrating your playbook".
