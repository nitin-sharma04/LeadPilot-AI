# HubSpot ↔ LeadPilot conflict policy (Phase 8)

## Ownership

| Domain | Owner | Notes |
|--------|--------|--------|
| AI score, intent, urgency, recommendation, reasoning | **LeadPilot** | Never overwritten from HubSpot |
| Call summaries, transcripts, voice outcomes | **LeadPilot** | Not pushed as HubSpot properties by default |
| Follow-up enrollment / email automation state | **LeadPilot** | CRM-agnostic |
| HubSpot contact ID (`externalId`) | **HubSpot** | Strongest dedupe key |
| Shared contact fields (name, email, phone, company) | **Shared** | On LeadPilot update, push to HubSpot when a **live** connection exists (last-write from LeadPilot). Demo mode does not call HubSpot APIs. |

## Import (HubSpot → LeadPilot)

- Matches by `companyId + provider + externalId` first.
- Falls back to exact email within the tenant.
- Does **not** blind-merge profiles; returns existing lead + `DUPLICATE_DETECTED` activity when email matches.

## Export (LeadPilot → HubSpot)

- Only when connection status is live `CONNECTED` (not DEMO).
- Creates or patches HubSpot contact properties listed above.
- Sync failures set `LeadExternalIdentity.syncStatus = FAILED` and create `CRM_SYNC_FAILED` activity.
