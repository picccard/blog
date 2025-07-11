---
title: "GitHub-hosted runners with Azure private networking"
date: 2024-08-21T09:12:22+02:00
lastmod: 2025-07-11T15:39:33+02:00
description: "GitHub-hosted runners with access to private Azure virtual networks"
tags: ["github", "azure", "networking", "bicep", "powershell"]
type: post
image: "/images/github-hosted-runners-azure-vnet/github-hosted-runner-vnet.png"
# weight: 5
showTableOfContents: true
---

After my previous fiddling with Azure Container Apps I decided to seeked out how to achive access a private azure network from a GitHub-hosted runner.

## How it works
When a workflow is triggered, GitHub creates a runner service and deploys a network interface card (NIC) in the customers private azure network. Once the nic is created an attached, the job is picked up by the runner and started. The runner logs are sent back to GitHub Actions while the runner has access to any resource in the vNet.
{{< imagecaption source="https://docs.github.com/assets/cb-289537/mw-1440/images/help/actions/actions-vnet-injected-larger-runners-architecture.webp" alt="Service network communication overview" title="network communication overview" >}}

## Who can use this feature
Azure private networking for GitHub-hosted runners requires an organization with the GitHub Team plan. Creation of GitHub-hosted runners is not allowed on trail plans however, so here I'm upgrading for a month.

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runners-new-not-available-on-trail.png" alt="New GitHub-hosted runner not allowed on trail plans" title="creation of GitHub-hosted runner not allowed on trail plans" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/gh-billing-plan-free.png" alt="GitHub current plan" title="current GitHub plan" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/gh-billing-upgrading-complete.png" alt="Upgraded organization" title="upgraded to Team plan" >}}

## Preparation
Before GitHub can be configured access into your vNet there is some prereqs:
1. The resource provider `GutHub.Network` must be registered on the subscription with the vNet.
2. Find the database id for your GitHub organization.

### Resource Provider

```powershell
Set-AzContext -Subscription 'landing-zone-demo-001'
Register-AzResourceProvider -ProviderNamespace 'GitHub.Network'
```

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/resource-provider-reg.png" alt="Register resource provider" title="register resource provider" >}}

### Find GitHub organization databaseId
To find the databaseId you need a token with minimum `read:org` permissions.
{{< imagecaption source="/images/github-hosted-runners-azure-vnet/gh-pat-create.png" alt="New GitHub PAT" title="PAT to fetch GitHub organization databaseId" >}}

Once the PAT is ready, use it to query for your databaseId.
```powershell
$OrganizationName = 'eskill...'
$BearerToken = '<REDACTED>'

$splat = @{
    Uri = 'https://api.github.com/graphql'
    Method = 'POST'
    Authentication = 'OAuth'
    Token = ConvertTo-SecureString -AsPlainText -Force -String $BearerToken
    Body = @{
        "query" = 'query($login: String!) { organization (login: $login) { login databaseId } }'
        "variables" = @{ "login" = $OrganizationName }
    } | ConvertTo-Json
}

(Invoke-RestMethod @splat).data.organization

    login       databaseId
    -----       ----------
    eskill...   123456789
```

## Deploy Azure resources
Now is the time to deploy the azure resources needed. The [full example on GitHub](https://github.com/picccard/github-azure-private-vnet/blob/main/src/bicep/main.bicep) deploys all additional resources such as the vNet, subnet, storage account and uami. The following code is a minimal example for the `githubNetworkSettings` and `nsg`.

```bicep
param parLocation string
param parNetworkSettingsName string
param parSubnetId string
param parGitHubDatabaseId string
param nsgName string = 'actions_NSG'

resource githubNetworkSettings 'GitHub.Network/networkSettings@2024-04-02' = {
  name: parNetworkSettingsName
  location: parLocation
  properties: {
    subnetId: parSubnetId
    businessId: parGitHubDatabaseId
  }
}

resource actions_NSG 'Microsoft.Network/networkSecurityGroups@2017-06-01' = {
  name: nsgName
  location: location
  properties: {
    securityRules: [
      {
        name: 'AllowVnetOutBoundOverwrite'
        properties: {
          protocol: 'TCP'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          access: 'Allow'
          priority: 200
          direction: 'Outbound'
          destinationAddressPrefixes: []
        }
      }
      {
        name: 'AllowOutBoundActions'
        properties: {
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          access: 'Allow'
          priority: 210
          direction: 'Outbound'
          destinationAddressPrefixes: [
            '4.175.114.51/32'
            ...
            '20.84.218.150/32'
          ]
        }
      }
      {
        name: 'AllowOutBoundGitHub'
        properties: {
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          access: 'Allow'
          priority: 220
          direction: 'Outbound'
          destinationAddressPrefixes: [
            '140.82.112.0/20'
            ...
            '4.208.26.200/32'
          ]
        }
      }
      {
        name: 'AllowStorageOutbound'
        properties: {
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: 'Storage'
          access: 'Allow'
          priority: 230
          direction: 'Outbound'
          destinationAddressPrefixes: []
        }
      }
      {
        name: 'DenyInternetOutBoundOverwrite'
        properties: {
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: 'Internet'
          access: 'Deny'
          priority: 1000
          direction: 'Outbound'
        }
      }
    ]
  }
}
```

Deploy the bicep template to a subscription, here using powershell.
```powershell
$splat = @{
    Name                  = -join ('github-nics-{0}' -f (Get-Date -Format 'yyyyMMddTHHMMssffffZ'))[0..63]
    Location              = 'norwayeast'
    TemplateFile          = 'src/bicep/main.bicep'
    TemplateParameterFile = 'main.bicepparam'
    Verbose               = $true
}
Select-AzSubscription -Subscription 'landing-zone-demo-001'
New-AzSubscriptionDeployment @splat
```

In the azure portal you can check the box for `Show hidden types` to reveal the networksettings. The resource will have your GitHub databaseId as a property and tag.

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/az-portal-showhidden.png" alt="Resource group overview show hidden types" title="github networksettings resourece when show hidden types is checked" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/az-portal-github-networksettings.png" alt="GitHub networksettings resource overview" title="github networksettings resource overview" >}}

## Create network configuration
Back to GitHub, Azure private networking for GitHub-hosted runners is configurable at the organization level for organization owners. Create a new network configuration and inside it add an Azure Virtual Network. This prompts for details about the azure resource.

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/hosted-compute-net-org-enabled.png" alt="New network configuration" title="new network configuration" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/org-add-vnet-settings-details.png" alt="New network configuration details" title="new network configuration - details" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/org-add-vnet-settings.png" alt="New network configuration overview" title="new network configuration - overview" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/hosted-compute-net-org-created.png" alt="New network configuration completed" title="new network configuration - completed" >}}

## Create runner group
Create a runner group for the new runner, assign the network configuration to the group.

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runner-group-new-details.png" alt="Create runner group" title="create runner group" >}}

## Create GitHub-hosted runner
Create a new GitHub-hosted runner and place it in the newly created runner group, as this group is assigned the network configuration.

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runners-new-hosted-runnner.png" alt="New GitHub-hosted runner" title="new GitHub-hosted runner" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runners-new-hosted-runnner-details.png" alt="New GitHub-hosted runner - details" title="new GitHub-hosted runner - details" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runners-new-hosted-runnner-created.png" alt="New GitHub-hosted runner created" title="new GitHub-hosted runner created" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runners-new-hosted-runnner-created-details.png" alt="GitHub-hosted runner details" title="GitHub-hosted runner - details" >}}

## Workflow in progress
Now with the setup complete, create a GitHub Action workflow upload a file to a private storage account and trigger it manually. Full example [here](https://github.com/picccard/github-azure-private-vnet/blob/main/.github/workflows/put-file-to-private-storage.yaml). The important part is to set `runs-on:` to be the runner group!

In GitHub you can get an overview of the runner an its jobs, and in the Azure portal you can see new NICs showing up in the resource group.

{{< highlight yaml "lineNos=inline, hl_Lines=7 23" >}}
env:
  PRIVATE_STORAGE_ACCOUNT_NAME: ${{ vars.PRIVATE_STORAGE_ACCOUNT_NAME }}
  PRIVATE_STORAGE_ACCOUNT_CONTAINER_NAME: ${{ vars.PRIVATE_STORAGE_ACCOUNT_CONTAINER_NAME }}

jobs:
  put-file-in-private-storage:
    runs-on: [az-vnet-enabled]

    steps:
      - name: Install pwsh modules
        shell: pwsh
        run: 'Install-Module -Name Az.Storage -RequiredVersion 6.1.3 -Force'

      - name: Azure Login
        uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }} 
          enable-AzPSSession: true
  
      - name: Put blob in container
        shell: pwsh
        run: |
          $fileName = "testdata-{0}.log" -f (Get-Date).ToString("yyyyMMdd-HH-mm-ss")
          Set-Content -Path $fileName -Value "example content"
          $stContext = New-AzStorageContext -StorageAccountName $env:PRIVATE_STORAGE_ACCOUNT_NAME
          $splat = @{
              File = $fileName
              Container = $env:PRIVATE_STORAGE_ACCOUNT_CONTAINER_NAME
              Context = $stContext
          }
          Set-AzStorageBlobContent @splat
{{< /highlight >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runners-new-hosted-runner-details-active-jobs.png" alt="Runner with active jobs" title="active jobs on runner" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/az-portal-gh-nic.png" alt="Resource group overview" title="network interfaces created by GitHub" >}}

## Results
Once the storage account is configured to allow traffic from the runner-subnet, the workflow successfully creates a blob!

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/storageaccount-file-proof.png" alt="File uploaded to storageaccount" title="file uploaded" >}}

## Logs
On the logs for the resource group with the runner vNet, there will be events initiated by `GitHub Actions API` & `GitHub CPS Network Service`.

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/az-portal-log-gh-nic-deleted.png" alt="Resource group activity log" title="Resource group - Activity log" >}}

## Gotchas
### Disabled by enterprise administrators
In my enterprice the Hosted compute networking was disabled and I was unable to create new network configuration.

This was solved by heading into the policies for the enterprice and enabling creation of network configurations under the section `Hosted compute networking`.

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/hosted-compute-net-org-disabled.png" alt="Network configurations is disabled by enterprice" title="hosted compute networking is disabled" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/hosted-compute-net-ent-setting.png" alt="Setting to manage creation of network configurations for organizations" title="allow organizations to create network configurations" >}}

### Spending limits
My spending limit was set to $0 and this caused the GitHub-hosted runner to never start.

This was solved by upping the spending limit in settings on the organization level.

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runners-new-hosted-runnner-created-spending-limit.png" alt="Runner shutdown due to spending limit caps" title="spending limit caps prevents runner from starting" >}}

{{< imagecaption source="/images/github-hosted-runners-azure-vnet/runners-new-hosted-runnner-created-spending-limit-updated.png" alt="Updated spending limit" title="updated spending limit" >}}

## Closing words
All files for this post can be found in this [repository](https://github.com/picccard/github-azure-private-vnet).

I original did this post in august 2024, but I never got around to publishing it so here it comes in july 2025 instead.