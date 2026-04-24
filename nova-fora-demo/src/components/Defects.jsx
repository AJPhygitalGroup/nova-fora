import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { TodaysDefectsTable } from './RealDVIC';
import { CreateWorkOrderModal } from './FleetSnapshot';
import { dvicDefects, daList, fleetSnapshotVans } from '../data/mockData';

export default function Defects({ user }) {
  const [createWOContext, setCreateWOContext] = useState(null);

  const scheduledCount = dvicDefects.filter((d) => d.status === 'Scheduled').length;
  const rushOrderCount = dvicDefects.filter((d) => d.status === 'Rush Order').length;

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Defects</h2>
        <p className="text-navy-400 text-sm">All reported defects &mdash; filter by vendor, reject or convert to work orders</p>
      </div>

      <TodaysDefectsTable
        title="All Reported Defects"
        defects={dvicDefects}
        daList={daList}
        scheduledCount={scheduledCount}
        rushOrderCount={rushOrderCount}
        onReject={() => {}}
        onCreateWO={(d) => {
          const fleetVan = fleetSnapshotVans.find((fv) => fv.id === d.van);
          setCreateWOContext({
            van: fleetVan || null,
            defect: {
              section: d.section || '',
              part: d.category || '',
              description: d.desc,
              severity: d.severity,
            },
          });
        }}
        onOpenCreateDefect={() => { /* hook to existing Create Defect flow if desired */ }}
      />

      <AnimatePresence>
        {createWOContext && (
          <CreateWorkOrderModal
            initialVan={createWOContext.van}
            initialDefect={createWOContext.defect}
            vans={fleetSnapshotVans}
            user={user}
            onClose={() => setCreateWOContext(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
