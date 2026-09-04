# AKTela Activity v1.3

Correções desta versão:

- decoder H.264 agora consulta `VideoDecoder.isConfigSupported()` antes de configurar;
- suporte a fallback entre aceleração de hardware, configuração padrão e software;
- área de vídeo calcula o retângulo real da transmissão para preservar 100% da imagem;
- cursor remoto passa a usar exatamente a mesma área renderizada do vídeo;
- modo imersivo ocupa toda a área da Activity sem cortar a imagem;
- botão Copiar mantém contraste branco;
- mantém o relay atual e o protocolo AKV4.

Substitua os arquivos do repositório `AKTela` por estes arquivos e aguarde o deploy da Vercel.
