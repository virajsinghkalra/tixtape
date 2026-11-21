import { describe, expect, it } from "vitest";
import { nameVariants } from "./variants";

const v = (name: string) => ({ name, kind: "variant" });
const raw = (name: string) => ({ name, kind: "raw" });
const part = (name: string) => ({ name, kind: "collab_part" });

describe("nameVariants", () => {
  it.each([
    // Descriptor suffixes (HOME Festival 2026)
    ["Avneet Music", [raw("Avneet Music"), v("Avneet"), v("DJ Avneet")]],
    ["Dhyan Live", [raw("Dhyan Live"), v("Dhyan"), v("DJ Dhyan")]],
    ["MXRCI (Live Set)", [raw("MXRCI (Live Set)"), v("MXRCI"), v("DJ MXRCI")]],
    [
      "Nitish Wadhwa Live Set",
      [raw("Nitish Wadhwa Live Set"), v("Nitish Wadhwa"), v("DJ Nitish Wadhwa")],
    ],
    ["Ritviz Official India", [raw("Ritviz Official India"), v("Ritviz"), v("DJ Ritviz")]],
    ["Raghu Dixit The Band", [raw("Raghu Dixit The Band"), v("Raghu Dixit"), v("DJ Raghu Dixit")]],
    ["KSHMR [DJ Set]", [raw("KSHMR [DJ Set]"), v("KSHMR"), v("DJ KSHMR")]],
    // DJ prefix toggled both ways
    ["Sazi", [raw("Sazi"), v("DJ Sazi")]],
    ["DJ Chetas", [raw("DJ Chetas"), v("Chetas")]],
    ["dj. Sazi", [raw("dj. Sazi"), v("Sazi")]],
    // Collaborations: each side, as a fallback
    ["PRFCT & DARK", [raw("PRFCT & DARK"), part("PRFCT"), part("DARK")]],
    ["Khan & Noor", [raw("Khan & Noor"), part("Khan"), part("Noor")]],
    ["Khan&Noor", [raw("Khan&Noor"), part("Khan"), part("Noor")]],
    ["Ritviz x Nucleya", [raw("Ritviz x Nucleya"), part("Ritviz"), part("Nucleya")]],
    [
      "Ritviz ft. Seedhe Maut",
      [raw("Ritviz ft. Seedhe Maut"), part("Ritviz"), part("Seedhe Maut")],
    ],
    ["A & B Live", [raw("A & B Live"), v("A & B"), part("A"), part("B")]],
    // Nothing to vary but the DJ toggle
    ["Aarzu Boys", [raw("Aarzu Boys"), v("DJ Aarzu Boys")]],
    ["Felix", [raw("Felix"), v("DJ Felix")]],
    // A name that is only a descriptor keeps it
    ["Live", [raw("Live"), v("DJ Live")]],
    ["Music", [raw("Music"), v("DJ Music")]],
    // Non-Latin scripts
    ["अरिजीत सिंह", [raw("अरिजीत सिंह"), v("DJ अरिजीत सिंह")]],
    // Blank
    ["", []],
    ["   ", []],
    ["!!!", []],
  ])("%j", (name, expected) => {
    expect(nameVariants(name)).toEqual(expected);
  });

  it("puts the raw name first and collab parts last", () => {
    const kinds = nameVariants("Seedhe Maut Live & KR$NA").map((x) => x.kind);
    expect(kinds[0]).toBe("raw");
    expect(kinds.indexOf("collab_part")).toBeGreaterThan(kinds.lastIndexOf("variant"));
  });
});
