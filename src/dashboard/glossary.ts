import { SEMEVAL_QUESTIONS, BUCKET_NAMES } from "../config/semeval-questions";

export interface GlossaryEntry {
  title: string;
  rawKey: string;
  category: string;
  description: string;
}

/**
 * Converts snake_case or UPPER_SNAKE_CASE technical keys into clean Title Case without underscores.
 */
export function humanizeKey(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (/^\d+(ms|s|v\d+)/i.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

const STATIC_GLOSSARY: Record<string, Omit<GlossaryEntry, "rawKey">> = {
  // Bot Telemetry Signals
  zero_interaction_events: {
    title: "Zero Interaction Events",
    category: "Bot Telemetry Signal",
    description:
      "The comment was submitted without a single mouse movement, scroll, or keystroke—indicating an automated script rather than a real person.",
  },
  honeypot_filled: {
    title: "Hidden Bot Trap Filled",
    category: "Bot Telemetry Signal",
    description:
      "An invisible form field (hidden from human visitors) was filled out automatically by a spam bot scraping the page.",
  },
  webdriver_detected: {
    title: "Automated Browser (WebDriver)",
    category: "Bot Telemetry Signal",
    description:
      "The visitor's browser exposed automation flags used by headless bot tools like Puppeteer, Playwright, or Selenium.",
  },
  linear_mouse_path: {
    title: "Robotic Mouse Movement",
    category: "Bot Telemetry Signal",
    description:
      "The cursor moved in mathematically straight lines without natural human hand curvature.",
  },
  missing_telemetry_token: {
    title: "Missing Browser Verification",
    category: "Bot Telemetry Signal",
    description:
      "The comment was posted directly to the server bypassing the website's browser verification script.",
  },
  bot_telemetry_flagged: {
    title: "Bot Telemetry Flagged",
    category: "Bot Telemetry Signal",
    description:
      "Browser behavioral checks detected automated submission patterns inconsistent with a human visitor.",
  },

  // Botnet Pattern Clusters
  cluster_crypto_spam_botnet: {
    title: "Crypto Spam Botnet",
    category: "Botnet Pattern Cluster",
    description:
      "Grouped into a known pattern of automated bots promoting fake cryptocurrency giveaways and phishing links.",
  },
  cluster_brigade_script_v2: {
    title: "Coordinated Brigade Script",
    category: "Botnet Pattern Cluster",
    description:
      "Grouped into a wave of automated scripts posting repetitive attack templates at high speed.",
  },
  cluster_headless_generic: {
    title: "Generic Headless Scraper",
    category: "Botnet Pattern Cluster",
    description:
      "Grouped into automated command-line or headless browser bots.",
  },
  cluster_honeypot_trap: {
    title: "Hidden Trap Catch Cluster",
    category: "Botnet Pattern Cluster",
    description:
      "Grouped into automated bots caught by filling out hidden form fields invisible to human users.",
  },
  cluster_headless_webdriver: {
    title: "Headless Browser Cluster",
    category: "Botnet Pattern Cluster",
    description:
      "Grouped into scripted browser instances controlled via WebDriver automation.",
  },

  // Inspection Pipeline Routes
  BOT_HONEYPOT: {
    title: "Blocked by Bot Trap",
    category: "Inspection Pipeline Route",
    description:
      "Caught in under 2ms by browser telemetry checks and shadowbanned before reaching the AI models.",
  },
  ROUTE_1_FAST_CLEAR: {
    title: "Fast Clear (Safe Comment)",
    category: "Inspection Pipeline Route",
    description:
      "Passed the Stage 1 SemEval-50 check with zero manipulation risk and published immediately.",
  },
  ROUTE_2_SHIELDED_VENTING: {
    title: "Protected Customer Complaint",
    category: "Inspection Pipeline Route",
    description:
      "Contains strong frustration or complaints about an order/product, but is protected from false censorship because it is genuine customer feedback.",
  },
  ROUTE_3_STANCE_VERIFICATION: {
    title: "Neutral Quote / Context Verified",
    category: "Inspection Pipeline Route",
    description:
      "Mentioned sensitive or controversial phrases, but Stage 2 AI verified the author was merely quoting, reporting, or debunking them.",
  },
  ROUTE_4_FORENSIC_THREAT: {
    title: "Flagged Manipulation",
    category: "Inspection Pipeline Route",
    description:
      "Triggered multiple propaganda risk patterns and was confirmed by Stage 2 AI as coordinated manipulation or disinformation.",
  },

  // Website Pages / Entities
  product_quantum_router: {
    title: "Quantum Router (Product)",
    category: "Website Page / Entity",
    description: "Store product page for the Quantum Router hardware device.",
  },
  post_firmware_v4_2: {
    title: "Firmware v4.2 Release Notes (Post)",
    category: "Website Page / Entity",
    description:
      "Blog announcement and discussion thread for Firmware Update v4.2.",
  },
  product_cloud_firewall: {
    title: "Cloud Firewall (Product)",
    category: "Website Page / Entity",
    description: "Store product page for the Cloud Firewall subscription.",
  },
  post_security_advisory: {
    title: "Security Advisory (Post)",
    category: "Website Page / Entity",
    description: "Official security patch and CVE advisory article.",
  },

  // Visibility & Classification
  public: {
    title: "Published Publicly",
    category: "Comment Visibility",
    description:
      "Verified safe comment visible to all visitors on your website.",
  },
  public_flagged: {
    title: "Published With Context Note",
    category: "Comment Visibility",
    description:
      "Remains visible with an attached AI forensic warning explaining potential manipulation tactics.",
  },
  shadowbanned: {
    title: "Hidden (Shadowbanned)",
    category: "Comment Visibility",
    description:
      "Silently hidden from public website visitors so bots cannot tell they were blocked.",
  },
  pending: {
    title: "Pending Inspection",
    category: "Comment Visibility",
    description:
      "Queued in the background worker awaiting SemEval-50 and forensic evaluation.",
  },

  // World Macro-Regions
  region_eastern_europe: {
    title: "Eastern Europe",
    category: "Geographic Region",
    description:
      "Submissions and bot relays routed through Russia, Belarus, and Eastern European transit hubs.",
  },
  region_western_europe: {
    title: "Western & Central Europe",
    category: "Geographic Region",
    description:
      "Traffic originating from Western and Northern Europe, including Tor exit nodes, European cloud relays, and residential ISPs.",
  },
  region_middle_east: {
    title: "Middle East & Central Asia",
    category: "Geographic Region",
    description:
      "Submissions traced to autonomous telecom relays and VPN exit hubs across the Middle East region.",
  },
  region_east_asia: {
    title: "East & Southeast Asia",
    category: "Geographic Region",
    description:
      "Submissions and datacenter proxy activity originating across East and Southeast Asian telecom hubs.",
  },
  region_north_america: {
    title: "North America",
    category: "Geographic Region",
    description:
      "Comments and cloud relay traffic originating from North American ISP and data center hubs.",
  },
  region_south_america: {
    title: "South America",
    category: "Geographic Region",
    description:
      "Traffic originating from South American ISP ranges and compromised residential proxy nodes.",
  },
  region_local: {
    title: "Local & Internal",
    category: "Geographic Region",
    description:
      "Submissions originating from localhost, loopback interfaces (127.0.0.1), or private development environments.",
  },

  // Origin Countries
  country_LOCAL: {
    title: "Localhost / Internal (LOCAL)",
    category: "Origin Network",
    description: "Traffic originating from local development loopback (127.0.0.1) or private intranet.",
  },
  country_RU: {
    title: "Russia (RU)",
    category: "Origin Country",
    description: "Network origin geolocated to Russian telecom or hosting hubs (Moscow / St. Petersburg).",
  },
  country_BY: {
    title: "Belarus (BY)",
    category: "Origin Country",
    description: "Network origin geolocated to Belarusian state backbone ranges (Minsk).",
  },
  country_RO: {
    title: "Romania (RO)",
    category: "Origin Country",
    description: "Network origin geolocated to Romanian datacenter hosting infrastructure (Bucharest).",
  },
  country_DE: {
    title: "Germany (DE)",
    category: "Origin Country",
    description: "Network origin geolocated to German residential or Tor exit infrastructure (Frankfurt).",
  },
  country_NL: {
    title: "Netherlands (NL)",
    category: "Origin Country",
    description: "Network origin geolocated to Dutch VPS/datacenter relays (Amsterdam).",
  },
  country_FI: {
    title: "Finland (FI)",
    category: "Origin Country",
    description: "Network origin geolocated to Finnish broadband infrastructure (Helsinki).",
  },
  country_GB: {
    title: "United Kingdom (GB)",
    category: "Origin Country",
    description: "Network origin geolocated to UK consumer broadband providers (London).",
  },
  country_IR: {
    title: "Iran (IR)",
    category: "Origin Country",
    description: "Network origin geolocated to Iranian autonomous network relays (Tehran).",
  },
  country_TR: {
    title: "Turkey (TR)",
    category: "Origin Country",
    description: "Network origin geolocated to Turkish ISP or VPN exit gateways (Istanbul).",
  },
  country_CN: {
    title: "China (CN)",
    category: "Origin Country",
    description: "Network origin geolocated to mainland China backbone/datacenter nodes (Shenzhen).",
  },
  country_SG: {
    title: "Singapore (SG)",
    category: "Origin Country",
    description: "Network origin geolocated to Singapore residential or APAC edge networks.",
  },
  country_US: {
    title: "United States (US)",
    category: "Origin Country",
    description: "Network origin geolocated to US residential ISPs or VPS transit hubs.",
  },
  country_BR: {
    title: "Brazil (BR)",
    category: "Origin Country",
    description: "Network origin geolocated to Brazilian ISP or proxy nodes (São Paulo).",
  },

  // Origin Network Types
  internal_loopback: {
    title: "Localhost / Loopback",
    category: "Network Infrastructure",
    description: "Local development server or internal container loopback interface (127.0.0.1).",
  },
  direct_traffic: {
    title: "Direct Network Traffic",
    category: "Network Infrastructure",
    description: "Direct client connection without an identified datacenter proxy or VPN relay.",
  },
  state_backbone_relay: {
    title: "State Backbone Relay",
    category: "Network Infrastructure",
    description: "IP address block operated directly by a state telecom autonomous system rather than a typical consumer provider.",
  },
  datacenter_proxy: {
    title: "Datacenter Proxy",
    category: "Network Infrastructure",
    description: "Commercial hosting or colocation server IP frequently rented for automated scripts and bulk posting.",
  },
  tor_exit_node: {
    title: "Tor Exit Node",
    category: "Network Infrastructure",
    description: "Known anonymized Tor exit relay often abused by automated spam scripts to hide their true location.",
  },
  bulletproof_vps: {
    title: "Bulletproof Cloud VPS",
    category: "Network Infrastructure",
    description: "Permissive offshore cloud server host known for minimal abuse enforcement against scraping or spam bots.",
  },
  residential_isp: {
    title: "Consumer Home ISP",
    category: "Network Infrastructure",
    description: "Standard consumer broadband or fiber connection typically associated with real human visitors.",
  },
  vpn_exit_relay: {
    title: "VPN Exit Gateway",
    category: "Network Infrastructure",
    description: "Commercial VPN egress node used to mask the submitter's regional network origin.",
  },
  cloud_vps_cluster: {
    title: "Cloud VPS Cluster",
    category: "Network Infrastructure",
    description: "Virtualized cloud compute instance inside a multi-tenant infrastructure provider.",
  },
  botnet_residential_proxy: {
    title: "Compromised Residential Proxy",
    category: "Network Infrastructure",
    description: "Home internet connection hijacked into a proxy botnet used to disguise automated spam traffic.",
  },
};

/**
 * Returns beginner-friendly title, category, plain-English description, and original raw database key
 * for any telemetry tag, SemEval ID, route, cluster, entity, or visibility status.
 */
export function getTagExplanation(rawKey: string): GlossaryEntry {
  const key = (rawKey || "").trim();

  // 1. Direct match in static glossary
  if (key in STATIC_GLOSSARY) {
    return {
      ...STATIC_GLOSSARY[key],
      rawKey: key,
    };
  }

  // 2. Dynamic fast_submission_<ms> pattern
  const fastMatch = key.match(/^fast_submission_(.+)$/i);
  if (fastMatch) {
    return {
      title: `Instant Submission (${fastMatch[1]})`,
      rawKey: key,
      category: "Bot Telemetry Signal",
      description:
        "The form was filled and submitted in milliseconds—faster than a human could physically type or click.",
    };
  }

  // 3. SemEval-50 Question IDs (Q1..Q50)
  if (key in SEMEVAL_QUESTIONS) {
    const q = SEMEVAL_QUESTIONS[key as `Q${number}`];
    const bucketName = BUCKET_NAMES[q.bucket] || "SemEval Criterion";
    return {
      title: q.name,
      rawKey: key,
      category: q.isShield
        ? `Benign Context Shield (${bucketName})`
        : `SemEval Risk Flag (${bucketName})`,
      description: q.description,
    };
  }

  // 4. Fallback humanization
  return {
    title: humanizeKey(key),
    rawKey: key,
    category: "Database Tag",
    description: `Filter or classification tag recorded in PostgreSQL as "${key}".`,
  };
}
