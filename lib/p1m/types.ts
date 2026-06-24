import type { ChipTone } from "@/lib/status";

export type SurfaceState = "real" | "fixture" | "preview" | "read_only" | "provisional" | "not_available";

export type MetricCard = {
  key: string;
  title: string;
  value: string;
  description?: string;
  icon?: string;
  tone?: ChipTone;
  href?: string;
};

export type KeyValueField = {
  label: string;
  value: string;
  tone?: ChipTone;
};

export type TimelineItem = {
  id: string;
  title: string;
  subtitle?: string;
  time: string;
  tone?: ChipTone;
  icon?: string;
  chips?: { label: string; tone?: ChipTone }[];
};

export type ListAction = {
  label: string;
  href?: string;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "ghost";
  preview?: boolean;
};

export type TableColumn = {
  label: string;
  key: string;
  align?: "left" | "center" | "right";
};

export type TableRow = Record<string, string> & {
  id: string;
  href?: string;
};
