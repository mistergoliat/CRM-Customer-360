import { PageHeader } from "@/components/ui/PageHeader";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { AutomationBuilderView } from "@/components/marketing/AutomationBuilderView";
import { getMarketingAutomationViewModel } from "@/lib/p1m/read-models";

type AutomationDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function AutomationDetailPage({ params }: AutomationDetailProps) {
  const { id } = await params;
  const automation = getMarketingAutomationViewModel(id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title={automation.name}
        description="Workflow visual de automatización. Sin motor real."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />
      <AutomationBuilderView automation={automation} />
    </div>
  );
}
