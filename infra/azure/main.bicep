// Testmiljø for appen i Azure: App Service (Linux, Node 22) + PostgreSQL Flexible Server.
// Rulles ut av .github/workflows/deploy-azure.yml ved merge til main.
// Hva Ståle gjør selv (ressursgruppe, innlogging for GitHub, secrets, adresse): docs/drift/testmiljo-azure.md
// Begrunnelse og kjente avveininger: docs/adr/0002-testmiljo-azure.md
//
// Filen er på ressursgruppenivå og lager ikke ressursgruppen. Ingen verdier for hemmeligheter står her;
// alt kommer som parametere fra arbeidsflyten (GitHub-secrets). Ingen hostname-binding eller sertifikat
// her; egen adresse legges inn i Azure-portalen etterpå. Når nøkkelboksen er på (enableKeyVault, ADR 0005),
// legges hemmelighetene i Key Vault og appen leser dem derfra med Key Vault-referanser.

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

@description('Nøkkelboks (Key Vault) for hemmeligheter, ADR 0005. Av som standard; Ståle slår på med GitHub-variabelen ENABLE_KEY_VAULT.')
param enableKeyVault bool = false

// ---------- Navn og avledede verdier ----------

var planName = 'plan-ezprop-${environmentName}'
var appName = 'app-ezprop-${environmentName}'
var postgresServerName = 'psql-ezprop-${environmentName}'
var databaseName = 'ezprop'
var kvName = 'kv-ezprop-${environmentName}'

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
  // Med nøkkelboksen på leser appen hemmelighetene fra Key Vault (siste versjon, uten versjonsnummer).
  { name: 'DATABASE_URL', value: enableKeyVault ? '@Microsoft.KeyVault(SecretUri=${kvDatabaseUrl!.properties.secretUri})' : databaseUrl }
  { name: 'BETTER_AUTH_SECRET', value: enableKeyVault ? '@Microsoft.KeyVault(SecretUri=${kvBetterAuthSecret!.properties.secretUri})' : betterAuthSecret }
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
      { name: 'MS_GRAPH_CLIENT_SECRET', value: enableKeyVault ? '@Microsoft.KeyVault(SecretUri=${kvMsGraphClientSecret!.properties.secretUri})' : msGraphClientSecret }
      { name: 'MAIL_FROM', value: mailFrom }
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
  // Systemtildelt identitet: koster ingenting og lager ingen ny ressurs. Brukes bare av nøkkelboksen (ADR 0005).
  identity: {
    type: 'SystemAssigned'
  }
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
      appSettings: concat(baseAppSettings, emailAppSettings)
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

// ---------- Nøkkelboks for hemmeligheter (bare når bryteren er på, ADR 0005) ----------
// Standard prisnivå, betaling per oppslag. Myk sletting og slettesperre er på, så en hemmelighet kan ikke
// fjernes for godt ved et uhell. Ingen nettverksregler her (privat nettverk står i «Minimum før ekte data»).
// Verdiene kommer fra de samme parameterne som før; de står aldri som fast tekst.

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = if (enableKeyVault) {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableSoftDelete: true
    enablePurgeProtection: true
    enableRbacAuthorization: false
    accessPolicies: []
  }
}

resource kvDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (enableKeyVault) {
  parent: vault
  name: 'database-url'
  properties: {
    value: databaseUrl
  }
}

resource kvBetterAuthSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (enableKeyVault) {
  parent: vault
  name: 'better-auth-secret'
  properties: {
    value: betterAuthSecret
  }
}

resource kvMsGraphClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (enableKeyVault && emailConfigured) {
  parent: vault
  name: 'ms-graph-client-secret'
  properties: {
    value: msGraphClientSecret
  }
}

// Appen får bare lese én og én hemmelighet (get). Ikke liste, skrive eller slette.
resource vaultAccess 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = if (enableKeyVault) {
  parent: vault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: subscription().tenantId
        objectId: app.identity.principalId
        permissions: {
          secrets: ['get']
        }
      }
    ]
  }
}

// ---------- Utdata (aldri hemmeligheter; alt her havner i GitHub-loggen) ----------

output postgresServerName string = postgres.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output appName string = app.name
output appUrl string = defaultAppUrl
