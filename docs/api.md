# Evaluation API

`@siapso/server` is a small Node service (`node:http`, no framework) that runs the same deterministic engine package as the offline app. The same context and the same pack version give the same `Evaluation` online and offline. A test sends every reference case (`eval/cases`) through HTTP and through the library and checks that the outputs are deeply equal (`server/test/parity.test.ts`).

The machine-readable contract is `server/openapi.yaml` (OpenAPI 3.1). It is generated from the request schema in `server/src/validate.ts` by `pnpm --filter @siapso/server openapi`, and a test fails when the committed file is stale.

## Endpoints

| Method and path     | Key | Answer                                                                                                                                |
| ------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/health`    | no  | `200 {"status":"ok"}`                                                                                                                 |
| `GET /v1/pack`      | no  | `200` with `version`, `date`, `clinicallyValidated` and `counts` (substances, classes, products, plants, rules, dangerSigns, sources) |
| `POST /v1/evaluate` | yes | `200` with the engine `Evaluation`                                                                                                    |

`POST /v1/evaluate` takes `{ "pack_version": "<version>", "context": <EvaluationContext> }`. The context is the engine's `EvaluationContext` (`engine/src/types.ts`): `pregnancy` (`weeksMin`, `weeksMax`, `precision`), `breastfeeding` (`babyAgeWeeks`, `premature`), `conditions`, `items` (each with a `ref` that is a product id, a plant id or unrecognised text, and `unitsPerDay`, `longTerm`, `strengthUnknown`, `strengthAtMostMg`) and `signs`.

Status codes of `POST /v1/evaluate`, in the order the server checks them:

| Status | Meaning                                                                                    |
| ------ | ------------------------------------------------------------------------------------------ |
| 401    | No valid API key (`Authorization: Bearer <key>` or `X-API-Key: <key>`).                    |
| 429    | The quota of the key is used up; `Retry-After` gives the seconds to wait.                  |
| 415    | The content type is not `application/json`.                                                |
| 413    | The body is over 16 KiB.                                                                   |
| 400    | Invalid JSON, or the request does not match the schema; `details` lists `{path, message}`. |
| 409    | `pack_version` differs from the loaded pack; `packVersion` gives the one the server has.   |
| 200    | The engine `Evaluation`.                                                                   |

pregnancy.weeksMax goes up to 60 and weeksMin up to 45, so other callers can send their own ranges; the app itself never sends a term past 42 weeks (it asks to update an outdated profile first). As in the app, the engine looks 14 days past the upper end of the term (`TERM_LOOKAHEAD_DAYS`) for the rules that give a finding.

Other answers: 404 (unknown path), 405 (wrong method, with Allow), 400 for a request target that is not valid, 408 for a request that is too slow, 500 for an internal failure, including any engine error other than a RangeError (generic body, nothing from the failure is returned). Every refusal sent before the body is read (401, 404, 405, 413, 415, 429) closes the connection. Limits: request 10 s, headers 5 s, keep-alive 5 s, 256 connections.

Error bodies are `{"error": "<code>", "message": "<text>", ...}`. Errors never contain a value of the request.

## Privacy guarantees

- The server accepts no identifying data. The request schema sets `additionalProperties: false` at every level, so a name, a phone number, an address, a date of birth or a note is refused with `400` (the response gives the parent path and "unknown property", never the name or value of the key).
- The only free text is the name of an **unrecognised item**, at most 80 characters. It is typed by a user: clients should warn that it must not contain personal data. The server never logs it and never echoes it, not even in an error.
- Logs hold one JSON line per request with `method`, `path`, `status` and `latencyMs` and nothing else: no body, no key, no query string (a path that is not an endpoint is logged as `-`).
- Nothing is stored: the service is stateless apart from the in-memory quota counters.
- If the engine refuses a value that passed the schema, the answer is a generic `400`; the engine's message, which could quote values, is dropped.

## API keys

The server reads a JSON file of SHA-256 hashes, given by the path in `SIAPSO_API_KEYS_FILE`:

```json
{ "keys": [{ "id": "partner-a", "sha256": "<64 lowercase hex characters>" }] }
```

Make a key and its hash with, for example, `node -e "const k=require('crypto').randomBytes(32).toString('base64url');console.log(k, require('crypto').createHash('sha256').update(k).digest('hex'))"`. Give the key to the partner, put only the hash in the file. The server hashes the presented key and compares it with every stored hash in constant time. Keys are never logged. The file holds no secret, but keep it out of the repository: it belongs to the deployment.

## Deployment

The server speaks plain HTTP. TLS terminates at a reverse proxy or load balancer in front of it, and API keys must never cross plain HTTP: expose only the HTTPS side. A public deployment belongs behind a buffering reverse proxy (it absorbs slow clients, enforces its own limits and hides the service); the timeouts and the 256-connection cap of the server are a second line, not the first.

## Quota

Fixed window of one minute per key, `SIAPSO_QUOTA_PER_MINUTE` requests (default 60). The counters are in memory and **per instance**: with several instances behind a load balancer, each counts on its own, so the effective limit of a key is the limit times the number of instances. A request without a valid key counts against nothing. The server refuses to start when the key file holds no key.

## Running it

```sh
pnpm knowledge:build            # builds app/public/pack/pack.json
export SIAPSO_API_KEYS_FILE=/path/to/keys.json
pnpm server:start               # listens on PORT (default 8080)
```

| Variable                  | Default                     | Meaning                     |
| ------------------------- | --------------------------- | --------------------------- |
| `SIAPSO_API_KEYS_FILE`    | required                    | Key hashes file             |
| `SIAPSO_PACK_FILE`        | `app/public/pack/pack.json` | The pack to load            |
| `SIAPSO_QUOTA_PER_MINUTE` | `60`                        | Requests per key and minute |
| `PORT`, `HOST`            | `8080`, `0.0.0.0`           | Where to listen             |

The pack is read once at start. To serve a new pack, restart the service; clients that still send the old `pack_version` get `409`.

## Container

`server/Dockerfile` (Node 24 slim, non-root user, health check on `/v1/health`) is built from the repository root after `pnpm knowledge:build`:

```sh
docker build -f server/Dockerfile -t siapso-server .
docker run -p 8080:8080 -v /path/to/keys.json:/run/secrets/keys.json:ro siapso-server
```

The CI does not build or publish an image. Publishing one is a separate decision.
