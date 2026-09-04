# AKTela Activity — reconstrução limpa v1

A Activity **não conecta diretamente** ao domínio workers.dev quando roda dentro do Discord. Ela usa o proxy do Discord.

## URL Mappings obrigatórios no Developer Portal
Em **Atividades > Mapeamentos de URL**:

1. Prefixo `/relay` -> Alvo `aktela-relay.tacito1-filho.workers.dev`
2. Prefixo `/` -> Alvo `ak-tela-three.vercel.app`

**Importante:** `/relay` deve ficar acima de `/`.

Depois publique este projeto na Vercel.
