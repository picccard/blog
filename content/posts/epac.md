---
title: "Manage Azure policies at scale with EPAC"
date: 2025-07-18T09:12:22+02:00
# lastmod: 2025-07-18T15:39:33+02:00
description: "How pwsh and EPAC manages policy as code"
tags: ["azure", "policy", "powershell"]
type: post
image: "/images/epac/pwsh-heart-azure-policy.png"
# weight: 7
showTableOfContents: true
---

![Title image](/images/epac/pwsh-heart-azure-policy.png "Title image")


As the number of policy resources grows, [EPAC](https://azure.github.io/enterprise-azure-policy-as-code) is designed to be an toolkit to handle policy resources at scale, with Infrastructure as Code (IaC) in mind.

## What is EPAC
Enterprise Azure Policy as Code (EPAC) is a **declarative** and **idempotent** desired state deployment technology for Azure Policy. It handles the creation, updating and deletion of policy resources.

EPAC comes as a collection of PowerShell scripts to manage Policies, PolicySets, Policy Assignments, Policy Exemptions and Role Assignments. There are also scripts for operational purposes such as remediation tasks and documentation of policy resources.

To fully automate the management  of policy resources with EPAC, it is recommended  to implementing EPAC in a CI/CD system such as GitHub Actions or Azure Pipelines.

EPAC has three major steps in the deployment process, each has it's own cmdlet in the module.
- Build-DeploymentPlans - *Analyze policy resource files and calculate desired state delta*
- Deploy-PolicyPlan - *Deploy policy resources at their desired scope based on the plan*
- Deploy-RolesPlan - *Deploy role assignments for Managed Identities, required for `DeployIfNotExists` and `Modify` Policies*

## Install EPAC
EPAC comes as a powershell module published on the [PsGallery](https://www.powershellgallery.com/packages/EnterprisePolicyAsCode), you can see the full project on their [github repository](https://github.com/Azure/enterprise-azure-policy-as-code).
```text
Find-PSResource -Name EnterprisePolicyAsCode

Name                    Version  Repository  Description
----                    ------   ----------  ----------
EnterprisePolicyAsCode  10.10.0  PSGallery   Enterprise Policy as Code PowerShell Module

Install-PSResource -Name EnterprisePolicyAsCode -Repository PSGallery -TrustRepository
Import-Module EnterprisePolicyAsCode
```

## Prepare ALZ hierarchy
EPAC supports using a [canary environment](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/enterprise-scale/testing-approach#example-scenarios-and-outcomes) for testing purposes. This environment will just be a duplication of the prod [ALZ management group hierarchy](https://learn.microsoft.com/en-us/azure/governance/management-groups/overview#hierarchy-of-management-groups-and-subscriptions). 
In this section I will create both environments with bicep and powershell. Continuing I will only work in the prod environment, the canary environment will be left available for future use.

{{< imagecaption source="https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/enterprise-scale/media/canary-mgmt-groups.png#lightbox" alt="Hierarchy of management groups" title="Hierarchy of management groups" >}}

```pwsh
New-Item -Path 'C:/temp/ALZ-Bicep/modules/mgmt-groups/' -ItemType Directory -Force
$splat = @{
  Uri     = 'https://raw.githubusercontent.com/Azure/ALZ-Bicep/refs/heads/main/infra-as-code/bicep/modules/managementGroups/managementGroupsScopeEscape.bicep'
  OutFile = 'C:/temp/ALZ-Bicep/modules/mgmt-groups/main.bicep'
}
Invoke-WebRequest @splat
New-Item 'C:/temp/ALZ-Bicep/CRML/customerUsageAttribution/cuaIdManagementGroup.bicep' -Value "targetScope = 'managementGroup'" -Force

$splat = @{
  Name         = 'create-alz-mgmt-groups'
  Location     = 'swedencentral'
  TemplateFile = 'C:/temp/ALZ-Bicep/modules/mgmt-groups/main.bicep'
}
New-AzManagementGroupDeployment @splat -ManagementGroupId 'epac' -parTopLevelManagementGroupPrefix 'epac' -parTopLevelManagementGroupDisplayName 'epac'
New-AzManagementGroupDeployment @splat -ManagementGroupId 'epac-dev' -parTopLevelManagementGroupPrefix 'epac-dev' -parTopLevelManagementGroupDisplayName 'epac-dev'
```

## Simulate brownfield deployment
To simulate an existing environment I will deploy some policy assignments and exemptions.

```powershell
$splat = @{
  Name             = 'snet-should-have-nsg'
  DisplayName      = 'Subnets should be associated with a Network Security Group'
  PolicyDefinition = '/providers/Microsoft.Authorization/policyDefinitions/e71308d3-144b-4262-b144-efdc3cc90517'
  Scope            = '/providers/Microsoft.Management/managementGroups/epac'
}
$assignment1 = New-AzPolicyAssignment @splat

$splat = @{
  Name             = 'acr-repo-token-disabled'
  DisplayName      = 'Container registries should have repository scoped access token disabled.'
  PolicyDefinition = '/providers/Microsoft.Authorization/policyDefinitions/ff05e24e-195c-447e-b322-5e90c9f9f366'
  Scope            = '/providers/Microsoft.Management/managementGroups/epac-landingzones-corp'
}
$assignment2 = New-AzPolicyAssignment @splat

$splat = @{
  Name              = 'allow-snet-no-nsg-sbox'
  DisplayName       = 'allow-snet-no-nsg-sbox'
  Scope             = '/providers/Microsoft.Management/managementGroups/epac-sandbox'
  PolicyAssignment  = $assignment1
  ExemptionCategory = 'Waiver'
}
$exemption1 = New-AzPolicyExemption @splat
$splat = @{
  Name              = 'allow-snet-no-nsg-lz-o'
  DisplayName       = 'allow-snet-no-nsg-lz-o'
  Scope             = '/providers/Microsoft.Management/managementGroups/epac-landingzones-online'
  PolicyAssignment  = $assignment1
  ExemptionCategory = 'Waiver'
}
$exemption2 = New-AzPolicyExemption @splat
```

## Define epac environments
The first steps working with EPAC is to create its folder structure and build a [global-settings-file](https://azure.github.io/enterprise-azure-policy-as-code/settings-global-setting-file/). See the documentation for all options, here I will keep the config minimal.

```powershell
New-Item -Path 'C:/temp/epac-demo/' -ItemType Directory -Force
cd 'C:/temp/epac-demo/'
git init

New-HydrationDefinitionsFolder -DefinitionsRootFolder .\Definitions-demo
$epacGuid = (New-Guid).Guid
$epacGlobalSettingsContent = @'
{
    "$schema": "https://raw.githubusercontent.com/Azure/enterprise-azure-policy-as-code/main/Schemas/global-settings-schema.json",
    "telemetryOptOut": false,
    "pacOwnerId": "{REPLACE_GUID}",
    "pacEnvironments": [
        {
            "pacSelector": "epac",
            "cloud": "AzureCloud",
            "tenantId": "{REPLACE_TENANTID}",
            "deploymentRootScope": "/providers/Microsoft.Management/managementGroups/epac",
            "managedIdentityLocation": "swedencentral",
            "desiredState": {
                "strategy": "{REPLACE_STRATEGY}", // full | ownedOnly
                "keepDfcSecurityAssignments": false
            }
        }
    ]
}
'@
Set-Content -Path ".\Definitions-demo\global-settings.jsonc" -Value (
  $epacGlobalSettingsContent.
    Replace("{REPLACE_STRATEGY}", "ownedOnly").
    Replace("{REPLACE_GUID}", $epacGuid).
    Replace("{REPLACE_TENANTID}", (Get-AzContext).Tenant.Id)
)
```

### EPAC folder structure
The folder structure will now look like this.
```text
C:\TEMP\EPAC-DEMO
└───Definitions-demo
    │   global-settings.jsonc
    ├───policyAssignments
    ├───policyDefinitions
    ├───policyDocumentations
    ├───policySetDefinitions
    └───policyStructures
```

Building a deployment plan at this point will not result in any changes, since desiredState.strategy is ownedOnly in the global-settings file.

```powershell
Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output
```

{{< imagecaption source="/images/epac/build-owned-only.png" alt="no changes" title="no changes" >}}

## Explore desiredState strategy
To simulate an existing environment I deployed some policy resource, where is these? For EPAC to manage these resources desiredState.strategy in the global-settings file will have to be changed to full.

```powershell
Set-Content -Path ".\Definitions-demo\global-settings.jsonc" -Value (
  $epacGlobalSettingsContent.
    Replace("{REPLACE_STRATEGY}", "full").
    Replace("{REPLACE_GUID}", $epacGuid).
    Replace("{REPLACE_TENANTID}", (Get-AzContext).Tenant.Id)
)
git add '.\Definitions-demo\global-settings.jsonc'
git commit -m 'added global-settings file for epac'

Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output
Rename-Item -Path .\Output\plans-epac\policy-plan.json -NewName policy-plan-full.json
```

Building a deployment plan now results in the file `.\Output\plans-epac\policy-plan.json` beeing created and the terminal output also says it will delete 2 policy assignments. But there is no mention of the policy exemptions yet..?

{{< imagecaption source="/images/epac/build-full-init.png" alt="build plan expects to delete existing assignments" title="build plan expects to delete existing assignments" >}}

{{< imagecaption source="/images/epac/plan-full-firsttime.png" alt="policy plan with desiredState.strategy 'full'" title="policy plan with desiredState.strategy 'full'" >}}

## Exemptions
EPAC only manages items with a directory in the Definitions folder. This allows for different policy resources to be managed in separate repositories. The [documentation](https://azure.github.io/enterprise-azure-policy-as-code/settings-desired-state/#using-separate-repos) offers several example use cases.

I am missing a directory for `policyExemptions` in my [current folder structure](#epac-folder-structure). Since I will manage all policy resources in one centralized repo, I have to create the directory. I also create a sub-folder for each of my environments.

```powershell
$splat = @{ ItemType = 'Directory' ; Force = $true }
New-Item @splat -Path .\Definitions-demo\policyExemptions\
New-Item @splat -Path .\Definitions-demo\policyExemptions\epac\
New-Item @splat -Path .\Definitions-demo\policyExemptions\epac-dev\
```

Doing another build deployment plan now should show deletion of both assignments and exemptions.

```powershell
Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output # see expected deletions including exemptions
Rename-Item -Path .\Output\plans-epac\policy-plan.json -NewName policy-plan-full-exemptions.json
```

{{< imagecaption source="/images/epac/policy-plan-full-exemptions.png" alt="policy plan" title="policy plan" >}}

## Export existing policy resources
EPAC includes support for [extracting existing policy resources](https://azure.github.io/enterprise-azure-policy-as-code/start-extracting-policy-resources/).

```powershell
$splat = @{
  DefinitionsRootFolder = '.\Definitions-demo\'
  OutputFolder = '.\PolicyExport'
  InputPacSelector = 'epac'
  ExemptionFiles = 'json'
}
Export-AzPolicyResources @splat
```

The exported files should be examined and moved to their designated folder. I will create a dedicated folder for policy assignments created by my organization. This way it is possible to separate policy assignments created by us and those created by ALZ. I also create a sub-folder for each of my environments.

*The policyExemptions has a metadata property, this will be removed. The metadata.deployedBy property is managed my EPAC internally.*

```powershell
$splat = @{ ItemType = 'Directory' ; Force = $true }
New-Item @splat -Path .\Definitions-demo\policyAssignments\CONTOSO\
New-Item @splat -Path .\Definitions-demo\policyAssignments\CONTOSO\epac\
New-Item @splat -Path .\Definitions-demo\policyAssignments\CONTOSO\epac-dev\

Move-Item -Path .\PolicyExport\export\Definitions\policyAssignments\* -Destination .\Definitions-demo\policyAssignments\CONTOSO\epac\
git add ".\Definitions-demo\policyAssignments\CONTOSO\"
git commit -m 'added existing policyAssignments'

Move-Item -Path .\PolicyExport\export\Definitions\policyExemptions\epac\* -Destination .\Definitions-demo\policyExemptions\epac\
git add ".\Definitions-demo\policyExemptions\"
# open exemptions and remove 'deployedBy' from metadata object
$jsonData = Get-Content -Path .\Definitions-demo\policyExemptions\epac\active-exemptions.jsonc | ConvertFrom-Json
$jsonData.exemptions = $jsonData.exemptions | ForEach-Object {$_.psobject.Properties.Remove('metadata') ; return $_ }
$jsonData | ConvertTo-Json -Depth 100 | Out-File '.\Definitions-demo\policyExemptions\epac\active-exemptions.jsonc'
# now compare, stage newest changes, commit
git add .\Definitions-demo\policyExemptions\epac\active-exemptions.jsonc
git commit -m 'added existing policyExemptions'

Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output
```

Now the build deployment plan no longer expects to delete anything! The updating of the metadata properties is EPAC taking ownership of the policy resources.

{{< imagecaption source="/images/epac/build-full-after-export.png" alt="policy plan after exporting existing policy resources" title="policy plan after exporting existing policy resources" >}}

Time to deploy the policy-plan and then build a new plan to verify no more changes is expected.

```powershell
$splat = @{
  DefinitionsRootFolder = '.\Definitions-demo'
  PacEnvironmentSelector = 'epac'
  InputFolder = '.\Output'
}
Deploy-PolicyPlan @splat
Rename-Item -Path .\Output\plans-epac\policy-plan.json -NewName policy-plan-after-export.json

Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output
```

## Integrate EPAC with ALZ policies
Assets such a policies for ALZ is stored in the GitHub repository [Azure/Azure-Landing-Zones-Library](https://github.com/Azure/Azure-Landing-Zones-Library). This repo has release tags for both alz and amba (Azure Monitor Baseline Alerts). EPAC has [documented support](https://azure.github.io/enterprise-azure-policy-as-code/integrating-with-alz-library/) for syncing policies from the ALZ-library.

The process for integrating EPAC with ALZ polices consists of generating a "policy-default-structure"-file and syncing the policies based on the information in this file. The file includes management group IDs, enforcement mode and some parameter values.

```powershell
# https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/alz/2024.11.0
# https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/alz/2024.11.1
# https://github.com/Azure/Azure-Landing-Zones-Library/tree/platform/alz/2025.02.0

# Start with old ALZ-policy release
New-ALZPolicyDefaultStructure -DefinitionsRootFolder .\Definitions-demo -Type ALZ -Tag "platform/alz/2024.11.0" -PacEnvironmentSelector "epac"

# have a look at the file in the policyStructure-folder and fix it up
(Get-Content -Path 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc').
  Replace('/providers/Microsoft.Management/managementGroups/alzroot','/providers/Microsoft.Management/managementGroups/epac').
  Replace('/providers/Microsoft.Management/managementGroups/platform','/providers/Microsoft.Management/managementGroups/epac-platform').
  Replace('/providers/Microsoft.Management/managementGroups/landingzones','/providers/Microsoft.Management/managementGroups/epac-landingzones').
  Replace('/providers/Microsoft.Management/managementGroups/corp','/providers/Microsoft.Management/managementGroups/epac-landingzones').
  Replace('/providers/Microsoft.Management/managementGroups/online','/providers/Microsoft.Management/managementGroups/epac-landingzones').
  Replace('/providers/Microsoft.Management/managementGroups/sandboxes','/providers/Microsoft.Management/managementGroups/epac-sandbox').
  Replace('/providers/Microsoft.Management/managementGroups/management','/providers/Microsoft.Management/managementGroups/epac-platform-management'). 
  Replace('/providers/Microsoft.Management/managementGroups/connectivity','/providers/Microsoft.Management/managementGroups/epac-platform-connectivity'). 
  Replace('/providers/Microsoft.Management/managementGroups/identity','/providers/Microsoft.Management/managementGroups/epac-platform-identity'). 
  Replace('/providers/Microsoft.Management/managementGroups/decommissioned','/providers/Microsoft.Management/managementGroups/epac-decommissioned'). 
  Replace('"value": null','"value": "REPLACE_ME_LATER"') |
  Set-Content -Path 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc'

git add 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc'
git commit -m 'added alz.policy_default_structure for alz-v2024.11.0'
```

When the file is updated with the desired values you can sync the ALZ policy resources.

```powershell
Sync-ALZPolicyFromLibrary -DefinitionsRootFolder .\Definitions-demo -Type ALZ -Tag "platform/alz/2024.11.0" -PacEnvironmentSelector "epac"

# expore the filestructure and assignments
git add '.\Definitions-demo\policyDefinitions\'
git add '.\Definitions-demo\policySetDefinitions\'
git commit -m 'update policy definitions from alz-v2024.11.0'
```

The directory structure should now look something like this.

```text
C:\TEMP\EPAC-DEMO
└───Definitions-demo
    ├───policyAssignments
    │   ├───ALZ
    │   │   └───epac
    │   │       ├───Azure Landing Zones
    │   │       ├───Connectivity
    │   │       ├───Corp
    │   │       ├───Decommissioned
    │   │       ├───Identity
    │   │       ├───Landing zones
    │   │       ├───Platform
    │   │       └───Sandbox
    │   └───CONTOSO
    │       ├───epac
    │       └───epac-dev
    ├───policyDefinitions
    │   └───ALZ
    │       ├───API Management
    │       ├───Security Center
    │       ├─── ...
    │       ├───Storage
    │       └───Tags
    ├───policyDocumentations
    ├───policyExemptions
    │   ├───epac
    │   └───epac-dev
    ├───policySetDefinitions
    │   └───ALZ
    │       ├───API Management
    │       ├───Backup
    │       ├─── ...
    │       ├───Compute
    │       └───Trusted Launch
    └───policyStructures
```

## Change enforcementMode
To see the effect of changing a value in the policy-structure-file I will change the enforcementMode and do another sync. Inspecting the generated assignment files now will display the diff.

```powershell
# stage the changes to see impact from next step
git add '.\Definitions-demo\policyAssignments\ALZ\epac\'

(Get-Content -Path 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc').
  Replace('"enforcementMode": "Default"', '"enforcementMode": "DoNotEnforce"') |
  Set-Content -Path 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc'

Sync-ALZPolicyFromLibrary -DefinitionsRootFolder .\Definitions-demo -Type ALZ -Tag "platform/alz/2024.11.0" -PacEnvironmentSelector "epac"

# see one of the changes
code '.\Definitions-demo\policyAssignments\ALZ\epac\Landing zones\Deploy-VM-Backup.jsonc'

# remove the staged files
git restore --staged '.\Definitions-demo\policyAssignments\ALZ\epac\'

git add 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc'
git commit -m 'set enforcementMode to DoNotEnforce in alz.policy_default_structure'
```

{{< imagecaption source="/images/epac/change-enforcement-mode.png" alt="example policyAssignment after enforcement mode is changed" title="example policyAssignment after enforcement mode is changed" >}}

## Deploy ALZ policies
All policy assignments should be examined and chosen whether to keep or not. Here I will only keep the assignments in the sandboxes and landing zones directories, the rest will not be deployed.

Now just build a deployment plan and deploy it.

```powershell
Get-ChildItem -Path .\Definitions-demo\policyAssignments\ALZ\epac\ -File -Recurse | 
  Where-Object {$_.Directory.ToString().split('\')[-1] -notin @('sandboxes','landing zones') } |
  Rename-Item -NewName { "$_.disabled" }

git add '.\Definitions-demo\policyAssignments\ALZ\epac\'
git commit -m 'update policy policyAssignments from alz-v2024.11.0'

Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output
```

{{< imagecaption source="/images/epac/build-alz-v2024-11-0.png" alt="plan ALZ release v2024.11.0" title="plan ALZ release v2024.11.0" >}}

```powershell
$splat = @{
  DefinitionsRootFolder = '.\Definitions-demo'
  PacEnvironmentSelector = 'epac'
  InputFolder = '.\Output'
}
Deploy-PolicyPlan @splat
# Deploy-RolesPlan @splat # skip this for demos, required for Deploy-If-Not-Exist (DINE) assignments
```

The deployment will fail as this ALZ release included a faulty policy... Just remove the faulty policy and deploy again.

{{< imagecaption source="/images/epac/policyset-fail-cmk.png" alt="failed policySet" title="failed policySet" >}}

```powershell
# deploy fails on first run, delte failty policy and build new plan
Remove-Item -Path .\Definitions-demo\policySetDefinitions\ALZ\Encryption\Enforce-Encryption-CMK.json
git add '.\Definitions-demo\policySetDefinitions\ALZ\Encryption\Enforce-Encryption-CMK.json'
git commit -m 'removed fault policySet'

Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output
Deploy-PolicyPlan @splat

Rename-Item -Path .\Output\plans-epac\policy-plan.json -NewName policy-plan-alz.v2024.11.0.json
```

{{< imagecaption source="/images/epac/deploy-alz-v2024-11-0.png" alt="deploy ALZ release v2024.11.0" title="deploy ALZ release v2024.11.0" >}}

The deployment will output each deployed resource. The above deployment created 29 policySets and 26 policyAssignments.

Building another deployment plan at this point will show no changes to the environment.

```powershell
Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output
```

{{< imagecaption source="/images/epac/build-full-after-v2024-11-0.png" alt="no more changes" title="no more changes" >}}

## Upgrade ALZ policies
The ALZ team regularly updates the ALZ policy definitions and assignments, not on a quarterly basis. To get a grasp of what's changed have a look at their [Whats new page](https://aka.ms/alz/whatsnew). And to assist in making sure you have the latest policy assignments, check out [AzGovViz](https://techcommunity.microsoft.com/blog/azuregovernanceandmanagementblog/keep-your-azure-landing-zones-policy-assignments-up-to-date-with-azure-governanc/4292789) and it's **ALZ Policy assignments checker**.

During the upgrade we have to fetch the latest policy-default-structure file and do a new sync from the ALZ-library.

```powershell
Rename-Item -Path ".\Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc" -NewName alz.policy_default_structure.epac.v2024.11.0.jsonc
New-ALZPolicyDefaultStructure -DefinitionsRootFolder .\Definitions-demo -Type ALZ -Tag "platform/alz/2025.02.0" -PacEnvironmentSelector "epac"

# have a look at the file in the policyStructure-folder and update it with correct values
(Get-Content -Path 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc').
  Replace('/providers/Microsoft.Management/managementGroups/alz','/providers/Microsoft.Management/managementGroups/epac').
  Replace('/providers/Microsoft.Management/managementGroups/platform','/providers/Microsoft.Management/managementGroups/epac-platform').
  Replace('/providers/Microsoft.Management/managementGroups/landingzones','/providers/Microsoft.Management/managementGroups/epac-landingzones').
  Replace('/providers/Microsoft.Management/managementGroups/corp','/providers/Microsoft.Management/managementGroups/epac-landingzones').
  Replace('/providers/Microsoft.Management/managementGroups/online','/providers/Microsoft.Management/managementGroups/epac-landingzones').
  Replace('/providers/Microsoft.Management/managementGroups/sandbox','/providers/Microsoft.Management/managementGroups/epac-sandbox').
  Replace('/providers/Microsoft.Management/managementGroups/management','/providers/Microsoft.Management/managementGroups/epac-platform-management'). 
  Replace('/providers/Microsoft.Management/managementGroups/connectivity','/providers/Microsoft.Management/managementGroups/epac-platform-connectivity'). 
  Replace('/providers/Microsoft.Management/managementGroups/identity','/providers/Microsoft.Management/managementGroups/epac-platform-identity'). 
  Replace('/providers/Microsoft.Management/managementGroups/decommissioned','/providers/Microsoft.Management/managementGroups/epac-decommissioned'). 
  Replace('"value": null','"value": "REPLACE_ME"').
  Replace('"enforcementMode": "Default"', '"enforcementMode": "DoNotEnforce"') |
  Set-Content -Path 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc'
```

{{< imagecaption source="/images/epac/diff-managementgroupnamemappings.png" alt="diff-managementgroupnamemappings" title="diff-managementgroupnamemappings" >}}

From the diff above you can see an example of whats changed in the newer release.

Before I sync the latest ALZ policies I remove the existing onces. This way I can see from the git diff what assignments are changed and what has been removed. This review process should be done manually to see I the ALZ policies is in line with your specs or not. Sometimes you might already have a customer specific policyAssignment doing the same as a new ALZ policy, keep your policy repo tidy!

For this release:
- the policyAssignments scoped to the intermediate root management group, is place in a dedicated folder
- the directory `Sandboxes` is renamed to `Sandbox`
- `Enforce-TLS-SSL-H224` is replaced by `Enforce-TLS-SSL-Q225`

I only keep the assignments located in the sandbox and landing zones directories.

```powershell
git add 'Definitions-demo\policyStructures\alz.policy_default_structure.epac.jsonc'
git commit -m 'added alz.policy_default_structure for alz-v2025.02.0'

# remove existing policyAssignments, see git diff after sync
Remove-Item -Path .\Definitions-demo\policyAssignments\ALZ\epac\ -Recurse

Sync-ALZPolicyFromLibrary -DefinitionsRootFolder .\Definitions-demo -Type ALZ -Tag "platform/alz/2025.02.0" -PacEnvironmentSelector "epac"

git add '.\Definitions-demo\policyDefinitions\'
git add '.\Definitions-demo\policySetDefinitions\'
git commit -m 'update policy definitions from v2025.02.0'

# policy assignments scoped to intRoot is moved to a dedicated folder in the newer release
Get-ChildItem -Path '.\Definitions-demo\policyAssignments\ALZ\epac\Azure Landing Zones\' |
  Rename-Item -NewName { "$_.disabled" }

# stage new (intRoot)
git add '.\Definitions-demo\policyAssignments\ALZ\epac\Azure Landing Zones\'

# stage old (intRoot)
Get-ChildItem -Path '.\Definitions-demo\policyAssignments\ALZ\epac\Azure Landing Zones\' | 
  ForEach-Object { git add ".\Definitions-demo\policyAssignments\ALZ\epac\$($_.Name)" }

git commit -m 'added latest policy assignments for intRoot scope'

# only keep some of the assignments
Get-ChildItem -Path '.\Definitions-demo\policyAssignments\ALZ\epac\*.jsonc' -File -Recurse | 
  Where-Object {$_.Directory.ToString().split('\')[-1] -notin @('sandbox','sandboxes','landing zones','azure landing zones') } |
  Move-Item -Destination { "$($_.FullName).disabled" } -Force

code .
```

{{< imagecaption source="/images/epac/upgrade-changes.png" alt="upgrade-changes" title="upgrade-changes" >}}

```powershell
git add .\Definitions-demo\policyAssignments\ALZ\epac\Connectivity
git commit -m 'added latest policy assignments for connectivity scope'

git add .\Definitions-demo\policyAssignments\ALZ\epac\Corp
git commit -m 'added latest policy assignments for corp scope'

git add .\Definitions-demo\policyAssignments\ALZ\epac\Identity
git commit -m 'added latest policy assignments for identity scope'

git add '.\Definitions-demo\policyAssignments\ALZ\epac\Landing zones'
git commit -m 'added latest policy assignments for landing zones scope'

git add .\Definitions-demo\policyAssignments\ALZ\epac\Platform
git commit -m 'added latest policy assignments for platform scope'

git add .\Definitions-demo\policyAssignments\ALZ\epac\Sandboxes
git add .\Definitions-demo\policyAssignments\ALZ\epac\Sandbox
git commit -m 'added latest policy assignments for sandbox scope'
```

Now with everything reviewed and committed, build a deployment plan and deploy it.

```powershell
Build-DeploymentPlans -DefinitionsRootFolder .\Definitions-demo -PacEnvironmentSelector epac -OutputFolder Output
```

{{< imagecaption source="/images/epac/upgrade-plan-changes.png" alt="upgrade-plan-changes" title="upgrade-plan-changes" >}}

```powershell
$splat = @{
  DefinitionsRootFolder = '.\Definitions-demo'
  PacEnvironmentSelector = 'epac'
  InputFolder = '.\Output'
}
Deploy-PolicyPlan @splat
# Deploy-RolesPlan @splat # skip this for demos, required for Deploy-If-Not-Exist (DINE) assignments
```

Even the faulty policySet `Enforce-Encryption-CMK` has returned, this time without errors.

{{< imagecaption source="/images/epac/policyset-fail-cmk-updated.png" alt="policyset-fail-cmk-updated" title="policyset-fail-cmk-updated" >}}

## Gotchas
### Tag parameter always latest
Doing the "upgrade" demo I discovered both `New-ALZPolicyDefaultStructure` & `Sync-ALZPolicyFromLibrary` did not properly handle the tag parameter, this bug should be fixed by pull request [Azure/enterprise-azure-policy-as-code#996](https://github.com/Azure/enterprise-azure-policy-as-code/pull/996).

## Closing words
This was meant as a getting started post for EPAC, there is plenty more to explore such as policy documentations, syncing AMBA policies and deploying everything from a CI/CD pipeline to both prod and the canary environments.
