# BDPM import fixture: test data

`CIS_bdpm.txt` and `CIS_COMPO_bdpm.txt` are synthetic lines written for the tests of `import-bdpm.ts`. They are not real medicines: every product is named `TEST...`, every CIS code starts with `99` and the holder is "DONNEES DE TEST".

They follow the format of the official BDPM download files: tab-separated columns, Windows-1252 encoding and CRLF line ends. `.gitattributes` keeps these bytes unchanged.
