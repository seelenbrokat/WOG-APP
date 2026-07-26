# WOG shipping.NET Public API – Spezifikation

Instanz: `https://shippingnet03.ondot.at/WOG`

## Authentifizierung

Header (vor Version mit zusammengesetztem api-key ebenfalls gültig):

| Header | Bedeutung |
|---|---|
| `client-id` | ClientID |
| `orgunit-id` | OrgUnitID |
| `auth-token` | OrgUnitGUID |

Alternativ oft: `api-key: {ClientID}:{OrgUnitID}:{OrgUnitGUID}`

Credentials liegen lokal in `credentials/apidata.env` (nicht im Git).

## shippingNET PublicApi Article Service

- OpenAPI-Datei: `openapi/Article.openapi.json`
- Base URL: `https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Article/openapi.json`

| Method | Path | Summary |
|---|---|---|
| POST | `/import` | import |
| POST | `/importList` | importList |

Schemas (30): `InternalError`, `ArticleImportResult`, `ArticleImportResponse`, `importResponse`, `IDNameNumberReference`, `StringIDNameReference`, `OrgUnitReference`, `UserMatchingData`, `PickingOperation`, `PickingOptimization`, `RefrigeratedCargoType`, `RefrigeratedCargo`, `ApiArticlePart`, `ApiArticlePackageType`, `IDNameReference`, `PartyType`, `ApiArticleCode`, `ApiArticleCustomsInformation`, `ApiArticleString`, `ApiArticleWarehouseWorkInstructionType`, `DangerousGoodsReference`, `Decimal`, `ApiArticleDangerousGoods`, `ApiArticle`, `ArticleImportResultFields`, `ArticleImportResponseFields`, `importRequest`, `ArticleImportListResponse`, `importListResponse`, `importListRequest`

## shippingNET PublicApi Collo Service

- OpenAPI-Datei: `openapi/Collo.openapi.json`
- Base URL: `https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Collo/openapi.json`

| Method | Path | Summary |
|---|---|---|
| POST | `/import` | import |
| POST | `/importForLabel` | importForLabel |
| POST | `/importStatus` | importStatus |
| POST | `/generateLabel` | generateLabel |
| POST | `/retrieve` | retrieve |

Schemas (58): `InternalError`, `ColloImportResult`, `ColloImportResponse`, `importResponse`, `BulkyGoodsType`, `RefrigeratedCargoType`, `RefrigeratedCargo`, `IDReference`, `OrgUnitReference`, `ArticleReference`, `IDNameNumberReference`, `StringIDNameReference`, `UserMatchingData`, `PickingOperation`, `PickingOptimization`, `ApiArticlePart`, `ApiArticlePackageType`, `IDNameReference`, `PartyType`, `ApiArticleCode`, `ApiArticleCustomsInformation`, `ApiArticleString`, `ApiArticleWarehouseWorkInstructionType`, `DangerousGoodsReference`, `Decimal`, `ApiArticleDangerousGoods`, `ApiArticle`, `CustomsOption`, `Date`, `ApiColloArticle`, `ApiOrderPosCollo`, `ApiShipmentColloDangerousGoods`, `ApiColloShipmentCode`, `ApiCollo`, `ColloImportShipmentMatchtingData`, `ColloImportResultFields`, `ColloImportResponseFields`, `ShipmentPosMatchingData`, `importRequest`, `ColloImportForLabelResponse` … +18

## shippingNET PublicApi Order Service

- OpenAPI-Datei: `openapi/Order.openapi.json`
- Base URL: `https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Order`

| Method | Path | Summary |
|---|---|---|
| POST | `/import` | import |
| POST | `/importStatus` | importStatus |
| POST | `/retrieve` | retrieve |

Schemas (71): `InternalError`, `ArticleImportResult`, `OrderPosImportResult`, `OrderImportResult`, `OrderImportResponse`, `importResponse`, `OrderType`, `Date`, `OrgUnitReference`, `ApiAddress`, `ApiThirdPartyApplication`, `TaxLiabilityType`, `ApiAccount`, `ApiOrgUnitAccounting`, `ApiOrgUnit`, `ApiContactPerson`, `DispatchType`, `IDNameReference`, `CarrierServiceReference`, `IDNameThirdPartyReference`, `IDReference`, `ArticleReference`, `IDNameNumberReference`, `StringIDNameReference`, `UserMatchingData`, `PickingOperation`, `PickingOptimization`, `RefrigeratedCargoType`, `RefrigeratedCargo`, `ApiArticlePart`, `ApiArticlePackageType`, `PartyType`, `ApiArticleCode`, `ApiArticleCustomsInformation`, `ApiArticleString`, `ApiArticleWarehouseWorkInstructionType`, `DangerousGoodsReference`, `Decimal`, `ApiArticleDangerousGoods`, `ApiArticle` … +31

## shippingNET PublicApi Shipment Service

- OpenAPI-Datei: `openapi/Shipment.openapi.json`
- Base URL: `https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Shipment`

| Method | Path | Summary |
|---|---|---|
| POST | `/import` | import |
| POST | `/importPreview` | importPreview |
| POST | `/importForLabel` | importForLabel |
| POST | `/importStatus` | importStatus |
| POST | `/generateLabel` | generateLabel |
| POST | `/retrieve` | retrieve |
| POST | `/statusRetrieve` | statusRetrieve |
| POST | `/addDocument` | addDocument |
| POST | `/dailyClosing` | dailyClosing |
| POST | `/priceInfo` | priceInfo |

Schemas (105): `InternalError`, `Date`, `Decimal`, `AccountingPartyType`, `BookingType`, `AccountingDetailsRecord`, `AccountingDetailsCalculationBase`, `AccountingDetailsParty`, `AccountingDetails`, `ShipmentImportResult`, `ColloImportResult`, `ShipmentImportResponse`, `importResponse`, `OrgUnitReference`, `ApiAddress`, `ApiThirdPartyApplication`, `TaxLiabilityType`, `ApiAccount`, `ApiOrgUnitAccounting`, `ApiOrgUnit`, `ApiContactPerson`, `DispatchTypeV1`, `InsuranceType`, `BulkyGoodsType`, `RefrigeratedCargoType`, `RefrigeratedCargo`, `IDReference`, `ArticleReference`, `IDNameNumberReference`, `StringIDNameReference`, `UserMatchingData`, `PickingOperation`, `PickingOptimization`, `ApiArticlePart`, `ApiArticlePackageType`, `IDNameReference`, `PartyType`, `ApiArticleCode`, `ApiArticleCustomsInformation`, `ApiArticleString` … +65

