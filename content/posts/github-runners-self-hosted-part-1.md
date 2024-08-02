---
title: "Build self-hosted runners in Azure - Part 1"
date: 2024-08-01T15:56:27+02:00
#lastmod: 2024-08-06T15:56:27+02:00
description: Using Azure Container Apps for self-hosted runners in GitHub"
tags: ["github", "azure", "container", "docker", "bicep", "powershell"]
type: post
image: "/images/github-runner-part1/github-runner-part1.png"
weight: 15
showTableOfContents: true
---

![Title image](/images/github-runner-part1/github-runner-part1.png "Title image")

## Why self-hosted runners
GitHub-hosted runners are great! They come in a variety OS and release versions, and with a bunch of preinstalled software.
However self-hosted runners allows for more flexibility when you require something different, such as:
- beefier hardware
- longer workflow runs
- other OS
- private vnet access

While GitHub-hosted runners are hosted on [virtual machines](https://github.com/actions/runner-images#about), self-hosted runners can run from both on-prem and in a cloud, inside of a virtual machine or in a container. Heck, you can run it on your physical machine if you want to!

So in this post I'll go over how to create a container image for a self-hosted runner, how to run it in Azure and some gotchas I encountered.

## Setup

### Find the software
Heading over to the settings of a GitHub repo or org shows the instructions for downloading, configuring and starting the runner software.

{{< imagecaption source="/images/github-runner-part1/add-new-self-hosted-runner.png" alt="Add new self-hosted runner" title="instructions for self-hosted runners" >}}

### Create a container image
Since the GitHub-hosted runners are tailored to the public, alot of software is included, thus making the VM image quite large. When configuring self-hosted runners, it is recommended to tailor the runner to your known needs and not include things that might be "nice-to-have". Keep the image size small and create multiple images runners for different use cases.

Create a Dockerfile with your preferred base image, download, configure and run the runner software. Or use [GitHub's official runner image](https://github.com/actions/runner/pkgs/container/actions-runner) which comes bundled with it.

I have examples with both ubuntu22-04 and the official image in this GitHub [repository](https://github.com/picccard/self-hosted-runner). The [bash script](https://github.com/picccard/self-hosted-runner/blob/main/src/images/start.sh) for the `ENTRYPOINT` will fetch a registration token from the GitHub API, configure and start the runner.


{{< details title="Dockerfile using actions-runner as base image (CLICK TO EXPAND)" >}}
```dockerfile
ARG RUNNER_VERSION=2.317.0
FROM ghcr.io/actions/actions-runner:${RUNNER_VERSION}

USER root

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    jq && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY start.sh start.sh

RUN chmod +x start.sh

USER runner

ENTRYPOINT ["./start.sh"]
```
{{< /details >}}


{{< details title="Dockerfile using ubuntu (with pwsh7.4) as base image instead (CLICK TO EXPAND)" >}}
```dockerfile
FROM mcr.microsoft.com/powershell:7.4-ubuntu-22.04

# set versions and prepare urls
ARG RUNNER_VERSION=2.317.0
ARG BICEP_VERSION=0.28.1
ARG RUNNER_PACKAGE_URL=https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
ARG BICEP_PACKAGE_URL=https://github.com/Azure/bicep/releases/download/v${BICEP_VERSION}/bicep-linux-x64

# prevents installdependencies.sh from prompting the user and blocking the image creation
ARG DEBIAN_FRONTEND=noninteractive

LABEL Author="Eskil Uhlving Larsen"
LABEL GitHub="https://github.com/picccard"
LABEL BaseImage="mcr.microsoft.com/powershell:7.4-ubuntu-22.04"
LABEL RunnerVersion=${RUNNER_VERSION}
LABEL BicepVersion=${BICEP_VERSION}

# install curl and jq for fetching registration-token for the runner
# add additional packages as necessary
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    jq \
    unzip \
    git \
    wget && \
    apt-get clean &&  rm -rf /var/lib/apt/lists/*

# install the azure cli
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash && apt-get clean && rm -rf /var/lib/apt/lists/*

# install the az module for powershell
RUN ["pwsh", "-c", "Install-Module -Name Az -RequiredVersion 12.1.0 -Scope AllUsers -Force"]

# install bicep
RUN curl -Lo bicep ${BICEP_PACKAGE_URL} && chmod +x ./bicep && mv ./bicep /usr/local/bin/bicep && az config set bicep.use_binary_from_path=true

# add a user and add to the sudo group
RUN newuser=docker && \
    adduser --disabled-password --gecos "" $newuser && \
    usermod -aG sudo $newuser && \
    echo "$newuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# set the working directory to the user directory
WORKDIR /home/docker/actions-runner

# download and unzip the github actions runner
RUN curl -f -L -o runner.tar.gz ${RUNNER_PACKAGE_URL} && \
    tar xzf ./runner.tar.gz && \
    rm runner.tar.gz && \
    chown -R docker /home/docker

# install runner dependencies
RUN ./bin/installdependencies.sh && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# copy over the start.sh script
COPY start.sh start.sh

# make the script executable
RUN chmod +x start.sh

# since the config and run script for actions are not allowed to be run by root,
# set the user to "docker" so all subsequent commands are run as the docker user
USER docker

# set the entrypoint to the start.sh script
ENTRYPOINT ["./start.sh"]
```
{{< /details >}}

Build the container image and push it to a container registry. When the container image is build and pushed it can be deployed to any service that supports containers. _If no container registry exists yet, return to this after the infrastruction is built._

```bash
az acr build -t "${ImageName}:v0.1.0" -t "${ImageName}:latest" --registry $RegistryName --platform $Platform --build-arg RUNNER_VERSION=$RunnerVersion --file $dockerfileName $DockerfileDir
```

### Generate an access token (PAT)
To register a runner to a repo or org, first generate a GitHub personal access token with the correct permissions. Open account settings or org settings and find developer settings. From there generate a PAT with the minimum permissions required.

- Repository access
  - metadata (Read)
  - administration (Read + Write)

{{< imagecaption source="/images/github-runner-part1/github-pat.png" alt="GitHub PAT" title="GitHub PAT" >}}

Pass the PAT to the bicep template as a secure parameter and store it in a keyvault. 
In `.bicepparam` files use the preffered function `getSecret()` or `readEnvironmentVariable()` if no keyvault exists. See the doc for [bicep functions](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-functions-parameters-file) and [secret management](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/scenarios-secrets) for details.

Bicep file:
```bicep
@description('The GitHub Access Token with permission to fetch registration-token')
@secure()
param parGitHubAccessToken string
```
Bicepparam file:
```bicep
// param parGitHubAccessToken = readEnvironmentVariable('GITHUB_ACCESS_TOKEN')
param parGitHubAccessToken = az.getSecret('<subscription-id>', '<rg-name>', '<key-vault-name>', '<secret-name>')
```


### Build the infrastructure (Bicep)
Following Microsoft’s [decision tree for compute](https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/compute-decision-tree) we could utilize Azure Container Instances.
Using ACI only requires a subnet delegated to the service and then container instances can be initiated. To scale Azure Container Instances, deploy more container instances and delete them to scale down.

Looking back at the decision tree, Azure Container Apps would give us full-fledge orchestration without the hassle of maintaining a Kubernetes cluster. Deploying the runner image with Azure Container Apps allows us to adjust the scale limits for minimum and maximum instances.

Along with the Azure Container App we deploy some other resources such as log-workspace, key vault and the container environment, etc. The [bicep template](https://github.com/picccard/self-hosted-runner/blob/main/src/bicep/main.bicep) visualized looks like this:

{{< imagecaption source="/images/github-runner-part1/bicep-visualize-aca.png" alt="Visualization of bicep template" title="visualization of bicep template" >}}

Here is a more detailed look at how the container app is configured in the bicep template:

{{< highlight bicep "lineNos=inline" >}}
targetScope = 'subscription'

resource rg  'Microsoft.Resources/resourceGroups@2024-03-01' = {...}
module acaUami 'br/public:avm/res/managed-identity/user-assigned-identity:0.2.2' = {...}
module acr 'br/public:avm/res/container-registry/registry:0.3.1' = {...}
module kv 'br/public:avm/res/key-vault/vault:0.6.2' = {...}
module log 'br/public:avm/res/operational-insights/workspace:0.4.0' = {...}
module managedEnv 'br/public:avm/res/app/managed-environment:0.5.2' = {...}

module aca 'br/public:avm/res/app/container-app:0.4.1' = {
  scope: rg
  name: '${uniqueString(deployment().name, parLocation)}-aca'
  params: {
    name: parAcaName
    environmentId: managedEnv.outputs.resourceId
    secrets: {
      secureList: [
        {
          name: varSecretNameGitHubAccessToken
          keyVaultUrl: '${kv.outputs.uri}secrets/${varSecretNameGitHubAccessToken}'
          identity: acaUami.outputs.resourceId
        }
      ]
    }
    registries: [
      {
        server: acr.outputs.loginServer
        identity: acaUami.outputs.resourceId
      }
    ]
    containers: [
      {
        name: 'ghrunner'
        image: 'containerregistryname.azurecr.io/ghrunner-linux:v0.1.0'
        resources: {
          cpu: '0.25'
          memory: '0.5Gi'
        }
          env: [
            { name: 'OWNER', value: parGitHubRepoOwner }
            { name: 'REPO', value: parGitHubRepoName }
            { name: 'ACCESS_TOKEN', secretRef: varSecretNameGitHubAccessToken }
            { name: 'RUNNER_NAME_PREFIX', value: 'self-hosted-runner' }
            { name: 'APPSETTING_WEBSITE_SITE_NAME', value: 'azcli-managed-identity-endpoint-workaround' } // https://github.com/Azure/azure-cli/issues/22677
          ]
      }
    ]
    revisionSuffix: parAcaRevisionSuffix
    scaleMinReplicas: parAcaScaleMinReplicas
    scaleMaxReplicas: parAcaScaleMaxReplicas
    ingressExternal: false
    managedIdentities: {
      userAssignedResourceIds: [acaUami.outputs.resourceId]
    }
  }
}
{{< /highlight >}}

Deploy the bicep template to a subscription. Use azure-cli or pwsh in your own terminal, or create a workflow to handle it.
```powershell
$deploySplat = @{
    Name                           = "self-hosted-runners-{0}" -f (Get-Date).ToString("yyyyMMdd-HH-mm-ss")
    Location                       = $azRegion
    TemplateFile                   = 'src/bicep/main.bicep'
    TemplateParameterFile          = 'main.bicepparam'
    Verbose                        = $true
}
Select-AzSubscription -Subscription $azSubscriptionName
New-AzSubscriptionDeployment @deploySplat
```


## Results
Heading back to the overview on GitHub shows the newly deployed runner in an idle state.

{{< imagecaption source="/images/github-runner-part1/github-runner-idle.png" alt="GitHub Runner Idle" title="GitHub Runner Idle" >}}

### Verify logs
Head over to the Azure Container App in the portal and view the log steam...

{{< imagecaption source="/images/github-runner-part1/aca-log-stream.png" alt="Azure Container App - Log Stream" title="Azure Container App - Log Stream" >}}

...and the full logs.

{{< imagecaption source="/images/github-runner-part1/aca-logs.png" alt="Azure Container App - Logs" title="Azure Container App - Logs" >}}

### Use the runner
Now create a workflow to test the runner. Set `runs-on: [self-hosted]` to target the runner, and a `workflow_dispatch` trigger to start the workflow manually.

{{< highlight yaml "lineNos=inline, hl_Lines=3 6" >}}
name: Runner Test
on:
  workflow_dispatch:
jobs:
  print-runner-data:
    runs-on: [self-hosted]
    steps:
      - run: az --version
      - run: bicep --version
      - run: pwsh --version
      - run: pwsh -Command 'Get-Module -ListAvailable'
      - run: pwsh -Command 'Get-ChildItem env:'
{{< /highlight >}}

{{< imagecaption source="/images/github-runner-part1/github-workflow.png" alt="Workflow run for testing" title="workflow run for testing" >}}

## Gotchas
### Leaked secrets
All environment variables available in the parent process of the runner will also be available inside the runner. This could lead to exposed secrets or other sensitive information. Limit the exposure of environment variables inside the runner with
[unset](https://linuxcommand.org/lc3_man_pages/unseth.html) to prevent leaks.
{{< notice warning >}}
Don't leak you secrets!
{{< /notice >}}
Here is an example where I forgot to specify `unset -n ACCESS_TOKEN` in start.sh.

{{< imagecaption source="/images/github-runner-part1/github-workflow-exposed-token.png" alt="GitHub Workflow - Exposed token" title="token exposed" >}}


### Verbose logs
Using the official GitHub runner image causes the logs to be very verbose, as mentioned in [this GitHub issue](https://github.com/actions/runner/issues/891#issuecomment-1941163269). \
This is because the environment variable `ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT` is set to `1` in their Dockerfile. Override the value for this variable to `0` in the container spec for the container app and the logs will be less verbose.

{{< imagecaption source="/images/github-runner-part1/gh-runner-verbose-logging.png" alt="GitHub Runner verbose logs" title="verbose logs from runner" >}}

### Limitations with Azure Container App 
Azure Container Apps has the following [limitations](https://learn.microsoft.com/en-us/azure/container-apps/containers#limitations):
- **Privileged containers**: Azure Container Apps doesn't allow privileged containers mode with host-level access.
- **Operating system**: Linux-based (`linux/amd64`) container images are required.

In some of my existing workflows I install az cli and bicep with specific version during the job. This ran without problems when the self-hosted runner container ran in docker on my local machine, but failed to elevate privileges when the container was deployed to Azure Container Apps.

Here is a snippet of the workflow file for installing az cli and bicep with specific version, notice the elevated privileges with `sudo`:
{{< highlight yaml "lineNos=inline, hl_Lines=4 11" >}}
- name: Install Az Cli
  shell: pwsh
  run: |
    curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

- name: Install and configure Bicep version ${{ env.version_bicep }}
  shell: pwsh
  run: |
    curl -Lo bicep https://github.com/Azure/bicep/releases/download/${{ env.version_bicep }}/bicep-linux-x64
    chmod +x ./bicep
    sudo mv ./bicep /usr/local/bin/bicep
{{< /highlight >}}

The workflow runs successfully on a runner hosted on Docker from my local machine:

{{< imagecaption source="/images/github-runner-part1/github-workflow-sudo-ok.png" alt="GitHub Workflow - Sudo ok" title="successfull workflow run" >}}

But the same workflow fails on a runner hosted on Azure Container Apps:

{{< imagecaption source="/images/github-runner-part1/github-workflow-sudo-error.png" alt="GitHub Workflow - Sudo ok" title="failed workflow run" >}}


### Managed identity
I have opted for a user-assigned managed identity to eliminate any circular dependencies that occurs with a system-assigned identity:
- Can't create role assignments for `AcrPull` and `Key Vault Secrets User`, requires the container app to exist (to know the object id)
- Can't full deploy the container app, requires role assignments to exist (to pull image from ACR and reference secret from Key Vault)

Solution will be either to:
- use user-assigned managed id, then the identity/object id is known first
- run the deployment twice:
  1. during the initial run the container app should reference no image-rep or secrets. Role assignments will be deployed.
  2. consecutive runs are full deployments, including references to the image-repo and secret


## Closing words
All files for this post can be found in this [repository](https://github.com/picccard/self-hosted-runner).

I know this post only describes the creation of runners for a specific repository, so in the future I would like to re-visit this and have a look at [GitHub Organizations](https://docs.github.com/en/organizations).

The next parts will be about vNet configuration, cost, scale-to-zero and replacing the PAT with a GitHub App.
