import { InstagramInsightsBlock } from "@/components/analytics/instagram-insights-block";
import { AnalyticsTabs } from "@/components/analytics/analytics-tabs";

export const metadata = { title: "Profile analytics" };

/**
 * The account, not the automations.
 *
 * Everything here comes from Instagram, so the whole page loads itself
 * rather than rendering on the server: there is nothing of ours to show
 * first, and a sulking third party should produce a spinner, not a blank
 * route that times out.
 */
export default function ProfileAnalyticsPage() {
  return (
    <>
      <AnalyticsTabs />

      <div className="space-y-4 px-6 pt-6">
        <InstagramInsightsBlock />
      </div>
    </>
  );
}
