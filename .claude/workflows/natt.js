export const meta = {
  name: "natt",
  description:
    "Nattløkken for EzProp (løkke E): hele testpakken, e2e på iPad, universell utforming, sårbare pakker, appstørrelse og trege spørringer. Funn blir oppgaver.",
  whenToUse: "Kjøres av nattrutinen, eller for hånd når Ståle ber om en full sjekk",
  phases: [
    { title: "Sjekker", detail: "Seks uavhengige sjekker i parallell" },
    { title: "Oppsummer", detail: "Funn inn i tilstand.md og én ryddings-PR om trygt" },
  ],
};

// ---------------------------------------------------------------------------
// Roller: bruker agentbeskrivelsen i .claude/agents/<rolle>.md når den er lastet i sesjonen.
// Er den ikke det (f.eks. første kjøring etter at filene ble laget), får en vanlig agent
// beskjed om å lese og følge filen selv. Utøverne kjører da på opus, lederne på sesjonens modell.
// ---------------------------------------------------------------------------
const DOERS = ["utvikler", "testskriver", "retter"];
async function run(role, prompt, opts) {
  const text = `Du er rollen «${role}» i EzProp. Les .claude/agents/${role}.md først og følg den.

${prompt}`;
  try {
    return await agent(prompt, { ...opts, agentType: role });
  } catch (e) {
    if (!/not found/i.test(String(e && e.message))) throw e;
    return agent(text, { ...opts, ...(DOERS.includes(role) ? { model: "opus" } : {}) });
  }
}

const today = (args && args.date) || "i dag";

const REPORT = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["alvorlig", "lite"] },
          description: { type: "string" },
          safeCleanup: {
            type: "boolean",
            description:
              "Kan rettes uten å endre oppførsel (formatering, døde filer, pakkeoppdatering uten brudd)?",
          },
        },
        required: ["severity", "description", "safeCleanup"],
      },
    },
  },
  required: ["ok", "findings"],
};

const CHECKS = [
  {
    key: "tester",
    role: "test-leder",
    ask: "Kjør pnpm lint, pnpm typecheck og pnpm test på main. Rapporter alt som er rødt eller advarer.",
  },
  {
    key: "e2e-ipad",
    role: "test-leder",
    ask: "Kjør PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:e2e (prosjektene pc og ipad). Finnes det tester for drift uten nett, kjør dem også. Rapporter.",
  },
  {
    key: "uu",
    role: "ui-designer",
    ask: "Universell utforming: start appen (pnpm build && pnpm start --port 3200 i bakgrunnen) og sjekk sidene med Playwright og @axe-core/playwright hvis den finnes, ellers for hånd: fokusmarkering, kontrast, skjermlesertekst, trykkflater minst 44 px. Stopp serveren etterpå.",
  },
  {
    key: "pakker",
    role: "sikkerhet-personvern",
    ask: "Kjør pnpm audit og pnpm outdated. Rapporter sårbare pakker (alvorlig) og utdaterte (lite). Foreslå bare oppdateringer uten brudd som trygg rydding.",
  },
  {
    key: "storrelse",
    role: "arkitekt",
    ask: "Kjør pnpm build og les størrelsen på sidene og første last (Next.js-utskriften). Rapporter sider over 200 kB JS som funn.",
  },
  {
    key: "sporringer",
    role: "arkitekt",
    ask: "Gå gjennom spørringene i src/core og src/modules: mangler indekser på organization_id eller felt det filtreres på? Er det N+1? Kjør EXPLAIN mot testdatabasen der det er enkelt. Rapporter.",
  },
];

phase("Sjekker");
const results = await parallel(
  CHECKS.map(
    (c) => () =>
      run(
        c.role,
        `Nattløkken ${today}, sjekk «${c.key}». Stå på main (git checkout main && git pull). Ikke endre kode.\n${c.ask}`,
        {
          label: `${c.role}: ${c.key}`,
          phase: "Sjekker",
          schema: REPORT,
        },
      ).then((r) => r && { key: c.key, ...r }),
  ),
);
const reports = results.filter(Boolean);
const findings = reports.flatMap((r) => r.findings.map((f) => ({ check: r.key, ...f })));
const missing = CHECKS.filter((c) => !reports.some((r) => r.key === c.key)).map((c) => c.key);
if (missing.length > 0) log(`Sjekker uten rapport: ${missing.join(", ")}`);
log(
  `${findings.length} funn, ${findings.filter((f) => f.severity === "alvorlig").length} alvorlige`,
);

phase("Oppsummer");
const summary = await run(
  "prosjektleder",
  `Nattløkken ${today} er ferdig. Funn:\n${findings.length === 0 ? "(ingen)" : findings.map((f) => `- [${f.check}, ${f.severity}${f.safeCleanup ? ", trygg rydding" : ""}] ${f.description}`).join("\n")}\nSjekker uten rapport: ${missing.join(", ") || "ingen"}

1. Skriv funnene som oppgaver under «Oppgaver fra nattløkken» i docs/agenter/tilstand.md (alvorlige først), med dato. Fjern funn som allerede står der og er rettet.
2. Er det funn merket trygg rydding: lag branchen natt-${today}, gjør ryddingen, kjør pnpm lint, typecheck og test, øk patch-versjonen, og åpne én PR mot main med docs/maler/pr.md (bruk gh api repos/{owner}/{repo}/pulls, ikke gh pr create) (tittel «Rydding fra nattløkken ${today}»). Ingen nye funksjoner, ingen endring i oppførsel.
3. Commit og push. Rapporter kort.`,
  { label: "prosjektleder: oppsummer", phase: "Oppsummer" },
);
return { findings, missing, summary };
