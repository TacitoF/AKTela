# AKTela Activity — Stability v2.2.2

Mantém a negociação WebCodecs da Stability v2.1 e a preferência H.264 Main, Baseline, High e VP8. O codec real do SPS continua sendo validado pelo espectador antes da decodificação.

- Detecta ausência de pacotes e decoder parado, reinicia a reprodução e solicita novo keyframe automaticamente.
- Retira da negociação um codec que falhou de verdade, permitindo fallback para outro perfil ou VP8.
- Envia FPS reproduzido, fila, descartes e estado de travamento ao Capture.
- Responde à medição Capture → espectador → Capture.
- Oculta o cursor remoto inativo após 1,6 segundo no modo tela cheia e remove quadros atrasados de uma geração antiga do decoder.
