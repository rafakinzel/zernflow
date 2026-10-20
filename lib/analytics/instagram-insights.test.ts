import { describe, it, expect } from "vitest";
import {
  buildSummary,
  followerSeries,
  metricTotal,
  splitReach,
  unavailableNames,
} from "./instagram-insights";

describe("metricTotal", () => {
  it("tells an absent metric apart from a zero", () => {
    const raw = { metrics: { reach: { total: 0 } } };
    expect(metricTotal(raw, "reach")).toBe(0);
    // Zernio omits what it could not serve. Reporting that as 0 would be a
    // number someone could act on, and it would be made up.
    expect(metricTotal(raw, "saves")).toBeNull();
    expect(metricTotal({}, "reach")).toBeNull();
  });
});

describe("splitReach", () => {
  it("splits followers from everyone else and gives the new-audience share", () => {
    const raw = {
      metrics: {
        reach: {
          breakdowns: [
            { dimension: "follower", value: 300 },
            { dimension: "non_follower", value: 700 },
          ],
        },
      },
    };

    expect(splitReach(raw)).toEqual({
      followers: 300,
      nonFollowers: 700,
      share: 0.7,
    });
  });

  it("treats an unrecognised dimension as non-follower", () => {
    // Instagram has renamed these before. Counting a new label as new
    // audience understates the share at worst; dropping it would silently
    // shrink the reach total.
    const raw = {
      metrics: {
        reach: {
          breakdowns: [
            { dimension: "FOLLOWER", value: 100 },
            { dimension: "something_new", value: 100 },
          ],
        },
      },
    };

    expect(splitReach(raw)).toEqual({
      followers: 100,
      nonFollowers: 100,
      share: 0.5,
    });
  });

  it("has no share when the breakdown is missing or empty", () => {
    expect(splitReach({})).toEqual({
      followers: null,
      nonFollowers: null,
      share: null,
    });
    expect(splitReach({ metrics: { reach: { breakdowns: [] } } }).share).toBeNull();
  });

  it("has no share when the breakdown adds up to nothing", () => {
    const raw = {
      metrics: { reach: { breakdowns: [{ dimension: "follower", value: 0 }] } },
    };
    expect(splitReach(raw).share).toBeNull();
  });
});

describe("followerSeries", () => {
  it("keeps only the days that carry both a date and a number", () => {
    const raw = {
      metrics: {
        follower_count: {
          values: [
            { date: "2026-10-01", value: 100 },
            { date: "2026-10-02" },
            { value: 102 },
            { date: "2026-10-03", value: 103 },
          ],
        },
      },
    };

    expect(followerSeries(raw)).toEqual([
      { date: "2026-10-01", value: 100 },
      { date: "2026-10-03", value: 103 },
    ]);
  });

  it("is empty rather than undefined when nothing came back", () => {
    expect(followerSeries({})).toEqual([]);
  });
});

describe("unavailableNames", () => {
  it("reads both shapes a refusal can arrive in", () => {
    expect(unavailableNames({ unavailableMetrics: ["saves"] })).toEqual(["saves"]);
    expect(
      unavailableNames({
        unavailableMetrics: [{ metric: "shares", reason: "not supported" }],
      } as never)
    ).toEqual(["shares"]);
    expect(unavailableNames({})).toEqual([]);
  });
});

describe("buildSummary", () => {
  it("assembles the three calls into one reading", () => {
    const summary = buildSummary({
      totals: {
        metrics: {
          reach: { total: 1000 },
          views: { total: 4000 },
          saves: { total: 60 },
          shares: { total: 25 },
          likes: { total: 300 },
          profile_links_taps: { total: 18 },
        },
      },
      reachByFollowerType: {
        metrics: {
          reach: {
            breakdowns: [
              { dimension: "follower", value: 400 },
              { dimension: "non_follower", value: 600 },
            ],
          },
        },
      },
      followers: {
        metrics: {
          followers_gained: { total: 45 },
          followers_lost: { total: 12 },
          follower_count: {
            values: [
              { date: "2026-10-01", value: 5000 },
              { date: "2026-10-30", value: 5033 },
            ],
          },
        },
      },
      since: "2026-10-01",
      until: "2026-10-30",
    });

    expect(summary).toMatchObject({
      reach: 1000,
      reachFromFollowers: 400,
      reachFromNonFollowers: 600,
      newAudienceShare: 0.6,
      saves: 60,
      shares: 25,
      profileLinkTaps: 18,
      followersGained: 45,
      followersLost: 12,
      // The latest day in the series, not the first.
      followerCount: 5033,
    });
    expect(summary.followerSeries).toHaveLength(2);
    // Never requested, so it stays null rather than becoming a zero.
    expect(summary.accountsEngaged).toBeNull();
  });

  it("survives every call coming back empty", () => {
    const summary = buildSummary({
      totals: {},
      reachByFollowerType: {},
      followers: {},
      since: "2026-10-01",
      until: "2026-10-30",
    });

    expect(summary.reach).toBeNull();
    expect(summary.followerCount).toBeNull();
    expect(summary.followerSeries).toEqual([]);
    expect(summary.unavailable).toEqual([]);
  });
});
