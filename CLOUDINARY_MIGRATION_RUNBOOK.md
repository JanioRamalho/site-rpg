# Migracao segura de imagens para o Cloudinary

Este documento e um bloqueio operacional: nenhuma publicacao ou migracao da
campanha final deve ser feita sem autorizacao expressa do responsavel pela mesa.

## Garantias implementadas

- O backup JSON e salvo antes da primeira alteracao e inclui o snapshot completo,
  um manifesto de progresso e a assinatura SHA-256 das campanhas.
- O proprio site consegue verificar o arquivo baixado sem escrever no Firebase.
- Campanhas antigas com colecoes embutidas sao preparadas em uma transacao
  separada. Os valores remotos exatos sao movidos; nenhum registro e reconstruido
  a partir de uma copia local.
- O preflight de imagens e somente leitura e ocorre antes do primeiro upload.
- A substituicao das URLs ocorre em uma unica transacao e repete as verificacoes
  do preflight para cobrir alteracoes concorrentes.
- Uma leitura autoritativa posterior confirma que nenhuma referencia antiga
  permaneceu no Firebase.
- Arquivos do Cloudinary nao sao excluidos pelo navegador. Cenas na lixeira e o
  tabuleiro anterior continuam recuperaveis.

## Situacoes que bloqueiam a migracao

- o usuario autenticado nao e o Mestre da campanha;
- o backup nao foi salvo/confirmado ou falhou na verificacao SHA-256;
- existe um documento ou uma entrada sem ID, com ID repetido ou removido;
- a mesma colecao existe simultaneamente no formato antigo e no novo;
- uma imagem ou estrutura remota mudou desde o snapshot local;
- ha imagens remotas que nao aparecem no snapshot preparado;
- a operacao ultrapassaria a margem segura de 450 documentos;
- Cloudinary ou Firebase nao confirmam integralmente a operacao.

Um bloqueio deve ser investigado. Nao se deve editar manualmente o Firestore para
"fazer passar" sem comparar o backup e os documentos conflitantes.

## Ordem recomendada para a versao final

1. Encerrar a sessao de jogo e pedir que Mestre e jogadores parem de editar a
   campanha durante a janela de migracao.
2. Fazer um backup gerenciado do Firestore, se o plano Firebase disponibilizar
   exportacao, alem do backup JSON criado pelo site.
3. Publicar primeiro as regras do Firestore compativeis e testa-las na versao
   atual. Publicar o site somente depois da confirmacao dessas regras.
4. Entrar como Mestre, baixar o backup JSON e usar **Verificar backup JSON**.
5. Anotar os totais do manifesto: jogadores, personagens, cenas, itens,
   evidencias, traumas e entradas de inventario.
6. Executar **Migrar imagens antigas** uma unica vez e aguardar a verificacao
   final. Nao fechar ou atualizar a aba durante a operacao.
7. Reabrir a campanha em outra aba e comparar os totais e dados vitais com o
   manifesto. Testar chat, uma alteracao de saude/sanidade e a transmissao de uma
   cena com um jogador.
8. Somente depois liberar a mesa para todos os participantes.

## Recuperacao

Se qualquer verificacao falhar, interromper a liberacao e conservar o backup JSON.
Nao existe restauracao total automatica porque ela poderia sobrescrever progresso
novo criado depois do backup. A recuperacao deve comparar o snapshot com o estado
remoto e restaurar somente os registros comprovadamente afetados.

A preparacao do formato antigo pode ser concluida mesmo se um upload posterior
falhar. Nesse caso os valores da campanha continuam iguais, apenas organizados em
subcolecoes, e a migracao de imagens pode ser tentada novamente com seguranca.

## Limpeza de arquivos

O preset sem assinatura permite upload, mas nao deve receber permissao para apagar
ativos diretamente do navegador. A limpeza fisica de arquivos nao usados exige um
backend assinado, retencao e auditoria de referencias. Ate essa etapa existir, a
politica segura e manter o original no Cloudinary e remover somente a referencia
da campanha ou mover a cena para a lixeira privada.
