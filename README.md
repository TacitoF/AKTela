# AKTela Activity 2.3

Cliente de visualização executado como Discord Activity.

- Negocia H.264 Main, Baseline, High ou VP8 conforme os recursos de todos os espectadores.
- Valida o codec real do SPS e o envelope AKV5 antes da decodificação.
- Detecta ausência de pacotes ou decoder parado, reinicia a reprodução e solicita um quadro-chave.
- Descarta callbacks atrasados de decodificadores e WebSockets já substituídos.
- Limpa vídeo, áudio e cursor ao desconectar, evitando estado congelado da sessão anterior.
- Envia FPS reproduzido, fila, descartes e estado de travamento ao Capture.
- Responde à medição Capture → espectador → Capture.
- Oculta o cursor remoto inativo após 1,6 segundo no modo tela cheia.

- Explica o fallback automático quando um driver rejeita H.264 depois da verificação inicial.
- Mostra “Recuperando vídeo” durante travamentos e preserva métricas essenciais em telas menores.
