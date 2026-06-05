/**
 * HomeRouter — role-aware Home tab.
 *
 * DSP roles (dsp_owner / dsp_manager / dsp_inspector / dsp_viewer) get
 * the legacy DVIC inspector landing (RealDVIC).
 *
 * Mechanical vendor roles (vendor_admin / service_writer / technician /
 * vendor_viewer) and site_admin get the VendorHome dashboard
 * introduced 2026-05-25: AMR / CMR KPIs, scheduled repairs, etc.
 *
 * Body repair vendors (org_type='body_repair_vendor') get the
 * BodyRepairFlow directly as their Home. The VendorHome's KPIs are
 * mechanical-only — vans inspected, ad-hoc defects, FMC approvals —
 * none of which apply to a collision shop. The body-repair queue IS
 * their workflow, so making it the landing matches what they need.
 *
 * Kept as a tiny wrapper so the Layout.jsx VIEW_CATALOG stays one row
 * per id (no role conditionals inside the catalog itself).
 */
import { isVendorRole } from '../lib/permissions';
import BodyRepairFlow from './BodyRepairFlow';
import RealDVIC from './RealDVIC';
import VendorHome from './VendorHome';

export default function HomeRouter(props) {
  if (props.user?.orgType === 'body_repair_vendor') {
    return <BodyRepairFlow {...props} />;
  }
  // Site admin sees the vendor home so they can validate the vendor
  // landing experience without re-impersonating.
  const useVendorView = isVendorRole(props.user) || props.user?.role === 'site_admin';
  if (useVendorView) return <VendorHome {...props} />;
  return <RealDVIC {...props} />;
}
