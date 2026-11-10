export const meta = {
  name: "testlag",
  description:
    "Testlaget for EzProp (løkke G): agenter med ulike roller prøver det som er merget. Funnene etterprøves av en uavhengig kontrollør og blir retteoppgaver, forbedringer eller forslag.",
  whenToUse:
    "Kjøres av testlag-rutinen hver natt, eller for hånd når Ståle ber om en full test. args: { date, scope?: 'endret' | 'alt', roles?: [rollenavn] }",
  phases: [
    { title: "Klargjør", detail: "Bygg, database, testbrukere, og hva som er endret siden sist" },
    { title: "Test", detail: "Testerne prøver hver for seg, i parallell" },
    {
      title: "Etterprøv",
      detail: "Uavhengig kontroll av funnene, og ny prøve av det som er rettet",
    },
    { title: "Sorter", detail: "Funnfiler, forslag, rapport til Ståle og én PR" },
  ],
};

// ---------------------------------------------------------------------------
// Roller: bruker agentbeskrivelsen i .claude/agents/<rolle>.md når den er lastet i sesjonen.
// Er den ikke det, får en vanlig agent beskjed om å lese og følge filen selv.
// Testlaget bruker bare opus (Ståle 04.11.2026: spar fable-kvoten).
// ---------------------------------------------------------------------------
const errorText = (e) => {
  if (!e) return "";
  if (typeof e === "string") return e;
  try {
    return [e.message, e.error, e.reason, JSON.stringify(e)].filter(Boolean).join(" ");
  } catch {
    return String(e);
  }
};
async function run(role, prompt, opts) {
  const text = `Du er rollen «${role}» i EzProp. Les .claude/agents/${role}.md først og følg den.

${prompt}`;
  try {
    return await agent(prompt, { ...opts, agentType: role, model: "opus" });
  } catch (e) {
    if (!/not found/i.test(errorText(e))) throw e;
    return agent(text, { ...opts, model: "opus" });
  }
}

// ---------------------------------------------------------------------------
// Inndata
// ---------------------------------------------------------------------------
const today = (args && args.date) || "i dag";
const scope = args && args.scope === "alt" ? "alt" : "endret";
const onlyRoles = args && Array.isArray(args.roles) && args.roles.length > 0 ? args.roles : null;
const workDir = `var/testlag/${today}`;

// Testerne. «when» sier når rollen er med i en vanlig kjøring (scope «endret»).
// I en full kjøring (scope «alt») er alle med.
const TESTERS = [
  { role: "test-takstmann", when: "ui", port: 3311, user: "takstmann" },
  { role: "test-kontor", when: "ui", port: 3312, user: "kontor og leder" },
  {
    role: "test-robusthet",
    when: "ui",
    port: 3313,
    user: "takstmann, og en bruker i en annen organisasjon",
  },
  { role: "test-fag", when: "domain", port: 3314, user: "takstmann" },
  { role: "test-ki", when: "ai", port: 3315, user: "takstmann" },
  { role: "test-dokumentvakt", when: "docs", port: null, user: null },
  { role: "test-ny-ansatt", when: "full", port: 3316, user: "takstmann" },
];

const PREP = {
  type: "object",
  properties: {
    ok: { type: "boolean", description: "Er appen bygget og databasen klar?" },
    problem: { type: "string", description: "Hvis ikke ok: hva som feilet" },
    commit: { type: "string", description: "Commit på main som testes (kort sha)" },
    lastCommit: { type: "string", description: "Commit forrige kjøring testet, eller tom" },
    changed: {
      type: "object",
      properties: {
        ui: { type: "boolean", description: "Skjermer, flyter eller kjernefunksjoner er endret" },
        domain: {
          type: "boolean",
          description: "Mal, regler, grenser, fagtekster eller PDF er endret",
        },
        ai: { type: "boolean", description: "KI-modulen eller en KI-funksjon er endret" },
        docs: {
          type: "boolean",
          description: "Plan, beslutninger, agentbeskrivelser eller datamodell er endret",
        },
      },
      required: ["ui", "domain", "ai", "docs"],
    },
    changedSummary: {
      type: "string",
      description: "Kort: hva som er nytt siden sist, i klarspråk",
    },
    users: {
      type: "string",
      description: "Testbrukerne som er laget: e-post og rolle, én per linje",
    },
    retest: {
      type: "array",
      description: "Funn med status «rettet» som skal prøves på nytt",
      items: {
        type: "object",
        properties: { id: { type: "string" }, path: { type: "string" }, title: { type: "string" } },
        required: ["id", "path", "title"],
      },
    },
  },
  required: ["ok", "commit", "changed", "changedSummary", "retest"],
};

const FINDING = {
  type: "object",
  properties: {
    title: { type: "string" },
    type: { type: "string", enum: ["feil", "forbedring", "ide"] },
    severity: { type: "string", enum: ["alvorlig", "middels", "lite"] },
    area: {
      type: "string",
      description: "Område, for eksempel ordre, oppdrag, mal, publisering, innlogging",
    },
    where: { type: "string", description: "Side eller fil og linje" },
    steps: { type: "string", description: "Steg for å gjenskape, nummerert" },
    expected: { type: "string" },
    actual: { type: "string" },
    goal: { type: "string", description: "de ansatte, KI i bunnen eller reklamasjoner" },
    suggestion: { type: "string", description: "Forslag til løsning, kort" },
    evidence: { type: "string", description: "Sti til skjermbilde eller utskrift i var/testlag/" },
  },
  required: ["title", "type", "severity", "area", "where", "steps", "expected", "actual", "goal"],
};

const REPORT = {
  type: "object",
  properties: {
    tested: { type: "string", description: "Hva som ble prøvd, kort" },
    works: { type: "array", items: { type: "string" }, description: "Det som virker" },
    findings: { type: "array", items: FINDING },
    notes: {
      type: "string",
      description:
        "Annet kvalitetslederen bør få med: spørsmål til fagrådet, treffprosent for KI, listen over dyre beslutninger",
    },
  },
  required: ["tested", "works", "findings"],
};

const VERDICTS = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Nummeret funnet hadde i listen du fikk" },
          verdict: {
            type: "string",
            enum: ["bekreftet", "ikke gjenskapt", "duplikat", "ikke feil"],
          },
          severity: { type: "string", enum: ["alvorlig", "middels", "lite"] },
          note: {
            type: "string",
            description: "Hva du gjorde og så. Ved duplikat: id-en til funnet som finnes",
          },
        },
        required: ["index", "verdict", "note"],
      },
    },
    retests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["rettet bekreftet", "fortsatt feil"] },
          note: { type: "string" },
        },
        required: ["id", "verdict", "note"],
      },
    },
  },
  required: ["findings", "retests"],
};

const RULES = `Regler: bare den lokale appen og den lokale databasen, bare oppdiktede data, ingen e-post eller SMS ut, aldri testmiljøet i Azure, aldri IVIT, Spectora eller SmartTakst. Ikke endre produktkode, tester eller dokumenter. Skriv bare i ${workDir}/.`;

// ---------------------------------------------------------------------------
// 1. Klargjør
// ---------------------------------------------------------------------------
phase("Klargjør");
const prep = await run(
  "test-leder",
  `Testlaget ${today} (løkke G i docs/11-agentlaget.md, les docs/agenter/testlag/LES-MEG.md). Du klargjør for testerne. ${RULES}

1. Stå på main (git checkout main && git pull). Kjør pnpm install --frozen-lockfile, pnpm db:migrate, pnpm db:seed og pnpm db:seed:testoppdrag mot den lokale databasen (.env). Kjør pnpm build én gang. Testerne starter hver sin server fra dette bygget, så ikke la en server stå og gå.
2. Lag testbrukere i den lokale databasen, slik e2e-testene gjør det (se e2e/helpers.ts og hjelperen som sikrer en takstmann): én takstmann, én fra kontoret, én leder, og én bruker i en annen organisasjon. Bruk oppdiktede adresser som slutter på @testlag.invalid. Finnes de fra før, bruk dem. Returner e-post og rolle i «users».
3. Finn hva som er nytt: les nederst i docs/agenter/testlag/rapport.md («Sist kjørt på commit»). Finnes den, se git log <den>..HEAD --name-only. Finnes den ikke, er alt nytt. Sett «changed»: ui (src/app, src/core, src/modules, src/shared), domain (maler, regler, grenser, fagtekster, PDF), ai (src/core/ai eller en KI-funksjon), docs (docs/07-utviklingsplan.md, docs/09-apne-sporsmal.md, docs/05-domenemodell.md, docs/kartlegging/LES-MEG-kartlegging.md, CLAUDE.md, .claude/agents). Skriv i «changedSummary» hva som er nytt, i klarspråk, med oppgavekortene (docs/funksjoner/ og docs/agenter/oppgaver/) som gjelder.
4. List funn i docs/agenter/testlag/funn/ (ikke undermappen lukket) som har status «rettet» i «retest».
Feiler bygget eller databasen: sett ok til false og skriv hva som feilet i «problem».`,
  { label: "test-leder: klargjør", phase: "Klargjør", schema: PREP },
);
if (!prep) throw new Error("Klargjøringen ga ikke noe svar");
if (!prep.ok) {
  log(`Klargjøringen feilet: ${prep.problem || "ukjent grunn"}`);
  const broken = await run(
    "kvalitetsleder",
    `Testlaget ${today} kunne ikke starte: appen lot seg ikke bygge, eller databasen lot seg ikke sette opp på main (${prep.commit}).
Feilen: ${prep.problem || "ukjent"}

Dette er et alvorlig funn i seg selv. Lag én funnfil etter docs/agenter/testlag/mal-funn.md (type feil, alvor alvorlig, rolle test-leder), oppdater docs/agenter/testlag/rapport.md og avsnittet «Oppgaver fra testlaget» i docs/agenter/tilstand.md, og lever i én PR fra branchen testlag-${today} slik rollebeskrivelsen sier. Behold forrige «Sist kjørt på commit» i rapporten.`,
    { label: "kvalitetsleder: bygget feilet", phase: "Sorter" },
  );
  return { status: "bygget feilet", problem: prep.problem, summary: broken };
}

const isOn = (t) => {
  if (onlyRoles) return onlyRoles.includes(t.role);
  if (scope === "alt") return true;
  if (t.when === "full") return false;
  return Boolean(prep.changed[t.when]);
};
const testers = TESTERS.filter(isOn);
if (testers.length === 0 && prep.retest.length === 0) {
  log(
    `Ingenting nytt siden ${prep.lastCommit || "forrige kjøring"}, og ingen rettede funn å prøve på nytt.`,
  );
  return { status: "ingenting nytt", commit: prep.commit };
}
log(
  `Tester ${prep.commit} (${scope}): ${testers.map((t) => t.role).join(", ") || "ingen testere"}. ${prep.retest.length} rettede funn prøves på nytt.`,
);

// ---------------------------------------------------------------------------
// 2. Test (hver tester for seg, i parallell)
// ---------------------------------------------------------------------------
phase("Test");
const startHint = (t) =>
  t.port
    ? `Start din egen server fra bygget som finnes: BETTER_AUTH_URL=http://localhost:${t.port} DEV_MAILBOX=1 pnpm start --port ${t.port} (i bakgrunnen), og vent på http://localhost:${t.port}/api/helse. Ikke bygg på nytt. Stopp serveren når du er ferdig. Logg inn med engangskode fra http://localhost:${t.port}/dev/epost. Flere testere logger inn samtidig, så finn e-posten som er sendt til din egen adresse. Bruk: ${t.user}. Playwright: PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium hvis den finnes.`
    : "Du trenger ikke appen. Du leser dokumentene, koden og git-historikken.";

const testResults = await parallel(
  testers.map(
    (t) => () =>
      run(
        t.role,
        `Testlaget ${today}, main ved ${prep.commit}. ${RULES}

Nytt siden sist: ${prep.changedSummary}
${scope === "alt" ? "Dette er en full kjøring: prøv alt som er bygget, ikke bare det nye." : "Prøv først det som er nytt, og deretter det nye henger sammen med."}

Testbrukere:
${prep.users || "(ingen oppgitt, bruk admin fra seed)"}

${startHint(t)}

Arbeidsmappe for skript og skjermbilder: ${workDir}/${t.role}/.
Les docs/agenter/testlag/funn/ først, og meld ikke det som står der. Lever det rollebeskrivelsen din sier: hva du prøvde, hva som virker, og funn som kan gjenskapes.`,
        { label: t.role, phase: "Test", schema: REPORT },
      ).then((r) => r && { role: t.role, ...r }),
  ),
);
const reports = testResults.filter(Boolean);
const silent = testers.filter((t) => !reports.some((r) => r.role === t.role)).map((t) => t.role);
if (silent.length > 0) log(`Testere uten rapport: ${silent.join(", ")}`);

const all = reports.flatMap((r) => r.findings.map((f) => ({ role: r.role, ...f })));
const bugs = all.filter((f) => f.type === "feil");
const improvements = all.filter((f) => f.type === "forbedring");
const ideas = all.filter((f) => f.type === "ide");
log(
  `${bugs.length} feil, ${improvements.length} forbedringer og ${ideas.length} ideer fra ${reports.length} testere`,
);

// ---------------------------------------------------------------------------
// 3. Etterprøv (uavhengig av den som fant feilen)
// Alvorlige og middels feil etterprøves. Små feil tas med som de er.
// ---------------------------------------------------------------------------
phase("Etterprøv");
const toVerify = bugs.filter((f) => f.severity !== "lite").map((f, i) => ({ index: i + 1, ...f }));
const BATCH = 6;
const batches = [];
for (let i = 0; i < toVerify.length; i += BATCH)
  batches.push({ findings: toVerify.slice(i, i + BATCH), retest: [] });
if (prep.retest.length > 0) {
  if (batches.length === 0) batches.push({ findings: [], retest: [] });
  batches[batches.length - 1].retest = prep.retest;
}
const describe = (f) =>
  `Funn ${f.index} [${f.area}, meldt som ${f.severity}]: ${f.title}\nHvor: ${f.where}\nSteg: ${f.steps}\nForventet: ${f.expected}\nFaktisk: ${f.actual}`;

const verdictResults = await parallel(
  batches.map(
    (b, n) => () =>
      run(
        "funn-kontrollor",
        `Testlaget ${today}, main ved ${prep.commit}. ${RULES}

Start din egen server fra bygget som finnes: BETTER_AUTH_URL=http://localhost:${3321 + n} DEV_MAILBOX=1 pnpm start --port ${3321 + n} (i bakgrunnen). Stopp den når du er ferdig. Arbeidsmappe: ${workDir}/funn-kontrollor-${n + 1}/.
Testbrukere:
${prep.users || "(ingen oppgitt, bruk admin fra seed)"}

Gjenskap hvert funn selv, uten å gå ut fra at det stemmer:
${b.findings.length === 0 ? "(ingen nye funn i denne bunken)" : b.findings.map(describe).join("\n\n")}

Funn som er meldt rettet, og som skal prøves på nytt etter stegene i funnfilen:
${b.retest.length === 0 ? "(ingen)" : b.retest.map((r) => `- ${r.id}: ${r.title} (${r.path})`).join("\n")}`,
        { label: `funn-kontrollør ${n + 1}`, phase: "Etterprøv", schema: VERDICTS },
      ),
  ),
);
const verdicts = verdictResults.filter(Boolean);
const byIndex = new Map(verdicts.flatMap((v) => v.findings).map((v) => [v.index, v]));
const retests = verdicts.flatMap((v) => v.retests);
const judged = toVerify.map((f) => ({ ...f, check: byIndex.get(f.index) || null }));
const confirmed = judged.filter((f) => f.check && f.check.verdict === "bekreftet");
// Uten dom (kontrolløren svarte ikke) regnes funnet som ikke bekreftet: det blir ingen oppgave.
const unconfirmed = judged.filter((f) => !f.check || f.check.verdict !== "bekreftet");
const small = bugs.filter((f) => f.severity === "lite");
log(
  `Etterprøvd: ${confirmed.length} bekreftet, ${unconfirmed.length} ikke bekreftet. Prøvd på nytt: ${retests.filter((r) => r.verdict === "rettet bekreftet").length} rettet, ${retests.filter((r) => r.verdict === "fortsatt feil").length} fortsatt feil.`,
);

// ---------------------------------------------------------------------------
// 4. Sorter og rapporter
// ---------------------------------------------------------------------------
phase("Sorter");
const line = (f) =>
  `- [${f.role}, ${(f.check && f.check.severity) || f.severity}, ${f.area}] ${f.title}\n  Hvor: ${f.where}\n  Steg: ${f.steps}\n  Forventet: ${f.expected}\n  Faktisk: ${f.actual}\n  Mål: ${f.goal}${f.suggestion ? `\n  Forslag: ${f.suggestion}` : ""}${f.evidence ? `\n  Bevis: ${f.evidence}` : ""}${f.check ? `\n  Etterprøvd: ${f.check.verdict}. ${f.check.note}` : ""}`;
const list = (items) => (items.length === 0 ? "(ingen)" : items.map(line).join("\n"));

const summary = await run(
  "kvalitetsleder",
  `Testlaget ${today} er ferdig med main ved ${prep.commit} (${scope === "alt" ? "full kjøring" : "det som er nytt siden " + (prep.lastCommit || "start")}).
Testere med rapport: ${reports.map((r) => r.role).join(", ") || "ingen"}. Uten rapport: ${silent.join(", ") || "ingen"}.

HVA SOM BLE PRØVD OG VIRKER
${reports.map((r) => `${r.role}: ${r.tested}\n${r.works.map((w) => `  + ${w}`).join("\n")}`).join("\n") || "(ingen rapporter)"}

BEKREFTEDE FEIL (lag funnfil, status «ny»)
${list(confirmed)}

SMÅ FEIL (ikke etterprøvd, lag funnfil, status «ny»)
${list(small)}

IKKE BEKREFTET (ingen funnfil, bare nevnt i rapporten)
${list(unconfirmed)}

FORBEDRINGER (funnfil bare hvis de ligger innenfor planen, ellers er de ideer)
${list(improvements)}

IDEER (høyst fem til docs/09-apne-sporsmal.md som forslag)
${list(ideas)}

PRØVD PÅ NYTT
${retests.length === 0 ? "(ingen)" : retests.map((r) => `- ${r.id}: ${r.verdict}. ${r.note}`).join("\n")}

ANNET FRA TESTERNE
${
  reports
    .filter((r) => r.notes)
    .map((r) => `${r.role}: ${r.notes}`)
    .join("\n") || "(ingenting)"
}

Gjør det rollebeskrivelsen din sier: funnfiler, flytt lukkede funn, forslag og spørsmål til docs/09-apne-sporsmal.md, rapporten til Ståle (docs/agenter/testlag/rapport.md, med «Sist kjørt på commit: ${prep.commit}» nederst), avsnittet «Oppgaver fra testlaget» i docs/agenter/tilstand.md, og listen docs/agenter/testlag/beslutninger-til-staale.md hvis dokumentvakten leverte den. Alt i én PR fra branchen testlag-${today}. Rapporter kort hva du gjorde.`,
  { label: "kvalitetsleder: sorter og rapporter", phase: "Sorter" },
);

return {
  status: "ferdig",
  commit: prep.commit,
  confirmed: confirmed.length,
  small: small.length,
  unconfirmed: unconfirmed.length,
  improvements: improvements.length,
  ideas: ideas.length,
  retests,
  silent,
  summary,
};
