# Arquitetura do Projeto

## Objetivo

Manter a ideia do jogo atual, mas separar responsabilidades para que login, campanha, multiplayer e midia nao fiquem misturados na UI.

## Camadas

```txt
index.html
script.js                 UI legada atual
firebase-service.js        fachada publica: window.CDIFirebase

js/firebase/
  client.js                inicializacao do Firebase
  auth-service.js          login, cadastro, perfil
  campaign-repository.js   campanhas, subcolecoes, entrada por ID, listeners
  constants.js             colecoes padrao
  utils.js                 retry, ids, limpeza de dados

js/media/
  cloudinary-service.js    upload de imagens via Cloudinary unsigned preset

js/game/
  campaign-service.js      API de dominio para criar/entrar/excluir campanhas
```

## Fluxo Multiplayer

```txt
Mestre cria campanha
  -> campaign-repository.saveCampaign()
  -> campaigns/{id}
  -> subcolecoes para players, messages, characters, items...

Jogador entra por ID
  -> campaign-repository.joinCampaign()
  -> valida senha da campanha
  -> adiciona uid em members
  -> cria/atualiza players/{playerId}
  -> cria mensagem de sistema
  -> carrega campanha completa
```

## Principio

A UI nao deve conhecer detalhes do Firebase. Ela deve chamar uma fachada ou servico de jogo.

O arquivo `script.js` ainda concentra a UI atual para preservar todas as telas e regras do jogo. A refatoracao segura deve continuar migrando partes dele para `js/ui/` e `js/game/`, sem alterar atributos, habilidades, inventario ou regras ja existentes.

## Proximos Passos Recomendados

1. Migrar renderizacao da tela inicial para `js/ui/home-view.js`.
2. Migrar fluxo de autenticacao para `js/game/auth-flow.js`.
3. Migrar a tela Mestre para `js/ui/master-view.js`.
4. Migrar a tela Jogador para `js/ui/player-view.js`.
5. Substituir `onclick` inline por eventos registrados no JavaScript.

## Imagens

O app usa Cloudinary para imagens quando `window.CDI_CLOUDINARY_CONFIG.cloudName`
e `uploadPreset` estao preenchidos. Se nao estiverem configurados, o app usa
Base64 comprimido como fallback para nao quebrar o jogo.
