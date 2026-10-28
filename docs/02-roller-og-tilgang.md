# 02 – Roller og tilgang

Sist oppdatert: 28.10.2026. Fasit: rettighetsmatrisen i `docs/05-domenemodell.md` avsnitt 5.

## Grunnregler

- **Organisasjonen** (Byggcon) er den ytterste grensen for data. Alle tabeller har `organization_id`, og alle spørringer filtreres på den.
- **Tilgang sjekkes bare i `src/core/access`.** `requireOrganizationAccess(actor, organizationId, permission)` finner den ansatte bak innloggingen, med roller, og kaster `AccessDeniedError` ellers. Resultatet (`EmployeeGrant`) brukes i spørringen.
- **Rettigheter, ikke rollenavn, i koden.** En rolle er en fast samling rettigheter. Admin kan senere gi enkeltrettigheter i tillegg (`employee_permissions`, fase 0b).
- **Admin stenges aldri ute.**
- **Alle takstmenn ser og kan foreløpig endre alt** (27.10.2026), styrt av innstillingen `access.inspectors_edit_all`. Unntak: reklamasjonssaker ser bare leder og admin. Revisjonsloggen viser hvem som endret hva.

## Roller (fase 0a)

| Rolle | Kode | Rettigheter i dag |
|---|---|---|
| Takstmann | `inspector` | `organization.read` |
| Kontor | `office` | `organization.read` |
| Leder | `manager` | `organization.read`, `claims.read`, `staff.manage` |
| Admin | `admin` | alle |

Rettighetene utvides fase for fase (`src/core/access/permissions.ts`). Sidemann er en rolle på oppdraget, ikke en ansattrolle (kommer i fase 2a). Kunde og megler er visningsroller som kommer senere.

## Innlogging

Engangskode på e-post (Better Auth), samme løsning som Optiplan. Nye brukere opprettes ikke ved innlogging; en person må være lagt inn som ansatt først. **Felles innlogging og felles profil med Optiplan for admin og ansatte** (Ståle 28.10.2026): samme bruker i begge løsningene, med samme navn, telefon, stilling og kontor. Kundene (Optiplans styrer, EzProps kunder og meglere) holdes adskilt og deler aldri bruker. Hvordan delingen gjøres teknisk avgjøres i fase 0b (ADR).
