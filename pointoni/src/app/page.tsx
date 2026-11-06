import { SiteChrome } from "@/components/chrome/SiteChrome";
import { HeroStage } from "@/components/home/HeroStage";
import { GlobalPresence } from "@/components/home/GlobalPresence";
import { PioneerRail } from "@/components/home/PioneerRail";
import { ChatPanel } from "@/components/home/ChatPanel";
import { FinancialTicker } from "@/components/home/FinancialTicker";
import { LocalFriendPanel } from "@/components/home/LocalFriendPanel";
import { HistoryTimeline } from "@/components/home/HistoryTimeline";
import { ProjectScan } from "@/components/home/ProjectScan";
import { WhatIsAi } from "@/components/home/WhatIsAi";
import { ResponsibleAi } from "@/components/home/ResponsibleAi";

// Static sovereign flagship page: SG16 Brain is permanently anchored at the
// head of the live global AI directory; the remaining slots cycle the full
// registry. The news feed is replaced by the live global markets tape; all
// chat routes exclusively through the SG16 core (/api/brain).

export default function HomePage() {
  return (
    <SiteChrome>
      <HeroStage />
      <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-3 pb-12 sm:px-5">
        <GlobalPresence />
        <PioneerRail />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_350px]">
          <ChatPanel />
          <FinancialTicker />
        </div>

        {/* doctrine v2 step 1 — the friend answers on the visitor's own
            device energy; zero requests per chat turn */}
        <LocalFriendPanel />

        <HistoryTimeline />
        {/* free project health scan — sits after the history section as
            ordered; the final two panels follow below */}
        <ProjectScan />
        <WhatIsAi />
        <ResponsibleAi />
      </div>
    </SiteChrome>
  );
}
