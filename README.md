# AKTela Activity 2.5.0

Cliente de visualização executado como Discord Activity.

- Descobre e exibe até três transmissões simultâneas na mesma Activity.
- Mostra as telas em grade e permite destacar uma delas; no destaque, as outras assinaturas são encerradas para economizar banda e CPU.
- Na grade, todas as telas começam sem áudio para evitar reprodução duplicada; a tela destacada inicia com áudio.
- Com três transmissões, a primeira ocupa a faixa superior e as demais ficam lado a lado abaixo, adaptando-se a telas menores.
- Identifica em cada painel o nome informado por quem está transmitindo.
- Quando há várias telas, substitui a expansão das miniaturas por “Destacar tela”, mantendo somente o player escolhido ativo e com áudio.
- Aceita lotes de mídia AKB1 para reduzir o consumo de requisições do Durable Object sem perder compatibilidade com pacotes AKV5 individuais.
- O controle de volume permanece visível no player expandido de sessões com uma única tela.

- O player tenta liberar o áudio automaticamente e mostra o estado realmente mutado quando o Discord exige um clique para iniciar a reprodução.
- O primeiro clique no volume libera o áudio sem inverter o controle de volta para mudo.

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
