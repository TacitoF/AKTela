# AKTela v0.2

Activity do Discord + relay WebSocket experimental.

## Como testar

1. Faça deploy deste projeto na mesma Vercel já usada pela AKTela.
2. Abra a Activity no Discord.
3. Copie o código de 6 caracteres exibido na parte inferior.
4. Abra o AKTela Capture v0.2, cole o código e ligue o compartilhamento.
5. Quem estiver na mesma instância da Activity verá a imagem dentro do Discord.

## Observação

Esta versão usa quadros JPEG compactados (modo leve) por WebSocket para validar o fluxo completo. A próxima etapa pode trocar o encoder por vídeo com aceleração de hardware para aumentar FPS e reduzir banda/CPU.
