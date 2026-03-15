---
title: "Dive"
date: 2025-12-29T12:22:19+01:00
# lastmod: 2025-12-29T12:22:19+01:00
description: "Inspect Container Images With Dive"
tags: ["container", "docker", "podman"]
type: post
image: "https://arctiq.com/hs-fs/hubfs/CHANGE-ME"
# weight: 8
showTableOfContents: true
---

![Title image](https://arctiq.com/hs-fs/hubfs/CHANGEME.png "Title image")


## Inspect container images with dive

Lately I've been building container images for self-hosted runners in GitHub and one of my images got larger than anticipated. I could not see the reason for the size and decided to test out [dive on GitHub](https://github.com/wagoodman/dive).

Dive is *a tool for exploring a docker image, layer contents, and discovering ways to shrink the size of your Docker/OCI image.*


## Launch with podman

```bash
dive safe-settings --source podman
```