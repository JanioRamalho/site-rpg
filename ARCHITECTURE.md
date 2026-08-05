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
  cloudinary-service.js    upload Cloudinary com validacao, timeout e retry

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

O catalogo e reutilizavel: adicionar um item a um personagem nao o remove nem o
reserva. O mesmo `items/{itemId}` pode alimentar inventarios diferentes. Dentro
de um personagem, novas entregas com o mesmo `itemId` somam a quantidade na
entrada existente, portanto varias unidades continuam ocupando um unico slot.
Entradas livres, que nao possuem `itemId`, permanecem independentes.

`campaigns/{campaignId}.originLoadouts` guarda os kits iniciais por origem como
pares de `itemId` e quantidade. Ao criar um personagem, o Mestre pode aplicar o
kit configurado. `characters/{characterId}.appliedOriginLoadouts` registra as
origens ja aplicadas e impede uma segunda aplicacao acidental; a reaplicacao
continua disponivel mediante confirmacao explicita do Mestre. Alterar a origem
nao remove itens que o personagem ja recebeu.

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

O Firestore usa `persistentLocalCache` com gerenciador de multiplas abas. Leituras
recentes e mutacoes ainda nao enviadas permanecem no IndexedDB entre recargas;
ao recuperar a conexao, o SDK sincroniza a fila automaticamente. A fila propria
do app continua protegendo o intervalo anterior ao envio e fazendo a
reconciliacao por baseline e identidade de mutacao.

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
cena atualmente apresentada: URL da imagem, posicao e estado ativo. Ao ocultar
a apresentacao, esses campos publicos sao limpos. Isso permite que um
jogador que entre atrasado veja imediatamente a cena atual sem receber imagens
futuras ou notas do Mestre.

O roteiro aceita no maximo 40 cenas ativas e usa `updateCampaignScenes` para
gravar inclusoes e ordenacao em um unico batch atomico. Remover uma cena usa uma
transacao dedicada que move o documento para `sceneTrash`; restaurar move o mesmo
documento de volta, sem novo upload. A lixeira e privada do Mestre e fica fora do
salvamento geral da campanha, impedindo que uma aba antiga a apague. Nenhum desses
fluxos grava jogadores, personagens, logins ou progresso. Iniciar, avancar ou
ocultar usa `updateLiveScene`, que altera apenas a cena ao vivo. Um lote de imagens
e enviado com concorrencia
limitada a tres arquivos e seus resultados ficam em uma fila IndexedDB ate o
Firestore confirmar o roteiro. A fila e separada por usuario e campanha, valida
seu proprio conteudo ao reabrir o navegador e impede um segundo lote enquanto
existir um commit pendente recuperavel. Antes do primeiro upload ela confirma
uma gravacao e remocao reais no IndexedDB; cada worker so avanca depois que o
checkpoint das URLs ja enviadas foi confirmado. Assim, falta de cota e abortos
de transacao sao detectados antes de iniciar o lote ou interrompem novas
transferencias sem descartar o checkpoint ja duravel.

## Escritas e Concorrencia

O repositorio grava somente os campos realmente alterados. Por exemplo, quando
o Mestre entrega um item, apenas `inventory` muda no documento do personagem;
uma alteracao simultanea de saude feita pelo jogador nao e sobrescrita.

As alteracoes genericas tambem entram em uma fila por campanha, persistida em
IndexedDB antes do envio e reidratada ao reabrir o app. Falhas temporarias usam
tentativas com espera progressiva. Operacoes especializadas aguardam essa fila e
protegem o estado local contra snapshots antigos antes de executar seu commit.

Cada job captura a campanha remota usada como base e uma identidade de mutacao.
O repositorio grava apenas o delta intencional entre essa base e o estado local;
campos atualizados em paralelo por outro participante permanecem intactos. Ao
terminar, o Firebase grava `lastClientMutation` como confirmacao. Depois de uma
queda, a fila consulta essa confirmacao, evita repetir jobs ja concluidos e faz
uma reconciliacao de tres vias sobre a versao remota atual. Registros antigos
sem base segura sao preservados, mas nunca reaplicados automaticamente. A
criacao de campanha usa a mesma fila e grava seu ACK junto do primeiro documento.

Se o IndexedDB falhar, o payload completo usa um fallback local; sair da conta e
bloqueado quando nenhum armazenamento duravel consegue preservar o job. A
limpeza confere a identidade da mutacao para nao apagar um trabalho mais novo de
outra aba. Timeouts limitam apenas quanto a interface espera antes de liberar a
operacao: a gravacao original continua unica na fila, sem ser cancelada ou
duplicada.

Imagens de tabuleiro, personagens, casos, criaturas, itens, evidencias e marcas
sao vinculadas por `commitCampaignMediaMutation`, que confirma URL e metadados
do Cloudinary em um unico batch Firestore antes de alterar o estado local.
Ao trocar o tabuleiro, o mesmo batch grava o novo em `gameBoard` e conserva
somente o anterior em `previousGameBoard`. O botao de retorno apenas troca esses
dois campos, sem novo upload e sem tocar personagens ou jogadores.

Saude e sanidade usam `adjustCharacterVital`, uma transacao dedicada no documento
do personagem. Cada clique altera somente `health` ou `sanity`, e os cliques do
mesmo atributo sao serializados na interface. Esse caminho nao regrava campanha,
login, jogador, vinculo, inventario ou os demais campos do personagem.

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

O Cloudinary e a fonte de verdade para os arquivos. O Firestore e o cache local
guardam somente a URL HTTPS e metadados do ativo. Nao existe fallback persistente
para Base64: se o upload falhar, a entidade permanece inalterada e o usuario pode
tentar novamente.

O original e enviado sem rasterizacao destrutiva, preservando formato, resolucao,
transparencia e proporcao. Na entrega, URLs Cloudinary com `c_limit` geram versoes
adequadas para miniaturas, palco e tabuleiro sem cortar nem deformar. Se uma
transformacao nao carregar, a interface tenta automaticamente a URL original.
Cenas e tabuleiros trocam temporariamente para o original durante a tela cheia;
se o navegador nao suportar o formato original, restauram imediatamente a
derivada compativel.

Uma cena movida para a lixeira continua apontando para o mesmo original no
Cloudinary, portanto pode ser restaurada integralmente. A exclusao fisica do
arquivo remoto nao e executada pelo navegador: ela exige um backend assinado e
uma politica de retencao para nao tornar a recuperacao impossivel.

Imagens antigas fora do Cloudinary (Base64, URLs externas ou caminhos relativos)
sao migradas por uma operacao explicita nas Configuracoes. Antes da migracao o
app salva um backup JSON completo, com manifesto de progresso e SHA-256 do
snapshot. A tela permite reler o arquivo e recalcular tanto a assinatura quanto
o manifesto sem gravar nada no Firebase. A migracao somente continua depois da
confirmacao do arquivo.

Antes de qualquer upload, um preflight somente leitura compara cada referencia
local com o documento remoto e confirma que o usuario autenticado ainda e o
Mestre. Documento, entrada de lista ou imagem removida/alterada causa cancelamento
com zero gravacoes; a migracao nunca recria dados ausentes. Campanhas que ainda
guardam colecoes com imagens dentro do documento principal passam antes por uma
transacao de compatibilidade separada: os valores remotos exatos sao movidos para
subdocumentos e os arrays antigos sao retirados no mesmo commit. Se o Firebase
contiver simultaneamente os dois formatos, IDs ausentes/repetidos ou qualquer
mudanca concorrente, a operacao inteira e bloqueada em vez de escolher uma versao
por suposicao. Operacoes acima da margem segura de 450 documentos tambem sao
recusadas antes da transacao.

Depois do preflight, cada imagem unica e enviada uma vez e uma unica transacao
substitui somente propriedades `image` correspondentes. A transacao repete as
mesmas verificacoes para impedir uma corrida entre o preflight e o commit. Depois
do commit, uma leitura autoritativa confirma que nao restou referencia antiga; a
reconciliacao de tres vias preserva tanto edicoes locais feitas durante o upload
quanto campos alterados remotamente por outro participante.
