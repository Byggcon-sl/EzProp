// Testmiljø for appen i Azure: App Service (Linux, Node 22) + PostgreSQL Flexible Server.
// Rulles ut av .github/workflows/deploy-azure.yml ved merge til main.
// Hva Ståle gjør selv (ressursgruppe, innlogging for GitHub, secrets, adresse): docs/drift/testmiljo-azure.md
// Begrunnelse og kjente avveininger: docs/adr/0002-testmiljo-azure.md
//
// Filen er på ressursgruppenivå og lager ikke ressursgruppen. Ingen verdier for hemmeligheter står her;
// alt kommer som parametere fra arbeidsflyten (GitHub-secrets). Ingen hostname-binding eller sertifikat
// her; egen adresse legges inn i Azure-portalen etterpå.

targetScope = 'resourceGroup'

// ---------- Parametere ----------

@description('Region. Samme som Optiplan (Sweden Central, EU).')
param location string = 'swedencentral'

@description('Miljønavn. Inngår i alle ressursnavn, så prod kan legges til senere uten kollisjon.')
@minLength(2)
@maxLength(10)
param environmentName string = 'test'

@description('Egen adresse for appen (en adresse under byggcon.no, se docs/drift). Tom = bruk azurewebsites.net. Styrer bare BETTER_AUTH_URL.')
param appHostname string = ''

@description('Kort commit-id som vises i /api/helse.')
@minLength(1)
param appVersion string

@description('E-postadressen til første admin (seed). Eneste som kan logge inn før e-post er koblet til.')
@minLength(3)
param seedAdminEmail string

@description('Administratorbruker på databasen.')
param postgresAdminLogin string = 'ezprop_admin'

@description('Passord for administratorbrukeren på databasen. Bare bokstaver og tall (brukes i en URL).')
@secure()
param postgresAdminPassword string

@description('Hemmelighet for Better Auth (minst 32 tegn).')
@secure()
param betterAuthSecret string

// E-post via Microsoft 365 (Graph). Alle fire settes sammen, ellers tomme. Selve sendingen kommer i fase 0b;
// til da skrives engangskoden for første admin i serverloggen (se docs/drift/testmiljo-azure.md).
@description('Microsoft 365: tenant-id. Tom til e-post kobles til.')
param msGraphTenantId string = ''

@description('Microsoft 365: app-id (client-id). Tom til e-post kobles til.')
param msGraphClientId string = ''

@description('Microsoft 365: klienthemmelighet. Tom til e-post kobles til.')
@secure()
param msGraphClientSecret string

@description('Avsenderadresse for e-post. Tom til e-post kobles til.')
param mailFrom string = ''

// Prøve fase 1: synktjenestene PowerSync og ElectricSQL (ADR 0003). AV som standard, så en merge til
// main lager ingen nye ressurser. Ståle slår på med GitHub-variabelen ENABLE_SYNC_TRIAL (docs/drift).
@description('Slår på synktjenestene for prøve A og B (koster penger). Standard av.')
param enableSyncTrial bool = false

// De fire hemmelighetene under trengs bare når bryteren er på; tom standardverdi så utrullingen virker uten dem.
// scripts/azure/check-sync-secrets.sh stopper utrullingen hvis bryteren er på og noen mangler.
@description('Nøkkelen appen signerer synk-tokens med (POWERSYNC_JWT_SECRET). Bare når bryteren er på.')
@secure()
param powerSyncJwtSecret string = ''

@description('Passord for databaserollen powersync_repl. Bare bokstaver og tall. Bare når bryteren er på.')
@secure()
param powerSyncDbPassword string = ''

@description('Nøkkelen appen bruker mot Electric (ELECTRIC_SECRET). Bare når bryteren er på.')
@secure()
param electricSecret string = ''

@description('Passord for databaserollen electric_repl. Bare bokstaver og tall. Bare når bryteren er på.')
@secure()
param electricDbPassword string = ''

// ---------- Navn og avledede verdier ----------

var planName = 'plan-ezprop-${environmentName}'
var appName = 'app-ezprop-${environmentName}'
var postgresServerName = 'psql-ezprop-${environmentName}'
var databaseName = 'ezprop'
var containerEnvName = 'cae-ezprop-${environmentName}'
var powerSyncAppName = 'ca-ezprop-powersync-${environmentName}'
var electricAppName = 'ca-ezprop-electric-${environmentName}'

var defaultAppUrl = 'https://${appName}.azurewebsites.net'
var betterAuthUrl = empty(appHostname) ? defaultAppUrl : 'https://${appHostname}'
var emailConfigured = !empty(msGraphTenantId) && !empty(msGraphClientId) && !empty(msGraphClientSecret) && !empty(mailFrom)

// Appen snakker med databasen over TLS og sjekker sertifikatet (verify-full, ikke require).
var databaseUrl = 'postgres://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=verify-full'

var baseAppSettings = [
  { name: 'NODE_ENV', value: 'production' }
  // Next sin server.js lytter på HOSTNAME hvis den er satt, og containeren setter den til sitt eget navn.
  // 0.0.0.0 betyr «alle adresser», så helsesjekken alltid når fram.
  { name: 'HOSTNAME', value: '0.0.0.0' }
  // Pakken som rulles ut er ferdig bygd (.next/standalone). Serveren skal ikke bygge noe selv.
  { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
  { name: 'DATABASE_URL', value: databaseUrl }
  { name: 'BETTER_AUTH_SECRET', value: betterAuthSecret }
  { name: 'BETTER_AUTH_URL', value: betterAuthUrl }
  { name: 'SEED_ADMIN_EMAIL', value: seedAdminEmail }
  { name: 'APP_VERSION', value: appVersion }
  // Bilder fra prøven (fase 1). Under /home, som App Service beholder ved omstart.
  { name: 'TRIAL_UPLOAD_DIR', value: '/home/data/uploads/trial' }
]

var emailAppSettings = emailConfigured
  ? [
      { name: 'MS_GRAPH_TENANT_ID', value: msGraphTenantId }
      { name: 'MS_GRAPH_CLIENT_ID', value: msGraphClientId }
      { name: 'MS_GRAPH_CLIENT_SECRET', value: msGraphClientSecret }
      { name: 'MAIL_FROM', value: mailFrom }
    ]
  : []

// Synktjenestene (bare når bryteren er på). Adressene bygges av miljøets domene, så appen avhenger
// bare av Container Apps-miljøet og ikke av containerne (Electric avhenger av appen, se under).
// ELECTRIC_URL brukes bare på serveren (shape-ruten), aldri i nettleseren.
var syncTrialAppSettings = enableSyncTrial
  ? [
      { name: 'POWERSYNC_URL', value: 'https://${powerSyncAppName}.${containerEnv!.properties.defaultDomain}' }
      { name: 'POWERSYNC_JWT_SECRET', value: powerSyncJwtSecret }
      { name: 'ELECTRIC_URL', value: 'https://${electricAppName}.${containerEnv!.properties.defaultDomain}' }
      { name: 'ELECTRIC_SECRET', value: electricSecret }
    ]
  : []

// ---------- Database ----------

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Bare TLS. Dette er standard på Flexible Server, men står her så det ikke kan skrus av ved et uhell.
resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'require_secure_transport'
  properties: {
    value: 'on'
    source: 'user-override'
  }
  dependsOn: [database]
}

// Lar App Service nå databasen. Kjent avveining: regelen åpner for alle Azure-kunders IP-adresser
// (ADR 0002). Privat nettverk eller VNet-integrasjon står i «Minimum før ekte data».
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [requireTls]
}

// Logisk replikering for synktjenestene (bare når bryteren er på). Etter brannmurregelen, fordi
// samtidige endringer på serveren gir ServerIsBusy. Krever omstart av databasen; arbeidsflyten gjør
// den når Azure melder at den trengs. Settes ikke tilbake når bryteren slås av (ufarlig).
resource walLevel 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = if (enableSyncTrial) {
  parent: postgres
  name: 'wal_level'
  properties: {
    value: 'logical'
    source: 'user-override'
  }
  dependsOn: [allowAzureServices]
}

// ---------- App ----------

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      // Standalone-bygget fra Next starter ikke av seg selv. Serveren lytter der App Service ber den om det.
      appCommandLine: 'node server.js'
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      healthCheckPath: '/api/helse'
      appSettings: concat(baseAppSettings, emailAppSettings, syncTrialAppSettings)
    }
  }
}

// Applikasjonslogg til filsystemet, kort oppbevaring: Ståle leser engangskoden i Log stream
// uten at loggen blir liggende.
resource appLogs 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: app
  name: 'logs'
  properties: {
    applicationLogs: {
      fileSystem: {
        level: 'Information'
      }
    }
    httpLogs: {
      fileSystem: {
        enabled: true
        retentionInDays: 3
        retentionInMb: 35
      }
    }
    detailedErrorMessages: {
      enabled: false
    }
    failedRequestsTracing: {
      enabled: false
    }
  }
}

// ---------- Synktjenestene for prøve A og B (bare når bryteren er på, ADR 0003) ----------
// Samme faste versjoner som docker-compose.yml. Begge når databasen gjennom regelen for Azure-tjenester
// over TLS med sertifikatsjekk. Rollene powersync_repl og electric_repl og databasen powersync_storage
// lages av scripts/azure/sync-trial-roles.ts fra arbeidsflyten; til de finnes kan containerne starte
// på nytt et par ganger.

// Navn på Container Apps-secrets (bare små bokstaver, tall og bindestrek).
var psDataSourceUriRef = 'ps-data-source-uri'
var psStorageUriRef = 'ps-storage-uri'
var psJwtKeyRef = 'ps-jwt-secret-base64'
var psConfigRef = 'powersync-config-yaml'
var psSyncRulesRef = 'powersync-sync-rules-yaml'
var electricDatabaseUrlRef = 'electric-database-url'
var electricSecretRef = 'electric-secret'

var postgresHost = postgres.properties.fullyQualifiedDomainName
var powerSyncDataSourceUri = 'postgresql://powersync_repl:${uriComponent(powerSyncDbPassword)}@${postgresHost}:5432/${databaseName}'
var powerSyncStorageUri = 'postgresql://powersync_repl:${uriComponent(powerSyncDbPassword)}@${postgresHost}:5432/powersync_storage'
// PowerSync vil ha nøkkelen som base64url av de samme bytene appen signerer med (som start.sh lokalt).
var powerSyncJwtKey = replace(replace(replace(base64(powerSyncJwtSecret), '+', '-'), '/', '_'), '=', '')
var electricDatabaseUrl = 'postgresql://electric_repl:${uriComponent(electricDbPassword)}@${postgresHost}:5432/${databaseName}?sslmode=verify-full'

// Electric slipper bare inn appens utgående adresser (IPv4). Et ekstra lag; ELECTRIC_SECRET er den
// egentlige beskyttelsen, fordi adressene deles med andre Azure-kunder.
var appOutboundIpv4 = filter(split(app.properties.possibleOutboundIpAddresses, ','), ip => !contains(ip, ':'))

// Forbruksplan, uten lagrede logger (loggstrømmen i portalen brukes under prøven).
resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = if (enableSyncTrial) {
  name: containerEnvName
  location: location
  properties: {
    appLogsConfiguration: {}
    zoneRedundant: false
  }
}

resource powerSync 'Microsoft.App/containerApps@2024-03-01' = if (enableSyncTrial) {
  name: powerSyncAppName
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        { name: psDataSourceUriRef, value: powerSyncDataSourceUri }
        { name: psStorageUriRef, value: powerSyncStorageUri }
        // Lages av den sikre parameteren powerSyncJwtSecret; linteren ser ikke gjennom base64 og replace.
        #disable-next-line use-secure-value-for-secure-inputs
        { name: psJwtKeyRef, value: powerSyncJwtKey }
        // Konfigfilene fra repoet er ikke hemmelige (de leser hemmelighetene fra miljøet), men
        // Container Apps monterer bare secrets som filer.
        #disable-next-line use-secure-value-for-secure-inputs
        { name: psConfigRef, value: loadTextContent('../../powersync/config.yaml') }
        #disable-next-line use-secure-value-for-secure-inputs
        { name: psSyncRulesRef, value: loadTextContent('../../powersync/sync-rules.yaml') }
      ]
    }
    template: {
      containers: [
        {
          name: 'powersync'
          image: 'journeyapps/powersync-service:1.27.2'
          // I Container Apps erstatter args bildets CMD, slik command gjør i docker-compose.yml.
          args: ['start', '-r', 'unified']
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'POWERSYNC_CONFIG_PATH', value: '/config/config.yaml' }
            {
              name: 'PS_DATA_SOURCE_URI'
              secretRef: psDataSourceUriRef
            }
            {
              name: 'PS_STORAGE_URI'
              secretRef: psStorageUriRef
            }
            {
              name: 'PS_JWT_SECRET_BASE64'
              secretRef: psJwtKeyRef
            }
            { name: 'PS_PG_SSLMODE', value: 'verify-full' }
          ]
          volumeMounts: [
            { volumeName: 'powersync-config', mountPath: '/config' }
          ]
        }
      ]
      volumes: [
        {
          name: 'powersync-config'
          storageType: 'Secret'
          secrets: [
            { secretRef: psConfigRef, path: 'config.yaml' }
            { secretRef: psSyncRulesRef, path: 'sync-rules.yaml' }
          ]
        }
      ]
      // Én replikeringsstrøm: aldri null og aldri to kopier.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource electric 'Microsoft.App/containerApps@2024-03-01' = if (enableSyncTrial) {
  name: electricAppName
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        // map, ikke for: adressene er først kjent når appen finnes.
        ipSecurityRestrictions: map(appOutboundIpv4, (ip, i) => {
          name: 'app-utgaende-${i}'
          description: 'Appens utgående adresse'
          ipAddressRange: '${ip}/32'
          action: 'Allow'
        })
      }
      secrets: [
        { name: electricDatabaseUrlRef, value: electricDatabaseUrl }
        { name: electricSecretRef, value: electricSecret }
      ]
    }
    template: {
      containers: [
        {
          name: 'electric'
          image: 'electricsql/electric:1.8.1'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: electricDatabaseUrlRef
            }
            {
              name: 'ELECTRIC_SECRET'
              secretRef: electricSecretRef
            }
            { name: 'ELECTRIC_USAGE_REPORTING', value: 'false' }
            // Publikasjonen lages av migrering 0002; Electric endrer den ikke selv.
            { name: 'ELECTRIC_MANUAL_TABLE_PUBLISHING', value: 'true' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ---------- Utdata (aldri hemmeligheter; alt her havner i GitHub-loggen) ----------

output postgresServerName string = postgres.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output appName string = app.name
output appUrl string = defaultAppUrl
