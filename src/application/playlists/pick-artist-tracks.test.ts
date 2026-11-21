import { describe, expect, it } from "vitest";
import { chartTitlesFor } from "./pick-artist-tracks";

const chart = [
  { title: "Kesariya", artistName: "Pritam, Arijit Singh & Amitabh Bhattacharya", rank: 2 },
  { title: "Sajni", artistName: "ARIJIT SINGH", rank: 7 },
  { title: "Duet", artistName: "Shreya Ghoshal and Arijit Singh", rank: 5 },
  { title: "Raat", artistName: "Ritviz x Nucleya", rank: 3 },
  { title: "Feat", artistName: "Rashmeet Kaur feat. Raftaar", rank: 4 },
  { title: "Sounds", artistName: "Simon & Garfunkel", rank: 1 },
  { title: "Hustle", artistName: "Raja Kumari", rank: 6 },
];

describe("chartTitlesFor (D-045 credit splitting)", () => {
  it.each([
    ["Arijit Singh", ["Kesariya", "Duet", "Sajni"]],
    ["Pritam", ["Kesariya"]],
    ["Amitabh Bhattacharya", ["Kesariya"]],
    ["Shreya Ghoshal", ["Duet"]],
    ["Nucleya", ["Raat"]],
    ["Raftaar", ["Feat"]],
    ["Simon & Garfunkel", ["Sounds"]],
    ["Raja", []],
    ["Prateek Kuhad", []],
  ])("%s → %j", (artist, titles) => {
    expect(chartTitlesFor(artist, chart)).toEqual(titles);
  });
});
