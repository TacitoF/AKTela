# AKTela Activity v0.4

Activity do Discord com player H.264/Opus em baixa latência.

## Novidades

- Interface redesenhada e mais compacta.
- Cursor remoto desenhado como camada separada do vídeo.
- Volume e mute dentro da Activity.
- Ajustar/Preencher.
- Tela cheia por botão e duplo clique quando permitido pelo cliente.
- Indicadores de resolução, FPS, áudio, latência, espectadores e perfil.
- Reconexão automática.
- Código do Capture com fallback de cópia compatível com iframe.

O relay em `api/ws.ts` também encaminha metadados do cursor e mede RTT por ping/pong.
