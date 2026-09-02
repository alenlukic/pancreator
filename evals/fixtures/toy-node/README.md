# toy-node

A minimal Node.js package used as the target repository for Pancreator eval runs. `pan eval run <scenario>` copies this directory to `runtime/logs/evals/<eval-id>/workspace` and starts a workflow run against the copy. The harness checkout itself is never the eval workspace.

Scripts: `npm run lint`, `npm test`, `npm run check`, `npm run validate`, `npm run build`. All complete in under a second and touch no network.
