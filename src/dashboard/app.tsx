import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Input,
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ToggleGroup,
  ToggleGroupItem,
  Alert,
  AlertTitle,
  AlertDescription,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Switch,
  Separator,
  HoverExplanation,
  IconShield,
  IconActivity,
  IconBot,
  IconSearch,
  IconSun,
  IconMoon,
  IconGlobe,
} from "./components/ui";
import {
  TrafficVolumeChart,
  RoutingBreakdownChart,
  TopFlagsBarChart,
} from "./components/charts";
import {
  GlobalOriginMap,
  type GeoSummaryData,
} from "./components/geo-map";
import { getTagExplanation, humanizeKey } from "./glossary";

interface SubmissionItem {
  id: string;
  wpCommentId: number;
  entityId: string;
  authorSessionHash: string;
  rawText: string;
  rating: number | null;
  authorType: "human" | "bot";
  visibility: "pending" | "public" | "public_flagged" | "shadowbanned";
  routingPath: string;
  modelUsed: string;
  riskScore: number;
  shieldFlags: number;
  failedRiskIds: string[];
  triggeredShieldIds: string[];
  deepResearchExplanation: string | null;
  createdAt: string;
  similarityScore?: number | null;
  origin?: {
    countryCode: string;
    countryName: string;
    region: string;
    regionCode: string;
    city: string;
    lat: number;
    lng: number;
    ipAddress: string;
    networkType: string;
    asnLabel: string;
  };
  honeypot: {
    ipAddress: string;
    userAgent: string;
    confidenceScore: number;
    reasons: string[];
    patternClusterId: string | null;
    telemetry: Record<string, any>;
  } | null;
  riskTagDetails: Array<{
    id: string;
    name: string;
    bucket: number;
    bucketName: string;
    points: number;
    tier?: number;
    description: string;
  }>;
  shieldTagDetails: Array<{
    id: string;
    name: string;
    bucket: number;
    bucketName: string;
    flags: number;
    description: string;
  }>;
}

export function DashboardApp() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "map" | "bots" | "search">("overview");
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");
  const [autoPoll, setAutoPoll] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("--:--:--");

  // Overview state
  const [overview, setOverview] = useState<any>(null);

  // Regional Scanner state
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [selectedCountry, setSelectedCountry] = useState<string>("all");
  const [regionsData, setRegionsData] = useState<{
    summary: GeoSummaryData;
    recentRegionItems: SubmissionItem[];
    activeRegion: any;
  } | null>(null);

  // Submissions & Search state
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [totalMatching, setTotalMatching] = useState(0);
  const [similarToRef, setSimilarToRef] = useState<any>(null);
  const [pgvectorUsed, setPgvectorUsed] = useState(false);

  // Read-only view filters
  const [authorFilter, setAuthorFilter] = useState<"all" | "human" | "bot">("all");
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");
  const [routeFilter, setRouteFilter] = useState<string>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"hybrid" | "vector" | "keyword">("hybrid");
  const [similarToId, setSimilarToId] = useState<string>("");

  // Bot Vault data
  const [botVault, setBotVault] = useState<any>(null);
  const [botClusterFilter, setBotClusterFilter] = useState<string>("all");
  const [botReasonFilter, setBotReasonFilter] = useState<string>("all");

  // Available Tags catalog
  const [tagsCatalog, setTagsCatalog] = useState<any>(null);

  // Selected submission for read-only Forensic Detail Sheet
  const [selectedItem, setSelectedItem] = useState<SubmissionItem | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [darkMode]);

  const fetchAllData = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        authorType: authorFilter,
        visibility: visibilityFilter,
        route: routeFilter,
        tags: selectedTags.join(","),
        q: searchQuery,
        searchMode,
        similarTo: similarToId,
        limit: "100",
      });

      const regParams = new URLSearchParams({
        range: "all",
        region: selectedRegion,
        country: selectedCountry,
      });

      const [ovRes, subRes, botRes, tagRes, regRes] = await Promise.all([
        fetch(`/api/dashboard/overview?range=${range}`),
        fetch(`/api/dashboard/submissions?${params.toString()}`),
        fetch(`/api/dashboard/bots`),
        fetch(`/api/dashboard/tags`),
        fetch(`/api/dashboard/regions?${regParams.toString()}`),
      ]);

      if (ovRes.ok) setOverview(await ovRes.json());
      if (subRes.ok) {
        const subData = await subRes.json();
        setSubmissions(subData.items || []);
        setTotalMatching(subData.totalMatching || 0);
        setSimilarToRef(subData.similarTo || null);
        setPgvectorUsed(Boolean(subData.pgvectorUsed));
      }
      if (botRes.ok) setBotVault(await botRes.json());
      if (tagRes.ok) setTagsCatalog(await tagRes.json());
      if (regRes.ok) setRegionsData(await regRes.json());

      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    }
  }, [
    range,
    authorFilter,
    visibilityFilter,
    routeFilter,
    selectedTags,
    searchQuery,
    searchMode,
    similarToId,
    selectedRegion,
    selectedCountry,
  ]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    if (!autoPoll) return;
    const timer = setInterval(() => {
      fetchAllData();
    }, 5000);
    return () => clearInterval(timer);
  }, [autoPoll, fetchAllData]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleFindSimilar = (item: SubmissionItem) => {
    setSimilarToId(item.id);
    setSearchQuery("");
    setAuthorFilter("all");
    setVisibilityFilter("all");
    setRouteFilter("all");
    setActiveTab("search");
  };

  const kpis = overview?.kpis || {
    totalSubmissions: 0,
    testDataCount: 0,
    rangeSubmissions: 0,
    botsDetected: 0,
    rangeBots: 0,
    botSharePct: 0,
    flaggedPropaganda: 0,
    cleanHuman: 0,
    shieldedVenting: 0,
    avgHumanRiskScore: 0,
    activeBannersCount: 0,
  };

  const sys = overview?.system || {
    dbConnected: false,
    pgvectorEnabled: false,
    thresholdMode: "balanced",
    fastScreenerModel: "jev-latest",
    heavyForensicModel: "gemini-4-hydrogen",
  };

  const filteredBotItems: SubmissionItem[] = (botVault?.bots || []).filter(
    (b: SubmissionItem) => {
      if (
        botClusterFilter !== "all" &&
        b.honeypot?.patternClusterId !== botClusterFilter
      ) {
        return false;
      }
      if (
        botReasonFilter !== "all" &&
        !(b.honeypot?.reasons || []).includes(botReasonFilter)
      ) {
        return false;
      }
      return true;
    }
  );

  const rangeLabel = range === "24h" ? "24 Hours" : range === "30d" ? "30 Days" : "7 Days";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Header Bar (Read-Only Telemetry & Fixed-Width Live Refresh) */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-secondary text-primary shadow-xs">
              <IconShield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-sm sm:text-base font-semibold tracking-tight">
                  Truthier Command Center
                </h1>
                <HoverExplanation
                  title={
                    sys.dbConnected
                      ? sys.pgvectorEnabled
                        ? "PostgreSQL + Vector Index Active"
                        : "PostgreSQL Connected"
                      : "In-Memory Fallback Store"
                  }
                  category="Database Connection"
                  rawKey={sys.pgvectorEnabled ? "pgvector_64_cosine" : "postgres_db"}
                  description={
                    sys.dbConnected
                      ? "Connected directly to your PostgreSQL database in read-only monitoring mode. Hover any badge, card, or tag for 2 seconds to view its explanation."
                      : "PostgreSQL is currently unreachable, so the dashboard is displaying temporary memory telemetry."
                  }
                >
                  <Badge variant={sys.dbConnected ? "success" : "secondary"} className="cursor-default">
                    {sys.dbConnected
                      ? sys.pgvectorEnabled
                        ? "Database + Vector Ready"
                        : "Database Connected"
                      : "Memory Fallback"}
                  </Badge>
                </HoverExplanation>
              </div>
              <p className="text-xs text-muted-foreground">
                Read-Only Website Protection Monitor &bull; Hover any tag or card for 2s to learn what it means
              </p>
            </div>
          </div>

          {/* Right Read-Only Status & View Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <HoverExplanation
              title={`Sensitivity Mode: ${humanizeKey(sys.thresholdMode)}`}
              category="Tenant Configuration (Read-Only)"
              rawKey={`threshold_mode: ${sys.thresholdMode}`}
              description="Shows the active propaganda detection strictness configured in WordPress Settings. Change this from your WordPress Admin plugin page."
            >
              <Badge variant="outline" className="h-8 px-3 text-xs cursor-default">
                Protection: {humanizeKey(sys.thresholdMode)}
              </Badge>
            </HoverExplanation>

            {/* Fixed-width Live Refresh box prevents horizontal jitter when seconds tick */}
            <HoverExplanation
              title="Live Auto-Refresh (Every 5 Seconds)"
              category="Dashboard Sync"
              description="Automatically reads the latest comments and bot detections from PostgreSQL every 5 seconds. Toggle off to pause updates while reading."
            >
              <div className="flex h-8 w-[196px] shrink-0 items-center justify-between rounded-lg border border-border bg-secondary/40 px-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Switch checked={autoPoll} onCheckedChange={setAutoPoll} />
                  <span className="text-muted-foreground">Live Sync</span>
                </div>
                <span className="font-mono text-[11px] text-foreground tabular-nums">
                  {lastUpdated}
                </span>
              </div>
            </HoverExplanation>

            <HoverExplanation
              title={darkMode ? "Switch to Light Theme" : "Switch to Dark Theme"}
              category="Display Preference"
              description="Changes the visual appearance of the dashboard in your browser only."
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDarkMode(!darkMode)}
                aria-label="Toggle theme"
              >
                {darkMode ? <IconSun /> : <IconMoon />}
              </Button>
            </HoverExplanation>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Active Entity Banners using shadcn/ui Alert */}
        {overview?.entityBanners && overview.entityBanners.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {overview.entityBanners.map((banner: any) => {
              const isAttack = banner.anomalyStatus === "coordinated_attack";
              const entityInfo = getTagExplanation(banner.entityId);
              const statusInfo = getTagExplanation(banner.anomalyStatus);

              return (
                <Alert
                  key={banner.entityId}
                  variant={isAttack ? "warning" : "info"}
                  className="flex items-start justify-between gap-4"
                >
                  <div className="space-y-1">
                    <AlertTitle>
                      <HoverExplanation
                        title={
                          isAttack
                            ? "Coordinated Attack Shield"
                            : "Genuine Customer Feedback Spike"
                        }
                        category="Website Page Notice"
                        rawKey={banner.anomalyStatus}
                        description={
                          isAttack
                            ? "An automated wave of bots or coordinated framing targeted this page. Protective notices are shown to visitors."
                            : "Many real customers left low ratings about a known bug or order issue. Authentic complaints remain visible."
                        }
                      >
                        <Badge variant={isAttack ? "warning" : "info"} className="cursor-default">
                          {isAttack ? "Coordinated Attack Notice" : "Genuine Feedback Spike"}
                        </Badge>
                      </HoverExplanation>

                      <HoverExplanation
                        title={entityInfo.title}
                        category={entityInfo.category}
                        rawKey={entityInfo.rawKey}
                        description={entityInfo.description}
                      >
                        <span className="text-xs font-semibold text-foreground cursor-default">
                          {entityInfo.title}
                        </span>
                      </HoverExplanation>
                    </AlertTitle>
                    <AlertDescription>{banner.bannerExplanation}</AlertDescription>
                  </div>

                  <HoverExplanation
                    title="Filter by This Page"
                    category="Quick Filter"
                    rawKey={banner.entityId}
                    description={`Opens Smart Search filtered only to comments submitted on "${entityInfo.title}".`}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedTags([banner.entityId]);
                        setActiveTab("search");
                      }}
                    >
                      View Comments
                    </Button>
                  </HoverExplanation>
                </Alert>
              );
            })}
          </div>
        )}

        {/* 4 shadcn/ui Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <HoverExplanation
            title="Total Website Comments"
            category="Overview Metric"
            rawKey="submissions"
            description="Every comment and product review captured from your WordPress site and stored in the PostgreSQL submissions table."
            className="block h-full"
          >
            <Card className="h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription className="font-medium uppercase tracking-wider">
                    Total Comments
                  </CardDescription>
                  <Badge variant="secondary">{rangeLabel}</Badge>
                </div>
                <CardTitle className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-foreground">
                  {kpis.totalSubmissions}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{kpis.rangeSubmissions}</span> in
                  last {rangeLabel.toLowerCase()} &bull;{" "}
                  <span className="text-teal-600 dark:text-teal-300">
                    {kpis.cleanHuman} safe human
                  </span>
                </p>
              </CardContent>
            </Card>
          </HoverExplanation>

          <HoverExplanation
            title="Blocked Automated Bots"
            category="Bot Defense Metric"
            rawKey="author_type = 'bot'"
            description="Automated spam scripts and headless browsers caught in under 2 milliseconds by hidden traps and browser checks. They are silently hidden from visitors."
            className="block h-full"
          >
            <Card className="h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription className="font-medium uppercase tracking-wider">
                    Blocked Bots
                  </CardDescription>
                  <Badge variant="outline">Instant Trap</Badge>
                </div>
                <CardTitle className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-foreground">
                  {kpis.botsDetected}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{kpis.botSharePct}%</span> of
                  traffic silently hidden ({kpis.rangeBots} in {rangeLabel.toLowerCase()})
                </p>
              </CardContent>
            </Card>
          </HoverExplanation>

          <HoverExplanation
            title="Flagged Manipulation"
            category="Propaganda Defense Metric"
            rawKey="visibility = 'public_flagged'"
            description="Human-written comments that triggered severe manipulation patterns and were confirmed by Stage 2 AI forensic review."
            className="block h-full"
          >
            <Card className="h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription className="font-medium uppercase tracking-wider">
                    Flagged Manipulation
                  </CardDescription>
                  <Badge variant="warning">AI Forensic</Badge>
                </div>
                <CardTitle className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-amber-600 dark:text-amber-300">
                  {kpis.flaggedPropaganda}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Avg human risk score:{" "}
                  <span className="font-mono font-medium text-foreground">
                    {kpis.avgHumanRiskScore} pts
                  </span>
                </p>
              </CardContent>
            </Card>
          </HoverExplanation>

          <HoverExplanation
            title="Protected Customer Complaints"
            category="Anti-Censorship Metric"
            rawKey="ROUTE_2_SHIELDED_VENTING"
            description="Angry or frustrated customer reviews about shipping delays, bugs, or refunds that were protected from false propaganda flags."
            className="block h-full"
          >
            <Card className="h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription className="font-medium uppercase tracking-wider">
                    Protected Complaints
                  </CardDescription>
                  <Badge variant="info">Context Shield</Badge>
                </div>
                <CardTitle className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-sky-600 dark:text-sky-300">
                  {kpis.shieldedVenting}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Genuine negative reviews kept visible to shoppers
                </p>
              </CardContent>
            </Card>
          </HoverExplanation>
        </div>

        {/* Main shadcn/ui Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <TabsList>
              <HoverExplanation
                title="Overview & Recent Website Activity"
                category="Dashboard Tab"
                description="View daily/weekly graphs of bot vs. human traffic, see how comments were handled, and browse the latest comments."
              >
                <TabsTrigger value="overview">
                  <IconActivity className="h-3.5 w-3.5" />
                  Overview &amp; Activity
                </TabsTrigger>
              </HoverExplanation>

              <HoverExplanation
                title="World Propaganda & Bot Origin Map"
                category="Dashboard Tab"
                rawKey="geo_origin_map"
                description="Interactive political world map showing which countries and regions flagged propaganda and automated bots originate from, with zoom and pan controls."
              >
                <TabsTrigger value="map">
                  <IconGlobe className="h-3.5 w-3.5" />
                  World Threat Map (
                  {overview?.geography?.activeCountriesCount ??
                    regionsData?.summary?.activeCountriesCount ??
                    0}
                  )
                </TabsTrigger>
              </HoverExplanation>

              <HoverExplanation
                title="Blocked Bots Vault"
                category="Dashboard Tab"
                rawKey="honeypot_vault"
                description="Inspect all automated bot comments intercepted on your site, including IP addresses, browser automation flags, and botnet clusters."
              >
                <TabsTrigger value="bots">
                  <IconBot className="h-3.5 w-3.5" />
                  Blocked Bots Vault ({botVault?.totalBots ?? kpis.botsDetected})
                </TabsTrigger>
              </HoverExplanation>

              <HoverExplanation
                title="Smart Meaning Search & Tag Explorer"
                category="Dashboard Tab"
                rawKey="pgvector_search"
                description="Search comments by topic or meaning using vector similarity, and combine filters across risk tags, shields, and bot signals."
              >
                <TabsTrigger value="search">
                  <IconSearch className="h-3.5 w-3.5" />
                  Smart Search &amp; Tags (
                  {selectedTags.length + (searchQuery || similarToId ? 1 : 0)})
                </TabsTrigger>
              </HoverExplanation>
            </TabsList>

            <ToggleGroup value={range} onValueChange={(v) => setRange(v as any)}>
              <HoverExplanation
                title="Last 24 Hours (Hourly)"
                category="Time Window"
                description="Groups website comment and bot counts hour-by-hour over the past 24 hours."
              >
                <ToggleGroupItem value="24h">24 Hours</ToggleGroupItem>
              </HoverExplanation>
              <HoverExplanation
                title="Last 7 Days (Daily)"
                category="Time Window"
                description="Groups website comment and bot counts day-by-day over the past week."
              >
                <ToggleGroupItem value="7d">7 Days</ToggleGroupItem>
              </HoverExplanation>
              <HoverExplanation
                title="Last 30 Days (Monthly)"
                category="Time Window"
                description="Groups website comment and bot counts day-by-day over the past 30 days."
              >
                <ToggleGroupItem value="30d">30 Days</ToggleGroupItem>
              </HoverExplanation>
            </ToggleGroup>
          </div>

          {/* TAB 1: OVERVIEW & LIVE WEBSITE ACTIVITY */}
          <TabsContent value="overview" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>
                    Comment &amp; Bot Activity Over Time ({range === "24h" ? "Hourly" : "Daily"})
                  </CardTitle>
                  <CardDescription>
                    Stacked counts of Verified Human comments, Flagged Manipulation, and Blocked
                    Bots stored in PostgreSQL
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono">
                  {overview?.series?.length || 0} {range === "24h" ? "hours" : "days"}
                </Badge>
              </CardHeader>
              <CardContent>
                <TrafficVolumeChart data={overview?.series || []} range={range} />
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>How Website Comments Were Handled</CardTitle>
                  <CardDescription>
                    Click any decision path to filter the recent activity table below
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RoutingBreakdownChart
                    items={overview?.routingBreakdown || []}
                    selectedRoute={routeFilter}
                    onSelectRoute={(r) => {
                      setRouteFilter(r === routeFilter ? "all" : r);
                    }}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Most Common Risk &amp; Context Signals</CardTitle>
                  <CardDescription>
                    Click any pattern to explore matching comments in Smart Search &amp; Tags
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TopFlagsBarChart
                    flags={overview?.topFlags || []}
                    onSelectTag={(tagId) => {
                      if (!selectedTags.includes(tagId)) {
                        setSelectedTags([...selectedTags, tagId]);
                      }
                      setActiveTab("search");
                    }}
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Global Propaganda &amp; Bot Origin Map</CardTitle>
                <CardDescription>
                  Interactive country-level world map of where flagged propaganda and automated bot
                  traffic originate &bull; Scroll or use + / - to zoom, drag to pan
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GlobalOriginMap
                  compact
                  geography={regionsData?.summary || overview?.geography}
                  selectedRegion={selectedRegion}
                  onSelectRegion={setSelectedRegion}
                  selectedCountry={selectedCountry}
                  onSelectCountry={setSelectedCountry}
                  onOpenFullMap={() => setActiveTab("map")}
                  onOpenSearchForLocation={(tag) => {
                    if (!selectedTags.includes(tag)) setSelectedTags([...selectedTags, tag]);
                    setActiveTab("search");
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Latest Website Activity</CardTitle>
                    <CardDescription>
                      Most recent comments and bot interceptions saved in PostgreSQL &bull; Click any
                      row to inspect full details
                    </CardDescription>
                  </div>

                  <ToggleGroup
                    value={`${authorFilter}:${visibilityFilter}`}
                    onValueChange={(val) => {
                      const [a, v] = val.split(":");
                      setAuthorFilter(a as any);
                      setVisibilityFilter(v);
                      setRouteFilter("all");
                    }}
                  >
                    <HoverExplanation
                      title="Show All Website Activity"
                      category="Activity Filter"
                      description="Displays every recent human comment, flagged post, and blocked bot."
                    >
                      <ToggleGroupItem value="all:all">All Activity</ToggleGroupItem>
                    </HoverExplanation>
                    <HoverExplanation
                      title="Show Blocked Bots Only"
                      category="Activity Filter"
                      description="Filters the table to show only automated bots caught by telemetry traps."
                    >
                      <ToggleGroupItem value="bot:all">Blocked Bots</ToggleGroupItem>
                    </HoverExplanation>
                    <HoverExplanation
                      title="Show Flagged Manipulation Only"
                      category="Activity Filter"
                      description="Filters to comments flagged by AI for coordinated propaganda or manipulation."
                    >
                      <ToggleGroupItem value="human:public_flagged">
                        Flagged Framing
                      </ToggleGroupItem>
                    </HoverExplanation>
                    <HoverExplanation
                      title="Show Verified Human Comments"
                      category="Activity Filter"
                      description="Filters to safe, clean human comments published publicly on your site."
                    >
                      <ToggleGroupItem value="human:public">Verified Human</ToggleGroupItem>
                    </HoverExplanation>
                  </ToggleGroup>
                </div>
              </CardHeader>
              <CardContent>
                <SubmissionsTable
                  items={submissions.slice(0, 25)}
                  onInspect={setSelectedItem}
                  onFindSimilar={handleFindSimilar}
                  onSelectTag={(tag) => {
                    if (!selectedTags.includes(tag)) setSelectedTags([...selectedTags, tag]);
                    setActiveTab("search");
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: WORLD ORIGIN MAP & COUNTRY BREAKDOWN */}
          <TabsContent value="map" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>Interactive World Propaganda &amp; Bot Origin Map</CardTitle>
                    <CardDescription>
                      Zoom in, pan across continents, and click any country or hotspot pin to
                      inspect localized disinformation narratives and botnet relay origins
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono">
                    {regionsData?.summary?.activeCountriesCount ??
                      overview?.geography?.activeCountriesCount ??
                      0}{" "}
                    Countries &bull;{" "}
                    {regionsData?.summary?.activeRegionsCount ??
                      overview?.geography?.activeRegionsCount ??
                      0}{" "}
                    Regions
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <GlobalOriginMap
                  geography={regionsData?.summary || overview?.geography}
                  selectedRegion={selectedRegion}
                  onSelectRegion={setSelectedRegion}
                  selectedCountry={selectedCountry}
                  onSelectCountry={setSelectedCountry}
                  onOpenSearchForLocation={(tag) => {
                    if (!selectedTags.includes(tag)) setSelectedTags([...selectedTags, tag]);
                    setActiveTab("search");
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>
                      Origin Country &amp; Region Activity (
                      {regionsData?.recentRegionItems?.length ?? submissions.length})
                    </CardTitle>
                    <CardDescription>
                      {selectedCountry !== "all"
                        ? `Filtered to origin country ${selectedCountry}`
                        : selectedRegion !== "all"
                          ? `Filtered to region ${getTagExplanation(selectedRegion).title}`
                          : "Showing comments across all countries"}
                    </CardDescription>
                  </div>
                  {(selectedRegion !== "all" || selectedCountry !== "all") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const geoTag =
                          selectedCountry !== "all"
                            ? `country_${selectedCountry}`
                            : selectedRegion;
                        if (geoTag && !selectedTags.includes(geoTag)) {
                          setSelectedTags([...selectedTags, geoTag]);
                        }
                        setActiveTab("search");
                      }}
                    >
                      Explore in Smart Search
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <SubmissionsTable
                  items={regionsData?.recentRegionItems || submissions}
                  onInspect={setSelectedItem}
                  onFindSimilar={handleFindSimilar}
                  onSelectTag={(tag) => {
                    if (!selectedTags.includes(tag)) setSelectedTags([...selectedTags, tag]);
                    setActiveTab("search");
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: BOT HONEYPOT VAULT */}
          <TabsContent value="bots" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Why Bots Were Caught</CardTitle>
                  <CardDescription>
                    Click a behavioral signal to filter intercepted bot comments
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  <HoverExplanation
                    title="Show All Bot Signals"
                    category="Bot Signal Filter"
                    description="Clears the signal filter and displays every intercepted bot comment."
                  >
                    <Badge
                      variant={botReasonFilter === "all" ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => setBotReasonFilter("all")}
                    >
                      All Signals ({botVault?.totalBots || 0})
                    </Badge>
                  </HoverExplanation>
                  {(botVault?.reasonsBreakdown || []).map((r: any) => {
                    const info = getTagExplanation(r.reason);
                    return (
                      <HoverExplanation
                        key={r.reason}
                        title={info.title}
                        category={info.category}
                        rawKey={info.rawKey}
                        description={info.description}
                      >
                        <Badge
                          variant={botReasonFilter === r.reason ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() =>
                            setBotReasonFilter(botReasonFilter === r.reason ? "all" : r.reason)
                          }
                        >
                          {info.title} ({r.count})
                        </Badge>
                      </HoverExplanation>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Botnet Campaign Groups</CardTitle>
                  <CardDescription>
                    Bots grouped by matching behavior and spam patterns
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  <HoverExplanation
                    title="Show All Bot Clusters"
                    category="Cluster Filter"
                    description="Displays bots from all detected campaign clusters."
                  >
                    <Badge
                      variant={botClusterFilter === "all" ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => setBotClusterFilter("all")}
                    >
                      All Groups
                    </Badge>
                  </HoverExplanation>
                  {(botVault?.clustersBreakdown || []).map((cl: any) => {
                    const info = getTagExplanation(cl.clusterId);
                    return (
                      <HoverExplanation
                        key={cl.clusterId}
                        title={info.title}
                        category={info.category}
                        rawKey={info.rawKey}
                        description={info.description}
                      >
                        <Badge
                          variant={botClusterFilter === cl.clusterId ? "purple" : "outline"}
                          className="cursor-pointer"
                          onClick={() =>
                            setBotClusterFilter(
                              botClusterFilter === cl.clusterId ? "all" : cl.clusterId
                            )
                          }
                        >
                          {info.title} ({cl.count})
                        </Badge>
                      </HoverExplanation>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Top Bot IP Addresses</CardTitle>
                  <CardDescription>
                    Average detection confidence:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {botVault?.avgConfidence || 97}%
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  {(botVault?.topIps || []).slice(0, 3).map((ip: any) => (
                    <HoverExplanation
                      key={ip.ip}
                      title={`IP Address ${ip.ip}`}
                      category="Network Source"
                      rawKey={`ip_address: ${ip.ip}`}
                      description={`Submitted ${ip.count} automated bot comment(s) caught by your website defenses.`}
                      className="block w-full"
                    >
                      <div className="flex w-full items-center justify-between rounded-md bg-secondary/60 px-2.5 py-1 font-mono cursor-default">
                        <span>{ip.ip}</span>
                        <Badge variant="secondary">{ip.count} blocked</Badge>
                      </div>
                    </HoverExplanation>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>
                  Bot Honeypot Vault ({filteredBotItems.length})
                </CardTitle>
                <CardDescription>
                  Complete archive of automated bot comments caught and silently hidden before
                  reaching public visitors
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Page &amp; Time</TableHead>
                      <TableHead>Intercepted Bot Comment</TableHead>
                      <TableHead>IP &amp; Browser</TableHead>
                      <TableHead>Detection Signals</TableHead>
                      <TableHead>Campaign Group &amp; Flags</TableHead>
                      <TableHead className="text-right">Similar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBotItems.map((bot) => {
                      const entityInfo = getTagExplanation(bot.entityId);
                      const clusterInfo = bot.honeypot?.patternClusterId
                        ? getTagExplanation(bot.honeypot.patternClusterId)
                        : null;

                      return (
                        <TableRow
                          key={bot.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedItem(bot)}
                        >
                          <TableCell className="whitespace-nowrap">
                            <div className="font-mono text-xs font-semibold">
                              Comment #{bot.wpCommentId}
                            </div>
                            <HoverExplanation
                              title={entityInfo.title}
                              category={entityInfo.category}
                              rawKey={entityInfo.rawKey}
                              description={entityInfo.description}
                            >
                              <div className="text-[11px] text-sky-600 dark:text-sky-300 cursor-default">
                                {entityInfo.title}
                              </div>
                            </HoverExplanation>
                            <div className="text-[11px] text-muted-foreground">
                              {formatRelativeTime(bot.createdAt)}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-md">
                            <p className="line-clamp-2 text-xs text-foreground">{bot.rawText}</p>
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-xs text-foreground">
                              {bot.honeypot?.ipAddress || bot.origin?.ipAddress || "127.0.0.1"}
                            </div>
                            {bot.origin && (
                              <div
                                className="mt-0.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <HoverExplanation
                                  title={getTagExplanation(`country_${bot.origin.countryCode}`).title}
                                  category={`${bot.origin.region} • Bot Origin`}
                                  rawKey={`country_${bot.origin.countryCode}`}
                                  description={`${bot.origin.city}, ${bot.origin.countryName} (${bot.origin.asnLabel})`}
                                >
                                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] cursor-default">
                                    {bot.origin.countryCode} &bull; {bot.origin.city}
                                  </Badge>
                                </HoverExplanation>
                              </div>
                            )}
                            <div className="mt-0.5 max-w-[200px] truncate font-mono text-[11px] text-muted-foreground">
                              {bot.honeypot?.userAgent || "Headless Browser"}
                            </div>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-wrap gap-1">
                              {(bot.honeypot?.reasons || []).map((r) => {
                                const info = getTagExplanation(r);
                                return (
                                  <HoverExplanation
                                    key={r}
                                    title={info.title}
                                    category={info.category}
                                    rawKey={info.rawKey}
                                    description={info.description}
                                  >
                                    <Badge variant="secondary" className="text-[10px] cursor-default">
                                      {info.title}
                                    </Badge>
                                  </HoverExplanation>
                                );
                              })}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                              Confidence: {bot.honeypot?.confidenceScore ?? 98}% &bull; Mouse:{" "}
                              {bot.honeypot?.telemetry?.mouseMoves ?? 0} &bull; Keys:{" "}
                              {bot.honeypot?.telemetry?.keyPresses ?? 0}
                            </div>
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="space-y-1">
                              {clusterInfo && (
                                <HoverExplanation
                                  title={clusterInfo.title}
                                  category={clusterInfo.category}
                                  rawKey={clusterInfo.rawKey}
                                  description={clusterInfo.description}
                                >
                                  <Badge variant="purple" className="text-[10px] cursor-default">
                                    {clusterInfo.title}
                                  </Badge>
                                </HoverExplanation>
                              )}
                              <div className="flex flex-wrap gap-1">
                                {bot.failedRiskIds.map((qId) => {
                                  const qInfo = getTagExplanation(qId);
                                  return (
                                    <HoverExplanation
                                      key={qId}
                                      title={qInfo.title}
                                      category={qInfo.category}
                                      rawKey={qInfo.rawKey}
                                      description={qInfo.description}
                                    >
                                      <Badge variant="warning" className="text-[10px] cursor-default">
                                        {qInfo.title}
                                      </Badge>
                                    </HoverExplanation>
                                  );
                                })}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <HoverExplanation
                              title="Find Similar Comments"
                              category="Vector Similarity Search"
                              description="Searches your PostgreSQL vector database to find other comments with matching spam wording or intent."
                            >
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleFindSimilar(bot)}
                              >
                                Find Similar
                              </Button>
                            </HoverExplanation>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: VECTOR & TAG SEARCH */}
          <TabsContent value="search" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>Smart Meaning Search &amp; Tag Explorer</CardTitle>
                    <CardDescription>
                      Search across all human and bot comments by topic or meaning, and filter by
                      plain-English tags (hover any tag for 2 seconds for details)
                    </CardDescription>
                  </div>
                  <HoverExplanation
                    title={
                      pgvectorUsed
                        ? "PostgreSQL pgvector Distance Active"
                        : "Semantic Cosine Vector Engine"
                    }
                    category="Search Technology"
                    rawKey="vector(64) <=>"
                    description="Compares 64-dimensional semantic vectors so searching 'crypto scam' also finds related wording like 'USDT airdrop giveaway'."
                  >
                    <Badge variant={pgvectorUsed ? "success" : "info"} className="cursor-default">
                      {pgvectorUsed
                        ? "Vector Similarity Active"
                        : "Semantic Vector Search"}
                    </Badge>
                  </HoverExplanation>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Input
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (e.target.value) setSimilarToId("");
                      }}
                      placeholder="Search by topic, meaning, country, or city (e.g. 'crypto airdrop', 'Russia', 'Tehran', 'router wifi bug')..."
                      className="h-9"
                    />
                  </div>

                  <ToggleGroup
                    value={searchMode}
                    onValueChange={(v) => setSearchMode(v as any)}
                  >
                    <HoverExplanation
                      title="Smart Hybrid Search"
                      category="Search Mode"
                      rawKey="searchMode: hybrid"
                      description="Combines AI meaning similarity with exact word matching for the most accurate results."
                    >
                      <ToggleGroupItem value="hybrid">Smart Hybrid</ToggleGroupItem>
                    </HoverExplanation>
                    <HoverExplanation
                      title="Meaning Only (Vector)"
                      category="Search Mode"
                      rawKey="searchMode: vector"
                      description="Matches comments purely by semantic meaning and topic similarity using vector math."
                    >
                      <ToggleGroupItem value="vector">Meaning Only</ToggleGroupItem>
                    </HoverExplanation>
                    <HoverExplanation
                      title="Exact Words Only"
                      category="Search Mode"
                      rawKey="searchMode: keyword"
                      description="Matches comments only when they contain the exact words you typed."
                    >
                      <ToggleGroupItem value="keyword">Exact Words</ToggleGroupItem>
                    </HoverExplanation>
                  </ToggleGroup>

                  {(searchQuery || similarToId || selectedTags.length > 0) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSearchQuery("");
                        setSimilarToId("");
                        setSelectedTags([]);
                        setAuthorFilter("all");
                        setVisibilityFilter("all");
                        setRouteFilter("all");
                      }}
                    >
                      Reset Filters
                    </Button>
                  )}
                </div>

                {/* Sample Semantic Search Chips */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Try example searches:</span>
                  {[
                    "free crypto USDT airdrop giveaway",
                    "shadowy cabal censorship wake up",
                    "firmware update wifi bug crash refund",
                    "security audit report quoting",
                  ].map((sample) => (
                    <Button
                      key={sample}
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs font-normal"
                      onClick={() => {
                        setSimilarToId("");
                        setSearchQuery(sample);
                      }}
                    >
                      &ldquo;{sample}&rdquo;
                    </Button>
                  ))}
                </div>

                {/* Reference Comment Alert when "Find Similar" is active */}
                {similarToRef && (
                  <Alert variant="info" className="flex items-center justify-between gap-4">
                    <div>
                      <AlertTitle>
                        <span>
                          Showing Comments Similar to Comment #{similarToRef.wpCommentId}
                        </span>
                        <Badge variant="purple">
                          {similarToRef.authorType === "bot" ? "Automated Bot" : "Human Author"}
                        </Badge>
                      </AlertTitle>
                      <AlertDescription className="line-clamp-1">
                        &ldquo;{similarToRef.rawText}&rdquo;
                      </AlertDescription>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setSimilarToId("")}>
                      Clear Target
                    </Button>
                  </Alert>
                )}

                <Separator />

                {/* Interactive Tag Filters (Humanized labels + 2s Hover Explanations) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="uppercase tracking-wider text-muted-foreground">
                      Filter by Tags ({selectedTags.length} selected)
                    </Label>
                    {selectedTags.length > 0 && (
                      <Button variant="link" size="sm" onClick={() => setSelectedTags([])}>
                        Clear all tags
                      </Button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] text-muted-foreground">
                      Manipulation &amp; Propaganda Patterns:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(tagsCatalog?.semevalRisk || []).map((t: any) => {
                        const active = selectedTags.includes(t.tag);
                        const info = getTagExplanation(t.tag);
                        return (
                          <HoverExplanation
                            key={t.tag}
                            title={info.title}
                            category={info.category}
                            rawKey={info.rawKey}
                            description={info.description}
                          >
                            <Badge
                              variant={active ? "warning" : "outline"}
                              onClick={() => toggleTag(t.tag)}
                              className="cursor-pointer"
                            >
                              {info.title} ({t.count})
                            </Badge>
                          </HoverExplanation>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="text-[11px] text-muted-foreground">
                        Safe Context Shields (Anti-Censorship):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(tagsCatalog?.semevalShield || []).map((t: any) => {
                          const active = selectedTags.includes(t.tag);
                          const info = getTagExplanation(t.tag);
                          return (
                            <HoverExplanation
                              key={t.tag}
                              title={info.title}
                              category={info.category}
                              rawKey={info.rawKey}
                              description={info.description}
                            >
                              <Badge
                                variant={active ? "info" : "outline"}
                                onClick={() => toggleTag(t.tag)}
                                className="cursor-pointer"
                              >
                                {info.title} ({t.count})
                              </Badge>
                            </HoverExplanation>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] text-muted-foreground">
                        Bot Detection Signals &amp; Website Pages:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(tagsCatalog?.botReasons || []).map((t: any) => {
                          const active = selectedTags.includes(t.tag);
                          const info = getTagExplanation(t.tag);
                          return (
                            <HoverExplanation
                              key={t.tag}
                              title={info.title}
                              category={info.category}
                              rawKey={info.rawKey}
                              description={info.description}
                            >
                              <Badge
                                variant={active ? "default" : "outline"}
                                onClick={() => toggleTag(t.tag)}
                                className="cursor-pointer"
                              >
                                {info.title} ({t.count})
                              </Badge>
                            </HoverExplanation>
                          );
                        })}
                        {(tagsCatalog?.entities || []).map((t: any) => {
                          const active = selectedTags.includes(t.tag);
                          const info = getTagExplanation(t.tag);
                          return (
                            <HoverExplanation
                              key={t.tag}
                              title={info.title}
                              category={info.category}
                              rawKey={info.rawKey}
                              description={info.description}
                            >
                              <Badge
                                variant={active ? "secondary" : "outline"}
                                onClick={() => toggleTag(t.tag)}
                                className="cursor-pointer"
                              >
                                {info.title} ({t.count})
                              </Badge>
                            </HoverExplanation>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] text-muted-foreground">
                      Geographic Regions &amp; Origin Countries:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(tagsCatalog?.regions || []).map((t: any) => {
                        const active = selectedTags.includes(t.tag);
                        const info = getTagExplanation(t.tag);
                        return (
                          <HoverExplanation
                            key={t.tag}
                            title={info.title}
                            category={info.category}
                            rawKey={info.rawKey}
                            description={info.description}
                          >
                            <Badge
                              variant={active ? "purple" : "outline"}
                              onClick={() => toggleTag(t.tag)}
                              className="cursor-pointer"
                            >
                              {info.title} ({t.count})
                            </Badge>
                          </HoverExplanation>
                        );
                      })}
                      {(tagsCatalog?.countries || []).map((t: any) => {
                        const active = selectedTags.includes(t.tag);
                        const info = getTagExplanation(t.tag);
                        return (
                          <HoverExplanation
                            key={t.tag}
                            title={info.title}
                            category={info.category}
                            rawKey={info.rawKey}
                            description={info.description}
                          >
                            <Badge
                              variant={active ? "info" : "outline"}
                              onClick={() => toggleTag(t.tag)}
                              className="cursor-pointer"
                            >
                              {info.title} ({t.count})
                            </Badge>
                          </HoverExplanation>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Matching Comments ({totalMatching})</CardTitle>
                <CardDescription>
                  {searchQuery || similarToId
                    ? "Sorted by semantic similarity score (closest meaning first)"
                    : "Sorted by newest comment first"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SubmissionsTable
                  items={submissions}
                  showSimilarity={Boolean(searchQuery || similarToId)}
                  onInspect={setSelectedItem}
                  onFindSimilar={handleFindSimilar}
                  onSelectTag={toggleTag}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Read-Only Forensic Detail Inspection Sheet (shadcn/ui Sheet) */}
      <Sheet open={Boolean(selectedItem)} onOpenChange={(o) => !o && setSelectedItem(null)}>
        {selectedItem && (() => {
          const entityInfo = getTagExplanation(selectedItem.entityId);
          const routeInfo = getTagExplanation(selectedItem.routingPath);
          const visInfo = getTagExplanation(selectedItem.visibility);

          return (
            <SheetContent>
              <SheetHeader>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <HoverExplanation
                      title={visInfo.title}
                      category={visInfo.category}
                      rawKey={visInfo.rawKey}
                      description={visInfo.description}
                    >
                      <Badge
                        variant={
                          selectedItem.authorType === "bot"
                            ? "secondary"
                            : selectedItem.visibility === "public_flagged"
                              ? "warning"
                              : "success"
                        }
                        className="cursor-default"
                      >
                        {selectedItem.authorType === "bot"
                          ? "Automated Bot • Hidden"
                          : selectedItem.visibility === "public_flagged"
                            ? "Flagged Manipulation"
                            : "Verified Human • Public"}
                      </Badge>
                    </HoverExplanation>
                    <span className="font-mono text-xs text-muted-foreground">
                      Comment #{selectedItem.wpCommentId}
                    </span>
                  </div>
                  <SheetTitle>Comment Inspection (Read-Only)</SheetTitle>
                  <SheetDescription className="font-mono">
                    Record ID: {selectedItem.id}
                  </SheetDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedItem(null)}>
                  Close
                </Button>
              </SheetHeader>

              <Separator />

              <div className="space-y-1.5">
                <Label className="uppercase tracking-wider text-muted-foreground">
                  Submitted Text on{" "}
                  <HoverExplanation
                    title={entityInfo.title}
                    category={entityInfo.category}
                    rawKey={entityInfo.rawKey}
                    description={entityInfo.description}
                  >
                    <span className="text-sky-600 dark:text-sky-300 cursor-default">
                      {entityInfo.title}
                    </span>
                  </HoverExplanation>
                  {selectedItem.rating ? ` (${selectedItem.rating}/5 Star Rating)` : ""}
                </Label>
                <Card className="bg-secondary/40">
                  <CardContent className="p-3.5 text-sm leading-relaxed">
                    {selectedItem.rawText}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <HoverExplanation
                  title={routeInfo.title}
                  category={routeInfo.category}
                  rawKey={routeInfo.rawKey}
                  description={routeInfo.description}
                  className="block h-full"
                >
                  <Card className="h-full p-3">
                    <div className="text-[11px] text-muted-foreground">Decision Path</div>
                    <div className="mt-1 text-xs font-semibold">{routeInfo.title}</div>
                  </Card>
                </HoverExplanation>

                <HoverExplanation
                  title="Risk Score vs. Context Shields"
                  category="Scoring Breakdown"
                  rawKey={`risk_score: ${selectedItem.riskScore}, shield_flags: ${selectedItem.shieldFlags}`}
                  description="Risk points measure manipulation signals (Q1–Q44). Shield points protect genuine venting, quotes, or evidence (Q45–Q50)."
                  className="block h-full"
                >
                  <Card className="h-full p-3">
                    <div className="text-[11px] text-muted-foreground">Risk / Shields</div>
                    <div className="mt-1 font-mono text-xs font-semibold">
                      {selectedItem.riskScore} pts / {selectedItem.shieldFlags} shields
                    </div>
                  </Card>
                </HoverExplanation>

                <HoverExplanation
                  title="AI Model Used"
                  category="Evaluation Engine"
                  rawKey={selectedItem.modelUsed}
                  description="Shows whether this comment was stopped at the bot trap (none), cleared by fast screening (jev), or inspected by deep forensic AI (gemini-4-hydrogen)."
                  className="block h-full"
                >
                  <Card className="h-full p-3">
                    <div className="text-[11px] text-muted-foreground">AI Model</div>
                    <div className="mt-1 font-mono text-xs font-semibold">
                      {selectedItem.modelUsed === "none" ? "Bot Trap Only" : selectedItem.modelUsed}
                    </div>
                  </Card>
                </HoverExplanation>
              </div>

              {selectedItem.deepResearchExplanation && (
                <Alert variant="warning">
                  <AlertTitle>AI Forensic Explanation ({selectedItem.modelUsed})</AlertTitle>
                  <AlertDescription>{selectedItem.deepResearchExplanation}</AlertDescription>
                </Alert>
              )}

              {selectedItem.origin && (
                <Card className="border-border bg-secondary/25 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Origin Country &amp; Regional Attribution
                    </span>
                    <HoverExplanation
                      title={getTagExplanation(selectedItem.origin.regionCode).title}
                      category={getTagExplanation(selectedItem.origin.regionCode).category}
                      rawKey={selectedItem.origin.regionCode}
                      description={getTagExplanation(selectedItem.origin.regionCode).description}
                    >
                      <Badge variant="info" className="cursor-default">
                        {selectedItem.origin.region}
                      </Badge>
                    </HoverExplanation>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Country &amp; City:</span>{" "}
                      <span className="font-semibold text-foreground">
                        {selectedItem.origin.city}, {selectedItem.origin.countryName} (
                        {selectedItem.origin.countryCode})
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Network:</span>{" "}
                      <HoverExplanation
                        title={getTagExplanation(selectedItem.origin.networkType).title}
                        category="Network Infrastructure"
                        rawKey={selectedItem.origin.networkType}
                        description={
                          getTagExplanation(selectedItem.origin.networkType).description
                        }
                      >
                        <span className="font-medium text-sky-600 dark:text-sky-300 cursor-default">
                          {getTagExplanation(selectedItem.origin.networkType).title}
                        </span>
                      </HoverExplanation>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      IP: {selectedItem.origin.ipAddress}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {selectedItem.origin.asnLabel}
                    </div>
                  </div>
                </Card>
              )}

              {selectedItem.honeypot && (
                <Card className="border-border bg-secondary/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Bot Telemetry Evidence
                    </span>
                    <Badge variant="secondary">
                      Confidence: {selectedItem.honeypot.confidenceScore}%
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">IP:</span>{" "}
                      <span className="font-mono">{selectedItem.honeypot.ipAddress}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Group:</span>{" "}
                      {selectedItem.honeypot.patternClusterId
                        ? getTagExplanation(selectedItem.honeypot.patternClusterId).title
                        : "Unassigned"}
                    </div>
                    <div className="col-span-2 truncate font-mono text-[11px]">
                      <span className="text-muted-foreground font-sans">Browser:</span>{" "}
                      {selectedItem.honeypot.userAgent}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedItem.honeypot.reasons.map((r) => {
                      const info = getTagExplanation(r);
                      return (
                        <HoverExplanation
                          key={r}
                          title={info.title}
                          category={info.category}
                          rawKey={info.rawKey}
                          description={info.description}
                        >
                          <Badge variant="outline" className="cursor-default">
                            {info.title}
                          </Badge>
                        </HoverExplanation>
                      );
                    })}
                  </div>
                  <pre className="overflow-x-auto rounded-md border border-border bg-background/60 p-2.5 font-mono text-[11px] text-muted-foreground">
                    {JSON.stringify(selectedItem.honeypot.telemetry, null, 2)}
                  </pre>
                </Card>
              )}

              <div className="space-y-2.5">
                <Label className="uppercase tracking-wider text-muted-foreground">
                  Detected Criteria &amp; Context Shields
                </Label>
                {selectedItem.riskTagDetails.length === 0 &&
                  selectedItem.shieldTagDetails.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No manipulation risk patterns or context shields were triggered on this comment.
                    </p>
                  )}
                {selectedItem.riskTagDetails.map((q) => (
                  <Card key={q.id} className="bg-secondary/25 p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={q.tier === 3 ? "purple" : "warning"}>
                          {q.id} (+{q.points} pts)
                        </Badge>
                        <span className="text-xs font-semibold">{q.name}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">{q.bucketName}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{q.description}</p>
                  </Card>
                ))}
                {selectedItem.shieldTagDetails.map((s) => (
                  <Alert key={s.id} variant="info" className="p-3">
                    <AlertTitle>
                      <Badge variant="info">
                        {s.id} (+{s.flags} Shield)
                      </Badge>
                      <span>{s.name}</span>
                    </AlertTitle>
                    <AlertDescription>{s.description}</AlertDescription>
                  </Alert>
                ))}
              </div>

              <div className="pt-2">
                <Button
                  className="w-full"
                  onClick={() => {
                    const target = selectedItem;
                    setSelectedItem(null);
                    handleFindSimilar(target);
                  }}
                >
                  <IconSearch className="h-3.5 w-3.5" />
                  Find Similar Comments Using Vector Search
                </Button>
              </div>
            </SheetContent>
          );
        })()}
      </Sheet>
    </div>
  );
}

function SubmissionsTable({
  items,
  showSimilarity = false,
  onInspect,
  onFindSimilar,
  onSelectTag,
}: {
  items: SubmissionItem[];
  showSimilarity?: boolean;
  onInspect: (item: SubmissionItem) => void;
  onFindSimilar: (item: SubmissionItem) => void;
  onSelectTag: (tag: string) => void;
}) {
  if (!items || items.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No comments or detections match the current filters.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page &amp; Time</TableHead>
          <TableHead>Status &amp; Decision</TableHead>
          {showSimilarity && <TableHead>Meaning Match</TableHead>}
          <TableHead>Comment &amp; Forensic Note</TableHead>
          <TableHead>Detected Tags</TableHead>
          <TableHead className="text-right">Similar</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const entityInfo = getTagExplanation(item.entityId);
          const routeInfo = getTagExplanation(item.routingPath);

          return (
            <TableRow
              key={item.id}
              className="cursor-pointer"
              onClick={() => onInspect(item)}
            >
              <TableCell className="whitespace-nowrap">
                <div className="flex items-center gap-1.5 font-mono text-xs font-semibold">
                  <span>Comment #{item.wpCommentId}</span>
                  {item.authorSessionHash.startsWith("seed_demo_") && (
                    <HoverExplanation
                      title="Sample Demonstration Record"
                      category="Test Data Indicator"
                      rawKey={item.authorSessionHash}
                      description="This entry is part of the seeded sample data so you can preview how the dashboard works."
                    >
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        Sample
                      </Badge>
                    </HoverExplanation>
                  )}
                </div>
                <HoverExplanation
                  title={entityInfo.title}
                  category={entityInfo.category}
                  rawKey={entityInfo.rawKey}
                  description={entityInfo.description}
                >
                  <div className="text-[11px] text-sky-600 dark:text-sky-300 cursor-default">
                    {entityInfo.title}
                  </div>
                </HoverExplanation>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>{formatRelativeTime(item.createdAt)}</span>
                  {item.origin && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <HoverExplanation
                        title={`${item.origin.city}, ${item.origin.countryName}`}
                        category={`${item.origin.region} • Origin`}
                        rawKey={`country_${item.origin.countryCode}`}
                        description={`${getTagExplanation(item.origin.networkType).title} (${item.origin.asnLabel}). Click to filter all traffic from ${item.origin.countryName}.`}
                      >
                        <Badge
                          variant="outline"
                          onClick={() => onSelectTag(`country_${item.origin!.countryCode}`)}
                          className="px-1.5 py-0 font-mono text-[10px] cursor-pointer"
                        >
                          {item.origin.countryCode} &bull; {item.origin.city}
                        </Badge>
                      </HoverExplanation>
                    </span>
                  )}
                </div>
              </TableCell>

              <TableCell className="whitespace-nowrap">
                <div className="flex flex-col items-start gap-1">
                  <HoverExplanation
                    title={routeInfo.title}
                    category={routeInfo.category}
                    rawKey={routeInfo.rawKey}
                    description={routeInfo.description}
                  >
                    <Badge
                      variant={
                        item.authorType === "bot"
                          ? "secondary"
                          : item.visibility === "public_flagged"
                            ? "warning"
                            : "success"
                      }
                      className="cursor-default"
                    >
                      {item.authorType === "bot"
                        ? "Bot (Hidden)"
                        : item.visibility === "public_flagged"
                          ? "Flagged Manipulation"
                          : "Verified Human"}
                    </Badge>
                  </HoverExplanation>
                  <span className="text-[11px] text-muted-foreground">
                    {routeInfo.title} &bull; {item.riskScore} pts
                  </span>
                </div>
              </TableCell>

              {showSimilarity && (
                <TableCell className="whitespace-nowrap">
                  <Badge
                    variant={
                      (item.similarityScore || 0) >= 0.65
                        ? "purple"
                        : (item.similarityScore || 0) >= 0.4
                          ? "info"
                          : "outline"
                    }
                    className="font-mono"
                  >
                    {(((item.similarityScore || 0) * 100) || 0).toFixed(1)}% match
                  </Badge>
                </TableCell>
              )}

              <TableCell className="max-w-md">
                <p className="line-clamp-2 text-xs text-foreground">{item.rawText}</p>
                {item.deepResearchExplanation && (
                  <p className="mt-1 line-clamp-1 text-[11px] text-amber-600 dark:text-amber-300">
                    Forensic note: {item.deepResearchExplanation}
                  </p>
                )}
                {item.honeypot && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    IP: {item.honeypot.ipAddress} &bull; Browser:{" "}
                    {item.honeypot.userAgent.slice(0, 40)}
                  </p>
                )}
              </TableCell>

              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap gap-1">
                  {item.riskTagDetails.slice(0, 3).map((t) => {
                    const info = getTagExplanation(t.id);
                    return (
                      <HoverExplanation
                        key={t.id}
                        title={info.title}
                        category={info.category}
                        rawKey={info.rawKey}
                        description={info.description}
                      >
                        <Badge
                          variant={t.tier === 3 ? "purple" : "warning"}
                          onClick={() => onSelectTag(t.id)}
                          className="cursor-pointer text-[10px]"
                        >
                          {t.name}
                        </Badge>
                      </HoverExplanation>
                    );
                  })}
                  {item.shieldTagDetails.map((s) => {
                    const info = getTagExplanation(s.id);
                    return (
                      <HoverExplanation
                        key={s.id}
                        title={info.title}
                        category={info.category}
                        rawKey={info.rawKey}
                        description={info.description}
                      >
                        <Badge
                          variant="info"
                          onClick={() => onSelectTag(s.id)}
                          className="cursor-pointer text-[10px]"
                        >
                          {s.name}
                        </Badge>
                      </HoverExplanation>
                    );
                  })}
                  {(item.honeypot?.reasons || []).slice(0, 2).map((r) => {
                    const info = getTagExplanation(r);
                    return (
                      <HoverExplanation
                        key={r}
                        title={info.title}
                        category={info.category}
                        rawKey={info.rawKey}
                        description={info.description}
                      >
                        <Badge
                          variant="outline"
                          onClick={() => onSelectTag(r)}
                          className="cursor-pointer text-[10px]"
                        >
                          {info.title}
                        </Badge>
                      </HoverExplanation>
                    );
                  })}
                </div>
              </TableCell>

              <TableCell
                className="text-right whitespace-nowrap"
                onClick={(e) => e.stopPropagation()}
              >
                <HoverExplanation
                  title="Find Similar Comments"
                  category="Vector Similarity"
                  description="Finds other comments across your site that share similar wording, intent, or spam templates."
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onFindSimilar(item)}
                  >
                    Find Similar
                  </Button>
                </HoverExplanation>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}
