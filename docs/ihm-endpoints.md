# IHM (Interactive Hail Maps) — discovered internal endpoints

All session-cookie-authenticated (`ASP.NET_SessionId`, `ihm=st=…`, `cf_clearance`).
Base: `https://maps.interactivehailmaps.com`. Phase-3 plan: replace stored cookies
with programmatic login flow.

## Hail / storm data (read — for Phase 3 automation)

| Method | Path | Purpose | Body / Query |
|---|---|---|---|
| `GET`  | `/Api/StormData` | Storm data within a bbox + date range (JSON) | `Begin`, `End` (M/D/YYYY), `nElat`, `nElng`, `sWlat`, `sWlng` |
| `GET`  | `/Api/RadarMode` | Radar mode flags for a date (tiny JSON) | `Begin` (M/D/YYYY) |
| `POST` | `/api/SwathDataFl` | Hail swath polygons for a date/size (JSON) | form-encoded params incl. `FileDate` |
| `POST` | `/api/ZipCodeRegion` | Zip-code region lookup | form-encoded |
| `GET`  | `/Api/ZipCodeInfo` | Zip info by lat/lng | `lat`, `lng`, `FileDate`, `InSwath` |

## Territories (write — polygon management)

| Method | Path | Purpose | Body / Query |
|---|---|---|---|
| `POST` | `/Api/Territory` | **Create** territory from polygon | form-encoded `FileDate` + repeated `lat=X&lng=Y` |
| `POST` | `/Api/TerritoryUpdate` | Update territory name, monitoring, colors | form-encoded; keys: `Territory_id`, `Name`, `MonitoringLevel`, `LineColor`, etc. |
| `POST` | `/Api/TerritoryAdjustOptions` | Returns HTML form for adjusting territory | `Territory_id` |
| `POST` | `/api/TerritoryPerims` | **List** all territory perimeters (polygons as encoded polylines) | `FileDate`, `Territory_id` (optional) |
| `GET`  | `/Api/TerritoryInfo` | Info popup HTML for a territory | `Territory_id`, `Lat`, `Long` |
| `GET`  | `/Api/TerritoryEditForm` | Edit-form HTML | `Territory_id` |
| `GET`  | `/Territory/Details/{id}?idr=true` | **Full page** for a territory, includes contact table inline | — |
| `GET`  | `/Territory/KmlFile/{id}` | Download KML of territory polygon | — |

## Contact data (the scraping target)

| Method | Path | Purpose | Body / Query |
|---|---|---|---|
| `GET`  | `/ContactData/InitiateTerritoryDataRequest` | **Trigger** contact pull; returns HTML confirm | `Territory_id` |
| `POST` | `/Territory/BulkContactList` | **Render** contact table HTML for a territory | `Territory_id` |
| `POST` | `/Territory/MarkerList` | Render marker table HTML | `Territory_id` |
| `POST` | `/Territory/ExportBulkContactData` | Export contact data (format TBD — HTML? CSV?) | `Territory_id` |

## Auth / session

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/Account/SessionCheck` | Heartbeat; returns `{Email, SessionActive, LiveNow, …}` — use to detect expired cookies |

## Fully-automated pipeline using ONLY these endpoints

```
Storm webhook (public AgentApi webhook we already subscribe to)
        ↓
/api/SwathDataFl  →  get polygon of where hail fell
        ↓
/Api/Territory  →  create territory matching that polygon
        ↓
/ContactData/InitiateTerritoryDataRequest  →  kick off skip-trace
        ↓
(poll) /Territory/BulkContactList  →  parse HTML, extract leads
        ↓
Upsert into leads table → campaign.status='ready' → enroll in Defcon-1 drip (Hailey)
```

Zero human clicks. This is the Phase 3 target.
