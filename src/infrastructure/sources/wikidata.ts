/**
 * The Wikidata API's response shapes we rely on (CC0), shared by headliner identity
 * (`identity.ts`) and official-site discovery (`gigs/web-adapters.ts`). One contract, one place
 * to fix if Wikidata changes it (D-086).
 */
import { z } from "zod";

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

/** `action=query&list=search`: item ids (`Q…`) only. */
export const WikidataSearchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string().regex(/^Q\d+$/u) })) }),
});

/** `action=wbgetentities&props=claims`: each claim's main value, still untyped. */
export const WikidataClaimsSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      claims: z
        .record(
          z.string(),
          z.array(
            z.object({
              mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }),
            }),
          ),
        )
        .optional(),
    }),
  ),
});
