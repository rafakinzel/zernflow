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
    <div className="flex h-full flex-col">
      <AnalyticsTabs />

      <div className="flex-1 overflow-auto">
        <div className="space-y-4 px-6 py-6">
          <InstagramInsightsBlock />
        </div>
      </div>
    </div>
  );
}
