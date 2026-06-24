import type { CreateCustomerInput, CreateCustomerResult, CustomerListInput, CustomerListReadModel, CustomerRecord } from "./types";

export type CustomerRepositoryResult = {
  customer: CustomerRecord | null;
  warnings: string[];
};

export interface CustomerRepository {
  list(input: CustomerListInput): Promise<CustomerListReadModel>;
  getById(id: string): Promise<CustomerRepositoryResult>;
  findByEmail(email: string): Promise<CustomerRepositoryResult>;
  create(input: CreateCustomerInput): Promise<CustomerRepositoryResult>;
}

export type { CreateCustomerInput, CreateCustomerResult, CustomerListInput, CustomerListReadModel, CustomerRecord };
