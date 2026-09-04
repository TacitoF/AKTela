# AKTela Activity v0.5.4

Esta versão passa a ler o endereço do relay em `/relay.json`.

Enquanto `relayUrl` estiver vazio, a Activity usa o relay antigo da própria Vercel.
Depois de publicar o relay da Cloudflare, altere somente:

```json
{
  "relayUrl": "wss://SEU-WORKER.workers.dev/ws"
}
```

O AKTela Capture v0.6.2 lê o mesmo arquivo, então a troca do relay não exige recompilar o executável.
