---
title: "Eliminate Easy Auth client secrets"
date: 2025-08-25T17:15:00+02:00
# lastmod: 2025-07-25T04:19:00+02:00
description: "Replace client secrets with federated credentials for Easy Auth"
tags: ["azure", "webapp", "appservice", "managed-identity", "federated-credentials", "powershell", "bicep", "entraid"]
type: post
image: "/images/app-reg-mi-fed-auth/entra-heart-managed-id.png"
# weight: 7
showTableOfContents: true
---

![Title image](/images/app-reg-mi-fed-auth/entra-heart-managed-id.png "Title image")

At work we use [acmebot](https://github.com/shibayan/appservice-acmebot) with a dashboard available through an azure web app. Access to the dashboard is configured to use authentication to Entra via an Enterprise application and Easy Auth. The app registration is configured to use a client secret and by the time I got back from summer vacation, the secret had expired... So now I want to eliminate the need for these client secrets!

# Easy Auth
Easy Auth is the built-in authentication (signing in users) and authorization (providing access to secure data) capabilities in Azure App Service. You can use these mechanisms to require users to sign-in in order to access data, all by writing little or no code in your web app, RESTful API, mobile server, and functions.

Have a look at the [feature architecture](https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization#how-it-works) for details about how EasyAuth works.

In this post I will setup a website with authentication through Easy Auth using an app registration and a client secret. To eliminate the use of the client secret, federated credentials will be configured. In the post I use a static web app, but same would apply to any app service.

# Entra App Registration
First create and prepare the app registration. Use placeholder values for login and logout callback urls, I'll come back and update these urls with the correct values once the webapp is up.

{{< imagecaption source="/images/app-reg-mi-fed-auth/app-reg-create.png" alt="created app registration" title="created app registration" >}}

For the initial setup I go ahead and create a client secret, the goal will be to eliminate the use for it.

{{< imagecaption source="/images/app-reg-mi-fed-auth/app-reg-secret.png" alt="client secret" title="client secret" >}}

# Azure Web App
Next up is to create a web app. Since it is a demo, I have put the client secret as a cleartext instead of a keyvault reference.

```bicep
targetScope = 'subscription'

param resourceGroupName string
param appName string
param appLocation string
param easyAuthAppRegClientId string
param uamiName string

module rg 'br/public:avm/res/resources/resource-group:0.4.1' = {
  params: {
    name: resourceGroupName
  }
}

module uami 'br/public:avm/res/managed-identity/user-assigned-identity:0.4.1' = {
  scope: resourceGroup(resourceGroupName)
  dependsOn: [rg]
  params: {
    name: uamiName
  }
}

// resource type 'Microsoft.Web/staticSites'. List of available regions for the resource type is 'westus2,centralus,eastus2,westeurope,eastasia'.
module staticwebapp 'br/public:avm/res/web/static-site:0.9.1' = {
  scope: resourceGroup(resourceGroupName)
  dependsOn: [rg]
  params: {
    name: appName
    location: appLocation
    sku: 'Standard'
    publicNetworkAccess: 'Enabled'
    appSettings: {
      AZURE_CLIENT_ID: easyAuthAppRegClientId
      MICROSOFT_PROVIDER_AUTHENTICATION_SECRET: 'avoid-clear-text-secret-4TR8Q...'
      // alternative keyvault reference '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=clientSecret)'
    }
    managedIdentities: {
      userAssignedResourceIds: [uami.outputs.resourceId]
    }
  }
}

output staticwebappUamiObjectId string = uami.outputs.principalId
```

## Site content
My demo site will be a static html file and *staticwebapp.config.json* for storing the app registration details for easy auth, and require authentication for all routes.

*./src/app/index.html*
```html
<h1>Static Web App behind Easy Auth</h1>
```

*./src/app/staticwebapp.config.json*
```json
{
  "routes": [
    {
      "route": "/*",
      "allowedRoles": ["authenticated"]
    }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/aad?post_login_redirect_uri=.referrer",
      "statusCode": 302
      }
  },
  "auth": {
    "identityProviders": {
      "azureActiveDirectory": {
        "registration": {
          "openIdIssuer": "https://login.microsoftonline.com/{TENANT-ID}/v2.0",
          "clientIdSettingName": "AZURE_CLIENT_ID",
          "clientSecretSettingName": "MICROSOFT_PROVIDER_AUTHENTICATION_SECRET"
        }
      }
    }
  }
}
```

## Install the swa cli
```cmd
winget install -e --id OpenJS.NodeJS
npm install -g @azure/static-web-apps-cli
swa --version
```

## Publish site
*./scripts/publish-to-stapp.ps1*
```pwsh
#Requires -Modules @{ ModuleName="Az.Websites"; ModuleVersion="3.2.1" }

param (
    $Name = "stapp-easyauth-001",
    $ResourceGroupName = "rg-easyauth-001",
    $Environment = "preview-{0}" -f (Get-Date -Format "yyyyMMddHHmmss")
)

$env:SWA_CLI_DEPLOYMENT_TOKEN = ((Get-AzStaticWebAppSecret -Name $Name -ResourceGroupName $ResourceGroupName).Property | ConvertFrom-Json).apiKey

swa deploy ./src/app --app-name $Name --resource-group $ResourceGroupName  --env $Environment --deployment-token $env:SWA_CLI_DEPLOYMENT_TOKEN
```
{{< imagecaption source="/images/app-reg-mi-fed-auth/swa-deploy.png" alt="swa deploy" title="swa deploy" >}}

# Test site with client secret
With the app service up, head back to the app registration and update the redirect url and logout url. If everything is done correctly the site should redirect to a microsoft signin page if the visitor does not have any active session. Signing in with valid credentials will allow entrance to the site.

{{< imagecaption source="/images/app-reg-mi-fed-auth/site-redirect-to-login.png" alt="site redirects to login" title="site redirects to login" >}}

{{< imagecaption source="/images/app-reg-mi-fed-auth/site-up.png" alt="site up" title="site up" >}}

# Eliminate client secret
Now what we are really here for, remove the need for a client secret...

The app registration will now be updated with federated credentials allowing the user assigned managed identity associated with the web app to impersonate the application.

{{< imagecaption source="/images/app-reg-mi-fed-auth/app-reg-fed-overview-before.png" alt="add federated credentials" title="add federated credentials" >}}

{{< imagecaption source="/images/app-reg-mi-fed-auth/app-reg-managed-id-fed.png" alt="details for federated credentials" title="details for federated credentials" >}}

{{< imagecaption source="/images/app-reg-mi-fed-auth/app-reg-fed-overview-after.png" alt="federated credentials created" title="federated credentials created" >}}

Now the property-value for *clientSecretSettingName* in *staticwebapp.config.json* must be updated to *OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID*:
```json
{
  ...
  "registration": {
    "openIdIssuer": "https://login.microsoftonline.com/{TENANT-ID}/v2.0",
    "clientIdSettingName": "AZURE_CLIENT_ID",
    "clientSecretSettingName": "OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID"
  }
  ...
}
```

And the app service needs to have its appSetting *MICROSOFT_PROVIDER_AUTHENTICATION_SECRET* removed in favour of the newer *OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID*.
```bicep
...
  appSettings: {
    AZURE_CLIENT_ID: easyAuthAppRegClientId
    // MICROSOFT_PROVIDER_AUTHENTICATION_SECRET: 'avoid-clear-text-secret-4TR8Q...' // REMOVE ME
    OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID: uami.outputs.clientId
  }
...
```

With both the updated bicep code and site content deployed, the site should still function the same and I can finally remove the client secret from the app registration!

# Logs
Having a look at the sign-in logs for enterprise application show the sign-in *Client credential type* change from **Client secret** to **Federated identity credential**.

{{< imagecaption source="/images/app-reg-mi-fed-auth/app-signinlogs-secret.png" alt="federated credentials created" title="federated credentials created" >}}

{{< imagecaption source="/images/app-reg-mi-fed-auth/app-signinlogs-fed.png" alt="federated credentials created" title="federated credentials created" >}}


# Closing words
According to the [app-service documentation](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad#use-a-managed-identity-instead-of-a-secret-preview) this is in preview for azure app service, but managed identities as federated credentials for Entra apps is already in [GA](https://devblogs.microsoft.com/identity/access-cloud-resources-across-tenants-without-secrets-ga/)! More [documentation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-config-app-trust-managed-identity).