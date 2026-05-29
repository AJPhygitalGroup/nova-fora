/**
 * HomeRouter — role-aware Home tab.
 *
 * DSP roles (dsp_owner / dsp_manager / dsp_inspector / dsp_viewer) get
 * the legacy DVIC inspector landing (RealDVIC).
 *
 * Vendor roles (vendor_admin / service_writer / technician / vendor_viewer)
 * and site_admin get the new VendorHome dashboard introduced 2026-05-25
 * (mockup page 2): Upcoming DVIC banner + 5 KPI tiles + charts + filters.
 *
 * Kept as a tiny wrapper so the Layout.jsx VIEW_CATALOG stays one row
 * per id (no role conditionals inside the catalog itself).
 */
import { isVendorRole } from '../lib/permissions';
import RealDVIC from './RealDVIC';
import VendorHome from './VendorHome';

export default function HomeRouter(props) {
  // Site admin sees the vendor home so they can validate the vendor
  // landing experience without re-impersonating.
  const useVendorView = isVendorRole(props.user) || props.user?.role === 'site_admin';
  if (useVendorView) return <VendorHome {...props} />;
  return <RealDVIC {...props} />;
}
