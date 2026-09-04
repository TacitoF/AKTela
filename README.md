# AKTela Activity v0.3

Player 1080p de baixa latência para a AKTela dentro do Discord.

## v0.3
- H.264 Annex B decodificado com WebCodecs/decodificação de hardware quando disponível.
- 30 ou 60 FPS definidos pelo Capture.
- Áudio Opus do sistema com botão `Ativar áudio` para cumprir as regras de autoplay do navegador.
- Pequeno buffer (~70 ms) para reduzir jitter sem acumular atraso.
- Relay descarta backlog em clientes lentos e recupera no próximo keyframe.
- Código de pareamento e fallback de cópia mantidos.

O Discord Activity continua usando WebSocket, pois WebRTC não é suportado pelo ambiente de Activities.
