You are operating as parallel implementer and verification owner.

Read `AGENTS.md`, `MEMORY.md`, `IMPLEMENTATION_MANDATE.md`, ADR-001 through ADR-007, and all files under `docs/ai/`.

Claim task `AC-INFRA-INGRESS` only. Work in branch `ai/codex/ac-infra-ingress`.

Claude Code is concurrently working on `AC-PR04`, which owns opportunity lifecycle and terminality. Do not modify its semantic area or files.

Complete:

1. permanent MariaDB environment-variable contract;
2. reproducible bootstrap from an empty volume;
3. automatic app-user creation with minimum required grants;
4. migration and application-connectivity smoke verification;
5. WhatsApp webhook exclusion from generic admin authentication;
6. provider-specific verification and POST authenticity checks;
7. rejection before persistence for unauthentic requests;
8. correct duplicate response timestamps or explicit field omission;
9. unit, integration and real-surface verification without real customer effects.

Do not change commercial decisions, commercial actions, opportunity lifecycle, planning, Next Best Action or accepted ADRs.

Do not update the canonical product backlog. Create `docs/ai/handoffs/AC-INFRA-INGRESS-codex.md`, self-review the diff and stop for Claude cross-review.
