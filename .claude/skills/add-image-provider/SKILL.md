---
name: add-image-provider
description: Add a new source of artist photos or event posters to concert-playlist-app's image pipeline (D-083), e.g. MusicBrainz, Deezer or an organiser API, as one ImageProvider adapter plus a config entry. Use when asked to 'get artist photos from X', 'add posters from organiser Y', or 'add an image source'.
---

# Add an image provider (D-083)

The pipeline is a chain of `ImageProvider`s (`src/application/ports/images.ts`). Each proposes at most one `ImageCandidate`; the pure policy `selectImage` (`src/domain/images/image.ts`) decides what is shown. Adding a source never changes the pipeline, stores or scripts.

## Steps

1. **Check the source's terms.** Free licence or official organiser asset only. No Instagram, Facebook, BookMyShow or District (D-008). Prefer a documented API.
2. **Write the adapter** in `src/infrastructure/images/<source>-provider.ts`:
   - `id`: a short stable name; `supports(subject)`: `artist` and/or `event`.
   - `find(subject)` returns `{ url, credit, license, source, confidence, evidence }` or null.
   - Fetch through `PoliteFetcher` (identifying User-Agent, 1 req/s per host, SSRF guard). Validate every response with Zod.
   - **Identity first:** return null unless sure it is the same artist/event. Reuse `identifyArtist` rules or match on IDs (Spotify, MusicBrainz) before names.
   - `confidence`: 1 for an ID match, about 0.8 for a unique name match; below 0.7 is never shown.
3. **New `source` value?** Add it to `ImageSource`, `DEFAULT_IMAGE_POLICY.trustOrder` and `allowedHosts`, and to the licence rule in `isFreeLicense` / `licenseOk` if it isn't a free-licence source.
4. **Register it:** add it to `artistProviders` or `eventProviders` in `src/infrastructure/images/images-module.ts`, in the order it should be asked.
5. **Test it:** a fake fetcher test like `images.test.ts` (right subject, namesake, missing image, non-free licence), plus a policy case in `image.test.ts` for a new source.
6. **Dry-run it** on a copy of the database: `DATABASE_URL=<copy> npx tsx src/scripts/fill-artist-images.ts --dry-run`, and review each choice before a real run.
