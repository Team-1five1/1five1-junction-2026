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
  IconRadar,
  IconSliders,
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

function SwarmTopologyGraph({ swarm }: { swarm: any }) {
  const nodes: Array<{
    id: string;
    label: string;
    ip: string;
    country: string;
    rating: number | null;
    role?: "ORIGINATOR" | "AMPLIFIER" | "COORDINATED_NODE";
  }> = Array.isArray(swarm?.graphNodes) ? swarm.graphNodes : [];
  const edges: Array<{ source: string; target: string; weight: number; reason: string }> = Array.isArray(
    swarm?.graphEdges
  )
    ? swarm.graphEdges
    : [];

  if (nodes.length === 0) return null;

  const width = 600;
  const height = 260;
  const cx = width / 2;
  const cy = height / 2;

  const originators = nodes.filter((n) => n.role === "ORIGINATOR");
  const satellites = nodes.filter((n) => n.role !== "ORIGINATOR");

  const posMap = new Map<
    string,
    { x: number; y: number; node: (typeof nodes)[number] }
  >();

  if (originators.length === 1) {
    posMap.set(originators[0]!.id, { x: cx, y: cy, node: originators[0]! });
  } else if (originators.length > 1) {
    originators.forEach((n, idx) => {
      const angle = (2 * Math.PI * idx) / originators.length - Math.PI / 2;
      posMap.set(n.id, {
        x: cx + Math.cos(angle) * 44,
        y: cy + Math.sin(angle) * 32,
        node: n,
      });
    });
  }

  const ringList = originators.length > 0 ? satellites : nodes;
  const rx = originators.length > 0 ? 210 : 195;
  const ry = originators.length > 0 ? 76 : 74;
  ringList.forEach((n, idx) => {
    const angle = (2 * Math.PI * idx) / Math.max(1, ringList.length) - Math.PI / 2;
    posMap.set(n.id, {
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
      node: n,
    });
  });

  const showEdgeLabels = edges.length <= 15;

  return (
    <div className="mb-3 space-y-2">
      <div className="rounded-lg border border-border/70 bg-secondary/10 p-2 overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-56 select-none"
          role="img"
          aria-label={`Swarm topology graph for ${swarm.name || swarm.id}`}
        >
          {/* Coordination Edges */}
          <g>
            {edges.map((edge, idx) => {
              const src = posMap.get(edge.source);
              const dst = posMap.get(edge.target);
              if (!src || !dst) return null;
              const strokeWidth = Math.max(1.2, Math.min(4.2, edge.weight * 4.5));
              const strokeColor =
                edge.weight >= 0.7 ? "#f43f5e" : edge.weight >= 0.55 ? "#f59e0b" : "#64748b";
              const mx = (src.x + dst.x) / 2;
              const my = (src.y + dst.y) / 2;
              return (
                <g key={`${edge.source}-${edge.target}-${idx}`}>
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={dst.x}
                    y2={dst.y}
                    stroke={strokeColor}
                    strokeOpacity={0.65}
                    strokeWidth={strokeWidth}
                    strokeDasharray={edge.weight >= 0.7 ? undefined : "4 3"}
                  >
                    <title>{`${edge.source} <-> ${edge.target}: ${edge.reason} (${Math.round(edge.weight * 100)}%)`}</title>
                  </line>
                  {showEdgeLabels && (
                    <g transform={`translate(${mx}, ${my})`}>
                      <rect
                        x={-14}
                        y={-8}
                        width={28}
                        height={15}
                        rx={4}
                        fill="#0f172a"
                        fillOpacity={0.82}
                        stroke={strokeColor}
                        strokeOpacity={0.6}
                        strokeWidth={0.8}
                      />
                      <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize={8.5}
                        fontFamily="monospace"
                        fontWeight="600"
                      >
                        {Math.round(edge.weight * 100)}%
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* Swarm Account Nodes */}
          <g>
            {nodes.map((node) => {
              const pos = posMap.get(node.id);
              if (!pos) return null;
              const isOriginator = node.role === "ORIGINATOR";
              const isAmplifier = node.role === "AMPLIFIER";
              const fill = isOriginator ? "#f43f5e" : isAmplifier ? "#f59e0b" : "#38bdf8";
              const stroke = isOriginator ? "#fda4af" : isAmplifier ? "#fde68a" : "#bae6fd";
              const radius = isOriginator ? 16 : 12;
              const roleCode = isOriginator ? "ORG" : isAmplifier ? "AMP" : "NOD";
              const labelY = pos.y < 52 ? pos.y + radius + 12 : pos.y + radius + 12;
              const shortLabel = (node.label || node.id).replace(/^seed_demo_/, "").slice(0, 16);
              return (
                <g key={node.id} className="cursor-pointer">
                  <title>{`${node.label} (${node.role || "COORDINATED_NODE"})\nIP: ${node.ip} (${node.country})${node.rating !== null && node.rating !== undefined ? `\nRating: ${node.rating}★` : ""}`}</title>
                  {isOriginator && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={radius + 6}
                      fill="none"
                      stroke="#f43f5e"
                      strokeOpacity={0.45}
                      strokeWidth={1.6}
                      className="animate-pulse"
                    />
                  )}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={radius}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={2}
                  />
                  <text
                    x={pos.x}
                    y={pos.y + 3}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={isOriginator ? 8.5 : 7.5}
                    fontFamily="monospace"
                    fontWeight="700"
                  >
                    {roleCode}
                  </text>
                  <text
                    x={pos.x}
                    y={labelY}
                    textAnchor="middle"
                    fill="currentColor"
                    fontSize={9.5}
                    className="text-foreground font-mono font-semibold"
                  >
                    {shortLabel}
                  </text>
                  <text
                    x={pos.x}
                    y={labelY + 10}
                    textAnchor="middle"
                    fontSize={8}
                    className="fill-muted-foreground font-mono"
                  >
                    {node.ip}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#f43f5e" }} /> Originator (ORG)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#f59e0b" }} /> Amplifier (AMP)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#38bdf8" }} /> Coordinated Node (NOD)
          </span>
        </div>
        <span className="font-mono text-[10px]">Hover nodes &amp; edges for evidence details</span>
      </div>
    </div>
  );
}

export function DashboardApp() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "map" | "bots" | "search" | "swarms" | "traffic">("overview");
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");
  const [autoPoll, setAutoPoll] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("--:--:--");

  // Overview state
  const [overview, setOverview] = useState<any>(null);

  // Swarm & Traffic Cleaner state
  const [swarmsData, setSwarmsData] = useState<any>(null);
  const [trafficData, setTrafficData] = useState<any>(null);
  const [customLogsInput, setCustomLogsInput] = useState<string>("");
  const [trafficNotice, setTrafficNotice] = useState<string>("");
  const [socialDatasetInput, setSocialDatasetInput] = useState<string>("");
  const [swarmNotice, setSwarmNotice] = useState<string>("");
  const [quarantinedSwarmIds, setQuarantinedSwarmIds] = useState<Record<string, boolean>>({});
  const [quarantiningSwarmId, setQuarantiningSwarmId] = useState<string | null>(null);
  const [botDnsResults, setBotDnsResults] = useState<
    Record<string, { verified: boolean; method: string; hostname?: string | null; verdict: string }>
  >({});
  const [verifyingBotIp, setVerifyingBotIp] = useState<string | null>(null);

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

      const [ovRes, subRes, botRes, tagRes, regRes, swRes, tfRes] = await Promise.all([
        fetch(`/api/dashboard/overview?range=${range}`),
        fetch(`/api/dashboard/submissions?${params.toString()}`),
        fetch(`/api/dashboard/bots`),
        fetch(`/api/dashboard/tags`),
        fetch(`/api/dashboard/regions?${regParams.toString()}`),
        fetch(`/api/dashboard/swarms`),
        fetch(`/api/dashboard/traffic/overview`),
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
      if (swRes.ok) setSwarmsData(await swRes.json());
      if (tfRes.ok) setTrafficData(await tfRes.json());

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

              <HoverExplanation
                title="Spot the Swarm: Coordinated Astroturfing & Brigading"
                category="Dashboard Tab"
                rawKey="swarm_intelligence"
                description="Detects multi-account coordinated inauthentic behavior, synchronized timing bursts, and cross-post brigading networks rather than isolated posts."
              >
                <TabsTrigger value="swarms">
                  <IconRadar className="h-3.5 w-3.5" />
                  Swarm Networks ({swarmsData?.activeSwarmCount ?? 0})
                </TabsTrigger>
              </HoverExplanation>

              <HoverExplanation
                title="Clean the Traffic: Web Server Log Analyzer & WAF Defense"
                category="Dashboard Tab"
                rawKey="traffic_cleaner"
                description="Tells malicious bots, scrapers, and credential-stuffing attempts apart from real visitors in web-server logs, with instant firewall rules."
              >
                <TabsTrigger value="traffic">
                  <IconSliders className="h-3.5 w-3.5" />
                  Clean Traffic &amp; WAF ({trafficData?.cleanVsMaliciousPercent?.maliciousPercent ?? 0}% Threats)
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

          {/* ================================================================= */}
          {/* TAB 5: SPOT THE SWARM (Coordinated Inauthentic Behavior Detector) */}
          {/* ================================================================= */}
          <TabsContent value="swarms" className="space-y-6">
            <Card className="border-border bg-card">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <IconRadar className="h-5 w-5 text-primary" />
                      Spot the Swarm: Coordinated Inauthentic Behavior &amp; Astroturfing Detector
                    </CardTitle>
                    <Badge variant="outline" className="text-xs">Multi-Account Correlation</Badge>
                  </div>
                  <CardDescription className="mt-1">
                    Detects bot networks, astroturfing campaigns, and cross-post review brigading by correlating
                    posting timing cadence, account subnet/ASN proximity, and paraphrased text reuse rather than inspecting isolated posts.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="px-3 py-1 font-mono text-xs">
                    {swarmsData?.activeSwarmCount ?? 0} Swarms Identified
                  </Badge>
                </div>
              </CardHeader>
            </Card>

            {/* Swarm High-Level Metrics */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">Active Swarms Detected</CardDescription>
                  <CardTitle className="text-2xl font-bold text-primary">
                    {swarmsData?.activeSwarmCount ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                  Graph community clusters with &ge;2 collaborating accounts
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">Coordinated Member Accounts</CardDescription>
                  <CardTitle className="text-2xl font-bold text-destructive">
                    {swarmsData?.totalSwarmMembers ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                  Unique author sessions mapped to coordination graphs
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">Critical Astroturf Brigades</CardDescription>
                  <CardTitle className="text-2xl font-bold text-destructive">
                    {swarmsData?.summary?.criticalSwarms ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                  High-confidence campaigns (&ge;80% coordination score)
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">Top Brigaded Target Entities</CardDescription>
                  <CardTitle className="text-2xl font-bold text-primary">
                    {swarmsData?.summary?.topTargetEntities?.length ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                  Target posts / products hit by cross-entity campaigns
                </CardContent>
              </Card>
            </div>

            {/* Social Platform Dataset Importer (CSV / JSON) */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold">
                    Social Platform Dataset Importer (CSV / JSON)
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Import exported X, Reddit, forum, or review threads (handles, timestamps, reply chains, URLs, device fingerprints) into the swarm detector.
                  </CardDescription>
                </div>
                <button
                  onClick={async () => {
                    const res = await fetch("/api/dashboard/swarms/import", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ loadSample: true, mode: "replace" }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setSwarmsData(data);
                      if (data.sampleDatasetCsv) setSocialDatasetInput(data.sampleDatasetCsv);
                      setSwarmNotice(
                        `Imported ${data.importedCount ?? 0} sample social platform posts and re-ran swarm correlation.`
                      );
                      setTimeout(() => setSwarmNotice(""), 5000);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-xs font-semibold hover:bg-secondary cursor-pointer shrink-0"
                >
                  📂 Load Sample Social Astroturf Dataset (CSV)
                </button>
              </CardHeader>
              <CardContent className="space-y-3">
                {swarmNotice && (
                  <div className="rounded-md bg-primary/10 border border-primary/30 p-2 text-xs text-primary font-medium">
                    {swarmNotice}
                  </div>
                )}
                <textarea
                  rows={4}
                  value={socialDatasetInput}
                  onChange={(e) => setSocialDatasetInput(e.target.value)}
                  placeholder="Paste CSV (post_id,author_handle,author_id,created_at,text,target_id,reply_to_id,shared_url,device_fingerprint,account_created_at,ip_address) or JSON array of social posts..."
                  className="w-full rounded-md border border-border bg-background p-2.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    Supports paraphrased semantic matching, multi-window co-activity bursts, handle similarity &amp; reply amplification chains.
                  </span>
                  <button
                    onClick={async () => {
                      if (!socialDatasetInput.trim()) return;
                      const res = await fetch("/api/dashboard/swarms/import", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ dataset: socialDatasetInput, mode: "replace" }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setSwarmsData(data);
                        setSwarmNotice(`Analyzed ${data.importedCount ?? 0} imported social post(s).`);
                        setTimeout(() => setSwarmNotice(""), 5000);
                      } else {
                        setSwarmNotice("Could not parse CSV/JSON dataset. Check columns or JSON array format.");
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer"
                  >
                    🔍 Analyze Dataset
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Swarm Clusters List */}
            {(!swarmsData?.swarms || swarmsData.swarms.length === 0) ? (
              <Card className="p-8 text-center">
                <CardTitle className="text-base text-muted-foreground">
                  No active coordinated swarms detected in the current submission window.
                </CardTitle>
                <CardDescription className="mt-2 text-xs">
                  Run the 4-Bucket Bot Swarm benchmark (<code>bun run test:swarm</code>) or post comments to populate live coordination telemetry.
                </CardDescription>
              </Card>
            ) : (
              <div className="space-y-6">
                {swarmsData.swarms.map((swarm: any) => (
                  <Card key={swarm.id} className="border-border bg-card">
                    <CardHeader className="border-b border-border/60 pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive font-mono font-bold text-sm">
                            🚨
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-base font-bold">{swarm.name}</CardTitle>
                              <Badge
                                variant={
                                  swarm.threatLevel === "CRITICAL"
                                    ? "destructive"
                                    : swarm.threatLevel === "ELEVATED"
                                    ? "warning"
                                    : "secondary"
                                }
                                className="text-xs"
                              >
                                {swarm.threatLevel} THREAT
                              </Badge>
                              <Badge variant="outline" className="text-xs font-mono">
                                {swarm.campaignType.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <CardDescription className="text-xs font-mono text-muted-foreground">
                              Cluster ID: {swarm.id} &bull; {swarm.memberCount} member accounts &bull; {swarm.totalSubmissions} total submissions
                            </CardDescription>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Coordination Score</div>
                            <div className="text-lg font-bold text-primary">{swarm.confidenceScore}%</div>
                          </div>
                          <div className="h-8 w-16 bg-secondary rounded-full overflow-hidden flex items-center p-0.5">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${swarm.confidenceScore}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 pt-4">
                      {/* Coordination Signals Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                        <div className="rounded-lg border border-border p-3 bg-secondary/20">
                          <div className="text-muted-foreground font-semibold">Network Footprint</div>
                          <div className="mt-1 font-mono font-bold text-foreground">
                            {swarm.networkFootprint.uniqueSubnets} Subnet(s) &bull; {swarm.networkFootprint.uniqueIps} IP(s)
                          </div>
                          <div className="mt-0.5 text-muted-foreground truncate">
                            {swarm.networkFootprint.topAsns[0] || "Datacenter ASN"}
                          </div>
                        </div>

                        <div className="rounded-lg border border-border p-3 bg-secondary/20">
                          <div className="text-muted-foreground font-semibold">Timing &amp; Cadence</div>
                          <div className="mt-1 font-mono font-bold text-foreground">
                            Regularity: {swarm.cadenceMetrics.cadenceRegularityScore}%
                          </div>
                          <div className="mt-0.5 text-muted-foreground">
                            Mean interval: {swarm.cadenceMetrics.interArrivalTimeMeanSec}s (B={swarm.cadenceMetrics.burstiness})
                          </div>
                        </div>

                        <div className="rounded-lg border border-border p-3 bg-secondary/20">
                          <div className="text-muted-foreground font-semibold">Text Reuse &amp; Paraphrasing</div>
                          <div className="mt-1 font-mono font-bold text-foreground">
                            Similarity: {Math.round(swarm.textReuseMetrics.avgPairwiseSimilarity * 100)}%
                          </div>
                          <div className="mt-0.5 text-muted-foreground">
                            {swarm.textReuseMetrics.paraphrasedVariantsDetected
                              ? "⚠️ Paraphrased variants detected"
                              : "Near-exact template replication"}
                          </div>
                        </div>

                        <div className="rounded-lg border border-border p-3 bg-secondary/20">
                          <div className="text-muted-foreground font-semibold">Brigaded Target Entities</div>
                          <div className="mt-1 font-mono font-bold text-foreground">
                            {swarm.targetEntities.length} Target(s) Hit
                          </div>
                          <div className="mt-0.5 text-muted-foreground truncate">
                            {swarm.targetEntities.map((t: any) => `${t.entityId} (${t.count})`).join(", ")}
                          </div>
                        </div>
                      </div>

                      {/* Amplification & Cross-Engine Threat Correlation Row */}
                      {(swarm.amplificationMetrics || (swarm.correlatedTrafficThreats && swarm.correlatedTrafficThreats.length > 0)) && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          {swarm.amplificationMetrics && (
                            <div className="rounded-lg border border-border p-3 bg-secondary/10">
                              <div className="text-muted-foreground font-semibold">Amplification Chain</div>
                              <div className="mt-1 font-mono font-bold text-foreground">
                                {swarm.amplificationMetrics.originatorHandles && swarm.amplificationMetrics.originatorHandles.length > 1 ? (
                                  <>
                                    Originators ({swarm.amplificationMetrics.originatorHandles.length}):{" "}
                                    <span className="text-destructive font-semibold">
                                      @{swarm.amplificationMetrics.originatorHandles.join(", @")}
                                    </span>
                                  </>
                                ) : swarm.amplificationMetrics.originatorHandle ? (
                                  <>
                                    Originator:{" "}
                                    <span className="text-destructive font-semibold">
                                      @{swarm.amplificationMetrics.originatorHandle}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    Originator:{" "}
                                    <span className="text-destructive font-semibold">
                                      {swarm.amplificationMetrics.originatorSession.replace(/^seed_demo_/, "").slice(0, 16)}
                                    </span>
                                  </>
                                )}{" "}
                                &bull; {swarm.amplificationMetrics.amplifierCount} Amplifier(s)
                              </div>
                              <div className="mt-0.5 text-muted-foreground truncate">
                                {swarm.amplificationMetrics.sharedUrlsOrCodes?.length > 0
                                  ? `Shared tokens: ${swarm.amplificationMetrics.sharedUrlsOrCodes.slice(0, 3).join(", ")}`
                                  : `Reply chains: ${swarm.amplificationMetrics.replyChainCount} | Velocity: ${swarm.amplificationMetrics.amplificationVelocityPerMin}/min`}
                              </div>
                            </div>
                          )}

                          {swarm.accountSimilarityMetrics && (
                            <div className="rounded-lg border border-border p-3 bg-secondary/10">
                              <div className="text-muted-foreground font-semibold">Account &amp; Fingerprint Signals</div>
                              <div className="mt-1 font-mono font-bold text-foreground">
                                Handle Sim: {Math.round((swarm.accountSimilarityMetrics.avgHandleSimilarity || 0) * 100)}% &bull; New Accts: {swarm.accountSimilarityMetrics.synchronizedNewAccountsCount || 0}
                              </div>
                              <div className="mt-0.5 text-muted-foreground">
                                {swarm.accountSimilarityMetrics.crossSubnetRotationDetected
                                  ? "⚠️ Cross-subnet proxy rotation matched by fingerprint"
                                  : "Standard session footprint"}
                              </div>
                            </div>
                          )}

                          <div className="rounded-lg border border-destructive/30 p-3 bg-destructive/5">
                            <div className="text-muted-foreground font-semibold">Server Log Correlation (Clean Traffic Bridge)</div>
                            <div className="mt-1 font-mono font-bold text-destructive">
                              {swarm.correlatedTrafficThreats?.length > 0
                                ? `${swarm.correlatedTrafficThreats.length} IP/Subnet Match(es)`
                                : "0 Log Matches"}
                            </div>
                            <div className="mt-0.5 text-muted-foreground truncate">
                              {swarm.correlatedTrafficThreats?.length > 0
                                ? swarm.correlatedTrafficThreats[0]
                                : "No overlap with flagged access log attackers"}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Synchronized Burst Timeline Strip & Co-Activity Windows */}
                      {swarm.timelineBuckets && swarm.timelineBuckets.length > 0 && (
                        <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-foreground">
                              Posting Burst Timeline ({swarm.timelineBuckets.length} window buckets)
                            </span>
                            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                              {swarm.cadenceMetrics?.coActivityWindows !== undefined && (
                                <Badge variant="outline" className="text-[10px]">
                                  {swarm.cadenceMetrics.coActivityWindows} co-activity window(s)
                                </Badge>
                              )}
                              {swarm.cadenceMetrics?.minPostDeltaSec !== undefined && (
                                <Badge variant="secondary" className="text-[10px]">
                                  min delta {swarm.cadenceMetrics.minPostDeltaSec}s
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-end gap-1.5 h-12 pt-2">
                            {(() => {
                              const maxBucket = Math.max(
                                1,
                                ...swarm.timelineBuckets.map((b: any) => Number(b.count || 0))
                              );
                              return swarm.timelineBuckets.map((b: any, idx: number) => {
                                const hPct = Math.max(12, Math.round((Number(b.count || 0) / maxBucket) * 100));
                                return (
                                  <div
                                    key={idx}
                                    title={`${b.bucketLabel} UTC: ${b.count} post(s)`}
                                    className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
                                  >
                                    <div
                                      className="w-full rounded-t bg-primary/80 transition-all"
                                      style={{ height: `${hPct}%` }}
                                    />
                                    <span className="text-[9px] font-mono text-muted-foreground truncate max-w-full">
                                      {b.bucketLabel} ({b.count})
                                    </span>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Visual Network Graph Representation */}
                      <div className="rounded-lg border border-border/80 bg-background/50 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            🕸️ Multi-Account Coordination Graph ({swarm.graphNodes.length} Nodes, {swarm.graphEdges.length} Evidence Edges)
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Connected by shared subnet (/24), synchronized timing bursts, and text similarity
                          </span>
                        </div>
                        <SwarmTopologyGraph swarm={swarm} />
                        <div className="flex flex-wrap items-center gap-2">
                          {swarm.graphNodes.map((node: any) => (
                            <div
                              key={node.id}
                              className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs"
                            >
                              <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                              <span className="font-mono font-semibold">{node.label}</span>
                              <span className="text-muted-foreground">({node.country} - {node.ip})</span>
                              {node.role && node.role !== "COORDINATED_NODE" && (
                                <Badge
                                  variant={node.role === "ORIGINATOR" ? "destructive" : "secondary"}
                                  className="text-[10px] px-1 py-0 h-4"
                                >
                                  {node.role}
                                </Badge>
                              )}
                              {node.rating !== null && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                                  {node.rating}★
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                        {swarm.graphEdges.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground">Active Coordination Edges:</span>
                            {swarm.graphEdges.slice(0, 5).map((e: any, idx: number) => (
                              <span key={idx} className="rounded bg-secondary/40 px-2 py-0.5 font-mono">
                                {e.source.slice(0, 8)} &harr; {e.target.slice(0, 8)}: {e.reason} ({Math.round(e.weight * 100)}%)
                              </span>
                            ))}
                            {swarm.graphEdges.length > 5 && (
                              <span className="text-muted-foreground self-center">
                                +{swarm.graphEdges.length - 5} more links
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Sample Paraphrased Campaign Text */}
                      {swarm.sampleTexts && swarm.sampleTexts.length > 0 && (
                        <div className="rounded-lg border border-border p-3 bg-secondary/10">
                          <div className="text-xs font-semibold text-foreground mb-1.5">
                            Sample Coordinated Campaign Phrasing:
                          </div>
                          <div className="space-y-1 text-xs italic text-muted-foreground">
                            {swarm.sampleTexts.map((txt: string, idx: number) => (
                              <p key={idx} className="truncate">
                                &bull; &ldquo;{txt}&rdquo;
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actionable Defense Box */}
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <IconShield className="h-4 w-4 text-primary shrink-0" />
                          <span className="text-foreground font-medium">
                            <strong>Recommended Defense Action:</strong> {swarm.recommendedAction}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={quarantiningSwarmId === swarm.id || Boolean(quarantinedSwarmIds[swarm.id])}
                          onClick={async () => {
                            setQuarantiningSwarmId(swarm.id);
                            try {
                              const res = await fetch("/api/dashboard/swarms/quarantine", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  swarmId: swarm.id,
                                  memberSessions: (swarm.members || []).map((m: any) => m.sessionHash),
                                  ips: (swarm.members || []).map((m: any) => m.ipAddress),
                                }),
                              });
                              if (res.ok) {
                                const data = await res.json();
                                if (data.swarmsReport) setSwarmsData(data.swarmsReport);
                                if (data.trafficReport) setTrafficData(data.trafficReport);
                                setQuarantinedSwarmIds((prev) => ({ ...prev, [swarm.id]: true }));
                                setSwarmNotice(
                                  `Quarantined swarm ${swarm.id}: shadow-held ${data.quarantinedMembersCount ?? 0} account(s) and added ${(data.blockedIps || []).length} IP(s) to WAF block rules.`
                                );
                                setTimeout(() => setSwarmNotice(""), 6000);
                              } else {
                                setSwarmNotice("Could not quarantine swarm. Refresh and try again.");
                              }
                            } finally {
                              setQuarantiningSwarmId(null);
                            }
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                            quarantinedSwarmIds[swarm.id]
                              ? "border border-success/40 bg-success/10 text-success cursor-default"
                              : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          }`}
                        >
                          {quarantinedSwarmIds[swarm.id]
                            ? "✓ Swarm Quarantined & IPs Blocked"
                            : quarantiningSwarmId === swarm.id
                            ? "Quarantining..."
                            : "🛡️ Quarantine Swarm & Block IPs"}
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ================================================================= */}
          {/* TAB 6: CLEAN THE TRAFFIC (Web Server Log Analyzer & WAF Defense)  */}
          {/* ================================================================= */}
          <TabsContent value="traffic" className="space-y-6">
            <Card className="border-border bg-card">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <IconSliders className="h-5 w-5 text-primary" />
                      Clean the Traffic: Web Server Access Log Analyzer &amp; WAF Defense
                    </CardTitle>
                    <Badge variant="outline" className="text-xs">Log-Based Threat Intel</Badge>
                  </div>
                  <CardDescription className="mt-1">
                    Analyzes raw Nginx, Apache, or Caddy web-server access logs to distinguish real visitors and verified search engines
                    from scrapers, credential-stuffing botnets, and vulnerability probers, generating copy-pasteable firewall block rules.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={async () => {
                      const res = await fetch("/api/dashboard/traffic/seed-demo", { method: "POST" });
                      if (res.ok) {
                        setTrafficData(await res.json());
                        setTrafficNotice("Seeded realistic server logs with credential stuffers, scrapers & human shoppers.");
                        setTimeout(() => setTrafficNotice(""), 4000);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-xs font-semibold hover:bg-secondary cursor-pointer"
                  >
                    🎲 Seed Demo Attack Logs
                  </button>

                  <a
                    href="/api/dashboard/traffic/export-rules?format=nginx"
                    download="truthier-nginx-block.conf"
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer"
                  >
                    💾 Export Nginx Rules
                  </a>

                  <a
                    href="/api/dashboard/traffic/export-rules?format=cloudflare"
                    download="truthier-cloudflare-waf.txt"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary cursor-pointer"
                  >
                    ☁️ Cloudflare WAF
                  </a>

                  <a
                    href="/api/dashboard/traffic/export-rules?format=robots"
                    download="robots.txt"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary cursor-pointer"
                  >
                    🤖 Export robots.txt
                  </a>
                </div>
              </CardHeader>

              {trafficNotice && (
                <div className="mx-6 mb-4 rounded-md bg-primary/10 border border-primary/30 p-2.5 text-xs text-primary font-medium">
                  {trafficNotice}
                </div>
              )}
            </Card>

            {/* Traffic High-Level KPIs */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">Total Access Log Requests</CardDescription>
                  <CardTitle className="text-2xl font-bold text-foreground">
                    {trafficData?.analyzedLines ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                  Across {trafficData?.uniqueIpsCount ?? 0} unique client IP addresses
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">Clean vs. Malicious Traffic</CardDescription>
                  <CardTitle className="text-2xl font-bold text-primary">
                    {trafficData?.cleanVsMaliciousPercent?.cleanPercent ?? 100}% Clean
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-xs text-destructive font-semibold">
                  {trafficData?.cleanVsMaliciousPercent?.maliciousPercent ?? 0}% Malicious / Unwanted
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">Credential-Stuffing Attacks</CardDescription>
                  <CardTitle className="text-2xl font-bold text-destructive">
                    {trafficData?.trafficBreakdown?.credentialStufferCount ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                  Brute force POSTs to /wp-login.php &amp; xmlrpc.php
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardDescription className="text-xs">High-Risk IPs to Block</CardDescription>
                  <CardTitle className="text-2xl font-bold text-destructive">
                    {trafficData?.topThreatIps?.filter((p: any) => p.recommendedAction === "BLOCK").length ?? 0}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
                  Recommended for immediate firewall rejection
                </CardContent>
              </Card>
            </div>

            {/* Threat Categories Breakdown Grid */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">Traffic Classification &amp; Threat Distribution</CardTitle>
                <CardDescription className="text-xs">
                  How incoming server requests are classified based on HTTP method, path traversal, status codes, and behavioral asset loading.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                  <div className="rounded-lg border border-success/30 bg-success/10 p-3">
                    <div className="text-muted-foreground font-semibold">Real Visitors</div>
                    <div className="text-lg font-bold text-success mt-1">
                      {trafficData?.trafficBreakdown?.humanPercent ?? 0}%
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {trafficData?.trafficBreakdown?.humanCount ?? 0} hits
                    </div>
                  </div>

                  <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
                    <div className="text-muted-foreground font-semibold">Verified Bots</div>
                    <div className="text-lg font-bold text-primary mt-1">
                      {trafficData?.trafficBreakdown?.verifiedBotPercent ?? 0}%
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {trafficData?.trafficBreakdown?.verifiedBotCount ?? 0} hits
                    </div>
                  </div>

                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                    <div className="text-muted-foreground font-semibold">AI Crawlers</div>
                    <div className="text-lg font-bold text-warning mt-1">
                      {trafficData?.trafficBreakdown?.aiCrawlerPercent ?? 0}%
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {trafficData?.trafficBreakdown?.aiCrawlerCount ?? 0} hits
                    </div>
                  </div>

                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                    <div className="text-muted-foreground font-semibold">Spoofed Crawlers</div>
                    <div className="text-lg font-bold text-destructive mt-1">
                      {trafficData?.trafficBreakdown?.spoofedBotPercent ?? 0}%
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {trafficData?.trafficBreakdown?.spoofedBotCount ?? 0} hits
                    </div>
                  </div>

                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                    <div className="text-muted-foreground font-semibold">Content Scrapers</div>
                    <div className="text-lg font-bold text-warning mt-1">
                      {trafficData?.trafficBreakdown?.scraperPercent ?? 0}%
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {trafficData?.trafficBreakdown?.scraperCount ?? 0} hits
                    </div>
                  </div>

                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                    <div className="text-muted-foreground font-semibold">Credential Stuffers</div>
                    <div className="text-lg font-bold text-destructive mt-1">
                      {trafficData?.trafficBreakdown?.credentialStufferPercent ?? 0}%
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {trafficData?.trafficBreakdown?.credentialStufferCount ?? 0} hits
                    </div>
                  </div>

                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                    <div className="text-muted-foreground font-semibold">Exploit Probers</div>
                    <div className="text-lg font-bold text-destructive mt-1">
                      {trafficData?.trafficBreakdown?.vulnerabilityScannerPercent ?? 0}%
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {trafficData?.trafficBreakdown?.vulnerabilityScannerCount ?? 0} hits
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="text-muted-foreground font-semibold">DoS Flooders</div>
                    <div className="text-lg font-bold text-foreground mt-1">
                      {trafficData?.trafficBreakdown?.dosFlooderPercent ?? 0}%
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {trafficData?.trafficBreakdown?.dosFlooderCount ?? 0} hits
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Anomaly Spike Alerts & Traffic Time-Series Breakdown */}
            {((trafficData?.recentSpikeAlerts && trafficData.recentSpikeAlerts.length > 0) ||
              (trafficData?.timeSeries && trafficData.timeSeries.length > 0)) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {trafficData?.recentSpikeAlerts && trafficData.recentSpikeAlerts.length > 0 && (
                  <Card className="border-destructive/40 bg-destructive/5">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-bold text-destructive">
                        Anomaly Spike Alerts
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Time windows where malicious request volume significantly exceeded baseline average
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-1.5 text-xs">
                      {trafficData.recentSpikeAlerts.map((alertMsg: string, idx: number) => (
                        <div
                          key={idx}
                          className="rounded border border-destructive/30 bg-background/70 px-2.5 py-1.5 font-mono text-destructive"
                        >
                          ⚡ {alertMsg}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {trafficData?.timeSeries && trafficData.timeSeries.length > 0 && (
                  <Card className={trafficData?.recentSpikeAlerts?.length > 0 ? "" : "lg:col-span-2"}>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-bold">
                          Traffic Time-Series Breakdown
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Clean, AI crawler, and malicious request buckets over the log window
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="text-success">■ Clean</span>
                        <span className="text-warning">■ AI</span>
                        <span className="text-destructive">■ Malicious</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-end gap-2 h-24 pt-2">
                        {(() => {
                          const maxBucketTotal = Math.max(
                            1,
                            ...trafficData.timeSeries.map(
                              (b: any) =>
                                Number(b.cleanCount || 0) +
                                Number(b.aiCrawlerCount || 0) +
                                Number(b.maliciousCount || 0)
                            )
                          );
                          return trafficData.timeSeries.map((b: any, idx: number) => {
                            const clean = Number(b.cleanCount || 0);
                            const ai = Number(b.aiCrawlerCount || 0);
                            const mal = Number(b.maliciousCount || 0);
                            const sum = clean + ai + mal;
                            const totalPct = Math.max(8, Math.round((sum / maxBucketTotal) * 100));
                            return (
                              <div
                                key={idx}
                                title={`${b.bucketLabel} UTC — Clean: ${clean}, AI: ${ai}, Malicious: ${mal}`}
                                className="flex-1 flex flex-col items-center h-full justify-end gap-1"
                              >
                                <div
                                  className="w-full flex flex-col-reverse rounded overflow-hidden bg-secondary/30"
                                  style={{ height: `${totalPct}%` }}
                                >
                                  {clean > 0 && (
                                    <div
                                      className="w-full bg-success/80"
                                      style={{ height: `${Math.round((clean / Math.max(1, sum)) * 100)}%` }}
                                    />
                                  )}
                                  {ai > 0 && (
                                    <div
                                      className="w-full bg-warning/80"
                                      style={{ height: `${Math.round((ai / Math.max(1, sum)) * 100)}%` }}
                                    />
                                  )}
                                  {mal > 0 && (
                                    <div
                                      className="w-full bg-destructive/80"
                                      style={{ height: `${Math.round((mal / Math.max(1, sum)) * 100)}%` }}
                                    />
                                  )}
                                </div>
                                <span className="text-[9px] font-mono text-muted-foreground truncate max-w-full">
                                  {b.bucketLabel}
                                </span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Site-Owner Action Plan & Impact Summary */}
            {trafficData?.ownerSummary && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-bold">Site-Owner Action Plan &amp; Bandwidth Impact</CardTitle>
                      <CardDescription className="text-xs">
                        Prioritized actions and projected clean traffic after applying generated firewall rules.
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="text-xs font-mono">
                      Post-WAF Clean Traffic: {trafficData.ownerSummary.estimatedCleanAfterRulesPercent}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="rounded-lg border border-border p-3 bg-secondary/20">
                      <div className="text-muted-foreground font-semibold">Wasted Bot Bandwidth</div>
                      <div className="mt-1 font-mono font-bold text-destructive text-base">
                        {trafficData.ownerSummary.wastedBandwidthFormatted}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border p-3 bg-secondary/20">
                      <div className="text-muted-foreground font-semibold">Spoofed Crawler Hits</div>
                      <div className="mt-1 font-mono font-bold text-destructive text-base">
                        {trafficData.ownerSummary.spoofedBotRequestsCount}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border p-3 bg-secondary/20">
                      <div className="text-muted-foreground font-semibold">Distributed Campaigns</div>
                      <div className="mt-1 font-mono font-bold text-primary text-base">
                        {trafficData.ownerSummary.distributedAttacksDetected}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border p-3 bg-secondary/20">
                      <div className="text-muted-foreground font-semibold">Account Takeover Alerts</div>
                      <div className="mt-1 font-mono font-bold text-destructive text-base">
                        {trafficData.ownerSummary.accountTakeoverAlerts}
                      </div>
                    </div>
                  </div>

                  {trafficData.ownerSummary.prioritizedActions?.length > 0 && (
                    <div className="space-y-2">
                      {trafficData.ownerSummary.prioritizedActions.map((act: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-border p-3 bg-background/60 text-xs"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 font-semibold text-foreground">
                              <Badge
                                variant={
                                  act.priority === "IMMEDIATE"
                                    ? "destructive"
                                    : act.priority === "HIGH"
                                    ? "warning"
                                    : "secondary"
                                }
                                className="text-[10px]"
                              >
                                {act.priority}
                              </Badge>
                              <span>{act.title}</span>
                            </div>
                            <div className="text-muted-foreground">{act.impact}</div>
                          </div>
                          <code className="rounded bg-secondary/60 px-2 py-1 font-mono text-[11px] text-foreground shrink-0">
                            {act.rulePreview}
                          </code>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Distributed Botnet & Low-and-Slow Campaigns */}
            {trafficData?.distributedCampaigns && trafficData.distributedCampaigns.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold">Distributed Botnet &amp; Low-and-Slow Campaigns</CardTitle>
                  <CardDescription className="text-xs">
                    Cross-IP coordinated attacks detected across distributed nodes targeting shared endpoints.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {trafficData.distributedCampaigns.map((camp: any) => (
                    <div
                      key={camp.id}
                      className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive" className="text-[10px]">
                            {camp.type.replace(/_/g, " ")}
                          </Badge>
                          <span className="font-mono font-bold text-foreground">{camp.targetPath}</span>
                        </div>
                        <span className="font-mono text-muted-foreground">
                          {camp.participatingIps.length} IPs &bull; {camp.totalRequests} requests &bull; {camp.failureRatePercent}% failures
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        <strong>Signature:</strong> {camp.sharedSignature} &bull; <strong>Action:</strong> {camp.recommendedAction}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Top Threat IPs Leaderboard */}
            <Card>
              <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="text-base font-bold">Threat Leaderboard: Malicious Clients &amp; Bots</CardTitle>
                  <CardDescription className="text-xs">
                    Identifies source IPs conducting credential stuffing, headless scraping, or probing for sensitive files.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>IP Address &amp; Origin</TableHead>
                        <TableHead>Network / ASN</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Risk</TableHead>
                        <TableHead>Attack Signature / Pattern</TableHead>
                        <TableHead>Total Hits</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!trafficData?.topThreatIps || trafficData.topThreatIps.length === 0) ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-6 text-muted-foreground text-xs">
                            No threat IPs detected yet. Seed demo logs or ingest server logs above.
                          </TableCell>
                        </TableRow>
                      ) : (
                        trafficData.topThreatIps.slice(0, 15).map((threat: any) => (
                          <TableRow key={threat.ipAddress}>
                            <TableCell className="font-mono text-xs font-semibold">
                              <div>{threat.ipAddress}</div>
                              <div className="text-[11px] text-muted-foreground font-sans">
                                {threat.countryName} ({threat.countryCode})
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground truncate max-w-[140px]">
                              {threat.asnLabel}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1 items-start">
                                <Badge
                                  variant={
                                    threat.category === "CREDENTIAL_STUFFER" ||
                                    threat.category === "VULNERABILITY_SCANNER" ||
                                    threat.category === "SPOOFED_BOT"
                                      ? "destructive"
                                      : threat.category === "SCRAPER" || threat.category === "AI_CRAWLER"
                                      ? "warning"
                                      : threat.category === "VERIFIED_BOT"
                                      ? "outline"
                                      : "secondary"
                                  }
                                  className="text-[11px]"
                                >
                                  {threat.category.replace(/_/g, " ")}
                                </Badge>
                                {threat.authAttackType && (
                                  <Badge variant="outline" className="text-[9px] font-mono">
                                    {threat.authAttackType.replace(/_/g, " ")}
                                    {typeof threat.distinctTargetedUsers === "number" && threat.distinctTargetedUsers > 0
                                      ? ` (${threat.distinctTargetedUsers}u)`
                                      : ""}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span
                                className={`text-xs font-bold font-mono ${
                                  threat.riskScore >= 80
                                    ? "text-destructive"
                                    : threat.riskScore >= 50
                                    ? "text-warning"
                                    : "text-success"
                                }`}
                              >
                                {threat.riskScore}/100
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-foreground max-w-[260px]">
                              <div className="truncate" title={threat.threatReason}>{threat.threatReason}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {threat.honeypotTrapHits > 0 && (
                                  <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">
                                    trap ({threat.honeypotTrapHits})
                                  </Badge>
                                )}
                                {threat.sequentialCrawlDetected && (
                                  <Badge variant="warning" className="text-[9px] px-1 py-0 h-4">
                                    seq crawl
                                  </Badge>
                                )}
                                {typeof threat.requestRegularityScore === "number" && threat.requestRegularityScore >= 70 && (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-mono">
                                    reg {threat.requestRegularityScore}%
                                  </Badge>
                                )}
                                {threat.robotsTxtFetched && (
                                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 font-mono">
                                    robots.txt
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs font-bold">
                              {threat.totalRequests}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-1.5">
                                <Badge
                                  variant={
                                    threat.recommendedAction === "BLOCK"
                                      ? "destructive"
                                      : threat.recommendedAction === "RATE_LIMIT"
                                      ? "warning"
                                      : "secondary"
                                  }
                                  className="text-[10px]"
                                >
                                  {threat.recommendedAction}
                                </Badge>
                                {(threat.claimedBotName ||
                                  threat.category === "SPOOFED_BOT" ||
                                  threat.category === "VERIFIED_BOT") && (
                                  botDnsResults[threat.ipAddress] ? (
                                    <Badge
                                      variant={
                                        botDnsResults[threat.ipAddress]!.verified
                                          ? "outline"
                                          : "destructive"
                                      }
                                      className="text-[9px] font-mono"
                                      title={
                                        botDnsResults[threat.ipAddress]!.hostname ||
                                        botDnsResults[threat.ipAddress]!.verdict
                                      }
                                    >
                                      {botDnsResults[threat.ipAddress]!.verified
                                        ? `✓ Verified (${botDnsResults[threat.ipAddress]!.method})`
                                        : `✗ Spoofed (${botDnsResults[threat.ipAddress]!.method})`}
                                    </Badge>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={verifyingBotIp === threat.ipAddress}
                                      onClick={async () => {
                                        setVerifyingBotIp(threat.ipAddress);
                                        try {
                                          const res = await fetch("/api/dashboard/traffic/verify-bot", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                              ipAddress: threat.ipAddress,
                                              claimedBotName: threat.claimedBotName || "Googlebot",
                                              asnLabel: threat.asnLabel || "",
                                            }),
                                          });
                                          if (res.ok) {
                                            const data = await res.json();
                                            setBotDnsResults((prev) => ({
                                              ...prev,
                                              [threat.ipAddress]: data,
                                            }));
                                          }
                                        } finally {
                                          setVerifyingBotIp(null);
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 rounded border border-border bg-secondary/60 px-2 py-0.5 text-[10px] font-semibold hover:bg-secondary cursor-pointer"
                                    >
                                      {verifyingBotIp === threat.ipAddress
                                        ? "Checking..."
                                        : "🔍 Verify FCrDNS"}
                                    </button>
                                  )
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Generated Firewall Rules & Custom Ingest Box */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                      🛡️ Ready-to-Paste Nginx Block Configuration
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] font-mono">nginx.conf</Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Drop these statements into your server block to block all flagged credential stuffers and limit scrapers.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="rounded-lg bg-secondary/40 p-3 font-mono text-[11px] text-foreground overflow-x-auto max-h-[180px]">
                    {trafficData?.firewallRules?.nginxBlockRules || "# Run traffic cleaner to generate block rules"}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                    📥 Ingest Custom Server Access Logs
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Paste raw Nginx/Apache Combined Log lines to classify traffic and generate instant WAF rules.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <textarea
                    rows={4}
                    value={customLogsInput}
                    onChange={(e) => setCustomLogsInput(e.target.value)}
                    placeholder='185.220.101.5 - - [14/Nov/2026:22:15:30 +0000] "POST /wp-login.php HTTP/1.1" 401 1420 "https://example.com" "Mozilla/5.0..."'
                    className="w-full rounded-md border border-input bg-background p-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={async () => {
                        if (!customLogsInput.trim()) return;
                        const res = await fetch("/api/dashboard/traffic/ingest", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ logs: customLogsInput }),
                        });
                        if (res.ok) {
                          setTrafficData(await res.json());
                          setTrafficNotice("Custom server access logs analyzed and classified successfully!");
                          setTimeout(() => setTrafficNotice(""), 4000);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer"
                    >
                      🚀 Analyze &amp; Clean Logs
                    </button>
                  </div>
                </CardContent>
              </Card>
            </div>
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
