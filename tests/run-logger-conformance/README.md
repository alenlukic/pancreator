# Run-logger Phoenix conformance (M1 Option A)

Local bootstrap:

```sh
docker compose -f tests/run-logger-conformance/docker-compose.yml up -d
```

Wait for health:

```sh
curl -sf http://127.0.0.1:6006/health
```

Run the conformance suite from the repository root:

```sh
pnpm test:run-logger-conformance
```

Teardown:

```sh
docker compose -f tests/run-logger-conformance/docker-compose.yml down
```

When Docker is unavailable, smoke tests log an explicit skip reason and exit successfully for local development; CI on `ubuntu-latest` runs with Docker enabled and fails closed on boot or ingest errors.
