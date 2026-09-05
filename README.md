# AKTela Activity — Stability v2.1

Frontend da Discord Activity, revisado em conjunto com Capture e Relay.

## Estado da revisão

- Negociação de codec com `VideoDecoder.isConfigSupported()` mantida.
- H.264 Annex B e recuperação por quadro-chave mantidos.
- Controle de `decodeQueueSize`, reconexão e diagnóstico mantidos.
- Tela cheia preserva toda a imagem por padrão (`contain`).
- Nenhum erro bloqueante novo foi encontrado na revisão estática desta versão.

## Discord Developer Portal

Mantenha os mapeamentos:

- Raiz `/` -> `ak-tela-three.vercel.app`
- Proxy `/relay` -> `aktela-relay.tacito1-filho.workers.dev`
