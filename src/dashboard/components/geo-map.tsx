import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  ToggleGroup,
  ToggleGroupItem,
  Progress,
  HoverExplanation,
  IconGlobe,
} from "./ui";
import { getTagExplanation, humanizeKey } from "../glossary";

export type ThreatLayerMode = "threats" | "propaganda" | "bots" | "all";

export interface GeoSummaryData {
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
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    totalCount: number;
    propagandaCount: number;
    botCount: number;
    humanCleanCount: number;
    threatCount: number;
    avgRiskScore: number;
    threatLevel: "critical" | "elevated" | "moderate" | "low";
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
    threatLevel: "critical" | "elevated" | "moderate" | "low";
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

const WORLD_GEOJSON_URL =
  "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";

const REGION_VIEWPORTS: Record<string, { lat: number; lng: number; zoom: number }> = {
  all: { lat: 51, lng: 18, zoom: 4 },
  region_eastern_europe: { lat: 54, lng: 36, zoom: 4 },
  region_western_europe: { lat: 51, lng: 8, zoom: 4 },
  region_middle_east: { lat: 32, lng: 46, zoom: 4 },
  region_east_asia: { lat: 22, lng: 110, zoom: 3 },
  region_north_america: { lat: 39, lng: -97, zoom: 3 },
  region_south_america: { lat: -18, lng: -58, zoom: 3 },
};

const COUNTRY_FOCUS_COORDS: Record<string, { lat: number; lng: number; zoom: number }> = {
  RU: { lat: 57.5, lng: 42, zoom: 4 },
  US: { lat: 38.5, lng: -96, zoom: 4 },
  CA: { lat: 56, lng: -98, zoom: 3 },
  CN: { lat: 32, lng: 106, zoom: 4 },
  BR: { lat: -15, lng: -51, zoom: 4 },
  DE: { lat: 51.1, lng: 10.4, zoom: 5 },
  NL: { lat: 52.2, lng: 5.3, zoom: 6 },
  GB: { lat: 54, lng: -2, zoom: 5 },
  FR: { lat: 46.6, lng: 2.4, zoom: 5 },
  FI: { lat: 62.5, lng: 26, zoom: 5 },
  BY: { lat: 53.7, lng: 28, zoom: 6 },
  RO: { lat: 45.9, lng: 25, zoom: 6 },
  IR: { lat: 32.8, lng: 53.6, zoom: 5 },
  TR: { lat: 39, lng: 35.2, zoom: 5 },
  SG: { lat: 1.35, lng: 103.82, zoom: 9 },
  UA: { lat: 49, lng: 31.4, zoom: 5 },
  PL: { lat: 52, lng: 19.4, zoom: 5 },
};

const ISO3_TO_ISO2: Record<string, string> = {
  AFG: "AF", AGO: "AO", ALB: "AL", AND: "AD", ARE: "AE", ARG: "AR", ARM: "AM",
  AUS: "AU", AUT: "AT", AZE: "AZ", BDI: "BI", BEL: "BE", BEN: "BJ", BFA: "BF",
  BGD: "BD", BGR: "BG", BHR: "BH", BHS: "BS", BIH: "BA", BLR: "BY", BLZ: "BZ",
  BOL: "BO", BRA: "BR", BRN: "BN", BTN: "BT", BWA: "BW", CAF: "CF", CAN: "CA",
  CHE: "CH", CHL: "CL", CHN: "CN", CIV: "CI", CMR: "CM", COD: "CD", COG: "CG",
  COL: "CO", CRI: "CR", CUB: "CU", CYP: "CY", CZE: "CZ", DEU: "DE", DJI: "DJ",
  DNK: "DK", DOM: "DO", DZA: "DZ", ECU: "EC", EGY: "EG", ERI: "ER", ESP: "ES",
  EST: "EE", ETH: "ET", FIN: "FI", FJI: "FJ", FRA: "FR", GAB: "GA", GBR: "GB",
  GEO: "GE", GHA: "GH", GIN: "GN", GMB: "GM", GNB: "GW", GNQ: "GQ", GRC: "GR",
  GRL: "GL", GTM: "GT", GUY: "GY", HND: "HN", HRV: "HR", HTI: "HT", HUN: "HU",
  IDN: "ID", IND: "IN", IRL: "IE", IRN: "IR", IRQ: "IQ", ISL: "IS", ISR: "IL",
  ITA: "IT", JAM: "JM", JOR: "JO", JPN: "JP", KAZ: "KZ", KEN: "KE", KGZ: "KG",
  KHM: "KH", KOR: "KR", KWT: "KW", LAO: "LA", LBN: "LB", LBR: "LR", LBY: "LY",
  LKA: "LK", LSO: "LS", LTU: "LT", LUX: "LU", LVA: "LV", MAR: "MA", MDA: "MD",
  MDG: "MG", MEX: "MX", MKD: "MK", MLI: "ML", MMR: "MM", MNE: "ME", MNG: "MN",
  MOZ: "MZ", MRT: "MR", MWI: "MW", MYS: "MY", NAM: "NA", NER: "NE", NGA: "NG",
  NIC: "NI", NLD: "NL", NOR: "NO", NPL: "NP", NZL: "NZ", OMN: "OM", PAK: "PK",
  PAN: "PA", PER: "PE", PHL: "PH", PNG: "PG", POL: "PL", PRI: "PR", PRK: "KP",
  PRT: "PT", PRY: "PY", PSE: "PS", QAT: "QA", ROU: "RO", RUS: "RU", RWA: "RW",
  SAU: "SA", SDN: "SD", SEN: "SN", SGP: "SG", SLE: "SL", SLV: "SV", SOM: "SO",
  SRB: "RS", SSD: "SS", SUR: "SR", SVK: "SK", SVN: "SI", SWE: "SE", SWZ: "SZ",
  SYR: "SY", TCD: "TD", TGO: "TG", THA: "TH", TJK: "TJ", TKM: "TM", TLS: "TL",
  TUN: "TN", TUR: "TR", TWN: "TW", TZA: "TZ", UGA: "UG", UKR: "UA", URY: "UY",
  USA: "US", UZB: "UZ", VEN: "VE", VNM: "VN", VUT: "VU", YEM: "YE", ZAF: "ZA",
  ZMB: "ZM", ZWE: "ZW", SDS: "SS", KOS: "XK",
};

const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  "united states of america": "US",
  "united states": "US",
  usa: "US",
  russia: "RU",
  "russian federation": "RU",
  england: "GB",
  "united kingdom": "GB",
  germany: "DE",
  netherlands: "NL",
  finland: "FI",
  belarus: "BY",
  romania: "RO",
  iran: "IR",
  turkey: "TR",
  singapore: "SG",
  china: "CN",
  brazil: "BR",
  canada: "CA",
  ukraine: "UA",
  poland: "PL",
  france: "FR",
  "republic of serbia": "RS",
  "south korea": "KR",
};

const COUNTRY_TO_REGION_FALLBACK: Record<string, string> = {
  RU: "region_eastern_europe",
  BY: "region_eastern_europe",
  RO: "region_eastern_europe",
  FI: "region_eastern_europe",
  UA: "region_eastern_europe",
  PL: "region_eastern_europe",
  EE: "region_eastern_europe",
  LV: "region_eastern_europe",
  LT: "region_eastern_europe",
  BG: "region_eastern_europe",
  MD: "region_eastern_europe",
  DE: "region_western_europe",
  NL: "region_western_europe",
  GB: "region_western_europe",
  FR: "region_western_europe",
  BE: "region_western_europe",
  ES: "region_western_europe",
  IT: "region_western_europe",
  CH: "region_western_europe",
  SE: "region_western_europe",
  NO: "region_western_europe",
  DK: "region_western_europe",
  AT: "region_western_europe",
  IE: "region_western_europe",
  PT: "region_western_europe",
  IR: "region_middle_east",
  TR: "region_middle_east",
  SA: "region_middle_east",
  AE: "region_middle_east",
  IL: "region_middle_east",
  IQ: "region_middle_east",
  EG: "region_middle_east",
  JO: "region_middle_east",
  SY: "region_middle_east",
  CN: "region_east_asia",
  SG: "region_east_asia",
  JP: "region_east_asia",
  KR: "region_east_asia",
  TW: "region_east_asia",
  VN: "region_east_asia",
  TH: "region_east_asia",
  ID: "region_east_asia",
  MY: "region_east_asia",
  PH: "region_east_asia",
  IN: "region_east_asia",
  AU: "region_east_asia",
  US: "region_north_america",
  CA: "region_north_america",
  MX: "region_north_america",
  BR: "region_south_america",
  AR: "region_south_america",
  CL: "region_south_america",
  CO: "region_south_america",
  PE: "region_south_america",
};

let cachedWorldGeoJsonPromise: Promise<any | null> | null = null;

function loadWorldGeoJson(): Promise<any | null> {
  if (!cachedWorldGeoJsonPromise) {
    cachedWorldGeoJsonPromise = fetch(WORLD_GEOJSON_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .catch(() => null);
  }
  return cachedWorldGeoJsonPromise;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveFeatureIso2(
  feature: any,
  dynamicNameMap: Map<string, string>
): string {
  const idStr = typeof feature?.id === "string" ? feature.id.toUpperCase() : "";
  if (idStr && ISO3_TO_ISO2[idStr]) return ISO3_TO_ISO2[idStr];
  if (idStr.length === 2 && idStr !== "-9") return idStr;

  const isoA2 =
    typeof feature?.properties?.iso_a2 === "string"
      ? feature.properties.iso_a2.toUpperCase()
      : "";
  if (isoA2 && isoA2 !== "-99") return isoA2;

  const isoA3 =
    typeof feature?.properties?.iso_a3 === "string"
      ? feature.properties.iso_a3.toUpperCase()
      : "";
  if (isoA3 && ISO3_TO_ISO2[isoA3]) return ISO3_TO_ISO2[isoA3];

  const propName = String(feature?.properties?.name || "").trim();
  const lowerName = propName.toLowerCase();
  if (lowerName && dynamicNameMap.has(lowerName)) {
    return dynamicNameMap.get(lowerName)!;
  }
  if (lowerName && COUNTRY_NAME_TO_ISO2[lowerName]) {
    return COUNTRY_NAME_TO_ISO2[lowerName];
  }

  return idStr || propName.slice(0, 2).toUpperCase() || "XX";
}

function threatBadgeVariant(level: "critical" | "elevated" | "moderate" | "low") {
  if (level === "critical") return "destructive";
  if (level === "elevated") return "warning";
  if (level === "moderate") return "info";
  return "success";
}

function threatLevelLabel(level: "critical" | "elevated" | "moderate" | "low") {
  if (level === "critical") return "Critical Propaganda Activity";
  if (level === "elevated") return "Elevated Threat Activity";
  if (level === "moderate") return "Moderate Bot Activity";
  return "Low Risk Baseline";
}

export function GlobalOriginMap({
  geography,
  selectedRegion,
  onSelectRegion,
  selectedCountry,
  onSelectCountry,
  compact = false,
  onOpenFullMap,
  onOpenSearchForLocation,
}: {
  geography?: GeoSummaryData | null;
  selectedRegion: string;
  onSelectRegion: (regionCode: string) => void;
  selectedCountry: string;
  onSelectCountry: (countryCode: string) => void;
  compact?: boolean;
  onOpenFullMap?: () => void;
  onOpenSearchForLocation?: (tag: string) => void;
}) {
  const [layer, setLayer] = useState<ThreatLayerMode>("threats");
  const [hoveredCountry, setHoveredCountry] = useState<{
    code: string;
    name: string;
  } | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(compact ? 3.5 : 4);
  const [geoLoaded, setGeoLoaded] = useState<boolean>(false);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : true
  );

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const geoJsonLayerRef = useRef<any>(null);
  const featureLayersByCodeRef = useRef<Map<string, any[]>>(new Map());
  const markersLayerRef = useRef<any>(null);
  const prevViewportKeyRef = useRef<string>("");

  const regions = geography?.regions || [];
  const countries = geography?.countries || [];
  const hotspots = geography?.hotspots || [];

  const countryStatsMap = useMemo(() => {
    const map = new Map<string, GeoSummaryData["countries"][number]>();
    for (const c of countries) map.set(c.countryCode, c);
    return map;
  }, [countries]);

  const countryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of countries) {
      map.set(c.countryName.toLowerCase(), c.countryCode);
    }
    return map;
  }, [countries]);

  const activeRegionObj = useMemo(
    () => regions.find((r) => r.regionCode === selectedRegion) || null,
    [regions, selectedRegion]
  );

  const scopedCountries = useMemo(() => {
    if (selectedRegion === "all") return countries;
    return countries.filter((c) => c.regionCode === selectedRegion);
  }, [countries, selectedRegion]);

  const filteredHotspots = useMemo(() => {
    return hotspots
      .map((spot) => {
        let count = spot.threatCount;
        if (layer === "propaganda") count = spot.propagandaCount;
        else if (layer === "bots") count = spot.botCount;
        else if (layer === "all") count = spot.totalCount;
        return { ...spot, layerCount: count };
      })
      .filter((spot) => spot.layerCount > 0);
  }, [hotspots, layer]);

  const scopeSummary = useMemo(() => {
    if (activeRegionObj) {
      return {
        title: activeRegionObj.regionName,
        description: activeRegionObj.description,
        totalCount: activeRegionObj.totalCount,
        propagandaCount: activeRegionObj.propagandaCount,
        botCount: activeRegionObj.botCount,
        humanCleanCount: activeRegionObj.humanCleanCount,
        avgRiskScore: activeRegionObj.avgRiskScore,
        threatLevel: activeRegionObj.threatLevel,
        topFlags: activeRegionObj.topFlags,
        networkTypes: activeRegionObj.networkTypes,
      };
    }
    const flagAgg = new Map<string, number>();
    const netAgg = new Map<string, number>();
    let totalRiskWeighted = 0;
    for (const r of regions) {
      totalRiskWeighted += r.avgRiskScore * r.totalCount;
      for (const f of r.topFlags) flagAgg.set(f.id, (flagAgg.get(f.id) || 0) + f.count);
      for (const n of r.networkTypes) {
        netAgg.set(n.networkType, (netAgg.get(n.networkType) || 0) + n.count);
      }
    }
    const totalAnalyzed = geography?.totalAnalyzed || 0;
    const totalProp = geography?.totalPropaganda || 0;
    const totalBots = geography?.totalBots || 0;
    return {
      title: "Global Overview",
      description:
        "",
      totalCount: totalAnalyzed,
      propagandaCount: totalProp,
      botCount: totalBots,
      humanCleanCount: geography?.totalHumanClean || 0,
      avgRiskScore:
        totalAnalyzed > 0 ? Number((totalRiskWeighted / totalAnalyzed).toFixed(1)) : 0,
      threatLevel: (totalProp >= 2 ? "critical" : totalProp >= 1 ? "elevated" : "moderate") as
        | "critical"
        | "elevated"
        | "moderate"
        | "low",
      topFlags: Array.from(flagAgg.entries())
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      networkTypes: Array.from(netAgg.entries())
        .map(([networkType, count]) => ({ networkType, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [activeRegionObj, geography, regions]);

  const flyToScope = useCallback(
    (regionCode: string, countryCode: string) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      if (countryCode !== "all") {
        const focus = COUNTRY_FOCUS_COORDS[countryCode];
        if (focus) {
          map.flyTo([focus.lat, focus.lng], compact ? Math.max(2, focus.zoom - 1) : focus.zoom, {
            duration: 0.7,
          });
          return;
        }
        const spot = hotspots.find((h) => h.countryCode === countryCode);
        if (spot) {
          map.flyTo([spot.lat, spot.lng], compact ? 4 : 5, { duration: 0.7 });
          return;
        }
        const featureLayers = featureLayersByCodeRef.current.get(countryCode);
        if (featureLayers && featureLayers[0]?.getBounds) {
          const bounds = featureLayers[0].getBounds();
          const lngSpan = Math.abs(bounds.getEast() - bounds.getWest());
          if (lngSpan > 0 && lngSpan < 90) {
            map.flyToBounds(bounds, { padding: [32, 32], maxZoom: 5, duration: 0.7 });
            return;
          }
        }
      }

      if (regionCode !== "all") {
        const vp = REGION_VIEWPORTS[regionCode];
        if (vp) {
          map.flyTo([vp.lat, vp.lng], compact ? Math.max(2, vp.zoom - 1) : vp.zoom, {
            duration: 0.7,
          });
          return;
        }
      }

      const world = REGION_VIEWPORTS.all;
      map.flyTo([world.lat, world.lng], compact ? 3.5 : world.zoom, { duration: 0.6 });
    },
    [compact, hotspots]
  );

  // Refs to read fresh React props/callbacks inside Leaflet DOM listeners
  const latestRef = useRef({
    layer,
    selectedRegion,
    selectedCountry,
    hoveredCode: null as string | null,
    isDark,
    countryStatsMap,
    countryNameMap,
    onSelectRegion,
    onSelectCountry,
  });
  latestRef.current = {
    layer,
    selectedRegion,
    selectedCountry,
    hoveredCode: hoveredCountry?.code || null,
    isDark,
    countryStatsMap,
    countryNameMap,
    onSelectRegion,
    onSelectCountry,
  };

  const getPolygonStyle = useCallback((feature: any) => {
    const state = latestRef.current;
    const code = resolveFeatureIso2(feature, state.countryNameMap);
    const stat = state.countryStatsMap.get(code);

    const hasThreatData =
      stat &&
      (state.layer === "propaganda"
        ? stat.propagandaCount > 0
        : state.layer === "bots"
          ? stat.botCount > 0
          : state.layer === "all"
            ? stat.totalCount > 0
            : stat.threatCount > 0);

    const isSelectedCountry = state.selectedCountry === code;
    const isHovered = state.hoveredCode === code;
    const countryRegion = stat?.regionCode || COUNTRY_TO_REGION_FALLBACK[code];
    const inSelectedRegion =
      state.selectedRegion === "all" || countryRegion === state.selectedRegion;

    let fillColor = state.isDark ? "#1e293b" : "#cbd5e1";
    let fillOpacity = hasThreatData ? 0.36 : 0.04;
    let color = state.isDark ? "#334155" : "#94a3b8";
    let weight = 0.7;

    if (hasThreatData && stat) {
      if (state.layer === "propaganda") {
        fillColor = "#f59e0b";
        fillOpacity = Math.min(0.62, 0.25 + stat.propagandaCount * 0.14);
        color = "#fbbf24";
      } else if (state.layer === "bots") {
        fillColor = "#f43f5e";
        fillOpacity = Math.min(0.62, 0.25 + stat.botCount * 0.12);
        color = "#fb7185";
      } else if (stat.propagandaCount > 0 && state.layer !== "all") {
        fillColor = "#f59e0b";
        fillOpacity = Math.min(0.6, 0.24 + stat.propagandaCount * 0.14);
        color = "#fbbf24";
      } else if (stat.botCount > 0 && state.layer !== "all") {
        fillColor = "#f43f5e";
        fillOpacity = Math.min(0.58, 0.24 + stat.botCount * 0.12);
        color = "#fb7185";
      } else if (stat.propagandaCount > 0) {
        fillColor = "#f59e0b";
        fillOpacity = 0.42;
        color = "#fbbf24";
      } else if (stat.botCount > 0) {
        fillColor = "#f43f5e";
        fillOpacity = 0.4;
        color = "#fb7185";
      } else {
        fillColor = "#10b981";
        fillOpacity = 0.26;
        color = "#34d399";
      }
      weight = 1.25;
    }

    if (!inSelectedRegion) {
      fillOpacity = hasThreatData ? 0.1 : 0.02;
    }

    if (isHovered && !isSelectedCountry) {
      weight = 1.8;
      color = state.isDark ? "#93c5fd" : "#2563eb";
      fillOpacity = Math.max(fillOpacity, 0.22);
    }

    if (isSelectedCountry) {
      weight = 2.4;
      color = "#ffffff";
      fillOpacity = Math.max(fillOpacity, 0.48);
    }

    return {
      fillColor,
      fillOpacity,
      color,
      weight,
      opacity: inSelectedRegion ? 0.9 : 0.35,
    };
  }, []);

  // Track theme (.dark class on <html>) dynamically
  useEffect(() => {
    if (typeof document === "undefined") return;
    const syncTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Initialize Leaflet Map once on mount
  useEffect(() => {
    const container = mapContainerRef.current;
    const L = typeof window !== "undefined" ? (window as any).L : null;
    if (!container || !L || mapInstanceRef.current) return;

    const initialZoom = compact ? 3.5 : 4;
    const map = L.map(container, {
      center: [51, 18],
      zoom: initialZoom,
      minZoom: 2,
      maxZoom: 12,
      maxBounds: [
        [-85, -1800],
        [85, 1800],
      ],
      maxBoundsViscosity: 0.85,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      zoomControl: false,
      worldCopyJump: true,
      attributionControl: true,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const markersLayer = L.layerGroup().addTo(map);

    map.on("zoomend", () => {
      setCurrentZoom(Number(map.getZoom().toFixed(1)));
    });

    mapInstanceRef.current = map;
    markersLayerRef.current = markersLayer;
    setCurrentZoom(Number(map.getZoom().toFixed(1)));

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    resizeObserver.observe(container);
    const sizeTimer = setTimeout(() => map.invalidateSize({ pan: false }), 90);

    // Load real GeoJSON country boundaries
    let cancelled = false;
    loadWorldGeoJson().then((geojson) => {
      if (cancelled || !geojson || !mapInstanceRef.current) return;
      const featureMap = new Map<string, any[]>();
      const gjLayer = L.geoJSON(geojson, {
        style: (feature: any) => getPolygonStyle(feature),
        onEachFeature: (feature: any, leafletLayer: any) => {
          const code = resolveFeatureIso2(feature, latestRef.current.countryNameMap);
          const propName =
            latestRef.current.countryStatsMap.get(code)?.countryName ||
            String(feature?.properties?.name || code);

          const arr = featureMap.get(code) || [];
          arr.push(leafletLayer);
          featureMap.set(code, arr);

          leafletLayer.on({
            mouseover: () => {
              setHoveredCountry({ code, name: propName });
              leafletLayer.setStyle({
                weight: 2,
                color: latestRef.current.isDark ? "#93c5fd" : "#2563eb",
              });
            },
            mouseout: () => {
              setHoveredCountry((prev) => (prev?.code === code ? null : prev));
              gjLayer.resetStyle(leafletLayer);
            },
            click: () => {
              const curr = latestRef.current;
              const stat = curr.countryStatsMap.get(code);
              const nextSelected = curr.selectedCountry === code ? "all" : code;
              const regionCode =
                stat?.regionCode || COUNTRY_TO_REGION_FALLBACK[code] || curr.selectedRegion;

              if (nextSelected === "all") {
                curr.onSelectCountry("all");
              } else {
                if (regionCode && regionCode !== "all") {
                  curr.onSelectRegion(regionCode);
                }
                curr.onSelectCountry(nextSelected);
              }
            },
          });
        },
      }).addTo(map);

      // Keep GeoJSON beneath markers
      if (typeof gjLayer.bringToBack === "function") {
        gjLayer.bringToBack();
      }
      featureLayersByCodeRef.current = featureMap;
      geoJsonLayerRef.current = gjLayer;
      setGeoLoaded(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(sizeTimer);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      geoJsonLayerRef.current = null;
      markersLayerRef.current = null;
      featureLayersByCodeRef.current.clear();
    };
  }, [compact]); // Mount map once per component instance

  // Re-style country choropleth fills whenever filters, data, or theme change
  useEffect(() => {
    const gj = geoJsonLayerRef.current;
    if (!gj) return;
    gj.setStyle((feature: any) => getPolygonStyle(feature));
  }, [
    geoLoaded,
    geography,
    layer,
    selectedRegion,
    selectedCountry,
    hoveredCountry,
    isDark,
    getPolygonStyle,
  ]);

  // Render interactive Leaflet city hotspot markers
  useEffect(() => {
    const markersLayer = markersLayerRef.current;
    const L = typeof window !== "undefined" ? (window as any).L : null;
    if (!markersLayer || !L) return;

    markersLayer.clearLayers();

    for (const spot of filteredHotspots) {
      const isPropagandaPin =
        layer === "propaganda" ||
        (layer === "threats" && spot.propagandaCount > 0) ||
        (layer === "all" && spot.dominantKind === "propaganda");
      const isBotPin =
        !isPropagandaPin &&
        (layer === "bots" ||
          (layer === "threats" && spot.botCount > 0) ||
          (layer === "all" && spot.dominantKind === "bot"));

      const pinColor = isPropagandaPin ? "#f59e0b" : isBotPin ? "#f43f5e" : "#10b981";
      const isCountrySelected = selectedCountry === spot.countryCode;
      const inRegion = selectedRegion === "all" || selectedRegion === spot.regionCode;
      const sizePx = Math.min(34, Math.max(22, 18 + Math.round(Math.sqrt(spot.layerCount) * 4)));
      const iconContainerPx = sizePx + 12;

      const kindSummary = isPropagandaPin
        ? `${spot.propagandaCount} flagged propaganda`
        : isBotPin
          ? `${spot.botCount} honeypot bot submissions`
          : `${spot.humanCleanCount} verified human comments`;

      const pulseRing =
        isPropagandaPin || isBotPin
          ? `<span class="truthier-pin-ring" style="position:absolute;inset:2px;border-radius:9999px;border:1.5px solid ${pinColor};"></span>`
          : "";
      const selectedHalo = isCountrySelected
        ? `<span style="position:absolute;inset:0;border-radius:9999px;border:2px solid #ffffff;box-shadow:0 0 10px rgba(255,255,255,0.5);"></span>`
        : "";

      const iconHtml = `<div style="position:relative;width:${iconContainerPx}px;height:${iconContainerPx}px;display:flex;align-items:center;justify-content:center;opacity:${
        inRegion ? "1" : "0.35"
      };">
        ${pulseRing}
        ${selectedHalo}
        <span style="position:relative;width:${sizePx}px;height:${sizePx}px;border-radius:9999px;background:${pinColor};color:#020617;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.45);border:2px solid rgba(15,23,42,0.9);">${spot.layerCount}</span>
      </div>`;

      const icon = L.divIcon({
        className: "truthier-pin",
        html: iconHtml,
        iconSize: [iconContainerPx, iconContainerPx],
        iconAnchor: [iconContainerPx / 2, iconContainerPx / 2],
      });

      const netLabels = spot.networkTypes.map((n) => escapeHtml(humanizeKey(n))).join(", ") || "Unknown";
      const tooltipHtml = `<div style="min-width:190px;max-width:260px;">
        <div style="font-weight:700;font-size:12px;">${escapeHtml(spot.city)}, ${escapeHtml(spot.countryName)} (${escapeHtml(spot.countryCode)})</div>
        <div style="font-size:10px;opacity:0.75;margin-bottom:4px;">${escapeHtml(spot.region)} &bull; Avg risk ${spot.avgRiskScore} pts</div>
        <div style="font-size:11px;margin-bottom:3px;">${escapeHtml(kindSummary)} (${spot.totalCount} total)</div>
        <div style="font-size:10px;opacity:0.8;">Relay: ${netLabels}</div>
        <div style="font-size:10px;opacity:0.65;margin-top:4px;">Click pin to filter submissions</div>
      </div>`;

      const marker = L.marker([spot.lat, spot.lng], { icon })
        .bindTooltip(tooltipHtml, { direction: "top", offset: [0, -10] })
        .on("click", () => {
          const curr = latestRef.current;
          curr.onSelectRegion(spot.regionCode);
          curr.onSelectCountry(curr.selectedCountry === spot.countryCode ? "all" : spot.countryCode);
        });

      markersLayer.addLayer(marker);
    }
  }, [filteredHotspots, layer, selectedRegion, selectedCountry]);

  // Smooth flyTo when selected region/country changes
  useEffect(() => {
    const key = `${selectedRegion}:${selectedCountry}`;
    if (prevViewportKeyRef.current === "" && selectedRegion === "all" && selectedCountry === "all") {
      prevViewportKeyRef.current = key;
      return;
    }
    if (prevViewportKeyRef.current !== key) {
      prevViewportKeyRef.current = key;
      flyToScope(selectedRegion, selectedCountry);
    }
  }, [selectedRegion, selectedCountry, flyToScope]);

  const hoveredStat = hoveredCountry ? countryStatsMap.get(hoveredCountry.code) : undefined;

  const handleZoomIn = () => {
    mapInstanceRef.current?.zoomIn(1);
  };

  const handleZoomOut = () => {
    mapInstanceRef.current?.zoomOut(1);
  };

  const handleResetView = () => {
    onSelectRegion("all");
    onSelectCountry("all");
    const world = REGION_VIEWPORTS.all;
    mapInstanceRef.current?.flyTo([world.lat, world.lng], compact ? 3.5 : world.zoom, {
      duration: 0.65,
    });
  };

  return (
    <div className="space-y-4">
      {/* Layer Filter & Navigation Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <HoverExplanation
            title="Map Layer Filter"
            category="Geographic Map Control"
            description="Choose which origin categories shade countries and appear as pins: Flagged Propaganda only, Botnet Origins only, both combined, or All Website Traffic."
          >
            <ToggleGroup value={layer} onValueChange={(v) => setLayer(v as ThreatLayerMode)}>
              <ToggleGroupItem value="threats">Propaganda &amp; Bots</ToggleGroupItem>
              <ToggleGroupItem value="propaganda">Propaganda Only</ToggleGroupItem>
              <ToggleGroupItem value="bots">Botnet Origins</ToggleGroupItem>
              <ToggleGroupItem value="all">All Traffic</ToggleGroupItem>
            </ToggleGroup>
          </HoverExplanation>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(selectedRegion !== "all" ||
            selectedCountry !== "all" ||
            Math.abs(currentZoom - (compact ? 3.5 : 4)) > 0.4) && (
            <Button variant="outline" size="sm" onClick={handleResetView}>
              Reset Map View
            </Button>
          )}

          {compact && onOpenFullMap && (
            <Button variant="outline" size="sm" onClick={onOpenFullMap}>
              <IconGlobe className="h-3.5 w-3.5" />
              Open Full Interactive Map
            </Button>
          )}
        </div>
      </div>

      {/* Region Quick-Focus Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <HoverExplanation
          title="All World Regions"
          category="Map Viewport"
          description="Zooms out to show detected propaganda and botnet origins across every continent."
        >
          <Badge
            variant={selectedRegion === "all" && selectedCountry === "all" ? "default" : "outline"}
            className="cursor-pointer px-2.5 py-1 text-xs"
            onClick={() => {
              onSelectRegion("all");
              onSelectCountry("all");
            }}
          >
            World ({geography?.activeCountriesCount || 0} countries)
          </Badge>
        </HoverExplanation>

        {regions.map((reg) => {
          const isSelected = selectedRegion === reg.regionCode;
          const regInfo = getTagExplanation(reg.regionCode);
          return (
            <HoverExplanation
              key={reg.regionCode}
              title={regInfo.title}
              category={infoCategoryOrRegion(regInfo.category)}
              rawKey={regInfo.rawKey}
              description={`${regInfo.description} Click to fly the map directly to ${reg.regionName}. Detected: ${reg.propagandaCount} propaganda, ${reg.botCount} bots, ${reg.humanCleanCount} clean human.`}
            >
              <Badge
                variant={
                  isSelected
                    ? reg.propagandaCount > 0
                      ? "warning"
                      : "info"
                    : "outline"
                }
                className="cursor-pointer gap-1.5 px-2.5 py-1 text-xs"
                onClick={() => {
                  onSelectCountry("all");
                  onSelectRegion(isSelected ? "all" : reg.regionCode);
                }}
              >
                <span>{reg.regionName}</span>
                {reg.threatCount > 0 ? (
                  <span className="rounded bg-background/50 px-1 font-mono text-[10px]">
                    {reg.propagandaCount}P / {reg.botCount}B
                  </span>
                ) : (
                  <span className="font-mono text-[10px] opacity-65">({reg.totalCount})</span>
                )}
              </Badge>
            </HoverExplanation>
          );
        })}
      </div>

      {/* Main Leaflet World Map + Country Breakdown Sidebar */}
      <div className={compact ? "grid gap-4 lg:grid-cols-3" : "grid gap-5 lg:grid-cols-12"}>
        {/* Real Interactive Leaflet Map */}
        <div
          className={`${
            compact
              ? "lg:col-span-2 min-h-[440px] sm:min-h-[500px]"
              : "lg:col-span-8 min-h-[540px] sm:min-h-[620px]"
          } truthier-leaflet-shell relative overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-inner`}
        >
          {/* Top-left Active Focus Pill */}
          <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-card/90 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-xs shadow-sm">
              <IconGlobe className="h-3.5 w-3.5 text-sky-400" />
              {scopeSummary.title}
              {selectedCountry !== "all" ? ` • ${selectedCountry}` : ""}
            </span>
          </div>

          {/* Top-right Custom Zoom Controls */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-border/80 bg-card/90 p-1 backdrop-blur-xs shadow-md">
            <HoverExplanation
              title="Zoom In"
              category="Map Navigation"
              description="Zooms in closer on OpenStreetMap street & city map tiles. You can also scroll your mouse wheel or pinch on trackpad."
            >
              <button
                type="button"
                aria-label="Zoom in"
                onClick={handleZoomIn}
                disabled={currentZoom >= 12}
                className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                +
              </button>
            </HoverExplanation>

            <span className="px-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
              z{currentZoom}
            </span>

            <HoverExplanation
              title="Zoom Out"
              category="Map Navigation"
              description="Zooms back out toward the continent and world view."
            >
              <button
                type="button"
                aria-label="Zoom out"
                onClick={handleZoomOut}
                disabled={currentZoom <= 2}
                className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                &minus;
              </button>
            </HoverExplanation>

            <HoverExplanation
              title="Reset Map View"
              category="Map Navigation"
              description="Resets active filters and smoothly flies back to the full world view."
            >
              <button
                type="button"
                onClick={handleResetView}
                className="ml-0.5 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-secondary cursor-pointer"
              >
                Reset
              </button>
            </HoverExplanation>
          </div>

          {/* Bottom-left Color Legend */}
          <div className="pointer-events-none absolute bottom-2.5 left-3 z-20 flex flex-wrap items-center gap-3 rounded-md border border-border/80 bg-card/90 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur-xs shadow-sm">
            <span className="flex items-center gap-1 text-foreground">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Flagged Propaganda
            </span>
            <span className="flex items-center gap-1 text-foreground">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Botnet / Honeypot
            </span>
            <span className="flex items-center gap-1 text-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Verified Human
            </span>
            <span className="hidden sm:inline">&bull; Scroll to zoom, drag to pan</span>
          </div>

          {/* Bottom-right Country Hover Readout */}
          {hoveredCountry && (
            <div className="pointer-events-none absolute bottom-8 right-3 z-20 rounded-md border border-border/90 bg-card/95 px-2.5 py-1 text-[11px] text-foreground backdrop-blur-xs shadow-md">
              <span className="font-semibold">{hoveredCountry.name}</span>{" "}
              <span className="font-mono text-muted-foreground">({hoveredCountry.code})</span>
              {hoveredStat ? (
                <span className="ml-2 font-mono text-[10px]">
                  <span className="text-amber-500">{hoveredStat.propagandaCount}P</span>{" "}
                  <span className="text-rose-500">{hoveredStat.botCount}B</span>{" "}
                  <span className="text-teal-500">{hoveredStat.humanCleanCount}H</span>
                </span>
              ) : (
                <span className="ml-2 text-[10px] text-muted-foreground">No flagged activity</span>
              )}
            </div>
          )}

          {/* Leaflet Map Container */}
          <div
            ref={mapContainerRef}
            className="absolute inset-0 h-full w-full"
          />
        </div>

        {/* Regional Summary & Country Breakdown Panel */}
        <div className={`${compact ? "lg:col-span-1" : "lg:col-span-4"} space-y-3`}>
          <Card className="border-border/80 bg-secondary/25">
            <CardHeader className="pb-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm">{scopeSummary.title}</CardTitle>
                <Badge variant={threatBadgeVariant(scopeSummary.threatLevel)}>
                  {threatLevelLabel(scopeSummary.threatLevel)}
                </Badge>
              </div>
              <CardDescription className="text-xs leading-relaxed">
                {scopeSummary.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-border/70 bg-background/60 p-2">
                  <div className="font-mono text-base font-semibold text-amber-500">
                    {scopeSummary.propagandaCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Propaganda</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/60 p-2">
                  <div className="font-mono text-base font-semibold text-rose-500">
                    {scopeSummary.botCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Blocked Bots</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/60 p-2">
                  <div className="font-mono text-base font-semibold text-teal-500">
                    {scopeSummary.humanCleanCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Clean Human</div>
                </div>
              </div>

              {scopeSummary.topFlags.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Top Manipulation Patterns in Region:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {scopeSummary.topFlags.slice(0, compact ? 4 : 6).map((f) => {
                      const info = getTagExplanation(f.id);
                      return (
                        <HoverExplanation
                          key={f.id}
                          title={info.title}
                          category={info.category}
                          rawKey={info.rawKey}
                          description={info.description}
                        >
                          <Badge
                            variant="warning"
                            className="cursor-pointer text-[10px]"
                            onClick={() => onOpenSearchForLocation?.(f.id)}
                          >
                            {info.title} ({f.count})
                          </Badge>
                        </HoverExplanation>
                      );
                    })}
                  </div>
                </div>
              )}

              {!compact && scopeSummary.networkTypes.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Detected Network Relay Types:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {scopeSummary.networkTypes.map((n) => {
                      const info = getTagExplanation(n.networkType);
                      return (
                        <HoverExplanation
                          key={n.networkType}
                          title={info.title}
                          category={info.category}
                          rawKey={info.rawKey}
                          description={info.description}
                        >
                          <Badge variant="outline" className="cursor-default text-[10px]">
                            {info.title} ({n.count})
                          </Badge>
                        </HoverExplanation>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Origin Countries List */}
          <Card className="border-border/80">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  Origin Countries ({scopedCountries.length})
                </CardTitle>
                <span className="text-[11px] text-muted-foreground">Click to focus</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {scopedCountries.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No submissions detected in this region yet.
                </p>
              ) : (
                scopedCountries.slice(0, compact ? 5 : 20).map((c) => {
                  const isCountryActive = selectedCountry === c.countryCode;
                  const cInfo = getTagExplanation(`country_${c.countryCode}`);
                  const threatPct =
                    c.totalCount > 0 ? Math.round((c.threatCount / c.totalCount) * 100) : 0;

                  return (
                    <HoverExplanation
                      key={c.countryCode}
                      title={cInfo.title}
                      category={`${c.region} • Origin Country`}
                      rawKey={cInfo.rawKey}
                      description={`${cInfo.description} Cities: ${c.cities.join(", ")}. Threats: ${c.propagandaCount} propaganda, ${c.botCount} bots.`}
                      className="w-full"
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          onSelectRegion(c.regionCode);
                          onSelectCountry(isCountryActive ? "all" : c.countryCode);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectRegion(c.regionCode);
                            onSelectCountry(isCountryActive ? "all" : c.countryCode);
                          }
                        }}
                        className={`w-full rounded-lg border p-2.5 text-left text-xs transition-colors cursor-pointer ${
                          isCountryActive
                            ? "border-primary bg-primary/10"
                            : "border-border/70 bg-secondary/20 hover:bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-5 w-7 items-center justify-center rounded bg-slate-800 font-mono text-[10px] font-bold text-slate-100">
                              {c.countryCode}
                            </span>
                            <div>
                              <div className="font-semibold text-foreground">{c.countryName}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {c.cities.join(", ")}
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-mono text-[11px]">
                            <span className="text-amber-500">{c.propagandaCount}P</span>
                            {" / "}
                            <span className="text-rose-500">{c.botCount}B</span>
                            {" / "}
                            <span className="text-teal-500">{c.humanCleanCount}H</span>
                          </div>
                        </div>
                        <Progress
                          value={threatPct}
                          className="mt-2 h-1.5"
                          indicatorColor={
                            c.propagandaCount > 0
                              ? "#f59e0b"
                              : c.botCount > 0
                                ? "#f43f5e"
                                : "#10b981"
                          }
                        />
                      </div>
                    </HoverExplanation>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function infoCategoryOrRegion(cat?: string): string {
  return cat || "Geographic Region";
}
