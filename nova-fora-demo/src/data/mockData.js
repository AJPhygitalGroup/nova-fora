// ============================================================
// MOCK DATA — Nova Fora Demo (Amazon DSP Fleet Services)
// ============================================================

// Demo user accounts — one per role for the role-switcher flow
export const demoAccounts = [
  {
    id: 'usr-001',
    name: 'Tamika Gambrell',
    email: 'tamika@ribrell21.com',
    org: 'Ribrell 21',
    orgId: 'DSP-4201',
    orgType: 'dsp',
    role: 'dsp_owner',
    roleLabel: 'DSP Fleet Owner',
    avatar: 'TG',
    station: 'DSE4',
    notifications: 3,
    language: 'en',
  },
  {
    id: 'usr-002',
    name: 'Olger Joya',
    email: 'olger@dullesmidas.com',
    org: 'Dulles Midas',
    orgId: 'V-101',
    orgType: 'vendor',
    role: 'vendor_admin',
    roleLabel: 'Vendor Org Admin',
    avatar: 'OJ',
    station: null,
    notifications: 47,
    language: 'es',
  },
  {
    id: 'usr-003',
    name: 'David Torres',
    email: 'david@dullesmidas.com',
    org: 'Dulles Midas',
    orgId: 'V-101',
    orgType: 'vendor',
    role: 'technician',
    roleLabel: 'Technician',
    avatar: 'DT',
    station: null,
    notifications: 12,
    language: 'en',
  },
  {
    id: 'usr-004',
    name: 'Maria Chen',
    email: 'maria@novafora.com',
    org: 'Nova Fora',
    orgId: 'NF-000',
    orgType: 'platform',
    role: 'site_admin',
    roleLabel: 'Site Admin',
    avatar: 'MC',
    station: null,
    notifications: 0,
    language: 'en',
  },
];

// Views available per role (used to derive the navigation)
// Note: `dvic` is the new Home/command center. `defects` is the DSP-facing
// defects table that used to sit under Home as a sub-tab. Vendors & site
// admins still have `snapshot` as a top-level tab.
export const rolePermissions = {
  dsp_owner:    ['dvic', 'defects', 'vehicles', 'body', 'scorecard', 'rewards', 'admin'],
  vendor_admin: ['dvic', 'snapshot', 'work_orders', 'vehicles', 'body', 'scorecard', 'admin'],
  technician:   ['dvic', 'work_orders', 'vehicles', 'admin'],
  site_admin:   ['dvic', 'defects', 'snapshot', 'vehicles', 'work_orders', 'body', 'scorecard', 'rewards', 'admin', 'ghost'],
};

// ============================================================
// FLEET SNAPSHOT — heatmap view data
// ============================================================

// Severity labels: 'clean' | 'low' | 'medium' | 'high' | 'critical'
// Grounded vans have grounded: true (excluded from routing)
export const fleetSnapshotVans = [
  // DSP-4201 Ribrell 21 (12 vans)
  { id: 'VAN-1018', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2021 Mercedes Sprinter',  plate: 'WA-3K18-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 6:15 AM',  inspector: 'David Torres', grounded: false, mileage: 28340 },
  { id: 'VAN-1027', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2022 Ford Transit 250',   plate: 'WA-1A27-AZ', defectCount: 1, severity: 'low',      lastInspected: 'Today, 6:22 AM', inspector: 'David Torres', grounded: false, mileage: 42180 },
  { id: 'VAN-1033', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2023 Ford Transit 250',   plate: 'WA-1K33-AZ', defectCount: 3, severity: 'high',     lastInspected: 'Yesterday 7:02 PM', inspector: 'Olger Joya', grounded: false, mileage: 19250 },
  { id: 'VAN-1042', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2022 Ford Transit 250',   plate: 'WA-8F42-AZ', defectCount: 5, severity: 'critical', lastInspected: 'Today, 6:18 AM',  inspector: 'David Torres', grounded: false, mileage: 48250 },
  { id: 'VAN-1051', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2021 Ford Transit 250',   plate: 'WA-5A51-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 6:30 AM',  inspector: 'David Torres', grounded: false, mileage: 61420 },
  { id: 'VAN-1058', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2022 Mercedes Sprinter',  plate: 'WA-1B58-AZ', defectCount: 2, severity: 'medium',   lastInspected: 'Today, 6:45 AM',  inspector: 'David Torres', grounded: false, mileage: 33980 },
  { id: 'VAN-1063', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2023 Ram ProMaster 2500', plate: 'WA-6C63-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 7:00 AM',  inspector: 'David Torres', grounded: false, mileage: 12750 },
  { id: 'VAN-1072', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2021 Ford Transit 350',   plate: 'WA-7D72-AZ', defectCount: 4, severity: 'critical', lastInspected: 'Today, 5:50 AM',  inspector: 'Olger Joya',   grounded: true,  mileage: 78340, groundedReason: 'Brake failure — awaiting parts' },
  { id: 'VAN-1085', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2022 Ford Transit 250',   plate: 'WA-8E85-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 7:12 AM',  inspector: 'David Torres', grounded: false, mileage: 38210 },
  { id: 'VAN-1091', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2023 Mercedes Sprinter',  plate: 'WA-9F91-AZ', defectCount: 1, severity: 'low',      lastInspected: 'Today, 7:20 AM',  inspector: 'David Torres', grounded: false, mileage: 22410 },
  { id: 'VAN-1099', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2022 Ford Transit 250',   plate: 'WA-1G99-AZ', defectCount: 2, severity: 'medium',   lastInspected: 'Today, 6:55 AM',  inspector: 'David Torres', grounded: false, mileage: 44890 },
  { id: 'VAN-1104', dspId: 'DSP-4201', dsp: 'Ribrell 21',     model: '2021 Ram ProMaster 1500', plate: 'WA-2H04-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 7:05 AM',  inspector: 'David Torres', grounded: false, mileage: 67220 },

  // DSP-4202 Ceiba Routes (8 vans)
  { id: 'VAN-2009', dspId: 'DSP-4202', dsp: 'Ceiba Routes',   model: '2022 Ford Transit 250',   plate: 'WA-2P09-AZ', defectCount: 1, severity: 'low',      lastInspected: 'Today, 5:40 AM',  inspector: 'David Torres', grounded: false, mileage: 39550 },
  { id: 'VAN-2015', dspId: 'DSP-4202', dsp: 'Ceiba Routes',   model: '2023 Ram ProMaster 2500', plate: 'WA-2G15-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 5:55 AM',  inspector: 'David Torres', grounded: false, mileage: 16780 },
  { id: 'VAN-2022', dspId: 'DSP-4202', dsp: 'Ceiba Routes',   model: '2022 Mercedes Sprinter',  plate: 'WA-2M22-AZ', defectCount: 2, severity: 'medium',   lastInspected: 'Today, 6:00 AM',  inspector: 'David Torres', grounded: false, mileage: 51230 },
  { id: 'VAN-2031', dspId: 'DSP-4202', dsp: 'Ceiba Routes',   model: '2023 Ford Transit 250',   plate: 'WA-3N31-AZ', defectCount: 4, severity: 'critical', lastInspected: 'Today, 6:10 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 24560 },
  { id: 'VAN-2044', dspId: 'DSP-4202', dsp: 'Ceiba Routes',   model: '2021 Ford Transit 350',   plate: 'WA-4P44-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 6:20 AM',  inspector: 'David Torres', grounded: false, mileage: 73100 },
  { id: 'VAN-2051', dspId: 'DSP-4202', dsp: 'Ceiba Routes',   model: '2022 Ford Transit 250',   plate: 'WA-5Q51-AZ', defectCount: 3, severity: 'high',     lastInspected: 'Today, 6:35 AM',  inspector: 'David Torres', grounded: false, mileage: 47890 },
  { id: 'VAN-2066', dspId: 'DSP-4202', dsp: 'Ceiba Routes',   model: '2023 Mercedes Sprinter',  plate: 'WA-6R66-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 6:50 AM',  inspector: 'David Torres', grounded: false, mileage: 18900 },
  { id: 'VAN-2077', dspId: 'DSP-4202', dsp: 'Ceiba Routes',   model: '2022 Ram ProMaster 1500', plate: 'WA-7S77-AZ', defectCount: 1, severity: 'low',      lastInspected: 'Today, 7:00 AM',  inspector: 'David Torres', grounded: false, mileage: 35670 },

  // DSP-4203 TOTL (8 vans)
  { id: 'VAN-3021', dspId: 'DSP-4203', dsp: 'TOTL',           model: '2022 Ford Transit 350',   plate: 'WA-5H21-AZ', defectCount: 2, severity: 'medium',   lastInspected: 'Today, 5:30 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 52340 },
  { id: 'VAN-3044', dspId: 'DSP-4203', dsp: 'TOTL',           model: '2023 Mercedes Sprinter',  plate: 'WA-6M44-AZ', defectCount: 1, severity: 'low',      lastInspected: 'Today, 5:45 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 28110 },
  { id: 'VAN-3055', dspId: 'DSP-4203', dsp: 'TOTL',           model: '2022 Ford Transit 250',   plate: 'WA-7N55-AZ', defectCount: 5, severity: 'critical', lastInspected: 'Today, 5:20 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 65420 },
  { id: 'VAN-3062', dspId: 'DSP-4203', dsp: 'TOTL',           model: '2021 Ram ProMaster 2500', plate: 'WA-8O62-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 6:00 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 81900 },
  { id: 'VAN-3077', dspId: 'DSP-4203', dsp: 'TOTL',           model: '2022 Ford Transit 350',   plate: 'WA-9P77-AZ', defectCount: 3, severity: 'high',     lastInspected: 'Today, 6:15 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 41500 },
  { id: 'VAN-3081', dspId: 'DSP-4203', dsp: 'TOTL',           model: '2023 Mercedes Sprinter',  plate: 'WA-1Q81-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 6:30 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 14230 },
  { id: 'VAN-3089', dspId: 'DSP-4203', dsp: 'TOTL',           model: '2022 Ford Transit 250',   plate: 'WA-2R89-AZ', defectCount: 2, severity: 'medium',   lastInspected: 'Today, 6:45 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 37680 },
  { id: 'VAN-3095', dspId: 'DSP-4203', dsp: 'TOTL',           model: '2021 Ford Transit 250',   plate: 'WA-3S95-AZ', defectCount: 1, severity: 'low',      lastInspected: 'Today, 7:00 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 59120 },

  // DSP-4204 Summit Express (6 vans)
  { id: 'VAN-4005', dspId: 'DSP-4204', dsp: 'Summit Express', model: '2021 Ford Transit 250',   plate: 'WA-4B05-AZ', defectCount: 3, severity: 'high',     lastInspected: 'Today, 5:15 AM',  inspector: 'David Torres', grounded: false, mileage: 55430 },
  { id: 'VAN-4018', dspId: 'DSP-4204', dsp: 'Summit Express', model: '2022 Mercedes Sprinter',  plate: 'WA-5C18-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 5:30 AM',  inspector: 'David Torres', grounded: false, mileage: 26780 },
  { id: 'VAN-4029', dspId: 'DSP-4204', dsp: 'Summit Express', model: '2023 Ford Transit 350',   plate: 'WA-6D29-AZ', defectCount: 1, severity: 'low',      lastInspected: 'Today, 5:45 AM',  inspector: 'David Torres', grounded: false, mileage: 13420 },
  { id: 'VAN-4036', dspId: 'DSP-4204', dsp: 'Summit Express', model: '2022 Ram ProMaster 1500', plate: 'WA-7E36-AZ', defectCount: 4, severity: 'critical', lastInspected: 'Today, 6:00 AM',  inspector: 'David Torres', grounded: false, mileage: 48910 },
  { id: 'VAN-4047', dspId: 'DSP-4204', dsp: 'Summit Express', model: '2021 Ford Transit 250',   plate: 'WA-8F47-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 6:15 AM',  inspector: 'David Torres', grounded: false, mileage: 69230 },
  { id: 'VAN-4052', dspId: 'DSP-4204', dsp: 'Summit Express', model: '2022 Ford Transit 250',   plate: 'WA-9G52-AZ', defectCount: 2, severity: 'medium',   lastInspected: 'Today, 6:30 AM',  inspector: 'David Torres', grounded: false, mileage: 33580 },

  // DSP-4205 Redmond Routes (6 vans)
  { id: 'VAN-5008', dspId: 'DSP-4205', dsp: 'Redmond Routes', model: '2022 Ram ProMaster 1500', plate: 'WA-7R08-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 5:00 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 21560 },
  { id: 'VAN-5012', dspId: 'DSP-4205', dsp: 'Redmond Routes', model: '2023 Ford Transit 350',   plate: 'WA-7R12-AZ', defectCount: 5, severity: 'critical', lastInspected: 'Today, 5:15 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 17890 },
  { id: 'VAN-5023', dspId: 'DSP-4205', dsp: 'Redmond Routes', model: '2022 Mercedes Sprinter',  plate: 'WA-8S23-AZ', defectCount: 1, severity: 'low',      lastInspected: 'Today, 5:30 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 41230 },
  { id: 'VAN-5034', dspId: 'DSP-4205', dsp: 'Redmond Routes', model: '2021 Ford Transit 250',   plate: 'WA-9T34-AZ', defectCount: 0, severity: 'clean',    lastInspected: 'Today, 5:45 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 74590 },
  { id: 'VAN-5041', dspId: 'DSP-4205', dsp: 'Redmond Routes', model: '2023 Ford Transit 250',   plate: 'WA-1U41-AZ', defectCount: 2, severity: 'medium',   lastInspected: 'Today, 6:00 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 19340 },
  { id: 'VAN-5055', dspId: 'DSP-4205', dsp: 'Redmond Routes', model: '2022 Ford Transit 350',   plate: 'WA-2V55-AZ', defectCount: 3, severity: 'high',     lastInspected: 'Today, 6:15 AM',  inspector: 'Olger Joya',   grounded: false, mileage: 52870 },
];

// Detailed defects for the most interesting vans (shown in Vehicle Report Card)
export const fleetSnapshotDefectDetails = {
  'VAN-1042': [
    { id: 'FD-001', section: '1. Front Side',     part: 'Windshield',    severity: 'High',     description: 'Crack spreading from stone chip', reportedAt: 'Today 6:18 AM',   status: 'pending',    hasPhoto: true },
    { id: 'FD-002', section: '1. Front Side',     part: 'Turn signals',  severity: 'Medium',   description: 'Passenger-side blinker intermittent', reportedAt: 'Today 6:18 AM', status: 'pending',    hasPhoto: true },
    { id: 'FD-003', section: '4. Back Side',      part: 'Brake lights',  severity: 'Critical', description: 'Both brake lights not illuminating', reportedAt: 'Today 6:18 AM',  status: 'acknowledged', hasPhoto: true },
    { id: 'FD-004', section: '2. Driver Side',    part: 'Tire tread',    severity: 'High',     description: 'Tread at 2/32" — below DOT minimum', reportedAt: 'Yesterday 7:02 PM', status: 'pending', hasPhoto: true },
    { id: 'FD-005', section: '5. In-Cab',         part: 'Dashboard',     severity: 'Medium',   description: 'Check Engine light intermittent',   reportedAt: '3 days ago',      status: 'sent_to_vendor', hasPhoto: false },
  ],
  'VAN-1072': [
    { id: 'FD-010', section: '2. Driver Side',    part: 'Brakes',        severity: 'Critical', description: 'Complete brake failure — emergency stop only', reportedAt: 'Today 5:50 AM', status: 'sent_to_vendor', hasPhoto: true },
    { id: 'FD-011', section: '4. Back Side',      part: 'Rear tires',    severity: 'High',     description: 'Sidewall bulge on rear-right tire',    reportedAt: 'Today 5:50 AM', status: 'acknowledged', hasPhoto: true },
    { id: 'FD-012', section: '5. In-Cab',         part: 'Warning lights',severity: 'Critical', description: 'ABS + ESP warning lights on',    reportedAt: 'Today 5:50 AM', status: 'acknowledged', hasPhoto: true },
    { id: 'FD-013', section: '3. Passenger Side', part: 'Side mirror',   severity: 'Low',      description: 'Housing crack, lens intact',     reportedAt: 'Yesterday', status: 'pending', hasPhoto: false },
  ],
  'VAN-3055': [
    { id: 'FD-020', section: '4. Back Side',      part: 'Cargo door',    severity: 'High',     description: 'Latch mechanism binding — difficult to close', reportedAt: 'Today 5:20 AM', status: 'sent_to_vendor', hasPhoto: true },
    { id: 'FD-021', section: '1. Front Side',     part: 'Headlights',    severity: 'High',     description: 'Low-beam driver side out',       reportedAt: 'Today 5:20 AM', status: 'pending', hasPhoto: true },
    { id: 'FD-022', section: '5. In-Cab',         part: 'Seat belts',    severity: 'Medium',   description: 'Driver seat belt retractor slow', reportedAt: '2 days ago',    status: 'acknowledged', hasPhoto: false },
    { id: 'FD-023', section: '2. Driver Side',    part: 'Sliding door',  severity: 'Medium',   description: 'Track needs lubrication',        reportedAt: '2 days ago',    status: 'pending', hasPhoto: false },
    { id: 'FD-024', section: '3. Passenger Side', part: 'Tire tread',    severity: 'Critical', description: 'Tread at 1/32" — unsafe to operate', reportedAt: 'Today 5:20 AM', status: 'sent_to_vendor', hasPhoto: true },
  ],
  'VAN-5012': [
    { id: 'FD-030', section: '2. Driver Side',    part: 'Tire tread',    severity: 'Critical', description: 'Severely worn, cords visible', reportedAt: 'Today 5:15 AM', status: 'pending', hasPhoto: true },
    { id: 'FD-031', section: '1. Front Side',     part: 'Windshield',    severity: 'High',     description: 'Large crack obstructing view', reportedAt: 'Today 5:15 AM', status: 'acknowledged', hasPhoto: true },
    { id: 'FD-032', section: '5. In-Cab',         part: 'Horn',          severity: 'Medium',   description: 'Horn intermittent',            reportedAt: 'Today 5:15 AM', status: 'pending', hasPhoto: false },
    { id: 'FD-033', section: '4. Back Side',      part: 'Reverse lights',severity: 'Medium',   description: 'Both reverse lights out',      reportedAt: 'Today 5:15 AM', status: 'pending', hasPhoto: true },
    { id: 'FD-034', section: '3. Passenger Side', part: 'Side mirror',   severity: 'Low',      description: 'Electric adjust not working',  reportedAt: 'Yesterday',     status: 'acknowledged', hasPhoto: false },
  ],
};

// ============================================================
// ADMIN — Organization users, PM settings, custom defects
// ============================================================
// Vendor users carry a list of DSP IDs they're assigned to handle
// (empty array or special 'all' means they serve every DSP).
export const orgUsers = [
  // Ribrell 21 (DSP) users — no DSP assignment (they ARE the DSP)
  { id: 'u-001', dspId: 'DSP-4201', name: 'Tamika Gambrell',  email: 'tamika@ribrell21.com',   roles: ['org_admin', 'fleet_owner'], assignedDsps: [], lastLoginAt: '2026-04-21T07:14:00', invitedBy: 'Self', twoFAEnabled: true,  status: 'active' },
  { id: 'u-002', dspId: 'DSP-4201', name: 'Marcus Green',     email: 'marcus@ribrell21.com',   roles: ['rfp_sender'],               assignedDsps: [], lastLoginAt: '2026-04-20T18:30:00', invitedBy: 'Tamika Gambrell', twoFAEnabled: false, status: 'active' },
  { id: 'u-003', dspId: 'DSP-4201', name: 'Carlos Mendez',    email: 'carlos@ribrell21.com',   roles: ['fleet_owner'],              assignedDsps: [], lastLoginAt: '2026-04-19T14:00:00', invitedBy: 'Tamika Gambrell', twoFAEnabled: false, status: 'pending' },
  // Dulles Midas (Vendor) users — each user serves a subset of DSPs
  { id: 'u-101', dspId: 'V-101',    name: 'Olger Joya',       email: 'olger@dullesmidas.com',  roles: ['org_admin', 'vendor', 'fleet_manager', 'technician'], assignedDsps: ['DSP-4201','DSP-4202','DSP-4203','DSP-4204','DSP-4205'], lastLoginAt: '2026-04-21T06:00:00', invitedBy: 'Self', twoFAEnabled: true,  status: 'active' },
  { id: 'u-102', dspId: 'V-101',    name: 'David Torres',     email: 'david@dullesmidas.com',  roles: ['vendor', 'fleet_manager', 'technician'],              assignedDsps: ['DSP-4201','DSP-4202','DSP-4204'], lastLoginAt: '2026-04-21T05:30:00', invitedBy: 'Olger Joya', twoFAEnabled: false, status: 'active' },
  { id: 'u-103', dspId: 'V-101',    name: 'Mike Chen',        email: 'mike@dullesmidas.com',   roles: ['technician'],              assignedDsps: ['DSP-4203','DSP-4205'], lastLoginAt: '2026-04-20T20:00:00', invitedBy: 'Olger Joya', twoFAEnabled: false, status: 'active' },
  { id: 'u-104', dspId: 'V-101',    name: 'Sarah Johnson',    email: 'sarah@dullesmidas.com',  roles: ['technician'],              assignedDsps: ['DSP-4201','DSP-4203'], lastLoginAt: '2026-04-18T09:15:00', invitedBy: 'Olger Joya', twoFAEnabled: false, status: 'active' },
  { id: 'u-105', dspId: 'V-101',    name: 'Lisa Rodriguez',   email: 'lisa@dullesmidas.com',   roles: ['subcontract_assigner'],     assignedDsps: ['DSP-4202'], lastLoginAt: null,                  invitedBy: 'Olger Joya', twoFAEnabled: false, status: 'invited' },
];

// DSPs that a vendor can assign to its users (derived from the fleet, but exported here for reuse)
export const VENDOR_ASSIGNABLE_DSPS = [
  { id: 'DSP-4201', name: 'Ribrell 21',       code: 'RBR', station: 'DSE4', vanCount: 12 },
  { id: 'DSP-4202', name: 'Ceiba Routes',     code: 'CBR', station: 'DSE4', vanCount: 8 },
  { id: 'DSP-4203', name: 'TOTL Logistics',   code: 'TTL', station: 'DWA6', vanCount: 8 },
  { id: 'DSP-4204', name: 'Summit Express',   code: 'SEX', station: 'DWA6', vanCount: 6 },
  { id: 'DSP-4205', name: 'Redmond Routes',   code: 'RDM', station: 'DSE4', vanCount: 6 },
];

// Each role declares which org type it applies to. The admin invite/edit UI filters
// the list based on the admin's own org type so e.g. a Vendor Admin cannot create
// Fleet Owner (DSP-only) or Site Admin (platform-only) users.
// appliesTo: 'dsp' | 'vendor' | 'both' | 'platform'
export const AVAILABLE_ROLES = [
  { id: 'org_admin',            label: 'Org Admin',            description: 'Full access to organization settings and users',   appliesTo: 'both' },
  { id: 'fleet_owner',          label: 'Fleet Owner',          description: 'Manages DSP fleet and dispatches WOs',            appliesTo: 'dsp' },
  { id: 'rfp_sender',           label: 'RFP Sender',           description: 'Can send Request for Proposals',                   appliesTo: 'dsp' },
  { id: 'fleet_manager',        label: 'Fleet Manager',        description: 'Vendor user managing multiple DSPs',              appliesTo: 'vendor' },
  { id: 'vendor',               label: 'Vendor',               description: 'Repair shop capabilities',                         appliesTo: 'vendor' },
  { id: 'technician',           label: 'Technician',           description: 'Performs inspections and completes WOs',          appliesTo: 'vendor' },
  { id: 'subcontract_assigner', label: 'Subcontract Assigner', description: 'Can subcontract WOs to other vendors',            appliesTo: 'vendor' },
];

// Helper: returns the roles an admin of a given org type is allowed to grant to its users
export function rolesAssignableBy(orgType) {
  // Site admin can grant anything; org admins can only grant roles that apply to their own org type
  if (orgType === 'platform') return AVAILABLE_ROLES;
  return AVAILABLE_ROLES.filter((r) => r.appliesTo === 'both' || r.appliesTo === orgType);
}

// PM intervals grouped by vehicle type. Branded Cargo is managed by Amazon
// and read-only; the other classes are editable by the DSP owner.
export const pmIntervalsByVehicleType = [
  {
    type: 'Branded Cargo',
    locked: true,
    lockReason: 'Managed by Amazon — intervals are standardized across the Branded Cargo fleet',
    intervals: [
      { id: 'bc-oil',     service: 'Synthetic oil change',      mode: 'every', miles: 6000 },
      { id: 'bc-diff',    service: 'Rear differential service', mode: 'every', miles: 240000 },
      { id: 'bc-plugs',   service: 'Spark plugs',               mode: 'every', miles: 100000 },
    ],
  },
  {
    type: 'Step Van',
    locked: false,
    intervals: [
      { id: 'sv-cabin',   service: 'Cabin air filter',          mode: 'every', miles: 40000 },
      { id: 'sv-belt',    service: 'Serpentine belt',           mode: 'every', miles: 80000 },
      { id: 'sv-trans',   service: '5VC auto transmission',     mode: 'at',    milesList: [40000, 100000, 160000] },
    ],
  },
  {
    type: 'Owned',
    locked: false,
    intervals: [
      { id: 'ow-plugs',   service: 'Spark plugs',               mode: 'every', miles: 96000 },
      { id: 'ow-coolant', service: 'Coolant system service',    mode: 'every', miles: 96000 },
      { id: 'ow-diff',    service: 'Rear differential service', mode: 'every', miles: 150000 },
    ],
  },
  {
    type: 'Rental',
    locked: false,
    intervals: [
      { id: 'rn-oil',     service: 'Oil change',                mode: 'every', miles: 5000 },
      { id: 'rn-tires',   service: 'Tire rotation',             mode: 'every', miles: 7500 },
      { id: 'rn-brakes',  service: 'Brake inspection',          mode: 'every', miles: 25000 },
    ],
  },
];

export const preventiveMaintenanceJobs = [
  { id: 'PM-001', vehicleId: 'VAN-1042', dspId: 'DSP-4201', type: 'Oil Change',        triggerType: 'mileage',  triggerAt: 50000, currentValue: 48250, status: 'upcoming', dueAt: '2026-04-25', vendor: 'ProFleet Auto Care' },
  { id: 'PM-002', vehicleId: 'VAN-1058', dspId: 'DSP-4201', type: 'Tire Rotation',     triggerType: 'mileage',  triggerAt: 35000, currentValue: 33980, status: 'upcoming', dueAt: '2026-04-28', vendor: 'Discount Tire Commercial' },
  { id: 'PM-003', vehicleId: 'VAN-2009', dspId: 'DSP-4202', type: 'Brake Inspection',  triggerType: 'calendar', triggerAt: '2026-05-01', currentValue: null, status: 'scheduled', dueAt: '2026-05-01', vendor: 'Dulles Midas' },
  { id: 'PM-004', vehicleId: 'VAN-3021', dspId: 'DSP-4203', type: 'Full Service',      triggerType: 'mileage',  triggerAt: 55000, currentValue: 52340, status: 'upcoming', dueAt: '2026-05-05', vendor: 'ProFleet Auto Care' },
  { id: 'PM-005', vehicleId: 'VAN-1018', dspId: 'DSP-4201', type: 'Oil Change',        triggerType: 'mileage',  triggerAt: 30000, currentValue: 28340, status: 'upcoming', dueAt: '2026-04-30', vendor: 'ProFleet Auto Care' },
  { id: 'PM-006', vehicleId: 'VAN-5012', dspId: 'DSP-4205', type: 'Alignment',         triggerType: 'calendar', triggerAt: '2026-04-26', currentValue: null, status: 'scheduled', dueAt: '2026-04-26', vendor: 'Dulles Midas' },
];

// ============================================================
// DVIC Defect Catalog — the list of items the inspector checks per vehicle
// type. Amazon items are read-only; DSP / Vendor custom items can be added
// but only DFS admins fill Group/Class/Line/Response Type.
// ============================================================
export const dvicDefectCatalog = {
  cargo: [
    { id: 'd-c1', source: 'Amazon', section: 'General',     part: 'Cleanliness',  defect: 'Interior has trash or excessive grime/dust present',       group: 'Detailing', class: '???',        line: '???',         responseType: 'Yes/No' },
    { id: 'd-c2', source: 'DSP',    section: 'General',     part: 'Accessories',  defect: 'EZ Pass is missing or not attached to the windshield',     group: 'Customer',  class: 'Restricted', line: 'Convenience', responseType: 'Yes/No' },
    { id: 'd-c3', source: 'Amazon', section: 'Front',       part: 'Lights',       defect: 'Headlight is not working',                                  group: 'AMR',       class: 'ULC',        line: 'Lights',      responseType: 'Yes/No' },
    { id: 'd-c4', source: 'Vendor', section: 'Front',       part: 'Suspension',   defect: 'Coolant is low',                                            group: 'AMR',       class: 'ULC',        line: 'Fluids',      responseType: 'Yes/No' },
    { id: 'd-c5', source: 'Amazon', section: 'Driver Side', part: 'Front tire',   defect: 'Tire has insufficient tread (less than 4/32")',            group: 'Tires',     class: 'Restricted', line: 'Data',        responseType: 'Numeric' },
    { id: 'd-c6', source: 'Amazon', section: 'Back Side',   part: 'Brake lights', defect: 'Brake light is not working',                                group: 'AMR',       class: 'ULC',        line: 'Lights',      responseType: 'Yes/No' },
    { id: 'd-c7', source: 'Amazon', section: 'In-Cab',      part: 'Dashboard',    defect: 'Warning light is illuminated',                              group: 'AMR',       class: 'ULC',        line: 'Dashboard',   responseType: 'Yes/No' },
    { id: 'd-c8', source: 'DSP',    section: 'Passenger',   part: 'Sliding door', defect: 'Door track needs lubrication',                              group: 'Customer',  class: 'Restricted', line: 'Mechanical',  responseType: 'Yes/No' },
  ],
  dot: [
    { id: 'd-d1', source: 'Amazon', section: 'Brakes',      part: 'Service brakes',  defect: 'Service brakes not functioning correctly',               group: 'AMR',   class: 'ULC',        line: 'Safety',      responseType: 'Yes/No' },
    { id: 'd-d2', source: 'Amazon', section: 'Brakes',      part: 'Parking brake',   defect: 'Parking brake not holding vehicle on grade',             group: 'AMR',   class: 'ULC',        line: 'Safety',      responseType: 'Yes/No' },
    { id: 'd-d3', source: 'Amazon', section: 'Steering',    part: 'Steering wheel',  defect: 'Excessive play in steering wheel (>2 in)',               group: 'AMR',   class: 'ULC',        line: 'Safety',      responseType: 'Numeric' },
    { id: 'd-d4', source: 'Amazon', section: 'Exhaust',     part: 'Exhaust system',  defect: 'Exhaust leak detected',                                   group: 'AMR',   class: 'ULC',        line: 'Safety',      responseType: 'Yes/No' },
    { id: 'd-d5', source: 'Amazon', section: 'Coupling',    part: 'Hitch',           defect: 'Coupling devices damaged or missing hardware',            group: 'AMR',   class: 'Restricted', line: 'Safety',      responseType: 'Yes/No' },
    { id: 'd-d6', source: 'Amazon', section: 'Fuel',        part: 'Fuel tank',       defect: 'Fuel leak or tank damage',                                group: 'AMR',   class: 'ULC',        line: 'Safety',      responseType: 'Yes/No' },
  ],
  ev: [
    { id: 'd-e1', source: 'Amazon', section: 'Battery',     part: 'High-voltage',    defect: 'Battery state of health below 80%',                       group: 'AMR',   class: 'EV',         line: 'Data',        responseType: 'Numeric' },
    { id: 'd-e2', source: 'Amazon', section: 'Charging',    part: 'Charge port',     defect: 'Charge port damaged or not sealing',                      group: 'AMR',   class: 'EV',         line: 'Charging',    responseType: 'Yes/No' },
    { id: 'd-e3', source: 'Amazon', section: 'Battery',     part: 'Coolant',         defect: 'Battery coolant loop warning',                            group: 'AMR',   class: 'EV',         line: 'Fluids',      responseType: 'Yes/No' },
    { id: 'd-e4', source: 'DSP',    section: 'Charging',    part: 'Cable',           defect: 'Home-base charger cable damaged',                         group: 'Customer', class: 'Restricted', line: 'Equipment',  responseType: 'Yes/No' },
    { id: 'd-e5', source: 'Amazon', section: 'Regen',       part: 'Regen brakes',    defect: 'Regenerative braking warning illuminated',                group: 'AMR',   class: 'EV',         line: 'Dashboard',   responseType: 'Yes/No' },
  ],
};

export const DVIC_TEMPLATES = [
  { id: 'cargo', label: 'DVIC (Cargo)', description: 'Standard cargo van inspection items' },
  { id: 'dot',   label: 'DVIC (DOT)',   description: 'DOT-mandated commercial vehicle items' },
  { id: 'ev',    label: 'DVIC (EV)',    description: 'Electric vehicle specific items' },
];

// Defect categories — each DSP configures which ones are auto-approved
// instead of needing manual review before a WO is created
// Available vendors that DSPs can send WOs to — includes services offered,
// rating, response-time stats, and current load so the DSP can pick wisely.
export const availableVendors = [
  { id: 'V-101', name: 'Dulles Midas',          rating: 4.7, services: ['mechanical', 'electrical', 'brakes', 'pm', 'body', 'windshield'], city: 'Seattle, WA',  responseTime: '2h avg', activeJobs: 12, distance: '4.2 mi', preferred: true },
  { id: 'V-102', name: 'ProFleet Auto Care',    rating: 4.8, services: ['mechanical', 'pm', 'tires', 'fluids'],                              city: 'Bellevue, WA', responseTime: '3h avg', activeJobs: 8,  distance: '6.8 mi', preferred: false },
  { id: 'V-103', name: 'Evergreen Body Works',  rating: 4.3, services: ['body', 'paint', 'windshield'],                                      city: 'Tacoma, WA',   responseTime: '4h avg', activeJobs: 5,  distance: '28 mi',  preferred: false },
  { id: 'V-104', name: 'Discount Tire',         rating: 4.9, services: ['tires', 'mechanical', 'fluids'],                                    city: 'Redmond, WA',  responseTime: '1h avg', activeJobs: 3,  distance: '9.1 mi', preferred: false },
  { id: 'V-105', name: 'Spotless Mobile Detail',rating: 4.1, services: ['cleaning'],                                                         city: 'Kent, WA',     responseTime: '5h avg', activeJobs: 2,  distance: '14 mi',  preferred: false },
  { id: 'V-106', name: 'Pacific Glass Co.',     rating: 4.6, services: ['windshield', 'body'],                                               city: 'Seattle, WA',  responseTime: '3h avg', activeJobs: 4,  distance: '5.5 mi', preferred: false },
];

// Sections → categories for matching vendor services
export const SECTION_TO_SERVICES = {
  '1. Front Side':     ['body', 'lights', 'windshield'],
  '2. Driver Side':    ['body', 'mirrors', 'tires'],
  '3. Passenger Side': ['body', 'mirrors', 'tires'],
  '4. Back Side':      ['body', 'lights'],
  '5. In-Cab':         ['mechanical', 'electrical', 'hvac'],
};

export const DEFECT_CATEGORIES = [
  { id: 'tires',       label: 'Tires',              description: 'Tread wear, pressure, sidewall damage',   iconKey: 'Circle',      typicalCost: '$100–$400',  defaultOn: true,  defaultThreshold: 'low_medium' },
  { id: 'lights',      label: 'Lights',             description: 'Headlights, tail lights, turn signals',   iconKey: 'Lightbulb',   typicalCost: '$25–$150',   defaultOn: true,  defaultThreshold: 'all' },
  { id: 'fluids',      label: 'Fluids',             description: 'Coolant, oil, brake fluid, washer',       iconKey: 'Droplet',     typicalCost: '$30–$200',   defaultOn: true,  defaultThreshold: 'low_medium' },
  { id: 'wipers',      label: 'Wiper Blades',       description: 'Wiper replacement or adjustment',         iconKey: 'Wind',        typicalCost: '$15–$60',    defaultOn: true,  defaultThreshold: 'all' },
  { id: 'emergency',   label: 'Emergency Kit',      description: 'Replace missing safety kit items',        iconKey: 'LifeBuoy',    typicalCost: '$40–$120',   defaultOn: true,  defaultThreshold: 'all' },
  { id: 'mirrors',     label: 'Side Mirrors',       description: 'Housing, lens or adjustment',             iconKey: 'Eye',         typicalCost: '$80–$300',   defaultOn: false, defaultThreshold: 'low' },
  { id: 'brakes',      label: 'Brakes',             description: 'Pads, rotors, fluid, calipers',           iconKey: 'Gauge',       typicalCost: '$200–$900',  defaultOn: false, defaultThreshold: 'none' },
  { id: 'body',        label: 'Body',               description: 'Dents, scratches, panel damage',          iconKey: 'Car',         typicalCost: '$300–$2,500', defaultOn: false, defaultThreshold: 'none' },
  { id: 'windshield',  label: 'Windshield & Glass', description: 'Cracks, chips, replacements',             iconKey: 'Shield',      typicalCost: '$250–$800',  defaultOn: false, defaultThreshold: 'none' },
  { id: 'dashboard',   label: 'Dashboard',          description: 'Warning lights, instrument panel',        iconKey: 'MonitorSmartphone', typicalCost: '$100–$800', defaultOn: false, defaultThreshold: 'none' },
  { id: 'hvac',        label: 'HVAC',               description: 'A/C, heater, fan, filters',               iconKey: 'ThermometerSun', typicalCost: '$100–$1,200', defaultOn: false, defaultThreshold: 'none' },
  { id: 'other',       label: 'Other / Uncategorized', description: 'Anything that doesn\'t fit above',     iconKey: 'HelpCircle',  typicalCost: 'Varies',     defaultOn: false, defaultThreshold: 'none' },
];

export const SEVERITY_THRESHOLDS = [
  { id: 'none',       label: 'Manual approval only', description: 'Every defect requires human approval',       color: 'navy-400' },
  { id: 'low',        label: 'Low only',             description: 'Auto-approve only Low severity',              color: 'accent-blue' },
  { id: 'low_medium', label: 'Low + Medium',         description: 'Auto-approve Low and Medium severity',        color: 'accent-gold' },
  { id: 'all',        label: 'All severities',       description: 'Auto-approve regardless of severity',         color: 'accent-green' },
];

export const VENDOR_SERVICES = [
  { id: 'mechanical',  label: 'Mechanical',       icon: 'Wrench' },
  { id: 'electrical',  label: 'Electrical',       icon: 'Zap' },
  { id: 'body',        label: 'Body',             icon: 'Car' },
  { id: 'paint',       label: 'Paint',            icon: 'Paintbrush' },
  { id: 'windshield',  label: 'Windshield',       icon: 'Shield' },
  { id: 'upholstery',  label: 'Upholstery',       icon: 'Armchair' },
  { id: 'cleaning',    label: 'Cleaning / Detail', icon: 'Sparkles' },
  { id: 'pm',          label: 'Preventive Maint.', icon: 'ClipboardCheck' },
  { id: 'tires',       label: 'Tires',            icon: 'Circle' },
  { id: 'parts',       label: 'Parts',            icon: 'Package' },
];

// ============================================================
// NOTIFICATIONS — role-based, with grouping + mark-read
// ============================================================
export const notificationsSeed = [
  // DSP Owner (Tamika) notifications
  { id: 'n-001', userId: 'usr-001', type: 'wo_completed', title: 'Work order completed', message: 'VAN-1099 — Horn replacement completed by David Torres', relatedId: 'WO-54015', createdAt: '2026-04-21T06:45:00', read: false, iconColor: 'accent-green' },
  { id: 'n-002', userId: 'usr-001', type: 'defect_reported', title: 'New defect reported', message: 'VAN-1042 — Windshield crack reported by Marcus Green', relatedId: 'WO-54001', createdAt: '2026-04-21T06:18:00', read: false, iconColor: 'accent-orange' },
  { id: 'n-003', userId: 'usr-001', type: 'rush_order', title: 'Rush order created', message: 'VAN-1042 — Brake lights critical, scheduled tonight 22:00', relatedId: 'WO-54002', createdAt: '2026-04-21T06:18:00', read: false, iconColor: 'accent-red' },
  { id: 'n-004', userId: 'usr-001', type: 'grounded', title: 'Vehicle grounded', message: 'VAN-1072 — Grounded: Brake failure — awaiting parts', relatedId: 'VAN-1072', createdAt: '2026-04-21T05:50:00', read: true, iconColor: 'accent-red' },
  { id: 'n-005', userId: 'usr-001', type: 'pm_due', title: 'PM due soon', message: 'VAN-1042 Oil Change due at 50,000 mi (currently 48,250)', relatedId: 'PM-001', createdAt: '2026-04-20T10:00:00', read: true, iconColor: 'accent-gold' },

  // Vendor Admin (Olger) notifications
  { id: 'n-101', userId: 'usr-002', type: 'wo_pending', title: 'New work order', message: 'VAN-1042 — Windshield crack from Ribrell 21', relatedId: 'WO-54001', createdAt: '2026-04-21T06:18:00', read: false, iconColor: 'accent-gold' },
  { id: 'n-102', userId: 'usr-002', type: 'rush_order', title: 'RUSH ORDER', message: 'VAN-3055 — Tire tread at 1/32" — TOTL requesting tonight', relatedId: 'WO-54004', createdAt: '2026-04-21T05:20:00', read: false, iconColor: 'accent-red' },
  { id: 'n-103', userId: 'usr-002', type: 'fmc_approval', title: 'Pending FMC approval', message: 'WO-54007 awaiting Rented/Owned approval (48h)', relatedId: 'WO-54007', createdAt: '2026-04-20T10:00:00', read: false, iconColor: 'accent-purple' },
  { id: 'n-104', userId: 'usr-002', type: 'wo_stale', title: 'Stale work order', message: 'WO-54006 pending since Apr 18 — needs attention', relatedId: 'WO-54006', createdAt: '2026-04-20T08:00:00', read: false, iconColor: 'accent-gold' },
  { id: 'n-105', userId: 'usr-002', type: 'quote_request', title: 'Body repair quote requested', message: 'VAN-2031 from Ceiba Routes — Pave report uploaded', relatedId: 'BR-7123', createdAt: '2026-04-20T15:30:00', read: true, iconColor: 'accent-blue' },

  // Technician (David) notifications
  { id: 'n-201', userId: 'usr-003', type: 'wo_assigned', title: 'New WO assigned', message: 'WO-54011 — VAN-1072 Brake repair (Rush Order)', relatedId: 'WO-54011', createdAt: '2026-04-21T05:55:00', read: false, iconColor: 'accent-red' },
  { id: 'n-202', userId: 'usr-003', type: 'wo_assigned', title: 'New WO assigned', message: 'WO-54014 — VAN-5055 Tail light replacement', relatedId: 'WO-54014', createdAt: '2026-04-20T15:10:00', read: false, iconColor: 'accent-blue' },
];

// ============================================================
// WORK ORDERS — Hub central del vendor/technician
// ============================================================

// Status is represented as an array of flags to allow composability
// e.g. ['declined', 'stale', 'rush_order']
// Primary states: pending | pending_fmc | in_progress | completed | declined | canceled
// Flags: stale | rush_order | subcontracted
export const workOrdersData = [
  // ----- Pending (awaiting dispatcher accept) -----
  { id: 'WO-54001', roNumber: 'N/A',         dspId: 'DSP-4201', dspName: 'Ribrell 21',     vehicleId: 'VAN-1042', plate: 'WA-8F42-AZ', year: 2022, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM104AJ1042A104', section: '1. Front Side',     part: 'Windshield',      description: 'Crack spreading from stone chip',            severity: 'High',     status: 'pending',     flags: [],                    lastMileage: 48250, reportedBy: 'Marcus Green (DA-1001)',      assignedTechnician: null,            vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-21T06:18:00', scheduledAt: null, notes: [], photos: 3 },
  { id: 'WO-54002', roNumber: 'N/A',         dspId: 'DSP-4201', dspName: 'Ribrell 21',     vehicleId: 'VAN-1042', plate: 'WA-8F42-AZ', year: 2022, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM104AJ1042A104', section: '4. Back Side',      part: 'Brake lights',    description: 'Both brake lights not illuminating',         severity: 'Critical', status: 'pending',     flags: ['rush_order'],        lastMileage: 48250, reportedBy: 'Marcus Green (DA-1001)',      assignedTechnician: null,            vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-21T06:18:00', scheduledAt: 'Tonight 22:00', notes: [], photos: 2 },
  { id: 'WO-54003', roNumber: 'N/A',         dspId: 'DSP-4202', dspName: 'Ceiba Routes',   vehicleId: 'VAN-2031', plate: 'WA-3N31-AZ', year: 2023, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM203AJ2031A023', section: '5. In-Cab',         part: 'Dashboard',       description: 'Check Engine + ABS warning intermittent',   severity: 'Medium',   status: 'pending',     flags: [],                    lastMileage: 24560, reportedBy: 'Ana Rodriguez (DA-1004)',     assignedTechnician: null,            vendorId: 'V-101', fmc: 'Element',      createdAt: '2026-04-21T06:10:00', scheduledAt: null, notes: [], photos: 1 },
  { id: 'WO-54004', roNumber: 'N/A',         dspId: 'DSP-4203', dspName: 'TOTL',           vehicleId: 'VAN-3055', plate: 'WA-7N55-AZ', year: 2022, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM305AJ3055A022', section: '3. Passenger Side', part: 'Tire tread',      description: 'Tread at 1/32" — unsafe to operate',        severity: 'Critical', status: 'pending',     flags: ['rush_order'],        lastMileage: 65420, reportedBy: 'Jasmine Brown (DA-1009)',     assignedTechnician: null,            vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-21T05:20:00', scheduledAt: 'Tonight 20:00', notes: [], photos: 4 },
  { id: 'WO-54005', roNumber: 'N/A',         dspId: 'DSP-4201', dspName: 'Ribrell 21',     vehicleId: 'VAN-1033', plate: 'WA-1K33-AZ', year: 2023, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM103AJ1033A023', section: '2. Driver Side',    part: 'Side mirror',     description: 'Electric adjust not working',                severity: 'Low',      status: 'pending',     flags: [],                    lastMileage: 19250, reportedBy: 'Carlos Mendez (DA-1003)',     assignedTechnician: null,            vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-20T14:30:00', scheduledAt: null, notes: [], photos: 1 },
  { id: 'WO-54006', roNumber: 'N/A',         dspId: 'DSP-4205', dspName: 'Redmond Routes', vehicleId: 'VAN-5012', plate: 'WA-7R12-AZ', year: 2023, make: 'Ford',     model: 'Transit 350',   vin: '1FTBW3XM501AJ5012A023', section: '1. Front Side',     part: 'Windshield',      description: 'Large crack obstructing view',              severity: 'High',     status: 'pending',     flags: ['stale'],             lastMileage: 17890, reportedBy: 'Mia Parker (DA-1008)',        assignedTechnician: null,            vendorId: 'V-101', fmc: 'Element',      createdAt: '2026-04-18T08:15:00', scheduledAt: null, notes: [], photos: 2 },

  // ----- Pending FMC (awaiting Fleet Management Co. approval) -----
  { id: 'WO-54007', roNumber: 'N/A',         dspId: 'DSP-4204', dspName: 'Summit Express', vehicleId: 'VAN-4036', plate: 'WA-7E36-AZ', year: 2022, make: 'Ram',      model: 'ProMaster 1500',vin: '1FTBW3XM403AJ4036A022', section: '2. Driver Side',    part: 'Wheel / rim',     description: 'Bent rim after curb hit — needs replacement', severity: 'High',    status: 'pending_fmc', flags: [],                    lastMileage: 48910, reportedBy: 'Tyrone Wilson (DA-1012)',     assignedTechnician: null,            vendorId: 'V-101', fmc: 'Rented/Owned', createdAt: '2026-04-20T10:00:00', scheduledAt: null, notes: [], photos: 3 },
  { id: 'WO-54008', roNumber: 'N/A',         dspId: 'DSP-4203', dspName: 'TOTL',           vehicleId: 'VAN-3077', plate: 'WA-9P77-AZ', year: 2022, make: 'Ford',     model: 'Transit 350',   vin: '1FTBW3XM307AJ3077A022', section: '4. Back Side',      part: 'Cargo door',      description: 'Latch mechanism replacement needed',         severity: 'High',     status: 'pending_fmc', flags: [],                    lastMileage: 41500, reportedBy: 'Olger Joya',                   assignedTechnician: null,            vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-20T11:30:00', scheduledAt: null, notes: [], photos: 2 },
  { id: 'WO-54009', roNumber: 'N/A',         dspId: 'DSP-4202', dspName: 'Ceiba Routes',   vehicleId: 'VAN-2022', plate: 'WA-2M22-AZ', year: 2022, make: 'Mercedes', model: 'Sprinter',      vin: '1FTBW3XM202AJ2022A022', section: '5. In-Cab',         part: 'A/C & heater',    description: 'A/C compressor replacement',                 severity: 'Medium',   status: 'pending_fmc', flags: [],                    lastMileage: 51230, reportedBy: 'David Torres',                assignedTechnician: null,            vendorId: 'V-101', fmc: 'Element',      createdAt: '2026-04-19T09:00:00', scheduledAt: null, notes: [], photos: 1 },

  // ----- In Progress (assigned to technician) -----
  { id: 'WO-54010', roNumber: 'RO-2026-8142', dspId: 'DSP-4201', dspName: 'Ribrell 21',     vehicleId: 'VAN-1018', plate: 'WA-3K18-AZ', year: 2021, make: 'Mercedes', model: 'Sprinter',      vin: '1FTBW3XM101AJ1018A021', section: '1. Front Side',     part: 'Turn signals',    description: 'Passenger blinker intermittent — relay fix',  severity: 'Medium',   status: 'in_progress', flags: [],                    lastMileage: 28340, reportedBy: 'David Torres',                assignedTechnician: 'David Torres',  vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-21T07:00:00', scheduledAt: null, notes: ['Parts ordered from local parts store'], photos: 2 },
  { id: 'WO-54011', roNumber: 'RO-2026-8143', dspId: 'DSP-4201', dspName: 'Ribrell 21',     vehicleId: 'VAN-1072', plate: 'WA-7D72-AZ', year: 2021, make: 'Ford',     model: 'Transit 350',   vin: '1FTBW3XM107AJ1072A021', section: '2. Driver Side',    part: 'Brakes',          description: 'Complete brake failure — pads + rotors',      severity: 'Critical', status: 'in_progress', flags: ['rush_order'],        lastMileage: 78340, reportedBy: 'Olger Joya',                   assignedTechnician: 'David Torres',  vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-21T05:50:00', scheduledAt: 'Tonight 22:00', notes: ['Parts arrived 14:00', 'Starting front axle first'], photos: 5 },
  { id: 'WO-54012', roNumber: 'RO-2026-8144', dspId: 'DSP-4203', dspName: 'TOTL',           vehicleId: 'VAN-3021', plate: 'WA-5H21-AZ', year: 2022, make: 'Ford',     model: 'Transit 350',   vin: '1FTBW3XM302AJ3021A022', section: '5. In-Cab',         part: 'Dashboard',       description: 'Coolant reservoir below min',                severity: 'Medium',   status: 'in_progress', flags: [],                    lastMileage: 52340, reportedBy: 'Olger Joya',                   assignedTechnician: 'David Torres',  vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-21T06:30:00', scheduledAt: null, notes: [], photos: 1 },
  { id: 'WO-54013', roNumber: 'RO-2026-8145', dspId: 'DSP-4204', dspName: 'Summit Express', vehicleId: 'VAN-4005', plate: 'WA-4B05-AZ', year: 2021, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM400AJ4005A021', section: '3. Passenger Side', part: 'Sliding door',    description: 'Track lubrication + adjustment',             severity: 'Medium',   status: 'in_progress', flags: [],                    lastMileage: 55430, reportedBy: 'David Torres',                assignedTechnician: 'Mike Chen',     vendorId: 'V-101', fmc: 'Rented/Owned', createdAt: '2026-04-21T08:00:00', scheduledAt: null, notes: [], photos: 1 },
  { id: 'WO-54014', roNumber: 'RO-2026-8146', dspId: 'DSP-4205', dspName: 'Redmond Routes', vehicleId: 'VAN-5055', plate: 'WA-2V55-AZ', year: 2022, make: 'Ford',     model: 'Transit 350',   vin: '1FTBW3XM505AJ5055A022', section: '4. Back Side',      part: 'Tail lights',     description: 'Rear driver tail light assembly replacement', severity: 'High',    status: 'in_progress', flags: [],                    lastMileage: 52870, reportedBy: 'Olger Joya',                   assignedTechnician: 'David Torres',  vendorId: 'V-101', fmc: 'Element',      createdAt: '2026-04-20T15:00:00', scheduledAt: null, notes: ['OEM part confirmed'], photos: 2 },

  // ----- Completed -----
  { id: 'WO-54015', roNumber: 'RO-2026-8100', dspId: 'DSP-4201', dspName: 'Ribrell 21',     vehicleId: 'VAN-1099', plate: 'WA-1G99-AZ', year: 2022, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM109AJ1099A022', section: '5. In-Cab',         part: 'Horn',            description: 'Horn replacement',                           severity: 'Low',      status: 'completed',   flags: [],                    lastMileage: 44890, reportedBy: 'David Torres',                assignedTechnician: 'David Torres',  vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-19T10:00:00', completedAt: '2026-04-19T14:30:00', scheduledAt: null, notes: ['Completed in 4.5 hours'], photos: 3 },
  { id: 'WO-54016', roNumber: 'RO-2026-8105', dspId: 'DSP-4202', dspName: 'Ceiba Routes',   vehicleId: 'VAN-2009', plate: 'WA-2P09-AZ', year: 2022, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM200AJ2009A022', section: '4. Back Side',      part: 'Rear bumper',     description: 'Bumper respray + dent removal',              severity: 'Medium',   status: 'completed',   flags: [],                    lastMileage: 39550, reportedBy: 'Maria Lopez (DA-1005)',       assignedTechnician: 'David Torres',  vendorId: 'V-101', fmc: 'Element',      createdAt: '2026-04-18T09:00:00', completedAt: '2026-04-20T16:00:00', scheduledAt: null, notes: [], photos: 4 },
  { id: 'WO-54017', roNumber: 'RO-2026-8110', dspId: 'DSP-4203', dspName: 'TOTL',           vehicleId: 'VAN-3095', plate: 'WA-3S95-AZ', year: 2021, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM309AJ3095A021', section: '1. Front Side',     part: 'Wiper blades',    description: 'Wiper blade replacement — both sides',       severity: 'Low',      status: 'completed',   flags: [],                    lastMileage: 59120, reportedBy: 'Olger Joya',                   assignedTechnician: 'Mike Chen',     vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-19T07:00:00', completedAt: '2026-04-19T08:15:00', scheduledAt: null, notes: [], photos: 2 },
  { id: 'WO-54018', roNumber: 'RO-2026-8115', dspId: 'DSP-4205', dspName: 'Redmond Routes', vehicleId: 'VAN-5041', plate: 'WA-1U41-AZ', year: 2023, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM504AJ5041A023', section: '2. Driver Side',    part: 'Tire tread',      description: 'Front driver tire replacement',             severity: 'High',     status: 'completed',   flags: [],                    lastMileage: 19340, reportedBy: 'Olger Joya',                   assignedTechnician: 'David Torres',  vendorId: 'V-101', fmc: 'Element',      createdAt: '2026-04-19T11:00:00', completedAt: '2026-04-19T15:00:00', scheduledAt: null, notes: ['Used Michelin Agilis, customer approved'], photos: 3 },

  // ----- Declined -----
  { id: 'WO-54019', roNumber: 'N/A',         dspId: 'DSP-4204', dspName: 'Summit Express', vehicleId: 'VAN-4029', plate: 'WA-6D29-AZ', year: 2023, make: 'Ford',     model: 'Transit 350',   vin: '1FTBW3XM402AJ4029A023', section: '5. In-Cab',         part: 'Emergency kit',   description: 'Emergency kit replacement',                 severity: 'Low',      status: 'declined',    flags: [],                    lastMileage: 13420, reportedBy: 'Mia Parker (DA-1008)',        assignedTechnician: null,            vendorId: 'V-101', fmc: 'Rented/Owned', createdAt: '2026-04-18T12:00:00', declinedReason: 'Work is outside the scope of contract', declinedAt: '2026-04-18T13:00:00', notes: [], photos: 0 },
  { id: 'WO-54020', roNumber: 'N/A',         dspId: 'DSP-4201', dspName: 'Ribrell 21',     vehicleId: 'VAN-1027', plate: 'WA-1A27-AZ', year: 2022, make: 'Ford',     model: 'Transit 250',   vin: '1FTBW3XM102AJ1027A022', section: '2. Driver Side',    part: 'Side markers',    description: 'Replace left side marker',                  severity: 'Low',      status: 'declined',    flags: ['stale'],             lastMileage: 42180, reportedBy: 'Carlos Mendez (DA-1003)',     assignedTechnician: null,            vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-10T09:00:00', declinedReason: 'Work was already completed or defect is not present', declinedAt: '2026-04-10T10:00:00', notes: [], photos: 0 },
  { id: 'WO-54021', roNumber: 'N/A',         dspId: 'DSP-4202', dspName: 'Ceiba Routes',   vehicleId: 'VAN-2044', plate: 'WA-4P44-AZ', year: 2021, make: 'Ford',     model: 'Transit 350',   vin: '1FTBW3XM204AJ2044A021', section: '3. Passenger Side', part: 'Side mirror',     description: 'Mirror housing replacement',                severity: 'Low',      status: 'declined',    flags: [],                    lastMileage: 73100, reportedBy: 'Maria Lopez (DA-1005)',       assignedTechnician: null,            vendorId: 'V-101', fmc: 'Element',      createdAt: '2026-04-17T14:00:00', declinedReason: 'Lacking required parts or tools', declinedAt: '2026-04-17T15:30:00', notes: [], photos: 1 },

  // ----- Canceled -----
  { id: 'WO-54022', roNumber: 'N/A',         dspId: 'DSP-4203', dspName: 'TOTL',           vehicleId: 'VAN-3081', plate: 'WA-1Q81-AZ', year: 2023, make: 'Mercedes', model: 'Sprinter',      vin: '1FTBW3XM308AJ3081A023', section: '4. Back Side',      part: 'Reverse lights',  description: 'Reverse lights diagnostic',                  severity: 'Medium',   status: 'canceled',    flags: [],                    lastMileage: 14230, reportedBy: 'Jasmine Brown (DA-1009)',     assignedTechnician: null,            vendorId: 'V-101', fmc: 'Wheels',       createdAt: '2026-04-16T08:00:00', canceledReason: 'Vehicle reassigned to different route', notes: [], photos: 0 },
];

// Reason codes for Decline action
export const WO_DECLINE_REASONS = [
  { code: 1, label: 'Lacking required parts or tools' },
  { code: 2, label: 'Work is outside the scope of contract' },
  { code: 3, label: 'Work was already completed or defect is not present' },
  { code: 4, label: 'Work is declined by the customer' },
];

// Technicians available for assignment
export const availableTechnicians = [
  { id: 'tech-001', name: 'David Torres',   specialties: ['Mechanical', 'Brakes'],   activeWOs: 4 },
  { id: 'tech-002', name: 'Mike Chen',      specialties: ['Body', 'Paint'],          activeWOs: 2 },
  { id: 'tech-003', name: 'Sarah Johnson',  specialties: ['Electrical', 'Diagnostic'], activeWOs: 3 },
  { id: 'tech-004', name: 'Raymond Parker', specialties: ['Mechanical'],             activeWOs: 1 },
  { id: 'tech-005', name: 'Lisa Rodriguez', specialties: ['Body', 'Glass'],          activeWOs: 5 },
];

// Inspection sections catalog — for Vendor/Technician "Start Inspection" workflow
export const inspectionSections = [
  {
    id: 'front',
    name: '1. Front Side',
    parts: ['Headlights', 'Turn signals', 'Front bumper', 'Windshield', 'Wiper blades', 'Hood', 'License plate'],
  },
  {
    id: 'driver',
    name: '2. Driver Side',
    parts: ['Driver door', 'Side mirror', 'Tire tread', 'Wheel / rim', 'Sliding door', 'Side markers'],
  },
  {
    id: 'passenger',
    name: '3. Passenger Side',
    parts: ['Passenger door', 'Side mirror', 'Tire tread', 'Wheel / rim', 'Sliding door', 'Side markers'],
  },
  {
    id: 'back',
    name: '4. Back Side',
    parts: ['Rear bumper', 'Tail lights', 'Brake lights', 'Reverse lights', 'Cargo door', 'Rear tires'],
  },
  {
    id: 'cab',
    name: '5. In-Cab',
    parts: ['Dashboard warning lights', 'Horn', 'Seat belts', 'A/C & heater', 'Rearview mirror', 'Emergency kit'],
  },
];

export const dspList = [
  { id: 'DSP-4201', name: 'Pacific Northwest Logistics', code: 'PNW', station: 'DSE4', vans: 42, das: 68 },
  { id: 'DSP-4202', name: 'Emerald City Delivery', code: 'ECD', station: 'DSE4', vans: 38, das: 55 },
  { id: 'DSP-4203', name: 'Cascade Fleet Partners', code: 'CFP', station: 'DWA6', vans: 51, das: 74 },
  { id: 'DSP-4204', name: 'Summit Express Delivery', code: 'SED', station: 'DWA6', vans: 29, das: 41 },
  { id: 'DSP-4205', name: 'Redmond Route Masters', code: 'RRM', station: 'DSE4', vans: 45, das: 62 },
];

export const vendors = [
  { id: 'V-101', name: 'AMR', fullName: 'Amazon Mechanical Repairs', primaryVendor: 'ProFleet Auto Care', city: 'Seattle', specialties: ['Mechanical'], rating: 4.7 },
  { id: 'V-102', name: 'Body Repairs', fullName: 'Body Repairs Network', primaryVendor: 'Evergreen Body Works', city: 'Tacoma', specialties: ['Body', 'Paint'], rating: 4.3 },
  { id: 'V-103', name: 'Tires', fullName: 'Fleet Tire Services', primaryVendor: 'Discount Tire Commercial', city: 'Bellevue', specialties: ['Tires'], rating: 4.8 },
  { id: 'V-104', name: 'Detailing', fullName: 'Fleet Detailing Co.', primaryVendor: 'Spotless Mobile Detail', city: 'Kent', specialties: ['Detailing'], rating: 3.9 },
  { id: 'V-105', name: 'Netradyne', fullName: 'Netradyne Telematics', primaryVendor: 'Netradyne Driver•i', city: 'Renton', specialties: ['Telematics'], rating: 4.5 },
  { id: 'V-106', name: 'Flex Fleet', fullName: 'Flex Fleet Rental', primaryVendor: 'Flex Fleet West', city: 'Seattle', specialties: ['Rentals'], rating: 4.4 },
];

export const repairOrders = [
  { id: 'RO-20240801', van: 'VAN-1042', dsp: 'DSP-4201', vendor: 'V-101', type: 'Mechanical', desc: 'Brake pad replacement — front axle', status: 'Completed', createdAt: '2024-08-01T08:30:00', completedAt: '2024-08-01T14:45:00', cost: 285, feedback: 'up', feedbackNote: 'Fast turnaround, quality work' },
  { id: 'RO-20240802', van: 'VAN-1018', dsp: 'DSP-4201', vendor: 'V-103', type: 'Body', desc: 'Rear bumper respray & dent removal', status: 'Completed', createdAt: '2024-08-01T09:00:00', completedAt: '2024-08-03T16:00:00', cost: 620, feedback: 'down', feedbackNote: 'Color mismatch on respray' },
  { id: 'RO-20240803', van: 'VAN-2015', dsp: 'DSP-4202', vendor: 'V-102', type: 'Glass', desc: 'Windshield replacement — OEM', status: 'Completed', createdAt: '2024-08-02T07:15:00', completedAt: '2024-08-02T11:30:00', cost: 410, feedback: 'up', feedbackNote: '' },
  { id: 'RO-20240804', van: 'VAN-3021', dsp: 'DSP-4203', vendor: 'V-104', type: 'Mechanical', desc: 'Transmission fluid flush & filter', status: 'Completed', createdAt: '2024-08-02T10:00:00', completedAt: '2024-08-02T15:00:00', cost: 195, feedback: 'up', feedbackNote: 'Good communication' },
  { id: 'RO-20240805', van: 'VAN-1033', dsp: 'DSP-4201', vendor: 'V-101', type: 'Mechanical', desc: 'A/C compressor replacement', status: 'Completed', createdAt: '2024-08-03T06:00:00', completedAt: '2024-08-03T18:30:00', cost: 875, feedback: 'up', feedbackNote: '' },
  { id: 'RO-20240806', van: 'VAN-2009', dsp: 'DSP-4202', vendor: 'V-105', type: 'Body', desc: 'Side panel replacement — passenger', status: 'Completed', createdAt: '2024-08-03T08:00:00', completedAt: '2024-08-05T12:00:00', cost: 1250, feedback: 'down', feedbackNote: 'Missing interior panel clips after reassembly' },
  { id: 'RO-20240807', van: 'VAN-4005', dsp: 'DSP-4204', vendor: 'V-102', type: 'Mechanical', desc: 'Alternator replacement', status: 'Completed', createdAt: '2024-08-04T07:00:00', completedAt: '2024-08-04T10:15:00', cost: 340, feedback: 'up', feedbackNote: 'Rush order — completed same night' },
  { id: 'RO-20240808', van: 'VAN-5012', dsp: 'DSP-4205', vendor: 'V-103', type: 'Body', desc: 'Front fender repair & blend', status: 'In Progress', createdAt: '2024-08-05T09:00:00', completedAt: null, cost: 780, feedback: null, feedbackNote: null },
  { id: 'RO-20240809', van: 'VAN-3044', dsp: 'DSP-4203', vendor: 'V-101', type: 'Mechanical', desc: 'Starter motor replacement', status: 'Completed', createdAt: '2024-08-05T11:00:00', completedAt: '2024-08-05T16:00:00', cost: 425, feedback: 'up', feedbackNote: '' },
  { id: 'RO-20240810', van: 'VAN-1027', dsp: 'DSP-4201', vendor: 'V-104', type: 'Mechanical', desc: 'Suspension — front strut assembly', status: 'Completed', createdAt: '2024-08-06T06:30:00', completedAt: '2024-08-07T14:00:00', cost: 560, feedback: 'down', feedbackNote: 'Keys left on wrong hook, van not cleaned' },
  { id: 'RO-20240811', van: 'VAN-2022', dsp: 'DSP-4202', vendor: 'V-105', type: 'Body', desc: 'Rear door hinge replacement', status: 'Completed', createdAt: '2024-08-06T08:00:00', completedAt: '2024-08-06T13:45:00', cost: 195, feedback: 'up', feedbackNote: 'Excellent' },
  { id: 'RO-20240812', van: 'VAN-5008', dsp: 'DSP-4205', vendor: 'V-101', type: 'Mechanical', desc: 'Battery replacement — OEM spec', status: 'Completed', createdAt: '2024-08-07T07:00:00', completedAt: '2024-08-07T08:30:00', cost: 165, feedback: 'up', feedbackNote: '' },
  { id: 'RO-20240813', van: 'VAN-1058', dsp: 'DSP-4201', vendor: 'V-101', type: 'Mechanical', desc: 'Serpentine belt replacement', status: 'Completed', createdAt: '2024-08-07T10:00:00', completedAt: '2024-08-08T16:30:00', cost: 320, feedback: 'down', feedbackNote: 'Took over 30 hours — way past expected turnaround' },
];

export const vendorScorecard = {
  'V-101': {
    quality: { thumbsUp: 47, thumbsDown: 3, dpmo: 6000, escalations: 0 },
    speed: { within24h: 72, within72h: 95, rushSameNight: 88 },
    price: { avgDiscount: 12, enrolledDiscount: true },
    service: { communication: 4.8, cleanliness: 4.6, keyHandling: 4.9, loyaltyAdoption: 92, loyaltyTier: 'Gold' },
    overall: 94,
  },
  'V-102': {
    quality: { thumbsUp: 38, thumbsDown: 5, dpmo: 11600, escalations: 1 },
    speed: { within24h: 65, within72h: 90, rushSameNight: 70 },
    price: { avgDiscount: 8, enrolledDiscount: true },
    service: { communication: 4.2, cleanliness: 4.0, keyHandling: 4.5, loyaltyAdoption: 68, loyaltyTier: 'Silver' },
    overall: 81,
  },
  'V-103': {
    quality: { thumbsUp: 52, thumbsDown: 2, dpmo: 3700, escalations: 0 },
    speed: { within24h: 45, within72h: 88, rushSameNight: 40 },
    price: { avgDiscount: 5, enrolledDiscount: false },
    service: { communication: 4.9, cleanliness: 4.9, keyHandling: 5.0, loyaltyAdoption: 95, loyaltyTier: 'Platinum' },
    overall: 91,
  },
  'V-104': {
    quality: { thumbsUp: 29, thumbsDown: 9, dpmo: 23700, escalations: 3 },
    speed: { within24h: 58, within72h: 82, rushSameNight: 55 },
    price: { avgDiscount: 15, enrolledDiscount: true },
    service: { communication: 3.5, cleanliness: 3.2, keyHandling: 3.8, loyaltyAdoption: 35, loyaltyTier: 'Bronze' },
    overall: 62,
  },
  'V-105': {
    quality: { thumbsUp: 44, thumbsDown: 4, dpmo: 8300, escalations: 1 },
    speed: { within24h: 60, within72h: 92, rushSameNight: 65 },
    price: { avgDiscount: 10, enrolledDiscount: true },
    service: { communication: 4.5, cleanliness: 4.4, keyHandling: 4.7, loyaltyAdoption: 80, loyaltyTier: 'Gold' },
    overall: 86,
  },
  'V-106': {
    quality: { thumbsUp: 35, thumbsDown: 3, dpmo: 7800, escalations: 0 },
    speed: { within24h: 68, within72h: 91, rushSameNight: 72 },
    price: { avgDiscount: 11, enrolledDiscount: true },
    service: { communication: 4.6, cleanliness: 4.5, keyHandling: 4.8, loyaltyAdoption: 85, loyaltyTier: 'Gold' },
    overall: 88,
  },
};

// Vendor benchmark comparison (Best In Station / Best In Class / Primary Vendor)
export const vendorBenchmarks = {
  'V-101': { bestInStation: { within24h: 78, within72h: 96, rushSameNight: 25 }, bestInClass: { within24h: 82, within72h: 98, rushSameNight: 30 }, primary: { within24h: 72, within72h: 95, rushSameNight: 22 } },
  'V-102': { bestInStation: { within24h: 70, within72h: 92, rushSameNight: 20 }, bestInClass: { within24h: 75, within72h: 95, rushSameNight: 28 }, primary: { within24h: 65, within72h: 90, rushSameNight: 18 } },
  'V-103': { bestInStation: { within24h: 55, within72h: 90, rushSameNight: 18 }, bestInClass: { within24h: 60, within72h: 94, rushSameNight: 25 }, primary: { within24h: 45, within72h: 88, rushSameNight: 15 } },
  'V-104': { bestInStation: { within24h: 62, within72h: 85, rushSameNight: 20 }, bestInClass: { within24h: 68, within72h: 90, rushSameNight: 28 }, primary: { within24h: 58, within72h: 82, rushSameNight: 15 } },
  'V-105': { bestInStation: { within24h: 65, within72h: 94, rushSameNight: 22 }, bestInClass: { within24h: 70, within72h: 96, rushSameNight: 30 }, primary: { within24h: 60, within72h: 92, rushSameNight: 20 } },
  'V-106': { bestInStation: { within24h: 72, within72h: 93, rushSameNight: 25 }, bestInClass: { within24h: 76, within72h: 95, rushSameNight: 32 }, primary: { within24h: 68, within72h: 91, rushSameNight: 22 } },
};

// DVIC Inspection Data
export const daList = [
  { id: 'DA-1001', name: 'Marcus Johnson', dsp: 'DSP-4201', tier: 3, totalDefects: 312, inspections30d: 28, cashEarned: 1560, vendorBucks: 1872, streak: 28 },
  { id: 'DA-1002', name: 'Sarah Chen', dsp: 'DSP-4201', tier: 2, totalDefects: 148, inspections30d: 26, cashEarned: 444, vendorBucks: 444, streak: 14 },
  { id: 'DA-1003', name: 'James Williams', dsp: 'DSP-4202', tier: 2, totalDefects: 87, inspections30d: 22, cashEarned: 261, vendorBucks: 261, streak: 8 },
  { id: 'DA-1004', name: 'Ana Rodriguez', dsp: 'DSP-4202', tier: 3, totalDefects: 275, inspections30d: 30, cashEarned: 1375, vendorBucks: 1650, streak: 30 },
  { id: 'DA-1005', name: 'Kevin Park', dsp: 'DSP-4203', tier: 1, totalDefects: 19, inspections30d: 15, cashEarned: 38, vendorBucks: 38, streak: 3 },
  { id: 'DA-1006', name: 'Destiny Brooks', dsp: 'DSP-4203', tier: 2, totalDefects: 203, inspections30d: 27, cashEarned: 609, vendorBucks: 609, streak: 22 },
  { id: 'DA-1007', name: 'Tyler Nguyen', dsp: 'DSP-4204', tier: 1, totalDefects: 12, inspections30d: 10, cashEarned: 24, vendorBucks: 24, streak: 2 },
  { id: 'DA-1008', name: 'Mia Thompson', dsp: 'DSP-4205', tier: 3, totalDefects: 389, inspections30d: 30, cashEarned: 1945, vendorBucks: 2334, streak: 30 },
  { id: 'DA-1009', name: 'David Kim', dsp: 'DSP-4205', tier: 2, totalDefects: 126, inspections30d: 24, cashEarned: 378, vendorBucks: 378, streak: 11 },
  { id: 'DA-1010', name: 'Aaliyah Washington', dsp: 'DSP-4201', tier: 2, totalDefects: 95, inspections30d: 20, cashEarned: 285, vendorBucks: 285, streak: 6 },
];

export const dvicDefects = [
  { id: 'D-5001', da: 'DA-1001', van: 'VAN-1042', category: 'Tires', severity: 'High', desc: 'Rear left tire — tread below 3/32"', reportedAt: '2024-08-07T06:15:00', status: 'Repair Ordered', photo: true },
  { id: 'D-5002', da: 'DA-1001', van: 'VAN-1042', category: 'Lights', severity: 'Medium', desc: 'Brake light — passenger side out', reportedAt: '2024-08-07T06:16:00', status: 'Repair Ordered', photo: true },
  { id: 'D-5003', da: 'DA-1004', van: 'VAN-2009', category: 'Body', severity: 'Low', desc: 'Minor scratch on driver door', reportedAt: '2024-08-07T06:05:00', status: 'Scheduled', photo: true },
  { id: 'D-5004', da: 'DA-1008', van: 'VAN-5012', category: 'Brakes', severity: 'Critical', desc: 'Grinding noise — front brakes, feels spongy', reportedAt: '2024-08-07T05:55:00', status: 'Rush Order', photo: false },
  { id: 'D-5005', da: 'DA-1006', van: 'VAN-3021', category: 'Fluids', severity: 'Medium', desc: 'Coolant level low — reservoir below min', reportedAt: '2024-08-07T06:22:00', status: 'Repair Ordered', photo: true },
  { id: 'D-5006', da: 'DA-1002', van: 'VAN-1018', category: 'Windshield', severity: 'High', desc: 'Crack spreading from chip — driver side', reportedAt: '2024-08-07T06:30:00', status: 'Repair Ordered', photo: true },
  { id: 'D-5007', da: 'DA-1009', van: 'VAN-5008', category: 'Mirrors', severity: 'Medium', desc: 'Passenger side mirror — loose housing', reportedAt: '2024-08-07T06:10:00', status: 'Rush Order', photo: false },
  { id: 'D-5008', da: 'DA-1003', van: 'VAN-2015', category: 'Doors', severity: 'Low', desc: 'Cargo door — stiff latch mechanism', reportedAt: '2024-08-07T06:20:00', status: 'Rush Order', photo: false },
];

export const dspRewards = [
  { id: 'R-1', title: 'Free Safety Inspection for 3 vehicles', detail: 'Repaired light bulbs', totalDefects: 555, target: 1000, unlocked: false },
  { id: 'R-2', title: 'Free Alignment for 3 vehicles', detail: 'Repaired / Replaced Tires', totalDefects: 362, target: 1000, unlocked: false },
  { id: 'R-3', title: 'Free Emissions Inspection for 3 vehicles', detail: 'Repaired / Replaced Brakes', totalDefects: 222, target: 1000, unlocked: false },
];

// Body Repairs Portal data
export const bodyRepairOrders = [
  { id: 'BR-7001', van: 'VAN-1042', dsp: 'DSP-4201', damage: 'Rear quarter panel dent + paint', severity: 'Moderate', paveEstimate: 1850, groupDiscount: 12, pooledDsps: ['DSP-4201', 'DSP-4202'], status: 'Estimate Ready', photos: 3, paveScore: 72 },
  { id: 'BR-7002', van: 'VAN-2009', dsp: 'DSP-4202', damage: 'Front bumper — crack & respray', severity: 'Minor', paveEstimate: 680, groupDiscount: 8, pooledDsps: ['DSP-4202'], status: 'In Repair', photos: 2, paveScore: 35 },
  { id: 'BR-7003', van: 'VAN-3044', dsp: 'DSP-4203', damage: 'Sliding door track replacement', severity: 'Major', paveEstimate: 2400, groupDiscount: 15, pooledDsps: ['DSP-4203', 'DSP-4204', 'DSP-4201'], status: 'Pending Approval', photos: 5, paveScore: 88 },
  { id: 'BR-7004', van: 'VAN-5012', dsp: 'DSP-4205', damage: 'Roof dent — hail damage', severity: 'Minor', paveEstimate: 450, groupDiscount: 18, pooledDsps: ['DSP-4205', 'DSP-4201', 'DSP-4202', 'DSP-4203'], status: 'Estimate Ready', photos: 4, paveScore: 28 },
  { id: 'BR-7005', van: 'VAN-4005', dsp: 'DSP-4204', damage: 'Rear door — full replacement', severity: 'Severe', paveEstimate: 3200, groupDiscount: 20, pooledDsps: ['DSP-4204', 'DSP-4203'], status: 'Pending Approval', photos: 6, paveScore: 95 },
  { id: 'BR-7006', van: 'VAN-1033', dsp: 'DSP-4201', damage: 'Side mirror housing + paint', severity: 'Minor', paveEstimate: 320, groupDiscount: 0, pooledDsps: ['DSP-4201'], status: 'Completed', photos: 2, paveScore: 15 },
];

export const groupDiscountTiers = [
  { minOrders: 1, discount: 0, label: 'Standard' },
  { minOrders: 3, discount: 5, label: 'Group (3+ orders)' },
  { minOrders: 6, discount: 8, label: 'Fleet Pool (6+ orders)' },
  { minOrders: 10, discount: 12, label: 'Mega Pool (10+ orders)' },
  { minOrders: 15, discount: 15, label: 'Enterprise Pool (15+)' },
];

// Weekly trend data for charts
// Daily Approved vs Repaired Defects (Sunday-first week)
export const weeklyInspections = [
  { day: 'Sun', repaired: 3, approved: 18 },
  { day: 'Mon', repaired: 12, approved: 38 },
  { day: 'Tue', repaired: 10, approved: 42 },
  { day: 'Wed', repaired: 14, approved: 35 },
  { day: 'Thu', repaired: 11, approved: 44 },
  { day: 'Fri', repaired: 9, approved: 41 },
  { day: 'Sat', repaired: 5, approved: 28 },
];

export const defectCategoryBreakdown = [
  { name: 'Tires', value: 28, color: '#3b82f6' },
  { name: 'Lights', value: 22, color: '#f59e0b' },
  { name: 'Body', value: 18, color: '#8b5cf6' },
  { name: 'Brakes', value: 14, color: '#ef4444' },
  { name: 'Fluids', value: 10, color: '#22c55e' },
  { name: 'Other', value: 8, color: '#627d98' },
];
