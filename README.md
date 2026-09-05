# AKTela Activity — Stability v2

Frontend da Discord Activity.

## O que mudou

- Negociação de codec por espectador com `VideoDecoder.isConfigSupported()`.
- H.264 Baseline/Main/High negociados por resolução/FPS e fallback para VP8.
- Se a configuração H.264 real for recusada, a Activity remove essa capacidade e renegocia automaticamente.
- Espera por quadro-chave e recuperação automática após reconexão/erro/congestionamento.
- Controle de `decodeQueueSize`: frames antigos são descartados em vez de aumentar o atraso.
- Reconexão WebSocket com backoff e identificação estável do espectador.
- Diagnóstico oculto em `Ctrl + Alt + D`.
- Tela cheia preserva toda a imagem por padrão (`contain`).
- Volume individual por espectador.

## Discord Developer Portal

Mantenha os mapeamentos:

- Raiz `/` -> `ak-tela-three.vercel.app`
- Proxy `/relay` -> `aktela-relay.tacito1-filho.workers.dev`

## Deploy

Substitua o conteúdo do repositório `AKTela` por estes arquivos. Não mantenha a pasta antiga `api/`.
