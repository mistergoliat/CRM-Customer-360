import { MarketingNav } from "@/components/marketing/MarketingNav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <MarketingNav />
      {children}
    </div>
  );
}
