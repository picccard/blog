---
title: "Make your own PSGallery"
date: 2025-07-25T04:19:19+02:00
# lastmod: 2025-07-25T04:19:19+02:00
description: "Publish powershell modules to Azure Container Registry"
tags: ["azure", "container", "docker", "powershell"]
type: post
image: "/images/acr-psgallery/pwsh-heart-acr.png"
# weight: 7
showTableOfContents: true
---

![Title image](/images/acr-psgallery/pwsh-heart-acr.png "Title image")

The PowerShell Gallery is full of useful modules shared by community members, but the nature of this community content makes the gallery inherently untrusted. In this post I will have a look at how you can improve your Supply Chain Security and availability by utilizing Microsoft Artifact Registry and building your own private PSGallery.

# $PSGallery = -not $secure
Aqua published an article outlining some of the issues with the gallery and compared it to other package managers, you can read it [in their blog](https://www.aquasec.com/blog/powerhell-active-flaws-in-powershell-gallery-expose-users-to-attacks/). Among these issues is the risk of typosquatting in the module names, similar to GitHub Actions name. See orca security's blog about [typosquatting in GitHub Actions](https://orca.security/resources/blog/typosquatting-in-github-actions/).

Even the default psresource repository in pwsh is marked untrusted by default.

```text
Get-PSResourceRepository

Name      Uri                                      Trusted Priority IsAllowedByPolicy
----      ---                                      ------- -------- -----------------
PSGallery https://www.powershellgallery.com/api/v2 False   50       True
```

# Availability of PSGallery vs ACR
The PSGallery is not backed by any SLA and is known to experience [issues](https://aka.ms/psgallery-status).

By building our own PSGallery in an Azure Container Registry it garantees at least **99.9%** availability.

# Official Microsoft modules
Microsoft Artifact Registry (MAR) is the new name of the former Microsoft Container Registry (mcr.microsoft.com). It has been the place where Microsoft publishes their official container images for some time now. The name change emphasizes that it now hosts more than just container images, now [PSResources](https://mcr.microsoft.com/en-us/catalog?search=PSResource) is available there!

{{< imagecaption source="/images/acr-psgallery/mar-psresource.png" alt="PSResource search in Microsoft Artifact Registry" title="PSResource search in Microsoft Artifact Registry" >}}

To install modules from MAR you first register the repo and then use the `-Repository` parameter with the `*-PSResource` cmdlets.

```powershell
Register-PSResourceRepository -Name 'mar' -Uri 'https://mcr.microsoft.com' -Trusted:$true
Find-PSResource -Repository 'mar' -Name 'az.ssh'
```
```text
Name   Version Prerelease Repository Description
----   ------- ---------- ---------- -----------
Az.Ssh 0.2.3              mar        Microsoft Azure PowerShell - cmdlets for connecting to Azure VMs usi…
```
```powershell
Install-PSResource -Name 'Az.Ssh' -Repository 'mar'
Get-Module -ListAvailable -Name 'Az.Ssh'
```
```text
    Directory: C:\Users\eskil\Documents\PowerShell\Modules

ModuleType Version     Name        PSEdition ExportedCommands
---------- -------     ----        --------- ----------------
Script     0.2.3       Az.Ssh      Core,Desk {Enter-AzVM, Export-AzSshConfig}
```

# Private Azure Container Registry
The MAR is a great source for official Microsoft modules, but for non-microsoft modules we still have to rely on the PS Gallery. With [PSResourceGet](https://devblogs.microsoft.com/powershell/psresourceget-is-generally-available/) we have the option to host our desired modules in our own Azure Container Registry!

Once we have the ACR populated with modules we can use [group policy](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.psresourceget/about/about_psresourceget_group_policy?view=powershellget-3.x) to only allow our private ACR and block the PS Gallery.

## Deploy
The bicep code required to deploy an ACR is minimal.

```bicep {linenos=inline}
module acr 'br/public:avm/res/container-registry/registry:0.9.1' = {
  scope: resourceGroup('rg-pwshacr')
  params: {
    name: 'eulapwsh'
    acrSku: 'Basic'
    acrAdminUserEnabled: true
    // cacheRules: []
  }
}
```

## Register
When the ACR is created, it has to be registered as a repository on the machine that will use it. Registering the repository does not require any credentials. However, the first time you perform an operation on the registered repository, you are prompted to login, if you are not authenticated yet.

```powershell
$splat = @{
    Name        = 'eulapwsh'
    Uri         = 'eulapwsh.azurecr.io'
    Priority    = 40
    Trusted     = $true
}
Register-PSResourceRepository @splat

Get-PSResourceRepository
```
```text
Name      Uri                                      Trusted Priority IsAllowedByPolicy
----      ---                                      ------- -------- -----------------
eulapwsh  https://eulapwsh.azurecr.io/             True    40       True
PSGallery https://www.powershellgallery.com/api/v2 False   50       True
```

## Publish
With the repository available I download a module from the PS Gallery and publish it to the ACR.

```powershell
$splat = @{
    Name               = 'EnterprisePolicyAsCode'
    Repository         = 'PSGallery'
    Version            = '10.10.0'
    TrustRepository    = $true
}
Install-PSResource @splat

Connect-AzAccount

$mod = Get-Module -ListAvailable 'EnterprisePolicyAsCode'
Publish-PSResource -Repository 'eulapwsh' -Path $mod.ModuleBase
```

{{< imagecaption source="/images/acr-psgallery/publish-module-epac.png" alt="Module available in ACR" title="Module available in ACR" >}}

{{< imagecaption source="/images/acr-psgallery/publish-module-epac-tag.png" alt="available tags" title="available tags" >}}

{{< imagecaption source="/images/acr-psgallery/publish-module-epac-manifest.png" alt="artifact manifest" title="artifact manifest" >}}


## Copy to ACR
Modules stored in other OCI artifact registries can easily be copied into the private ACR.

With pwsh.
```powershell
$splat = @{
    RegistryName         = 'eulapwsh'
    ResourceGroupName    = 'rg-pwshacr'
    SourceRegistryUri    = 'mcr.microsoft.com'
    SourceImage          = 'psresource/az.nginx:1.2.0'
    TargetTag            = 'az.nginx:1.2.0'
}
Connect-AzContainerRegistry -Name 'eulapwsh'
Import-AzContainerRegistryImage @splat
```

With azure cli.
```bash
az login
az acr login -n eulapwsh
az acr import `
    --name eulapwsh `
    --source mcr.microsoft.com/psresource/az.ssh:0.2.3 `
    --image az.ssh:0.2.3
```

With [ORAS](https://oras.land/docs/). See [FeynmanZhou blog post](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/enriching-container-supply-chains-with-oras/3996629) and the Microsoft doc to [Manage OCI Artifacts with ORAS](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-manage-artifact).

```console
az login
az acr login -n eulapwsh
oras copy mcr.microsoft.com/psresource/az.dns:1.3.0 eulapwsh.azurecr.io/az.dns:1.3.0
```

{{< imagecaption source="/images/acr-psgallery/oras-copy-success.png" alt="oras copy operation" title="oras copy operation" >}}

## Find and install modules
With the ACR populated and registered, it is just like any other psresource repository.

```text
Find-PSResource -Repository eulapwsh -Name *

Name                   Version Prerelease Repository Description
----                   ------- ---------- ---------- -----------
EnterprisePolicyAsCode 10.10.0            eulapwsh   Enterprise Policy as Code PowerShell Module
Profiler               4.3.0              eulapwsh   Script, ScriptBlock and module performance profiler for PowerShel…
PSDocs                 0.9.0              eulapwsh   Generate markdown from PowerShell.…
PSDocs.Azure           0.3.0              eulapwsh   Generate markdown from Azure infrastructure as code (IaC) artifac…
Az.Dns                 1.3.1              eulapwsh   Microsoft Azure PowerShell - DNS service cmdlets for Azure Resourc…
Az.Nginx               1.2.0              eulapwsh   Microsoft Azure PowerShell: Nginx cmdlets
Az.Ssh                 0.2.3              eulapwsh   Microsoft Azure PowerShell - cmdlets for connecting to Azure VMs usi…
```
```powershell
$splat = @{
    Name               = 'EnterprisePolicyAsCode'
    Repository         = 'eulapwsh'
    Version            = '10.10.0'
    TrustRepository    = $true
}
Install-PSResource @splat
```

# ACR Cache rules
ACR has a feature called [artifact cache](https://learn.microsoft.com/en-us/azure/container-registry/artifact-cache-overview), this lets you cache artifacts from both public and private repositories. I have updated the bicep template with a cache rule from MAR.

```bicep
module acr 'br/public:avm/res/container-registry/registry:0.9.1' = {
...
    cacheRules: [
      {
        name: 'az-compute'
        sourceRepository: 'mcr.microsoft.com/psresource/az.compute'
        targetRepository: 'az.compute'
      }
    ]
...
```

In the azure portal now there will be a repository named `az.compute` associated with the cache rule, but the repo will not have any content yet...

{{< imagecaption source="/images/acr-psgallery/cache-rule.png" alt="oras copy operation" title="oras copy operation" >}}

According to the [limitations in the docs](https://learn.microsoft.com/en-us/azure/container-registry/artifact-cache-overview#current-limitations):

> Cache only occurs after at least one image pull is complete on the available container image. For every new image available, a new image pull must be complete. Currently, artifact cache doesn't automatically pull new tags of images when a new tag is available.

To populate the cache, I do a `oras pull` for each module version I need. This is the only way I have found to populate anything to the target repository of the cache rule, as it seems it is protected from any push operation.

{{< imagecaption source="/images/acr-psgallery/oras-copy-fail.png" alt="oras copy operation" title="oras copy operation" >}}

{{< imagecaption source="/images/acr-psgallery/oras-pull.png" alt="oras pull operation" title="oras pull operation" >}}

# Gotchas
## Dependency checks
When publishing a module, there is some prechecks like checking that all dependencies are present in the target repository. Either bypass this with the `-SkipDependenciesCheck` parameter or publish the dependencies first.

```powershell
$mod = Get-Module -ListAvailable 'PSDocs.Azure'
Publish-PSResource -Repository 'eulapwsh' -Path $mod.ModuleBase
```
```text
Publish-PSResource: Dependency 'PSDocs' was not found in repository 'eulapwsh'.  Make sure the dependency is published to the repository before publish this module.
```

Verify dependencies...
```powershell
(Get-Module -ListAvailable 'PSDocs.Azure').RequiredModules

ModuleType Version    PreRelease Name          ExportedCommands
---------- -------    ---------- ----          ----------------
Script     0.8.0                 PSDocs
```

...and publish again.
```powershell
# publish with dependencies
$dependency = Get-Module -ListAvailable 'PSDocs'
Publish-PSResource -Repository 'eulapwsh' -Path $dependency.ModuleBase
Publish-PSResource -Repository 'eulapwsh' -Path $mod.ModuleBase
# or ignore dependencies
Publish-PSResource -Repository 'eulapwsh' -Path $mod.ModuleBase -SkipDependenciesCheck
```

# Closing words
I really like being able to have my own PS Gallery with an SLA, as the public gallery is down sometimes.

I hope the acr team adds some automation for pulling the initial content from a cache rule and a way to handle new versions published in the upstream. For cleanup of old module versions I would like to see some kind of time-to-live for the cache, or delete tags not pulled in the last *x* days.

I will also revisit this to see if I can make a declerative way to express what modules and what versions should be stored in the ACR. ACR content as Code. With cleanup of old or unwanted module versions.

Big thanks to Anam Navied, Sydney Smith and Michael Green for their talks at this years PowerShell Conference EU and PowerShell Summit! Watch their presentations on youtube:
{{< youtube id=9EIuXAOGaSA >}}

{{< youtube id=i3zZnMGU-LQ >}}
