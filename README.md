# AKTela Activity v0.5.2

Atualização de usabilidade e desempenho do player.

- Tela cheia agora usa modo imersivo dentro da Activity, compatível com o iframe do Discord.
- Duplo clique no vídeo também entra/sai do modo imersivo; `Esc` sai.
- Volume mostra a porcentagem ao lado do controle e continua salvo localmente por usuário/dispositivo.
- Cursor remoto deixa de disparar renderizações React a cada movimento; a posição é atualizada diretamente no elemento.
- Contexto 2D do canvas é reutilizado entre frames e o modo `desynchronized` é solicitado quando disponível para reduzir latência de apresentação.
- Mantém Termos em `/termos` e Privacidade em `/privacidade`.
