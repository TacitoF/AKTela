# AKTela Activity v1.2

Frontend da Activity do Discord.

## Correções desta versão

- Usa `patchUrlMappings` do Embedded App SDK para o WebSocket externo.
- Solicita ao relay o transporte textual de mídia (`transport=text`) para atravessar o proxy do Discord com consistência.
- Continua aceitando mídia binária fora do Discord.
- Remove dependência de `DataView.getBigInt64` no parser do pacote.
- Melhora mensagens de sincronização e reconexão.
- Mantém tela cheia imersiva, volume individual e interface da versão anterior.
