import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and de-duplicate conflicting Tailwind
 * utilities (e.g. later `px-4` wins over an earlier `px-2`). Every design-system
 * component takes a `className` prop and pipes it through `cn`, so callers can
 * always override presentation without fighting specificity.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
