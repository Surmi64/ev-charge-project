# GarageOS Micro SaaS Tervezet

## Kapcsolódó dokumentumok

- IMPLEMENTATION_BACKLOG.md
- PHASE_0_REFACTOR_PLAN.md
- sql/target_v3_schema.sql

## 1. Kiinduló helyzet

Ez a projekt jelenleg egy jo alap a GarageOS szemelyes jarmu-koltsegkoveto platformhoz, de meg nem teljes Micro SaaS termek.

### Ami már megvan

- FastAPI backend JWT alapú autentikációval.
- Regisztráció, bejelentkezés, profil lekérdezés és részleges profilfrissítés.
- Járműkezelés alap CRUD funkciókkal.
- Töltési session rögzítés és listázás.
- Frontend dashboard, analytics, járműlista, auth képernyő, mobil navigáció.
- Sötét/világos téma alapja theme_mode mentéssel.
- Docker és részben Kubernetes előkészítés.

### Fő hiányosságok a jelenlegi állapotban

- A frontend és a backend adatmodellje több ponton nincs összhangban.
- A frontend olyan végpontokat is használna, amelyek a backendben jelenleg nem léteznek.
- A charging session séma és a kód több verzió között félúton van.
- Nincs teljes account menedzsment flow.
- Nincs biztonságos production auth stratégia.
- Nincs előfizetés, tenant logika, usage limit vagy billing.
- Nincs kész, egységes design system és modern termék UI.
- Nincs formalizált roadmap MVP -> fizetős SaaS irányba.

## 2. Célállapot

A cél egy modern, reszponzív, sötét/világos témás Micro SaaS platform, amelyben a felhasználó:

- biztonságosan regisztrál és jelentkezik be,
- kezeli az accountját és beállításait,
- felveszi és szerkeszti az autóit,
- kezeli a töltési és tankolási eseményeit,
- áttekinti a költségeit, fogyasztását és trendjeit grafikonokon,
- több járművet is kezel egyetlen fiókon belül,
- később előfizetés alapján bővített funkciókat érhet el.

## 2.1 Rögzített termékdöntések

Az aktuális céltermék a következő keretek között készül:

- kizárólag egyéni felhasználásra,
- email alapú regisztrációval és profilkezeléssel,
- angol nyelvű felülettel,
- landing page nélkül,
- billing és fizetős csomagok nélkül,
- tiszta, új adatbázissal indulva,
- a töltés és tankolás mellett szerviz, biztosítás és egyéb költségek támogatásával.

## 3. Termékpozicionálás

### Javasolt termékirány

Egyéni autótulajdonosoknak szóló platform:

- elektromos autó tulajdonosoknak töltéskövetésre,
- hibrid és belső égésű autósoknak tankolás- és költségkövetésre,
- több saját jármű egy fiók alatti kezelésére,
- teljes üzemeltetési költség követésére egyetlen dashboardban.

### Javasolt értékajánlat

- Egy helyen látszik minden autó üzemeltetési költsége.
- elektromos és hagyományos uzemanyag-logika kozos modellben kezelheto.
- A felület mobilon is gyorsan használható napi rögzítéshez.
- A dashboard valós döntéstámogatást ad, nem csak lista nézetet.

## 4. Javasolt scope

### MVP scope

- Secure auth és account kezelés.
- Light/dark theme.
- Jármű CRUD.
- Töltés és tankolás CRUD.
- Szerviz, biztosítás, parkolás, útdíj és egyéb költség CRUD.
- Dashboard fő KPI kártyákkal és 3-5 hasznos grafikon.
- Reszponzív mobil + desktop UI.
- Egyszerű profil és beállítások oldal.
- Saját adatok izolációja felhasználónként.
- Teljesen angol nyelvű UI és rendszerüzenetek.

### V1 utáni scope

- Email verifikáció és jelszó-visszaállítás.
- CSV import/export.
- PWA és offline draft mentés.
- OCR blokk számla vagy töltési bizonylat feldolgozáshoz.

## 5. Funkcionális követelmények

### 5.1 Auth és account

Kötelező funkciók:

- Regisztráció emaillel és jelszóval.
- Bejelentkezés emaillel.
- Kijelentkezés.
- Saját profil oldal.
- Email, jelszó, megjelenési beállítások módosítása.
- Elfelejtett jelszó flow.
- Email megerősítés production környezetben.
- Session kezelés és eszközszintű kijelentkeztetés későbbi fázisban.

Javasolt UX:

- Split auth layout modern hero résszel.
- Kiemelt security státuszok: email verified, last login, active plan.
- Inline validation és jól látható hibaállapotok.

### 5.2 Biztonságos bejelentkezés

Minimum production követelmények:

- Környezeti változóból olvasott erős JWT secret.
- Rövid élettartamú access token + refresh token stratégia.
- Login rate limiting IP és account alapján.
- Password policy.
- Secure password reset token flow.
- CORS korlátozása ismert domainekre.
- Audit jellegű auth események naplózása.
- Egységes authorization ellenőrzés minden adatelérési ponton.

Javasolt irány:

- Rövid távon maradhat JWT alapú auth.
- Középtávon HttpOnly secure cookie alapú session jobb UX-et és kisebb XSS kockázatot adhat.

### 5.3 Járműkezelés

Kötelező mezők:

- név vagy becenév,
- márka,
- modell,
- hajtás / üzemanyag típus,
- évjárat,
- rendszám opcionálisan,
- akkumulátor kapacitás opcionálisan,
- alapértelmezett jármű jelölés.

Javasolt extra mezők:

- saját szín vagy ikon,
- havi futásteljesítmény cél,
- mérési egység preferenciák,
- kezdő km óra állás.

### 5.4 Töltések és tankolások kezelése

A domain modellt egységesíteni kell egy közös eseménytípus köré.

Javasolt közös rekordmodell:

- event_type: charging | fueling | maintenance | insurance | parking | toll | other_expense,
- vehicle_id,
- start_time,
- end_time opcionális,
- total_cost,
- currency,
- odometer,
- notes,
- source,
- location metaadatok.

Charging specifikus mezők:

- kwh,
- price_per_kwh,
- battery_level_start,
- battery_level_end,
- provider,
- AC/DC,
- teljesítmény kW.

Fueling specifikus mezők:

- liters,
- price_per_liter,
- fuel_grade,
- station_brand.

Egyéb költség specifikus mezők:

- expense_category,
- vendor,
- due_date opcionálisan,
- recurrence_type opcionálisan,
- document_reference opcionálisan.

Kötelező felhasználói funkciók:

- új esemény felvétele,
- szerkesztés,
- törlés,
- szűrés járműre, dátumra, típusra,
- keresés,
- gyors mobil rögzítés.

Javasolt kategóriák az extra költségekhez:

- maintenance,
- insurance,
- parking,
- toll,
- tax,
- inspection,
- cleaning,
- other.

### 5.5 Dashboard és grafikonok

MVP dashboard elemek:

- havi összköltség,
- havi összes töltés/tankolás darabszám,
- átlagos költség / kWh vagy / liter,
- járművenkénti költség megoszlás,
- időbeli trend grafikon,
- utolsó események lista.

Javasolt grafikonok:

- havi költés oszlopdiagram,
- heti energia / liter trend area chart,
- járművenkénti költség donut vagy pie,
- költség per 100 km trend,
- charging vs fueling arány.

### 5.6 Reszponzivitás

Mobil prioritások:

- alsó navigáció,
- nagy tap targetek,
- rövid űrlapblokkok,
- sticky primary action gomb,
- gyors eseményfelvétel 1 kézből használható flow-val.

Desktop prioritások:

- oldalsó navigáció,
- széles dashboard nézet,
- többoszlopos analytics,
- részletesebb táblázatok és szűrők.

### 5.7 Modern light/dark UI

Design irány:

- nem csak színváltás, hanem teljes theme rendszer,
- egységes spacing, radius, shadow és card rendszer,
- prémium SaaS jellegű dashboard vizualitás,
- világos témában tiszta, levegős felület,
- sötét témában mély, kontrasztos, de nem neon-túlterhelt felület.

Javasolt UI rendszer:

- design tokenek CSS és MUI theme alatt,
- semantic color tokenek: bg, surface, muted, border, accent, danger, success,
- grafikon színek külön tokenkészletből,
- typography scale egységes headline és numeric metric stílussal.

## 6. SaaS képességek

### Ajánlott csomagstratégia

Jelenlegi döntés szerint ez a projekt nem kerül billinggel vagy fizetős csomagokkal bevezetésre, ezért a platform elsődleges célja egy stabil, személyes használatú saját rendszer.

Ennek megfelelően a SaaS jelleg itt elsősorban az architekturális minőségben jelenik meg:

- elkülönített account és auth réteg,
- bővíthető domain modell,
- moduláris frontend és backend,
- jövőben monetizálható, de jelenleg nem monetizált felépítés.

### Mit érdemes az MVP-ben még nem megépíteni

- komplex multi-tenant organization réteg,
- csapatszintű jogosultságok,
- invoicing motor,
- AI predikciók,
- telemetria integrációk.

Ezek ráérnek, ha az egyfelhasználós SaaS mag már stabil.

## 7. Architektúra terv

### 7.1 Frontend

Javasolt célstruktúra:

- auth modul,
- dashboard modul,
- vehicles modul,
- events modul,
- analytics modul,
- settings/account modul,
- shared UI komponensek,
- API kliens réteg.

Szükséges fejlesztések:

- központi auth state és token lifecycle kezelés,
- route guardok egységesítése,
- form validációs réteg,
- közös táblázat / filter / empty state komponensek,
- query és cache stratégia.

Javasolt technikai irány:

- maradhat React + Vite + MUI,
- érdemes bevezetni React Query vagy hasonló cache réteget,
- űrlapokhoz Zod + React Hook Form jó irány,
- theme kezelést külön provider és token rétegbe kell vinni.

### 7.2 Backend

Javasolt célstruktúra:

- routers,
- services,
- repositories,
- auth/security,
- schemas,
- migrations,
- settings/config.

Szükséges fejlesztések:

- route logika szétbontása modulokra,
- központi hiba- és validációkezelés,
- auth/service réteg különválasztása,
- analytics végpontok tényleges implementálása,
- dashboard aggregációs végpontok implementálása,
- delete endpointok és ownership checkek teljessé tétele.

Javasolt technikai irány:

- rövid távon a FastAPI maradhat,
- adatkezeléshez érdemes ORM + migration rétegre váltani,
- Alembic erősen ajánlott,
- hosszabb távon typed schema és service boundary kell a fenntarthatósághoz.

### 7.3 Adatmodell

A jelenlegi séma helyett javasolt fő entitások:

- users,
- refresh_tokens vagy sessions,
- password_reset_tokens,
- email_verification_tokens,
- plans,
- subscriptions,
- vehicles,
- vehicle_events,
- expenses opcionálisan külön vagy vehicle_events-be olvasztva,
- audit_logs opcionálisan.

Javasolt vehicle_events mezők:

- id,
- user_id,
- vehicle_id,
- event_type,
- occurred_at vagy start_time,
- ended_at,
- total_cost,
- currency,
- odometer,
- source,
- notes,
- energy_kwh nullable,
- fuel_liters nullable,
- battery_level_start nullable,
- battery_level_end nullable,
- provider nullable,
- station_brand nullable,
- city nullable,
- location_detail nullable,
- charger_power_kw nullable,
- charger_type nullable,
- expense_category nullable,
- vendor nullable,
- recurrence_type nullable,
- document_reference nullable,
- created_at,
- updated_at.

Megjegyzés:

- Mivel a projekt tiszta adatbázissal indul, nem szükséges legacy adat-migrációt tervezni.
- A cél az, hogy a kanonikus séma közvetlenül kerüljön bevezetésre.

## 8. Jelenlegi technikai rések, amelyeket a terv első fázisában kezelni kell

1. A frontend több helyen energy_kwh vagy duration_minutes mezőkkel dolgozik, miközben a backend más mezőneveket vár.
2. A frontend dashboard és analytics végpontokra hivatkozik, de ezek a backendben jelenleg nem látszanak.
3. A charging_sessions és vehicles kapcsolatoknál keveredik a vehicle_id és vehicle_id_ref.
4. A CORS jelenleg túl nyitott production használathoz.
5. A secret fallback érték production környezetben nem elfogadható.
6. A profil oldal létezik, de a fő routerbe nincs teljesen bekötve.
7. A törlési és ownership logika nem teljes minden entitásnál.

## 9. Megvalósítási roadmap

### Fázis 0: Stabilizáció és domain egységesítés

Cél:

- a meglévő rendszer működjön konzisztensen.

Feladatok:

- frontend és backend mezőnevek összehangolása,
- hiányzó API végpontok pótlása,
- charging/fueling közös adatmodell definiálása,
- routing és auth state rendbetétele,
- alap smoke tesztek.

Kimenet:

- stabil, konzisztens jelenlegi app.

### Fázis 1: SaaS-ready auth és account

Cél:

- production-közeli account és security alap.

Feladatok:

- refresh token vagy secure session stratégia,
- jelszó-visszaállítás,
- email verifikáció,
- account settings oldal,
- theme, locale, currency preferenciák,
- login rate limit és audit alapok.

Megjegyzés:

- locale szempontból az első verzió kizárólag angol nyelvű.

Kimenet:

- biztonságosabb, vállalható public release alap.

### Fázis 2: Modern UX/UI redesign

Cél:

- erős vizuális identitás és jobb napi használhatóság.

Feladatok:

- design token rendszer,
- új auth layout,
- dashboard újratervezés,
- responsive layout rendszer,
- empty state, onboarding state, loading skeletonök.

Kimenet:

- modern, prémium Micro SaaS megjelenés.

### Fázis 3: Core üzleti modulok befejezése

Cél:

- minden fő user flow teljes legyen.

Feladatok:

- vehicles teljes CRUD és validáció,
- charging/fueling események teljes CRUD,
- szűrés, rendezés, keresés,
- dashboard KPI aggregáció,
- analytics összesítő végpontok.

Kimenet:

- használható napi üzemi termék.

### Fázis 4: Fizetős SaaS alapok

Cél:

- ez a fázis jelenleg nem része a scope-nak.

Feladatok:

- nincs ütemezve.

Kimenet:

- opcionális jövőbeli bővítési lehetőség.

### Fázis 5: Operáció és skálázás

Cél:

- megbízható üzemeltetés.

Feladatok:

- CI/CD,
- migrációs pipeline,
- monitorozás és logging,
- backup stratégia,
- production k8s vagy managed hosting döntés.

Kimenet:

- üzemeltethető SaaS platform.

## 10. Javasolt képernyők

MVP képernyők:

- Login / register,
- Forgot password,
- Dashboard,
- Vehicles list + create/edit modal vagy drawer,
- Events list,
- Create event,
- Analytics,
- Account / settings,
- Expense management nézet vagy egységes event nézet.

## 11. Javasolt API modulok

- /auth
- /account
- /vehicles
- /events
- /dashboard
- /analytics
- /admin opcionálisan később

## 12. Elfogadási kritériumok az MVP-hez

Az MVP akkor tekinthető késznek, ha:

- új felhasználó végig tud menni a regisztráció -> belépés -> első jármű -> első esemény -> dashboard flow-n,
- mobilon és desktopon is stabilan használható a rendszer,
- sötét és világos téma egyformán konzisztens,
- minden adat felhasználónként izolált,
- az analytics és dashboard valódi backend aggregációból dolgozik,
- a profil és account módosítás biztonságosan működik,
- legalább alap tesztelés és migrációs stratégia van.

## 13. Kiemelt kockázatok

- A jelenlegi kód bővítése refaktor nélkül gyorsan technikai adósságot termel.
- A séma-verziók közötti bizonytalanság félreimplementált API-khoz és UI drifthez vezethet.
- A localStorage token kezelés önmagában nem optimális hosszabb távra.
- Az analytics csak akkor lesz hiteles, ha az eseményadatok egységesek.

## 14. Ajánlott kivitelezési sorrend

1. Backend domain és adatmodell tisztázása.
2. Hiányzó backend végpontok és mezőkonzisztencia pótlása.
3. Frontend route és state cleanup.
4. Account / settings teljesítése.
5. Dashboard és analytics tényleges adatlogika.
6. UI redesign és responsive finomítás.
7. Billing és monetizáció.

Megjegyzés:

- Mivel nincs legacy adat, a kivitelezési sorrendben nem kell külön migrációs fázissal számolni.
- A hangsúly a végleges séma és az ahhoz igazodó implementáció gyors bevezetésén van.

## 15. Nyitott termékdöntések

Az eddigi pontosítások alapján a fő termékdöntések már rögzítettek. Nyitott kérdésként inkább ezek maradtak:

1. Az extra költségek külön modulban legyenek, vagy egy közös eseménylistába olvadjanak be?
2. A session és expense rögzítés modal, drawer vagy külön full-page mobil flow legyen?
3. A járművekhez akarunk-e dokumentumfeltöltést később, például biztosítás vagy szerviz bizonylatokhoz?

## 16. Rövid összefoglaló

Ez a projekt jó alap egy Micro SaaS termékhez, de először stabilizálni kell a jelenlegi adatmodellt, API szerkezetet és auth réteget. A legerősebb út egy olyan MVP, amely egyéni felhasználóknak kínál modern, reszponzív jármű- és eseménykezelést, megbízható dashboarddal, light/dark témával és SaaS-ready account/security alappal. Erre lehet később billinget, exportot, fejlettebb analytics-et és megosztott workspace funkciókat építeni.