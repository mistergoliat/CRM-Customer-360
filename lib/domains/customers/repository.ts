import {
  createMasterCustomer as createMasterCustomerRecord,
  findMasterCustomerByEmail as findMasterCustomerByEmailRecord,
  getMasterCustomerById as getMasterCustomerByIdRecord,
  listMasterCustomers as listMasterCustomersRecord
} from "@/lib/integrations/customer-master/customer-repository";
import { mapMasterCustomerRow } from "@/lib/integrations/customer-master/mappers";
import type { MasterCustomerRow } from "@/lib/integrations/customer-master/types";
import type { CustomerRepository } from "./contracts";
import { buildCustomerListReadModel } from "./read-model";
import { normalizePlatformOrigin } from "./platform-origin";
import type { CustomerListInput, CustomerRecord } from "./types";

export type MysqlCustomerRepositoryDependencies = {
  listMasterCustomers?: typeof listMasterCustomersRecord;
  getMasterCustomerById?: typeof getMasterCustomerByIdRecord;
  findMasterCustomerByEmail?: typeof findMasterCustomerByEmailRecord;
  createMasterCustomer?: typeof createMasterCustomerRecord;
};

function normalizeRecord(record: MasterCustomerRow | null): CustomerRecord | null {
  return record
    ? {
        id: String(record.id),
        firstname: record.firstname,
        lastname: record.lastname,
        email: record.email,
        platformOrigin: normalizePlatformOrigin(record.platform_origin)
      }
    : null;
}

export function createMysqlCustomerRepository(dependencies: MysqlCustomerRepositoryDependencies = {}): CustomerRepository {
  const listMasterCustomers = dependencies.listMasterCustomers ?? listMasterCustomersRecord;
  const getMasterCustomerById = dependencies.getMasterCustomerById ?? getMasterCustomerByIdRecord;
  const findMasterCustomerByEmail = dependencies.findMasterCustomerByEmail ?? findMasterCustomerByEmailRecord;
  const createMasterCustomer = dependencies.createMasterCustomer ?? createMasterCustomerRecord;

  return {
    async list(input: CustomerListInput) {
      const result = await listMasterCustomers(input);
      if (!result.ok) {
        return buildCustomerListReadModel({
          items: [],
          page: Math.max(1, Number(input.page ?? 1)),
          pageSize: Math.max(1, Math.min(Number(input.pageSize ?? 25), 100)),
          total: 0,
          mode: "error",
          source: "master_customer",
          warnings: [result.error]
        });
      }
      const mappedItems = result.data.items.map((item) => {
        const mapped = mapMasterCustomerRow(item);
        return mapped;
      });
      const items = mappedItems.map((item) => item.customer);
      const warnings = Array.from(new Set([...result.warnings, ...mappedItems.flatMap((item) => item.warnings)]));
      return buildCustomerListReadModel({
        items,
        page: result.data.page,
        pageSize: result.data.pageSize,
        total: result.data.total,
        mode: "real",
        source: "master_customer",
        warnings
      });
    },
    async getById(id: string) {
      const result = await getMasterCustomerById(id);
      if (!result.ok) {
        return {
          customer: null,
          warnings: [result.error]
        };
      }
      return {
        customer: normalizeRecord(result.data),
        warnings: result.warnings
      };
    },
    async findByEmail(email: string) {
      const result = await findMasterCustomerByEmail(email);
      if (!result.ok) {
        return {
          customer: null,
          warnings: [result.error]
        };
      }
      return {
        customer: normalizeRecord(result.data),
        warnings: result.warnings
      };
    },
    async create(input) {
      const result = await createMasterCustomer(input);
      if (!result.ok) throw new Error(result.error);
      return {
        customer: normalizeRecord(result.data),
        warnings: result.warnings
      };
    }
  };
}
