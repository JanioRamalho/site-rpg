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
  tabletop-model.js        vinculos, participantes, presenca e inventarios
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
  -> reivindica o players/{playerId} preparado para seu e-mail
  -> preserva o characterId definido pelo Mestre
  -> cria mensagem de sistema
  -> carrega campanha completa
```

## Contrato de Jogadores e Personagens

Cada documento em `players` representa uma vaga da mesa. O Mestre pode criar a
vaga antes da primeira entrada usando o e-mail da conta do jogador. O campo
`characterId` aponta para o personagem preparado e `authUid` permanece nulo ate
que a conta com o mesmo e-mail entre na campanha.

Cada personagem possui `controllerPlayerId` e `inventory`. O modelo de dominio
garante uma relacao individual: um personagem nao pode ser controlado por dois
jogadores. Personagens sem uma conta autenticada controlando-os nao aparecem na
tela Sala.

## Inventario

`characters/{characterId}.inventory` e a fonte de verdade dos itens possuidos.
Cada entrada guarda uma copia do nome, descricao e imagem do catalogo, alem de
quantidade, estado equipado e observacoes. Assim, excluir ou editar um item do
catalogo nao apaga o que ja foi entregue aos personagens.

Itens antigos marcados como `revealed` continuam aparecendo em uma secao de
itens compartilhados para manter compatibilidade com campanhas anteriores.

## Presenca

O jogador atualiza `online` e `lastSeen` no proprio documento. Um heartbeat e
enviado a cada 45 segundos. A interface considera 90 segundos para Online e
cinco minutos para Ausente; depois disso mostra Offline. Esse mecanismo tambem
cobre quedas abruptas em que o navegador nao consegue enviar o logout.

## Escritas e Concorrencia

O repositorio grava somente os campos realmente alterados. Por exemplo, quando
o Mestre entrega um item, apenas `inventory` muda no documento do personagem;
uma alteracao simultanea de saude feita pelo jogador nao e sobrescrita.

As regras em `firestore.rules` permitem ao jogador alterar somente presenca,
saude, sanidade, habilidades, mensagens, rolagens e solicitacoes pertencentes a
ele. Vinculos e inventarios continuam sob controle do Mestre.

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
