# Extendable Param Files

Requires bicep release  [v0.29.45](https://github.com/Azure/bicep/releases/tag/v0.29.45)
`bicep --version`

```pwsh
PS /Users/eskillarsen/git-github-azuredevops/arm-api-runbook> bicep --version   
Bicep CLI version 0.29.47 (132ade51bc)


bicep build-params --file ./dev.main.bicepparam --outfile ./dev.main.json

```



```pwsh

PS > bicep build-params $splat.TemplateParameterFile.Replace('.json', '.bicepparam') --outfile $splat.TemplateParameterFile

/Users/eskillarsen/git-github-azuredevops/arm-api-runbook/src/bicep/dev.storage.bicepparam(1,7) : Error BCP258: The following parameters are declared in the Bicep file but are missing an assignment in the params file: "parLocation", "parResourceGroupName", "parStorageAccountBlobContainerName", "parStorageAccountName".
/Users/eskillarsen/git-github-azuredevops/arm-api-runbook/src/bicep/dev.storage.bicepparam(3,1) : Error BCP337: This declaration type is not valid for a Bicep Parameters file. Specify a "using", "param" or "var" declaration.

PS > bicep --version                                                                                                     
Bicep CLI version 0.28.1 (ba1e9f8c1e)

```