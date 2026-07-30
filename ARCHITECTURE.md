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
  tabletop-model.js        vinculos, presenca, inventarios, trocas e cenas
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

O vinculo e uma configuracao persistente da campanha, independente da presenca.
`assignPlayerCharacter()` atualiza o `characterId` do jogador, libera o
personagem anterior, reserva o novo personagem e atualiza `readyPlayerEmails`
em uma unica transacao Firestore. F5, logout, estado Offline e uma nova entrada
na sala nao removem o vinculo; ele so e desfeito por uma acao explicita do
Mestre ou pela exclusao do jogador/personagem.

## Inventario

`characters/{characterId}.inventory` e a fonte de verdade dos itens possuidos.
Cada entrada guarda uma copia do nome, descricao e imagem do catalogo, alem de
quantidade, estado equipado e observacoes. Assim, excluir ou editar um item do
catalogo nao apaga o que ja foi entregue aos personagens.

O Mestre pode entregar itens do catalogo ou criar uma entrada livre diretamente
no inventario de qualquer personagem, incluindo foto, quantidade, equipamento e
observacoes. Essa entrega nao depende de aprovacao do jogador e aparece em tempo
real; somente transferencias iniciadas por jogadores passam pela aprovacao.

Titulo, descricao, foto e quantidade sao obrigatorios para novas entregas. Itens
do catalogo incompletos ficam bloqueados ate serem editados. O gerenciador do
inventario tambem permite completar ou substituir esses dados em entradas
antigas sem remover o item do personagem.

Itens do catalogo, inclusive entradas antigas marcadas como `revealed`, nao
aparecem na mochila pessoal ate que o Mestre os entregue ao personagem. A tela
do jogador renderiza somente `characters/{characterId}.inventory`, preservando
o isolamento entre os inventarios.

## Presenca

O jogador atualiza `online` e `lastSeen` no proprio documento. Um heartbeat e
enviado a cada 45 segundos. A interface considera 90 segundos para Online e
cinco minutos para Ausente; depois disso mostra Offline. Esse mecanismo tambem
cobre quedas abruptas em que o navegador nao consegue enviar o logout.

## Sessao persistente

O Firebase Auth usa `browserLocalPersistence`, portanto a identidade permanece
autenticada depois de F5 ou depois de reabrir o navegador. O app salva em
`cdi_session_context_v2` somente IDs de contexto, papel e ultima tela. Nenhuma
senha e armazenada. Quando o listener do Firestore termina a primeira carga, o
app restaura campanha, jogador, personagem e tela; o botao Sair limpa o contexto
e encerra a sessao Firebase explicitamente.

## Transferencias entre jogadores

Uma solicitacao pendente permanece em `itemTransfers` e reserva logicamente a
quantidade pedida, sem retirar o item do remetente. O Mestre resolve a
solicitacao por `resolveItemTransfer()`, que usa uma transacao Firestore para:

1. confirmar que a solicitacao ainda esta pendente;
2. conferir novamente a quantidade no inventario de origem;
3. atualizar os inventarios de origem e destino;
4. marcar a solicitacao como aprovada no mesmo commit.

Uma rejeicao altera somente o estado da solicitacao. Assim, falhas de rede,
cliques repetidos e aprovacoes concorrentes nao duplicam nem fazem itens sumirem.

## Cenas ao vivo

O roteiro completo fica em `campaigns/{campaignId}/scenes` e contem imagem,
titulo, legenda publica e notas privadas. Essa subcolecao e lida e escrita
somente pelo Mestre. Os jogadores nao assinam esse listener.

A campanha principal guarda apenas `liveScene`, uma copia publica e minima da
cena atualmente apresentada: imagem, titulo, legenda, posicao e estado ativo.
Ao ocultar a apresentacao, esses campos publicos sao limpos. Isso permite que um
jogador que entre atrasado veja imediatamente a cena atual sem receber imagens
futuras ou notas do Mestre.

## Escritas e Concorrencia

O repositorio grava somente os campos realmente alterados. Por exemplo, quando
o Mestre entrega um item, apenas `inventory` muda no documento do personagem;
uma alteracao simultanea de saude feita pelo jogador nao e sobrescrita.

As regras em `firestore.rules` permitem ao jogador alterar somente presenca,
saude, sanidade, habilidades, mensagens, rolagens e solicitacoes pertencentes a
ele. Vinculos, inventarios, resolucao de trocas e o roteiro privado de cenas
continuam sob controle do Mestre.

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
Base64 comprimido como fallback para nao quebrar o jogo. Personagens, jogadores,
itens, inventarios, registros, criaturas, evidencias e marcas sempre exibem uma
area visual; entidades antigas sem foto recebem uma imagem de RPG com inicial ate
que o Mestre envie a imagem definitiva.
