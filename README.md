# AKTela Activity v1.1

Correções:
- aceita pacotes binários como ArrayBuffer ou Blob;
- detecta automaticamente profile/level H.264 lendo o SPS do quadro-chave;
- não depende mais do codec H.264 hardcoded;
- mostra erros reais do decoder em vez de descartá-los silenciosamente;
- preserva o último quadro durante reconexões curtas;
- classificação de latência menos agressiva.

URL Mapping necessário no Discord:
- `/` -> `ak-tela-three.vercel.app`
- `/relay` -> `aktela-relay.tacito1-filho.workers.dev`
