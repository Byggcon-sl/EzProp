export const meta = {
  name: "oppgave",
  description:
    "Oppgaveløkken for EzProp (løkke B, C og D): spesifiser, vurder, design, bygg, test, rett, gjennomgå og lag PR",
  whenToUse:
    "Én oppgave fra docs/07-utviklingsplan.md, fra oppgavekort til pull request. args: { task, phase, branch, base?, date? }",
  phases: [
    { title: "Spesifiser", detail: "Prosjektlederen lager oppgavekortet" },
    { title: "Forhåndsvurdering", detail: "Bare rollene oppgaven trenger, i parallell" },
    { title: "Design", detail: "Arkitekt, UI-designer og testplan" },
    { title: "Bygg", detail: "Utvikler og testskriver i parallell, egen worktree" },
    { title: "Kjør og rett", detail: "Alle sjekker; retteløkken ved rødt (maks 3)" },
    { title: "Gjennomgang", detail: "Test-leder, sikkerhet, forenkler, fagansvarlig" },
    { title: "PR", detail: "Prosjektlederen åpner PR og oppdaterer tilstanden" },
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

// ---------------------------------------------------------------------------
// Inndata
// ---------------------------------------------------------------------------
const task = args && args.task;
if (!task) throw new Error("args.task mangler: punktet fra docs/07-utviklingsplan.md");
const phaseName = (args && args.phase) || "ukjent fase";
const branch = (args && args.branch) || "oppgave";
// Bygger oppgaven på en PR som ikke er merget ennå, er base den branchen (ellers main)
const base = (args && args.base) || "main";
const today = (args && args.date) || "i dag";

const VERDICT = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["godkjent", "endring", "stopp"] },
    notes: { type: "string", description: "Kort begrunnelse og konkrete endringer, på norsk" },
  },
  required: ["verdict", "notes"],
};

const SPEC = {
  type: "object",
  properties: {
    specPath: {
      type: "string",
      description: "Sti til spesifikasjonen (docs/funksjoner/… eller inline)",
    },
    summary: { type: "string" },
    goal: { type: "string", description: "Hvilket hovedmål oppgaven støtter, og hvordan" },
    needsArchitect: { type: "boolean" },
    needsUx: { type: "boolean" },
    needsUi: { type: "boolean" },
    needsAi: { type: "boolean" },
    needsDomain: { type: "boolean", description: "Har oppgaven fagstoff (TG, regler, tekster)?" },
    needsSecurity: { type: "boolean" },
  },
  required: [
    "specPath",
    "summary",
    "goal",
    "needsArchitect",
    "needsUx",
    "needsUi",
    "needsAi",
    "needsDomain",
    "needsSecurity",
  ],
};

const PIECES = {
  type: "object",
  properties: {
    pieces: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          instructions: {
            type: "string",
            description: "Alt utvikleren trenger: filer, grensesnitt, akseptkriterier",
          },
          files: { type: "array", items: { type: "string" } },
        },
        required: ["name", "instructions", "files"],
      },
    },
    testPlanPath: { type: "string" },
  },
  required: ["pieces", "testPlanPath"],
};

const BUILD_RESULT = {
  type: "object",
  properties: {
    branch: { type: "string", description: "Branchen arbeidet er committet på" },
    summary: { type: "string" },
    notDone: { type: "string" },
  },
  required: ["branch", "summary", "notDone"],
};

const CHECK = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    output: { type: "string", description: "De viktigste linjene fra det som feilet, ellers tomt" },
  },
  required: ["passed", "output"],
};

const FIX_TASK = {
  type: "object",
  properties: {
    rootCause: { type: "string" },
    instructions: { type: "string" },
    needsStaale: {
      type: "boolean",
      description: "Sant hvis feilen krever en beslutning fra Ståle",
    },
  },
  required: ["rootCause", "instructions", "needsStaale"],
};

const FINDINGS = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["alvorlig", "lite"] },
          file: { type: "string" },
          description: { type: "string" },
          fix: { type: "string" },
        },
        required: ["severity", "file", "description", "fix"],
      },
    },
  },
  required: ["findings"],
};

const PR = {
  type: "object",
  properties: {
    prUrl: { type: "string" },
    summary: { type: "string" },
  },
  required: ["prUrl", "summary"],
};

const ctx = `Oppgave: ${task}\nFase: ${phaseName}\nBranch: ${branch} (bygger på ${base})\nDato: ${today}\n`;

// ---------------------------------------------------------------------------
// 1. Spesifiser
// ---------------------------------------------------------------------------
phase("Spesifiser");
log(`Spesifiserer: ${task}`);
const spec = await run(
  "prosjektleder",
  `${ctx}
Lag oppgavekortet etter docs/maler/funksjon.md. Les docs/agenter/tilstand.md og gjeldende fase i docs/07-utviklingsplan.md. Hold omfanget lite, skriv «ikke med» eksplisitt, og svar på «KI først». For større funksjoner: lagre i docs/funksjoner/<fase>-<kort-navn>.md; for små oppgaver kan kortet stå i docs/agenter/oppgaver/<branch>.md. Sørg for at branchen «${branch}» finnes (git checkout -b ${branch} fra ${base} hvis den ikke finnes) og commit kortet. Si hvilke roller oppgaven trenger (ikke flere enn nødvendig).`,
  { label: "prosjektleder: spesifiser", phase: "Spesifiser", schema: SPEC },
);
if (!spec) throw new Error("Spesifikasjonen ble ikke laget");
log(`Oppgavekort: ${spec.specPath} · Mål: ${spec.goal}`);

// ---------------------------------------------------------------------------
// 2. Forhåndsvurdering (bare rollene oppgaven trenger)
// ---------------------------------------------------------------------------
const reviewers = [
  { role: "forenkler", ask: "Hva kan kuttes nå, for målet?" },
  spec.needsArchitect && {
    role: "arkitekt",
    ask: "Stemmer datamodell, modulgrenser og adapterlag?",
  },
  spec.needsUx && {
    role: "ux-ansvarlig",
    ask: "Antall trykk før og etter, tidsgevinst, virker uten nett?",
  },
  spec.needsAi && {
    role: "ki-ansvarlig",
    ask: "KI først: kan KI gjøre eller forberede dette? Logging?",
  },
  spec.needsDomain && {
    role: "fagansvarlig",
    ask: "Stemmer fag, TG og regler med forskriften og NS 3600?",
  },
  spec.needsSecurity && {
    role: "sikkerhet-personvern",
    ask: "Tilgang, kundedata, oppbevaring, GDPR?",
  },
  { role: "test-leder", ask: "Er akseptkriteriene testbare? Hva må testplanen dekke?" },
].filter(Boolean);

async function preReview(round) {
  return parallel(
    reviewers.map(
      (r) => () =>
        run(
          r.role,
          `${ctx}\nOppgavekort: ${spec.specPath}\n\nForhåndsvurdering (runde ${round}): ${r.ask}\nSvar godkjent, endring eller stopp, med konkrete punkter.`,
          { label: `${r.role}: forhåndsvurdering`, phase: "Forhåndsvurdering", schema: VERDICT },
        ).then((v) => v && { role: r.role, ...v }),
    ),
  );
}

phase("Forhåndsvurdering");
let verdicts = (await preReview(1)).filter(Boolean);
let stops = verdicts.filter((v) => v.verdict === "stopp");
let changes = verdicts.filter((v) => v.verdict === "endring");
if (stops.length === 0 && changes.length > 0) {
  log(`${changes.length} ber om endring. Prosjektlederen oppdaterer kortet.`);
  await run(
    "prosjektleder",
    `${ctx}\nOppgavekort: ${spec.specPath}\n\nDisse rollene ber om endring:\n${changes.map((c) => `- ${c.role}: ${c.notes}`).join("\n")}\n\nOppdater oppgavekortet. Du avgjør ved uenighet og begrunner i kortet. Fag, pris, personvern og nye funksjoner går til docs/09-apne-sporsmal.md. Commit.`,
    { label: "prosjektleder: oppdater kort", phase: "Forhåndsvurdering" },
  );
  verdicts = (await preReview(2)).filter(Boolean);
  stops = verdicts.filter((v) => v.verdict === "stopp");
}
if (stops.length > 0) {
  const reason = stops.map((s) => `${s.role}: ${s.notes}`).join("\n");
  await run(
    "prosjektleder",
    `${ctx}\nOppgaven stoppes i forhåndsvurderingen:\n${reason}\n\nSkriv det i docs/agenter/tilstand.md under «Trenger Ståle» (klarspråk) og i docs/09-apne-sporsmal.md hvis det er Ståles beslutning. Commit og push branchen.`,
    { label: "prosjektleder: stopp", phase: "Forhåndsvurdering" },
  );
  return { status: "stoppet", task, reason };
}
log("Forhåndsvurdering: godkjent");

// ---------------------------------------------------------------------------
// 3. Design
// ---------------------------------------------------------------------------
phase("Design");
const designers = [
  spec.needsArchitect && {
    role: "arkitekt",
    ask: "Lag skjema/migrering (hvis nytt), grensesnitt (typer og funksjonssignaturer) og ADR hvis det er en arkitekturbeslutning. Commit.",
  },
  spec.needsUi && {
    role: "ui-designer",
    ask: "Lag komponentspesifikasjon eller skisse etter design A, lagret ved siden av oppgavekortet. Commit.",
  },
  {
    role: "test-leder",
    ask: "Lag testplanen (tilgang, tenant-isolasjon, regeltester, e2e på iPad-størrelse) lagret ved siden av oppgavekortet som <kort>-testplan.md. Commit.",
  },
].filter(Boolean);
const designNotes = (
  await parallel(
    designers.map(
      (d) => () =>
        run(d.role, `${ctx}\nOppgavekort: ${spec.specPath}\n\n${d.ask}`, {
          label: `${d.role}: design`,
          phase: "Design",
        }).then((t) => t && `## ${d.role}\n${t}`),
    ),
  )
).filter(Boolean);

// ---------------------------------------------------------------------------
// 4. Bygg
// ---------------------------------------------------------------------------
phase("Bygg");
const plan = await run(
  "prosjektleder",
  `${ctx}\nOppgavekort: ${spec.specPath}\n\nDesignnotater:\n${designNotes.join("\n\n")}\n\nDel byggingen i biter som ikke henger sammen (helst 1–4), hver med alt utvikleren trenger. Oppgi stien til testplanen.`,
  { label: "prosjektleder: del opp", phase: "Bygg", schema: PIECES },
);
if (!plan || plan.pieces.length === 0) throw new Error("Ingen biter å bygge");
log(`${plan.pieces.length} biter bygges i parallell, pluss testskriver`);

const buildResults = await parallel([
  ...plan.pieces.map(
    (p, i) => () =>
      run(
        "utvikler",
        `${ctx}\nOppgavekort: ${spec.specPath}\n\nDu bygger biten «${p.name}»:\n${p.instructions}\nFiler: ${p.files.join(", ")}\n\nDu står i en egen worktree på en egen branch. Commit arbeidet der med norsk melding og rapporter branch-navnet (git rev-parse --abbrev-ref HEAD). Kjør pnpm lint, typecheck og test før du sier ferdig.`,
        {
          label: `utvikler ${i + 1}: ${p.name}`,
          phase: "Bygg",
          isolation: "worktree",
          schema: BUILD_RESULT,
        },
      ),
  ),
  () =>
    run(
      "testskriver",
      `${ctx}\nOppgavekort: ${spec.specPath}\nTestplan: ${plan.testPlanPath}\n\nSkriv testene i testplanen (Vitest og Playwright). Koden bygges samtidig av andre, så noen tester kan være røde nå; det er ventet. Du står i en egen worktree på en egen branch. Commit der og rapporter branch-navnet.`,
      { label: "testskriver", phase: "Bygg", isolation: "worktree", schema: BUILD_RESULT },
    ),
]);
const branches = buildResults.filter(Boolean).map((r) => r.branch);
log(`Setter sammen ${branches.length} brancher`);

async function runChecks(extra) {
  return run(
    "test-leder",
    `${ctx}\n${extra || ""}\nStå på branchen «${branch}». Kjør i rekkefølge: pnpm format, pnpm lint, pnpm typecheck, pnpm test, og PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:e2e. Rapporter om alt er grønt, og de viktigste linjene fra det som feilet. Ikke rett noe.`,
    { label: "test-leder: kjør sjekker", phase: "Kjør og rett", schema: CHECK },
  );
}

await run(
  "prosjektleder",
  `${ctx}\nSett sammen arbeidet: på branchen «${branch}», merge disse branchene fra worktrees i rekkefølge: ${branches.join(", ")}. Løs konflikter konservativt (behold begge sider der det er mulig). Fjern worktrees etterpå (git worktree prune). Sørg for at tests/factories.ts tømmer nye tabeller. Commit.`,
  { label: "prosjektleder: sett sammen", phase: "Bygg" },
);

// ---------------------------------------------------------------------------
// 5. Kjør og rett (løkke C, maks 3 forsøk)
// ---------------------------------------------------------------------------
phase("Kjør og rett");
let check = await runChecks();
let attempts = 0;
while (check && !check.passed && attempts < 3) {
  attempts += 1;
  log(`Rødt. Retteforsøk ${attempts} av 3`);
  const fix = await run(
    "feilrettingsleder",
    `${ctx}\nSjekkene feilet (forsøk ${attempts}):\n${check.output}\n\nFinn årsaken og skriv en presis retteoppgave. Sett needsStaale bare hvis feilen krever en beslutning fra Ståle.`,
    { label: `feilrettingsleder: forsøk ${attempts}`, phase: "Kjør og rett", schema: FIX_TASK },
  );
  if (!fix || fix.needsStaale) break;
  await run(
    "retter",
    `${ctx}\nRetteoppgave:\nÅrsak: ${fix.rootCause}\n${fix.instructions}\n\nStå på branchen «${branch}». Commit rettingen.`,
    {
      label: `retter: forsøk ${attempts}`,
      phase: "Kjør og rett",
    },
  );
  check = await runChecks();
}
if (!check || !check.passed) {
  await run(
    "prosjektleder",
    `${ctx}\nOppgaven stoppet etter ${attempts} retteforsøk. Siste feil:\n${check ? check.output : "ukjent"}\n\nMerk oppgaven «trenger Ståle» i docs/agenter/tilstand.md med forklaring i klarspråk. Commit og push branchen «${branch}» (uten PR).`,
    { label: "prosjektleder: trenger Ståle", phase: "Kjør og rett" },
  );
  return { status: "trenger Ståle", task, attempts };
}
log("Alle sjekker grønne");

// ---------------------------------------------------------------------------
// 6. Gjennomgang (løkke D). Alvorlige funn går tilbake til bygg én gang.
// ---------------------------------------------------------------------------
phase("Gjennomgang");
const reviewRoles = [
  {
    role: "test-leder",
    ask: "Dekker testene akseptkriteriene, tilgang og tenant-isolasjon? Godkjenn eller avvis.",
  },
  {
    role: "sikkerhet-personvern",
    ask: "Tilgang bare i core/access, ingen kundedata, myk sletting, logg uten personopplysninger. Bruk /security-review hvis det passer.",
  },
  {
    role: "forenkler",
    ask: "Hva i diffen trengs ikke for akseptkriteriene? Bruk /simplify hvis det passer, men ikke endre kode selv.",
  },
  spec.needsDomain && {
    role: "fagansvarlig",
    ask: "Fag, TG, regler og tekster: egne formuleringer, ingen gjetteord, riktig TG.",
  },
].filter(Boolean);

async function review(round) {
  const results = await parallel(
    reviewRoles.map(
      (r) => () =>
        run(
          r.role,
          `${ctx}\nOppgavekort: ${spec.specPath}\nGjennomgang (runde ${round}) av diffen på branchen «${branch}» (git diff ${base}...${branch}).\n${r.ask}\nMerk hvert funn alvorlig eller lite.`,
          {
            label: `${r.role}: gjennomgang`,
            phase: "Gjennomgang",
            schema: FINDINGS,
          },
        ).then((f) => f && f.findings.map((x) => ({ role: r.role, ...x }))),
    ),
  );
  return results.filter(Boolean).flat();
}

let findings = await review(1);
let serious = findings.filter((f) => f.severity === "alvorlig");
if (serious.length > 0) {
  log(`${serious.length} alvorlige funn. Tilbake til bygg (én runde).`);
  await run(
    "utvikler",
    `${ctx}\nAlvorlige funn fra gjennomgangen:\n${serious.map((f) => `- [${f.role}] ${f.file}: ${f.description} → ${f.fix}`).join("\n")}\n\nRett dem på branchen «${branch}». Commit. Kjør pnpm lint, typecheck og test.`,
    { label: "utvikler: rett alvorlige funn", phase: "Gjennomgang" },
  );
  check = await runChecks();
  if (!check || !check.passed) {
    const fix = await run(
      "feilrettingsleder",
      `${ctx}\nSjekkene feilet etter retting av funn:\n${check ? check.output : ""}\nSkriv retteoppgave.`,
      {
        label: "feilrettingsleder: etter gjennomgang",
        phase: "Gjennomgang",
        schema: FIX_TASK,
      },
    );
    if (fix && !fix.needsStaale) {
      await run(
        "retter",
        `${ctx}\nRetteoppgave:\n${fix.instructions}\nStå på «${branch}». Commit.`,
        { label: "retter: etter gjennomgang", phase: "Gjennomgang" },
      );
      check = await runChecks();
    }
  }
  findings = await review(2);
  serious = findings.filter((f) => f.severity === "alvorlig");
}
const minor = findings.filter((f) => f.severity === "lite");
const allGreen = check && check.passed;

// ---------------------------------------------------------------------------
// 7. PR
// ---------------------------------------------------------------------------
phase("PR");
const pr = await run(
  "prosjektleder",
  `${ctx}\nOppgavekort: ${spec.specPath}\nMål: ${spec.goal}\nRoller som var med: ${[...new Set([...reviewers, ...designers, ...reviewRoles].map((r) => r.role))].join(", ")}, utvikler, testskriver.
Sjekkene er ${allGreen ? "grønne" : "IKKE grønne (si det tydelig i PR-en)"}.
Alvorlige funn som står igjen: ${serious.length === 0 ? "ingen" : serious.map((f) => `${f.file}: ${f.description}`).join("; ")}
Små funn (nevnes i PR-en): ${minor.length === 0 ? "ingen" : minor.map((f) => `${f.file}: ${f.description}`).join("; ")}

Gjør ferdig: øk versjonsnummeret i package.json (patch), kryss av punktet i docs/07-utviklingsplan.md, oppdater ordlisten hvis nye begreper, oppdater docs/agenter/tilstand.md (åpne PR-er, venter på Ståle). Commit og push branchen «${branch}» (git push -u origin ${branch}). Åpne PR med gh pr create --base ${base}, norsk tittel, og teksten etter docs/maler/pr.md i klarspråk til Ståle. ${base === "main" ? "" : `PR-en bygger på branchen ${base} som ikke er merget: skriv det under «Bygger på».`} Aldri modellnavn. Rapporter PR-lenken.`,
  { label: "prosjektleder: PR", phase: "PR", schema: PR },
);
return {
  status: "pr",
  task,
  prUrl: pr && pr.prUrl,
  summary: pr && pr.summary,
  seriousFindingsLeft: serious.length,
  minorFindings: minor.length,
};
