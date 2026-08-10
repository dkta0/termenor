---
name: termenor-assets
description: Create, revise, validate, render, privately publish, and hand off Termenor visual assets through OMP and Play without portal feedback or premature source promotion. Use whenever an operator asks to create, change, preview, review, accept, reject, or publish a Termenor Model or Scenery asset.
---

# Termenor asset authoring

Use OMP as the human decision surface and Play as a private visual viewer. Do not invent a dashboard, upload references, submit feedback through Play, email routine previews, or move critique into an issue tracker.

## Freeze the asset contract

Before editing, capture:

- the requested subject, silhouette, scale, facing, palette, state, and animation;
- gameplay constraints such as footprint, solidity, activation, and placement;
- whether this turn is a new candidate, a revision, or explicit source acceptance;
- the exact proof the operator needs to see.

Ask only when ambiguity would produce materially different assets. Otherwise make one strong draft.

Reuse or create the repository's durable issue and an isolated worktree. Candidate work is not promoted game source.

## Create an immutable candidate

1. Read `Model`, `Scenery`, `validateModel`, and an adjacent accepted catalog entry before designing. Reuse the existing schema and renderer; do not create a parallel asset format.
2. Store drafts under the ignored path `.termenor/candidates/<slug>-rN.ts` and previews under `.termenor/previews/<slug>-rN.png`. Never overwrite an earlier revision.
3. Default-export an object that `satisfies AssetCandidate` from `scripts/asset-candidate.ts`. Use a snake-case candidate key, a precise immutable brief, the production `Model` schema, and only necessary preview controls.
4. A static draft omits `previewFrames`. An animated draft sets a bounded frame count and duration and must represent a real production-rendered state transition.
5. Do not add the candidate key to `MODELS`, place it in a live zone, or commit candidate/previews while it is under review.

## Validate and render

JavaScript dependencies run only through the repository capsule. Check it immediately before execution:

```text
capsulectl check --spec .capsule/capsule.json
```
A successful check is not execution proof; the subsequent `capsulectl run` must also succeed. If runtime source review rejects the tracked root `play` symlink, do not bypass the capsule or run Bun on the credentialed host. Record the blocker and fix the repository/capsule boundary through reviewed work before continuing.


Render with the real candidate entry point inside the capsule. Use `-` so the PNG/APNG is returned between `PNG_BASE64_BEGIN` and `PNG_BASE64_END`; decode those exact bytes into the ignored preview path outside the dependency process.

```text
capsulectl run --spec .capsule/capsule.json -- bun run scripts/asset-candidate.ts .termenor/candidates/<slug>-rN.ts -
```

The run must report schema validation, placement bounds, collision footprint, and production raster validation. Animated candidates must also report their frame count. Run the focused candidate/renderer/protocol tests through the capsule when the candidate exercises a new renderer behavior. Do not substitute a mock renderer or a hand-drawn preview.

Hash the decoded file and record its byte size, dimensions, media type, frame count, and SHA-256. Keep the candidate ignored and unpromoted.

## Publish the review image

Use the canonical publisher from a reviewed `dkta0/dkta0` checkout:

```text
node <dkta0-checkout>/untitled-project/review/scripts/publish-agent-asset.mjs .termenor/previews/<slug>-rN.png
```

The publisher reads the private token from its fixed file boundary, validates PNG/APNG/GIF bytes, verifies the server receipt against the local SHA-256, and prints the digest-addressed Play viewer URL. Never expose, copy, print, or pass the token in arguments. Never call the upload endpoint with an ad hoc client.

Open the returned URL through an authenticated production browser. Confirm the exact media loads; for animation, compare frames at separated times. Verify the content response bytes hash to the candidate digest. Unauthenticated denial must remain intact.

## Review in OMP

Return only what helps the operator judge the asset:

- the Play URL as the focal point;
- revision and immutable SHA-256;
- dimensions/frame count when relevant;
- concise validation facts;
- explicit status: `candidate only — ignored and unpromoted`.

Treat ordinary conversation as the review input. Translate requested changes into a new immutable brief and `rN+1`; do not mutate the previous candidate. If rejected, leave it to Play's retention policy unless the operator explicitly requests exact-digest deletion.

## Accept and promote separately

A positive reaction to the viewer is not source approval unless the operator explicitly accepts the candidate for integration. On explicit acceptance:

1. bind the accepted revision and SHA-256;
2. migrate the accepted `Model`/`Scenery` definition into the established catalog and placement conventions;
3. add behavior-focused schema, collision, renderer, and gameplay tests as applicable;
4. run the repository gate through the dependency capsule;
5. open a reviewed source PR and use normal production promotion gates.

Never let Play publication automatically change Termenor source, a live zone, or production.