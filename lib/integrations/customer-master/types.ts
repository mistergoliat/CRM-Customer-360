import type { PlatformOrigin } from "@/lib/domains/customers/platform-origin";

export type MasterCustomerRow = {
  id: number | string;
  firstname: string;
  lastname: string;
  email: string;
  platform_origin: string | null;
};

export type MasterCustomerListQuery = {
  search?: string;
  page?: number;
  pageSize?: number;
};

export type MasterCustomerCreateInput = {
  firstname: string;
  lastname: string;
  email: string;
  platformOrigin: PlatformOrigin;
  idempotencyKey?: string | null;
};
