---
title: "Speeding up workflows with ModuleFast"
date: 2024-07-12T08:22:47+02:00
#lastmod: 2024-08-07T08:22:47+02:00
description: "Comparing ModuleFast to psmodulecache and the cmdlet Install-PSResource"
tags: ["github", "powershell"]
type: post
image: "/images/github-runner-part2/github-runner-part2.png"
# weight: 4
showTableOfContents: true
---

Most of the management I do in Azure is automated with powershell and put into a GitHub Actions workflow or an automation runbook. Most of them use the same modules; Az.Accounts, Az.Resources, Microsoft.Graph.Authentication, etc.

Previously I've used the action [psmodulecache](https://github.com/potatoqualitee/psmodulecache). This has the benefit of generating a cache at the end of the workflow run, if no cache already exists. This way, any consecutive runs will use the cache instead of re-downloading the modules. This made a great speed increase when I introduced it. \
_GitHub has a dedicated doc about [caching workflow dependencies](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows)._

Lately I've been made aware of JustinGrote's [ModuleFast repository](https://github.com/JustinGrote/ModuleFast) and it's [GitHub Action](https://github.com/JustinGrote/ModuleFast-action). So I decided to pit them against each other.

During Justin Grote's session at PSConfEU 2024 he mentions ModuleFast:
{{< youtube id=ciijhGkFBaY start=5310 >}}

At PSConfEU 2023 he had a session where he goes in-depth about ModuleFast:
{{< youtube CQ9b0jzdFyU >}}

## Workflows for testing

Methods to download modules from PSGallery:
- Install-Module-cmdlet
- psmodulecache
- ModuleFast
- Install-PSResource-cmdlet

I created a workflow for each of the methods and ran the workflows 5 times. Then I changed the list of modules to download and it two more times.

### Install-Module cmdlet

```yaml
name: Install-Module-cmdlet
run-name: ${{ github.workflow }} [${{ github.ref_name }}]
on:
  workflow_dispatch:
jobs:
  install-and-list-modules:
    runs-on: ubuntu-22.04
    steps:
      - name: Install Modules
        shell: pwsh
        run: |
          Install-Module -Name Az       -RequiredVersion 12.1.0 -Repository PSGallery -Force
          Install-Module -Name dbatools -RequiredVersion 2.1.14 -Repository PSGallery -Force
      - name: List Available Modules
        shell: pwsh
        run: |
          Get-Module -ListAvailable | Select-Object Version, Name | Sort-Object Name
```

### psmodulecache

```yaml
name: psmodulecache
...
    steps:
      - name: Install and cache PowerShell modules
        uses: potatoqualitee/psmodulecache@v6.2
        with:
          modules-to-cache: Az:12.1.0, dbatools:2.1.14
...
```

### ModuleFast
```yaml
name: ModuleFast
...
    steps:
      - name: ⚡ ModuleFast with Specification
        uses: JustinGrote/ModuleFast-action@v0.0.1
        with:
          specification: |
            Az=12.1.0
            dbatools=2.1.14
...
```

### Install-PSResource cmdlet

```yaml
name: Install-PSResource-cmdlet
...
    steps:
      - name: Install Modules
        shell: pwsh
        run: |
          Install-PSResource -TrustRepository -RequiredResource @{
            'Az'       = @{ version = '12.1.0' ; repository = 'PSGallery' }
            'dbatools' = @{ version = '2.1.14' ; repository = 'PSGallery' }
          }
...
```

## Caches and log

If a cache isn't found during a run, it will be generated as a post step:
{{< imagecaption source="/images/modulefast/cache-not-found.png" alt="cache generated as post step" title="cache generated as post step" >}}

If a cache is found it will be restored and the post step will log the cache hit.
{{< imagecaption source="/images/modulefast/cache-hit.png" alt="cache hit" title="cache hit logged as post step" >}}

After a workflow has generated a cache then details can be found in the Caches section of GitHub Actions.
{{< imagecaption source="/images/modulefast/caches.png" alt="GitHub caches" title="caches from all workflows" >}}

## Speed results

Modules installed on test system:
* PackageManagement (v1.4.8.1)
* PowerShellGet (v2.2.5)
* Microsoft.PowerShell.PSResourceGet (v1.0.4.1)

Run 1-5 was with `Az=12.1.0` and `dbatools=2.1.14`. \
Run 6-7 was with `Az=12.1.0` and `dbatools=2.1.14` and `Microsoft.Graph=2.0.0`.

|    Run    | Install-Module | psmodulecache | ModuleFast | Install-PSResource |
| :-------- | :------------: | :-----------: | :--------: | :----------------: |
|  _#1_*    |  48s           |  _74s_*       | _30s_*     |  29s               |
|   #2      |  79s           |  54s          |  19s       |  30s               |
|   #3      |  82s           |  40s          |  25s       |  28s               |
|   #4      |  49s           |  61s          |  32s       |  42s               |
|   #5      |  46s           |  36s          |  10s       |  29s               |
|  _#6_*    |  53s           | _104s_*       | _31s_*     |  83s               |
|   #7      |  88s           |  53s          |  17s       |  80s               |
| **Avg**   | **63.57s** (100%) | **60.28s** (94.8%) | **23.43s** (36.9%) | **45.86s** (72.14%) |

Run 1* and 6* with psmodulecache and ModuleFast is marked to signal the first run with a given set of modules, thus requiring downloading the modules and saving the cache. \
That means the cache hit ratio was 71.43% (5/7).

## Conclusion

The time reduction from `Install-Module` to ModuleFast is **63.14%** in this test! The sample size should have been bigger, but I'll definitively change some of my CI to use ModuleFast. \
However, the module is currently v0.3.0 and the action is v0.0.1, so it's not quite production ready...