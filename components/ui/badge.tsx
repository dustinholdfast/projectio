import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small status/label chip. `label` colors map to the board palette tokens so a
 * card tag and its column accent can reference the same hue name.
 */
export type BadgeColor =
  | "slate"
  | "blue"
  | "amber"
  | "green"
  | "rose"
  | "violet";

const colors: Record<BadgeColor, string> = {
  slate: "bg-label-slate-soft text-label-slate",
  blue: "bg-label-blue-soft text-label-blue",
  amber: "bg-label-amber-soft text-label-amber",
  green: "bg-label-green-soft text-label-green",
  rose: "bg-label-rose-soft text-label-rose",
  violet: "bg-label-violet-soft text-label-violet",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
}

export function Badge({ className, color = "slate", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        colors[color],
        className,
      )}
      {...props}
    />
  );
}
