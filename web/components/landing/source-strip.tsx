import { LogoLoop, type LoopMark } from "@/components/visual/logo-loop";

/**
 * The systems Canon reads from, which are exactly the values `sources.kind`
 * accepts — plus the Postgres the engine writes its own output to. If a kind is
 * added to the schema it belongs here too, and nothing belongs here that a
 * connector cannot actually read.
 */
const MARKS: readonly LoopMark[] = [
  { label: "Salesforce", role: "CRM side" },
  { label: "HubSpot", role: "CRM side" },
  { label: "Databricks", role: "Warehouse side" },
  { label: "Snowflake", role: "Warehouse side" },
  { label: "Postgres", role: "Decision store" },
  { label: "Synthetic", role: "Seeded benchmark" },
];

export function SourceStrip() {
  return (
    <section className="border-y border-hairline bg-surface-sunken">
      <div className="mx-auto max-w-[1120px] px-8 py-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <p className="shrink-0 text-label uppercase text-g-500">Reads from</p>
          <LogoLoop marks={MARKS} speed={38} className="min-w-0 flex-1" />
        </div>
      </div>
    </section>
  );
}
