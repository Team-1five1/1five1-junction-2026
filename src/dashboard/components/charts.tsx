import React, { useState } from "react";
import { Badge, Progress, HoverExplanation } from "./ui";
import { getTagExplanation } from "../glossary";

export interface SeriesPoint {
  bucket: string;
  label: string;
  bots: number;
  humanClean: number;
  humanFlagged: number;
  total: number;
}

const CALM_ROUTE_COLORS: Record<string, string> = {
  ROUTE_1_FAST_CLEAR: "var(--chart-human)",
  ROUTE_2_SHIELDED_VENTING: "var(--chart-shield)",
  ROUTE_3_STANCE_VERIFICATION: "var(--chart-stance)",
  ROUTE_4_FORENSIC_THREAT: "var(--chart-flagged)",
  BOT_HONEYPOT: "var(--chart-bot)",
};

export function TrafficVolumeChart({
  data,
  range,
}: {
  data: SeriesPoint[];
  range: "24h" | "7d" | "30d";
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No time-series data available for this range.
      </div>
    );
  }

  const maxTotal = Math.max(4, ...data.map((d) => d.total));
  const chartHeight = 210;
  const chartWidth = 760;
  const padLeft = 36;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 34;
  const plotW = chartWidth - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;

  const slotWidth = plotW / data.length;
  const barWidth = Math.max(6, Math.min(34, slotWidth * 0.6));

  const yTicks = [0, Math.ceil(maxTotal * 0.5), maxTotal];
  const hovered = hoverIdx !== null && data[hoverIdx] ? data[hoverIdx] : null;

  return (
    <div className="relative select-none">
      {/* Legend & Hover Readout (fixed min-height prevents vertical jitter) */}
      <div className="mb-3 flex min-h-[28px] flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-4">
          <HoverExplanation
            title="Verified Human Comments"
            category="Traffic Segment"
            description="Real human visitors whose comments passed safety checks and were published cleanly."
          >
            <span className="flex items-center gap-1.5 cursor-default">
              <span
                className="h-2.5 w-2.5 rounded-xs inline-block"
                style={{ backgroundColor: "var(--chart-human)" }}
              />
              <span className="text-muted-foreground">Verified Human</span>
            </span>
          </HoverExplanation>

          <HoverExplanation
            title="Flagged Manipulation"
            category="Traffic Segment"
            description="Comments flagged by AI for manipulative framing or propaganda tactics, shown with a context warning."
          >
            <span className="flex items-center gap-1.5 cursor-default">
              <span
                className="h-2.5 w-2.5 rounded-xs inline-block"
                style={{ backgroundColor: "var(--chart-flagged)" }}
              />
              <span className="text-muted-foreground">Flagged Manipulation</span>
            </span>
          </HoverExplanation>

          <HoverExplanation
            title="Blocked Automated Bots"
            category="Traffic Segment"
            description="Automated spam scripts or headless browsers caught by telemetry traps and shadowbanned."
          >
            <span className="flex items-center gap-1.5 cursor-default">
              <span
                className="h-2.5 w-2.5 rounded-xs inline-block"
                style={{ backgroundColor: "var(--chart-bot)" }}
              />
              <span className="text-muted-foreground">Blocked Bots</span>
            </span>
          </HoverExplanation>
        </div>

        <div className="flex h-7 items-center">
          {hovered ? (
            <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/70 px-2.5 py-1 font-mono text-xs tabular-nums">
              <span className="font-semibold text-foreground">{hovered.label}</span>
              <span className="text-teal-600 dark:text-teal-300">
                Human: {hovered.humanClean}
              </span>
              <span className="text-amber-600 dark:text-amber-300">
                Flagged: {hovered.humanFlagged}
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                Bots: {hovered.bots}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">
              Hover bars to inspect {range === "24h" ? "hourly" : "daily"} volume
            </span>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full h-56 overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal Grid Lines */}
        {yTicks.map((tick, idx) => {
          const y = padTop + plotH - (tick / maxTotal) * plotH;
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={chartWidth - padRight}
                y2={y}
                stroke="currentColor"
                className="text-border"
                strokeDasharray={tick === 0 ? undefined : "3 3"}
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px] font-mono"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Stacked Bars */}
        {data.map((pt, i) => {
          const cx = padLeft + i * slotWidth + slotWidth / 2;
          const x = cx - barWidth / 2;

          const cleanH = (pt.humanClean / maxTotal) * plotH;
          const flagH = (pt.humanFlagged / maxTotal) * plotH;
          const botH = (pt.bots / maxTotal) * plotH;

          const yClean = padTop + plotH - cleanH;
          const yFlag = yClean - flagH;
          const yBot = yFlag - botH;

          const isHovered = hoverIdx === i;
          const showLabel =
            data.length <= 10 ||
            i === 0 ||
            i === data.length - 1 ||
            i % Math.ceil(data.length / 8) === 0;

          return (
            <g
              key={pt.bucket}
              onMouseEnter={() => setHoverIdx(i)}
              className="cursor-pointer"
            >
              {/* Hover highlight column */}
              <rect
                x={padLeft + i * slotWidth}
                y={padTop}
                width={slotWidth}
                height={plotH}
                fill="currentColor"
                className={isHovered ? "text-accent/50" : "text-transparent"}
                rx={4}
              />

              {/* Empty baseline stub when total === 0 */}
              {pt.total === 0 && (
                <rect
                  x={x}
                  y={padTop + plotH - 2}
                  width={barWidth}
                  height={2}
                  fill="currentColor"
                  className="text-border"
                  rx={1}
                />
              )}

              {/* Verified Human segment */}
              {cleanH > 0 && (
                <rect
                  x={x}
                  y={yClean}
                  width={barWidth}
                  height={Math.max(2, cleanH)}
                  style={{ fill: "var(--chart-human)" }}
                  rx={flagH === 0 && botH === 0 ? 3 : 0}
                />
              )}

              {/* Flagged Propaganda segment */}
              {flagH > 0 && (
                <rect
                  x={x}
                  y={yFlag}
                  width={barWidth}
                  height={Math.max(2, flagH)}
                  style={{ fill: "var(--chart-flagged)" }}
                  rx={botH === 0 ? 3 : 0}
                />
              )}

              {/* Automated Bots segment */}
              {botH > 0 && (
                <rect
                  x={x}
                  y={yBot}
                  width={barWidth}
                  height={Math.max(2, botH)}
                  style={{ fill: "var(--chart-bot)" }}
                  rx={3}
                />
              )}

              {/* X-axis label */}
              {showLabel && (
                <text
                  x={cx}
                  y={chartHeight - 10}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px] font-mono"
                >
                  {pt.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RoutingBreakdownChart({
  items,
  selectedRoute,
  onSelectRoute,
}: {
  items: Array<{ route: string; label: string; count: number; color: string }>;
  selectedRoute?: string;
  onSelectRoute?: (route: string) => void;
}) {
  const total = Math.max(1, items.reduce((acc, i) => acc + i.count, 0));

  return (
    <div className="space-y-3.5">
      {/* Multi-segment bar */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
        {items.map((item) => {
          const pct = (item.count / total) * 100;
          if (pct <= 0) return null;
          const calmColor = CALM_ROUTE_COLORS[item.route] || item.color;
          return (
            <div
              key={item.route}
              style={{ width: `${pct}%`, backgroundColor: calmColor }}
              className="h-full transition-all duration-300"
            />
          );
        })}
      </div>

      {/* Individual route rows */}
      <div className="space-y-2">
        {items.map((item) => {
          const pct = ((item.count / total) * 100).toFixed(1);
          const calmColor = CALM_ROUTE_COLORS[item.route] || item.color;
          const info = getTagExplanation(item.route);
          const isSelected = selectedRoute === item.route;

          return (
            <HoverExplanation
              key={item.route}
              title={info.title}
              category={info.category}
              description={info.description}
              rawKey={info.rawKey}
              className="block w-full"
            >
              <div
                onClick={() => onSelectRoute?.(item.route)}
                className={`group flex w-full items-center justify-between rounded-lg border p-2.5 transition-colors cursor-pointer ${
                  isSelected
                    ? "border-primary/50 bg-accent/60"
                    : "border-transparent hover:border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: calmColor }}
                  />
                  <div>
                    <div className="text-xs font-medium text-foreground group-hover:underline">
                      {info.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground line-clamp-1">
                      {info.description}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs tabular-nums shrink-0 pl-3">
                  <span className="font-semibold text-foreground">{item.count}</span>
                  <span className="text-muted-foreground w-12 text-right">({pct}%)</span>
                </div>
              </div>
            </HoverExplanation>
          );
        })}
      </div>
    </div>
  );
}

export function TopFlagsBarChart({
  flags,
  onSelectTag,
}: {
  flags: Array<{
    id: string;
    name: string;
    bucket: number;
    bucketName: string;
    isShield: boolean;
    tier?: number;
    description: string;
    count: number;
  }>;
  onSelectTag?: (tagId: string) => void;
}) {
  if (!flags || flags.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        No SemEval criteria triggered yet.
      </div>
    );
  }

  const maxCount = Math.max(1, ...flags.map((f) => f.count));

  return (
    <div className="space-y-2.5">
      {flags.slice(0, 8).map((f) => {
        const widthPct = Math.max(8, (f.count / maxCount) * 100);
        const barColor = f.isShield
          ? "var(--chart-shield)"
          : f.tier === 3
            ? "var(--chart-stance)"
            : "var(--chart-flagged)";
        const info = getTagExplanation(f.id);

        return (
          <HoverExplanation
            key={f.id}
            title={info.title}
            category={info.category}
            description={info.description}
            rawKey={info.rawKey}
            className="block w-full"
          >
            <div
              onClick={() => onSelectTag?.(f.id)}
              className="group w-full space-y-1.5 rounded-lg p-1.5 transition-colors hover:bg-muted/50 cursor-pointer"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant={f.isShield ? "info" : f.tier === 3 ? "purple" : "warning"}>
                    {f.id}
                  </Badge>
                  <span className="font-medium text-foreground group-hover:underline">
                    {f.name}
                  </span>
                  <span className="hidden sm:inline text-[11px] text-muted-foreground">
                    &bull; {f.isShield ? "Safe Context Shield" : f.bucketName}
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                  {f.count}x
                </span>
              </div>
              <Progress value={widthPct} indicatorColor={barColor} />
            </div>
          </HoverExplanation>
        );
      })}
    </div>
  );
}
