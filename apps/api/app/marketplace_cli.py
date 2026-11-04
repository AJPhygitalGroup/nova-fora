"""CLI drivers for the DFS repair marketplace (wired in app/cli.py).

  marketplace-sync                 create / withdraw offers (idempotent).
                                   Suggested: every 15 min.
  marketplace-digest [--station S] [--dry-run]
                                   daily per-station digest to shops.
                                   Suggested: 06:00 America/New_York.
  seed-marketplace-rules           insert any missing spec §3 rule (never
                                   overwrites DFS edits).

Same shape as `bundle-route-cron`: one session, print a summary line,
exit 0 unless something is actually broken.
"""

from __future__ import annotations

from app.db import AsyncSessionLocal
from app.services.marketplace import notifications as _notifications  # noqa: F401 — after-commit email hook


async def cmd_marketplace_sync() -> None:
    from app.services.marketplace.eligibility import sync_offers

    async with AsyncSessionLocal() as session:
        result = await sync_offers(session)
        await session.commit()
        print(
            f"marketplace-sync: created {len(result.created)} offer(s), "
            f"withdrew {len(result.withdrawn)}."
        )


async def cmd_marketplace_digest(station: str | None = None, dry_run: bool = False) -> None:
    from app.services.marketplace.digest import run_digest

    async with AsyncSessionLocal() as session:
        result = await run_digest(session, station=station, dry_run=dry_run)
    if not result.offers:
        print("marketplace-digest: 0 new offers — nothing to send.")
        return
    for st, n in sorted(result.by_station.items()):
        print(f"  {st}: {n} new offer(s)")
    print(
        f"marketplace-digest{' (dry run)' if dry_run else ''}: {result.offers} offer(s), "
        f"{result.emails_attempted} email(s) built, {result.emails_sent} delivered via SMTP, "
        f"Claude opener used {result.claude_used} time(s)."
    )


async def cmd_seed_marketplace_rules() -> None:
    from app.services.marketplace.rules import seed_missing_rules

    async with AsyncSessionLocal() as session:
        added = await seed_missing_rules(session)
        await session.commit()
        print(f"seed-marketplace-rules: inserted {added} missing rule(s).")
