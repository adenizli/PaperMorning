# PaperMorning — Approved MVP Architecture Contract

> Owner decisions consolidated on 2026-11-22. This file defines the technical implementation boundaries for a **small self-hosted MVP**. It is not a claim that any code, tests, or deployment exists. Domain-module boundaries are still open for owner review.
>
> **Priority:** When older documents contradict this contract, this document and [LEAN_MVP_SCOPE.md](LEAN_MVP_SCOPE.md) govern the MVP.
>
> **Confidentiality:** Original PaperMorning design; do not copy private source, names, proprietary packages, URLs or business logic from external projects.

## 1. Stack and deployment

- Backend: **NestJS (TypeScript), one modular-monolith deployable, PostgreSQL, TypeORM**, explicit migrations; `synchronize: false`.
- Frontend: **React + Vite + React Router**. One client codebase, built both for a browser and an **Electron** desktop shell. No SSR, Next.js, frontend API routes, or separate Electron business backend.
- Repositories: **two independent repositories**, server and client; **no monorepo**. Exchange an explicit versioned HTTP API/OpenAPI contract, not source-code imports.
- Self-hosting: one NestJS process and one PostgreSQL service, persistent private PDF volume. Optional simple Docker Compose for server+DB; deployable behind an HTTPS reverse proxy. React static web build can be hosted by NestJS or a normal static server.
- Web: use same-origin `/api` when hosted together; configure SPA fallback for React Router. Desktop: user enters the server URL/IP at runtime; Electron connects to the same NestJS API. Never bake a specific server address into the build.
- No Redis, RabbitMQ, Kafka, Kubernetes, vector DB, second application worker, distributed scheduler, custom workflow framework, or microservices in MVP.

## 2. Registration, authentication, authorization — deliberately tiny

**The registration form has exactly THREE user-entered fields:**
1. `username`
2. `email`
3. `password`

A database primary key and technical timestamps are server-managed metadata, **not** additional signup fields. Store `passwordHash`, **never plaintext password**. Normalize and enforce uniqueness of username and email. Validate basic length/email format, and use a reputable password hashing implementation.

**There is NO email verification.** Do not implement a verification email, verify-email endpoint, confirmation token, resend verification flow, verified flag, or `verifiedAt` column. The system also does not need password-reset email, recovery UX, OAuth, MFA, SSO, or role hierarchy in the MVP.

- Register -> log in using email or username + password -> receive a **3-hour access credential**.
- **No refresh token, no sliding expiration.** On expiry, log in again. Logout clears the client credential/cookie. With a stateless JWT, logout does not revoke an already stolen token before expiration; this trade-off is accepted for MVP.
- Browser: prefer a 3-hour `HttpOnly`, `Secure` cookie over storing raw JWT in localStorage. If cookie auth is selected, handle CSRF and origin rules correctly. Desktop may require a separate safe credential transport/storage boundary; do not disable browser security or use wildcard credentialed CORS to accommodate Electron.
- Global auth guard protects personal endpoints. Repository/service operations scope private data to the authenticated user ID. Client-supplied `userId` must never grant access. Private PDFs are served only through authorization-checked endpoints.
- Signup/login need simple rate limiting. The self-hosting operator can disable registrations and cap user count via environment configuration. These are safeguards, **not** an admin console.
- **Implication of skipping email verification:** email ownership cannot be confirmed; fake signups can target arbitrary recipients. Mitigate by making daily email delivery **explicitly opted in during preferences/onboarding** rather than automatic at signup, keeping basic signup and send limits, and supporting one-click unsubscribe. This reduces abuse but **does not prove ownership or prevent all unsolicited mail**. Document this limitation to operators.

## 3. Reader preferences (NOT additional signup fields)

After registration, users can configure:
- Topic(s), each with separate `priority = LOW | MEDIUM | HIGH` and `knowledgeLevel = BEGINNER | INTERMEDIATE | ADVANCED`.
- Language (initially Turkish).
- IANA timezone (default `Europe/Istanbul` when unset).
- Daily email enabled/disabled; enabling requires explicit user choice, not an email verification flow.
- Target delivery time **08:00 local**. No custom schedule editor for MVP.

These belong in `ReaderPreference`/`TopicPreference`, not in the signup form or a complex identity system.

## 4. Layering and dependency injection

Four responsibilities:
- `src/domain/`: business modules, controllers, domain services/models and owned repositories/entities.
- `src/service/`: integration adapters (academic sources, Claude, SMTP, PDF renderer, filesystem, persistence setup).
- `src/core/`: application-level concerns (authentication guard/token, scheduler, configuration and context when necessary).
- `src/common/`: stateless shared helpers, enum/types/error primitives. No business policy.

Rules:
- `main.ts` only starts NestJS; `app.module.ts` composes `CoreModule`, `ServiceModule`, and `DomainModule`.
- Controller -> its domain service, never a repository/TypeORM/Claude client. Keep controllers thin. Request validation is implemented **inside this app**, since there is no external gateway.
- Domain service -> its owned repositories and other modules' **public domain services**; never import another domain's repository directly.
- Repository service -> TypeORM `Repository<Entity>`/`EntityManager`; map persistence entities to plain domain models. No editorial logic in repository.
- Constructor DI uses explicit `private readonly` dependencies. No service locator, giant god service or `forwardRef` loop unless a real need appears.
- For multi-write atomic changes use short TypeORM transactions with the transaction-scoped manager. **Never** keep a DB transaction open across network requests, Claude calls, PDF rendering or SMTP.
- File names in kebab-case and artifact-type folders (`controller/`, `service/`, `model/`, `repository/entity/`, `config/`, `enum/`); `index.ts` barrels when helpful. **Do not generate empty folders or boilerplate modules just to imitate a large system.**

Representative shape, not a mandate to create every placeholder:

```text
server/src/
  main.ts
  app.module.ts
  bootstrap/
  config/
  common/
  core/
    core.module.ts
    auth/
    scheduler/
  service/
    service.module.ts
    persistence/     # TypeORM DataSource, migrations
    academic-source/ # academic API adapters
    llm/             # Claude client + task-to-model routing
    mail/            # SMTP transport
    pdf/             # deterministic renderer
    file-storage/    # private PDF read/write
  domain/
    domain.module.ts
    account/
    research/
    editorial/
    publication/
    delivery/
    feedback/
server/test/
  unit/
  integration/
  module-init/
  e2e/

client/
  src/               # shared React UI, route components, API client
  electron/          # main/preload, no duplicate business services
```

**Domain count/naming is a discussion topic, not a pre-approved instruction to generate six empty modules.**

## 5. Daily research pipeline (single process)

1. **Discover (no LLM):** OpenAlex/arXiv discovery; Crossref for DOI metadata when useful. Collect paper version, source, dates, abstract, status, links. Be rate-limit-aware.
2. **Normalize/deduplicate (no LLM):** Canonical source IDs; distinguish preprint, published paper and revisions. Persist source provenance.
3. **Triage (rules + optionally Haiku):** Cheap relevance/novelty screen, diversity, candidate caps. Don't discard interdisciplinary papers solely because of weak keyword matches.
4. **Shared analysis (Sonnet):** Analyze only selected papers, using allowed full text where available. Store evidence, method, limitations, source references, and `ABSTRACT_ONLY` marker when necessary. Cache by paper revision + content hash + model/prompt/schema version.
5. **Personal selection and writing:** Use each user's topic priority/knowledge level; reuse suitable `ArticleVariant` by language/knowledge level where semantically correct. Sonnet writes missing variants only.
6. **Closing Ufuk Raporu (Sonnet):** Last and highest-value section. Cross-paper synthesis, academically testable hypotheses, industry pilot ideas, development opportunities, risks and measurable first steps. Separate established evidence vs editorial inference vs suggestions. Opus **off by default**, special manual/budget-limited escalation only.
7. **Publish (no LLM):** Freeze the editorial JSON/content snapshot; render browser-readable content and **real PDF** deterministically from the same snapshot. Store the PDF on a private persistent volume and its reference in PostgreSQL. One immutable issue per user/local date.
8. **Email (no LLM):** Send at **08:00 in the reader's timezone**, with a readable digest, authenticated web link AND the **actual personalized PDF attached**. The link is not a substitute for the attachment (LAN-only servers may be unreachable away from home).

## 6. Scheduling, budget, and safe retries

- One NestJS instance with `@nestjs/schedule`, one minute-level polling tick for due users. No cron per user.
- Start preparation ahead of 08:00 (06:00 local as a configurable initial planning target); only send when the PDF and issue are READY. An offline/sleeping server cannot promise on-time delivery.
- Unique PostgreSQL constraints for `(user_id, local_issue_date)`, analysis fingerprints, article variant fingerprints, `(user_id, issue_id, content_key)` feedback and `(issue_id, delivery_channel)`.
- Persist lightweight stage/checkpoint status; retry only incomplete stages. An ambiguous SMTP timeout is **UNKNOWN**, not automatically safe to resend. No silent duplicate messages or pretending that SMTP acceptance proves inbox delivery.
- Keep Claude API usage by model/task and an operator-defined daily spend cap. Metadata/dedup, scheduling, PDF and mail never call Claude. Do not silently reanalyze the same scientific evidence for every account.

## 7. Persistence: PostgreSQL, TypeORM, private files

Minimal logical data records:
- `User`: system ID, normalized unique `username`, normalized unique `email`, `passwordHash`, created timestamp (no verification state).
- `ReaderPreference` / `TopicPreference`: user-scoped publication and email choices.
- `Paper`, `PaperVersion`, `PaperAnalysis`, `ArticleVariant`: shared research cache; keep academic provenance.
- `Issue`, `PublicationRun`: personal immutable editorial snapshot, PDF path, published date and resumable run state.
- `ArticleFeedback`: user-scoped thumbs up/down; one active vote per issue article/outlook.
- `EmailDelivery`: attempt/status; `ModelUsage`: cost/usage evidence.

Use SQL foreign keys and unique constraints where ownership/identity matter; JSONB is acceptable for frozen structured editorial content. **Do not put PDFs as base64 or binary in normal database columns**. Use `synchronize: false` and explicit TypeORM migrations. Backup database **and** PDF storage together.

## 8. Minimum REST API

```text
GET    /api/health
POST   /api/auth/register       # username, email, password
POST   /api/auth/login          # email OR username + password
POST   /api/auth/logout
GET    /api/me
GET    /api/preferences
PUT    /api/preferences
GET    /api/issues
GET    /api/issues/:id
GET    /api/issues/:id/pdf      # private file access check
PUT    /api/issues/:id/feedback/:contentKey
```

**Do not add** `/api/auth/verify-email`, resend verification, password reset, refresh-token endpoints, organization management, billing or admin dashboard. Manual generation/test sending can use a local CLI or tightly restricted operator action.

## 9. Frontend and installer boundaries

- One React Router app: login/register, settings, today's issue, issue archive, article/outlook view and 👍/👎.
- Web can access a configured reachable server; desktop app prompts for `https://host` or local `http://LAN-IP:port`, tests `/api/health`, and remembers the endpoint. Unencrypted HTTP is **local trusted-network only**; remote connections need HTTPS or a private VPN.
- Electron: safe preload + `contextIsolation`, no `nodeIntegration` or general IPC execution. No business database or Claude key inside Electron.
- Server and client install independently. A future combined installer may offer Server / Desktop / Both, but is **P1** unless packaging is trivial.

## 10. Small but non-negotiable tests

1. Register with exactly three inputs, login, 3-hour expiry, no verification/refresh flow.
2. Unique username/email; invalid input rejected; password never returned in API payload.
3. User A cannot see user B's preferences, issue, PDF or vote.
4. Same paper revision analyzed once and reused by two readers.
5. A real source-backed article + last-page Ufuk Raporu; no invented citations or abstract-only full-text claims.
6. Same user/date issue generated once even with repeated triggers; restart preserves completed expensive stages.
7. Mail contains an **actual PDF attachment** and a link; daily opt-out is respected.
8. Web and Electron clients use the same NestJS API and read the same issue.
9. TypeORM migration runs, build/lint/unit/module-wiring and a minimal end-to-end smoke test pass.

## 11. Out of scope

Identity verification, password recovery emails, refresh token, multi-device session management, enterprise IAM/SSO, billing, multi-tenant company hierarchies, vector embeddings, a learning recommendation algorithm, Redis/queue clusters, Kubernetes, complex observability, and advanced multi-server operations.

**Implementation workflow:** First get one end-to-end real issue + PDF + actual email working; then add the second account, shared cache validation, thumbs feedback and desktop packaging. **Do not claim implementation complete until code actually runs and is tested.** Specific domain submodules, PDF engine and mail adapter can be decided in the next architecture discussion.
