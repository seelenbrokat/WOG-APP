# WOG shipping.NET ApiData / Public API
Quelle: `https://shippingnet03.ondot.at/WOG/#/SystemConfiguration/ApiData`
OpenAPI-Downloads (ohne Login öffentlich unter `DataService/PublicApi/v1/{Api}/openapi.json`):

## shippingNET PublicApi Article Service (`Article.openapi.json`)
- Version: 1.0
- Servers: https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Article/openapi.json
- Security: `{"clientID": {"name": "client-id", "type": "apiKey", "in": "header", "description": "Client ID"}, "orgUnitID": {"name": "orgunit-id", "type": "apiKey", "in": "header", "description": "OrgUnit ID"}, "authToken": {"name": "auth-token", "type": "apiKey", "in": "header", "description": "Auth Token (GUID`
- Endpoints (2):
  - `POST /import`
  - `POST /importList`

## shippingNET PublicApi Collo Service (`Collo.openapi.json`)
- Version: 1.0
- Servers: https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Collo/openapi.json
- Security: `{"clientID": {"name": "client-id", "type": "apiKey", "in": "header", "description": "Client ID"}, "orgUnitID": {"name": "orgunit-id", "type": "apiKey", "in": "header", "description": "OrgUnit ID"}, "authToken": {"name": "auth-token", "type": "apiKey", "in": "header", "description": "Auth Token (GUID`
- Endpoints (5):
  - `POST /import`
  - `POST /importForLabel`
  - `POST /importStatus`
  - `POST /generateLabel`
  - `POST /retrieve`

## shippingNET PublicApi Order Service (`Order.openapi.json`)
- Version: 1.0
- Servers: https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Order
- Security: `{"clientID": {"name": "client-id", "type": "apiKey", "in": "header", "description": "Client ID"}, "orgUnitID": {"name": "orgunit-id", "type": "apiKey", "in": "header", "description": "OrgUnit ID"}, "authToken": {"name": "auth-token", "type": "apiKey", "in": "header", "description": "Auth Token (GUID`
- Endpoints (3):
  - `POST /import`
  - `POST /importStatus`
  - `POST /retrieve`

## shippingNET PublicApi Shipment Service (`Shipment.openapi.json`)
- Version: 1.0
- Servers: https://shippingnet03.ondot.at/WOG/DataService/PublicApi/v1/Shipment
- Security: `{"clientID": {"name": "client-id", "type": "apiKey", "in": "header", "description": "Client ID"}, "orgUnitID": {"name": "orgunit-id", "type": "apiKey", "in": "header", "description": "OrgUnit ID"}, "authToken": {"name": "auth-token", "type": "apiKey", "in": "header", "description": "Auth Token (GUID`
- Endpoints (10):
  - `POST /import`
  - `POST /importPreview`
  - `POST /importForLabel`
  - `POST /importStatus`
  - `POST /generateLabel`
  - `POST /retrieve`
  - `POST /statusRetrieve`
  - `POST /addDocument`
  - `POST /dailyClosing`
  - `POST /priceInfo`

## Zugangsdaten (Login nötig)
ClientID / OrgUnitID / OrgUnitGUID bzw. `api-key` stehen in der ApiData-Maske nach Login.
Endpoint: `GET DataService/apiv2/SystemConfiguration/orgUnitGetAPIInfo`
