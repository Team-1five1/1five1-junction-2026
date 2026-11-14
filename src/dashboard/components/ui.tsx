import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// shadcn/ui Card
// ---------------------------------------------------------------------------
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-xs transition-colors",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col space-y-1.5 p-5", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("font-semibold leading-none tracking-tight text-sm sm:text-base", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs text-muted-foreground leading-relaxed", className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-5 pt-0", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center p-5 pt-0", className)} {...props}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Badge (Calm, trustworthy tones)
// ---------------------------------------------------------------------------
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | "default"
    | "secondary"
    | "destructive"
    | "outline"
    | "success"
    | "warning"
    | "info"
    | "purple";
}

export function Badge({ className, variant = "default", children, ...props }: BadgeProps) {
  const variants: Record<NonNullable<BadgeProps["variant"]>, string> = {
    default: "border-transparent bg-primary/90 text-primary-foreground",
    secondary: "border-border bg-secondary text-secondary-foreground",
    destructive:
      "border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    outline: "text-muted-foreground border-border bg-transparent hover:bg-accent/50 hover:text-foreground",
    success:
      "border-teal-400/25 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    warning:
      "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    info:
      "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    purple:
      "border-indigo-400/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Button
// ---------------------------------------------------------------------------
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: ButtonProps) {
  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
    destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
    outline: "border border-input bg-background/60 shadow-xs hover:bg-accent hover:text-accent-foreground",
    secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    link: "text-primary underline-offset-4 hover:underline",
  };

  const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
    default: "h-9 px-4 py-2 text-sm",
    sm: "h-8 rounded-md px-3 text-xs",
    lg: "h-10 rounded-md px-6 text-sm",
    icon: "h-8 w-8",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Input, Textarea, Label
// ---------------------------------------------------------------------------
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background/50 px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Tabs (Tabs, TabsList, TabsTrigger, TabsContent)
// ---------------------------------------------------------------------------
const TabsContext = createContext<{
  value: string;
  onValueChange: (val: string) => void;
}>({ value: "", onValueChange: () => {} });

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (val: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn("space-y-4", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-secondary/80 p-1 text-muted-foreground border border-border/60",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = useContext(TabsContext);
  const isActive = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 py-1 text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
        isActive
          ? "bg-card text-foreground shadow-xs border-border/80"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const ctx = useContext(TabsContext);
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      className={cn("mt-2 ring-offset-background focus-visible:outline-none", className)}
      {...props}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui ToggleGroup & ToggleGroupItem
// ---------------------------------------------------------------------------
const ToggleGroupContext = createContext<{
  value: string;
  onValueChange: (val: string) => void;
}>({ value: "", onValueChange: () => {} });

export function ToggleGroup({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (val: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ToggleGroupContext.Provider value={{ value, onValueChange }}>
      <div
        role="group"
        className={cn(
          "inline-flex items-center rounded-lg border border-border bg-secondary/60 p-0.5 text-xs",
          className
        )}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem({
  value,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = useContext(ToggleGroupContext);
  const active = ctx.value === value;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-transparent px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
        active
          ? "bg-card text-foreground shadow-xs border-border/70"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Alert (Alert, AlertTitle, AlertDescription)
// ---------------------------------------------------------------------------
export function Alert({
  variant = "default",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "warning" | "info" | "destructive";
}) {
  const variants = {
    default: "border-border bg-card text-foreground",
    info: "border-sky-500/30 bg-sky-500/8 text-foreground",
    warning: "border-amber-500/30 bg-amber-500/8 text-foreground",
    destructive: "border-rose-500/30 bg-rose-500/8 text-foreground",
  };
  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-xl border p-4 text-sm transition-colors",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function AlertTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5 className={cn("mb-1 font-medium leading-none tracking-tight text-xs flex items-center gap-2", className)} {...props}>
      {children}
    </h5>
  );
}

export function AlertDescription({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("text-xs text-muted-foreground leading-relaxed", className)} {...props}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Sheet (Slide-over Drawer)
// ---------------------------------------------------------------------------
export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-background/75 backdrop-blur-xs"
      onClick={() => onOpenChange(false)}
    >
      {children}
    </div>
  );
}

export function SheetContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "h-full w-full max-w-xl overflow-y-auto border-l border-border bg-card p-6 text-card-foreground shadow-xl space-y-5",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
}

export function SheetHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)} {...props}>
      {children}
    </div>
  );
}

export function SheetTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("text-base font-semibold text-foreground", className)} {...props}>
      {children}
    </h2>
  );
}

export function SheetDescription({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)} {...props}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Progress
// ---------------------------------------------------------------------------
export function Progress({
  value = 0,
  indicatorColor,
  className,
}: {
  value?: number;
  indicatorColor?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className="h-full transition-all duration-300 rounded-full bg-primary"
        style={{
          width: `${clamped}%`,
          backgroundColor: indicatorColor,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Table
// ---------------------------------------------------------------------------
export function Table({ className, children, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn("[&_tr]:border-b border-border", className)} {...props}>
      {children}
    </thead>
  );
}

export function TableBody({ className, children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props}>
      {children}
    </tbody>
  );
}

export function TableRow({ className, children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-border/70 transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableHead({ className, children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase tracking-wider",
        className
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({ className, children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("p-3 align-middle", className)} {...props}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// shadcn/ui Switch & Separator
// ---------------------------------------------------------------------------
export function Switch({
  checked,
  onCheckedChange,
  className,
}: {
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors focus-visible:outline-none",
        checked ? "bg-primary" : "bg-input",
        className
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-card shadow-sm ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn("shrink-0 bg-border h-[1px] w-full", className)} />;
}

// ---------------------------------------------------------------------------
// shadcn/ui HoverCard / HoverExplanation (1.2-second delayed explanation modal)
// ---------------------------------------------------------------------------
export interface HoverExplanationProps {
  title: string;
  description: string;
  category?: string;
  rawKey?: string;
  delayMs?: number;
  className?: string;
  children: React.ReactNode;
}

export function HoverExplanation({
  title,
  description,
  category,
  rawKey,
  delayMs = 1200,
  className,
  children,
}: HoverExplanationProps) {
  const [open, setOpen] = useState(false);
  const [isCharging, setIsCharging] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placeAbove: boolean }>({
    top: 0,
    left: 0,
    placeAbove: false,
  });
  const [chargeCoords, setChargeCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const updatePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cardWidth = 310;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < 180 && rect.top > 180;
    const rawLeft = rect.left + rect.width / 2 - cardWidth / 2;
    const clampedLeft = Math.max(12, Math.min(rawLeft, window.innerWidth - cardWidth - 12));
    const top = placeAbove ? rect.top - 8 : rect.bottom + 8;
    setCoords({ top, left: clampedLeft, placeAbove });

    const badgeSize = 22;
    const chargeTop = Math.max(6, Math.min(rect.top - 6, window.innerHeight - badgeSize - 6));
    const chargeLeft = Math.max(6, Math.min(rect.right - 12, window.innerWidth - badgeSize - 6));
    setChargeCoords({ top: chargeTop, left: chargeLeft });
  };

  const handleMouseEnter = () => {
    clearTimers();
    if (open) return;
    updatePosition();
    setIsCharging(true);
    openTimerRef.current = window.setTimeout(() => {
      updatePosition();
      setIsCharging(false);
      setOpen(true);
    }, delayMs);
  };

  const handleMouseLeave = () => {
    clearTimers();
    setIsCharging(false);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 120);
  };

  const handleCardMouseEnter = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleCardMouseLeave = () => {
    clearTimers();
    setIsCharging(false);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 120);
  };

  useEffect(() => {
    if (!open && !isCharging) return;
    const handleScrollOrResize = () => {
      clearTimers();
      setIsCharging(false);
      setOpen(false);
    };
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, isCharging]);

  useEffect(() => {
    return () => clearTimers();
  }, []);

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={() => {
        clearTimers();
        setIsCharging(false);
        setOpen(false);
      }}
      className={cn("inline-flex", className)}
    >
      {children}
      {isCharging &&
        !open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-hidden="true"
            style={{
              position: "fixed",
              top: chargeCoords.top,
              left: chargeCoords.left,
              width: 22,
              height: 22,
              zIndex: 69,
              pointerEvents: "none",
            }}
            className="flex items-center justify-center rounded-full bg-slate-900/90 shadow-md ring-1 ring-slate-700/80"
          >
            <div
              style={{
                animation: `infoGrayToWhite ${delayMs}ms linear forwards`,
              }}
              className="relative flex h-[18px] w-[18px] items-center justify-center"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90" fill="none">
                <circle
                  cx="9"
                  cy="9"
                  r="7"
                  stroke="currentColor"
                  strokeOpacity="0.25"
                  strokeWidth="1.75"
                />
                <circle
                  cx="9"
                  cy="9"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeDasharray="44"
                  style={{
                    animation: `infoRingFill ${delayMs}ms linear forwards`,
                  }}
                />
              </svg>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-serif text-[10px] font-bold leading-none">
                i
              </span>
            </div>
          </div>,
          document.body
        )}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-label={title}
            onMouseEnter={handleCardMouseEnter}
            onMouseLeave={handleCardMouseLeave}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: 310,
              transform: coords.placeAbove ? "translateY(-100%)" : "translateY(0)",
              zIndex: 70,
            }}
            className="rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-xl ring-1 ring-black/10"
          >
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-slate-800 ring-1 ring-white/25"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="7" stroke="#ffffff" strokeWidth="1.5" />
                    <circle cx="9" cy="5.75" r="0.9" fill="#ffffff" />
                    <path d="M9 8.25V12.5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {category && (
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-300">
                      {category}
                    </div>
                  )}
                  <div className="text-xs font-semibold text-foreground leading-snug">{title}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
              {rawKey && (
                <div className="mt-2 flex items-center justify-between rounded-md border border-border/80 bg-secondary/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  <span>DB Identifier:</span>
                  <span className="font-semibold text-foreground">{rawKey}</span>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crisp Lucide-style Icons (matching shadcn/ui default icon library)
// ---------------------------------------------------------------------------
export function IconShield({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function IconActivity({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </svg>
  );
}

export function IconBot({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

export function IconSearch({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function IconDatabase({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
    </svg>
  );
}

export function IconSliders({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
    </svg>
  );
}

export function IconSun({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2m-7.07-14.93 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2m-14.93 7.07 1.41-1.41m11.32-11.32 1.41-1.41" />
    </svg>
  );
}

export function IconMoon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

export function IconGlobe({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export function IconRadar({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
      <path d="M4 6h.01" />
      <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
      <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
      <path d="M12 18h.01" />
      <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
      <circle cx="12" cy="12" r="2" />
      <path d="m13.41 10.59 5.66-5.66" />
    </svg>
  );
}
