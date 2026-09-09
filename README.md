# AKTela Activity 2.7.0

Cliente de visualização executado como Discord Activity.

- Descobre e exibe até três transmissões simultâneas na mesma Activity.
- Suspende os pacotes e a decodificação de vídeo quando a Activity fica oculta, retomando a partir de um quadro-chave ao voltar.
- Fora do proxy do Discord, usa mídia binária para reduzir Base64, banda e alocações; dentro do Discord preserva o transporte textual estável.
- Processa pacotes agrupados sem criar uma nova cópia de cada frame.
- Envia a saúde real do player ao Capture para que a qualidade também reaja a sobrecarga no dispositivo de quem assiste.
- Mostra as telas em grade e permite destacar uma delas; no destaque, as outras assinaturas são encerradas para economizar banda e CPU.
- Na grade, todas as telas começam sem áudio para evitar reprodução duplicada; a tela destacada inicia com áudio.
- Com três transmissões, a primeira ocupa a faixa superior e as demais ficam lado a lado abaixo, adaptando-se a telas menores.
- Identifica em cada painel o nome informado por quem está transmitindo.
- Quando há várias telas, substitui a expansão das miniaturas por “Destacar tela”, mantendo somente o player escolhido ativo e com áudio.
- Aceita lotes de mídia AKB1 para reduzir o consumo de requisições do Durable Object sem perder compatibilidade com pacotes AKV5 individuais.
- O controle de volume permanece visível no player expandido de sessões com uma única tela.
- O slider de volume também permanece visível e interativo ao expandir uma transmissão diretamente da grade.
- Reproduz o PCM decodificado em um `AudioWorklet` contínuo, isolado da thread da interface.
- Mantém uma reserva curta de 60 ms, suaviza microfaltas com fade e limita a fila a 160 ms.
- Usa a mesma origem temporal para áudio e vídeo e descarta somente áudio realmente antigo.
- Mantém o agendamento sequencial como fallback para navegadores sem `AudioWorklet`.
- Exibe buffer e microfaltas de áudio no painel de diagnóstico.

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
