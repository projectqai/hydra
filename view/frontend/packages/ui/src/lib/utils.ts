import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateMiddle(str: string, maxLength = 24): string {
  if (str.length <= maxLength) return str;
  const charsPerSide = Math.floor(maxLength / 2);
  return `${str.slice(0, charsPerSide)}...${str.slice(-charsPerSide)}`;
}
