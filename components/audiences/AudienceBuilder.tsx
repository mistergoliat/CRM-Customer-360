"use client";

import type { AudienceBuilderGroup, AudienceBuilderValidationError, AudienceCapabilitySchema } from "@/lib/marketing/customerIntelligenceAudience";
import { AudienceGroup } from "./AudienceGroup";

type Props = {
  readonly root: AudienceBuilderGroup;
  readonly schema: AudienceCapabilitySchema;
  readonly errors: readonly AudienceBuilderValidationError[];
  readonly onChange: (root: AudienceBuilderGroup) => void;
};

export function AudienceBuilder({ root, schema, errors, onChange }: Props) {
  const errorMap = new Map(errors.map((error) => [error.nodeId, error.message]));
  return (
    <div>
      <p className="mb-3 text-label-bold uppercase text-slate-500">Condiciones</p>
      <AudienceGroup group={root} depth={0} schema={schema} errors={errorMap} onChange={onChange} />
    </div>
  );
}
