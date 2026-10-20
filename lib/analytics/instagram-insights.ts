/**
 * Instagram account insights, read through Zernio.
 *
 * Deliberately not on MessagingProvider: that interface is for things the
 * flow engine does, and it already says vendor-shaped reads keep their own
 * route. These metric names are Instagram's, not a common denominator.
 *
 * The shaping below is the whole point of the file. Instagram hands back
 * totals; what decides anything is the comparison between them, so the raw
 * numbers are turned into the four or five readings worth acting on and
 * everything else is dropped.
 */

import { createZernioClient } from "@/lib/zernio-client";

/** What the account insights endpoint answers, trimmed to what we read. */
interface RawInsights {
  metrics?: Record<
    string,
    {
      total?: number;
      values?: Array<{ date?: string; value?: number }>;
      breakdowns?: Array<{ dimension?: string; value?: number }>;
    }
  >;
  unavailableMetrics?: unknown;
}

export interface InstagramSummary {
  since: string;
  until: string;
  /** People reached, and how many of them did not already follow. */
  reach: number | null;
  reachFromFollowers: number | null;
  reachFromNonFollowers: number | null;
  /** Share of reach that was not already following, 0 to 1. */
  newAudienceShare: number | null;
  views: number | null;
  accountsEngaged: number | null;
  saves: number | null;
  shares: number | null;
  likes: number | null;
  comments: number | null;
  profileLinkTaps: number | null;
  followersGained: number | null;
  followersLost: number | null;
  followerCount: number | null;
  /** Daily follower count, for the growth line. */
  followerSeries: Array<{ date: string; value: number }>;
  /** Metrics Instagram refused for this account, named so the UI can say so. */
  unavailable: string[];
}

/**
 * Reads one metric's total.
 *
 * Absent and zero are different answers and are kept different: Zernio omits
 * a metric it could not serve rather than sending a zero, and a dash in the
 * UI is honest where a 0 would be a quiet lie.
 */
export function metricTotal(raw: RawInsights, name: string): number | null {
  const value = raw.metrics?.[name]?.total;
  return typeof value === "number" ? value : null;
}

/**
 * Splits reach into people who already follow and people who do not.
 *
 * This is the reading the Instagram app makes hardest to get and the one
 * that answers whether the content is recruiting or only entertaining.
 * Instagram's dimension names have moved before, so anything that is not
 * recognisably "follower" counts as non-follower rather than being dropped.
 */
export function splitReach(raw: RawInsights): {
  followers: number | null;
  nonFollowers: number | null;
  share: number | null;
} {
  const breakdowns = raw.metrics?.reach?.breakdowns;
  if (!breakdowns?.length) {
    return { followers: null, nonFollowers: null, share: null };
  }

  let followers = 0;
  let nonFollowers = 0;
  for (const row of breakdowns) {
    const value = typeof row.value === "number" ? row.value : 0;
    const dimension = (row.dimension ?? "").toLowerCase();
    if (dimension.includes("non") || dimension.includes("not")) nonFollowers += value;
    else if (dimension.includes("follower")) followers += value;
    else nonFollowers += value;
  }

  const total = followers + nonFollowers;
  return {
    followers,
    nonFollowers,
    share: total > 0 ? nonFollowers / total : null,
  };
}

/** Pulls the daily follower count out of the follower-history response. */
export function followerSeries(raw: RawInsights): Array<{ date: string; value: number }> {
  const values = raw.metrics?.follower_count?.values ?? [];
  return values
    .filter(
      (v): v is { date: string; value: number } =>
        typeof v.date === "string" && typeof v.value === "number"
    )
    .map((v) => ({ date: v.date, value: v.value }));
}

/** Names of the metrics Instagram would not serve, for the UI to show. */
export function unavailableNames(raw: RawInsights): string[] {
  const list = raw.unavailableMetrics;
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : typeof (entry as { metric?: unknown })?.metric === "string"
          ? ((entry as { metric: string }).metric)
          : null
    )
    .filter((name): name is string => Boolean(name));
}

/** Builds the summary from the three responses, without touching the network. */
export function buildSummary({
  totals,
  reachByFollowerType,
  followers,
  since,
  until,
}: {
  totals: RawInsights;
  reachByFollowerType: RawInsights;
  followers: RawInsights;
  since: string;
  until: string;
}): InstagramSummary {
  const split = splitReach(reachByFollowerType);
  const series = followerSeries(followers);

  return {
    since,
    until,
    reach: metricTotal(totals, "reach"),
    reachFromFollowers: split.followers,
    reachFromNonFollowers: split.nonFollowers,
    newAudienceShare: split.share,
    views: metricTotal(totals, "views"),
    accountsEngaged: metricTotal(totals, "accounts_engaged"),
    saves: metricTotal(totals, "saves"),
    shares: metricTotal(totals, "shares"),
    likes: metricTotal(totals, "likes"),
    comments: metricTotal(totals, "comments"),
    profileLinkTaps: metricTotal(totals, "profile_links_taps"),
    followersGained: metricTotal(followers, "followers_gained"),
    followersLost: metricTotal(followers, "followers_lost"),
    followerCount: series.length ? series[series.length - 1].value : null,
    followerSeries: series,
    unavailable: unavailableNames(totals),
  };
}

const TOTAL_METRICS = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "saves",
  "shares",
  "profile_links_taps",
].join(",");

/**
 * Fetches the three calls the summary needs.
 *
 * Three rather than one because Instagram only breaks a metric down one
 * dimension at a time, and only reach supports the follower-type split; the
 * follower history is a different endpoint entirely because the Graph API
 * returns no time series for anything but reach.
 *
 * A call that fails yields an empty response rather than throwing, so one
 * refused metric leaves the rest of the panel standing.
 */
export async function fetchInstagramSummary({
  apiKey,
  accountId,
  since,
  until,
}: {
  apiKey: string;
  accountId: string;
  since: string;
  until: string;
}): Promise<InstagramSummary> {
  const client = createZernioClient(apiKey);

  const safely = async (run: () => Promise<unknown>): Promise<RawInsights> => {
    try {
      const res = (await run()) as { data?: RawInsights };
      return res?.data ?? {};
    } catch (err) {
      console.error("[instagram-insights] call failed:", err);
      return {};
    }
  };

  const [totals, reachByFollowerType, followers] = await Promise.all([
    safely(() =>
      client.analytics.getInstagramAccountInsights({
        query: { accountId, metrics: TOTAL_METRICS, metricType: "total_value", since, until },
      })
    ),
    safely(() =>
      client.analytics.getInstagramAccountInsights({
        query: {
          accountId,
          metrics: "reach",
          metricType: "total_value",
          breakdown: "follower_type",
          since,
          until,
        },
      })
    ),
    safely(() =>
      client.analytics.getInstagramFollowerHistory({
        query: { accountId, metricType: "time_series", since, until },
      })
    ),
  ]);

  return buildSummary({ totals, reachByFollowerType, followers, since, until });
}
