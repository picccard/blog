---
title: "AVD HostPool and listRegistrationTokens"
date: 2024-08-12T10:41:12+02:00
#lastmod: 2024-08-07T09:43:22+02:00
description: "Getting registration tokens from a host pool the secure way"
tags: ["azure", "avd", "bicep"]
type: post
image: "/images/hostpool-list-registration-tokens/property-token-cant-be-evaluated.png"
# weight: 4
showTableOfContents: true
---

## The old ways

Up until now I've been using one of these to fetch a registration token:
```bicep
output token1 object = reference(hostPool.id, '2023-09-05').registrationInfo.token
output token2 string = reference(hostPool.id).registrationInfo.token
```
The bicep compiles to this json:
```json
"[reference(resourceId('Microsoft.DesktopVirtualization/hostPools', parameters('hostpoolName')), '2023-09-05').registrationInfo.token]"
"[reference(resourceId('Microsoft.DesktopVirtualization/hostPools', parameters('hostpoolName'))).registrationInfo.token)]"
```

## Recently errors
Recently these deployments has began to fail in some envornments, with these errors:
1. > ...The language expression property 'token' can't be evaluated.
2. > ...Expected a value of type 'String, Uri' but received a value of type 'Null'.

{{< imagecaption source="/images/hostpool-list-registration-tokens/dsc-token-cant-be-evaluated.png" alt="azure deployment property error" title="DSC extension AddSessionHost - expression property 'token' can't be evaluated" >}}

{{< imagecaption source="/images/hostpool-list-registration-tokens/property-token-cant-be-evaluated.png" alt="azure deployment property error" title="expression property 'token' can't be evaluated" >}}

{{< imagecaption source="/images/hostpool-list-registration-tokens/got-null.png" alt="azure deployment type error" title="received a value of type 'null'" >}}

## Introducing function listRegistrationTokens

In GitHub issue [Azure/bicep-types-az/issues/2023](https://github.com/Azure/bicep-types-az/issues/2023#issuecomment-2278685926) Microsoft FTE @shenglol shows the new resource function `listRegistrationTokens()`. _The function is as of 2024.08.12 not yet documented in the [bicep documentation](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-functions-resource#implementations) or outside of the API spec, to the best of my knowledge..._

The function returns a list of objects with a token and the expirationTime:
```json
[
  {
    "expirationTime": "2024-08-13T00:00:00Z",
    "token": "eyJh[REDACTED].eyJS[REDACTED].Kii[REDACTED]"
  }
]
```

Here is some usage with it:
```bicep
output tokenList array = hostPool.listRegistrationTokens()
output tokenObj object = hostPool.listRegistrationTokens()[0]
output token string = first(hostPool.listRegistrationTokens()).token
```

## Linter support
Usage of any `list*` function allows the linter to know this is a secret, and give recommendations based on that. In [the old ways](#the-old-ways), the api-versions had the `token` property not marked as a secret, thus allowing it to be fetched though GET requests.

{{< imagecaption source="/images/hostpool-list-registration-tokens/linter-possible-secret.png" alt="vscode linter shows warning" title="linter - possible secret" >}}
