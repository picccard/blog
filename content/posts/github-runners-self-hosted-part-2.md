---
title: "Build self-hosted runners in Azure - Part 2"
date: 2024-08-05T09:43:22+02:00
#lastmod: 2024-08-07T09:43:22+02:00
description: "Auto-scaling Azure Container Apps for self-hosted runners in GitHub"
tags: ["github", "azure", "container", "docker", "bicep", "powershell"]
type: post
image: "/images/github-runner-part2/github-runner-part2.png"
# weight: 3
showTableOfContents: true
---

![Title image](/images/github-runner-part2/github-runner-part2.png "Title image")

This is part 2 about building container images for self-hosted runners in GitHub and deploying to Azure Container Apps. If you haven't checked out [part 1](https://blog.eula.no/posts/github-runners-self-hosted-part-1/), do that first.

This post will be building upon the last setup, focusing on auto-scaling the Azure Container App and virtual network integration for the Azure Container Apps environment.

## Why scale container apps
Having container app replicas ready and warm makes workflow jobs start quickly since there isn't any need for instances to initialize. But this privilege comes with a cost...

It's possible to reduce cost by change the scaling rule setting to reduce the number of available runners during off-hours. But it would be better to scale to zero and only initialize runners when a workflow job requests it.

Utilize [jobs in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/jobs) in combination with KEDA to initialize runners based on events. KEDA has the [Github Runner Scaler](https://keda.sh/docs/2.14/scalers/github-runner/) for scaling based on the number of queued jobs in GitHub Actions.

## Why virtual network integration
Azure Container Apps runs inside of a managed container [environment](https://learn.microsoft.com/en-us/azure/container-apps/environment). The default vnet for this environment is automatically generated and managed by Azure. This means the vnet is inaccessible for the customer, and it won't be able to communicate privately with other customer vnets, such as a hub.

Benefits by utilizing your own virtual network:
- able to peer with other vnets
- create subnets with service endpoints
- control the egress with user defined routes
- have the containers communicate with private endpoints

## Setup
Once a managed container environment is created it is not possible to change the network.

### Build the infrastructure (Bicep)
Use the bicep template from the previous post as a base and make these changes:
- replace the `Azure Container App` with `Azure Container App Job`
- add a vnet with a subnet
  - subnet minimum size `/27` for workload profiles environment and [delegated](#environment-types)
  - subnet minimum size `/23` for consumption only environment and not [delegated](#environment-types)
  - optionally add service endpoints to the subnet
- update the `managed-environment` with the property `infrastructureSubnetId`
  - set the subnet resource ID as the value
- optionally add a storage account with a container for testing purposes

The [bicep template](https://github.com/picccard/self-hosted-runner/blob/main/src/bicep/main.bicep) visualized looks like this:

{{< imagecaption source="/images/github-runner-part2/bicep-visualize-acj-vnet.png" alt="Visualization of bicep template" title="visualization of bicep template" >}}

Here is a more detailed look at how the vnet, container app environment, container app job and storage account are configured in the bicep template:

{{< highlight bicep "lineNos=inline" >}}
targetScope = 'subscription'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {...}
module acaUami 'br/public:avm/res/managed-identity/user-assigned-identity:0.2.2' = {...}
module acr 'br/public:avm/res/container-registry/registry:0.3.1' = {...}
module kv 'br/public:avm/res/key-vault/vault:0.6.2' = {...}
module log 'br/public:avm/res/operational-insights/workspace:0.4.0' = {...}

module vnet 'br/public:avm/res/network/virtual-network:0.1.8' = {
  name: '${uniqueString(deployment().name, parLocation)}-vnet'
  scope: rg
  params: {
    name: parManagedEnvironmentVnetName
    addressPrefixes: ['10.20.0.0/16']
    subnets: [
      {
        name: parManagedEnvironmentInfraSubnetName
        addressPrefix: '10.20.0.0/23'
        delegations: [
          {
            name: 'Microsoft.App.environments'
            properties: { serviceName: 'Microsoft.App/environments' }
          }
        ]
        serviceEndpoints: [
          { service: 'Microsoft.Storage' }
        ]
      }
    ]
  }
}

module managedEnv 'br/public:avm/res/app/managed-environment:0.5.2' = {
  scope: rg
  name: '${uniqueString(deployment().name, parLocation)}-managed-environment'
  params: {
    name: parManagedEnvironmentName
    logAnalyticsWorkspaceResourceId: log.outputs.resourceId
    infrastructureResourceGroupName: parManagedEnvironmentInfraResourceGroupName
    infrastructureSubnetId: first(vnet.outputs.subnetResourceIds)
    internal: true
    zoneRedundant: false
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

module acj 'br/public:avm/res/app/job:0.3.0' = {
  scope: rg
  name: '${uniqueString(deployment().name, parLocation)}-acj'
  params: {
    name: parAcjName
    environmentResourceId: managedEnv.outputs.resourceId
    containers: [
      ...
    ]
    secrets: [
      ...
    ]
    registries: [
      ...
    ]
    triggerType: 'Event'
    eventTriggerConfig: {
      scale: {
        rules: [
          {
            name: 'github-runner-scaling-rule'
            type: 'github-runner'
            auth: [
              {
                triggerParameter: 'personalAccessToken'
                secretRef: varSecretNameGitHubAccessToken
              }
            ]
            metadata: {
              githubApiURL: 'https://api.github.com'
              runnerScope: 'repo'
              owner: parGitHubRepoOwner
              repos: parGitHubRepoName
              labels: 'self-hosted'
            }
          }
        ]
      }
    }
    managedIdentities: {
      userAssignedResourceIds: [acaUami.outputs.resourceId]
    }
  }
}

module storageForTesting 'br/public:avm/res/storage/storage-account:0.9.1' =  if (parTestVnetServiceEndpoint != null) {
  scope: rg
  name: '${uniqueString(deployment().name, parLocation)}-storage-account'
  params: {
    name: parTestVnetServiceEndpoint.?storageAccountName!
    skuName: 'Standard_LRS'
    blobServices: {
      containers: [
        { name: parTestVnetServiceEndpoint.?containerName }
      ]
    }
    roleAssignments: [
      {
        principalId: acaUami.outputs.principalId
        roleDefinitionIdOrName: 'Storage Blob Data Owner'
      }
    ]
    networkAcls: {
      defaultAction: 'Deny'
      virtualNetworkRules: [
        {
          action: 'Allow'
          id: first(vnet.outputs.subnetResourceIds)
        }
      ]
    }
  }
}
{{< /highlight >}}

Deploy the bicep template to a subscription with azure-cli or pwsh in your own terminal or create a workflow to handle it.
```powershell
$deploySplat = @{
    Name                           = "self-hosted-runners-acj-{0}" -f (Get-Date).ToString("yyyyMMdd-HH-mm-ss")
    Location                       = $azRegion
    TemplateFile                   = 'src/bicep/main.bicep'
    TemplateParameterFile          = 'main.bicepparam'
    Verbose                        = $true
}
Select-AzSubscription -Subscription $azSubscriptionName
New-AzSubscriptionDeployment @deploySplat
```

## Results

### Test vnet access
Create a workflow to test the vnet access from inside the runner. Here is a workflow that will attempt to upload a file to a storage account. The storage account is configured to allow traffic only from the container app environment infrastructure subnet. The subnet is configured with a service endpoint for Azure Storage.

{{< highlight yaml "lineNos=inline" >}}
name: Put file in private storage
on:
  workflow_dispatch:
env:
  PRIVATE_STORAGE_ACCOUNT_NAME: ${{ vars.PRIVATE_STORAGE_ACCOUNT_NAME }}
  PRIVATE_STORAGE_ACCOUNT_CONTAINER_NAME: ${{ vars.PRIVATE_STORAGE_ACCOUNT_CONTAINER_NAME }}

jobs:
  put-file-in-private-storage:
    runs-on: [self-hosted]
    steps:
      - name: Install pwsh modules
        shell: pwsh
        run: |
          Install-Module -Name Az.Accounts -RequiredVersion 3.0.2 -Repository PSGallery -Force
          Install-Module -Name Az.Storage -RequiredVersion 6.1.3 -Repository PSGallery -Force
      - name: Azure Login
        shell: pwsh
        run: |
          Connect-AzAccount -Identity -AccountId $env:MSI_CLIENT_ID
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

After the workflow finished successfully and adding my public IP to the storage account firewall, it's possible to see the new file:

{{< imagecaption source="/images/github-runner-part2/file-uploaded.png" alt="File upload success" title="upload successful" >}}

Running a few more workflows and returning to the Azure Portal shows the execution history:
{{< imagecaption source="/images/github-runner-part2/acj-execution-history.png" alt="Container App Job - Execution history" title="Container App Job - Execution history" >}}



## Gotchas

Most of the gotchas I encountered had to do with the managed-environment types and how they differ from each other, mostly around the [networking](https://learn.microsoft.com/en-us/azure/container-apps/networking).

### Environment types
[Azure Container Apps environments](https://learn.microsoft.com/en-us/azure/container-apps/environment) comes in two different types:
- Consumption only
- Workload profiles

Some of the noteworthy feature differences:

| Feature                                                             | Consumption only | Workload profiles |
| :---                                                                |      :----:      |        ---:       |
| supports user defined routes                                        |        ❌       |         ✅        |
| requires [subnet](https://learn.microsoft.com/en-us/azure/container-apps/networking#subnet) to be delegated to `Microsoft.App/environments` |        ❌       |         ✅        |
| allows customization of the [infrastructureResourceGroupName](https://learn.microsoft.com/en-us/azure/container-apps/networking#managed-resources) |        ❌       |         ✅        |


To build a managed-environment using the [AVM module](https://github.com/Azure/bicep-registry-modules/tree/avm/res/app/managed-environment/0.5.2/avm/res/app/managed-environment):

- Consumption only &rarr; set `workloadProfiles` as an empty array
- Workload profile &rarr; set `workloadProfiles` as an array of [profile type](https://learn.microsoft.com/en-us/azure/container-apps/workload-profiles-overview#profile-types) objects

{{< highlight yaml "lineNos=inline, hl_Lines=5-10" >}}
module managedEnv 'br/public:avm/res/app/managed-environment:0.5.2' = {
  ...
  params: {
    ...
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}
{{< /highlight >}}


Here comes a series of images showcasing some of the differences with vnet integration in the two different environments:
- container environments
- delegation error
- subnet
- resource group with managed infrastructure
- vnet connected devices

#### Consumption only environment

{{< imagecaption source="/images/github-runner-part2/env-details-2.png" alt="consumption only environment" title="consumption only environment" >}}

{{< imagecaption source="/images/github-runner-part2/error-subnet-is-delegated.png" alt="consumption only environment, fails when subnet is delegated" title="consumption only environment, fails when subnet is delegated" >}}

{{< imagecaption source="/images/github-runner-part2/subnet-overview-2.png" alt="consumption only environment, infrastructure subnet" title="consumption only environment, infrastructure subnet not delegated" >}}

{{< imagecaption source="/images/github-runner-part2/rg-managed-infrastructure-2.png" alt="consumption only environment, managed infrastructure resource group" title="consumption only environment, default resource group name" >}}

{{< imagecaption source="/images/github-runner-part2/vnet-connected-devices-1.png" alt="consumption only environment, vnet" title="consumption only environment, vnet connected devices" >}}

#### Workload profiles environment
{{< imagecaption source="/images/github-runner-part2/env-details-1.png" alt="workload profiles environment" title="workload profiles environment" >}}

{{< imagecaption source="/images/github-runner-part2/error-subnet-must-be-delegated.png" alt="workload profiles environment, fails when subnet isn't delegated" title="workload profiles environment, fails when subnet isn't delegated" >}}

{{< imagecaption source="/images/github-runner-part2/subnet-overview-1.png" alt="workload profiles environment, infrastructure subnet" title="workload profiles environment, infrastructure subnet delegated" >}}

{{< imagecaption source="/images/github-runner-part2/rg-managed-infrastructure-1.png" alt="workload profiles environment, managed infrastructure resource group" title="workload profiles environment, customized resource group name" >}}

{{< imagecaption source="/images/github-runner-part2/vnet-connected-devices-1.png" alt="workload profiles environment, vnet" title="workload profiles environment, vnet connected devices" >}}



