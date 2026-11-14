export interface OriginGeoInfo {
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
}

export interface RegionDefinition {
  regionCode: string;
  regionName: string;
  shortLabel: string;
  description: string;
  centerLat: number;
  centerLng: number;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}

export const WORLD_REGIONS: RegionDefinition[] = [
  {
    regionCode: "region_eastern_europe",
    regionName: "Eastern Europe",
    shortLabel: "E. Europe",
    description:
      "Monitors coordinated narrative farms, script brigades, and datacenter proxy relays originating across Russia, Belarus, and Eastern European transit nodes.",
    centerLat: 53,
    centerLng: 33,
    bounds: { minLat: 42, maxLat: 66, minLng: 18, maxLng: 58 },
  },
  {
    regionCode: "region_western_europe",
    regionName: "Western & Central Europe",
    shortLabel: "W. Europe",
    description:
      "Covers Tor exit nodes, European cloud VPS relays, and legitimate consumer traffic across Germany, the Netherlands, the UK, and Finland.",
    centerLat: 51,
    centerLng: 9,
    bounds: { minLat: 36, maxLat: 63, minLng: -10, maxLng: 28 },
  },
  {
    regionCode: "region_middle_east",
    regionName: "Middle East & Central Asia",
    shortLabel: "Middle East",
    description:
      "Tracks regional state-backed influence campaigns, disinformation amplification nodes, and VPN exit relays across Tehran and Istanbul.",
    centerLat: 36,
    centerLng: 44,
    bounds: { minLat: 15, maxLat: 45, minLng: 27, maxLng: 72 },
  },
  {
    regionCode: "region_east_asia",
    regionName: "East & Southeast Asia",
    shortLabel: "East Asia",
    description:
      "Scans automated review-manipulation farms, datacenter scraping proxies, and APAC cloud endpoints across Shenzhen and Singapore.",
    centerLat: 18,
    centerLng: 112,
    bounds: { minLat: -5, maxLat: 48, minLng: 92, maxLng: 145 },
  },
  {
    regionCode: "region_north_america",
    regionName: "North America",
    shortLabel: "N. America",
    description:
      "Monitors North American customer traffic, political framing narratives, and spoofed residential proxies centered around US East & West hubs.",
    centerLat: 39,
    centerLng: -96,
    bounds: { minLat: 18, maxLat: 60, minLng: -130, maxLng: -62 },
  },
  {
    regionCode: "region_south_america",
    regionName: "South America",
    shortLabel: "S. America",
    description:
      "Detects compromised residential botnet proxies and automated forex/crypto spam bursts originating across Brazilian and LATAM ISP blocks.",
    centerLat: -16,
    centerLng: -55,
    bounds: { minLat: -54, maxLat: 12, minLng: -82, maxLng: -34 },
  },
];

interface GeoHubTemplate {
  countryCode: string;
  countryName: string;
  regionCode: string;
  region: string;
  city: string;
  lat: number;
  lng: number;
  networkType: string;
  asnLabel: string;
  defaultIp: string;
}

const GEO_HUBS: Record<string, GeoHubTemplate> = {
  RU_MSK: {
    countryCode: "RU",
    countryName: "Russia",
    regionCode: "region_eastern_europe",
    region: "Eastern Europe",
    city: "Moscow",
    lat: 55.7558,
    lng: 37.6173,
    networkType: "state_backbone_relay",
    asnLabel: "AS12389 Rostelecom Relay",
    defaultIp: "91.132.147.88",
  },
  RU_LED: {
    countryCode: "RU",
    countryName: "Russia",
    regionCode: "region_eastern_europe",
    region: "Eastern Europe",
    city: "St. Petersburg",
    lat: 59.9311,
    lng: 30.3609,
    networkType: "datacenter_proxy",
    asnLabel: "AS49505 Selectel Hosting",
    defaultIp: "95.161.224.14",
  },
  BY_MSQ: {
    countryCode: "BY",
    countryName: "Belarus",
    regionCode: "region_eastern_europe",
    region: "Eastern Europe",
    city: "Minsk",
    lat: 53.9006,
    lng: 27.559,
    networkType: "state_backbone_relay",
    asnLabel: "AS6697 Beltelecom Hub",
    defaultIp: "178.124.139.42",
  },
  RO_BUH: {
    countryCode: "RO",
    countryName: "Romania",
    regionCode: "region_eastern_europe",
    region: "Eastern Europe",
    city: "Bucharest",
    lat: 44.4268,
    lng: 26.1025,
    networkType: "datacenter_proxy",
    asnLabel: "AS9009 M247 Europe",
    defaultIp: "194.26.135.71",
  },
  DE_FRA: {
    countryCode: "DE",
    countryName: "Germany",
    regionCode: "region_western_europe",
    region: "Western & Central Europe",
    city: "Frankfurt",
    lat: 50.1109,
    lng: 8.6821,
    networkType: "tor_exit_node",
    asnLabel: "AS24940 Hetzner / Tor Exit",
    defaultIp: "185.220.101.44",
  },
  NL_AMS: {
    countryCode: "NL",
    countryName: "Netherlands",
    regionCode: "region_western_europe",
    region: "Western & Central Europe",
    city: "Amsterdam",
    lat: 52.3676,
    lng: 4.9041,
    networkType: "bulletproof_vps",
    asnLabel: "AS20473 Choopa Cloud Relay",
    defaultIp: "45.155.205.19",
  },
  FI_HEL: {
    countryCode: "FI",
    countryName: "Finland",
    regionCode: "region_western_europe",
    region: "Western & Central Europe",
    city: "Helsinki",
    lat: 60.1699,
    lng: 24.9384,
    networkType: "residential_isp",
    asnLabel: "AS6667 Elisa Residential",
    defaultIp: "88.114.202.19",
  },
  GB_LON: {
    countryCode: "GB",
    countryName: "United Kingdom",
    regionCode: "region_western_europe",
    region: "Western & Central Europe",
    city: "London",
    lat: 51.5072,
    lng: -0.1276,
    networkType: "residential_isp",
    asnLabel: "AS2856 BT Broadband",
    defaultIp: "86.142.81.64",
  },
  IR_THR: {
    countryCode: "IR",
    countryName: "Iran",
    regionCode: "region_middle_east",
    region: "Middle East & Central Asia",
    city: "Tehran",
    lat: 35.6892,
    lng: 51.389,
    networkType: "state_backbone_relay",
    asnLabel: "AS48159 TIC Autonomous Node",
    defaultIp: "5.160.247.33",
  },
  TR_IST: {
    countryCode: "TR",
    countryName: "Turkey",
    regionCode: "region_middle_east",
    region: "Middle East & Central Asia",
    city: "Istanbul",
    lat: 41.0082,
    lng: 28.9784,
    networkType: "vpn_exit_relay",
    asnLabel: "AS16135 Turkcell Exit",
    defaultIp: "88.247.110.18",
  },
  CN_SZX: {
    countryCode: "CN",
    countryName: "China",
    regionCode: "region_east_asia",
    region: "East & Southeast Asia",
    city: "Shenzhen",
    lat: 22.5431,
    lng: 114.0579,
    networkType: "datacenter_proxy",
    asnLabel: "AS4134 Chinanet Backbone",
    defaultIp: "103.149.93.21",
  },
  SG_SIN: {
    countryCode: "SG",
    countryName: "Singapore",
    regionCode: "region_east_asia",
    region: "East & Southeast Asia",
    city: "Singapore",
    lat: 1.3521,
    lng: 103.8198,
    networkType: "cloud_vps_cluster",
    asnLabel: "AS16509 APAC Edge Relay",
    defaultIp: "13.212.84.105",
  },
  US_IAD: {
    countryCode: "US",
    countryName: "United States",
    regionCode: "region_north_america",
    region: "North America",
    city: "Ashburn",
    lat: 39.0438,
    lng: -77.4874,
    networkType: "residential_isp",
    asnLabel: "AS7922 Comcast Cable / US East",
    defaultIp: "73.162.48.210",
  },
  US_LAX: {
    countryCode: "US",
    countryName: "United States",
    regionCode: "region_north_america",
    region: "North America",
    city: "Los Angeles",
    lat: 34.0522,
    lng: -118.2437,
    networkType: "cloud_vps_cluster",
    asnLabel: "AS398101 Tier-2 VPS Relay",
    defaultIp: "104.244.76.19",
  },
  BR_GRU: {
    countryCode: "BR",
    countryName: "Brazil",
    regionCode: "region_south_america",
    region: "South America",
    city: "São Paulo",
    lat: -23.5505,
    lng: -46.6333,
    networkType: "botnet_residential_proxy",
    asnLabel: "AS28573 Claro Residential Proxy",
    defaultIp: "177.54.145.62",
  },
};

const IP_PREFIX_MAP: Array<{ prefix: string; hubKey: keyof typeof GEO_HUBS }> = [
  { prefix: "185.220.101.", hubKey: "DE_FRA" },
  { prefix: "91.132.147.", hubKey: "RU_MSK" },
  { prefix: "95.161.224.", hubKey: "RU_LED" },
  { prefix: "178.124.139.", hubKey: "BY_MSQ" },
  { prefix: "45.155.205.", hubKey: "NL_AMS" },
  { prefix: "194.26.135.", hubKey: "RO_BUH" },
  { prefix: "103.149.93.", hubKey: "CN_SZX" },
  { prefix: "5.160.247.", hubKey: "IR_THR" },
  { prefix: "177.54.145.", hubKey: "BR_GRU" },
  { prefix: "104.244.76.", hubKey: "US_LAX" },
  { prefix: "88.247.110.", hubKey: "TR_IST" },
  { prefix: "88.114.202.", hubKey: "FI_HEL" },
  { prefix: "86.142.81.", hubKey: "GB_LON" },
  { prefix: "73.162.48.", hubKey: "US_IAD" },
  { prefix: "13.212.84.", hubKey: "SG_SIN" },
];

const HASH_ORIGIN_MAP: Record<
  string,
  { hubKey: keyof typeof GEO_HUBS; networkOverride?: string; asnOverride?: string }
> = {
  hum_31a8f002: { hubKey: "RU_LED" },
  hum_62c1d440: { hubKey: "BY_MSQ" },
  hum_19b7e211: { hubKey: "US_IAD" },
  hum_55d9a834: { hubKey: "GB_LON" },
  hum_81f2c905: { hubKey: "FI_HEL" },
  hum_70a3b118: { hubKey: "US_IAD" },
  hum_92e4d710: {
    hubKey: "DE_FRA",
    networkOverride: "residential_isp",
    asnOverride: "AS3320 Deutsche Telekom",
  },
  hum_14c8a331: {
    hubKey: "SG_SIN",
    networkOverride: "residential_isp",
    asnOverride: "AS3758 Singtel Fiber",
  },
  hum_41e7b908: { hubKey: "IR_THR" },
  hum_73f9a112: { hubKey: "CN_SZX" },
  hum_85d2c409: { hubKey: "TR_IST" },
};

const COUNTRY_CODE_TO_HUB: Record<string, keyof typeof GEO_HUBS> = {
  RU: "RU_MSK",
  BY: "BY_MSQ",
  RO: "RO_BUH",
  DE: "DE_FRA",
  NL: "NL_AMS",
  FI: "FI_HEL",
  GB: "GB_LON",
  IR: "IR_THR",
  TR: "TR_IST",
  CN: "CN_SZX",
  SG: "SG_SIN",
  US: "US_IAD",
  BR: "BR_GRU",
};

function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isLocalOrPrivateIp(ip: string): boolean {
  if (!ip) return true;
  const trimmed = ip.trim().toLowerCase();
  return (
    trimmed === "" ||
    trimmed === "127.0.0.1" ||
    trimmed === "::1" ||
    trimmed === "localhost" ||
    trimmed === "0.0.0.0" ||
    trimmed === "unknown" ||
    trimmed.startsWith("10.") ||
    trimmed.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(trimmed) ||
    trimmed.startsWith("fc00:") ||
    trimmed.startsWith("fe80:")
  );
}

/**
 * Resolves origin country, macro-region, city coordinates, and network type
 * for any submission or bot telemetry record.
 */
export function resolveOriginGeo(params: {
  ipAddress?: string | null;
  authorSessionHash?: string | null;
  wpCommentId?: number;
  countryHeader?: string | null;
  authorType?: "human" | "bot";
}): OriginGeoInfo {
  const cleanIp = (params.ipAddress || "").trim();
  const rawHash = (params.authorSessionHash || "").trim();
  const isSeed = rawHash.startsWith("seed_demo_");
  const cleanHash = rawHash.replace(/^seed_demo_/, "").trim();
  const upperCountry = (params.countryHeader || "").trim().toUpperCase();

  // 1. Explicit country header (e.g., Cloudflare CF-IPCountry or X-Country-Code)
  if (upperCountry && upperCountry in COUNTRY_CODE_TO_HUB) {
    const hub = GEO_HUBS[COUNTRY_CODE_TO_HUB[upperCountry]!]!;
    return {
      countryCode: hub.countryCode,
      countryName: hub.countryName,
      region: hub.region,
      regionCode: hub.regionCode,
      city: hub.city,
      lat: hub.lat,
      lng: hub.lng,
      ipAddress: cleanIp && cleanIp !== "127.0.0.1" ? cleanIp : hub.defaultIp,
      networkType: hub.networkType,
      asnLabel: hub.asnLabel,
    };
  }

  // 2. Match known relay / honeypot IP prefixes (real public IP blocks only)
  if (cleanIp && !isLocalOrPrivateIp(cleanIp)) {
    const matched = IP_PREFIX_MAP.find((m) => cleanIp.startsWith(m.prefix));
    if (matched) {
      const hub = GEO_HUBS[matched.hubKey]!;
      return {
        countryCode: hub.countryCode,
        countryName: hub.countryName,
        region: hub.region,
        regionCode: hub.regionCode,
        city: hub.city,
        lat: hub.lat,
        lng: hub.lng,
        ipAddress: cleanIp,
        networkType: hub.networkType,
        asnLabel: hub.asnLabel,
      };
    }
  }

  // 3. Match known seed session hashes (ONLY for seeded demo fixtures)
  if (isSeed && cleanHash in HASH_ORIGIN_MAP) {
    const spec = HASH_ORIGIN_MAP[cleanHash]!;
    const hub = GEO_HUBS[spec.hubKey]!;
    return {
      countryCode: hub.countryCode,
      countryName: hub.countryName,
      region: hub.region,
      regionCode: hub.regionCode,
      city: hub.city,
      lat: hub.lat,
      lng: hub.lng,
      ipAddress: cleanIp && !isLocalOrPrivateIp(cleanIp) ? cleanIp : hub.defaultIp,
      networkType: spec.networkOverride || hub.networkType,
      asnLabel: spec.asnOverride || hub.asnLabel,
    };
  }

  // 4. Localhost / internal private networks: never fabricate foreign countries
  if (isLocalOrPrivateIp(cleanIp) && !isSeed) {
    return {
      countryCode: "LOCAL",
      countryName: "Localhost / Internal",
      region: "Western & Central Europe",
      regionCode: "region_western_europe",
      city: "Localhost",
      lat: 51.5074,
      lng: 0.1278,
      ipAddress: cleanIp || "127.0.0.1",
      networkType: "internal_loopback",
      asnLabel: "Local Development / Internal Network",
    };
  }

  // 5. Seed fixture fallback (ONLY for explicitly seeded demo data with seed_demo_ prefix)
  if (isSeed) {
    const hubKeys =
      params.authorType === "bot"
        ? (["RU_MSK", "DE_FRA", "NL_AMS", "RO_BUH", "CN_SZX", "BR_GRU"] as const)
        : (["RU_LED", "IR_THR", "US_IAD", "GB_LON", "FI_HEL", "SG_SIN"] as const);
    const seedKey = `${cleanIp}|${cleanHash}|${params.wpCommentId || 0}`;
    const chosenKey = hubKeys[stableHash(seedKey) % hubKeys.length]!;
    const hub = GEO_HUBS[chosenKey]!;
    return {
      countryCode: hub.countryCode,
      countryName: hub.countryName,
      region: hub.region,
      regionCode: hub.regionCode,
      city: hub.city,
      lat: hub.lat,
      lng: hub.lng,
      ipAddress: cleanIp && !isLocalOrPrivateIp(cleanIp) ? cleanIp : hub.defaultIp,
      networkType: hub.networkType,
      asnLabel: hub.asnLabel,
    };
  }

  // 6. Real unclassified traffic without geo headers
  return {
    countryCode: "UNKNOWN",
    countryName: "Direct / Unclassified",
    region: "Western & Central Europe",
    regionCode: "region_western_europe",
    city: "Direct IP",
    lat: 51.5074,
    lng: 0.1278,
    ipAddress: cleanIp || "unknown",
    networkType: "direct_traffic",
    asnLabel: "Direct / Unclassified Network",
  };
}

export interface GeoAggregatableItem {
  authorType: "human" | "bot";
  visibility: string;
  routingPath: string;
  riskScore: number;
  failedRiskIds: string[];
  origin: OriginGeoInfo;
}

export type RegionalThreatLevel = "critical" | "elevated" | "moderate" | "low";

function computeThreatLevel(propagandaCount: number, botCount: number): RegionalThreatLevel {
  const combined = propagandaCount * 2 + botCount;
  if (propagandaCount >= 2 || combined >= 5) return "critical";
  if (propagandaCount >= 1 || combined >= 2) return "elevated";
  if (botCount >= 1) return "moderate";
  return "low";
}

function isPropagandaItem(item: GeoAggregatableItem): boolean {
  return (
    item.visibility === "public_flagged" ||
    item.routingPath === "ROUTE_4_FORENSIC_THREAT"
  );
}

export interface RegionalScanSummary {
  totalAnalyzed: number;
  totalPropaganda: number;
  totalBots: number;
  totalHumanClean: number;
  activeCountriesCount: number;
  activeRegionsCount: number;
  regions: Array<{
    regionCode: string;
    regionName: string;
    shortLabel: string;
    description: string;
    centerLat: number;
    centerLng: number;
    bounds: RegionDefinition["bounds"];
    totalCount: number;
    propagandaCount: number;
    botCount: number;
    humanCleanCount: number;
    threatCount: number;
    avgRiskScore: number;
    threatLevel: RegionalThreatLevel;
    topCountries: Array<{
      countryCode: string;
      countryName: string;
      totalCount: number;
      propagandaCount: number;
      botCount: number;
    }>;
    topFlags: Array<{ id: string; count: number }>;
    networkTypes: Array<{ networkType: string; count: number }>;
  }>;
  countries: Array<{
    countryCode: string;
    countryName: string;
    regionCode: string;
    region: string;
    totalCount: number;
    propagandaCount: number;
    botCount: number;
    humanCleanCount: number;
    threatCount: number;
    avgRiskScore: number;
    threatLevel: RegionalThreatLevel;
    cities: string[];
    topFlags: Array<{ id: string; count: number }>;
    networkTypes: Array<{ networkType: string; count: number }>;
  }>;
  hotspots: Array<{
    id: string;
    city: string;
    countryCode: string;
    countryName: string;
    regionCode: string;
    region: string;
    lat: number;
    lng: number;
    totalCount: number;
    propagandaCount: number;
    botCount: number;
    humanCleanCount: number;
    threatCount: number;
    avgRiskScore: number;
    dominantKind: "propaganda" | "bot" | "human";
    sampleIps: string[];
    networkTypes: string[];
    topFlags: Array<{ id: string; count: number }>;
  }>;
}

export function buildRegionalScanSummary(items: GeoAggregatableItem[]): RegionalScanSummary {
  let totalPropaganda = 0;
  let totalBots = 0;
  let totalHumanClean = 0;

  type BucketAcc = {
    totalCount: number;
    propagandaCount: number;
    botCount: number;
    humanCleanCount: number;
    riskSum: number;
    flagMap: Map<string, number>;
    netMap: Map<string, number>;
  };

  const makeAcc = (): BucketAcc => ({
    totalCount: 0,
    propagandaCount: 0,
    botCount: 0,
    humanCleanCount: 0,
    riskSum: 0,
    flagMap: new Map(),
    netMap: new Map(),
  });

  const regionMap = new Map<string, BucketAcc & { countryMap: Map<string, { countryCode: string; countryName: string; totalCount: number; propagandaCount: number; botCount: number }> }>();
  for (const r of WORLD_REGIONS) {
    regionMap.set(r.regionCode, { ...makeAcc(), countryMap: new Map() });
  }

  const countryMap = new Map<
    string,
    BucketAcc & {
      countryCode: string;
      countryName: string;
      regionCode: string;
      region: string;
      cities: Set<string>;
    }
  >();

  const hotspotMap = new Map<
    string,
    BucketAcc & {
      id: string;
      city: string;
      countryCode: string;
      countryName: string;
      regionCode: string;
      region: string;
      lat: number;
      lng: number;
      ips: Set<string>;
    }
  >();

  for (const item of items) {
    const origin = item.origin;
    const isProp = isPropagandaItem(item);
    const isBot = item.authorType === "bot";
    const isCleanHuman = !isBot && !isProp;

    if (isProp) totalPropaganda++;
    if (isBot) totalBots++;
    if (isCleanHuman) totalHumanClean++;

    const applyToAcc = (acc: BucketAcc) => {
      acc.totalCount++;
      if (isProp) acc.propagandaCount++;
      if (isBot) acc.botCount++;
      if (isCleanHuman) acc.humanCleanCount++;
      acc.riskSum += item.riskScore || 0;
      for (const fId of item.failedRiskIds || []) {
        acc.flagMap.set(fId, (acc.flagMap.get(fId) || 0) + 1);
      }
      if (origin.networkType) {
        acc.netMap.set(origin.networkType, (acc.netMap.get(origin.networkType) || 0) + 1);
      }
    };

    // Region bucket
    let rAcc = regionMap.get(origin.regionCode);
    if (!rAcc) {
      rAcc = { ...makeAcc(), countryMap: new Map() };
      regionMap.set(origin.regionCode, rAcc);
    }
    applyToAcc(rAcc);
    const cInRegion = rAcc.countryMap.get(origin.countryCode) || {
      countryCode: origin.countryCode,
      countryName: origin.countryName,
      totalCount: 0,
      propagandaCount: 0,
      botCount: 0,
    };
    cInRegion.totalCount++;
    if (isProp) cInRegion.propagandaCount++;
    if (isBot) cInRegion.botCount++;
    rAcc.countryMap.set(origin.countryCode, cInRegion);

    // Country bucket
    let cAcc = countryMap.get(origin.countryCode);
    if (!cAcc) {
      cAcc = {
        ...makeAcc(),
        countryCode: origin.countryCode,
        countryName: origin.countryName,
        regionCode: origin.regionCode,
        region: origin.region,
        cities: new Set(),
      };
      countryMap.set(origin.countryCode, cAcc);
    }
    applyToAcc(cAcc);
    cAcc.cities.add(origin.city);

    // City hotspot bucket
    const hotspotId = `${origin.countryCode}_${origin.city.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    let hAcc = hotspotMap.get(hotspotId);
    if (!hAcc) {
      hAcc = {
        ...makeAcc(),
        id: hotspotId,
        city: origin.city,
        countryCode: origin.countryCode,
        countryName: origin.countryName,
        regionCode: origin.regionCode,
        region: origin.region,
        lat: origin.lat,
        lng: origin.lng,
        ips: new Set(),
      };
      hotspotMap.set(hotspotId, hAcc);
    }
    applyToAcc(hAcc);
    if (origin.ipAddress) hAcc.ips.add(origin.ipAddress);
  }

  const sortFlags = (flagMap: Map<string, number>) =>
    Array.from(flagMap.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

  const sortNets = (netMap: Map<string, number>) =>
    Array.from(netMap.entries())
      .map(([networkType, count]) => ({ networkType, count }))
      .sort((a, b) => b.count - a.count);

  const regions = WORLD_REGIONS.map((def) => {
    const acc = regionMap.get(def.regionCode)!;
    const threatCount = acc.propagandaCount + acc.botCount;
    return {
      ...def,
      totalCount: acc.totalCount,
      propagandaCount: acc.propagandaCount,
      botCount: acc.botCount,
      humanCleanCount: acc.humanCleanCount,
      threatCount,
      avgRiskScore: acc.totalCount > 0 ? Number((acc.riskSum / acc.totalCount).toFixed(1)) : 0,
      threatLevel: computeThreatLevel(acc.propagandaCount, acc.botCount),
      topCountries: Array.from(acc.countryMap.values()).sort(
        (a, b) => b.propagandaCount * 2 + b.botCount - (a.propagandaCount * 2 + a.botCount) || b.totalCount - a.totalCount
      ),
      topFlags: sortFlags(acc.flagMap),
      networkTypes: sortNets(acc.netMap),
    };
  }).sort(
    (a, b) =>
      b.propagandaCount * 2 + b.botCount - (a.propagandaCount * 2 + a.botCount) ||
      b.totalCount - a.totalCount
  );

  const countries = Array.from(countryMap.values())
    .map((c) => {
      const threatCount = c.propagandaCount + c.botCount;
      return {
        countryCode: c.countryCode,
        countryName: c.countryName,
        regionCode: c.regionCode,
        region: c.region,
        totalCount: c.totalCount,
        propagandaCount: c.propagandaCount,
        botCount: c.botCount,
        humanCleanCount: c.humanCleanCount,
        threatCount,
        avgRiskScore: c.totalCount > 0 ? Number((c.riskSum / c.totalCount).toFixed(1)) : 0,
        threatLevel: computeThreatLevel(c.propagandaCount, c.botCount),
        cities: Array.from(c.cities),
        topFlags: sortFlags(c.flagMap),
        networkTypes: sortNets(c.netMap),
      };
    })
    .sort(
      (a, b) =>
        b.propagandaCount * 2 + b.botCount - (a.propagandaCount * 2 + a.botCount) ||
        b.totalCount - a.totalCount
    );

  const hotspots = Array.from(hotspotMap.values())
    .map((h) => {
      const threatCount = h.propagandaCount + h.botCount;
      const dominantKind: "propaganda" | "bot" | "human" =
        h.propagandaCount > 0 && h.propagandaCount >= h.botCount
          ? "propaganda"
          : h.botCount > 0
            ? "bot"
            : h.propagandaCount > 0
              ? "propaganda"
              : "human";
      return {
        id: h.id,
        city: h.city,
        countryCode: h.countryCode,
        countryName: h.countryName,
        regionCode: h.regionCode,
        region: h.region,
        lat: h.lat,
        lng: h.lng,
        totalCount: h.totalCount,
        propagandaCount: h.propagandaCount,
        botCount: h.botCount,
        humanCleanCount: h.humanCleanCount,
        threatCount,
        avgRiskScore: h.totalCount > 0 ? Number((h.riskSum / h.totalCount).toFixed(1)) : 0,
        dominantKind,
        sampleIps: Array.from(h.ips).slice(0, 3),
        networkTypes: sortNets(h.netMap).map((n) => n.networkType),
        topFlags: sortFlags(h.flagMap),
      };
    })
    .sort((a, b) => b.threatCount - a.threatCount || b.totalCount - a.totalCount);

  return {
    totalAnalyzed: items.length,
    totalPropaganda,
    totalBots,
    totalHumanClean,
    activeCountriesCount: countries.length,
    activeRegionsCount: regions.filter((r) => r.totalCount > 0).length,
    regions,
    countries,
    hotspots,
  };
}
