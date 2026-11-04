"""DFS CMR repair marketplace services (spec: Sales Agent/docs/spec.md v0.4).

Modules:
  rules         — the §3 rule seed + (part, defect_type) matching.
  tokens        — HMAC-derived links (DSP review link, prospect magic link).
  events        — `marketplace_events` writer.
  shops         — shop profiles, specialties, onboarding, recipients.
  eligibility   — which defects are offered; offer sync + withdrawal.
  quotes        — submit / revise / withdraw, DSP decisions, award + work.
  notifications — email rendering + delivery.
  digest        — daily per-station digest (Claude writes the opener).
"""
