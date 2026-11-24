# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.
- **SDD docs for the area**: its proposals in `docs/proposals/`, its designs in `docs/designs/`, and the technical spec in `docs/architecture/` (`spec-tecnica-destrabe-app.md`).

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. `GLOSSARY.md` is created when it's needed, with the `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`), when terms or decisions actually get resolved.

## File structure

This is a single-context repo:

```
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   │   └── ADR-003-better-auth.md
│   ├── architecture/
│   ├── proposals/
│   └── designs/
├── app/
├── backend/
└── shared/
```

ADRs follow the existing format: `docs/adr/ADR-NNN-tema.md` (for example, `docs/adr/ADR-003-better-auth.md`). New ADRs take the next number.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-003 (Better Auth), but worth reopening because…_
