/**
 * Frontend-side role + permission helpers — mirror of
 * `apps/api/app/services/permissions.py`. Components should call these
 * helpers instead of comparing `user.role` against literals so adding a
 * new role is a single-file change here.
 *
 * Source of truth for the matrix lives on the backend; this file exists so
 * the UI can hide buttons/tabs the user couldn't use anyway, NOT to enforce
 * security (the API guards every mutation).
 */

// ── Taxonomy buckets ────────────────────────────────────────
const DSP_ROLES = new Set([
  'dsp_owner', 'dsp_manager', 'dsp_inspector', 'dsp_viewer',
]);

const VENDOR_ROLES = new Set([
  'vendor_admin', 'service_writer', 'technician', 'vendor_viewer',
]);

const PLATFORM_ROLES = new Set(['site_admin']);

// Org-level admins — full control of users + fleet/inspections/WOs. Use this
// in place of `user.role === 'dsp_owner' || user.role === 'vendor_admin'`.
const ORG_ADMIN_ROLES = new Set([
  'dsp_owner', 'dsp_manager',                    // DSP admin tier
  'vendor_admin', 'service_writer',              // Vendor admin tier
  'site_admin',                                  // Platform
]);

// Roles that can RUN inspections (DVIC walkaround). Inspectors are the
// canonical case; vendor techs do post-repair inspections; managers cover
// for inspectors when needed.
const CAN_INSPECT_ROLES = new Set([
  'dsp_owner', 'dsp_manager', 'dsp_inspector',
  'vendor_admin', 'technician',
  'site_admin',
]);

// Roles that can APPROVE/dismiss reported defects (the DSP-side gate
// before a defect becomes a work order). Inspector reports them; manager
// or owner approves.
const CAN_APPROVE_DEFECTS_ROLES = new Set([
  'dsp_owner', 'dsp_manager',
  'site_admin',
]);

// Roles that can manage VEHICLES (add/edit/delete + bulk upload). DSP-side.
const CAN_MANAGE_VEHICLES_ROLES = new Set([
  'dsp_owner', 'dsp_manager',
  'site_admin',
]);

// Roles that can ACT on work orders (assign, accept, decline, complete).
// Vendor-side — DSPs see WO status but don't move them through stages.
const CAN_MANAGE_WO_ROLES = new Set([
  'vendor_admin', 'service_writer', 'technician',
  'site_admin',
]);

// Read-only roles. Useful when we need to disable everything in bulk.
const VIEWER_ROLES = new Set([
  'dsp_viewer', 'vendor_viewer',
]);


// ── Coercion helper ─────────────────────────────────────────
function _role(userOrRole) {
  if (userOrRole == null) return null;
  if (typeof userOrRole === 'string') return userOrRole;
  return userOrRole.role || null;
}


// ── Public API ──────────────────────────────────────────────
export const isDspRole = (u) => DSP_ROLES.has(_role(u));
export const isVendorRole = (u) => VENDOR_ROLES.has(_role(u));
export const isPlatformRole = (u) => PLATFORM_ROLES.has(_role(u));

export const isOrgAdmin = (u) => ORG_ADMIN_ROLES.has(_role(u));
export const isViewer = (u) => VIEWER_ROLES.has(_role(u));

export const canInspect = (u) => CAN_INSPECT_ROLES.has(_role(u));
export const canApproveDefects = (u) => CAN_APPROVE_DEFECTS_ROLES.has(_role(u));
export const canManageVehicles = (u) => CAN_MANAGE_VEHICLES_ROLES.has(_role(u));
export const canManageWorkOrders = (u) => CAN_MANAGE_WO_ROLES.has(_role(u));

/**
 * Which "view mode" the fleet/dashboard pages should render in.
 *   'owner'      — DSP-owner-style: their own vans, full edit
 *   'dsp_reader' — DSP read-only (inspector/viewer)
 *   'vendor'     — vendor-side: assigned DSPs, WO management
 *   'admin'      — site admin god mode
 */
export function getViewMode(u) {
  const r = _role(u);
  if (r === 'site_admin') return 'admin';
  if (r === 'dsp_owner' || r === 'dsp_manager') return 'owner';
  if (r === 'dsp_inspector' || r === 'dsp_viewer') return 'dsp_reader';
  if (r === 'vendor_admin' || r === 'service_writer'
      || r === 'technician' || r === 'vendor_viewer') return 'vendor';
  return 'owner';  // safe default
}


// ── Invitation matrix (mirrors backend) ─────────────────────
export const INVITE_MATRIX = {
  site_admin: [
    'dsp_owner', 'dsp_manager', 'dsp_inspector', 'dsp_viewer',
    'vendor_admin', 'service_writer', 'technician', 'vendor_viewer',
    'site_admin',
  ],
  dsp_owner:      ['dsp_owner', 'dsp_manager', 'dsp_inspector', 'dsp_viewer'],
  dsp_manager:    ['dsp_inspector', 'dsp_viewer'],
  vendor_admin:   ['vendor_admin', 'service_writer', 'technician', 'vendor_viewer'],
  service_writer: ['technician', 'vendor_viewer'],
  // empty — not allowed to invite
  dsp_inspector:  [],
  dsp_viewer:     [],
  technician:     [],
  vendor_viewer:  [],
};

export function canInviteRole(inviter, target) {
  return (INVITE_MATRIX[_role(inviter)] || []).includes(target);
}

export function allowedInviteRoles(inviter) {
  return INVITE_MATRIX[_role(inviter)] || [];
}


// ── Friendly labels ─────────────────────────────────────────
export const ROLE_LABELS = {
  dsp_owner:      'DSP Owner',
  dsp_manager:    'DSP Manager',
  dsp_inspector:  'DSP Inspector',
  dsp_viewer:     'DSP Viewer',
  vendor_admin:   'Vendor Admin',
  service_writer: 'Service Writer',
  technician:     'Technician',
  vendor_viewer:  'Vendor Viewer',
  site_admin:     'Site Admin',
};

export const ROLE_DESCRIPTIONS = {
  dsp_owner:      'Full admin: billing, users, fleet, inspections, work orders.',
  dsp_manager:    'Manages fleet + WOs. Cannot manage users or billing.',
  dsp_inspector:  'Runs DVIC inspections + reports defects. Read-only on WOs.',
  dsp_viewer:     'Read-only across the DSP.',
  vendor_admin:   'Full admin: billing, users, WO acceptance, technician assignment.',
  service_writer: 'Receives WOs, assigns technicians, talks with the DSP.',
  technician:     'Picks up assigned WOs, marks progress, completes work.',
  vendor_viewer:  'Read-only across the vendor.',
  site_admin:     'Nova Fora team — full system access.',
};
