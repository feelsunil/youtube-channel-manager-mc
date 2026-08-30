@description('Azure region for the Container Apps environment.')
param location string = resourceGroup().location

@description('Public GHCR image, for example ghcr.io/owner/youtube-channel-manager-mcp:latest.')
param containerImage string

@secure()
param googleClientId string

@secure()
param googleClientSecret string

@secure()
param tokenEncryptionKey string

@secure()
param setupToken string

@secure()
param mcpAccessToken string

param appName string = 'youtube-channel-mcp'
param environmentName string = 'youtube-mcp-env'
param fileShareName string = 'youtube-mcp-data'

var storageAccountName = take('ytmcp${uniqueString(subscription().subscriptionId, resourceGroup().id)}', 24)

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: fileShareName
  properties: {
    enabledProtocols: 'SMB'
    shareQuota: 1
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {}
}

resource environmentStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: environment
  name: 'youtube-mcp-data'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: fileShare.name
      accessMode: 'ReadWrite'
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8787
        transport: 'auto'
      }
      secrets: [
        { name: 'google-client-id', value: googleClientId }
        { name: 'google-client-secret', value: googleClientSecret }
        { name: 'token-encryption-key', value: tokenEncryptionKey }
        { name: 'setup-token', value: setupToken }
        { name: 'mcp-access-token', value: mcpAccessToken }
      ]
    }
    template: {
      containers: [
        {
          name: 'youtube-mcp'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'PORT', value: '8787' }
            { name: 'BASE_URL', value: 'https://${appName}.${environment.properties.defaultDomain}' }
            { name: 'GOOGLE_CLIENT_ID', secretRef: 'google-client-id' }
            { name: 'GOOGLE_CLIENT_SECRET', secretRef: 'google-client-secret' }
            { name: 'TOKEN_ENCRYPTION_KEY', secretRef: 'token-encryption-key' }
            { name: 'SETUP_TOKEN', secretRef: 'setup-token' }
            { name: 'MCP_ACCESS_TOKEN', secretRef: 'mcp-access-token' }
            { name: 'YOUTUBE_MODE', value: 'readonly' }
            { name: 'MUTATIONS_ENABLED', value: 'false' }
            { name: 'DATA_DIR', value: '/app/data' }
            { name: 'UPLOAD_ROOT', value: '/app/uploads' }
            { name: 'LOG_LEVEL', value: 'info' }
          ]
          volumeMounts: [
            { volumeName: 'oauth-data', mountPath: '/app/data' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 8787, scheme: 'HTTP' }
              initialDelaySeconds: 2
              periodSeconds: 5
              failureThreshold: 12
            }
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 8787, scheme: 'HTTP' }
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'oauth-data'
          storageType: 'AzureFile'
          storageName: environmentStorage.name
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '5' } }
          }
        ]
      }
    }
  }
  dependsOn: [environmentStorage]
}

output baseUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output healthUrl string = 'https://${app.properties.configuration.ingress.fqdn}/health'
output mcpUrl string = 'https://${app.properties.configuration.ingress.fqdn}/mcp'

