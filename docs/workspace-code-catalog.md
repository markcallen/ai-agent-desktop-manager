# Dependency Catalog

This catalog summarizes the first-party dependencies directly referenced by this repository's configuration, documentation, or operational workflows.

See [`first-party-dependency-graph.md`](./first-party-dependency-graph.md) for the full graph and management notes.

## ai-agent-desktop-manager dependency check

| Dependency                  | Evidence in this repo                                                                                       | Status                        | Notes                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `@everydaydevopsio/ballast` | `.rulesrc.json` pins Ballast `5.4.2`                                                                        | Active direct dependency      | Track version drift against the pinned version deliberately                              |
| `ai-agent-browser`          | Referenced by [`docs/ec2-smoke-test.md`](./ec2-smoke-test.md) and smoke scripts                             | Active direct dependency      | Used as the browser control plane; a sibling checkout is required for the EC2 smoke flow |
| `novnc-openbox-ansible`     | Consumed as an Ansible Galaxy role in [`infra/ansible/requirements.yml`](../infra/ansible/requirements.yml) | Active operational dependency | Pin to a stable role version; see requirements.yml for the current pin                   |
